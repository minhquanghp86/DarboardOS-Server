# SPDX-License-Identifier: Apache-2.0
#
# Copyright (c) 2026 minhquanghp86
# Licensed under the Apache License, Version 2.0 (see LICENSE).
# Build từ Playwright image có Chrome
FROM mcr.microsoft.com/playwright:v1.55.0-jammy AS base

# Cài đặt Google Chrome stable (có H.264 codec)
RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome-keyring.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome-keyring.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        google-chrome-stable \
        fonts-liberation \
        libasound2 \
        libatk-bridge2.0-0 \
        libatk1.0-0 \
        libatspi2.0-0 \
        libcups2 \
        libdbus-1-3 \
        libdrm2 \
        libgbm1 \
        libgtk-3-0 \
        libnspr4 \
        libnss3 \
        libwayland-client0 \
        libxcomposite1 \
        libxdamage1 \
        libxfixes3 \
        libxkbcommon0 \
        libxrandr2 \
        xdg-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY src ./src

# Build TypeScript
RUN npm run build

# Production stage
FROM mcr.microsoft.com/playwright:v1.55.0-jammy

# Cài Chrome lại ở production stage
# (23/09/2026) + pulseaudio/pulseaudio-utils: sink ao "chrome_out" de Chrome
# co noi xuat audio thuc su (container khong co card ALSA that — xac minh
# /proc/asound/cards khong ton tai). Phuc vu tinh nang audio "nhu dien
# thoai" — xem docker-entrypoint.sh va docs/AUDIO-FEATURE-PLAN-2026-09-23.md
# (repo Client) muc 7.
RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome-keyring.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome-keyring.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        google-chrome-stable \
        pulseaudio \
        pulseaudio-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy from build stage
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/dist ./dist
COPY --from=base /app/package*.json ./

# (14/09/2026) SỬA LỖI: selfTest.ts trỏ tới file:///app/self-test/test1.html nhưng
# thư mục self-test KHÔNG được copy vào image -> tính năng self-test chết.
COPY self-test ./self-test

# (18/09/2026) public/cam.html: trang xem camera qua go2rtc MSE, phục vụ ở
# HEALTH_PORT (KHÔNG tunnel ra ngoài) thay vì /config/www/ của HA (bị lộ ra
# internet qua Cloudflare Tunnel). Xem ghi chú trong src/index.ts.
COPY public ./public

# (16/10/2026) Giay phep + thong bao di kem anh (Apache-2.0 §4(a)/(d), LGPL cua libvips trong sharp, OFL cua font dong ho):
# nguoi nhan anh phai thay duoc LICENSE / NOTICE / THIRD-PARTY-NOTICES ngay trong anh (docker run ... ls /licenses).
COPY LICENSE LICENSE-MIT LICENSE-OFL-BebasNeue.txt NOTICE THIRD-PARTY-NOTICES.md TRADEMARKS.md /licenses/
LABEL org.opencontainers.image.licenses="Apache-2.0 AND MIT" \
      org.opencontainers.image.source="https://github.com/minhquanghp86/DarboardOS-Server" \
      org.opencontainers.image.vendor="minhquanghp86"

# Create user data directory
RUN mkdir -p /pw-data && chmod 777 /pw-data

# (23/09/2026) Entrypoint khoi dong PulseAudio truoc, roi exec lenh chinh —
# boc ca duong chay Docker thuan (CMD ben duoi) lan duong chay addon HA OS
# (hassio/remote_webview_server/Dockerfile dat CMD la "/run.sh", ke thua
# ENTRYPOINT nay tu image goc).
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
ENTRYPOINT ["/docker-entrypoint.sh"]

# Environment variables với defaults
ENV TILE_SIZE=32
ENV FULL_FRAME_TILE_COUNT=4
ENV FULL_FRAME_AREA_THRESHOLD=0.5
ENV FULL_FRAME_EVERY=50
ENV EVERY_NTH_FRAME=1
ENV MIN_FRAME_INTERVAL_MS=80
ENV JPEG_QUALITY=85
ENV MAX_BYTES_PER_MESSAGE=61440
ENV WS_PORT=8081
ENV DEBUG_PORT=9221
ENV HEALTH_PORT=18080
ENV PREFERS_REDUCED_MOTION=false
ENV USER_DATA_DIR=/pw-data
ENV BROWSER_LOCALE=en-US
ENV CHROME_EXECUTABLE=/usr/bin/google-chrome-stable

EXPOSE 8081 9221 18080

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:${HEALTH_PORT}/ || exit 1

CMD ["node", "dist/index.js"]

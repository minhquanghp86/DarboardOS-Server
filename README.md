# HA Darboard Server — Remote WebView Server

Biến màn hình cảm ứng **ESP32-P4 / ESP32-S3** thành **bảng điều khiển gắn tường** cho Home Assistant: một trình duyệt
Chrome ẩn chạy trên máy chủ dựng trang web (dashboard HA, YouTube, camera…), gửi phần thay đổi dưới dạng ô ảnh JPEG qua
WebSocket tới màn hình, nhận lại thao tác chạm — kèm âm thanh, menu ứng dụng và điều khiển từ Home Assistant.

Dự án gồm hai repo dùng cùng nhau:

| Repo | Vai trò |
|---|---|
| **HA-Darboard-Server** (repo này) | Máy chủ — addon Home Assistant (hoặc container Docker) |
| [HA-Darboard-Client](https://github.com/minhquanghp86/HA-Darboard-Client) | Firmware màn hình — component ESPHome `remote_webview` và cấu hình mẫu đã chạy thật |

📖 **Hướng dẫn sử dụng đầy đủ**: [`hassio/remote_webview_server/DOCS.md`](hassio/remote_webview_server/DOCS.md) — cũng
hiện ở tab *Tài liệu* của addon trong Home Assistant.

<p align="center">
  <img src="images/menu.png" width="49%" alt="Menu ứng dụng trên màn hình ESP32-P4">
  <img src="images/weather.png" width="49%" alt="Ứng dụng Thời tiết">
  <img src="images/calendar.png" width="49%" alt="Lịch âm dương">
  <img src="images/menu-panel.png" width="49%" alt="Trang Menu panel trong Home Assistant">
</p>

## Tính năng

**Hiển thị**
- Chrome ẩn (có giải mã H.264) dựng trang; chỉ gửi các ô **thay đổi** (so khớp băm từng ô), khung đầy đủ theo ngưỡng
  diện tích/nhịp; bỏ qua khung trùng; không có người xem thì không mã hoá.
- **Tự điều tiết** tốc độ khung và chất lượng JPEG theo thời gian giải mã thật của từng màn hình và độ nghẽn mạng (AIMD).
- Màn hình **ESP32-P4**: khung đầy đủ chia dải ngang để giải mã thẳng vào framebuffer (`?fb=1`) — YouTube đủ độ phân
  giải 1024×600 ~28–29 hình/giây đo thực tế.
- Mỗi màn hình một cấu hình riêng (độ phân giải, xoay, cỡ ô, chất lượng…), gửi lúc kết nối; kết nối lại với tham số mới
  là cấu hình lại ngay.

**Tương tác**
- Cảm ứng (chạm, kéo, cuộn) truyền về trình duyệt; bàn phím ảo tự hiện khi chạm ô nhập (có **tiếng Việt Telex**).
- Đồng bộ URL hai chiều: màn hình biết trang đang hiện thực tế (kể cả tab SPA của HA), và điều hướng được từ HA.

**Âm thanh**
- Âm thanh trang web (YouTube, radio…) được bắt qua PulseAudio và gửi PCM tới màn hình có khai báo loa.

**Menu ứng dụng** (vuốt từ mép trên xuống, trên mọi trang)
- Giờ, ngày dương/âm lịch, thời tiết thu gọn; thanh trượt độ sáng/âm lượng; nút Màn hình chờ / Tắt tiếng / Khử vọng mic / Không làm phiền.
- Ứng dụng theo nhóm: Home Assistant, Camera P4, Camera nhà (lưới camera go2rtc), Cảnh (scene/script HA), Năng lượng,
  YouTube, TikTok, Nhạc, Radio VOV, Tin tức, Media, Thời tiết (Open-Meteo, 34 tỉnh/thành), Lịch âm dương, Hẹn giờ
  (báo thức toàn màn hình, vẫn reo khi đã chuyển trang), Trình duyệt.
- Trang **Menu panel** trên thanh bên Home Assistant (ingress): ẩn/hiện, sắp xếp, biểu tượng MDI, màu, thêm ứng dụng.

**Giao diện kiểu hệ điều hành** (OS-1/OS-2 — xem `docs/KE-HOACH-GIAO-DIEN-HE-DIEU-HANH.md`)
- Vuốt lên từ mép dưới: về màn hình chính (đồng hồ, thời tiết, lưới ứng dụng, dock).
- **Mỗi ứng dụng một tab Chromium riêng**: mở Home Assistant/Camera/Radio… không tải lại — tab được giữ "ấm" ở nền,
  quay lại gần như tức thì. Chỉ tab đang hiện mới được mã hoá/truyền hình; các tab khác vẫn chạy JS (radio/nhạc phát
  nền được). Tối đa `MAX_APP_TABS` ứng dụng phụ mở song song, cũ nhất tự đóng khi vượt hạn mức.
- Thẻ **Đang phát** trong thanh kéo xuống: Radio/Nhạc đang phát nền — mở lại hoặc dừng ngay, không cần vào ứng dụng.

**Vận hành**
- `/metrics` (JSON số liệu từng màn hình), tinh chỉnh nóng qua `/data/rwv-tuning.json`, self-test đo thời gian dựng
  hình, proxy Chrome DevTools tuỳ chọn.

## Cài đặt

### Home Assistant (khuyến nghị)

1. Cài đặt → Addon → Cửa hàng → ⋮ → Kho lưu trữ → thêm `https://github.com/minhquanghp86/HA-Darboard-Server`.
2. Cài **Remote WebView Server**, khởi động.
3. Nạp firmware cho màn hình từ [HA-Darboard-Client](https://github.com/minhquanghp86/HA-Darboard-Client) với
   `server: <ip-HA>:8081`.

Chi tiết từng bước, cách dùng và xử lý sự cố: [DOCS.md](hassio/remote_webview_server/DOCS.md).

**Yêu cầu**: máy chủ **x86-64 (amd64)** — Google Chrome cho Linux (cần cho H.264) không có bản ARM. Đo thực tế 3 màn
hình trên Intel i5-8500T: ~1,1 GB RAM, ~3 nhân CPU khi một màn hình phát video.

### Docker (ngoài Home Assistant)

Xem [`docker-compose.rwv.yml`](docker-compose.rwv.yml) — image `ghcr.io/minhquanghp86/ha-darboard-server:chrome-h264`,
chạy `network_mode: host`. Ngoài HA không có ingress: đặt `LAUNCHER_CONFIG_OPEN=1` nếu muốn lưu cấu hình menu từ
`http://<máy>:18080/launcher-config.html` (mọi máy trong LAN đều sửa được — chỉ dùng trong mạng tin cậy).

## Cổng

| Cổng | Dùng cho |
|---|---|
| `8081` (`WS_PORT`) | WebSocket với màn hình: ảnh, âm thanh, cảm ứng, trạng thái |
| `18080` (`HEALTH_PORT`) | `/metrics`, trang ứng dụng (`weather`, `calendar`, `cams`, `scenes`, `radio`, `timer`, `cam`), Menu panel (ingress) — **chỉ LAN** |
| `9221` (`DEBUG_PORT`) | Chrome DevTools nội bộ (127.0.0.1) |
| `9222` (`DEBUG_PROXY_PORT`) | DevTools ra LAN — chỉ khi bật `expose_debug_proxy` |

## Biến môi trường

Addon tự đặt các biến này từ phần *Cấu hình*; khi chạy Docker thì tự khai báo.

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `WS_PORT`, `HEALTH_PORT`, `DEBUG_PORT` | 8081, 18080, 9221 | Xem bảng cổng |
| `USER_DATA_DIR` | `/data/pw-data` (addon) | Hồ sơ trình duyệt — giữ đăng nhập qua cập nhật |
| `BROWSER_LOCALE` | `en-US` | Ngôn ngữ trình duyệt |
| `PREFERS_REDUCED_MOTION` | `false` | Yêu cầu trang tắt hiệu ứng động |
| `TILE_SIZE`, `FULL_FRAME_TILE_COUNT`, `FULL_FRAME_AREA_THRESHOLD`, `FULL_FRAME_EVERY`, `EVERY_NTH_FRAME`, `MIN_FRAME_INTERVAL_MS`, `JPEG_QUALITY`, `MAX_BYTES_PER_MESSAGE` | xem addon | **Dự phòng** khi màn hình không tự gửi (firmware `remote_webview` luôn gửi) |
| `EXPOSE_DEBUG_PROXY`, `DEBUG_PROXY_PORT` | `false`, 9222 | Proxy DevTools ra LAN |
| `GO2RTC_URL` | `http://127.0.0.1:1984` | go2rtc cho ứng dụng Camera nhà |
| `LAUNCHER_CAMERA_URL`, `LAUNCHER_WEATHER_URL` | trang nội bộ | Đổi đích của ứng dụng Camera P4 / Thời tiết |
| `LAUNCHER_CONFIG_OPEN` | — | `1` = cho lưu cấu hình menu không qua ingress (Docker) |
| `MAX_APP_TABS` | `2` | Số ứng dụng phụ tối đa giữ mở song song mỗi màn hình (OS-2 — mỗi ứng dụng một tab), không kể Home Assistant/màn hình chính |
| `CCR_ADAPTIVE`, `CCR_REFRESH_MS`, `HALF_SCALE_VIDEO`, … | xem mã | Tinh chỉnh bộ điều tiết (nâng cao) |

## Giao thức WebSocket (tóm tắt)

Gói nhị phân, byte đầu là loại (khớp `src/protocol.ts` và `components/remote_webview/protocol.h` bên firmware):

| Loại | Hướng | Nội dung |
|---|---|---|
| 1 `Frame` | server → màn hình | Các ô JPEG của một khung |
| 2 `Touch` | màn hình → server | Chạm / kéo / nhấc |
| 3 `FrameStats` | hai chiều | Xin / báo thời gian giải mã, bộ nhớ |
| 4 `OpenURL` | màn hình → server | Mở trang |
| 5 `Keepalive` | màn hình → server | Giữ kết nối |
| 6 `CurrentURL` | server → màn hình | Trang đang hiện thực tế |
| 7 `AudioFrame` | server → màn hình | PCM 16 kHz mono của trang |
| 8 `SetDisplayURL` | server → màn hình | Người dùng nhập URL ở menu → thực thể *URL hiển thị* |
| 9 `DeviceControl` | server → màn hình | Thanh trượt / nút trong menu (độ sáng, âm lượng, màn hình chờ, tắt tiếng, khử vọng) |
| 10 `DeviceState` | màn hình → server | Độ sáng, âm lượng, trạng thái nút, **giờ của màn hình** |

Tham số kết nối (`?id=&w=&h=&ts=&q=…&home=&audio=1&fb=1&urlset=1&ctl=1`) khai báo khả năng của màn hình.

## Phát triển

```bash
npm ci
npm run build        # TypeScript -> dist/
npm run typecheck    # kiểm kiểu toàn bộ, kể cả file test
npm run test:run     # unit test (giao thức, bộ điều tiết, menu, chính sách tab, cú pháp script launcher…)
npm run test:integration   # thử tích hợp: server thật + Chromium thật + panel giả qua WebSocket (~1 phút)
```

- **Thử tích hợp** (`src/integration/`): mỗi kịch bản khởi động một server thật, một "panel giả" kết nối WebSocket
  như firmware (gửi chạm, nhận khung/URL), rồi soi Chromium qua cổng DevTools (đếm tab, chạy JS trong tab). Cần
  Chromium: tự tìm `CHROME_EXECUTABLE`, Chrome hệ thống hoặc bản Playwright; `ITEST_LOG=1` in log server kể cả khi đạt.
- **CI** (`.github/workflows/test.yml`): mỗi PR / push chạy kiểm kiểu + unit test + build, rồi thử tích hợp với
  Chrome có sẵn trên runner GitHub.

- `src/` — máy chủ (Node/TypeScript): `deviceManager.ts` (phiên thiết bị, launcher, bàn phím), `frameProcessor.ts`
  (chia ô, JPEG), `adaptive.ts` (điều tiết), `broadcaster.ts`, `audioCapture.ts`, `launcher*.ts`, `haApps.ts`,
  `weatherMini.ts`.
- `public/` — trang ứng dụng và Menu panel, phục vụ ở `HEALTH_PORT`.
- `hassio/remote_webview_server/` — addon: `config.yaml`, `run.sh`, `DOCS.md`, `CHANGELOG.md`, `translations/`.
- Phát hành: push `main` → GitHub Actions dựng `ghcr.io/minhquanghp86/ha-darboard-server:chrome-h264` → tăng
  `version` trong `config.yaml` → Home Assistant thấy bản cập nhật.

## Bảo mật

- `HEALTH_PORT` (18080) chỉ dùng trong LAN; không đưa ra Internet. Menu panel đi qua ingress của HA (có đăng nhập);
  lưu cấu hình chỉ nhận từ Supervisor.
- **Không** đặt trang tự tạo trong `/config/www/` của HA nếu HA mở ra Internet: `/local/` phục vụ không cần đăng nhập
  (đã kiểm chứng: `https://<domain>/local/cam.html` trả `200` từ Internet qua Cloudflare Tunnel). Vì vậy các trang của
  dự án được phục vụ ở `HEALTH_PORT`.
- Addon dùng token Supervisor (quyền `homeassistant_api`) để đọc vị trí nhà và chạy scene/script — không cần thông tin
  đăng nhập của người dùng.
- Proxy DevTools (`expose_debug_proxy`) cho phép điều khiển trình duyệt, kể cả phiên HA — chỉ bật khi cần.

## Ghi công và giấy phép

- Phát triển tiếp từ [strange-v/RemoteWebViewServer](https://github.com/strange-v/RemoteWebViewServer) — cảm ơn
  strange-v. Ý tưởng bàn phím ảo từ [SleepinDevil](https://github.com/SleepinDevil/RemoteWebViewServer).
- Dữ liệu thời tiết [Open-Meteo](https://open-meteo.com), radio Đài Tiếng nói Việt Nam, âm lịch theo thuật toán
  Hồ Ngọc Đức, biểu tượng [Material Design Icons](https://pictogrammers.com/library/mdi/).

| Phần | Giấy phép | File |
|---|---|---|
| Mã gốc của strange_v | MIT © 2025 strange_v | `LICENSE-MIT` |
| Sửa đổi và bổ sung | Apache License 2.0 © 2026 minhquanghp86 | `LICENSE` |

Mọi file đã sửa từ upstream đều có thông báo ở đầu file theo Apache-2.0 §4(b); xem `NOTICE`. Khi dùng lại mã nguồn, giữ
cả hai thông báo bản quyền.

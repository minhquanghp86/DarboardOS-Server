#!/bin/sh
# (23/09/2026) Khoi dong PulseAudio (che do he thong, sink ao "chrome_out")
# TRUOC KHI chay lenh chinh (node dist/index.js, hoac run.sh cua addon boc
# ngoai no) — Chrome can PULSE_SERVER san sang tu luc no khoi dong de dua
# am thanh vao dung sink ao nay, phuc vu tinh nang "am thanh nhu dien thoai"
# (xem docs/AUDIO-FEATURE-PLAN-2026-09-23.md, muc 7, repo Client).
#
# Container khong co card ALSA that (khong pass-through phan cung am thanh)
# nen KHONG dung module-null-sink kieu ALSA (can nap kernel module, khong
# lam duoc trong container khong dac quyen) — dung PulseAudio thuan phan
# mem, khong can driver kernel nao ca.
#
# ENTRYPOINT nay boc CA HAI duong chay: image Docker thuan (CMD mac dinh
# "node dist/index.js") LAN addon HA OS (CMD la "/run.sh", tu no lai
# exec node dist/index.js) — vi chi export bien moi truong roi exec "$@",
# khong hardcode lenh cuoi cung.
set -e

if command -v pulseaudio >/dev/null 2>&1; then
  mkdir -p /var/run/pulse
  pulseaudio \
    --system \
    --disallow-exit \
    --exit-idle-time=-1 \
    --load="module-null-sink sink_name=chrome_out sink_properties=device.description=ChromeOutput" \
    --load="module-native-protocol-unix auth-anonymous=1 socket=/var/run/pulse/native" \
    --daemonize=true \
    -n \
    2>/var/log/pulseaudio-start.log \
    || echo "[entrypoint] canh bao: khong khoi dong duoc pulseaudio, tinh nang audio se khong hoat dong (xem /var/log/pulseaudio-start.log)"

  if command -v pactl >/dev/null 2>&1; then
    pactl set-default-sink chrome_out 2>/dev/null || true
  fi

  export PULSE_SERVER="unix:/var/run/pulse/native"
  echo "[entrypoint] PulseAudio san sang, sink=chrome_out, PULSE_SERVER=$PULSE_SERVER"
else
  echo "[entrypoint] pulseaudio chua duoc cai — bo qua, Chrome chay khong co audio output"
fi

exec "$@"

#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
#
# Copyright (c) 2026 minhquanghp86
# Licensed under the Apache License, Version 2.0 (see LICENSE).
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
  # ══════════════════════════════════════════════════════════════════════════
  # (23/09/2026) DON RAC CUA LAN CHAY TRUOC — BAT BUOC.
  #
  # Loi that da gap: `docker restart` (hoac Supervisor khoi dong lai addon)
  # KHONG xoa he thong tap tin cua container, nen /var/run/pulse/pid va socket
  # `native` cua lan chay truoc van con. PulseAudio thay tap tin pid la tu
  # choi khoi dong ("Daemon startup failed"), trong khi socket cu van nam do —
  # nen moi thu NHIN co ve binh thuong, chi co parec bao "Connection refused"
  # va tinh nang am thanh chet im. Pid trong tap tin la cua tien trinh o lan
  # chay TRUOC, khong con ton tai trong container moi.
  rm -f /var/run/pulse/pid /var/run/pulse/native 2>/dev/null || true
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

  export PULSE_SERVER="unix:/var/run/pulse/native"

  # KIEM CHUNG THAT SU, dung chi in ra "san sang".
  # Ban truoc in dong "san sang" VO DIEU KIEN ngay ca khi daemon chet — dung
  # kieu bao cao da lam mat nhieu thoi gian tim loi o tren.
  if command -v pactl >/dev/null 2>&1; then
    if pactl info >/dev/null 2>&1; then
      pactl set-default-sink chrome_out 2>/dev/null || true
      echo "[entrypoint] PulseAudio san sang, sink=chrome_out, PULSE_SERVER=$PULSE_SERVER"
    else
      echo "[entrypoint] LOI: PulseAudio KHONG nhan ket noi — am thanh se khong hoat dong."
      sed -n '1,20p' /var/log/pulseaudio-start.log 2>/dev/null || true
    fi
  else
    echo "[entrypoint] PulseAudio da khoi dong (khong co pactl de kiem chung), PULSE_SERVER=$PULSE_SERVER"
  fi
else
  echo "[entrypoint] pulseaudio chua duoc cai — bo qua, Chrome chay khong co audio output"
fi

exec "$@"

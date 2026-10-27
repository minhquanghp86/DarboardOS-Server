# Dashboard OS

Điều khiển màn hình ESP32 chạy **Dashboard OS** từ Home Assistant.

- 30 hành động: gửi thông báo (ảnh/video/camera/âm thanh/TTS), mở app/URL, điều hướng, độ sáng, âm lượng,
  chất lượng hình, góc xoay, báo thức, chụp màn hình, chạy IPTV…
- Mỗi màn hình là một thiết bị trong HA: cảm biến, nút bấm, công tắc, thanh trượt, chọn góc xoay.
- Cài đặt: HACS → Integrations → ⋮ → Custom repositories → dán repo này (loại *Integration*) → Install →
  restart Home Assistant → Settings → Devices & Services → Add Integration → **Dashboard OS**.

Yêu cầu: add-on **Dashboard OS Server** đã cài và đang chạy.

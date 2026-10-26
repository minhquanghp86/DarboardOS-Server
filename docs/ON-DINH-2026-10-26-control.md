# MỐC ỔN ĐỊNH — 26/10/2026 — DarboardOS Server v2.9.241

> **Bản ổn định mới nhất: `v2.9.241`** (commit `9b178a4`), add-on đang chạy bản này.
> Người dùng xác nhận: thẻ Điều khiển đã mượt, giữ tay kéo hình cập nhật theo tay.

## 1. Đã sửa gì trong bản ổn định này

### 1.1 Giao diện bàn phím ảo (2.9.229)
- Nền sáng hơn (`#262a31` → gradient xám xanh + `backdrop-filter: blur` = kính mờ), phím sáng.
- Phím **bo góc 10px** (trước 2px), bỏ viền cứng, thêm bóng nổi.
- **Hiệu ứng bấm phím**: lún + sáng (`translateY(2px) scale(.95)` + `brightness`), không đổi màu nền nên phím
  Enter/VN/layout giữ đúng màu.
- Màn thấp: chiều cao `min(196px, 50vh)` (480×272 trước chiếm 72% màn hình → nay 50%).
- Màn dọc (panel xoay 90/270): chế độ hẹp giảm gap/padding → phím 21px → 24px.

### 1.2 Thẻ Điều khiển (2.9.230 → 2.9.241)
Chuỗi lỗi chồng lỗi, đã xử lý từng lớp:

| Bản | Nội dung |
|---|---|
| 2.9.230 | Bỏ gap 55 ms giữa 2 khung (nhip 8-10 → 14-19 fps) + chặn tồn đọng WS |
| 2.9.231 | (Sai) ưu tiên băng thông bằng cách **dừng khung khi chạm** → hình đứng khi kéo |
| 2.9.232 | (Sai) gộp cả cử chỉ vào 1 POST → chỉ gửi khi nhả tay |
| 2.9.233 | Trả lại gửi live từng điểm |
| 2.9.234 | Gộp đoạn 60 ms cho đường HTTP (giảm 4× request trên tên miền công khai) |
| 2.9.235 | **Input qua WebSocket** (giống panel thật) + `/control/ping` trả IP LAN để tự chuyển LAN |
| 2.9.236 | Hết đứng hình khi kéo (bỏ mốc dừng 300 ms → 30 ms) |
| 2.9.237 | Fallback WS → **SSE** thay vì MJPEG (Chrome Android không phát `multipart/x-mixed-replace`) |
| 2.9.238 | Chặn Chrome Android cướp cử chỉ kéo (`touch-action:none`, `overscroll-behavior:none`, `preventDefault`) |
| 2.9.239 | Gộp `move` khi kênh CDP bận (mỗi lệnh touch ~26 ms dùng chung kênh với `captureScreenshot`) |
| 2.9.240 | **SSE dùng chung 1 vòng chụp/thiết bị** (như 2.9.207/2.9.212) thay vì mỗi kết nối một vòng |
| 2.9.241 | **Luôn chụp khung** (bỏ `inputBusy → continue`) → hình cập nhật trong lúc kéo |

### 1.3 Nguyên nhân gốc (để không lặp lại)
1. `Input.dispatchTouchEvent` (~26 ms) và `Page.captureScreenshot` (~65 ms) dùng **cùng một kênh CDP**.
   Gửi 60 move/giây → kênh kín → khung hình không chen vào được.
2. Từ 2.9.214, đường **SSE tự mở vòng chụp riêng cho MỖI kết nối** (trái với 2.9.207 “1 vòng/thiết bị”).
3. Chrome Android **không phát MJPEG** trong `<img>` → fallback MJPEG trông như “DỪNG”.
4. Mọi lần “sửa mà không thấy khác” đều do **một lớp lỗi khác** phía sau, không phải do cache.

## 2. Kiến trúc chốt (đang chạy)
```
Panel:  chạm → WS TouchType → CDP Input.dispatchTouchEvent → Chromium
        ESP32 vẽ tile ← WS tile JPEG ← frame pipeline ← Page.startScreencast (push)
Thẻ:    chạm → WS {t:'touch'} (LAN) / POST /control/input (tên miền) → screenTouch
        ảnh ← SSE ← latestFrame (1 vòng chụp/thiết bị, ~16 fps) ← Page.captureScreenshot
```
- 1 Chromium/tab cho mỗi panel; panel và thẻ là 2 **người xem**.
- `/control/ping` → `{ok, lan}`; trang mở bằng tên miền (HTTP) tự chuyển sang IP LAN để dùng WS.

## 3. Rollback
- Code: `git checkout 9b178a4` (hoặc tag `stable-2026-10-26`).
- Add-on: cài lại version trước trong HA (Settings → Add-ons → DarboardOS Server → phiên bản).
- Lưu ý store: nếu `version_latest` không đổi, xem `docs/SUA-LOI-STORE-ADDON.md` (clone Supervisor bị detached HEAD).

## 4. Việc còn có thể làm (không gấp)
- Thẻ Điều khiển dùng **chung khung của panel** (fan-out) để bỏ hẳn `captureScreenshot` cho thẻ —
  giảm CPU và không còn tranh chấp CDP. Hạn chế: trang tĩnh sẽ không có khung mới, cần fallback ~1 fps.
- Nút “Chuyển sang LAN” trên header khi phát hiện đang mở bằng tên miền HTTPS (probe bị chặn bởi mixed content).
- Xoay ảnh chụp/video ghi SD theo panel: đã điều tra, xem `BAN-GIAO-2026-10-25-camera-xoay-boot-logo.md`.

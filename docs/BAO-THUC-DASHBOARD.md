# Ứng dụng Báo thức trên Dashboard (27/10/2026)

## Dùng thế nào

1. Trang chủ Dashboard → lưới **Ứng dụng** → **Báo thức** (`alarm-ctl.html`).
2. Danh sách màn hình: mỗi thẻ hiện tên màn, **số báo thức đang bật** và **giờ reo kế tiếp**;
   chấm xanh = màn đang kết nối.
3. Chạm một màn → mở **trình Báo thức của màn đó** (`alarm.html?dev=<id>`):
   - Danh sách báo thức reo trên màn này (gồm cả báo thức "Mọi màn hình").
   - ＋ để thêm; chạm một báo thức để sửa; công tắc để bật/tắt; nút **Xoá** trong trình sửa (chạm 2 lần).
   - Trong trình sửa có mục **"Reo trên"**: chọn màn này / nhiều màn / mọi màn → đây là chỗ **chọn hiển thị**.
   - Báo thức mới mặc định gắn với màn vừa chọn.
4. **"Tất cả màn hình"** → trình Báo thức chung (không gắn sẵn màn nào).

Trên panel, ứng dụng **Báo thức** trong menu ứng dụng mở đúng trang này với `?dev=<id của panel>` — cùng một UI,
cùng một dữ liệu.

## Dữ liệu & đồng bộ

- Một nguồn duy nhất: `/data/rwv-alarms.json` (module `src/alarms.ts`), server giữ nên **màn tắt vẫn reo đúng giờ**.
- Thêm/sửa/xoá ở Dashboard hay trên panel đều ghi vào cùng file → mọi nơi thấy ngay.
- Mỗi báo thức có `devices: 'all' | string[]` — danh sách màn sẽ reo.
- Báo lại (snooze) 5/10/15/30 phút; reo tối đa 5 phút không ai tắt → tự dừng + thông báo "báo thức bị lỡ".
- Giờ tính theo múi giờ server (mọi panel cùng nhà).

## API (dùng chung cho cả hai nơi)

| Endpoint | Việc |
|---|---|
| `GET /alarm/list[?dev=<id>]` | danh sách báo thức + `next`, kèm `screens`, `tz` |
| `POST /alarm/save` | thêm/sửa (body như `Alarm`) |
| `POST /alarm/del?id=` | xoá |
| `POST /alarm/toggle?id=&on=1` | bật/tắt |
| `POST /alarm/stop?id=` · `/alarm/snooze?id=` | tắt tiếng / báo lại khi đang reo |

**Quyền truy cập (27/10/2026):** trước chỉ `127.0.0.1` (panel). Nay cho thêm **LAN/Tailscale**
(10.x, 192.168.x, 172.16-31.x), **HA ingress** (172.30.32.2) và `LAUNCHER_CONFIG_OPEN=1`.
Nếu cần khoá lại: sửa `allowedSource()` trong `src/alarms.ts`.

## Đã kiểm thử (2.9.262)

- `GET /alarm-ctl.html` → 200; lưới ứng dụng trang chủ có mục **Báo thức**.
- `GET /alarm/list` từ LAN (192.168.10.2:18080) → 200, trả 4 màn hình.
- Tạo báo thức cho `esp32-1cdbd49b2260` → `list?dev=` trả đúng `next` (Tue 07:15); xoá → còn 0.
- Panel-side (từ trong container, 127.0.0.1) vẫn đọc được.
- Ảnh render thật (Chrome headless) của `alarm-ctl.html` và `alarm.html?dev=…`: bố cục đúng, thẻ hiện
  số báo thức + giờ kế tiếp, trình của từng màn chỉ liệt kê báo thức reo trên màn đó.
- Dữ liệu test đã xoá sạch.

## File liên quan

- `public/alarm-ctl.html` — trang chọn màn (mới).
- `public/alarm.html` — trình Báo thức (dùng cho cả panel và Dashboard).
- `src/alarms.ts` — lưu trữ, lịch reo, API, `allowedSource()`.
- `src/index.ts` — whitelist trang tĩnh (`alarm-ctl.html`).
- `public/launcher-config.html` — mảng `APPS` (ô **Báo thức** trên lưới trang chủ).

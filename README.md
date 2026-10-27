# Dashboard OS — biến màn hình ESP32 thành bảng điều khiển Home Assistant

**Dashboard OS** là add-on Home Assistant truyền giao diện (dashboard HA hoặc bất kỳ trang web nào) xuống các màn hình
ESP32 (S3, P4) theo thời gian thực, kèm bộ giao diện kiểu điện thoại: màn hình chính, thanh trạng thái, ứng dụng,
thông báo, chuông cửa, báo thức, tin nhắn, IPTV.

- Cài bằng add-on, cấu hình bằng giao diện web, không phải sửa file.
- Mỗi màn hình tự xuất hiện trong Home Assistant thành một thiết bị, có sẵn nút bấm, thanh trượt và cảm biến.
- Chạy hoàn toàn trong nhà (LAN/Tailscale), không cần Internet.

## 1. Cần gì để bắt đầu

| Thành phần | Yêu cầu |
|---|---|
| Home Assistant | HA OS hoặc Supervised, kiến trúc **amd64** |
| Add-on này | cài từ kho add-on (bên dưới) |
| Màn hình | ESP32-S3 / ESP32-P4 nạp firmware Dashboard OS (repo `DashboardOS-Client`) |

## 2. Cài đặt

1. **Settings → Add-ons → Add-on Store → ⋮ → Repositories** → dán `https://github.com/minhquanghp86/DashboardOS-Server` → **Add**.
2. Tìm **Dashboard OS Server** → **Install** → **Start**.
3. Bật **Show in sidebar** để mở nhanh trang quản lý.
4. Nạp firmware cho từng màn hình (hướng dẫn ở repo Client). Màn hình tự kết nối và hiện trong mục **Màn hình**.

## 3. Bạn làm được gì

**Hiển thị:** chiếu dashboard HA hoặc URL bất kỳ, nhiều tab mỗi màn, màn hình chờ (đồng hồ, lịch âm, thời tiết,
ảnh gia đình), xoay 0/90/180/270, chỉnh độ sáng và âm lượng.

**Giao diện điện thoại:** lưới ứng dụng tự sắp xếp, thanh trạng thái, thông báo kéo xuống, khoá màn hình,
ứng dụng gần đây, cử chỉ vuốt theo tay.

**Ứng dụng có sẵn:** Camera (xem/chụp/quay lưu thẻ SD), Frigate, IPTV, YouTube, YouTube TV, nhạc, radio, tin tức,
lịch, thời tiết, ảnh, ghi chú, tệp, gọi video giữa các màn, chuông cửa, báo thức, tin nhắn nội bộ.

**Chuông cửa:** bấm chuông thì mọi màn đổ chuông, hiện hình, nói chuyện 2 chiều, mở cổng; không ai nghe thì báo
cuộc gọi nhỡ kèm ảnh và lưu nhật ký 30 ngày.

**Báo thức:** lặp theo thứ, báo lại, chọn màn nào reo; lưu ở server nên màn tắt vẫn reo đúng giờ.

**Điều khiển từ xa:** trang Điều khiển trên điện thoại để xem màn, chạm/vuốt, dùng phím Trở lại / Màn hình chính /
Gần đây và chụp màn hình.

## 4. Dùng với Home Assistant

Mỗi màn hình là một thiết bị trong HA với đầy đủ cảm biến, nút bấm, công tắc, thanh trượt và chọn góc xoay.
Cài tích hợp: HACS → Integrations → Custom repositories → repo này → Download → restart HA →
**Settings → Devices & Services → + Add Integration → Dashboard OS**.

30 hành động: `send`, `open_app`, `open_url`, `nav`, `wake`, `lock`, `reload`, `close_app`, `screenshot`,
`set_brightness`, `set_volume`, `set_quality`, `set_rotation`, `set_dnd`, `set_no_sleep`, `set_screensaver`,
`set_setting`, `say`, `alarm_create`, `alarm_list`, `alarm_delete`, `alarm_set_enabled`, `alarm_stop`,
`alarm_snooze`, `list_screens`, `get_status`, `cast_iptv`, `touch`, `swipe`, `send_command`.

Mọi hành động có trường **Thiết bị** (bỏ trống = mọi màn đang kết nối). Chi tiết và ví dụ trong
[`custom_components/dashboard_os/README.md`](custom_components/dashboard_os/README.md).

## 5. Vận hành

| Việc | Ở đâu |
|---|---|
| Xem/sửa từng màn | Sidebar → Dashboard → Màn hình |
| Đổi Wi-Fi, độ sáng, chất lượng | Trên màn hình (Cài đặt) hoặc trang Dashboard |
| Sao lưu | Sao lưu add-on trong HA |
| Nhật ký | Settings → Add-ons → Dashboard OS Server → Log |

Cổng: `18080` (web, điều khiển), `8081` (màn hình kết nối) — chỉ dùng trong LAN/Tailscale.

## 6. Xử lý sự cố

| Hiện tượng | Cách xử lý |
|---|---|
| Màn hình không hiện trong danh sách | Kiểm tra cùng mạng Wi-Fi và đúng IP máy HA; khởi động lại màn |
| Hình giật hoặc mờ | Giảm chất lượng hình, hoặc bật nửa phân giải cho video |
| Màn hình đen sau khi cập nhật | Khởi động lại add-on, xem log |
| Không điều khiển được từ điện thoại | Mở bằng IP LAN (`http://<ip-ha>:18080`), không qua tên miền |

## 7. Giấy phép

Apache-2.0. Biểu tượng MDI (Pictogrammers, Apache-2.0), phông Bebas Neue (OFL) — chi tiết trong
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). Nhãn hiệu: [TRADEMARKS.md](TRADEMARKS.md).

Tài liệu kỹ thuật (kiến trúc, giao thức, phát triển): thư mục [`docs/`](docs/).

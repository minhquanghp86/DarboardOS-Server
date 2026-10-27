# Dashboard OS — biến màn hình ESP32 thành bảng điều khiển Home Assistant

**Dashboard OS** là một add-on Home Assistant truyền giao diện (dashboard HA hoặc bất kỳ trang web nào)
xuống các màn hình ESP32 (S3, P4) theo thời gian thực, kèm bộ giao diện kiểu điện thoại: màn hình chính,
thanh trạng thái, ứng dụng, thông báo, chuông cửa, báo thức, tin nhắn, IPTV…

- Cài bằng add-on, cấu hình bằng giao diện web — không sửa file.
- Mỗi màn hình tự xuất hiện trong Home Assistant thành một thiết bị, có sẵn nút bấm / thanh trượt / cảm biến.
- Chạy hoàn toàn trong nhà (LAN/Tailscale), không cần Internet.

---

## 1. Cần gì để bắt đầu

| Thành phần | Yêu cầu |
|---|---|
| Home Assistant | HA OS hoặc Supervised, kiến trúc **amd64** |
| Add-on này | cài từ kho add-on (bên dưới) |
| Màn hình | ESP32-S3 / ESP32-P4 nạp firmware **Dashboard OS** (xem [DashboardOS-Client](https://github.com/minhquanghp86/DarboardOS-Client)) |

## 2. Cài đặt

1. **Settings → Add-ons → Add-on Store → ⋮ → Repositories** → dán
   `https://github.com/minhquanghp86/DarboardOS-Server` → **Add**.
2. Tìm **Dashboard OS Server** → **Install** → **Start**.
3. Bật **Show in sidebar** để mở nhanh trang quản lý.
4. Nạp firmware cho từng màn hình (theo hướng dẫn ở repo Client). Màn hình tự kết nối tới add-on
   qua mạng LAN và hiện trong mục **Màn hình**.

> Lần đầu, màn hình vào chế độ phát Wi-Fi riêng (`dashboard-...`) để bạn nhập Wi-Fi nhà; sau đó mọi thứ
> cấu hình được từ xa trên màn hình hoặc từ trang Dashboard.

## 3. Bạn làm được gì

### Hiển thị
- Chiếu dashboard Home Assistant hoặc bất kỳ URL nào, nhiều tab cho mỗi màn, chuyển tab tức thì.
- Tự chỉnh chất lượng hình và nhịp khung theo mạng; chế độ nửa phân giải cho video.
- Màn hình chờ: đồng hồ lớn, ngày âm lịch, thời tiết, ảnh gia đình (Google Photos, thư mục media).
- Xoay màn hình 0/90/180/270; độ sáng, âm lượng, tắt tiếng.

### Giao diện kiểu điện thoại
- Màn hình chính dạng lưới ứng dụng (ẩn/hiện, đổi thứ tự, biểu tượng, màu, thư mục).
- Thanh trạng thái, thông báo kéo xuống, khoá màn hình, ứng dụng gần đây, cử chỉ vuốt theo tay.

### Ứng dụng có sẵn
Camera (xem/chụp/quay lưu thẻ SD), Frigate, IPTV, YouTube, YouTube TV, nhạc, radio, tin tức, lịch,
thời tiết, ảnh, ghi chú, tệp, gọi video giữa các màn, chuông cửa, **báo thức**, tin nhắn nội bộ.

### Chuông cửa
Bấm chuông → mọi màn đổ chuông, hiện hình người bấm, nói chuyện 2 chiều, mở cổng; không ai nghe thì
báo "cuộc gọi nhỡ" kèm ảnh và lưu nhật ký 30 ngày.

### Báo thức
Đặt trên màn hoặc từ trang Dashboard: lặp theo thứ, báo lại, chọn màn nào reo. Báo thức lưu ở server
nên màn tắt vẫn reo đúng giờ.

### Điều khiển từ xa
Trang **Điều khiển** trên điện thoại: xem màn hình, chạm/vuốt, phím Trở lại / Màn hình chính / Gần đây,
chụp màn hình.

## 4. Dùng với Home Assistant (tích hợp Dashboard OS)

M��i màn hình là một thiết bị trong HA, kèm sẵn:

| Loại | Ví dụ |
|---|---|
| Cảm biến | Kết nối, ứng dụng đang mở, trạng thái màn (khoá / màn hình chờ / không làm phiền) |
| Nút bấm | Màn hình chính, Quay lại, Gần đây, Đánh thức, Tải lại, Chụp màn hình |
| Công tắc | Màn hình chờ, Không làm phiền, Không cho màn ngủ |
| Thanh trượt | Độ sáng, Âm lượng, Chất lượng hình |
| Chọn | Góc xoay |

### Cài tích hợp
1. Chép thư mục `custom_components/dashboard_os` vào `/config/custom_components/`.
2. Khởi động lại Home Assistant.
3. **Settings → Devices & Services → + Add Integration → Dashboard OS** → giữ địa chỉ mặc định → **Submit**.

### Các hành động (30)

| Nhóm | Hành động |
|---|---|
| Thông báo | `send` (tiêu đề, nội dung, ảnh/video/âm thanh/camera, thời gian, mức ưu tiên) |
| Điều hướng | `open_app`, `open_url`, `nav`, `wake`, `lock`, `reload`, `close_app`, `screenshot` |
| Hiển thị & âm thanh | `set_brightness`, `set_volume`, `set_quality`, `set_rotation`, `set_dnd`, `set_no_sleep`, `set_screensaver`, `set_setting`, `say` |
| Báo thức | `alarm_create`, `alarm_list`, `alarm_delete`, `alarm_set_enabled`, `alarm_stop`, `alarm_snooze` |
| Nâng cao | `list_screens`, `get_status`, `cast_iptv`, `touch`, `swipe`, `send_command` |

M��i hành động đều có trường **Thiết bị** (chọn một hay nhiều màn; bỏ trống = mọi màn đang kết nối).

### Ví dụ

Thông báo khi có khách:

```yaml
action:
  - action: dashboard_os.send
    data:
      title: "Chuông cổng"
      message: "Có người bấm chuông"
      camera: camera.chuong_cua
      duration: 30
      priority: urgent
```

Sáng mở dashboard, tối về màn hình chính:

```yaml
action:
  - action: dashboard_os.open_url
    target: { device_id: <id màn hình> }
    data: { url: "http://192.168.10.2:8123/dashboard-mobile/3" }
  - action: dashboard_os.set_brightness
    target: { device_id: <id màn hình> }
    data: { brightness: 70 }
```

Đọc thông báo bằng giọng nói trên màn có loa:

```yaml
action:
  - action: dashboard_os.say
    target: { device_id: <id màn hình> }
    data: { message: "Đã bật máy lạnh" }
```

Chụp màn hình và gửi Telegram:

```yaml
action:
  - action: dashboard_os.screenshot
    target: { device_id: <id màn hình> }
    data: { filename: hien-tai }
    response_variable: shot
  - action: notify.telegram
    data:
      message: "Màn hình"
      data: { photo: "{{ shot.screenshots[0].path }}" }
```

Blueprint sẵn có (thông báo, nhắc lịch, chào buổi sáng, camera, chuông cổng, cảnh báo an ninh):
xem `examples/home-assistant/` trong repo Client.

### Mức ưu tiên thông báo

| Mức | Hành vi |
|---|---|
| `urgent` (mặc định) | Mở khoá, bật đèn nền, phủ toàn màn hình |
| `critical` | Như urgent, xuyên cả chế độ Không làm phiền |
| `high` | Phủ toàn màn, tôn trọng Không làm phiền |
| `normal` | Chỉ hiện thẻ thông báo |

## 5. Vận hành

| Việc | Ở đâu |
|---|---|
| Xem/sửa từng màn | Sidebar → **Dashboard** → **Màn hình** |
| Đổi Wi-Fi, độ sáng, chất lượng | Trên màn hình (Cài đặt) hoặc trang Dashboard |
| Sao lưu | Sao lưu add-on trong HA (đã loại bộ đệm Chrome cho nhẹ) |
| Nhật ký | Settings → Add-ons → Dashboard OS Server → Log |

**Cổng:** `18080` (web + điều khiển), `8081` (màn hình kết nối). Chỉ dùng trong LAN/Tailscale.

## 6. Xử lý sự cố

| Hiện tượng | Cách xử lý |
|---|---|
| Màn hình không hiện trong danh sách | Kiểm tra cùng mạng Wi-Fi, đã nhập đúng IP máy HA; khởi động lại màn |
| Hình giật / mờ | Giảm **Chất lượng hình** hoặc bật nửa phân giải cho video |
| Màn hình đen sau khi cập nhật | Khởi động lại add-on; kiểm tra log |
| Không điều khiển được từ điện thoại | Mở trang bằng IP LAN (`http://<ip-ha>:18080`), không qua tên miền |

## 7. Giấy phép & ghi công

Apache-2.0 — xem [LICENSE](LICENSE) và [NOTICE](NOTICE). Biểu tượng MDI (Pictogrammers), phông Bebas Neue
(OFL) — chi tiết ở [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). Nhãn hiệu: [TRADEMARKS.md](TRADEMARKS.md).

Tài liệu chi tiết (kiến trúc, giao thức, phát triển): thư mục [`docs/`](docs/).

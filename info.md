# Dashboard OS

Biến màn hình **ESP32-S3 / ESP32-P4** thành bảng điều khiển Home Assistant: chiếu dashboard hoặc bất kỳ trang web,
kèm giao diện kiểu điện thoại (màn hình chính, ứng dụng, thông báo, chuông cửa, báo thức, IPTV…).

> Cần add-on **Dashboard OS Server** đã cài và đang chạy trong Home Assistant.

## Tính năng

- **Chiếu dashboard HA** hoặc URL bất kỳ, nhiều tab mỗi màn, chuyển tab tức thì; màn hình chờ (đồng hồ, lịch âm,
  thời tiết, ảnh gia đình); xoay 0/90/180/270.
- **Thông báo toàn màn hình** kèm ảnh / video / âm thanh / camera, 4 mức ưu tiên (`urgent`, `critical`, `high`, `normal`).
- **Chuông cửa**: đổ chuông mọi màn, nói chuyện 2 chiều, mở cổng, nhật ký 30 ngày.
- **Báo thức**: lặp theo thứ, báo lại, chọn màn reo — lưu ở server nên màn tắt vẫn reo.
- **Đọc TTS** trên loa của màn, phát kênh IPTV, mở app/URL, chụp màn hình.

## 30 hành động

| Nhóm | Hành động |
|---|---|
| Thông báo | `send` |
| Điều hướng | `open_app`, `open_url`, `nav`, `wake`, `lock`, `reload`, `close_app`, `screenshot` |
| Hiển thị & âm thanh | `set_brightness`, `set_volume`, `set_quality`, `set_rotation`, `set_dnd`, `set_no_sleep`, `set_screensaver`, `set_setting`, `say` |
| Báo thức | `alarm_create`, `alarm_list`, `alarm_delete`, `alarm_set_enabled`, `alarm_stop`, `alarm_snooze` |
| Nâng cao | `list_screens`, `get_status`, `cast_iptv`, `touch`, `swipe`, `send_command` |

Mọi hành động có trường **Thiết bị** (chọn 1 hoặc nhiều màn; bỏ trống = mọi màn đang kết nối).

## Entity trên mỗi màn hình

| Loại | Entity |
|---|---|
| Cảm biến | `ket_noi`, `ung_dung_dang_mo`, `trang_thai_man_hinh` |
| Nút bấm | `man_hinh_chinh`, `quay_lai`, `gan_day`, `danh_thuc`, `tai_lai_trang`, `chup_man_hinh` |
| Công tắc | `man_hinh_cho`, `khong_lam_phien`, `khong_cho_man_ngu` |
| Thanh trượt | `do_sang`, `am_luong`, `chat_luong_hinh` |
| Chọn | `goc_xoay` (0/90/180/270) |

## Cài đặt

1. HACS → **Integrations** → ⋮ → **Custom repositories** → dán repo này, chọn *Integration* → **Add**.
2. Tìm **Dashboard OS** → **Download** → **Restart Home Assistant**.
3. **Settings → Devices & Services → + Add Integration → Dashboard OS** → giữ địa chỉ mặc định → **Submit**.

Mỗi màn hình tự xuất hiện thành một thiết bị, cập nhật 30 giây/lần. Tuỳ chọn (**Configure**) cho phép đổi chu kỳ
cập nhật và tắt nhóm entity điều khiển.

## Ví dụ automation

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

```yaml
action:
  - action: dashboard_os.say
    target: { device_id: <id màn hình> }
    data: { message: "Đã bật máy lạnh" }
```

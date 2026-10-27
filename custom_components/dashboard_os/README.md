# Dashboard OS — tích hợp Home Assistant

Gửi thông báo **ưu tiên cao** tới các màn hình ESP32 chạy Dashboard OS: mở khoá, bật đèn nền,
hiển thị phủ toàn màn hình trên ứng dụng đang chạy, kèm ảnh / video / âm thanh.

## Yêu cầu

- Add-on **Dashboard OS Server ≥ 2.9.191** (cài từ kho add-on của bạn)
- Home Assistant (đã thử với 2026.10)

## Cài đặt

1. Chép thư mục `dashboard_os` vào `/config/custom_components/` của Home Assistant.
2. Khởi động lại Home Assistant.
3. **Settings → Devices & Services → + Add Integration** → tìm **Dashboard OS**.
4. Giữ địa chỉ mặc định `http://172.30.32.1:18080` (đúng với Home Assistant OS) → **Submit**.

## Hành động `dashboard_os.send`

| Trường | Kiểu | Mô tả |
|---|---|---|
| `message` | text (bắt buộc) | Nội dung thông báo |
| `title` | text | Tiêu đề |
| `duration` | số 0–600, mặc định 10 | Số giây hiển thị toàn màn hình. **0 = không tự thoát**, chạm màn hình để đóng |
| `device` | chọn nhiều thiết bị | Màn hình nhận thông báo. Bỏ trống = mọi màn hình |
| `image` | media / URL / đường dẫn | Ảnh đính kèm |
| `video` | media / URL / đường dẫn | Video |
| `audio` | media / URL / đường dẫn | Âm thanh |
| `camera` | chọn thực thể camera | Chụp ảnh từ camera có trong Home Assistant |
| `camera_stream` | text | Tên luồng go2rtc nếu camera không có thực thể (ví dụ `chuong_cua`), ưu tiên hơn `camera` |

Mức ưu tiên luôn là **urgent** — không cần chọn.

### Ví dụ

```yaml
action:
  - action: dashboard_os.send
    data:
      message: "Cửa chính vừa mở lúc 22:15"
      title: "Cảnh báo"
      duration: 10
      device:
        - 7.0 Guition JC1060P470C
      camera: camera.chuong_cua
```

Thông báo không tự thoát (phải chạm để đóng):

```yaml
action:
  - action: dashboard_os.send
    data:
      message: "Có khách ở cổng"
      duration: 0
```

## Thiết bị tự động

Tích hợp hỏi add-on mỗi **30 giây** (`GET /devices`) danh sách màn hình đang kết nối và
tạo/xoá thiết bị Home Assistant tương ứng:

- Thêm màn hình vào add-on → dropdown tự có sau ≤ 30 giây
- Màn hình mất kết nối khỏi add-on → thiết bị Home Assistant tương ứng bị xoá
- Chuông cổng không nằm trong danh sách (add-on trả `config: null` cho nó)

## Media

- Chọn từ **thư viện media** của Home Assistant: component tự tải file, đẩy lên add-on
  (`POST /notify/upload`) rồi gắn URL vào thông báo.
- Có thể dán URL `http(s)` hoặc đường dẫn file trong `/config`.

## Logo

`brand/icon.png` và `brand/logo.png` — hiển thị ở trang Integrations.

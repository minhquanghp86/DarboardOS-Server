# Dashboard OS — tích hợp Home Assistant

Điều khiển các màn hình ESP32 chạy **Dashboard OS** từ Home Assistant: gửi thông báo ưu tiên cao, mở ứng dụng/URL,
điều hướng, chỉnh độ sáng/âm lượng/chất lượng hình, đọc TTS, chụp màn hình.

- Yêu cầu: add-on **Dashboard OS Server ≥ 2.9.261** (khuyến nghị ≥ 2.9.268)
- Đã thử với Home Assistant 2026.10

## Cài đặt

1. Chép thư mục `dashboard_os` vào `/config/custom_components/`.
2. Khởi động lại Home Assistant.
3. **Settings → Devices & Services → + Add Integration** → **Dashboard OS**.
4. Giữ địa chỉ mặc định `http://172.30.32.1:18080` (đúng với HA OS) → **Submit**.

Mỗi màn hình trong add-on tự xuất hiện thành **một thiết bị** trong Home Assistant (cập nhật 30 giây/lần).

## Cách chọn màn hình

Mọi hành động đều có trường **`device`** — cùng kiểu chọn với `dashboard_os.send`: bấm vào là hiện danh sách
**4 màn hình của tích hợp Dashboard OS** để chọn (chọn được nhiều màn). Bỏ trống = mọi màn đang kết nối.

```yaml
action:
  - action: dashboard_os.set_brightness
    data:
      device:
        - 4.3 Guition JC4827w543 9b2260     # chọn trong UI, hoặc gõ id esp32-…
      brightness: 70
```

> Trong YAML bạn cũng có thể dùng `target: {device_id: …}` như mọi hành động khác của HA — cả hai đều chạy.

## Entities (mỗi màn hình một thiết bị)

Mỗi màn có sẵn các entity để dùng trực tiếp trong dashboard/automation:

| Entity | Việc |
|---|---|
| `binary_sensor.<màn>_ket_noi` | Đang kết nối add-on hay không |
| `sensor.<màn>_ung_dung_dang_mo` | Ứng dụng đang mở |
| `sensor.<màn>_trang_thai_man_hinh` | `đang dùng` / `màn hình chờ` / `khoá` / `không làm phiền` / `offline` (kèm độ sáng, âm lượng, DND…) |
| `button.<màn>_man_hinh_chinh` · `_quay_lai` · `_gan_day` · `_danh_thuc` · `_tai_lai_trang` · `_chup_man_hinh` | Nút bấm nhanh |

## Danh sách hành động (24)

### Thông báo
| Hành động | Trường |
|---|---|
| `dashboard_os.send` | `message`*, `title`, `duration` (0-600 s), `image`, `video`, `audio`, `camera`, `camera_stream` |

### Điều hướng và hiển thị
| Hành động | Trường | Việc |
|---|---|---|
| `dashboard_os.open_app` | `app`* | Mở ứng dụng theo id (vd `youtube`, `settings`) |
| `dashboard_os.open_url` | `url`* | Mở trang web |
| `dashboard_os.nav` | `key`* = `home` / `back` / `recents` / `unlock` | Phím điều hướng |
| `dashboard_os.wake` | — | Bật đèn nền |
| `dashboard_os.lock` | — | Hiện màn hình khoá |
| `dashboard_os.reload` | — | Tải lại trang hiện tại |
| `dashboard_os.close_app` | `app`* | Đóng ứng dụng |
| `dashboard_os.screenshot` | `filename` | Lưu ảnh vào `/config/www/dashboard/`, **trả** `{device,path,url}` |

### Hiển thị, âm thanh, cài đặt
| Hành động | Trường | Việc |
|---|---|---|
| `dashboard_os.set_brightness` | `brightness`* 0-100 | Độ sáng đèn nền |
| `dashboard_os.set_volume` | `volume`* 0-100, `mute` | Âm lượng (màn có loa) |
| `dashboard_os.set_quality` | `quality`* 0-90 (0 = tự động) | Chất lượng JPEG gửi xuống màn |
| `dashboard_os.set_rotation` | `rotation`* = 0/90/180/270 | Góc xoay giao diện |
| `dashboard_os.set_dnd` | `enabled`* | Không làm phiền |
| `dashboard_os.set_no_sleep` | `enabled`* | Giữ màn luôn sáng |
| `dashboard_os.set_screensaver` | `enabled`* | Màn hình chờ (bật = hiện, tắt = đánh thức) |
| `dashboard_os.set_setting` | `setting`* (`rwv.*` hoặc entity_id), `value`* | Đổi cài đặt bất kỳ |
| `dashboard_os.say` | `message`* | Đọc TTS trên loa của màn |

### Báo thức
| Hành động | Trường | Việc |
|---|---|---|
| `dashboard_os.alarm_create` | `time`*, `days`, `label`, `snooze`, `enabled` | Tạo báo thức cho màn chọn (bỏ trống target = mọi màn), **trả** báo thức vừa tạo |
| `dashboard_os.alarm_list` | — | **Trả** danh sách báo thức + giờ reo kế tiếp |
| `dashboard_os.alarm_delete` | `alarm_id` **hoặc** `time` + `label` | Xoá báo thức, trả danh sách id đã xoá |
| `dashboard_os.alarm_set_enabled` | `alarm_id`*, `enabled`* | Bật/tắt |
| `dashboard_os.alarm_stop` | `alarm_id`* | Tắt chuông đang reo |
| `dashboard_os.alarm_snooze` | `alarm_id`* | Báo lại theo số phút đã đặt |

`days`: 0 = Chủ nhật … 6 = Thứ bảy; bỏ trống = báo một lần.

\* = bắt buộc

## Ví dụ

Thông báo chuông cổng:

```yaml
action:
  - action: dashboard_os.send
    data:
      message: "Có khách ở cổng"
      title: "Chuông cổng"
      duration: 10
      camera: camera.chuong_cua
```

Sáng mở dashboard, tối về màn hình chính:

```yaml
action:
  - action: dashboard_os.open_url
    target: { device_id: bec48a5c7ee6e67f028a4fb37e2af01e }
    data: { url: "http://192.168.10.2:8123/dashboard-mobile/3" }
  - action: dashboard_os.set_brightness
    target: { device_id: bec48a5c7ee6e67f028a4fb37e2af01e }
    data: { brightness: 70 }
```

Chụp màn hình rồi gửi Telegram:

```yaml
action:
  - action: dashboard_os.screenshot
    target: { device_id: 1196b7c26248724af14af1bfc44fab76 }
    data: { filename: p4-hien-tai }
    response_variable: shot
  - action: notify.telegram
    data:
      message: "Màn P4"
      data: { photo: "{{ shot.screenshots[0].path }}" }
```

Đặt báo thức 06:30 hằng ngày cho màn 480×272:

```yaml
action:
  - action: dashboard_os.alarm_create
    target: { device_id: bec48a5c7ee6e67f028a4fb37e2af01e }
    data:
      time: "06:30"
      days: [1, 2, 3, 4, 5]
      label: "Dậy đi học"
      snooze: 10
    response_variable: tao
```

Đọc thông báo bằng giọng nói:

```yaml
action:
  - action: dashboard_os.say
    target: { device_id: 1196b7c26248724af14af1bfc44fab76 }
    data: { message: "Đã bật máy lạnh" }
```

## Ghi chú

- `say` và `set_volume` chỉ chạy trên màn **có loa** (P4). Màn không loa báo lỗi rõ ràng.
- `screenshot` lưu ảnh vào `/config/www/dashboard/` → truy cập qua `/local/dashboard/<tên>.jpg`.
- Mọi hành động trả lỗi tiếng Việt kèm lý do từ add-on (kết nối, màn offline, màn không có loa…).

## Lịch sử

- **1.6.0** (27/10/2026): trường chọn `device` cho mọi hành động (giống `send`); thêm entity mỗi màn: kết nối, ứng dụng đang mở, trạng thái + 6 nút bấm.
- **1.5.0** (27/10/2026): 6 hành động báo thức (GĐ 3), test thật 7/7.
- **1.4.0** (27/10/2026): 17 hành động mới (GĐ 1+2), tách `api.py` dùng chung; đổi tên hiển thị sang **Dashboard OS**.
- **1.2.0**: `send` + entity notify.

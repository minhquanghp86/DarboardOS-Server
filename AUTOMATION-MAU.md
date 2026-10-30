# Automation mẫu cho Dashboard OS

10 kịch bản thực tế, copy vào **Settings → Automations → + Create → Edit in YAML** (hoặc dùng Developer Tools → Actions
để chạy thử trước).

Thay `<ID_MAN>` bằng `device_id` của màn hình (xem trong **Settings → Devices & Services → Dashboard OS → thiết bị**),
hoặc bỏ `target` để áp cho **mọi màn**.

---

## 1. Báo có khách trước cửa

```yaml
triggers:
  - trigger: state
    entity_id: binary_sensor.cong_truoc_occupancy
    to: "on"
actions:
  - action: dashboard_os.send
    data:
      title: "Có người trước cửa"
      message: "Camera cổng vừa phát hiện chuyển động"
      camera: camera.cong_truoc
      duration: 20
      priority: urgent
```

## 2. Chuông cổng — hiện hình + đọc loa

```yaml
triggers:
  - trigger: event
    event_type: dashboard_cong_cua   # hoặc dùng blueprint "Chuông cổng báo cả nhà"
actions:
  - action: dashboard_os.send
    data:
      title: "Chuông cổng"
      message: "Có người bấm chuông"
      camera: camera.chuong_cua
      duration: 30
      priority: critical
  - action: dashboard_os.say
    target: { device_id: <ID_MAN> }
    data: { message: "Có khách ở cổng" }
```

## 3. Chào buổi sáng — bật sáng, mở dashboard, đọc thời tiết

```yaml
triggers:
  - trigger: time
    at: "06:00"
conditions:
  - condition: state
    entity_id: binary_sensor.co_nguoi_trong_nha
    state: "on"
actions:
  - action: dashboard_os.set_brightness
    target: { device_id: <ID_MAN> }
    data: { brightness: 75 }
  - action: dashboard_os.open_url
    target: { device_id: <ID_MAN> }
    data: { url: "http://192.168.10.2:8123/dashboard-mobile/3" }
  - action: dashboard_os.say
    target: { device_id: <ID_MAN> }
    data: { message: "Chào buổi sáng. Hôm nay trời mưa rào về chiều." }
```

## 4. Ngủ — giảm sáng, khoá màn

```yaml
triggers:
  - trigger: time
    at: "22:30"
actions:
  - action: dashboard_os.set_brightness
    target: { device_id: <ID_MAN> }
    data: { brightness: 10 }
  - action: dashboard_os.lock
    target: { device_id: <ID_MAN> }
```

## 5. Báo động an ninh — phủ toàn màn, bật sáng, xuyên chế độ im lặng

```yaml
triggers:
  - trigger: state
    entity_id: alarm_control_panel.nha
    to: "triggered"
actions:
  - action: dashboard_os.set_brightness
    target: { device_id: <ID_MAN> }
    data: { brightness: 100 }
  - action: dashboard_os.send
    data:
      title: "BÁO ĐỘNG"
      message: "Cửa chính vừa mở khi hệ thống đang canh gác"
      priority: critical
      duration: 0          # phải chạm mới tắt
```

## 6. Nhắc uống thuốc hằng ngày

```yaml
triggers:
  - trigger: time
    at: "20:00"
actions:
  - action: dashboard_os.send
    data:
      title: "Uống thuốc"
      message: "Đã đến giờ uống thuốc buổi tối"
      priority: high
      duration: 15
```

## 7. Có người bấm chuông mà không ai mở — gửi Telegram kèm ảnh màn hình

```yaml
triggers:
  - trigger: state
    entity_id: binary_sensor.chuong_cong_missed
    to: "on"
actions:
  - action: dashboard_os.screenshot
    target: { device_id: <ID_MAN> }
    data: { filename: chuong-cong }
    response_variable: shot
  - action: notify.telegram
    data:
      message: "Chuông cổng bị bỏ lỡ"
      data: { photo: "{{ shot.screenshots[0].path }}" }
```

## 8. Mưa sắp tới — nhắc đóng cửa sổ

```yaml
triggers:
  - trigger: state
    entity_id: sensor.mua_1h_toi
    above: 5
actions:
  - action: dashboard_os.send
    data:
      title: "Sắp mưa"
      message: "Dự báo có mưa trong 1 giờ tới, nhớ đóng cửa sổ"
      priority: high
      duration: 20
```

## 9. Đặt báo thức cho màn phòng ngủ từ điện thoại

```yaml
actions:
  - action: dashboard_os.alarm_create
    target: { device_id: <ID_MAN_PHONG_NGU> }
    data:
      time: "06:15"
      days: [1, 2, 3, 4, 5]
      label: "Đi làm"
      snooze: 10
```

Xoá lại khi đổi lịch:

```yaml
actions:
  - action: dashboard_os.alarm_delete
    data: { time: "06:15", label: "Đi làm" }
```

## 10. Buổi tối chuyển màn sang chế độ ảnh gia đình

```yaml
triggers:
  - trigger: sun
    event: sunset
    offset: "-00:30"
actions:
  - action: dashboard_os.set_setting
    target: { device_id: <ID_MAN> }
    data: { setting: "rwv.photo_effect", value: "ken" }
  - action: dashboard_os.set_setting
    target: { device_id: <ID_MAN> }
    data: { setting: "rwv.photo_interval", value: 15 }
  - action: dashboard_os.set_screensaver
    target: { device_id: <ID_MAN> }
    data: { enabled: true }
```

---

## Mẹo

- **Chạy thử trước**: Developer Tools → Actions → chọn `dashboard_os.send` → điền dữ liệu → **Perform action**.
- **Nhiều màn cùng lúc**: bỏ `target` (mọi màn) hoặc chọn nhiều thiết bị trong UI.
- **Tránh gửi trùng**: đặt `condition` cho cảm biến, hoặc dùng `trigger: state` với `for: "00:00:05"`.
- **Màn đang khoá**: thông báo `urgent`/`critical` sẽ tự đánh thức; loại khác chỉ hiện thẻ thông báo.

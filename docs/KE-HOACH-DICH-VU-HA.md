# Kế hoạch: mở rộng tích hợp Home Assistant cho Dashboard OS (27/10/2026)

> **TRẠNG THÁI:** GĐ 1 + 2 + 3 **ĐÃ XONG** (component 1.5.0, **24 hành động**, test thật 15/15 + 7/7 đạt).
> GĐ 4 → 5 còn lại. Chi tiết từng hành động: `custom_components/dashboard_os/README.md`.


## 1. Hiện trạng (đã đọc toàn bộ `custom_components/dashboard_os/`)

| Thành phần | Nội dung |
|---|---|
| `manifest.json` | domain **`dashboard_os`** (không phải `dashboard_os`), version 1.2.0, `config_flow`, `iot_class: local_push` |
| `config_flow.py` | nhập địa chỉ add-on, mặc định `http://172.30.32.1:18080` |
| `__init__.py` | `DataUpdateCoordinator` gọi `GET /devices` (fallback `/metrics`) mỗi **30 s**, đồng bộ device registry (mỗi màn = 1 thiết bị HA) |
| `notify.py` | **`dashboard_os.send`** + entity `notify.dashboard_os` |
| `services.yaml` | chỉ mô tả `send` (message, title, duration, device, image, video, audio, camera, camera_stream) |
| Platforms | chỉ `Platform.NOTIFY` |

**Kết luận: đúng, hiện chỉ có 1 hành động `dashboard_os.send`.** Không có sensor/button/switch, không có sự kiện,
không có service trả dữ liệu (response).

## 2. Server đã có gì (để HA gọi) — khoảng trống rất lớn

| Nhóm | Endpoint / khả năng hiện có |
|---|---|
| Trạng thái | `GET /devices`, `GET /metrics`, `GET /screens/list`, `GET /screens/info`, `GET /screens/dbg`, `GET /screens/shot` (ảnh JPEG) |
| Điều khiển màn | `POST /screens/act`: `b` (độ sáng), `v` (âm lượng), `mu` (mute), `ns` (no-sleep), `aec`, `wake`, `saver`/`lock`, `app`, `tab`, `close`, `reload`, `url`, `media` (play/pause/next/prev/±10 s), `snd`, `dnd`, `ntClear/ntDel/ntSeen`, `notify`, **`say`** (đọc TTS trên panel) |
| Cảm ứng/điều hướng | `POST /control/input` (chạm), `/control/gesture` (vuốt), `/control/key` (home / back / recents / unlock) |
| Cài đặt | `GET/POST /screens/settings`, `POST /screens/set` — 32 khoá `rwv.*` (chất lượng, xoay, khoá, screensaver, ảnh nền, chất lượng hình, bỏ quảng cáo, …) + mọi thực thể HA của panel |
| Báo thức | `/alarm/list`, `/alarm/save`, `/alarm/del`, `/alarm/toggle`, `/alarm/stop`, `/alarm/snooze` |
| Media | `/iptv/*` (cast kênh, điều khiển, danh sách), `/notify/upload` (ảnh/video/âm thanh), `/calls/*` (gọi video), `/doorbell/*`, `/board/*` (bảng tin), `/chat/*` |
| Khác | `/states` (trạng thái shell), `/ha/today`, `/weather-location` |

## 3. Đề xuất bộ dịch vụ (chia 5 giai đoạn)

Quy ước chung cho **mọi** dịch vụ mới:
- Dùng `target: {device: …}` chuẩn HA (chọn nhiều màn), đồng thời vẫn nhận `device` dạng id `esp32-…`;
  bỏ trống = mọi màn.
- Trả lỗi rõ ràng (`HomeAssistantError`) khi add-on không phản hồi/màn offline.
- Dịch vụ tra cứu bật `supports_response` để dùng được trong template/automation.
- Giữ nguyên `dashboard_os.send` (không phá automation cũ).

### GĐ 1 — Điều hướng & hiển thị (giá trị cao nhất, ít rủi ro)
| Dịch vụ | Trường | Map tới server |
|---|---|---|
| `dashboard_os.open_app` | `app` (select động: id ứng dụng của màn), `target` | `act: app` |
| `dashboard_os.open_url` | `url`, `target` | `act: url` |
| `dashboard_os.nav` | `key`: `home` / `back` / `recents` / `unlock` | `/control/key` |
| `dashboard_os.wake` | `target` | `act: wake` |
| `dashboard_os.lock` | `target` | `act: lock` |
| `dashboard_os.reload` | `target` | `act: reload` |
| `dashboard_os.close_app` | `app`, `target` | `act: close` |
| `dashboard_os.screenshot` | `target`, `filename?` → lưu `/config/www/dashboard/…`, trả `{path,url}` | `/screens/shot` |

```yaml
action:
  - action: dashboard_os.open_url
    target:
      device_id: 1f2c…            # màn 480×272
    data:
      url: http://192.168.10.2:8123/dashboard-mobile/3
```

### GĐ 2 — Hiển thị, âm thanh, cài đặt
| Dịch vụ | Trường | Ghi chú |
|---|---|---|
| `dashboard_os.set_brightness` | `brightness` 0–100 | `act: b` |
| `dashboard_os.set_volume` | `volume` 0–100, `mute?` | `act: v` / `mu` |
| `dashboard_os.set_quality` | `quality` 0–100 (0 = tự động) | `set rwv.quality` — đúng cơ chế vừa sửa hôm nay |
| `dashboard_os.set_rotation` | `rotation` 0/90/180/270 | `set Xoay màn hình` |
| `dashboard_os.set_dnd` | `enabled` | `act: dnd` |
| `dashboard_os.set_setting` | `setting` (select 32 khoá `rwv.*`), `value` | escape hatch nhưng có kiểm tra |
| `dashboard_os.say` | `message`, `target` | `act: say` (TTS có sẵn trên panel) |
| `dashboard_os.play_media` | `url`/`media`, `kind` | tải lên `/notify/upload` rồi phát |

### GĐ 3 — Báo thức (mới làm hôm nay, nay đưa lên HA)
| Dịch vụ | Trường |
|---|---|
| `dashboard_os.alarm_create` | `time` (HH:MM), `days?`, `label?`, `snooze?`, `target` |
| `dashboard_os.alarm_delete` | `alarm_id` **hoặc** `time` + `label` |
| `dashboard_os.alarm_set_enabled` | `alarm_id`, `enabled` |
| `dashboard_os.alarm_stop` / `dashboard_os.alarm_snooze` | `alarm_id` |

### GĐ 4 — Nâng cao
| Dịch vụ | Trường |
|---|---|
| `dashboard_os.list_screens` *(response)* | trả `[{id,name,online,ip,app,url,fps,heap,…}]` |
| `dashboard_os.get_status` *(response)* | `target` → trạng thái chi tiết 1 màn |
| `dashboard_os.cast_iptv` | `channel`/`url`, `target` |
| `dashboard_os.touch` / `dashboard_os.swipe` | toạ độ (điều khiển từ xa, dùng cho test/automation) |
| `dashboard_os.send_command` | `action` + `data` (JSON) — gọi thẳng `/screens/act` cho tương lai |

### GĐ 5 — Entities & sự kiện (để dùng tự nhiên trong HA)
- **Sensors**: `online`, `app hiện tại`, `url`, `fps`, `heap free`, `wifi`, `nhiệt độ` (nếu có).
- **Buttons**: Home / Back / Gần đây / Đánh thức / Tải lại / Chụp màn hình.
- **Switches**: Màn hình bật-tắt (no-sleep), DND, Screensaver.
- **Numbers**: Độ sáng, Âm lượng, Chất lượng hình.
- **Select**: Ứng dụng hiện tại, Góc xoay.
- **Events**: `dashboard_os_doorbell`, `dashboard_os_alarm`, `dashboard_os_call`, `dashboard_os_notification_tapped`
  → dùng làm trigger automation (`trigger: platform: event`).
- `notify.dashboard_os`: thêm `priority` (normal/high/critical) + nút hành động.

## 4. Kiến trúc kỹ thuật đề xuất

```
custom_components/dashboard_os/
  api.py          # DashboardApi: 1 nơi duy nhất gọi HTTP (timeout, lỗi, retry nhẹ, map device_id → esp32-…)
  services.py     # đăng ký toàn bộ dịch vụ + schema (selectors) + supports_response
  const.py        # SERVICE_*, ATTR_*, DOMAIN
  coordinator.py  # (tách khỏi __init__.py) poll /devices + /metrics, giữ snapshot cho entity/response
  sensor.py button.py switch.py number.py select.py   # GĐ 5
  events.py       # nhận webhook/sự kiện từ add-on (doorbell, alarm)
  services.yaml   # mô tả đầy đủ cho UI + automations
  translations/{en,vi}.json
```

- `_resolve_device()` hiện nằm trong `notify.py` → chuyển sang `api.py`, dùng chung.
- Response services: `SupportsResponse.ONLY/OPTIONAL` (HA ≥ 2023.7) → trả dict, dùng được trong template.
- Ảnh chụp: lưu `/config/www/dashboard/<dev>-<time>.jpg` rồi trả URL (`/local/dashboard/…`) thay vì base64
  (nhẹ cho automation, xem được trên dashboard).
- Thêm **options flow**: chu kỳ poll, có bật entity hay không, tiền tố tên thiết bị.

## 5. Lộ trình & tiêu chí nghiệm thu

| GĐ | Nội dung | Ước lượng | Nghiệm thu |
|---|---|---|---|
| 1 | Điều hướng/hiển thị (8 dịch vụ) + `api.py` | 1 buổi | Gọi từ Developer Tools → màn phản ứng < 1 s; automation `open_url` chạy đúng màn chọn |
| 2 | Hiển thị/âm thanh/cài đặt (8 dịch vụ) | 1 buổi | Đổi độ sáng/âm lượng thấy ngay; `set_quality=40` thì `recentFrameBytes` giảm (kiểm bằng `/metrics`) |
| 3 | Báo thức (5 dịch vụ) | nửa buổi | Tạo/xoá từ HA thấy trong app Báo thức trên panel; giờ reo đúng |
| 4 | Response + nâng cao (5 dịch vụ) | 1 buổi | `list_screens` trả đủ 4 màn; `screenshot` trả URL mở được |
| 5 | Entities + events | 2 buổi | 4 màn hiện đủ sensor/button; chuông cổng bắn event và automation bắt được |

Tổng: **~5 buổi làm việc**, mỗi giai đoạn tự đứng được (không phá gì nếu dừng giữa đường).

## 6. Rủi ro & quyết định cần bạn chốt

1. **Tên miền dịch vụ**: component dùng `dashboard_os` (đúng như code), bạn gọi là `dashboard_os`.
   - (a) Giữ `dashboard_os.*` — không phá gì (khuyến nghị).
   - (b) Đổi domain sang `dashboard_os` — phải tạo lại integration, hỏng automation cũ.
   - (c) Giữ `dashboard_os` + đăng ký **alias** `dashboard_os.send` cho quen tay.
2. **Bảo mật**: các endpoint điều khiển chỉ cho LAN/ingress. Component gọi từ `172.30.32.x` → đã được phép.
   Nếu add-on chạy ngoài HA OS, cần thêm IP vào danh sách.
3. **Entity có làm phiền không**: 4 màn × ~10 entity = 40 entity. Có thể để mặc định **chỉ bật sensor quan trọng**
   (online, app, fps) và ẩn phần còn lại (`entity_registry_enabled_default=False`).
4. **`send` hiện tại**: giữ nguyên hành vi (ưu tiên urgent). Có muốn thêm `priority` (normal/high/critical) không?

## 7. Đề nghị của mình
Làm **GĐ 1 + 2** trước (16 dịch vụ, phủ 90% nhu cầu automation: mở app/URL, điều hướng, sáng/tối, âm lượng,
chất lượng, TTS), rồi **GĐ 3** (báo thức) vì vừa làm xong phần server, rồi mới tới GĐ 4-5.
Giữ tên `dashboard_os`, thêm alias `dashboard_os` cho quen tay.

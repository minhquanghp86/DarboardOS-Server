# Remote WebView Server — biến màn hình ESP32 thành bảng điều khiển gắn tường

## Đây là gì?

Addon này chạy **một trình duyệt Chrome ẩn** ngay trên máy Home Assistant. Trình duyệt mở trang bạn muốn (dashboard
Home Assistant, YouTube, camera, trang web bất kỳ…), chụp hình liên tục, chia thành các ô ảnh JPEG nhỏ rồi gửi qua WiFi
tới **màn hình cảm ứng ESP32** (ESP32-P4 hoặc ESP32-S3) chạy firmware ESPHome. Chạm lên màn hình thì thao tác được truyền
ngược lại trình duyệt — như đang dùng một chiếc máy tính bảng, nhưng phần nặng (dựng trang web) nằm trên máy chủ.

Dự án gồm hai phần, dùng cùng nhau:

| Phần | Chạy ở đâu | Repo |
|---|---|---|
| **Máy chủ** (addon này) | Máy Home Assistant | [HA-Darboard-Server](https://github.com/minhquanghp86/HA-Darboard-Server) |
| **Firmware màn hình** (component ESPHome `remote_webview` + cấu hình mẫu) | Màn hình ESP32 | [HA-Darboard-Client](https://github.com/minhquanghp86/HA-Darboard-Client) |

## Để làm gì?

- **Dashboard Home Assistant trên tường**, đầy đủ như trên điện thoại (card, biểu đồ, camera…), không cần máy tính bảng.
- **Xem video có tiếng**: YouTube đủ độ phân giải trên ESP32-P4 (~28 hình/giây đo thực tế), âm thanh phát ra loa của
  màn hình.
- **Giao diện kiểu điện thoại**: vuốt từ mép trên xuống mở thanh trạng thái (độ sáng/âm lượng, bật/tắt nhanh, thời
  tiết, lịch âm); vuốt lên từ mép dưới về màn hình chính với các ứng dụng (camera, radio, hẹn giờ, cảnh HA…).
- **Camera trên màn hình** (ESP32-P4 có camera): gửi hình 1080p vào Frigate để nhận diện người / ghi hình.
- **Loa thông báo**: màn hình có loa là một `media_player` trong HA — dùng cho TTS, thông báo.

## Cách hoạt động

```
 ┌───────────── Máy Home Assistant (x86-64) ─────────────┐          ┌──── Màn hình ESP32 ────┐
 │  Addon Remote WebView Server                           │  WiFi    │  ESPHome +             │
 │   Chrome ẩn ──► chụp khung ──► chia ô JPEG ──► WS :8081 ├─────────►│  remote_webview        │
 │        ▲                                              │  ảnh+tiếng│   giải mã, vẽ, phát loa │
 │        └───────── chạm / bấm / trạng thái ◄───────────┤◄─────────┤   gửi cảm ứng, giờ,     │
 │   Trang ứng dụng + Menu panel ── cổng :18080 (LAN)     │          │   độ sáng, âm lượng     │
 └────────────────────────────────────────────────────────┘          └─────────────────────────┘
```

- Chỉ phần **thay đổi** của trang được gửi (so khớp từng ô); trang đứng yên gần như không tốn băng thông.
- Server **tự điều tiết** tốc độ khung và chất lượng JPEG theo khả năng từng màn hình và tình trạng mạng.
- Âm thanh trang web (YouTube, radio…) được bắt ở máy chủ và gửi dạng PCM về đúng màn hình có khai báo loa.

## Cần những gì

**Máy chủ**
- Home Assistant OS hoặc Supervised trên máy **x86-64 (amd64)**. *Không chạy trên Raspberry Pi / ARM* — image dùng
  Google Chrome để giải mã video H.264, mà Chrome cho Linux chỉ có bản amd64.
- RAM và CPU: đo thực tế với 3 màn hình (một màn hình đang phát video) trên Intel i5-8500T 6 nhân, addon dùng
  ~1,1 GB RAM và khoảng 3 nhân CPU. Nên dành ≥ 2 GB RAM trống; CPU 4 nhân trở lên nếu xem video.
- Addon **ESPHome** để biên dịch và nạp firmware cho màn hình.

**Màn hình** (đã chạy thực tế)

| Thiết bị | Chip | Màn hình | Ghi chú |
|---|---|---|---|
| Guition JC1060P470C | ESP32-P4 + C6 (WiFi) | 7" 1024×600 MIPI-DSI | Giải mã JPEG phần cứng, loa, micro, camera, RTC — đầy đủ tính năng |
| Guition 4848S040 | ESP32-S3 | 4" 480×480 | Giải mã phần mềm (~63 ms/khung đầy) |
| Guition JC4827W543C | ESP32-S3 | 4,3" 480×272 QSPI | Giải mã phần mềm |

Màn hình ESP32-S3/P4 khác (có PSRAM, màn hình ESPHome hỗ trợ) thường dùng được với chỉnh sửa YAML.

**Tuỳ chọn**
- **go2rtc** (addon go2rtc hoặc go2rtc có sẵn trong Frigate) ở cổng 1984 trên máy HA — cho ứng dụng *Camera nhà* và
  *Camera P4*.
- **Frigate** — nhận diện người từ camera của màn hình P4.

## Bắt đầu từ đâu

1. **Thêm kho addon**: Cài đặt → Addon → Cửa hàng addon → ⋮ → Kho lưu trữ → thêm
   `https://github.com/minhquanghp86/HA-Darboard-Server`.
2. **Cài addon "Remote WebView Server"** → Khởi động. Bật *Hiện trên thanh bên* nếu muốn (mục **Menu panel**). Xem tab
   *Nhật ký*: có dòng `WebSocket listening on :8081` là sẵn sàng.
3. **Tạo tài khoản HA riêng cho màn hình** (khuyến nghị): Cài đặt → Người & Khu vực → Người → thêm người, *không* cho
   quyền quản trị. Màn hình sẽ đăng nhập bằng tài khoản này.
4. **Chuẩn bị firmware**: trong addon ESPHome tạo thiết bị mới, dán cấu hình mẫu của màn hình bạn từ thư mục
   [`examples/`](https://github.com/minhquanghp86/HA-Darboard-Client/tree/main/examples) của repo firmware. Sửa hai dòng:

   ```yaml
   remote_webview:
     server: 192.168.1.10:8081            # IP máy Home Assistant : ws_port của addon
     url: http://192.168.1.10:8123/lovelace/0   # trang mở khi khởi động
   ```

   Thêm `wifi_ssid`, `wifi_password`, `ap_fallback_password` vào `secrets.yaml` của ESPHome.
5. **Nạp firmware** lần đầu qua cáp USB, các lần sau qua WiFi (OTA). Màn hình khởi động, kết nối addon và hiện trang.
6. **Đăng nhập Home Assistant lần đầu** ngay trên màn hình: chạm vào ô tên đăng nhập → bàn phím ảo hiện ra (có tiếng
   Việt, gõ Telex) → đăng nhập bằng tài khoản ở bước 3, tích *Ghi nhớ*. Đăng nhập được lưu trong thư mục hồ sơ của
   addon (`/data/pw-data`), không mất khi cập nhật.
7. **Vuốt từ mép trên xuống** để mở thanh trạng thái, **vuốt lên từ mép dưới** để vào màn hình chính (các ứng dụng).
   Vào **Menu panel** trên thanh bên HA để sắp xếp ứng dụng theo ý bạn.

## Sử dụng hằng ngày

### Đồng hồ và cử chỉ

Giọt nước ở giữa mép trên mọi trang hiện **giờ của chính màn hình** (lấy từ đồng hồ thời gian thực trên bo mạch và
đồng bộ Internet) — chỉ để xem, chạm vào đó là chạm vào trang bên dưới. **Vuốt từ mép trên xuống** (ở bất kỳ vị trí nào)
để mở thanh trạng thái; chạm vùng tối bên dưới hoặc vuốt lên để đóng. **Vuốt lên từ mép dưới** để về màn hình chính.

### Menu ứng dụng

- **Hàng thông tin**: giờ lớn, thứ, ngày dương lịch và **âm lịch**; ô **thời tiết** thu gọn (vị trí nhà trong HA,
  cập nhật 15 phút/lần — chạm để mở ứng dụng Thời tiết); ô **hẹn giờ** đang chạy (nếu có).
- **Hàng điều khiển**: thanh trượt **độ sáng** (thấp nhất 5%, kéo về 0 không tắt hẳn màn hình) và **âm lượng** âm thanh
  trang web; ba nút tròn **Màn hình chờ** (bật: không tự tắt màn hình, rảnh thì hiện đồng hồ lớn; tắt: tắt màn hình sau *Sleep time*), **Tắt tiếng**, **Khử vọng mic**.
- **Ứng dụng** chia ba nhóm:

| Nhóm | Ứng dụng | Làm gì |
|---|---|---|
| Nhà | Home Assistant | Dashboard HA (trang đặt trong thực thể *Home URL*) — đứng đầu dock |
| | Camera P4 | Xem trực tiếp camera của màn hình P4 (go2rtc) |
| | Camera nhà | Lưới ảnh tất cả camera trong go2rtc, cập nhật lần lượt vài giây/lần; chạm để xem trực tiếp |
| | Cảnh | Nút chạy **cảnh (scene)** và **kịch bản (script)** của Home Assistant |
| | Năng lượng | Trang *Năng lượng* của Home Assistant |
| Giải trí | YouTube, TikTok | Xem video có tiếng |
| | Nhạc | YouTube Music |
| | Radio | VOV1, VOV2, VOV3, VOV5 trực tiếp (cần ~10 giây để bắt đầu — máy chủ VOV giới hạn tốc độ tải) |
| | Tin tức | VnExpress |
| | Media | Trình duyệt media của Home Assistant |
| Tiện ích | Thời tiết | Hiện tại, 24 giờ, 7 ngày, chất lượng không khí (Open-Meteo). Chạm tên nơi chốn → chọn 1 trong 34 tỉnh/thành, hoặc "Nhà (Home Assistant)" |
| | Lịch | Lịch tháng âm dương, can chi, ngày lễ, giao thừa |
| | Hẹn giờ | Hẹn nhanh 1–60 phút. **Vẫn reo khi bạn đã chuyển trang**: hết giờ màn hình tự sáng, hiện báo thức toàn màn hình kèm chuông |
| | Trình duyệt | Ô nhập địa chỉ web; địa chỉ nhập vào được ghi vào thực thể *URL hiển thị* của màn hình |

### Sắp xếp màn hình chính, thư mục

- **Chạm giữ** một ứng dụng khoảng nửa giây → vào chế độ sắp xếp và ứng dụng dính theo ngón tay.
- Kéo sang **cạnh** ứng dụng khác để đổi chỗ; thả vào **giữa** ứng dụng khác để tạo **thư mục** (thả vào thư mục có
  sẵn để thêm). Kéo xuống **dock** (tối đa 5) hoặc kéo ra khỏi dock. Giữ sát mép trái/phải để sang trang.
- Chạm thư mục để mở. Trong chế độ sắp xếp: chạm một chip để đổi tên thư mục, kéo ứng dụng ra ngoài khung để lấy ra.
- **Xong** hoặc chạm chỗ trống để thoát. **Đặt lại** (chạm 2 lần) trở về bố cục mặc định.
- Bố cục dùng chung cho mọi màn hình. Ứng dụng mới thêm ở trang *Menu panel* xuất hiện ở cuối.

### Ứng dụng cho ngôi nhà

| Ứng dụng | Cần chuẩn bị trong Home Assistant |
|---|---|
| **Phòng** | Cài đặt → Khu vực: tạo phòng và gán thiết bị (đèn, công tắc, quạt, rèm, điều hoà, TV). Nhiệt độ/độ ẩm/cửa/chuyển động của phòng lấy từ cảm biến gán cùng phòng. |
| **Điều khiển** | Có ít nhất một `media_player` (Android TV, Samsung/LG, Google Cast, Sonos…). |
| **Việc cần làm** | Thêm tích hợp *Danh sách mua sắm* hoặc *Local To-do* (hoặc Google Tasks). |
| **Khung ảnh** | Media → Local media → tạo thư mục `photos` → tải ảnh lên (JPG/PNG/WebP). Không có `photos` thì dùng cả thư mục media. |

Chạm = bật/tắt; **chạm giữ** một ô trong *Phòng* để mở bảng chi tiết (độ sáng, rèm, nhiệt độ). Các ứng dụng này chỉ
nhận lệnh từ chính màn hình, và chỉ các thao tác kể trên (không mở khoá cửa, không tắt báo động).

**Ảnh riêng tư:** thư mục ảnh là `media/photos` của Home Assistant (HA → Media → Local media, hoặc Samba `\\<máy HA>\media\photos`).
Khác thư mục `www` (ai có địa chỉ cũng xem được qua `/local/…`, không cần đăng nhập), thư mục media **chỉ xem được khi đã
đăng nhập HA**. Addon chỉ **đọc** thư mục này và chỉ trả ảnh cho **trình duyệt của chính addon** (127.0.0.1): máy khác
trong LAN, trang ingress hay Internet gọi `/photos/…` đều bị từ chối (403).

### Bảng tin, chuông cửa (gọi từ Home Assistant)

```yaml
rest_command:
  ghi_chu_panel:
    url: "http://127.0.0.1:18080/board"      # hoặc http://<IP máy HA>:18080/board
    method: post
    content_type: "application/json"
    payload: '{"text": "{{ text }}", "by": "{{ by | default(\'\') }}", "color": "pink"}'
  chuong_cua_panel:
    url: "http://127.0.0.1:18080/doorbell"
    method: post
    content_type: "application/json"
    payload: '{"camera": "cong_truoc", "title": "Cổng trước", "unlock": "script.mo_cong", "timeout": 60}'
```

- `camera`: tên luồng trong go2rtc. `unlock` (tuỳ chọn): `script.*`, `button.*` hoặc `lock.*` — nút **Mở cổng** chỉ
  chạy đúng thực thể này. `timeout`: 10–300 giây rồi tự quay về ứng dụng trước.
- Automation mẫu: khi nút chuông (binary_sensor/event) bật → `rest_command.chuong_cua_panel`.

### Trợ lý giọng nói (cần firmware có `voice_assistant`)

- Nói từ đánh thức (chọn trong thực thể **Từ đánh thức** của màn hình: Tắt / Okay Nabu / Hey Jarvis), hoặc chạm nút
  **Trợ lý** trong thanh kéo xuống.
- Thẻ ở cuối màn hình hiện *Đang nghe…*, rồi câu bạn vừa nói, rồi câu trả lời; chạm thẻ để dừng hoặc đóng.
- Cần một **Assist pipeline** trên Home Assistant: STT (vd addon *Whisper*) + TTS (vd *Piper* giọng tiếng Việt), chọn
  pipeline cho thiết bị ESPHome ở trang thiết bị.
- Đang xem video thì từ đánh thức tạm dừng (giữ máy ổn định); nút Trợ lý vẫn dùng được.

### Bàn phím ảo

Tự hiện khi chạm vào ô nhập chữ trên bất kỳ trang nào; có chế độ tiếng Việt (Telex), số và ký hiệu. Phím ▼ để ẩn.

### Trang "Menu panel" (thanh bên Home Assistant)

Nơi chỉnh menu bằng giao diện — không phải sửa cấu hình:

- **Hiện/Ẩn** từng ứng dụng bằng công tắc; **↑↓** đổi thứ tự trong nhóm.
- **Sửa**: đổi tên, nhóm, **biểu tượng** (bộ Material Design Icons giống Home Assistant — gõ từ khoá tiếng Anh như
  `lamp`, `fan`, `tv` để tìm), **màu** (bảng màu hoặc tự chọn). *Khôi phục mặc định* cho ứng dụng có sẵn.
- **＋ Thêm ứng dụng**: tên, địa chỉ web (dashboard HA khác, trang web bất kỳ…), nhóm, biểu tượng, màu.
- **Lưu** → menu trên mọi màn hình đổi ngay, không cần khởi động lại. Cấu hình lưu ở `/data/launcher.json` của addon.

Chỉ lưu được từ trang này bên trong Home Assistant (đã đăng nhập); máy khác trong mạng gọi thẳng vào addon thì bị từ chối.

## Điều khiển màn hình từ Home Assistant

Mỗi màn hình là một thiết bị ESPHome với các thực thể (tên theo cấu hình mẫu):

| Thực thể | Loại | Dùng để |
|---|---|---|
| URL hiển thị | text | Đổi trang đang hiện (automation, script) |
| URL hiện tại | text_sensor | Trang đang hiện thực tế (kể cả khi người dùng tự chuyển) |
| Home URL | text | Trang của nút "Trang chủ" |
| LCD Backlight | light | Bật/tắt, độ sáng màn hình |
| Sleep time | number | Số giây không chạm thì tắt màn hình (0 = không tắt) |
| Màn hình chờ (trước đây *No Sleep*) | switch | Bật: không tắt đèn nền, rảnh thì hiện màn hình chờ. Tắt: tắt đèn nền sau *Sleep time* |
| Video đang chạy | binary_sensor | Đang phát video/camera (không tự tắt màn hình lúc này) |
| Âm lượng Video Web | number | Âm lượng âm thanh trang web |
| Speaker Media Player | media_player | Phát TTS / thông báo ra loa màn hình |
| WS Connected | binary_sensor | Màn hình đang kết nối addon |

Ví dụ — mở camera cổng khi có người bấm chuông, rồi đọc thông báo:

```yaml
automation:
  - alias: Chuông cửa → hiện camera trên màn hình phòng khách
    trigger:
      - platform: state
        entity_id: binary_sensor.chuong_cua
        to: "on"
    action:
      - action: light.turn_on
        target: { entity_id: light.man_hinh_phong_khach_lcd_backlight }
      - action: text.set_value
        target: { entity_id: text.man_hinh_phong_khach_url_hien_thi }
        data: { value: "http://192.168.1.10:18080/cam.html?src=cong" }
      - action: tts.speak
        target: { entity_id: tts.piper }
        data:
          media_player_entity_id: media_player.man_hinh_phong_khach_speaker_media_player
          message: "Có người bấm chuông cửa"
```

## Thông báo từ Home Assistant (chuông cửa, nhắc việc…)

Gửi thông báo tới màn hình bằng một `rest_command`. Thêm vào `configuration.yaml` rồi khởi động lại Home Assistant:

```yaml
rest_command:
  panel_notify:
    url: http://127.0.0.1:18080/notify      # 18080 = health_port của addon
    method: POST
    content_type: application/json
    payload: >-
      {{ {"title": title | default(""), "message": message | default(""),
          "priority": priority | default("normal"), "device": device | default("all"),
          "camera": camera | default(""), "app": app | default(""), "url": url | default("")} | tojson }}
```

Gọi từ tự động hoá:

```yaml
# Chuông cửa: bật sáng màn hình, kêu chuông, kèm ảnh camera cổng (tên luồng go2rtc), chạm để mở Camera
- action: rest_command.panel_notify
  data:
    title: Chuông cửa
    message: Có người ở cổng
    priority: critical
    camera: cong
    app: cams

# Nhắc việc thường, chỉ gửi tới một màn hình
- action: rest_command.panel_notify
  data:
    title: Máy giặt
    message: Đã giặt xong
    device: esp32-0a0b0c0d0003
```

| Trường | Ý nghĩa |
|---|---|
| `title`, `message` | Tiêu đề (≤ 80 ký tự) và nội dung (≤ 300). Cần ít nhất một trong hai. |
| `priority` | `normal`: thẻ nổi tự ẩn sau 8 s. `high`: bật sáng màn hình + chuông ngắn, thẻ giữ 20 s. `critical` (chuông cửa, báo cháy): bật sáng + chuông, thẻ giữ tới khi được chạm, **hiện cả khi Không làm phiền**. |
| `device` | `all` (mặc định) hoặc id màn hình (`esp32-…`, xem log addon). |
| `camera` | Tên luồng go2rtc — thẻ kèm ảnh chụp camera đó. Hoặc `image`: URL ảnh http(s). |
| `app` / `url` | Chạm vào thẻ thì mở ứng dụng trong menu (vd `cams`, `weather`) hoặc URL này. |

Thông báo được giữ trong **thanh kéo xuống** (mục *Thông báo*: chạm để mở, ✕ để xoá, *Xoá hết*); đồng hồ ở mép trên có
chấm cam khi còn thông báo. Ô **Không làm phiền** trong thanh kéo xuống: thông báo `normal`/`high` chỉ vào danh sách,
không nổi, không kêu, không bật màn hình; `critical` vẫn báo. Trạng thái này được nhớ qua khởi động lại addon.

## Cấu hình addon

Phần lớn người dùng **không cần đổi gì**. Các tuỳ chọn khung hình chỉ là giá trị *dự phòng*: firmware `remote_webview`
luôn gửi giá trị riêng của từng màn hình (trong YAML ESPHome) khi kết nối.

| Tuỳ chọn | Mặc định | Ý nghĩa |
|---|---|---|
| Ngôn ngữ trình duyệt (`browser_locale`) | `en-US` | Đặt `vi-VN` để trang web hiện tiếng Việt |
| Cổng WebSocket (`ws_port`) | `8081` | Cổng màn hình kết nối tới — phải khớp `server:` trong YAML |
| Cổng nội bộ (`health_port`) | `18080` | Trạng thái, trang ứng dụng, Menu panel |
| Giảm hiệu ứng chuyển động | tắt | Bật để trang bớt hiệu ứng → ít khung hình phải truyền |
| Thư mục hồ sơ trình duyệt (`user_data_dir`) | `/data/pw-data` | Nơi lưu đăng nhập; giữ trong `/data` |
| Mở DevTools ra mạng LAN (`expose_debug_proxy`) | tắt | Xem mục *Nâng cao* — chỉ bật khi cần |
| Cổng DevTools ra LAN (`debug_proxy_port`) | `9222` | |
| Cổng DevTools nội bộ (`debug_port`) | `9221` | Thường không cần đổi |
| Cỡ ô, chất lượng JPEG, nhịp khung… | — | Dự phòng, xem trên |

## Cổng và địa chỉ

| Cổng | Dùng cho | Ai truy cập |
|---|---|---|
| 8081 | WebSocket ảnh/tiếng/cảm ứng | Màn hình ESP32 |
| 18080 | `/metrics`, trang ứng dụng (`/weather.html`, `/calendar.html`, `/cams.html`, `/scenes.html`, `/radio.html`, `/timer.html`, `/cam.html`), Menu panel | Trình duyệt của addon, mạng LAN, ingress HA |
| 9222 | Chrome DevTools (chỉ khi bật) | Máy tính quản trị |

## Hiệu năng đo thực tế (ESP32-P4 1024×600, WiFi)

| Tình huống | Kết quả |
|---|---|
| YouTube đủ độ phân giải + camera 1080p gửi Frigate | ~28–29 hình/giây, giải mã 17–26 ms/khung |
| Camera P4 → Frigate | 1920×1056, 5 hình/giây, H.264 phần cứng |
| Dashboard đứng yên | CPU màn hình ~5%, gần như không tốn mạng |
| Băng thông WiFi tối đa của P4 | ~2,1–2,4 MB/giây |

## Bảo mật

- Cổng **18080 chỉ nên dùng trong mạng nhà**. Đừng đưa nó ra Internet (reverse proxy, Cloudflare Tunnel, mở cổng
  router). Menu panel thì vào qua Home Assistant (đã có đăng nhập).
- Ứng dụng **Cảnh** cho phép máy trong mạng nhà chạy scene/script của HA qua cổng 18080 (chỉ scene/script, không phải
  dịch vụ tuỳ ý).
- Addon có quyền đọc cấu hình HA (vị trí nhà, danh sách scene/script) bằng token riêng do Supervisor cấp — không cần
  mật khẩu hay token của bạn.
- **Không đặt trang tự tạo trong `/config/www/`** của HA nếu HA được mở ra Internet: `/local/` phục vụ không cần đăng
  nhập. Các trang của addon được phục vụ ở cổng 18080 chính vì lý do này.
- **Mở DevTools ra LAN** cho phép điều khiển trình duyệt (kể cả phiên đăng nhập HA) — chỉ bật khi cần, tắt ngay sau.

## Xử lý sự cố

| Hiện tượng | Kiểm tra |
|---|---|
| Màn hình không lên hình | Thực thể *WS Connected* = bật? `server:` đúng IP máy HA và cổng 8081? Nhật ký addon có `Client connected`? |
| Đèn sáng nhưng trang trắng / đứng hình | Chạm vào màn hình; nếu vẫn vậy, bấm nút *Khởi động lại* của thiết bị trong ESPHome |
| Trang đòi đăng nhập lại sau cập nhật | *Thư mục hồ sơ trình duyệt* phải nằm trong `/data` (mặc định `/data/pw-data`) |
| Màn hình không tự tắt | *No Sleep* đang bật? *Video đang chạy* = bật (đang xem video)? *Sleep time* > 0? |
| Không có tiếng | Cấu hình firmware có `speaker_id`? Âm lượng / nút *Tắt tiếng* trong menu? |
| Menu không có thanh trượt / đồng hồ | Firmware màn hình cũ — nạp lại theo cấu hình mẫu mới nhất |
| Camera nhà trống | Cần go2rtc ở cổng 1984 trên máy HA và đã có luồng camera |
| Thời tiết sai nơi | Chạm tên nơi chốn → chọn tỉnh/thành, hoặc sửa *Vị trí nhà* trong Cài đặt → Hệ thống → Chung của HA |
| Menu panel báo không lưu được | Mở trang từ thanh bên Home Assistant (không mở thẳng `http://…:18080`) |
| Addon không cài được | Máy HA phải là x86-64; không hỗ trợ ARM (Raspberry Pi) |
| Hình màu sai | Đổi `big_endian` trong YAML ESPHome |
| Ô ảnh bị đỏ | Ô lớn hơn `max_bytes_per_msg` — tăng giá trị đó hoặc giảm `tile_size`/`jpeg_quality` trong YAML |

## Nâng cao

- **Số liệu thời gian thực**: `http://<ip-HA>:18080/metrics` (JSON: số khung, băng thông, thời gian giải mã, nhịp điều
  tiết của từng màn hình).
- **Tinh chỉnh không cần khởi động lại**: tạo `/data/rwv-tuning.json` trong addon (đọc lại mỗi khi file đổi, xoá file =
  mặc định).
- **Chrome DevTools**: bật *Mở DevTools ra mạng LAN* → trên máy tính mở Chrome, vào `chrome://inspect/#devices` →
  *Configure…* → thêm `<ip-HA>:9222` → *inspect* tab của màn hình. Tắt lại khi xong.
- **Self-test**: đặt `url: "self-test"` trong YAML để đo thời gian dựng hình của màn hình.
- **Màn hình chờ sau (giây)** (`screensaver_idle_s`, mặc định `120`, `0` = tắt): không chạm bao lâu thì hiện đồng
  hồ lớn + ngày âm dương + thời tiết (tông tối 22h–6h, dịch chỗ mỗi phút chống lưu ảnh). Không hiện khi đang phát
  video/camera hoặc màn hình đã tắt đèn nền.
- **`MAX_APP_TABS`** (mặc định `2`): số ứng dụng "phụ" tối đa được giữ mở cùng lúc mỗi màn hình, không kể Home
  Assistant và màn hình chính (hai cái đó luôn giữ). Mỗi ứng dụng mở là một tiến trình renderer Chrome riêng — tăng
  giá trị này cho quay lại ứng dụng gần đây nhanh hơn, đổi lại tốn thêm RAM (xem mục Giới hạn đã biết). Radio/Nhạc
  **đang phát** không bị đóng; đã dừng phát thì được đóng như ứng dụng thường.

## Giới hạn đã biết

- Một trình duyệt dùng chung cho mọi màn hình: nếu **nhiều màn hình cùng có loa**, âm thanh của chúng có thể lẫn nhau
  — tại một thời điểm chỉ một tab của một màn hình được phép phát tiếng (server tự khoá/mở, xem mục "Menu ứng dụng").
- ESP32-S3 giải mã JPEG bằng phần mềm nên chậm hơn P4 nhiều — hợp với dashboard hơn video.
- Radio VOV cần ~10 giây để bắt đầu phát (máy chủ đài giới hạn tốc độ).
- Hẹn giờ lưu trong bộ nhớ addon: khởi động lại addon thì hẹn giờ đang chạy bị huỷ.
- **RAM tăng theo số tab mở**: mỗi ứng dụng đang mở (kể cả chạy nền) là một tiến trình Chrome renderer riêng. Với
  `MAX_APP_TABS` mặc định (2) cộng Home Assistant + màn hình chính, một màn hình có thể giữ tới 4 tab cùng lúc.
  Chưa có nút "đóng ứng dụng" thủ công trong bản này — ứng dụng cũ nhất tự đóng khi vượt hạn mức. Radio/Nhạc đang
  phát nền dừng được ngay từ thẻ **Đang phát** trong thanh kéo xuống (từ 2.9.49).

## Mã nguồn, ghi công, giấy phép

- Phát triển tiếp từ [strange-v/RemoteWebViewServer](https://github.com/strange-v/RemoteWebViewServer) và
  [RemoteWebViewClient](https://github.com/strange-v/RemoteWebViewClient); ý tưởng bàn phím ảo từ
  [SleepinDevil](https://github.com/SleepinDevil/RemoteWebViewServer).
- Dữ liệu thời tiết: [Open-Meteo](https://open-meteo.com) · Radio: Đài Tiếng nói Việt Nam · Âm lịch: thuật toán của
  Hồ Ngọc Đức · Biểu tượng: [Material Design Icons](https://pictogrammers.com/library/mdi/).
- Giấy phép: mã gốc MIT © strange_v; sửa đổi và bổ sung Apache-2.0 © minhquanghp86 (xem `LICENSE`, `LICENSE-MIT`,
  `NOTICE` trong repo).
- Nhật ký thay đổi: tab *Nhật ký thay đổi* của addon.

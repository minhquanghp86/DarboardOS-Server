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
- **Menu ứng dụng** mở từ nút ở giữa mép trên (hiện đồng hồ): chỉnh độ sáng/âm lượng, bật/tắt nhanh, thời tiết, lịch
  âm dương, camera, radio, hẹn giờ, cảnh Home Assistant…
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
7. **Chạm nút ở giữa mép trên** (hiện giờ HH:MM) để mở menu ứng dụng. Vào **Menu panel** trên thanh bên HA để sắp xếp
   menu theo ý bạn.

## Sử dụng hằng ngày

### Nút menu

Nút hình giọt nước ở giữa mép trên mọi trang, hiện **giờ của chính màn hình** (lấy từ đồng hồ thời gian thực trên bo
mạch và đồng bộ Internet). Chạm để mở menu; chạm ra ngoài menu để đóng.

### Menu ứng dụng

- **Hàng thông tin**: giờ lớn, thứ, ngày dương lịch và **âm lịch**; ô **thời tiết** thu gọn (vị trí nhà trong HA,
  cập nhật 15 phút/lần — chạm để mở ứng dụng Thời tiết); ô **hẹn giờ** đang chạy (nếu có).
- **Hàng điều khiển**: thanh trượt **độ sáng** (thấp nhất 5%, kéo về 0 không tắt hẳn màn hình) và **âm lượng** âm thanh
  trang web; ba nút tròn **Luôn sáng** (không tự tắt màn hình), **Tắt tiếng**, **Khử vọng mic**.
- **Ứng dụng** chia ba nhóm:

| Nhóm | Ứng dụng | Làm gì |
|---|---|---|
| Nhà | Trang chủ | Về trang chủ đặt trên màn hình (thực thể *Home URL*) |
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
| No Sleep | switch | Giữ màn hình luôn sáng |
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

## Giới hạn đã biết

- Một trình duyệt dùng chung cho mọi màn hình: nếu **nhiều màn hình cùng có loa**, âm thanh của chúng có thể lẫn nhau.
- ESP32-S3 giải mã JPEG bằng phần mềm nên chậm hơn P4 nhiều — hợp với dashboard hơn video.
- Radio VOV cần ~10 giây để bắt đầu phát (máy chủ đài giới hạn tốc độ).
- Hẹn giờ lưu trong bộ nhớ addon: khởi động lại addon thì hẹn giờ đang chạy bị huỷ.

## Mã nguồn, ghi công, giấy phép

- Phát triển tiếp từ [strange-v/RemoteWebViewServer](https://github.com/strange-v/RemoteWebViewServer) và
  [RemoteWebViewClient](https://github.com/strange-v/RemoteWebViewClient); ý tưởng bàn phím ảo từ
  [SleepinDevil](https://github.com/SleepinDevil/RemoteWebViewServer).
- Dữ liệu thời tiết: [Open-Meteo](https://open-meteo.com) · Radio: Đài Tiếng nói Việt Nam · Âm lịch: thuật toán của
  Hồ Ngọc Đức · Biểu tượng: [Material Design Icons](https://pictogrammers.com/library/mdi/).
- Giấy phép: mã gốc MIT © strange_v; sửa đổi và bổ sung Apache-2.0 © minhquanghp86 (xem `LICENSE`, `LICENSE-MIT`,
  `NOTICE` trong repo).
- Nhật ký thay đổi: tab *Nhật ký thay đổi* của addon.

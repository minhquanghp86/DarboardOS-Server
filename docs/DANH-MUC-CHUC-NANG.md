# DANH MỤC CHỨC NĂNG — HA Darboard

> Cập nhật **18/10/2026** · add-on server **2.9.185** · firmware **fw-2026.10.27**
> Dự án gồm **hai repo dùng chung một sản phẩm**: `DarboardOS-Server` (máy chủ, repo này) và
> `DarboardOS-Client` (firmware ESPHome cho màn hình). Danh mục này liệt kê **đúng những gì đang có trong mã**,
> kèm **nơi cấu hình** và **tài liệu chi tiết** — không có mục nào chỉ nằm trên giấy.
>
> Cách tra: mỗi dòng ghi rõ *chức năng* · *ai có* (màn P4 / S3 / chuông) · *cấu hình ở đâu* · *đọc thêm*.
> Trạng thái dùng 3 mức: **✅ chạy thật hằng ngày**, **○ có nhưng ít dùng**, **⛔ giới hạn đã biết** (xem mục N).

## A. Máy chủ dựng hình (server)

| Chức năng | Ghi chú | Cấu hình |
|---|---|---|
| Chrome ẩn dựng trang cho từng màn | Giải mã H.264, chạy trên máy chủ | `docker-compose.rwv.yml` / add-on |
| Truyền **ô ảnh thay đổi** + khung đầy đủ khi vùng đổi lớn | So khớp băm từng ô, bỏ khung trùng, không mã hoá khi không ai xem | `tile_size`, `full_frame_*`, `every_nth_frame` |
| Tự điều tiết chất lượng JPEG / nhịp khung | Theo thời gian giải mã thật của từng màn + độ nghẽn WiFi | `jpeg_quality`, `min_frame_interval_ms`, `max_bytes_per_message` |
| P4: khung đầy đủ chia **dải ngang**, giải mã cứng vào framebuffer | ~25–29 hình/giây ở 1024×600 | `fb=1` (firmware) |
| S3: khung video **nửa độ phân giải** + phóng ×2 trên chip | ~14 hình/giây ở 480×480 | `half=1/2` (firmware) |
| **Mỗi ứng dụng một tab Chromium riêng** | Chuyển app không tải lại; tab nền vẫn chạy; tab rảnh tự đóng | `MAX_APP_TABS`, `IDLE_TAB_CLOSE_MIN`, `LOW_MEM_MB` |
| Tinh chỉnh nóng không cần khởi động lại | Đọc lại khi tệp đổi | `/data/rwv-tuning.json` |
| Số liệu vận hành | JSON theo từng màn: khung, giải mã, băng thông, RAM, `pipeline.slowWhy` | `GET /metrics` |

## B. Giao diện kiểu điện thoại trên panel

| Chức năng | Ai có | Cấu hình |
|---|---|---|
| Màn hình chính: đồng hồ lớn, ngày âm dương, thời tiết | cả 3 màn | Darboard → **Menu ứng dụng** |
| Lưới ứng dụng nhiều trang, **thư mục**, kéo thả sắp xếp | cả 3 màn | chạm giữ ~0,5 s để vào chế độ sắp xếp |
| **Dock** tối đa 6 ứng dụng | cả 3 màn | kéo xuống/vào dock |
| Cử chỉ: vuốt lên = Home; vuốt lên giữ = Gần đây; mép trái/phải = quay lại; mép trên = thanh trạng thái | cả 3 màn | — |
| Thanh trạng thái: độ sáng, 3 âm lượng, Màn hình chờ, Im lặng, Không làm phiền, Khử vọng mic | cả 3 màn | — |
| Widget: thời tiết, **6 chỉ số năng lượng**, lịch, lần camera phát hiện (~5 s), **thẻ đỏ "Cuộc gọi nhỡ"** | cả 3 màn | Darboard → **Màn khóa** |
| Màn hình chờ / màn khóa: đồng hồ hoặc **khung ảnh số** | cả 3 màn | `screensaver_idle_s`, `screensaver_photos`, `gphotos_album` |
| Bàn phím ảo tiếng Việt (Telex) | cả 3 màn | tự hiện khi chạm ô nhập |
| **Pin kiểu điện thoại** (tự biết có pin / sạc / nguồn ngoài) | P4 + S3 480×272 | firmware `battery_monitor.h`, ngưỡng ±35 mV, xu hướng 3 phút |
| **Nhận biết người tại chỗ** (chuyển động + khuôn mặt) | P4 | select *Nguồn phát hiện người* |

## C. Ứng dụng trên panel (37 ứng dụng)

Xem bảng đầy đủ trong [`hassio/remote_webview_server/DOCS.md`](../hassio/remote_webview_server/DOCS.md) — mục *Menu ứng dụng*.
Tóm tắt theo nhóm: **Nhà** (Home Assistant, Camera, Frigate, Sự kiện camera, Gọi, Chuông cổng, Thư viện, Phòng,
Điều khiển, Solar) · **Giải trí** (YouTube, YouTube TV, YouTube Music, TikTok, Radio, Tin tức, VTVgo, IPTV, Zing MP3,
NhacCuaTui, Media, Khung ảnh) · **Tiện ích** (Quản lý file, Tin nhắn, Thời tiết, Lịch vạn niên, Hẹn giờ, Báo thức,
Việc cần làm, Hôm nay, Bảng tin, Báo Mới, Giá vàng, Xổ số, Google Maps, Chrome, Cài đặt).

**Theo khả năng thiết bị:** *Camera* chỉ P4; *Thư viện* + *Quản lý file* cần thẻ SD (P4, S3 4848S040);
*Gọi* + nói chuyện 2 chiều cần mic; ba nhóm còn lại có trên mọi màn.
Thêm / ẩn / sắp xếp / đổi tên / đổi biểu tượng: Darboard → **Menu ứng dụng**.

## D. Âm thanh

| Chức năng | Ghi chú | Cấu hình |
|---|---|---|
| Tiếng trang web (YouTube, radio, video) | Bắt qua PulseAudio trên máy chủ → PCM 16 kHz → loa màn | tự động |
| **Ba loại âm lượng**: Media / Thông báo / Báo thức | *Im lặng* = chỉ tắt Media; *Không làm phiền* = tắt hết | thanh trạng thái, Cài đặt |
| TTS / thông báo đọc to từ HA | qua `media_player` của màn | thực thể ESPHome |
| Báo thức giữ ở **máy chủ** | Reo đúng giờ kể cả khi màn tắt/mất kết nối; Tắt ở một màn = cả nhóm dừng | ứng dụng Báo thức |
| Nhạc chuông | `media/audio/chuong-cua.mp3`, `media/audio/zalo.mp3` | thư mục media của HA |

## E. Tin nhắn · Gọi · Chuông cổng

| Chức năng | Ghi chú | Cấu hình |
|---|---|---|
| **Tin nhắn nội bộ** giữa Darboard và các màn | Chữ, ảnh, video, **tin nhắn thoại giữ-để-ghi**; tạo/xoá cuộc trò chuyện, nhóm | tab **Tin nhắn** trên Darboard + app *Tin nhắn* |
| "Đã xem" riêng từng màn, chấm đỏ + huy hiệu chưa đọc | "Đang xem" chỉ khi app đang hiện, không bị màn hình chờ đè, có chạm trong 2 phút | tự động |
| Sự kiện HA `darboard_chat_message` | Dùng cho tự động hoá | — |
| **Gọi video** giữa các màn có camera + mic, và với trình duyệt/điện thoại | Chạy được qua Cloudflare Tunnel | app *Gọi*, tab **Gọi** |
| **Chuông cổng Darboard** (ESP32-S3 CAM) | Bấm nút → các màn đổ chuông đè lên màn khóa; hình cổng trực tiếp; **Nói chuyện** 2 chiều; **Mở khóa cổng**; Chụp ảnh | firmware + `darboard_door` |
| Không ai nghe → **"Cuộc gọi nhỡ"** kèm ảnh + **nhật ký 30 ngày** | Sự kiện HA `darboard_doorbell` | app *Chuông cổng*, tab trên Darboard |
| `POST /doorbell` | Màn hình chuông cửa toàn màn với camera bất kỳ (cho chuông không phải Darboard) | `rest_command` trong HA |
| **Thông báo Telegram** | Chuông cổng nhỡ / bị từ chối / mỗi lần bấm (kèm ảnh khách), cuộc gọi nhỡ | Darboard → **Gọi** → ⚙ |

## F. Nhà & Home Assistant

| Chức năng | Ghi chú | Cấu hình |
|---|---|---|
| Điều khiển thiết bị HA (đèn, công tắc, media player…) | Ứng dụng *Phòng*, *Điều khiển* | quyền Supervisor `homeassistant_api` |
| Màn hình là thiết bị ESPHome đầy đủ | URL hiển thị, đèn nền, Sleep time, Màn hình chờ, Ảnh màn hình chờ, âm lượng, media player, cảm biến người | app *Cài đặt* ↔ thực thể |
| Đèn nền **nhớ độ sáng** qua khởi động lại | firmware `RESTORE_AND_ON` | — |
| **Frigate**: lưới camera, sự kiện theo ngày | Nhận diện Frigate theo tiêu đề cấu hình | `GO2RTC_URL`, `FRIGATE_URL` |
| Nút bấm vật lý trên S3 480×272 | Giữa = Home (giữ ≥ 2 s = Frigate); Trái/Phải = bài trước/sau | server ≥ 2.9.167 |
| 6 chỉ số năng lượng | PV hôm nay, công suất PV, tải, lưới, pin % | thực thể HA (Solar/inverter) |

## G. Giải trí

| Chức năng | Ghi chú | Cấu hình |
|---|---|---|
| **YouTube không quảng cáo** | Mặc định BẬT; kiểm mỗi 1,5 s, bấm "Bỏ qua" hoặc tua hết; YouTube TV tự chọn "chế độ khách" | Cài đặt → YouTube (từng màn) |
| YouTube TV điều khiển bằng cử chỉ | Vuốt = phím mũi tên, cử chỉ quay lại = Esc | — |
| **Truyền YouTube từ điện thoại** (DIAL/SSDP) | Tên màn đổi được trong Cài đặt | `cast_enabled`, `dial_port` |
| **IPTV** — danh sách M3U | Tự cập nhật 6 giờ/lần; mất mạng dùng bản đã lưu; chip Yêu thích/Gần đây/Tất cả | Danh sách kênh trên Darboard |
| Phát kênh lên một màn hoặc **tất cả màn** | Proxy luồng để gắn Referer/User-Agent riêng | API `/iptv/cast`, `/iptv/p` |
| Radio VOV 1/2/3/5, Zing MP3, NhacCuaTui, TikTok, VnExpress, VTVgo, Media, Khung ảnh | Ứng dụng web sẵn có | Menu ứng dụng |

## H. Lưu trữ & tệp

| Chức năng | Ai có | Ghi chú |
|---|---|---|
| **Quản lý file** thẻ SD từ Darboard (kể cả ngoài nhà, qua ingress) | P4, S3 4848S040 | duyệt, xem/phát, tải lên–xuống, đổi tên, tạo thư mục, xoá nhiều; chép ~2 MB/s; **tạm dừng khi màn đang phát video** |
| Tải về dạng **MP4** | như trên | Máy chủ đổi .mkv/.mov/.webm → MP4 (không nén lại hình, đổi tiếng sang AAC); đệm `/data/fm-mp4` ~3 GB / 3 ngày |
| Tải lên + **tối ưu video 720p** | như trên | Nhận cả HEVC của điện thoại; tệp tối đa 4 GB (FAT32) |
| **Thư viện** (ảnh trong thẻ) | như trên | ứng dụng *Thư viện* |
| **Media** (kho media của HA) | cả 3 màn | Ứng dụng riêng của dự án (không phải trang Media của HA) |
| **Khung ảnh** (màn hình chờ) | cả 3 màn | Ảnh từ Media › `photos` hoặc album Google Photos |

## I. Trang "Darboard" (thanh bên Home Assistant)

| Trang | Chức năng |
|---|---|
| **Trang chủ** | Thẻ rút gọn từng màn + **thẻ chuông cổng** trên cùng lưới 2 cột; lưới biểu tượng ứng dụng (Màn hình, Tin nhắn có huy hiệu chưa đọc, IPTV, Quản lý file, Màn khóa, Chuông cổng, Gọi, Menu ứng dụng) |
| **Màn hình** | Điều khiển + cài đặt từng màn từ xa: ảnh màn đang hiển thị, trạng thái (mạng, pin, độ sáng, âm lượng, ứng dụng, thông báo, cuộc gọi nhỡ), thao tác (đánh thức, màn hình chờ, khóa, về màn chính/HA, tải lại, khởi động lại), trình phát, mở/đóng ứng dụng, gửi thông báo, đọc to |
| **Màn khóa** | Ô xem trước 6 chỉ số năng lượng + chọn cảm biến từng dòng; lịch Google / iCal |
| **Menu ứng dụng** | Ô xem trước menu trên màn; bật/tắt, sắp xếp, đổi tên, biểu tượng, màu, thêm ứng dụng |
| **Tin nhắn / IPTV / Quản lý file / Gọi** | Như các mục D–H ở trên |

## J. Thông báo & tự động hoá

| Chức năng | Ghi chú | Cấu hình |
|---|---|---|
| `POST /notify` từ HA | Mức `normal` / `high` (bật sáng + chuông) / `critical` (hiện cả khi Không làm phiền); kèm ảnh camera; lưu qua khởi động lại | `rest_command.panel_notify` |
| `POST /board` | Ghi chú lên Bảng tin gia đình | `rest_command` |
| `POST /doorbell` | Hiện camera toàn màn + nút mở cổng | `rest_command.darboard_hien_camera` |
| **6 Blueprint** cho HA | Hiện camera · Thông báo · Cảnh báo an ninh · Nhắc lịch · Chào buổi sáng · Chuông cổng báo cả nhà | `examples/home-assistant/` |

## K. Firmware & thiết bị (repo client)

| Thiết bị | Chip | Có gì |
|---|---|---|
| **Guition JC1060P470C** | ESP32-P4 + C6 (WiFi qua ESP-Hosted) | Màn 1024×600 MIPI-DSI, camera OV02C10 (chuyển động + khuôn mặt + H.264), mic analog + AEC, loa, thẻ SD, RTC, cổng mạng RJ45 |
| **Guition 4848S040** | ESP32-S3 | Màn 480×480 RGB, **thẻ SD SPI** (`sd_files`) |
| **Guition JC4827W543C** | ESP32-S3 | Màn 480×272 QSPI, pin tự phát hiện, 3 nút bấm trên bo |
| **Chuông cổng ESP32-S3 CAM** | ESP32-S3 | Camera OV2640 (MJPEG), nút chuông, mic INMP441, loa MAX98357A, LED WS2812, MOSFET mở khóa |

**Cơ chế YAML**: `examples/*.yaml` là YAML chung (một file/loại màn, không cấu hình nhà riêng) — máy khách dùng
`examples/rieng-cua-ban/*.yaml` gọi qua `packages` với `ref: fw-2026.10.27`, rồi nhập Wi-Fi/máy chủ/Home URL **sau khi nạp**.
Chi tiết: [`DarboardOS-Client/docs/YAML-CHUNG.md`](https://github.com/minhquanghp86/DarboardOS-Client/blob/main/docs/YAML-CHUNG.md).

**Khoá firmware theo MAC** (`mac_guard.h`, biến `allow_mac`): nạp sang thiết bị khác thì máy ngủ — chống nhân bản.
`allow_mac` khai ở **YAML cục bộ** trên máy build (rỗng = không khoá).

## L. An toàn & bảo mật

| Điểm | Thực tế |
|---|---|
| `health_port` 18080 | Chỉ trong LAN, không mở ra Internet |
| Trang Darboard đi qua **ingress** của HA (có đăng nhập) | `/chat`, `/alarm`, `/api/cam`, `/fm/*` nhận từ 127.0.0.1 **hoặc** ingress (`172.30.32.2`) |
| Không dùng `/config/www/` của HA | `/local/` phục vụ không cần đăng nhập |
| Add-on dùng **token Supervisor** | Quyền `homeassistant_api`; không cần thông tin đăng nhập người dùng |
| Proxy DevTools ra LAN | **Tắt mặc định** (`expose_debug_proxy`) — chỉ bật khi cần |
| Proxy IPTV có mã phiên | `/iptv/p`, `/iptv/probe` bắt buộc mã phiên |
| Bản quyền | Apache-2.0 (mã gốc strange_v: MIT); **file âm lịch chỉ phi thương mại** |

## M. Vận hành

| Việc | Cách làm |
|---|---|
| Xem sức khỏe | `GET /metrics`; tự kiểm tra tốc độ dựng bằng `url: self-test` |
| Tinh chỉnh tạm thời | Sửa `/data/rwv-tuning.json` (không cần khởi động lại) |
| Nâng cấp add-on | `ha store reload` → `ha apps update` (đợi Actions dựng xong ảnh tag mới) |
| Nâng cấp firmware | Đổi `ref:` trong YAML → Install lại |
| Quay về bản ổn định | Tag `ban-on-dinh-*` ở cả hai repo; xem `KHOI-PHUC-BAN-ON-DINH.md` (repo client) |
| Sao lưu | Add-on không sao lưu bộ đệm Chrome/MP4/tệp tạm (tự tạo lại) |

## N. Giới hạn đã biết (không phải lỗi)

| Giới hạn | Lý do |
|---|---|
| Chỉ chạy trên **x86-64 (amd64)** | Google Chrome cho Linux (cần H.264) không có bản ARM |
| IPTV **không** phát DRM Widevine/PlayReady, `udp://`, `rtmp://`, H.265/MPEG-2 | Trình duyệt không hỗ trợ |
| Tệp trên thẻ tối đa **4 GB** | FAT32 |
| P4 gửi camera lên Frigate ở 5 hình/giây | Chọn mức ổn định, không phải mức tối đa |
| S3 ~14 hình/giây khi xem video | Giới hạn giải mã phần mềm của S3 (P4 nhanh hơn ~5 lần/điểm ảnh) |
| **MAC guard chỉ là rào chắn**, không tuyệt đối | Sửa được `.bin`; chống nhân bản thật cần Flash Encryption + Secure Boot (ESPHome không hỗ trợ chính thức) |

## Tài liệu liên quan

| Tài liệu | Ở đâu | Nội dung |
|---|---|---|
| `README.md` | repo server | Tổng quan sản phẩm, tính năng, cài đặt |
| `hassio/remote_webview_server/DOCS.md` | repo server | **Hướng dẫn sử dụng đầy đủ** (cài từ đầu, dùng hằng ngày, tự động hoá, xử lý sự cố) |
| `CHANGELOG.md` | repo server | Nhật ký từng phiên bản |
| `DarboardOS-Client/README.md` | repo client | Firmware, component, tuỳ chọn từng component, cơ chế YAML |
| `docs/YAML-CHUNG.md`, `docs/HUONG-DAN-AUTOMATION-CAMERA.md` | repo client | Cấu hình YAML chung; 6 Blueprint + `rest_command` |
| `docs/BAN-GIAO.md`, `docs/HOAN-THANH-DU-AN.md`, `docs/KHOI-PHUC-BAN-ON-DINH.md` | repo client | Bàn giao, tóm tắt vận hành, quay về bản ổn định |
| `docs/mac-guard-2026-10-17-commandcode.md` | repo client | Khoá firmware theo MAC + cách cứu máy |

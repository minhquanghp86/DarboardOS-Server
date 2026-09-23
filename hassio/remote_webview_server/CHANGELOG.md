## V2.9.12
### Dọn log rác + xác định đúng nguyên nhân gốc của lỗi V2.9.11
`-fragment_size 1024` (V2.9.11) hoá ra KHÔNG phải nguyên nhân chính — kiểm chứng lại bằng log ESPHome
thật sau khi triển khai cho thấy chu kỳ Starting/Stopped vẫn đều đặn ~2.0s y hệt trước. Nguyên nhân thật
là timeout mặc định 500ms của từng nguồn trong `speaker: platform: mixer` (component `mixer_speaker.cpp`
của ESPHome) — sửa ở phía firmware (repo Client, `timeout: 5s` cho `media_spk_mixer_input`), không phải
ở server. Nhân tiện dọn `-flush_packets 1` (không có tác dụng với đầu ra `s16le` thô, chỉ gây spam log
cảnh báo "non monotonically increasing dts"). `-fragment_size 1024` vẫn giữ lại (không sai, chỉ không
phải nguyên nhân chính) vì vẫn hợp lý cho độ trễ thấp.

- `src/audioCapture.ts`: bỏ `-flush_packets 1`

## V2.9.11
### Sửa lỗi thật: gần như không nghe được âm thanh video — PulseAudio đệm theo đợt lớn ~2 giây
Người dùng báo: TTS qua Speaker Media Player nghe rõ, nhưng mở YouTube thì không nghe thấy gì. Xác nhận
qua `pactl list sink-inputs`: Chrome **có** phát âm thanh thật vào sink (2 stream, không mute, không
corked). Xác nhận qua log ESPHome trực tiếp trên thiết bị thật (kết nối có giới hạn thời gian, tự ngắt):
chuỗi `resampler_speaker`/`speaker_mixer`/`i2s_audio.speaker` cứ **Starting rồi Stopped lặp lại đều đặn
tuyệt đối mỗi ~2.0 giây** (đo được: 1.2s / 3.1s / 5.1s / 7.1s / 9.1s / 11.1s).

**Nguyên nhân**: không đặt `-fragment_size` cho ffmpeg khi đọc từ `chrome_out.monitor`, nên PulseAudio
tự chọn kích thước đoạn mặc định — trên máy thật, việc này khiến dữ liệu chỉ được giao cho ffmpeg theo
từng đợt lớn cách nhau đúng ~2 giây thay vì gần như liên tục. Ring buffer phía loa ESP32 (88200 byte,
~2.75s ở 16kHz) cạn kiệt giữa hai đợt, khiến `Speaker` component tự dừng — âm thanh thật sự phát ra chỉ
là những mảnh ~0.6-0.8 giây mỗi 2 giây, gần như không nghe ra được là có tiếng.

- `src/audioCapture.ts`: thêm `-fragment_size 1024` (input option, ép PulseAudio giao đoạn nhỏ ~32ms
  thay vì mặc định) và `-flush_packets 1` cho ffmpeg

## V2.9.10
### Sửa lỗi rò rỉ tiến trình ffmpeg khi thiết bị reconnect nhanh
Kiểm chứng trên máy thật ngay sau khi triển khai V2.9.9: `ps aux` bên trong container cho thấy **2 tiến
trình `ffmpeg` cùng chạy** đọc chung `chrome_out.monitor`. Nguyên nhân: `stopCapture()` đặt
`ffmpegProc = null` **ngay** sau khi gọi `.kill()`, không đợi tiến trình thật sự thoát. Khi thiết bị
disconnect/reconnect rất nhanh (đo thật: 309ms — không hiếm, đã thấy nhiều lần trong dự án do
`reconnect_ws()` firmware gọi ở nhiều chỗ), `startCapture()` gọi lại thấy `ffmpegProc == null` nên spawn
tiến trình MỚI trong khi tiến trình CŨ có thể chưa dọn xong — có lúc gây `ffmpeg thoát code=255` (giành
nguồn), có lúc (như lần đo được) cả hai tiến trình cùng sống sót, tiến trình cũ bị rò rỉ vĩnh viễn.

- `src/audioCapture.ts`: không còn null hoá `ffmpegProc` trong `stopCapture()` — chỉ handler `exit`
  (xác nhận tiến trình THẬT SỰ đã kết thúc) mới được phép null hoá và khởi động lại. Thêm cờ `stopping`
  để `startCapture()` biết cần đợi thay vì spawn chồng. Phân biệt thoát chủ động (do chính server
  `kill()` để khởi động lại nhanh, delay 200ms) và thoát ngoài ý muốn (lỗi thật, delay 3s tránh vòng lặp)

## V2.9.9
### Tính năng mới: âm thanh "như điện thoại" — chỉ P4
Bắt âm thanh Chrome đưa ra qua sink PulseAudio ảo (`chrome_out`, xem `docker-entrypoint.sh` mới),
phát lại qua WebSocket cho **đúng P4** — hai panel S3 không bị ảnh hưởng gì (không khai báo `speaker_id`
ở firmware thì không gửi `?audio=1`, server không bao giờ gửi `AudioFrame` cho chúng).

Kiến trúc: một tiến trình Chrome dùng chung như hiện tại (không tách theo thiết bị — đã xác nhận không
cần thiết vì chỉ có một đích duy nhất, xem `AUDIO-FEATURE-PLAN-2026-09-23.md` mục 7.6 ở repo Client),
một tiến trình `ffmpeg` bắt liên tục từ `chrome_out.monitor` (PCM 16-bit/16kHz/mono, không nén — không
cần codec nào chạy trên ESP32), đóng gói thành gói tin WebSocket mới (`AudioFrame`, MsgType=7), gửi
**thẳng** (không qua hàng đợi video) để tránh audio bị kẹt sau backlog ảnh khi mạng tải nặng.

- `docker-entrypoint.sh` (mới): khởi động PulseAudio (`--system`, sink ảo `chrome_out`, socket Unix)
  trước khi chạy lệnh chính — bọc cả đường chạy Docker thuần lẫn addon HA OS (`run.sh`)
  qua cơ chế ENTRYPOINT kế thừa
- `dockerfile`: cài thêm `pulseaudio`/`pulseaudio-utils` ở production stage
- `src/protocol.ts`: `MsgType.AudioFrame = 7`, `buildAudioFramePacket()`
- `src/broadcaster.ts`: `sendAudioFrame()` — gửi trực tiếp, không qua `_drainAsync`/hàng đợi video
- `src/config.ts`: `DeviceConfig.audioEnabled` (từ `?audio=1`, thiết bị tự báo qua firmware, không nằm
  trong `deviceConfigsEqual()` như `homeUrl`)
- `src/audioCapture.ts` (mới): quản lý tiến trình `ffmpeg` bắt audio, đóng khung ~40ms/gói, chỉ chạy khi
  có thiết bị đăng ký nghe (tiết kiệm CPU khi không cần)
- `src/index.ts`: đăng ký/hủy đăng ký nhận audio theo vòng đời kết nối WS mỗi thiết bị

## V2.9.8
### Sửa tiếp V2.9.7: bỏ UA override lộ nguyên chữ "HeadlessChrome"
Kiểm chứng trực tiếp trên máy thật sau khi triển khai V2.9.7 (bỏ hẳn `Emulation.setUserAgentOverride`)
phát hiện ngay vấn đề còn tệ hơn bản cũ: UA thật của Chrome ở chế độ `--headless=new` vẫn chứa nguyên
chữ **"HeadlessChrome/153.0.0.0"** — một trong những dấu hiệu automation lộ liễu và bị kiểm tra sớm
nhất bởi các hệ thống chống bot (khớp chuỗi "Headless" là kiểm tra rẻ và phổ biến). Bỏ override hoàn
toàn hoá ra tệ hơn override sai phiên bản.

Sửa đúng cách: gọi `Browser.getVersion()` để lấy **UA thật** của chính Chrome đang chạy (không hardcode
như bản trước 2.9.6 — đó là nguồn gốc lỗi lệch phiên bản), rồi chỉ thay chuỗi con `"HeadlessChrome"` →
`"Chrome"`, giữ nguyên mọi phần còn lại (kể cả số phiên bản thật). Nhờ vậy UA luôn tự khớp mỗi lần
Chrome trong image được cập nhật, không còn lệch phiên bản NHƯNG cũng không còn lộ "Headless".

- `src/deviceManager.ts`: thêm `getRealChromeUserAgentAsync()` (gọi `Browser.getVersion`, cache lại,
  thay thế chuỗi), áp dụng qua `Emulation.setUserAgentOverride` thay vì bỏ hẳn như V2.9.7

## V2.9.7
### Giảm dấu hiệu tự động hóa khiến Google chặn đăng nhập YouTube
Người dùng báo: khi thử đăng nhập YouTube thật trên panel, Google báo *"Không thể đăng nhập cho bạn.
Trình duyệt hoặc ứng dụng này có thể không an toàn"* — chặn tự động hóa (anti-bot) tiêu chuẩn của
Google, không phải lỗi của dự án theo nghĩa "bug", nhưng có 2 điểm góp phần làm tín hiệu automation rõ
hơn mức cần thiết:

1. **User-Agent bị ép cứng lệch phiên bản thật**: `Emulation.setUserAgentOverride` gán cố định
   `Chrome/120.0.0.0`, trong khi Chrome thật trong image (tự cập nhật liên tục qua apt) đang chạy
   `153.0.8010.36` — lệch 33 phiên bản. Client Hints (`navigator.userAgentData`) và hành vi JS thật
   vẫn báo đúng bản 153, chỉ riêng chuỗi UA nói dối — đây là dấu hiệu automation/scraper khá rõ (người
   dùng thật hầu như luôn chạy bản mới nhất). Không tìm được lý do kỹ thuật nào bắt buộc phải override
   (viewport đã `mobile: false` sẵn) — bỏ hẳn, để Chrome tự báo UA thật, tự khớp mọi lần Chrome trong
   image được cập nhật.
2. **`navigator.webdriver = true`** (xác nhận trực tiếp qua CDP) — tín hiệu automation rõ ràng nhất mà
   các trang chống bot (đăng nhập Google) thường kiểm tra đầu tiên. Thêm cờ khởi chạy Chrome
   `--disable-blink-features=AutomationControlled`.

**Không đảm bảo hết bị chặn**: kiến trúc dự án dựa hoàn toàn vào CDP (screencast, input, script tiêm)
nên không thể loại bỏ hết dấu hiệu automation, và Google còn nhiều tín hiệu chấm điểm rủi ro phía
server (thiết bị/vị trí đăng nhập mới lạ, v.v.) không thể giả mạo từ một addon tự lưu trữ. Nếu sau khi
cập nhật vẫn bị chặn, hướng đáng tin cậy hơn là **chuyển session cookie** từ một lần đăng nhập thật
trên trình duyệt cá nhân của người dùng vào profile Chrome của server, thay vì cố vượt qua chính bước
thử thách đăng nhập.

- `src/deviceManager.ts`: bỏ `Emulation.setUserAgentOverride` cố định
- `src/browser.ts`: thêm `--disable-blink-features=AutomationControlled` vào args khởi chạy Chrome

## V2.9.6
### Nút "Home" trong dropdown launcher vẫn thiếu dù firmware đã gọi `reconnect_ws()`
Sau khi vá race lúc khởi động ở V2.9.5 (firmware gọi `reconnect_ws()` ngay sau `set_home_url()`),
kiểm tra log thật vẫn thấy `[device] ✓ Launcher registered (chua co homeUrl...)` không đổi qua
nhiều lần thiết bị kết nối lại. Nguyên nhân: `homeUrl` **cố tình** không nằm trong
`deviceConfigsEqual()` (để đổi Home URL không phá Chromium target) — nhưng hệ quả là khi thiết bị
kết nối lại với `home=` khác, `ensureDeviceAsync()` thấy cấu hình "giống hệt", trả về session cũ
mà **không hề cập nhật `device.cfg`** — `homeUrl` bị kẹt vĩnh viễn ở giá trị của lần kết nối đầu
tiên (thường rỗng), bất kể firmware gọi `reconnect_ws()` bao nhiêu lần.

- `DeviceSession`: thêm `launcherScriptId` — lưu id của script launcher đã đăng ký qua
  `Page.addScriptToEvaluateOnNewDocument`, để gỡ ra và đăng ký lại được
- `ensureDeviceAsync()`: trong nhánh "cấu hình giống hệt", nếu `homeUrl` đổi thì tự tay
  `Page.removeScriptToEvaluateOnNewDocument` + đăng ký lại script mới (áp dụng cho lần tải trang
  kế tiếp), đồng thời `Runtime.evaluate` dọn nút/dropdown cũ và chạy lại script mới NGAY trên
  trang đang mở (không cần đợi reload) — không đụng đến Chromium target
- `buildLauncherScript()`: gắn `id` cố định cho nút và dropdown (`__rwv_launcher_btn`/
  `__rwv_launcher_panel`) để có chỗ bám mà gỡ khi cập nhật

## V2.9.5
### Sửa bàn phím ảo không hiện trên trang có Trusted Types CSP (vd đăng nhập Google)
Người dùng báo: chạm vào ô nhập trên trang đăng nhập YouTube/Google, bàn phím ảo không hiện lên
(trong khi Dashboard HA vẫn hoạt động bình thường). Điều tra bằng CDP trực tiếp trên trang đăng
nhập thật (`accounts.google.com`, không nhập thông tin đăng nhập) cho thấy `resolveInput()` vẫn
nhận diện đúng ô nhập, `checkAndShow()` vẫn chạy — nhưng `renderKeyboard()` ném `TypeError: Failed
to set the 'innerHTML' property... This document requires 'TrustedHTML' assignment` ngay từ dòng
`keyboardContainer.innerHTML=''`, làm crash `showKeyboard()` **trước khi** kịp thêm class
`vkb-visible` → bàn phím được tạo trong DOM nhưng không bao giờ hiện ra. `accounts.google.com`
bắt buộc Trusted Types (chặn gán chuỗi trực tiếp vào `innerHTML`), khác các trang thường.

- `deviceManager.ts`: `renderKeyboard()` đổi `innerHTML=''` sang vòng lặp
  `removeChild(firstChild)` — API DOM thuần, không bị Trusted Types chặn

### Icon dropdown launcher: chuyển sang SVG đơn sắc + sửa icon Home hay bị thiếu
Hai lỗi người dùng báo cùng lúc:
1. Icon Home/YouTube là emoji màu (🏠/▶️) — đổi sang SVG outline đơn sắc (`currentColor`, nền
   trong suốt), vẽ bằng `createElementNS` **không dùng `innerHTML`** (né đúng lỗi Trusted Types ở
   trên — hộp dropdown có thể hiện trên bất kỳ trang nào, kể cả trang đăng nhập).
2. Icon Home hay biến mất: `on_boot` (firmware) đợi `ws_connected` **rồi mới** gọi
   `set_home_url()` — nghĩa là lần kết nối WebSocket đầu tiên luôn thiếu `?home=` (giá trị còn
   rỗng lúc `build_ws_uri_()` chạy). `set_home_url()` chỉ lưu biến RAM, không tự gửi lại gì cả.
   Sửa ở firmware (repo Client): gọi `reconnect_ws()` ngay sau `set_home_url()` — cả trong
   `on_boot` (áp dụng lần đầu) lẫn `set_action` của `rwv_default_url` (áp dụng khi đổi Home URL
   sau này) — để buộc `build_ws_uri_()` chạy lại với giá trị đã đúng.

### Sửa đèn nền tắt khi đang mở YouTube dù chưa hết thời gian "luôn sáng"
`video_active` gộp chung điều kiện `is_video && is_receiving_frames(5000)` cho cả camera/stream
LẪN YouTube — đúng với camera (cần phát hiện mất kết nối) nhưng sai với YouTube: trang tĩnh (đang
đọc mô tả, lướt danh sách, video tạm dừng) không tạo frame mới liên tục nên `is_receiving_frames`
trả về false, khiến `inactivity_timer` vẫn tắt đèn sau thời gian đặt dù trang YouTube đang mở.

- Firmware (repo Client, cả P4 và S3 480x480): tách `is_youtube` khỏi `is_stream` — YouTube giữ
  đèn sáng **miễn là URL còn khớp `youtube.com`**, không đòi hỏi frame thay đổi liên tục; camera/
  stream vẫn giữ nguyên yêu cầu frame sống (an toàn khi mất kết nối camera)

### Vá lỗ hổng bảo mật phát sinh ngoài dự kiến: mật khẩu WiFi dạng plaintext trên máy thật
Trong lúc đối chiếu file đang chạy thật với repo, phát hiện 2 file YAML trên HASS
(`7inch-jc1060p470c-v2.yaml`, `guition-webview-4848s040.yaml`) đang chứa mật khẩu WiFi + mật khẩu
AP fallback dạng chữ thường (không dùng `!secret`) — khác bản trong repo. Đã thêm khoá
`ap_fallback_password` vào `secrets.yaml` và đổi cả 2 file về `!secret wifi_ssid` /
`!secret wifi_password` / `!secret ap_fallback_password`, khớp quy tắc bảo mật của dự án.

## V2.9.4
### Launcher: nút dropdown Home/YouTube trên góc màn hình
Tiêm thêm một script (cùng cơ chế `Page.addScriptToEvaluateOnNewDocument` đã dùng cho bàn phím
ảo) tạo nút mũi tên góc trên-phải, xổ xuống dropdown chọn "ứng dụng" — hiện tại gồm **Home** (về
`home_url` của thiết bị) và **YouTube** (`m.youtube.com` — bản mobile, phù hợp hơn với hệ thống
chỉ hỗ trợ chạm đơn, chưa có pinch-zoom). Tồn tại trên **mọi trang**, kể cả sau khi chuyển URL.

**`home_url` là cài đặt riêng từng thiết bị** (text "Home URL" trên ESPHome) — server không có
cách nào tự biết giá trị này. Thêm tham số kết nối mới `?home=` (thiết bị tự gửi, mã hoá phần trăm
đúng chuẩn), đọc vào `DeviceConfig.homeUrl` **nhưng cố tình không đưa vào `deviceConfigsEqual()`**
— đổi Home URL không được phép kích "Reconfiguring" phá huỷ Chromium target, đúng bài học đã ghi
ở dòng 49 `deviceManager.ts`.

- `config.ts`: thêm `DeviceConfig.homeUrl`, đọc từ `params.get("home")`
- `deviceManager.ts`: `buildLauncherScript(homeUrl)` — sinh script riêng từng thiết bị, tiêm ngay
  sau script bàn phím
- Firmware (repo Client): `RemoteWebView::home_url_` + `set_home_url()`, gửi qua
  `append_q_str_encoded_()` (percent-encode, không dùng `append_q_str_` cũ vì không an toàn với
  URL thật chứa `&`/`=`)

## V2.9.3
### Sửa lỗi đóng gói addon: `run.sh` chưa bao giờ được gọi
Phát hiện khi điều tra vì sao đổi `user_data_dir` qua giao diện addon không có tác dụng gì:
`docker inspect` cho thấy lệnh chạy thật của container là `[node dist/index.js]` — CMD gốc của
image nền, không phải `run.sh`. File `hassio/remote_webview_server/Dockerfile` trước đây chỉ có
`FROM ${BUILD_FROM}`, không `COPY run.sh` vào image cũng không đổi `CMD`/`ENTRYPOINT` — file này
tồn tại trong repo từ trước nhưng chưa từng được thực thi.

**Hậu quả thật:** mọi tuỳ chọn trên giao diện addon (`tile_size`, `jpeg_quality`,
`max_bytes_per_message`, `user_data_dir`, ...) trừ `browser_locale` không bao giờ được áp dụng, dù
hiện trên UI như đang hoạt động bình thường.

- `Dockerfile`: `COPY run.sh`, `chmod +x`, đổi `CMD` sang chạy nó
- `run.sh`: export đầy đủ các biến môi trường (đối chiếu trực tiếp với `env.get()`/`process.env.`
  trong từng file `src/*.ts`, không đoán tên)
- `run.sh`: đổi `jq` (**không có sẵn trong image** — đã xác minh `command -v jq` thất bại) sang
  `node -e` để đọc `options.json`. Giữ `jq` sẽ khiến addon crash ngay lúc khởi động dưới `set -e`,
  biến một lỗi "tuỳ chọn không có tác dụng" thành lỗi nghiêm trọng hơn nhiều
- `run.sh`: `mkdir -p` trước khi dùng `USER_DATA_DIR` — quan trọng khi lần đầu trỏ vào `/data`
  (mount bền), thư mục con chưa tồn tại
- `config.yaml`: đổi mặc định `user_data_dir` từ `/pw-data` (**không bền**, mất sạch mỗi lần
  container tạo lại — tức mỗi lần cập nhật addon) sang `/data/pw-data` (bền qua update/restart, do
  Supervisor tự cấp riêng cho addon này)

## V2.9.2
### Khung "nhắc vẽ lại" khi đánh thức bị bộ khử trùng lặp vứt bỏ
Triệu chứng người dùng báo: xem camera (chế độ truyền thẳng, nhịp khung cao) → Go Home về dashboard
→ màn ngủ → chạm màn hình → **đèn nền sáng nhưng dashboard không hiện ra**, phải chạm lần hai mới
lên.

`flushPending()` vứt khung ngay từ đầu nếu nó **trùng byte tuyệt đối** với khung trước đó (so
`hash32`) — kiểm tra này chạy **trước cả** nhánh xử lý khung đầy đủ đã yêu cầu. Khung "nhắc vẽ lại"
mà server tự tạo khi thiết bị `resume()` (một `<div>` 2×2px, độ mờ 0,4%, đổi màu — xem
`nudgeRepaintAsync` trong `browser.ts`) sau khi Chrome nén JPEG có xác suất rất cao trùng byte
tuyệt đối với khung tĩnh trước lúc ngủ. Hash trùng → `flushPending` trả về sớm → không bao giờ chạm
tới khung đầy đủ đã đặt sẵn → thiết bị kẹt "đèn sáng, màn trống" cho tới khi người dùng tự chạm thật
(đổi điểm ảnh đủ lớn để không thể trùng hash).

- `deviceManager.ts`: thêm `requestFullFrameFor(dev)` — gọi `processor.requestFullFrame()` **đồng
  thời** vô hiệu hoá `dev.prevFrameHash = -1` (`hash32()` luôn `>>> 0` nên `-1` không bao giờ trùng
  thật)
- Thay thế cả **5 điểm gọi** `requestFullFrame()` trực tiếp trong toàn server (4 trong
  `deviceManager.ts`, 1 trong `inputRouter.ts` — chính là đường mà `resume()` kích hoạt) bằng hàm
  này, đảm bảo khung kế tiếp không bao giờ bị vứt vì lý do trùng byte với khung trước, dù là trùng
  thật hay trùng ngẫu nhiên do khung nhắc quá nhỏ

Xác minh bằng đúng kịch bản thật (camera → Go Home → ngủ → chạm), lặp lại 2 lần: khung hình mới về
sau **53ms**, đèn nền bật sau **412ms** — dashboard sẵn sàng trước khi đèn kịp sáng.

## V2.8.0
### Đồng bộ URL hai chiều — sửa lỗi "Go Home không có tác dụng"
Trước đây URL chỉ đi **một chiều** (HA → thiết bị). Khi người dùng tự chạm chuyển tab trên
dashboard, server không theo dõi gì cả, nên thiết bị và HA đều giữ giá trị cũ.

Hậu quả người dùng gặp: nút **Go Home mất tác dụng**. Nó làm `text.set` với đúng giá trị đang có,
mà ESPHome chỉ kích `set_action` khi giá trị **thay đổi**.

- `protocol.ts`: thêm `MsgType.CurrentURL = 6` + `buildCurrentURLPacket()`
- `broadcaster.ts`: `sendCurrentURL(id, url)`
- `deviceManager.ts`: lắng nghe **cả hai** sự kiện điều hướng:
  - `Page.frameNavigated` — điều hướng đầy đủ (chỉ khung chính, bỏ qua iframe)
  - `Page.navigatedWithinDocument` — **điều hướng trong cùng trang**

Sự kiện thứ hai **không thể thiếu**: dashboard Home Assistant là ứng dụng một trang, chuyển tab
chỉ đổi URL bằng `history.pushState` chứ không tải lại. Chỉ bắt `frameNavigated` sẽ bỏ sót đúng
trường hợp thường gặp nhất.

Cơ chế này **có sẵn trong bản gốc của strange-v**; fork này đã lược mất.

Phía thiết bị cần firmware có `current_url_sensor` (xem repo Client).

## V2.7.9
### Giãn nhịp ép full-frame 60s → 5 phút, và sửa biến môi trường không có tác dụng
`refreshDisplaysTick` là **bảo hiểm** chống "màn hình giữ ảnh cũ", không phải cơ chế chính. Nhưng
mỗi lần chạy là một full-frame (~50KB) cho **mỗi** thiết bị — ở nhịp 60s đó là một cú sốc tải đều
đặn mỗi phút, và nó chính là thứ làm các phép đo dao động trong suốt buổi điều tra. Bản gốc của
strange-v **không có** cơ chế này.

Giờ đã có các tuyến phòng thủ khác (áp lực ngược, vòng điều tiết, `full_frame_every` của chính
FrameProcessor) nên bảo hiểm này chỉ cần chạy thưa thớt.

**Lỗi kèm theo:** `CCR_REFRESH_MS` **chưa bao giờ điều khiển được nhịp** — nó chỉ được đọc bên
trong hàm để làm cờ bật/tắt, còn nhịp thật bị ghi cứng `60_000` ở `index.ts`. Nay biến điều khiển
cả hai; đặt `CCR_REFRESH_MS=0` để tắt hẳn.

## V2.7.8
### Trả tỉ lệ ngân sách decode về 0.5
Đã thử 0.5 → 0.7 rồi trả lại. Với 0.7, đo thật trên tab 5 thẻ camera: fps lên 15.97 nhưng hệ
**dao động** — điểm cân bằng rơi vào vùng 50ms, mà ở đó decode (37ms) chỉ hơn ngân sách (35ms)
một chút, nên chỉ cần dao động nhỏ là lật qua lật lại. Áp lực ngược can thiệp 7 lần/7 phút và
quality kẹt ở sàn 40 — tức **xin thêm chất lượng mà nhận lại ít hơn**.

Ngưỡng tránh nghẽn (2.7.7) đã chặn được dao động đó, nhưng điểm cân bằng ổn định nhất vẫn là
**100ms / 10fps** — đúng bằng với tỉ lệ 0.5. Tức 0.7 không đổi lại được gì mà chỉ đẩy hệ tới sát
mép.

**Bài học:** tỉ lệ này không phải "mức dự phòng thừa" mà là **khoảng cách an toàn** tới vùng mất
ổn định.

Ngưỡng tránh nghẽn vẫn giữ nguyên làm lưới an toàn.

## V2.7.7
### Ngưỡng tránh nghẽn — chặn dao động vô hạn (tương tự `ssthresh` của TCP)
Sau khi nới tỉ lệ ngân sách lên 0.7, đo thật trên tab 5 thẻ camera cho thấy hệ **dao động vô
hạn**:

    50ms  → decode 37ms > ngân sách 35ms → quality 70→60→50→40 → giãn 100ms
    100ms → decode 32ms "rất thấp"       → rút lại về 50ms
    (lặp lại; áp lực ngược can thiệp 7 lần / 7 phút)

**Hai triệu chứng, một nguyên nhân.** Bộ điều tiết **không nhớ** rằng 50ms vừa thất bại nên cứ
lao xuống lại. Và vì hồi phục ưu tiên nhịp trước quality, dao động đó **chiếm hết các lượt hồi
phục** → quality kẹt vĩnh viễn ở sàn 40.

- `AdaptiveState.probeFloorMs` ghi nhớ nhịp vừa gây quá tải.
- Sàn hồi phục = `max(trần thiết bị, probeFloorMs + một bước)`.
- Nới dần: bị chặn `probeRetryAfter` (6) vòng mà vẫn rất thoải mái thì hạ ngưỡng một bước để thử
  lại — không có cơ chế này thì **một lần quá tải nhất thời sẽ khoá fps vĩnh viễn**.

Đã cân nhắc đảo thứ tự hồi phục thành quality-trước, nhưng **không cần**: khi nhịp bị ngưỡng chặn,
lượt hồi phục **tự nhường** cho quality. Nguyên nhân thật là thiếu tính trễ, không phải thứ tự.

## V2.7.6
### Hồi phục nhanh hơn 4 lần sau khi đổi tab
Người dùng phản ánh trực tiếp: sau khi chuyển tab, quality bò từ sàn 40 lên trần 80 mất **~4
phút** — 8 bước, mỗi bước cần 3 mẫu tốt liên tiếp **và** chờ 20 giây.

Nguyên tắc "hồi phục chậm" là đúng, nhưng đã đặt **chậm quá mức cần thiết**. Cơ sở để nới: điều
kiện "thoải mái" vốn đã đòi decode phải dưới **một nửa** ngân sách — tức khi nhánh hồi phục chạy
thì đã có gấp đôi dư địa; bò từng bước nhỏ trong tình huống đó là thừa thận trọng.

- `qualityStepUp` 5 → **10** (8 bước → 4 bước)
- `goodStreakNeeded` 3 → **2**
- `cooldownMs` (chỉ áp cho chiều NÂNG LẠI) 20s → **10s**

Tổng: từ 40 lên 80 còn **~1 phút**. Tính bất đối xứng vẫn giữ nguyên — hạ tải trễ 5s và nhân 2,
nâng lại trễ 10s và cộng dần. Rủi ro dao động vẫn được chặn bởi: vẫn cần mẫu tốt **liên tiếp**, và
vẫn kiểm tra tồn đọng socket.

Test: các khẳng định mã hoá cứng "3 mẫu" và "bước +5" nay **suy ra từ cấu hình**; thêm một test
ràng buộc **số bước** hồi phục từ sàn lên trần (chống hồi quy).

## V2.7.5
### Nới tỉ lệ ngân sách decode 0.5 → 0.7 (fps cao hơn)
Đo thật trên tab 5 thẻ camera: decode 40ms, nên với tỉ lệ 0.5 điểm cân bằng rơi đúng **100ms
(10fps)** — nhanh hơn nữa thì ngân sách (50 → 25ms) không còn đủ. Tỉ lệ **0.7** cho phép ~70ms
(≈14fps) mà vẫn còn **30% dự phòng**.

Đây là **giảm mức dự phòng**, nên chỉ làm sau khi đã có đủ lưới an toàn: áp lực ngược (2.6.0)
phản ứng tức thì, AIMD (2.7.0) lùi nhanh, khởi động thận trọng (2.7.4). Không nên nâng tiếp lên
0.8+ mà không đo lại.

Test: hai khẳng định cũ mã hoá cứng con số 50 (= 100 × 0.5) nay **suy ra từ cấu hình**, để lần
chỉnh sau không làm hỏng test.

## V2.7.4
### Khởi động thận trọng — sửa lỗi thiết bị "mất tích" trên HASS sau mỗi lần khởi động lại
Từ khi `min_frame_interval` đổi vai trò thành **trần fps mong muốn** (33ms = 30fps), mỗi lần
thiết bị **hoặc** server khởi động lại đều bắt đầu ngay ở trần đó và dội 30fps cho tới khi vòng
điều tiết kéo xuống (~55 giây).

Trong khoảng đó `loopTask` của ESPHome bị đói, thiết bị **không phục vụ nổi API** → kết nối HA dồn
đầy 10 khe `max_connections` → thiết bị "mất tích" trên HASS. Đã xảy ra thật.

→ Phiên mới khởi đầu ở `CCR_SAFE_START_MS` (mặc định 200ms = 5fps). Nhánh hồi phục (LIFO) sẽ rút
dần về trần mà thiết bị yêu cầu **khi nó chứng minh được là theo kịp**.

Nguyên tắc: **bắt đầu chậm, tự kiểm chứng rồi mới nhanh lên.** Đối xứng với AIMD ở 2.7.0 (hỏng thì
lùi nhanh) — cộng lại thành một vòng điều khiển an toàn ở cả hai đầu.

## V2.7.3
### Hạ chu kỳ xin số liệu 30s → 10s
Sau khi hạ chu kỳ vòng điều tiết về 5s (2.7.2), chính chu kỳ **xin số liệu decode** trở thành thứ
chặn tốc độ phản ứng: vòng điều khiển chạy 5s/lần nhưng vẫn đọc lại cùng một mẫu decode cũ cho
tới khi có mẫu mới.

Đo thật: hạ tải 7 bước mất **55 giây**, trong khi lý thuyết (tick 5s + trễ 5s) là ~35 giây.

## V2.7.2
### Hạ chu kỳ vòng điều tiết 15s → 5s
Đo thật trên 2.7.1: AIMD hoàn tất 7 bước hạ tải trong **90 giây**, không phải ~25 giây như tính
toán (bước đầu 14:26:56 → bước cuối 14:28:26).

Nguyên nhân: `runAdaptiveTick` chỉ chạy **mỗi 15 giây**, nên chính chu kỳ tick mới là thứ chi
phối — còn `cooldownDownMs` (5s) thêm ở 2.7.0 **gần như không có tác dụng** vì nó ngắn hơn chu kỳ
tick.

→ Hạ tick về 5s để `cooldownDownMs` thực sự có hiệu lực. Nhịp **nâng lại** không bị ảnh hưởng:
vẫn bị `cooldownMs` (20s) giữ chậm như cũ.

## V2.7.1
Giống hệt 2.7.0 về mã nguồn — chỉ tăng số hiệu để HA mời cập nhật lại.

Khi cập nhật lên 2.7.0, addon đã kéo về image `chrome-h264` **chưa kịp build xong**, nên tuy HA
hiển thị 2.7.0 nhưng mã chạy thật vẫn là 2.6.2 (kiểm chứng: `backoffInterval` xuất hiện 0 lần,
`markInteraction` 0 lần trong `/app/dist/`). Vì `config.yaml` đã ghi 2.7.0 và addon cũng đang ở
2.7.0, HA sẽ **không** mời cập nhật lại — nên phải tăng số hiệu.

**Chỉ bấm Update sau khi GitHub Actions đã build xong (xanh).** Số hiệu nằm trong `config.yaml`,
còn mã chạy thật nằm trong image do Actions build ở tag `chrome-h264` — hai thứ này không đồng bộ
với nhau.

## V2.7.0
### AIMD — giảm nhân, tăng cộng
Để dashboard mượt thì trần fps phía thiết bị phải nâng lên (100ms → 33ms, tức 30fps). Nhưng với
bước giãn cộng 50ms như cũ, đi từ 33ms đến 400ms mất **8 bước**; nhân với thời gian trễ là gần
**3 phút** thiết bị bị dội 30fps — đúng vùng đã gây crash.

- Giãn nhịp nay **nhân** `intervalBackoffFactor` (mặc định 2): `83 → 166 → 332 → 400`, **4 bước**.
- Hồi phục vẫn **cộng** từng bước 50ms như cũ.
- Thêm `cooldownDownMs` (5s) tách khỏi `cooldownMs` (20s): **hạ tải phản ứng nhanh, nâng lại
  vẫn từ tốn**.

Đây là nguyên tắc của mọi thuật toán chống nghẽn mạng, và lý do cũng y hệt: hỏng thì phải lùi
nhanh, hồi phục thì phải chậm.

### Ưu tiên độ mượt khi người dùng đang thao tác
Độ mượt chỉ thực sự quan trọng lúc **đang** vuốt/cuộn/bấm; tab camera treo tường thì 2.5fps không
ai để ý.

- Mỗi sự kiện chạm mở một cửa sổ `CCR_INTERACTION_BOOST_MS` (mặc định 2000ms).
- Trong cửa sổ đó server dùng **nhịp gốc** (trần fps thiết bị yêu cầu) thay vì nhịp đã điều tiết,
  hết cửa sổ thì trả về mức đã điều tiết.

## V2.6.2
### Sửa lỗi điều nhịp — nhịp thực tế co lại còn bằng thời gian encode
Đo thật sau 2.6.1: bộ điều tiết đặt `minFrameInterval=400` (lẽ ra 2.5fps) nhưng server vẫn gửi
**3.93fps** — nhanh hơn 57% so với nhịp đã đặt.

`flushPending` xoá `throttleTimer` **ngay đầu hàm**, nhưng `lastProcessedMs` chỉ cập nhật ở
**cuối** — sau ~200ms encode. Trong khoảng trống đó, khung screencast mới đến thấy
`throttleTimer` rỗng **và** `since` đã lớn hơn nhịp → `delay = 0` → chạy ngay. Nhịp thực tế co
lại còn bằng thời gian encode thay vì `effInterval`.

→ Đánh mốc `lastProcessedMs` ngay khi **bắt đầu** xử lý. `finally` vẫn ghi đè bằng thời điểm kết
thúc, nên nhịp vẫn được tính từ lúc xong khung trước — đúng như thiết kế.

## V2.6.1
### Bộ điều khiển thích nghi tự vô hiệu hoá chính nó — sửa hai lỗi
Đo thật trên ESP32-P4 (tab 5 thẻ camera): nhật ký cho thấy vòng điều khiển đã hạ tải tới **kịch
sàn** (quality 70→40, nhịp 100→400ms), nhưng `/metrics` **cùng lúc đó** vẫn báo
`minFrameInterval=100`, `jpegQuality=70`, `adaptiveChanges=0`. Hai lỗi chồng nhau:

**1. Điều tiết ghi đè lên `cfg` — tự phá huỷ phiên thiết bị mỗi lần nối lại.**
`runAdaptiveTick` ghi thẳng vào `device.cfg.minFrameInterval`. Nhưng `cfg` là bản sao **duy nhất**
của "thiết bị yêu cầu gì" (từ tham số URI). Ghi đè nó làm `deviceConfigsEqual()` sai ngay lần nối
lại kế tiếp (cfg=400 vs URI=100) → nhánh `Reconfiguring` → `deleteDeviceAsync()` → **dựng lại cả
target Chromium**. Tức là chính hành động điều tiết tự bảo đảm phiên thiết bị sẽ bị phá huỷ.

→ `cfg` nay **bất biến**; giá trị đã điều tiết nằm ở `tunedMinFrameIntervalMs`.

**2. `adaptiveStates` không bao giờ được dọn.**
Phiên mới của cùng một thiết bị thừa kế trạng thái "đã kịch sàn" của phiên cũ → `decideAdaptive`
trả `changed=false` → **không giá trị nào được áp vào cfg mới**. Thiết bị chạy full tải vĩnh viễn
còn vòng điều khiển thì tưởng mình đã hạ tải xong.

→ `deleteDeviceAsync()` nay xoá luôn trạng thái thích nghi.

## V2.6.0
### Áp lực ngược theo `bufferedAmount` của WebSocket
Server trước đây gửi **vô điều kiện**, không bao giờ nhìn `bufferedAmount`. Thư viện `ws` của
Node đệm **không giới hạn** trong RAM khi phía nhận chậm, nên khi thiết bị không giải mã kịp thì
server vẫn dồn tiếp — thiết bị càng ngộp mà server không hề biết.

Đo thật trên ESP32-P4 với tab 5 thẻ camera: trong **200 giây** thiết bị vứt **1720 gói** vì hàng
đợi decode đầy, chỉ vẽ trọn **1 khung**. Kết nối API của ESPHome cũng bị reset liên tục.

- `broadcaster.backlogBytes(id)` — số byte còn kẹt trong bộ đệm gửi của socket.
- `flushPending` bỏ **nguyên khung** khi tồn đọng vượt ngưỡng (mặc định 192KB, đổi bằng
  `CCR_WS_HIGH_WATER`).
- **Phải chặn TRƯỚC `processFrameAsync()`**: nếu bỏ khung ở tầng broadcaster thì FrameProcessor
  đã tính sai phân xong và coi như thiết bị **đã nhận** các tile đó — vùng ảnh ấy hỏng vĩnh viễn
  cho tới full-frame kế tiếp. Bỏ ở đây thì nền so sánh giữ nguyên, khung sau vẫn diff đúng.
- Bỏ nguyên khung (không bỏ một phần) để không bao giờ sinh khung rách.

### Bộ điều khiển thích nghi dùng được tồn đọng làm tín hiệu
Trước đây vòng điều khiển chỉ dựa vào `decodeMs` do **thiết bị báo về**. Nhưng khi quá tải nặng
thì chính gói `FrameStats` cũng không lọt — tức là **mù đúng lúc cần nhất**.

- Thêm `backlogBytes` vào `AdaptiveSample`, `maxBacklogBytes` vào cấu hình.
- Xét **trước** nhánh "chưa có số đo decode".
- Còn tồn đọng thì **không hồi phục** dù decode nhanh.

### Sửa lỗi bánh cóc — nhịp frame không bao giờ hồi phục
Nhánh hồi phục chỉ nâng lại `quality`, không bao giờ rút ngắn `minFrameIntervalMs`. Hậu quả: tab
nặng ép nhịp 100ms → 400ms, rồi khi chuyển sang tab nhẹ thiết bị **vẫn kẹt ở 2.5fps vĩnh viễn**.

- Thêm `baseIntervalMs` (nhịp gốc thiết bị yêu cầu từ YAML).
- Hồi phục theo thứ tự **ngược** với lúc hạ tải (LIFO): rút nhịp về mức gốc trước, hết mới nâng
  quality. Không bao giờ vượt quá nhịp gốc.

## V2.5.0
### Bỏ nén JPEG hai lần — chuyển thẳng ảnh của Chrome khi đang phát video
Đường cũ nén JPEG **hai lần**: Chrome encode JPEG → `sharp` giải nén ra RGBA → FrameProcessor
encode lại. Tốn CPU cả hai đầu và mất chất lượng thế hệ thứ hai. (Lưu ý: `encodeMs` trong
`/metrics` đo SAU bước `sharp` decode, nên chi phí giải nén trước đó chưa từng được tính.)

Khi đang phát video thì gần như khung nào cũng đổi toàn bộ, tức kiểu gì cũng gửi full-frame —
lúc đó ảnh của Chrome dùng được ngay. Nay server **chuyển thẳng**, bỏ cả decode lẫn encode.

- Nhận biết "đang phát video" bằng **nhịp đến của screencast** (>= `PASSTHROUGH_MIN_FPS`, mặc
  định 8 fps, tính trên 6 khung gần nhất) — không dùng kết quả của FrameProcessor vì muốn biết
  kết quả đó thì đã phải giải nén rồi.
- Điều kiện: nhịp đủ cao · không xoay · kích thước JPEG khớp đúng màn hình (đọc bằng
  `sharp().metadata()`, chỉ đọc header) · vừa `maxBytesPerMessage`.
- Sau mỗi lần đi đường tắt, gọi `requestFullFrame()` để khung kế tiếp đi đường thường dựng lại
  nền so sánh cho đúng (bảng băm tile không được cập nhật khi đi đường tắt).
- Đặt `PASSTHROUGH_MIN_FPS=0` để tắt hẳn.

### Chất lượng screencast chọn theo từng thiết bị
Thiết bị có `maxBytesPerMessage >= 128KB` (đi được đường tắt) nay cho Chrome encode thẳng ở
`jpeg_quality` của chính thiết bị đó, thay vì luôn q90. Vì với chúng ảnh của Chrome CHÍNH LÀ
ảnh gửi đi — để q90 thì khung nặng hơn ~33%, và khi bị chặn băng thông thì fps tụt.

Thiết bị cap nhỏ (S3 32KB) không bao giờ đi được đường tắt nên **giữ nguyên q90**: chúng luôn
phải giải nén rồi nén lại theo tile, hạ nguồn xuống q60 sẽ thành nén hai lần ở q60 = ảnh xấu đi.

### Số đo thật (ESP32-P4 1024x600, trang động toàn khung)
| | Trước | Sau |
|---|---|---|
| fps | 26,42 | **30,29** |
| encode trên server | 18,86 ms | **0,00 ms** |
| byte/frame | 26.073 B | 23.355 B |
| số lần nén JPEG | 2 | **1** |

0 frame bị bỏ · 0 frameErrors · 0 oversizeDropped · 0 qualityFallbacks.

## V2.4.2
### Ép vẽ lại khi thiết bị xin hiển lại trang (chống kẹt ảnh cũ/ảnh đen)
- Trước đây khi URL KHÔNG đổi, server chỉ `requestFullFrame()` — nhưng với trang TĨNH thì
  không có frame nào được sinh ra, nên `requestFullFrame()` vô hiệu và thiết bị vẫn kẹt ảnh
  cũ (màn hình trắng chỉ sáng đèn nền).
- Nay server chèn 1 điểm 2x2px gần như trong suốt và đổi màu -> Chromium buộc phải vẽ lại ->
  screencast sinh frame -> gửi full-frame mới cho thiết bị. Điểm này vô hình với người dùng.

## V2.4.1
### Chống "màn hình trắng" (chỉ sáng đèn nền)
- Ca thực tế: sau khi server restart/update, thiết bị giữ ảnh cũ (hoặc ảnh đen) và không có
  frame mới nào để tự vẽ lại -> màn hình trắng. Nhất là khi lệnh "mở trang" ban đầu bị mất.
- Thêm bảo hiểm phía server: **60s/lan ép gửi 1 full-frame** cho mỗi thiết bị (`CCR_REFRESH_MS`,
  đặt 0 để tắt). Kèm với sửa phía component (tự gửi lại URL khi không nhận frame > 60s) đã nạp
  cho các panel -> màn hình luôn tự khôi phục.

## V2.4.0
### GĐ3.5 - telemetry RAM của thiết bị + phanh an toàn theo heap
- Gói `FrameStats` từ thiết bị nay có thể chứa thêm `heap_free` + `psram_free` (18 byte);
  server VẪN đọc được gói 10 byte của firmware cũ (tương thích ngược).
- `/metrics` thêm `deviceHeapFree`, `devicePsramFree`.
- Bộ điều khiển thích nghi có thêm "phanh": heap nội bộ thiết bị < 25 KB → hạ chất lượng
  (hoặc giãn nhịp) ngay, không chờ decode vượt ngân sách — thà giảm chất lượng còn hơn
  tràn RAM gây reboot.

## V2.3.0
### GĐ3 - vòng điều khiển thích nghi (tự chỉnh theo số đo thật)
- Mỗi thiết bị được tự chỉnh CHẤT LƯỢNG JPEG và NHỊP GỬI FRAME theo thời gian decode mà
  chính thiết bị báo về (FrameStats) + bytes/s:
  - decode vượt ngân sách (nhịp × 0.5) → giảm quality 10 mỗi bước, chạm sàn 40 thì giãn nhịp +50ms;
  - decode rất thấp (dưới nửa ngân sách) và mạng không căng → nâng lại +5 sau 3 mẫu tốt liên tiếp;
  - có thời gian trễ 20s giữa 2 lần chỉnh để tránh dao động.
- Tắt bằng `CCR_ADAPTIVE=0`. Xem trạng thái trong `/metrics`: `avgDecodeMs`, `recentMaxDecodeMs`,
  `appliedQuality`, `appliedMinFrameIntervalMs`, `adaptiveChanges`, `lastAdaptiveReason`.

## V2.2.0
### GĐ2 - giảm chi phí decode trên thiết bị (mượt hơn)
- Full-frame: gửi CẢ KHUNG trong MỘT ảnh JPEG khi vừa giới hạn bytes (thay vì chia 4 mảnh)
  -> thiết bị chỉ decode 1 lần. Không vừa thì tự quay về cách chia mảnh cũ.
- Đo được thời gian decode THẬT của thiết bị: server định kỳ 30s hỏi FrameStats,
  `/metrics` trả thêm `avgDecodeMs` / `lastDecodeMs` cho từng màn.

## V2.1.0
### Sửa lỗi màn hình đỏ (quan trọng)
- Trước đây khi 1 vùng ảnh vượt `max_bytes_per_message`, server thay vùng đó bằng MỘT KHỐI ĐỎ
  toàn khung - gặp nhiều nhất ở panel có `full_frame_tile_count: 1` (JC4827 480x272, JC1060P470 1024x600).
- Nay: tự hạ quality (x1 -> x0.75 -> x0.55 -> x0.35, sàn 20) rồi chia nhỏ vùng ảnh (2x2, đệ quy)
  để vừa giới hạn bytes; cùng đường thì bỏ qua vùng đó (giữ nội dung cũ). KHÔNG bao giờ gửi khối đỏ.
### Thêm
- `GET :18080/metrics`: số liệu thật (fps, bytes, encode ms, số lần hạ quality/chia nhỏ, lỗi, số client).
- Sửa self-test: file `self-test/test1.html` chưa được copy vào image nên tính năng self-test không chạy.

## V2.0.6
### Thêm hỗ trợ bàn phím Tiếng Việt
### Fix lỗi không hiện bàn phím

## V3.0.0
### Fix màn hình trắng khi mới cấp nguồn lần đầu

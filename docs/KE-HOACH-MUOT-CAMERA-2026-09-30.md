# Kế hoạch: gỡ trợ lý giọng nói, chỉnh sáng camera, làm mượt video/âm thanh

Ngày lập: 30/09/2026. Người dùng yêu cầu:
- gỡ trợ lý giọng nói và tự đánh thức;
- chỉnh camera: chỗ tối thì quá tối, sáng thường thì chói, ngược sáng có bóng đèn thì lóa cả khung;
- làm mượt video + âm thanh, nhất là **YouTube TV** (truyền từ điện thoại).

## 0. Trạng thái mã nguồn lúc lập kế hoạch

| | Bản | Ghi chú |
|---|---|---|
| Server (addon) | **2.9.63**, `main` @ `f44350c` | 46 commit mới từ phiên khác: OS-3…OS-6, Cài đặt, màn hình chờ/khung ảnh, thông báo, chuông cửa, YouTube TV (DIAL), trợ lý giọng nói trên Shell, bộ thử tích hợp |
| Firmware P4 | nhánh **`claude/two-repo-research-3ulwjd`** @ `1560305` | **Chưa merge vào `main`**. YAML trên HASS lấy mọi component thẳng từ nhánh này (`refresh: 0s`) |
| YAML P4 chuẩn | `/config/esphome/7inch-jc1060p470c-v2.yaml` trên HASS | Bản sao gần khớp: `ci/p4.yaml` (29 dòng khác). `examples/Guition-JC1060P470C-P4.yaml` **đã cũ** (205 dòng khác) |

## 1. Số liệu đo thật (30/09, P4 1024×600)

| Phép đo | Kết quả |
|---|---|
| YouTube thường (`watch?v=pAnTNJaVhcs`), 60 s | panel **29,4 fps**, 33,8 KB/khung, ~1 MB/s, giải mã TB 18,4 ms, **44 khung bị bỏ vì nghẽn socket**, video YouTube chỉ **240p** |
| CPU P4 lúc đó (task_stats) | lõi 0: 53%, lõi 1: 59% — websocket 25%, giải mã 18%, WiFi (tiT+sdio) ~40%. **Trợ lý/AEC không có trong bảng** |
| CPU addon lúc đó | **~270%** (Chrome phần mềm + nén ảnh) |
| Addon khi không phát gì | ~25–50% CPU, **8 tab Chrome**, trong đó **3 tab `cam.html` giải mã luồng camera liên tục ở nền**, 2 tab YouTube TV |
| Máy HASS | RAM trống **182 MB**, **swap 2,75 GB đang dùng** (Frigate 2,6 GB, addon 1,8 GB, HA 1 GB) |
| Âm thanh phía server (`[audio-diag]`) | Sạch: 750 khung/30 s, 0 lần cắt, trễ nhịp tối đa ~60 ms |
| Trạng thái trợ lý trên P4 | "Tự đánh thức" = **Tắt**, AEC = **Tắt**, dò người = **Tắt** → hiện không ăn CPU |
| YouTube TV | Liên kết sâu `youtube.com/tv#/watch?v=` bị giao diện TV bỏ qua → **chưa đo được** khi không có điện thoại truyền. Log thật: màn hình chờ từng hiện đè lên tab YouTube TV |

**Kết luận chính**: P4 **không** phải nút thắt (còn ~45% rảnh). Giật đến từ:
1. **Máy chủ quá tải**: Chrome giải mã video bằng CPU, cộng các tab nền vẫn chạy (camera), cộng **thiếu RAM → swap**.
2. **Nghẽn đường truyền**: khung ~34 KB vượt trần gói 32 KB của P4 → không đi được đường tắt, phải nén lại; bỏ ~44 khung/phút.
3. YouTube TV phát **toàn màn hình**: mọi khung đổi 100% diện tích (YouTube thường chỉ ~39%), video 720p30 giải mã phần mềm.
4. Âm thanh: server gửi đều → nếu giật thì ở phía P4 (gói tiếng đi chung task với khung ảnh) — **cần đo** bộ đệm loa.

Camera: driver OV02C10 **khóa cứng phơi sáng** (`OV02C10_EXPOSURE_OVERRIDE 1`: phơi sáng = VTS−8 ≈ 200 ms ở 5 fps, độ lợi số ×2). Không có vòng tự chỉnh sáng. Hệ quả đúng như người dùng mô tả: tối vẫn tối, sáng thì cháy, đèn trong khung lóa cả hình.

## 2. Các bước

Mỗi bước: làm → đo lại (đo ngắn ~60–90 s) → báo người dùng → mới sang bước sau.

### A. Gỡ trợ lý giọng nói + tự đánh thức (firmware P4)
- YAML: bỏ `micro_wake_word`, `voice_assistant`, script `apply_wake_word`, select "Tự đánh thức"/Assistant, mọi `remote_webview.voice_state`.
- `mic_aec` (AEC) không còn ai dùng → đề xuất bỏ khỏi YAML luôn (giữ mã component trong repo cho liên lạc 2 chiều sau này). **Cần người dùng chốt.**
- `remote_webview`: gỡ `on_assist`, `voice_state`, cờ `?va=1` (server tự ẩn nút Trợ lý khi firmware không báo `va`).
- Giữ `remote_webview.presence` + `camera_motion` (dò người) — người dùng không yêu cầu gỡ; hiện đang tắt.
- Server: gỡ thẻ trợ lý trên Shell + `voice.itest.ts` (không bắt buộc cho độ mượt — dọn sau cùng).
- Đồng bộ YAML sang `ci/p4.yaml`, cập nhật `examples/` cho khớp YAML thật.
- Đo: RAM trong/PSRAM P4 trước/sau, fps YouTube.

### B. Tự chỉnh sáng cho camera (driver OV02C10 + IPA của ESP32-P4)
- Driver: hỗ trợ đặt **thời gian phơi sáng** (0x3501/0x3502, theo dòng) và **độ lợi analog/số** (0x3508/09, 0x350a–c) qua `set_para`/`query_para_desc` đúng kiểu `esp_cam_sensor` (EXPOSURE_US, GAIN + bảng gain). Tắt `OV02C10_EXPOSURE_OVERRIDE`. Bỏ `set_AE_target` cũ (thanh ghi 0x3a0x là của OV5640, OV02C10 không có).
- Thêm file IPA JSON cho OV02C10 (dựa trên `cfg/sc202cs.json` đã có): `agc.mode = high_light_priority` (đo sáng trọng số giữa, chống cháy vùng đèn), `luma_adjust.target` ~60–65, chống nhấp nháy 50 Hz, đường gamma; khai báo qua cơ chế `CUSTOMIZED_IPA_JSON` giống SC202CS.
- Giữ 5 fps (phơi sáng tối đa 200 ms vẫn đủ cho phòng tối); tùy chọn bù sáng (`exposure_compensation`) ra YAML/HA nếu cần.
- Đo: chụp khung từ go2rtc ở 3 cảnh (phòng tối, sáng thường, có bóng đèn trong khung) → độ sáng trung bình + % điểm ảnh cháy, trước/sau. Rủi ro: thanh ghi sai → hình đen/cháy; lối lui = bật lại `EXPOSURE_OVERRIDE`.

### C. Làm mượt (server)
1. **Đóng băng tab nền** (`Page.setWebLifecycleState frozen`) — trừ tab đang phát nhạc nền; bật lại khi chuyển tới. Nhắm: CPU addon lúc rảnh ↓ mạnh (3 tab camera đang chạy ngầm).
2. Tab camera (`cam.html`, lưới camera): dừng luồng khi rời tab / đóng hẳn tab khi rời (mở lại rẻ).
3. **Trần gói P4**: khung video ~34 KB > trần 32 KB → thử `max_bytes_per_msg` 49152/65536 trên P4 (đo RAM WebSocket) hoặc hạ chất lượng screencast khi video → đi được đường tắt, hết nén lại.
4. **YouTube TV**: đo bằng lần truyền thật từ điện thoại người dùng (cần người dùng bấm truyền trong lúc đo); thử trần 480p thay 720p; kiểm tra màn hình chờ không hiện khi đang truyền; toàn màn hình → dùng chế độ khung nửa độ phân giải khi phù hợp.
5. Âm thanh P4: đo bộ đệm loa hụt/trễ khi phát YouTube (công cụ ở bộ nhớ `p4-audio-crackle`); nếu hụt → tách gói tiếng khỏi hàng đợi khung ảnh / ưu tiên cao hơn.
6. Hiện tượng lạ cần xác minh: đặt "URL hiển thị" của P4 thì màn S3 480×480 (`esp32-28372f8a0218`) cũng mở theo.

### D. RAM máy HASS (swap 2,75 GB)
- Sau C1–C2 đo lại RAM addon; cân nhắc `MAX_APP_TABS` 2 → 1.
- Frigate dùng 2,6 GB — xem cấu hình (số camera, độ phân giải detect). **Cần người dùng chốt** vì ảnh hưởng hệ thống ngoài dự án.

### E. Dọn nhánh
- Khi A–C ổn: merge `claude/two-repo-research-3ulwjd` vào `main` repo client, đổi YAML HASS về `ref: main` (hoặc tag ổn định), chốt Bản Ổn định mới (có hỏi người dùng).

## 3. Quyết định của người dùng (30/09/2026)
1. **Gỡ luôn AEC** (`mic_aec`) khỏi YAML P4 (giữ mã component trong repo).
2. **Đồng ý đóng băng tab nền** (trừ tab đang phát nhạc/radio nền); tab camera dừng luồng khi rời.
3. **Không đụng tới Frigate** — mục D chỉ tối ưu trong phạm vi addon + firmware.
4. ~~Thứ tự C → A → B~~. **Đổi (30/09, sau)**: làm **C (mượt server) + B (camera)** trước, đo lại; nếu ổn thì **KHÔNG gỡ A** (giữ trợ lý giọng nói, tự đánh thức, AEC) mà tối ưu để chúng chạy nhẹ. Quyết định 1 (gỡ AEC) chỉ áp dụng nếu sau cùng vẫn gỡ A.
5. Đo YouTube TV: người dùng bấm truyền từ điện thoại khi được báo.

## 4. Kết quả (30/09/2026)

### C — làm mượt server (2.9.64 → 2.9.66)
| | Trước | Sau |
|---|---|---|
| CPU addon lúc rảnh (sau khi mở vài ứng dụng rồi về HA) | ~32% | **8–10%** |
| Timer trong tab nền | chạy đủ (50/5 s) | **0/5 s** (tạm dừng JS bằng debugger) |
| Tab camera ở nền | 3 tab giải mã liên tục | **đóng khi rời** |
| YouTube 60 s (P4) | 29,4 fps, CPU addon ~270% | 29,9 fps, CPU addon ~190% (lượt không quảng cáo) |
| Quay lại YouTube sau khi chuyển ứng dụng | **3,5 fps** hơn 1 phút (điều tiết nhảy 50→400 ms) | **24,9 fps** (dao động 33–75 ms) |

- 2.9.64: `Page.setWebLifecycleState frozen` — **không có tác dụng** (Chrome bỏ qua với tab "hiển thị"; headless coi mọi tab là hiển thị). 2.9.65 thay bằng `Debugger.pause` + test tích hợp chứng minh.
- 2.9.66: bộ điều tiết — bước giãn nhịp tối đa ×2; ước lượng băng thông giảm tối đa 40%/lần nghẽn; tự nâng 15%/5 s.
- **Không đổi** trần gói P4 32 KB: lịch sử ghi rõ gửi khung lớn từng gây treo watchdog P4 (17/09).
- Chặn màn hình chờ khi đang truyền YouTube TV (log thật từng hiện đè).

### B — camera (firmware nhánh `claude/two-repo-research-3ulwjd` @ `e28a42b`, đã nạp P4)
- Driver OV02C10: phơi sáng (dòng) + bảng gain ×1…×31 + `tline_ns` (trước = 0) → IPA của ESP32-P4 tự phơi sáng
  (AGC `high_light_priority`, gamma), cấu hình mục `OV02C10` trong `cfg/sc202cs.json`.
- Cùng góc camera, ban ngày: sáng TB **24 → 111/255**, điểm gần đen **47% → 0%**, cháy 2,3%.
- Còn lại: ảnh hơi nhạt/thiếu tương phản; vùng tối ngả tím (chưa trừ mức đen cảm biến). Cần thử cảnh tối và có đèn.

### YouTube TV — đo lần truyền thật 30/09 (server 2.9.66)
- Hình: 22,6 fps, ~9 lần/s nén lại khung (toàn màn hình, khung vượt 32 KB), CPU addon ~285%, nguồn **240p**
  (Chrome giải mã đủ 30 khung/s, không bỏ khung — YouTube tự chọn chất lượng).
- Tiếng: sạch. Server 750/750 gói/30 s, 0 cắt; P4 nhận 750/750, 0 rơi, loa từ chối 640 B; 33 lần gói đến trễ > 80 ms
  (tối đa 139 ms) — bộ đệm loa 250 ms vẫn chịu được.
- **2.9.67** (người dùng đồng ý): riêng tab YouTube TV, nguồn ≤ 360p → khung nửa độ phân giải (`YT_TV_HALF_MAX_H`).
  **Chưa đo lại** — cần người dùng truyền lần nữa.

### Trợ lý giọng nói — GIỮ (người dùng chọn 30/09), tạm dừng khi đang phát
- Server 2.9.67 gửi `DeviceControl Media=7` khi tab đang hiện / nhạc nền đang phát (test tích hợp `media.itest.ts`).
- Firmware: trigger `on_media_playing` (nhánh client @ `5634f8d`), YAML: cờ `media_busy`, dừng/bật lại tự đánh thức.
- Đo trên P4: chọn Hey Jarvis → bật ngay; mở YouTube → dừng đánh thức (giải phóng bộ đệm); về HA → bật lại.
- Sửa kèm lỗi có sẵn: chọn "Tự đánh thức" từ HA không có tác dụng ngay (set_action chạy trước khi select ghi nhận).
- Chưa thử riêng trường hợp radio/nhạc nền (chỉ có tín hiệu Media, không có `video_active`).

### Còn lại
- Đo lại YouTube TV sau 2.9.67 (người dùng truyền).
- Camera: màu nhạt, vùng tối ngả tím — người dùng: "chỉnh sau".

### Dò người bằng camera (30/09, firmware nhánh client @ camera_motion mới)
- **Chưa bao giờ chạy** trước đây: camera chỉ giao khung cho bộ dò khi `keep_camera_on` (YAML không đặt). Đã sửa.
- Bật lên thì báo nhầm liên tục (cảnh trống 1,7–2,5% ô đổi do nhiễu hạt khi tự phơi sáng tăng gain). Sửa: ô lấy trung
  bình 4×8 điểm, chỉ đếm ô đổi có ≥ 2 ô kề cũng đổi, so 5 lần/s → cảnh trống **0,00%**, 266–302 lần so/phút.
- Đây là **dò chuyển động**, không phải nhận diện người. Nhận diện người thật (AI) đã có ở Frigate:
  `binary_sensor.p4_panel_person_occupancy` (camera P4, detect 960×536 @ 5 fps, track person).
- Góc camera hiện tại ngửa lên mái nhà — khó thấy người đi lại.

### Tải P4 khi bật dò chuyển động + AEC + tự đánh thức (30/09)
| Cảnh | Lõi 0 | Lõi 1 | Ghi chú |
|---|---|---|---|
| Rảnh ở HA, trước (tất cả tắt) | ~6,5% | ~5% | |
| Rảnh ở HA, bật hết | 42,8% | 19,7% | mww (đánh thức) 20,8%; camera (có bộ dò) 4,4% (trước ~1%) |
| YouTube, bật hết | 64% | 67% | 24,1 / 26,2 fps (2 lượt; không bật: 26,7–29,9) — mww/AEC tự dừng, không có trong bảng |

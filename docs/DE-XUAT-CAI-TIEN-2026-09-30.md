# Nhận định và đề xuất cải tiến — toàn dự án (30/09/2026)

Dựa trên toàn bộ tính năng hiện có của server 2.9.68 và firmware nhánh `claude/two-repo-research-3ulwjd`, cùng số
đo thật trên 3 màn hình (P4 1024×600, S3 480×480, S3 480×272).

## 1. Hiện trạng tóm tắt

| Mảng | Đã có | Chất lượng hiện tại |
|---|---|---|
| Hiển thị | Chrome ẩn → ô JPEG → WS, điều tiết AIMD, đường tắt, nửa độ phân giải (YouTube TV), dải khung thẳng vào framebuffer (P4) | P4 ~25–30 fps YouTube; S3 dashboard tốt, video yếu (giải mã phần mềm) |
| Giao diện "OS" | Shell, cử chỉ mép, màn hình chính kéo thả/thư mục/dock, Gần đây, Cài đặt trên panel, màn hình chờ/khung ảnh, thông báo, chuông cửa, bảng tin, chào buổi sáng | Đầy đủ; mỗi ứng dụng một tab, tab nền tạm dừng JS (2.9.65) |
| Ứng dụng | HA, camera (P4/lưới go2rtc), cảnh, phòng, điều khiển, việc cần làm, solar, YouTube/TikTok/Nhạc/YouTube TV (truyền DIAL), radio VOV, tin tức, media, thời tiết, lịch âm, hẹn giờ, trình duyệt | Chạy được; YouTube tự chọn **240p** |
| Âm thanh | PCM 16 kHz tới P4, khoá tiếng theo tab, tiêu điểm âm thanh, loa TTS | Sạch (0 cắt, 0 rơi gói) |
| Giọng nói | micro_wake_word + voice_assistant + AEC, thẻ trợ lý trên Shell | Tự tạm dừng khi phát media (2.9.67) |
| Camera P4 | OV02C10 → H.264 1080p → Frigate; tự phơi sáng IPA (30/09); dò chuyển động; phát hiện khuôn mặt ESP-DL (chỉ khi màn tắt) | Màu còn nhạt/vùng tối ngả tím; khuôn mặt chưa thử với người thật |
| Vận hành | /metrics, tuning nóng, 123 test đơn vị + 29 test tích hợp Chromium thật, CI firmware P4 | Tốt ở server; firmware chỉ CI cho P4 |

## 2. Nhận định (vấn đề gốc, xếp theo tác động)

1. **Máy chủ dựng hình bằng CPU.** Chrome dùng `ANGLE_SWIFTSHADER` (phần mềm) dù `/dev/dri` (GPU Intel UHD 630 của
   i5-8500T) đã có trong container. YouTube 240p ngốn ~190–270% CPU addon; YouTube TV ~285%. Đây là nút thắt lớn nhất
   còn lại của độ mượt, và cũng là lý do YouTube thường phải ở 240p mới chạy nổi.
2. **Nhánh phát triển sống quá lâu, thiết bị build thẳng từ nhánh (`refresh: 0s`).** Mọi commit lập tức vào lần build
   kế tiếp của cả 3 màn; `main` của repo firmware đứng yên từ 25/09. Hậu quả đã xảy ra: firmware S3 **không biên dịch
   được suốt một tuần** (lỗi `speaker_id` bắt buộc) mà không ai biết, vì CI chỉ build P4.
3. **Máy HASS thiếu RAM** (≈180 MB trống, 2,75 GB swap). Kiến trúc nhiều tab làm RAM addon tăng theo số ứng dụng mở;
   tạm dừng JS giảm CPU nhưng **không** giảm RAM.
4. **Lỗi dạng "Not attached to an active page" lặp lại 2 lần** (2.9.48, 2.9.68) — do điều hướng đổi gốc trùng lúc bật
   screencast. Bộ thử tích hợp chỉ dùng một gốc (localhost) nên không bắt được.
5. **Flash P4 còn ~1 MB** (6,76/7,75 MB) sau khi thêm ESP-DL. Tính năng lớn kế tiếp sẽ vướng.
6. **Nhận biết có người phân tán**: 3 nguồn (dò chuyển động trên chip, khuôn mặt trên chip, Frigate) mỗi nguồn một cảm
   biến, không có trạng thái "có người" hợp nhất cho automation.
7. **Chất lượng ảnh camera**: tự phơi sáng đã sửa độ sáng, nhưng chưa trừ mức đen (vùng tối ngả tím) và gamma làm nhạt
   màu — ảnh hưởng cả Frigate lẫn phát hiện khuôn mặt.
8. **Tài liệu kế hoạch phân tán** (KE-HOACH-GIAO-DIEN-HE-DIEU-HANH, KE-HOACH-MUOT-CAMERA, kế hoạch bảng điều khiển bên
   client…). Bản Ổn định cuối (25/09 đêm) đã quá xa hiện trạng.

## 3. Đề xuất (ưu tiên, công sức, rủi ro)

| # | Đề xuất | Lợi ích dự kiến | Công sức | Rủi ro |
|---|---|---|---|---|
| **1** | **Bật GPU cho Chrome của addon**: gói VA-API Intel (`intel-media-va-driver`) trong image, cờ Chrome `--use-angle=gl-egl` (hoặc vulkan) + `VaapiVideoDecoder`, quyền `/dev/dri/renderD128`. Đo A/B CPU và fps | CPU addon khi phát video có thể giảm mạnh; cho phép YouTube 480p/720p mà không giật | Trung bình (image + thử cờ) | Trung bình — headless + GPU đôi khi đen hình; có cờ tắt để quay về SwiftShader |
| **2** | **Quy trình phát hành firmware**: merge nhánh vào `main`, gắn tag phiên bản; YAML của 3 màn trỏ **tag** (không `refresh: 0s` vào nhánh); CI build **cả 3** YAML (thêm S3) | Không còn "đẩy một commit là lần build sau của cả 3 màn đổi theo"; lỗi biên dịch S3 bị bắt ngay | Thấp | Thấp |
| **3** | **Ngân sách RAM máy chủ**: tab nền quá N phút thì *đóng hẳn* (giữ ảnh thu nhỏ + URL để mở lại) thay vì chỉ tạm dừng; `MAX_APP_TABS` theo RAM trống; theo dõi swap trong /metrics | Giảm swap → bớt giật ngẫu nhiên toàn hệ thống | Thấp–TB | Thấp |
| **4** | **Test tích hợp đổi gốc**: thêm máy chủ tĩnh thứ hai (cổng khác) trong harness để điều hướng cross-origin + kiểm tra khung tới sau khi chuyển tab | Chặn hẳn lớp lỗi "Not attached" | Thấp | Không |
| **5** | **"Có người" hợp nhất**: một cảm biến `Có người` = khuôn mặt (màn tắt) ∪ chuyển động ∪ Frigate person, có trễ tắt; dùng cho bật màn hình, màn hình chờ, automation HA | Đơn giản hoá automation, ít báo nhầm | Thấp | Thấp |
| **6** | **Ảnh camera**: trừ mức đen (BLC) theo thanh ghi OV02C10, chỉnh gamma/tương phản trong IPA, tuỳ chọn bù sáng ra HA | Màu đúng hơn cho Frigate + phát hiện khuôn mặt | TB | Thấp (có lối lui) |
| **7** | **Chất lượng YouTube**: sau (1), ép chất lượng theo độ phân giải panel (P4 480p, S3 240–360p) qua API trình phát | Hình nét hơn rõ rệt trên P4 | Thấp | Phụ thuộc (1) |
| **8** | **Flash P4**: dùng mô hình khuôn mặt MSR+MNP (190 KB, 15 ms, kém chính xác hơn) hoặc đặt mô hình vào phân vùng riêng; bỏ component chẩn đoán (net_bench, task_stats) khỏi bản chính | Lấy lại 0,5–1 MB cho tính năng sau | Thấp | Thấp |
| **9** | **Liên lạc 2 chiều / chuông cửa có tiếng** (nền AEC + loa đã có): bấm chuông → P4 hiện camera cổng + nói chuyện qua go2rtc two-way | Tính năng giá trị cao cho bảng tường | Cao | TB (CPU/PSRAM P4 khi video + AEC) |
| **10** | **Tổng hợp tài liệu**: một `docs/TRANG-THAI.md` (trạng thái, phiên bản đang chạy, việc dở) thay nhiều file kế hoạch; chốt **Bản Ổn định** mới sau vài ngày dùng thật (sao lưu tự động bằng script) | Phiên sau / người sau bắt nhịp nhanh; có đường lui tin cậy | Thấp | Không |

## 4. Thứ tự đề xuất

1. **(2) + (10)** trước — rẻ, giảm rủi ro cho mọi thay đổi sau (tag + CI 3 màn + Bản Ổn định mới).
2. **(1)** — cải thiện độ mượt lớn nhất còn lại; làm theo kiểu A/B có cờ tắt.
3. **(3) + (4)** — ổn định máy chủ.
4. **(5) (6) (7) (8)** — hoàn thiện trải nghiệm.
5. **(9)** — tính năng lớn, làm khi nền đã ổn.

## 5. Kết quả thực hiện

### Đề xuất 2 (quy trình phát hành) — XONG 30/09
- Nhánh `claude/two-repo-research-3ulwjd` gộp vào `main` của repo firmware; tag `fw-2026.09.30`; 3 YAML trỏ tag (`refresh: 1d`).
- CI build cả 3 màn (`ci/p4.yaml`, `ci/s3-4848.yaml`, `ci/s3-4827.yaml`); `ci/make_ci_yaml.py` dùng chung.
- Bản Ổn định 30/09 + script `tools/sao-luu-ban-on-dinh.sh` (repo firmware).

### Đề xuất 1 (GPU cho Chrome) — ĐÃ THỬ, KHÔNG CÓ LỢI → DỪNG
Thử A/B trong container addon (Chrome riêng cổng 9333, không đụng Chrome phục vụ panel), YouTube 480p H.264 + screencast
JPEG 1024×600 như addon, 30 s:
| | Dựng hình | Giải mã video | CPU Chrome |
|---|---|---|---|
| Hiện tại | SwiftShader (phần mềm) | FFmpeg (phần mềm) | 73% |
| GPU (`--use-angle=gl-egl`, Mesa iris) | **GPU Intel UHD 630** (compositing/raster bật) | vẫn FFmpeg | 72% |
| GPU + bỏ sandbox + VA-API (`intel-media-va-driver`, vainfo thấy H.264/VP9) | GPU | vẫn FFmpeg — Chrome headless báo **0 codec phần cứng** | 72% |
- Chrome headless (Ozone headless) không dùng VA-API → không giải mã phần cứng được; dựng hình GPU không giảm CPU.
- **Phát hiện quan trọng hơn** — đo tách CPU addon khi P4 phát YouTube: **Node (server xử lý ảnh) 62%**, Chrome ~74%
  (tổng 135%); lúc rảnh: Node 14%, Chrome 19%. Tối ưu nên nhắm **khâu giải nén/nén lại khung ở server** (sharp), không
  phải GPU.
- Ghi chú: YouTube thường (không ép codec) gửi **AV1** (giải mã phần mềm Dav1d) — tab YouTube TV đã ép H.264; nên áp
  dụng ép H.264/VP9 cho mọi tab YouTube (AV1 nặng nhất cho CPU).

### Đề xuất mới 1b (thay GPU): giảm CPU khâu xử lý ảnh server
- Ép H.264 cho tab YouTube thường (tránh AV1 giải mã phần mềm nặng).
- Đo chi tiết thời gian từng bước trong flushPending (giải nén JPEG của Chrome, chia dải, nén lại) để chọn chỗ cắt.

### Đề xuất 3 + 4 (ngân sách RAM, test đổi gốc) — XONG 30/09 (server 2.9.69)
- Đo lại trước khi làm: máy HASS nay 10 GB RAM, ~3,7 GB khả dụng, nhưng swap đã dùng ~2,9/3,3 GB.
- Tab nền không dùng quá `IDLE_TAB_CLOSE_MIN` (20 phút) → đóng hẳn; thẻ vẫn ở "Gần đây" (ảnh + URL), chạm = mở lại
  đúng trang. RAM khả dụng < `LOW_MEM_MB` (600) → 1 ứng dụng nền, đóng sau 3 phút. `/metrics.host` báo RAM/swap.
- "Dùng lần cuối" tính từ lúc rời tab.
- Test tích hợp mới: `tabs.itest.ts` (tab nền điều hướng localhost → 127.0.0.2 rồi hiện: phải có khung, không lỗi
  screencast), `ramBudget.itest.ts`. Tổng: 126 test đơn vị + 31 test tích hợp đạt.

### Đề xuất 5 ("Có người" hợp nhất) — XONG 30/09 (chỉ YAML P4, không đổi tag firmware)
- `Có người` = chuyển động (camera_motion) **hoặc** khuôn mặt (camera_face, khi màn tắt) **hoặc** Frigate thấy người
  (**tuỳ chọn**: `platform: homeassistant` đọc `binary_sensor.p4_panel_person_occupancy`), trễ tắt 10 s. Mọi hành
  động (bật màn, giữ màn sáng, báo server) chuyển sang cảm biến này.
- **Không có Frigate**: thực thể HA không tồn tại → nguồn đó luôn "tắt", hai nguồn trên chip vẫn đủ.
- Kiểm chứng: giả trạng thái Frigate = on qua API HA → `Có người` bật ngay; off → tắt sau đúng ~10 s.

### Đề xuất 7 (phần 1: YouTube thường chỉ H.264) — XONG 30/09 (server 2.9.70)
- Tab YouTube/Nhạc tiêm cùng script giới hạn codec như YouTube TV (≤720p, ≤30 hình/s). Kiểm chứng trong tab panel:
  `MediaSource.isTypeSupported(av01/vp09)` = false, trình phát dùng `avc1` (trước: `av01`).
- Đo A/B sạch (Chrome riêng cổng 9333 trong container, video pAnTNJaVhcs 480p, chỉ đo khi hết quảng cáo, luân phiên
  2 lượt × 30 s): AV1 (Dav1d) **81% / 80%** CPU Chrome, bỏ 8 / 6 khung; H.264 (FFmpeg) **76% / 73%**, bỏ 3 / 4 khung.
  → Giảm ~6–9% một lõi — có lợi nhưng nhỏ; nút thắt chính vẫn là khâu xử lý ảnh của server (Node ~80–120% khi phát).
- Đo trên panel bị nhiễu quảng cáo (YouTube chèn quảng cáo giữa lượt đo) — không dùng làm số so sánh.
- Bài học quy trình: addon lấy mã từ image `chrome-h264` do GitHub Actions build → PHẢI chờ digest ghcr đổi rồi mới
  update/rebuild (lần đầu cập nhật sớm, addon báo 2.9.70 nhưng chạy mã 2.9.69).
- Về iGPU và Frigate: Chrome headless báo `video_decode=disabled_software` và 0 codec phần cứng ngay cả khi `vainfo`
  trong container thấy H.264/VP9 trên iGPU (đang được Frigate dùng) — giới hạn nằm ở Chrome headless (Ozone headless
  không dùng VA-API), không phải do Frigate chiếm iGPU.

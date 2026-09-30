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

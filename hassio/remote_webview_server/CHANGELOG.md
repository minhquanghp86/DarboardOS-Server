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

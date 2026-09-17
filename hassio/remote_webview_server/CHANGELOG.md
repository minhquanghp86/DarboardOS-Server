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

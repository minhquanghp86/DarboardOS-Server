> ⚠️ **TÀI LIỆU NÀY ĐÃ CŨ.** Bản mới nhất: [`BAN-GIAO-2026-10-27-chat-luong-fps.md`](BAN-GIAO-2026-10-27-chat-luong-fps.md)

# BÀN GIAO — 26/10/2026 (phiên sau đọc đầu tiên)

Trạng thái triển khai lúc bàn giao: **add-on v2.9.249**, `started`. Server repo `main` sạch,
tag ổn định gần nhất `stable-2026-10-26` (đang trỏ **2.9.241** — *chưa* dời sang 2.9.249).

## 1. Việc đang dở (ưu tiên số 1): 480×272 chưa nét

**Triệu chứng người dùng:** YouTube trên panel 480×272 mờ/vỡ, nhất là khi vuốt chuyển video.

**Đã làm (đã deploy, không cần làm lại):**
- Panel 480×272: `half_scale_video: false`, `max_bytes_per_msg: 65536`, `jpeg_quality: 70`
  (`/config/esphome/local-guition-webview-jc4827w543c.yaml`, backup `.bak-20261026-q80`).
- Server: panel ≤480×272 không dùng half-scale (`HALF_ENABLED = !smallScreen`).
- Đọc từ `/metrics`: `halfVideo=False maxBytes=65536 q=70` ✔ (cấu hình đã tới panel).

**Nguyên nhân còn lại (đã đo, chưa sửa):** chất lượng thực dùng bị **kẹt ở q40**.
Đo 40 s liên tiếp khi YouTube đang phát:
```
 0s q=40 interval=50ms bytes=11077 dec=0ms
40s q=40 interval=50ms bytes=9682  dec=0ms
```
→ `appliedQuality` luôn 40 dù YAML là 70. Panel **không gửi mẫu decode** (`dec=0`) nên bộ điều
chỉnh (`src/adaptive.ts`) không có căn cứ nâng chất lượng, đứng ở sàn `DEFAULT_ADAPTIVE_CFG.minQuality = 40`.
Vì vậy mọi lần tăng `jpeg_quality` trong YAML đều **không có tác dụng**.

**Việc cần làm:**
1. Trong `src/deviceManager.ts` (~dòng 4040, chỗ dựng config adaptive
   `{...DEFAULT_ADAPTIVE_CFG, maxQuality: device.cfg.jpegQuality, ...fbProfile}`): với panel nhỏ
   (`cfg.width <= 480 && cfg.height <= 272`) đặt **`minQuality = maxQuality = cfg.jpegQuality`**
   (hoặc khởi tạo bộ điều chỉnh ở `maxQuality` thay vì sàn). Mục tiêu: `appliedQuality` = 70 cố định.
2. Đo lại 40 s (script bên dưới) — yêu cầu: `appliedQ=70`, `bytes` ~15-25 KB/khung, **fps không tụt**
   so với hiện tại (~20 fps, `interval=50ms`).
3. Nếu fps tụt: hạ YAML về q65 hoặc nâng `min_frame_interval` chấp nhận 8-10 fps.
4. Khi đạt: dời tag `stable-2026-10-26` → commit mới, cập nhật mục 1 của tài liệu này.

## 2. Đã xong trong phiên (đừng làm lại)

### Bàn phím ảo (2.9.229)
Nền sáng + kính mờ (`backdrop-filter`), phím bo 10px, hiệu ứng bấm (lún + sáng), chiều cao
`min(196px, 50vh)` cho màn thấp, chế độ hẹp cho màn dọc. Code: `src/deviceManager.ts`
(`KIOSK_KEYBOARD_SCRIPT`).

### Thẻ Điều khiển (2.9.230 → 2.9.241)
- Điều khiển live khi kéo: **1 vòng chụp/thiết bị** (`pumpLive`) chia cho mọi người xem; SSE đọc
  `latestFrame`, **luôn chụp** kể cả khi đang chạm (bỏ `inputBusy → continue`).
- Input: `down/move(16ms)/up`. Có WS thì gửi qua WS (`{t:'touch'}`), không có thì POST `/control/input`
  (hoặc `/control/gesture` gộp đoạn 60 ms).
- Fallback: WS → **SSE** (không dùng MJPEG: Chrome Android không phát `multipart/x-mixed-replace` trong `<img>`).
- `GET /control/ping` → `{ok, lan}`; trang mở bằng tên miền HTTP tự chuyển sang IP LAN để dùng WS.
- `screenTouch`: các `move` dư bị bỏ khi kênh CDP đang bận (`moveInFlight`).
- **YouTube TV** (`kind === 'yttv'`): vẫn bắn chạm thô (bỏ đi là mất cảm ứng — 2.9.247 từng mắc),
  **cộng thêm** phím mũi tên mỗi 40 px khi kéo, **đúng chiều theo `tvSwipeKeys()`**:
  kéo trái → `ArrowRight`, kéo lên → `ArrowDown`.

### Shell (2.9.243, 2.9.244)
Bỏ mọi chốt `CFG.motion === 'full'` ở phần **bám theo ngón tay**: pager màn hình chính, thẻ ứng dụng
ở Gần đây, bong bóng "Quay lại", thanh vuốt lên, **màn hình khoá**. Animation chuyển trang vẫn giữ
theo motion để S3 không nặng.

### half-scale / "co 1/4" (2.9.245, 2.9.246)
Lỗi: khi chuyển **half → full** server không ép gửi khung đầy đủ → panel vẽ ảnh nửa cỡ.
Fix: nhánh tắt half có `requestFullFrameFor(dev) + forceSharp + prevFrameHash = -1`.
(2.9.245 từng tắt hẳn half-scale — **đã bật lại** vì tắt sẽ hại fps.)

## 3. Cách đo (đã dùng trong phiên)

```bash
# fps / chất lượng / byte của 1 panel (chạy trên máy HA)
python3 - <<'PY'
import json,time,urllib.request
D="esp32-1cdbd49b2260"; U="http://127.0.0.1:18080/metrics"
def g():
    d=json.load(urllib.request.urlopen(U,timeout=10))
    return [x for x in d["devices"] if x["id"]==D][0]
for i in range(6):
    v=g(); print(i*8,"q=",v.get("appliedQuality"),"interval=",v.get("appliedMinFrameIntervalMs"),
                  "sent=",v.get("framesSent"),"bytes=",v.get("recentFrameBytes"),"dec=",v.get("recentMedianDecodeMs"))
    time.sleep(8)
PY
```

Đo end-to-end cử chỉ (tự vuốt qua WS, xem khung đổi **trong lúc kéo**): script `swipe3.cjs`
(`node swipe3.cjs <dev> <x> <y0> <y1>`), copy vào container:
```bash
docker cp /tmp/swipe3.js app_b39feb53_remote_webview_server:/app/swipe3.cjs
docker exec app_b39feb53_remote_webview_server sh -c 'cd /app && node swipe3.cjs esp32-84fce66ba3ec 400 300 200'
```
Kết quả tốt: khung đổi **trong khoảng thời lượng kéo** (vd 31/153/317 ms với cú kéo 220 ms).

## 4. Vận hành / rollback
- Phát hành: bump `package.json` + `package-lock.json` + `hassio/remote_webview_server/config.yaml`
  + CHANGELOG → push `main` → chờ CI → `ha store reload` → `ha apps update b39feb53_remote_webview_server`.
- Nếu store báo "No update available": xem `docs/SUA-LOI-STORE-ADDON.md` (clone Supervisor detached HEAD).
- Rollback: `git checkout stable-2026-10-26`; firmware 480×272: khôi phục `.bak-20261026-q80`.
- Panel id/IP: P4 `esp32-80f1b2d35fb5` 192.168.10.200 · 480×272 `esp32-1cdbd49b2260` .184 ·
  480×480 `esp32-28372f8a0218` .173 · 800×480 `esp32-84fce66ba3ec` .167.

## 5. Lưu ý từng sai (tránh lặp)
- Đừng chặn chạm thô ở tab YouTube TV → mất cảm ứng hoàn toàn.
- Đừng dừng luồng khung khi đang chạm → hình đứng tới khi nhả.
- Đừng gộp cử chỉ tới lúc nhả tay → mất cảm giác kéo.
- Đừng đo fps từ localhost rồi kết luận cho người dùng (đường ingress/4G khác hoàn toàn).
- `appliedQuality` mới là chất lượng thật; `cfg.jpegQuality` chỉ là trần.

## 6. CẬP NHẬT CUỐI PHIÊN (đọc mục này trước mục 1)

Đã làm thêm sau khi viết mục 1:
- YAML panel 480×272: `jpeg_quality: 65` (đã OTA, backup `.bak-20261026-q80`).
- Server **2.9.250**: với panel nhỏ đặt `minQuality = maxQuality = cfg.jpegQuality`.
- Server **2.9.251**: nâng thẳng `res.state.quality` lên `cfg.jpegQuality` khi `pinQuality`.

**Vẫn chưa có tác dụng** — đo sau 2.9.251 vẫn `appliedQuality = 40`. Suy đoán: điều kiện
`device.cfg.width <= 480 && device.cfg.height <= 272` **không khớp** lúc chạy (field/đơn vị khác 480×272,
có thể là kích thước khung gửi hoặc chưa có khi khởi tạo).

**Việc cần làm (theo thứ tự):**
1. Log thực tế `device.cfg.width`, `device.cfg.height`, `device.cfg.maxBytesPerMessage` tại chỗ dựng `cfgA`
   (`src/deviceManager.ts` ~4040) để biết giá trị thật, rồi sửa điều kiện `pinQuality` cho khớp
   (hoặc nhận diện bằng `cfg.maxBytesPerMessage === 65536 && !cfg.halfVideo`).
2. Đo lại: `appliedQ` phải = 65, `recentFrameBytes` ~12-20 KB, `interval` 50-75 ms.
3. Đường **chắc chắn chạy được ngay** (không cần code): Dashboard UI → panel 480×272 → Cài đặt →
   **"Chất lượng hình ảnh" = 65** (thay vì "Tự động"). Nhánh này gọi `processor.setTuning({jpegQuality:65})`
   + `lastAppliedQuality = 65` ngay lập tức (`src/deviceManager.ts` ~1689, pref `rwv.quality`).

## 7. ĐIỀU TRA CHẤT LƯỢNG KHÔNG CÓ TÁC DỤNG (26/10, cuối phiên)

### Số đo (panel 480×272, YouTube đang phát, mỗi mức 3-5 phút)
| Đặt | fps | Nhịp | Decode | Byte/khung |
|---|---|---|---|---|
| q60 | 6.6 | 150-200 ms | 58.3 ms | 16.4 KB |
| q50 | 9.8 | 100 ms | 59.3 ms | 18.7 KB |
| q40 | 9.8 | 100 ms | 59.2 ms | 18.3 KB |

→ Byte/khung **không** giảm theo q (thậm chí q40 > q60). Chất lượng đặt trong UI **không tới encoder**.

### Đã tìm được chỗ nghi phạm chính
`src/deviceManager.ts` ~312 `videoScreencastQuality()`:
```ts
const base = dev.cfg.maxBytesPerMessage >= 131072 ? dev.cfg.jpegQuality : SCREENCAST_JPEG_QUALITY; // = 90
const low  = dev.cfg.jpegQuality;
if (base === low) return;
```
- Panel 480×272 có `maxBytesPerMessage = 65536` (< 131072) ⇒ **base luôn = hằng số 90**, không phải chất lượng người
  dùng đặt.
- `low` chỉ lấy `cfg.jpegQuality` (YAML = 65), **không** lấy `dev.qualityOverride` (giá trị UI 40/50) — nên mức người
  dùng chọn không đi vào đường video.

### Việc cần làm (phiên sau)
1. Cho `base`/`low` dùng **chất lượng hiệu lực**: `dev.qualityOverride ?? dev.cfg.jpegQuality`, và hạ ngưỡng
   131072 → 65536 (panel nhỏ 64 KB vẫn đủ).
2. Đo lại q30/q50/q70 trong cùng 1 cảnh để chứng minh byte/khung thay đổi đơn điệu (q30 < q50 < q70).
3. Sau đó mới kết luận trần fps thật. Hiện tại 9.8 fps là mốc **có thể còn dư địa** nếu video đang thực sự chạy q90
   (q90 ≠ q50 đã đặt).

### Mốc so sánh 3 panel S3 (cùng lúc)
```
480×272 full-res  130k px  decode 59 ms
480×480 half      57k px   decode 37.5 ms
800×480 half      ...      (chưa đo khi phát)
```

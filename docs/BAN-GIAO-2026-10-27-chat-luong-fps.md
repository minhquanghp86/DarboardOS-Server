> ✅ **ĐÃ HOÀN THÀNH (27/10)**: mục 1 (chất lượng tới encoder) + mục 2 (nhịp khung) đã sửa xong ở 2.9.260.
> Kết quả và cách đo: [`ON-DINH-2026-10-27-480x272.md`](ON-DINH-2026-10-27-480x272.md)

# BÀN GIAO CHI TIẾT — 26/10/2026 (phiên sau đọc file này TRƯỚC)

> Mục tiêu phiên sau: **sửa lỗi "chất lượng đặt trong UI không tới encoder"** → nâng fps panel **480×272**
> từ 9.8 lên 11-12 fps **mà vẫn giữ độ nét**, rồi chốt bản ổn định.

---

## 0. TRẠNG THÁI HIỆN TẠI (bắt đầu từ đây)

| Hạng mục | Giá trị |
|---|---|
| Add-on đang chạy | **2.9.252** (`state: started`) |
| Server repo | `main` = `56258b4`, sạch, đã push |
| Client repo | `main` = `618e813`, sạch |
| Tag ổn định | `stable-2026-10-27` → **2.9.241** (CHƯA dời — xem mục 6) |
| Panel 480×272 | `esp32-1cdbd49b2260` · IP `.184` · q40 (UI) · full-res · gói 64 KB |
| Đo gần nhất (480×272, YouTube) | **9.8 fps**, nhịp 100 ms, decode 59 ms, 18.3 KB/khung |
| Còn dở | Chất lượng q40/q50/q60 **không đổi byte/khung** → nghi dùng hằng số q90 |

---

## 1. VIỆC CHÍNH: chất lượng không tới encoder

### 1.1 Bằng chứng đo (panel 480×272, YouTube đang phát)

| Đặt trong UI | fps | Nhịp | Decode | Byte/khung | Băng thông |
|---|---|---|---|---|---|
| q60 (5 phút) | 6.6 | 150–200 ms | 58.3 ms | 16.4 KB | 108 KB/s |
| q50 (3 phút) | 9.8 | 100 ms | 59.3 ms | 18.7 KB | 180 KB/s |
| q40 (3 phút) | 9.8 | 100 ms | 59.2 ms | 18.3 KB | 180 KB/s |

**Kết luận từ số:** byte/khung **không giảm** theo q (q40 còn lớn hơn q60) ⇒ giá trị UI không đi vào encoder.
Đồng thời decode ≈59 ms không đổi ⇒ nội dung nén thực tế giống nhau ở cả 3 mức.

### 1.2 Chỗ sai — `src/deviceManager.ts` dòng ~312 `videoScreencastQuality()`

```ts
function videoScreencastQuality(dev: DeviceSession, fps: number, nowMs: number): void {
  const tab = dev.tabs.get(dev.activeTabKey);
  if (!tab || !tab.screencastOn || dev.cfg.rotation || PASSTHROUGH_MIN_FPS <= 0) return;
  const base = dev.cfg.maxBytesPerMessage >= 131072 ? dev.cfg.jpegQuality : SCREENCAST_JPEG_QUALITY; // = 90
  const low  = dev.cfg.jpegQuality;
  if (base === low) return;
  ...
}
```

Hai lỗi xác định được:

1. **Ngưỡng 131072 (128 KB)**: panel 480×272 khai `max_bytes_per_msg: 65536` ⇒ `base` **luôn** là hằng số
   `SCREENCAST_JPEG_QUALITY = 90` (dòng ~373: `Math.min(100, Math.max(1, parseInt(process.env.SCREENCAST_JPEG_QUALITY ?? '90')))`).
   ⇒ đường video chạy **q90 cố định**, không phải chất lượng người dùng đặt.
2. **`low` bỏ qua UI**: `low = dev.cfg.jpegQuality` lấy từ **YAML** (hiện 65). Giá trị người dùng chọn trong
   Darboard UI nằm ở **`dev.qualityOverride`** (được set tại `src/deviceManager.ts` ~1689, nhánh `sid === 'rwv.quality'`,
   pref `rwv.quality`, `0 = Tự động`), và chỉ được áp qua `dev.processor.setTuning({ jpegQuality: q })`.

⇒ Đường screencast/video **không đọc `qualityOverride`** bao giờ.

### 1.3 Cách sửa đề xuất (làm đúng thứ tự)

```ts
// (27/10/2026) Dung CHAT LUONG HIEU LUC (UI > YAML) va ha nguong xuong 64 KB: panel nho 480x272 van du cho.
const effQ = dev.qualityOverride ?? dev.cfg.jpegQuality;
const base = dev.cfg.maxBytesPerMessage >= 65536 ? effQ : SCREENCAST_JPEG_QUALITY;
const low  = effQ;
```

Sau khi sửa, kiểm tra thêm hợp đồng giữa `setTuning` và đường chụp:
- `dev.processor.setTuning({ jpegQuality })` thực sự được dùng ở đâu khi chụp khung (tile path vs screencast path)?
  Nếu tile path cũng đọc `cfg.jpegQuality` thay vì tuning thì phải sửa cả hai — **đây là điểm phải grep kỹ**
  (`grep -n "jpegQuality" src/*.ts`, xem `src/browser.ts`, `src/cdpRoot.ts`).

### 1.4 Kế hoạch nghiệm thu (bắt buộc, đúng thứ tự)

1. Deploy bản có fix (quy trình mục 5).
2. Người dùng đặt **q50** trong Darboard UI, phát YouTube.
3. Chạy `python3 /tmp/yt3.py` (3 phút) — xem mục 3.1.
4. **Điều kiện đạt**: byte/khung **giảm rõ** so với 18.3 KB (kỳ vọng ~12-13 KB ở q50), decode **< 55 ms**,
   fps **≥ 11**, q báo cáo đúng 50.
5. Chứng minh tính đơn điệu: đo thêm q30 và q70 cùng một cảnh — byte/khung phải tăng dần q30 < q50 < q70.
   Nếu KHÔNG đơn điệu ⇒ chất lượng vẫn chưa đi vào encoder, quay lại bước 1.3 (kiểm tra tile path).
6. Chỉ khi đạt mới chốt tag (mục 6).

### 1.5 Rollback
`git revert` commit fix, hoặc `git checkout stable-2026-10-27` rồi CI + update add-on (mục 5).

---

## 2. Phân tích trần fps (số đo thật, dùng để biện luận với người dùng)

| Panel | Cấu hình gửi | Pixel/khung | Decode | Nhịp hiện tại | fps |
|---|---|---|---|---|---|
| **480×272** `.184` | full 480×272 | **130k** | **59 ms** | 100 ms (trần mới) | **9.8** |
| 480×480 `.173` | half (240×240) | 57k | 37.5 ms | 50 ms | 7.4 (trang tĩnh) |
| 800×480 `.167` | half | ~115k | chưa đo khi phát | 50 ms | — |

- Panel 480×480 **nhanh hơn không phải vì màn lớn** mà vì gửi **ít pixel hơn 2.3 lần** (`halfVideo=true`).
- Trần lý thuyết 480×272 full-res: `1000/59 ≈ 17 fps`; thực tế an toàn 60-70% công suất ⇒ **10-11 fps**.
- Sau khi sửa mục 1 (q50 thật thay vì q90), decode kỳ vọng ~45-50 ms ⇒ trần thực tế **11-12 fps**.

**Đã làm trong phiên (giữ nguyên, đừng revert):**
- `2.9.252`: panel ≤480×272 đặt `maxIntervalMs: 100` (trước đó bộ điều chỉnh ghim 150-200 ms, chỉ dùng 28% ngân sách
  decode). Đo trước/sau: **5.2 → 9.8 fps (+88%)**. Điều kiện nhận diện đã xác nhận đúng bằng log
  `[cfg] esp32-...: w=480 h=272 mfi=50 maxBytes=65536 halfVideo=false pin=true`.
- YAML panel: `half_scale_video: false`, `max_bytes_per_msg: 65536` (BẮT BUỘC cho fix mục 1 vì ngưỡng mới là 64 KB),
  `jpeg_quality: 65`. Backup: `/config/esphome/local-guition-webview-jc4827w543c.yaml.bak-20261026-q80`.

---

## 3. BỘ ĐO — chạy đúng như đã dùng trong phiên

### 3.1 Đo YouTube N phút cho 1 panel (`/tmp/yt3.py`, `/tmp/yt5.py` trên máy HA)

Nội dung script (đã tạo ở `/tmp/yt3.py` = 180 s, `/tmp/yt5.py` = 300 s trên HASS):

```python
import json, os, time, urllib.request
D = "esp32-1cdbd49b2260"; U = "http://127.0.0.1:18080/metrics"
H = "http://supervisor/core/api/states/"; TOK = os.environ.get("SUPERVISOR_TOKEN", "")
ENT = "binary_sensor.4_3_guition_jc4827w543_video_dang_chay"   # tách đoạn có/không có video
DUR = 180
def dev():
    d = json.load(urllib.request.urlopen(U, timeout=10))
    return [x for x in d["devices"] if x["id"] == D][0]
def video_on():
    r = urllib.request.Request(H + ENT, headers={"Authorization": "Bearer " + TOK})
    return json.load(urllib.request.urlopen(r, timeout=8))["state"] == "on"
prev = dev(); prev_t = time.time(); t0 = prev_t
while time.time() - t0 < DUR:
    time.sleep(10); cur = dev(); now = time.time(); dt = now - prev_t
    print("%3ds fps=%5.1f q=%s iv=%s fb=%s dec=%s vid=%s" % (
        now - t0, (cur.get("framesSent",0)-prev.get("framesSent",0))/dt, cur.get("appliedQuality"),
        cur.get("appliedMinFrameIntervalMs"), cur.get("recentFrameBytes"),
        cur.get("recentMedianDecodeMs"), video_on()))
    prev, prev_t = cur, now
```

Chạy: `scp /tmp/yt3.py hass:/tmp/ && ssh hass 'python3 /tmp/yt3.py'`.
**Luôn đối chiếu cột `vid`** — nếu `vid=False` thì số fps vô nghĩa (đã từng báo 0.0 vì panel ở dashboard).

### 3.2 Đo end-to-end cử chỉ (tự vuốt)
```bash
docker cp /tmp/swipe3.js app_b39feb53_remote_webview_server:/app/swipe3.cjs
docker exec app_b39feb53_remote_webview_server sh -c 'cd /app && node swipe3.cjs esp32-84fce66ba3ec 400 300 200'
```
Kết quả tốt: khung đổi **trong lúc kéo** (vd `31, 153, 317 ms` cho cú kéo 220 ms).

### 3.3 LỖ HỔNG CẦN VÁ SỚM
Bài đo chuẩn của dự án `docs/server-noi-bo/cong-cu-do/bench-p4.sh` gọi `node cdp.mjs` trong container để **tự mở
YouTube** — nhưng **`cdp.mjs` không có trong repo** (file tạm, đã mất). Vì vậy mọi bài đo YouTube hiện phải
**nhờ người dùng bật video**. Việc nên làm: viết lại `cdp.mjs` (kết nối CDP của panel, `Page.navigate` tới video test
`pAnTNJaVhcs`, tự bỏ qua quảng cáo) và **commit vào `scripts/`** để phiên sau đo được hoàn toàn tự động.

---

## 4. NHỮNG GÌ ĐÃ XONG TRONG PHIÊN (đừng làm lại, đừng revert)

| Version | Nội dung | Ghi chú |
|---|---|---|
| 2.9.229 | Bàn phím ảo: nền sáng, kính mờ, phím bo 10px, hiệu ứng bấm, chế độ hẹp cho màn dọc | `KIOSK_KEYBOARD_SCRIPT` |
| 2.9.230→241 | Thẻ Điều khiển: 1 vòng chụp/thiết bị (`pumpLive`), SSE `latestFrame`, luôn chụp khi đang chạm, WS input + HTTP fallback | xem `docs/ON-DINH-2026-10-26-control.md` |
| 2.9.242 | YouTube TV: gửi phím mũi tên mỗi 40 px khi kéo | |
| 2.9.243 | Pager màn hình chính: bỏ chốt `motion === 'full'` | |
| 2.9.244 | Bỏ chốt motion ở: thẻ ứng dụng Gần đây, bong bóng "Quay lại", thanh vuốt lên, **màn hình khoá** | animation chuyển trang vẫn giữ theo motion |
| 2.9.245→246 | Lỗi "co 1/4": khi half→full phải `requestFullFrameFor + forceSharp + prevFrameHash=-1` | 245 từng tắt hẳn half-scale — **đã bật lại** |
| 2.9.247 | ❌ ĐÃ REVERT: chặn chạm thô ở YouTube TV → mất cảm ứng hoàn toàn | |
| 2.9.248 | Trả lại chạm thô + sửa chiều phím đúng `tvSwipeKeys()` (kéo trái → `ArrowRight`, kéo lên → `ArrowDown`) | |
| 2.9.249 | Panel ≤480×272 không dùng half-scale | |
| 2.9.250/251 | Cố ghim chất lượng — **không có tác dụng** (điều kiện đúng nhưng đường encode khác, xem mục 1) | |
| 2.9.252 | Panel nhỏ: `maxIntervalMs: 100` + log `[cfg]` | **5.2 → 9.8 fps** |

---

## 5. VẬN HÀNH (làm đúng trình tự)

### 5.1 Phát hành add-on
```bash
# bump 4 chỗ: package.json, package-lock.json, hassio/remote_webview_server/config.yaml, CHANGELOG
git push origin main            # CI build (~2-3 phút)
sh /tmp/wait_ci.sh              # chờ "DONE completed success <sha>"
ssh hass 'ha store reload'      # BẮT BUỘC, nếu không sẽ "No update available"
ssh hass 'ha apps update b39feb53_remote_webview_server'
ssh hass 'ha apps info b39feb53_remote_webview_server | grep -E "^version|^state"'
```
- Nếu `No update available`: **chạy `ha store reload` lần 2** rồi update lại (đã gặp 3 lần trong phiên).
- Chi tiết lỗi clone detached HEAD: `docs/SUA-LOI-STORE-ADDON.md`.
- **KHÔNG** chạy `git checkout/switch/reset` trong `/data/apps/git/*`.

### 5.2 OTA firmware 1 panel
```bash
ssh hass 'docker exec app_5c53de3b_esphome esphome compile /config/esphome/<file>.yaml'
ssh hass 'docker exec app_5c53de3b_esphome esphome upload  /config/esphome/<file>.yaml --device 192.168.10.184'
```
Build ~40 s, OTA ~23 s. YAML trên HA: `/config/esphome/local-guition-webview-jc4827w543c.yaml`.
Repo example tương ứng: `examples/Guition-JC4827W543C-480x272.yaml` (**phải sửa cả hai**).

### 5.3 Fleet
| Panel | id server | IP | Ghi chú |
|---|---|---|---|
| P4 7" | `esp32-80f1b2d35fb5` | .200 | `esp_video_camera: device: csi`, cam API :8082 |
| S3 480×272 | `esp32-1cdbd49b2260` | .184 | **đang focus** — full-res, 64 KB |
| S3 480×480 | `esp32-28372f8a0218` | .173 | half, 32 KB |
| S3 800×480 | `esp32-84fce66ba3ec` | .167 | half, 32 KB |

HA host `192.168.10.2`, add-on web `:18080`, domain công khai `hass.mqsmarthome.io.vn`.

---

## 6. CHỐT BẢN ỔN ĐỊNH (chỉ sau khi mục 1.4 đạt)
1. Cập nhật mục 0 + CHANGELOG + `docs/ON-DINH-2026-10-26-control.md`.
2. `git tag -f stable-2026-10-27 <sha>` (dời từ 2.9.241 → bản mới), `git push -f origin tag stable-2026-10-27`.
3. Ghi lại số đo nghiệm thu (fps/byte/decode/q) vào tài liệu này.
4. Dọn file tạm: `swipe*.cjs`, ảnh preview, `/tmp/yt*.py` nếu muốn.

---

## 7. BÀI HỌC — ĐỪNG LẶP LẠI
1. **Chặn chạm thô ở YouTube TV = mất cảm ứng** (2.9.247) → luôn gửi chạm thô, phím chỉ là bổ sung.
2. **Dừng luồng khung khi đang chạm** = hình đứng tới lúc nhả (2.9.231).
3. **Gộp cử chỉ tới lúc nhả** = mất cảm giác kéo (2.9.232).
4. **Đo fps từ localhost rồi kết luận** = sai hoàn toàn với người dùng (đi qua Cloudflare/4G).
5. **`appliedQuality` chỉ là con số báo cáo** — phải đối chiếu `recentFrameBytes` mới biết chất lượng có tác dụng thật.
6. **Đo khi panel không phát video** = số vô nghĩa → luôn kiểm tra cột `vid`.
7. **Tin vào log thay vì tin vào điều kiện code**: log `[cfg]` đã cứu một lần (điều kiện `pin` đúng nhưng vô dụng).

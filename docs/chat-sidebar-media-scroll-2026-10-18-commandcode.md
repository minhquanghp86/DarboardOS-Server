# Sidebar "Tin nhắn": lỗi ảnh/media bị co — 18/10/2026

Tác giả: CommandCode · Repo: `HA-Darboard-Server` · Phiên bản chốt: **2.9.185**

## 1. Hiện tượng (báo cáo của chủ dự án)

Trong **tab "Tin nhắn" của sidebar add-on Remote WebView Server**:

- Càng nhiều tin nhắn → **ảnh/video càng bị co nhỏ** (điện thoại bẹp thành "2 vạch xanh",
  máy tính bị cắt thành dải ngang).
- **Tin nhắn chữ thì không co.**
- Ấn vào vạch/khung đó vẫn mở được ảnh (lightbox) → dữ liệu ảnh hoàn toàn bình thường.
- App "Tin nhắn" trên **màn P4** (`chat.html`) **không bị** — cuộn tốt, ảnh đẹp.

## 2. Nguyên nhân gốc

Trong `public/launcher-config.html`:

```css
.msgs { flex: 1; overflow-y: auto; padding: 12px 20px 8px; display: flex; flex-direction: column; gap: 3px; }
```

`.msgs` là **flex column**, các item mặc định **`flex-shrink: 1`**. Khi nội dung vượt chiều
cao khung, flex **nén các item** thay vì để `overflow-y: auto` cuộn:

| Loại tin | Chiều cao tối thiểu | Kết quả |
|---|---|---|
| Chữ | `line-height` (không co được) | Giữ nguyên |
| Ảnh/video | Chiều cao linh hoạt (`height: auto`) | **Bị nén dần** |

Vì `.msgs` không bao giờ tràn (item đã co hết cỡ) nên **không có thanh cuộn** → thêm tin
= nén thêm ảnh. Đúng như chủ dự án tự chẩn đoán: *"Tin nhắn không được cuộn lên… mà chỉ ảnh,
media mới co"*.

## 3. Cách sửa (2 chốt)

```css
.msgs > * { flex: 0 0 auto; }   /* không nén item → .msgs tràn → cuộn */
.bub      { flex: 0 0 auto; ... }
```

Kèm 2 cải thiện giữ lại từ các bước trước (vẫn đúng, không phải nguyên nhân):

```css
.bub.med      { width: min(560px, calc(100vw - 24px)); max-width: none; }
.bub.med img, .bub.med video { width: 100%; height: auto; max-height: 70vh; object-fit: contain; }
```

Và JS đặt **kích thước gốc** để trình duyệt biết tỷ lệ ngay khi ảnh chưa tải xong:

```js
if (md.w) im.width  = md.w;   // ví dụ 2048
if (md.h) im.height = md.h;   // ví dụ 947
im.loading = 'eager';         // 'lazy' không kích hoạt trong iframe sidebar
```

## 4. Những lần sửa KHÔNG trúng gốc (ghi lại để khỏi lặp lại)

| Bước | Đã làm | Đánh giá |
|---|---|---|
| 2.9.176 | Sửa `.mv img` trong **`chat.html`** | ❌ **nhầm file** — sidebar dùng `launcher-config.html` |
| 2.9.177 | Nới `.b.media` / `.mv` trong `chat.html` | ❌ vẫn nhầm file |
| 2.9.178 | `max-width:100%` + cache-bust `ui.css?v=` | ❌ nhầm file |
| 2.9.179 | Nới `.grp` / `.gcol .b` trong `chat.html` | ❌ nhầm file |
| 2.9.180 | Bỏ cap + `object-fit: contain`; đổi `min-height: 140px → 0` | ⚠️ **làm nặng thêm** (khung bẹp hẳn) |
| 2.9.181–2.9.182 | **Revert toàn bộ `chat.html`** về gốc `98050fb` | ✅ đúng (P4 vốn đã ổn) |
| 2.9.183 | `min-height: 180px` + bỏ lazy | ⚠️ che triệu chứng, chưa đúng gốc |
| 2.9.184 | Set `w/h` gốc cho `<img>`/`<video>` | ✅ cần, nhưng chưa đủ |
| **2.9.185** | **`flex: 0 0 auto`** cho `.bub` + `.msgs > *` | ✅ **đúng gốc — đã xác nhận chạy tốt** |

## 5. Cách kiểm chứng lại

```bash
# Trên máy HASS
ha apps info c589cf2f_remote_webview_server | grep -iE "^state|^version"
docker exec app_c589cf2f_remote_webview_server sh -lc \
  'grep -n "flex: 0 0 auto\|im.width = md.w" /app/public/launcher-config.html'
```
Kỳ vọng: `version: 2.9.185`, `state: started`, thấy cả 2 dòng trên.

Giao diện: mở sidebar HA → **Tin nhắn** → cuộn được, ảnh hiện đủ khung đúng tỷ lệ.

## 6. Ghi chú

- **Không cần sửa `chat.html`** cho việc này (app P4 đã ổn). Nếu muốn phòng xa, có thể thêm
  `flex: 0 0 auto` cho `.b` và `.msgs > *` của nó — thay đổi nhỏ, không ảnh hưởng P4.
- Lần deploy nào add-on cũng cần `ha store reload` + có thể phải gọi `ha apps update` **vài lần**
  mới bắt được bản mới (Supervisor trả về bản cũ trong lúc build).

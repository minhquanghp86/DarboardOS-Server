# Sửa lỗi "hình bị co nhỏ" sau khi bấm Gần đây → Màn hình chính (27/10/2026)

## Triệu chứng
Trên cả 4 màn, **thỉnh thoảng** sau vài thao tác trên thẻ điều khiển (điển hình: bấm **Gần đây** rồi **Màn hình chính**),
toàn bộ giao diện thu nhỏ vào góc trên-trái, phần còn lại là nền đen. Không phải lần nào cũng bị.

## Số đo quyết định
- Ảnh chụp màn P4: 1024×600, nhưng **nội dung chỉ chiếm 31,2%** theo cả hai chiều (320×188).
- `GET /screens/dbg?id=…` (endpoint thêm ở 2.9.265) cho `innerWidth/innerHeight = 1024/600`, `zoom = 1` → trang
  KHÔNG bị CSS zoom; lỗi nằm ở **khung hình** (surface/screencast), không phải CSS.

## Nguyên nhân gốc
`captureThumb()` (ảnh thu nhỏ cho thẻ "Gần đây") chụp bằng:

```ts
Page.captureScreenshot({ clip: { x:0, y:0, width: cfg.width, height: cfg.height, scale: 320 / cfg.width } })
```

`scale = 320/1024 = 0,3125` — **đúng bằng tỉ lệ co đo được**. Trên Chromium headless, `captureScreenshot` có
`clip.scale` làm **surface/screencast lệch kích thước**; các khung screencast sau đó ra đúng cỡ thumbnail
(320×188) và panel vẽ ảnh nhỏ vào góc khung đầy. Chỉ xảy ra khi lệnh chụp chen đúng nhịp screencast → **thỉnh thoảng**,
và ở mọi màn (P4, 480×272, 480×480, 800×480).

## Sửa (2.9.266)
1. **Không dùng CDP để làm thumbnail nữa**: thu nhỏ **từ khung JPEG vừa gửi** (`dev.lastFrameB64`) bằng `sharp`.
   Nếu chưa có khung thì chụp **toàn khung** (không `clip`/`scale`) — đúng cách thẻ điều khiển vẫn chụp 55 ms/lần
   mà không gây lỗi.
2. **Lưới an toàn** trong handler `Page.screencastFrame`: nếu khung < 75% kích thước màn (và không ở chế độ nửa
   phân giải, không xoay) → **bỏ khung đó**, khôi phục viewport và xin khung đầy đủ (log `[frame] … khoi phuc viewport`).

## Lỗi phụ sửa kèm (2.9.267)
Bấm **Màn hình chính** khi đang ở tab hệ thống không có tác dụng: `goOsHome()` → `openApp()` → `activateTab()`
**return sớm** vì tab đã active, nên Shell không nhận lệnh và lớp "Gần đây" vẫn nằm trên màn.
Nay server gọi `window.__rwvShell.home()` (đóng "Gần đây" + bảng điều khiển) khi tab đích đã là tab hệ thống.

## Kiểm thử
- Trước khi sửa: P4 co còn 31,2% sau thao tác; restart add-on thì hết (nên rất khó tái hiện).
- Sau 2.9.266 + 2.9.267: **40 lượt** recents→home (10 lượt × 4 màn), sau đó 5 lượt × 4 màn lần nữa:
  - viewport đúng cả 4 màn (1024×600 / 480×272 / 480×480 / 800×480),
  - nội dung ảnh chụp phủ **100%** khung ở cả 4 màn,
  - log **không** có lần nào phải kích hoạt lưới an toàn.

## Ghi chú
- Giả thuyết "ứng dụng đang chạy nền thuộc danh sách nửa khung": không phải nguyên nhân ở đây — đường nửa phân giải
  chỉ bật khi panel khai `half_scale_video` và tỉ lệ sẽ là 50%, trong khi lỗi đo được là 31,25%. Tuy vậy lưới an toàn
  ở 2.9.266 cũng chặn luôn trường hợp khung bị thu nhỏ bất thường (>25%) khi không ở chế độ nửa phân giải.
- Công cụ chẩn đoán giữ lại: `GET /screens/dbg?id=<màn>` (LAN) trả viewport thật, DPR, zoom, URL, tab đang hiện.

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

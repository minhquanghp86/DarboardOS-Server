# Đóng góp

Cảm ơn bạn muốn góp sức. Vài quy tắc để giấy phép của dự án luôn rõ ràng:

1. **Giấy phép đóng góp.** Mã bạn gửi vào dự án được cấp theo **Apache-2.0** như phần còn lại (Apache-2.0 mục 5), trừ khi bạn
   ghi rõ khác ngay trong pull request. Bạn giữ bản quyền phần của mình.
2. **Chỉ gửi mã bạn có quyền gửi.** Không gửi mã chép từ nơi khác, mã theo giấy phép không tương thích (GPL / AGPL,
   "phi thương mại", "chỉ dùng cá nhân"...), hay mã sinh bởi công cụ AI mà bạn không chắc nguồn gốc. Bạn chịu trách nhiệm về
   nguồn gốc và giấy phép của những gì mình gửi. Nên thêm dòng `Signed-off-by: Tên <email>` vào commit
   ([Developer Certificate of Origin](https://developercertificate.org/)).
3. **Tiêu đề giấy phép.** File mới phải có tiêu đề SPDX giống các file khác (xem `scripts/check-spdx.mjs`; chạy
   `npm run check:spdx`). File sửa từ upstream giữ nguyên thông báo MIT của strange_v.
4. **Thư viện mới.** Chỉ thêm thư viện có giấy phép cho phép tự do (MIT, BSD, ISC, Apache-2.0...); sau khi thêm chạy
   `npm run licenses` và commit `THIRD-PARTY-NOTICES.md`. Báo trước nếu thư viện là GPL / AGPL / phi thương mại.
5. **Không đưa dữ liệu nhà bạn vào repo:** IP, địa chỉ MAC, tên miền, mã truy cập, ảnh chụp có người / địa chỉ thật.
6. Chạy `npm run typecheck` và `npm run test:run` trước khi gửi.

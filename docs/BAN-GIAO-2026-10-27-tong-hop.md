# BÀN GIAO TỔNG HỢP — 27/10/2026 (đọc file này trước)

> Phiên này làm 3 việc: **(A)** chốt chất lượng/fps cho panel 480×272, **(B)** thêm ứng dụng Báo thức trên
> Dashboard, **(C)** sửa lỗi hình bị co nhỏ sau "Gần đây → Màn hình chính".
> Trạng thái cuối: add-on **2.9.267**, tag `stable-2026-10-27` trỏ về commit chốt phiên.

---

## 0. TRẠNG THÁI HIỆN TẠI

| Hạng mục | Giá trị |
|---|---|
| Add-on | **2.9.267** (started) |
| Server repo | `main` sạch, đã push; tag `stable-2026-10-27` → commit chốt phiên |
| Client repo | sạch, YAML 480×272 đã đồng bộ `jpeg_quality: 65` |
| 4 màn | P4 1024×600 · 480×272 · 480×480 · 800×480 (q40 đặt chung từ Dashboard UI) |
| Test | 307/307 pass |

---

## A. 480×272 — chất lượng & fps

**Kết quả chốt: 12.1 fps (YouTube) · 11.4 fps (YouTube TV) · q40 · nhịp 80 ms · full-res.**
Chi tiết + cách đo: [`ON-DINH-2026-10-27-480x272.md`](ON-DINH-2026-10-27-480x272.md).

Ba lỗi đã sửa (2.9.253 → 2.9.260):
1. **Chất lượng trong UI không tới encoder** — `videoScreencastQuality()` dùng hằng số 90 và bỏ qua
   `qualityOverride`. Nay `effectiveJpegQuality() = qualityOverride ?? cfg.jpegQuality`.
   (Lưu ý: hạ ngưỡng passthrough 128 KB → 64 KB là SAI, đã trả lại ở 2.9.255.)
2. **Sàn hồi phục nhịp vượt trần** — `recoverFloorOf()` bỏ qua `maxIntervalMs` → kẹt 200 ms (5 fps).
3. **Bộ điều tiết đứng yên** — panel nhỏ không gửi mẫu decode; nay ép cứng nhịp 80 ms
   (`SMALL_PANEL_INTERVAL_MS`).

Trần thực tế của S3: decode 55-70 ms/khung (không có giải mã JPEG phần cứng). Muốn >12 fps phải giảm số pixel.

---

## B. Ứng dụng Báo thức trên Dashboard (2.9.261 → 2.9.264)

Chi tiết: [`BAO-THUC-DASHBOARD.md`](BAO-THUC-DASHBOARD.md).

- Ô **Báo thức** trong lưới ứng dụng trang chủ → chọn màn → mở trình Báo thức của **đúng màn đó**
  (`alarm.html?dev=<id>`); thẻ mỗi màn hiện số báo thức đang bật + giờ reo kế tiếp.
- Khối **"Báo thức chung (mọi màn hình)"** ở đầu trang.
- Dùng chung `/data/rwv-alarms.json` với app trên panel → đồng bộ mọi nơi.
- API `/alarm/*` mở cho **LAN/Tailscale + HA ingress** (trước chỉ 127.0.0.1).
- **Bài học quan trọng:** mọi trang trong `public/` phải gọi API bằng **đường dẫn tương đối**
  (`screens/list`, `alarm/list`), KHÔNG dùng `/screens/...` — nếu không sẽ 404 khi mở qua tên miền HA ingress
  (URL có tiền tố `/api/hassio_ingress/<token>/`).

---

## C. Lỗi hình bị co nhỏ (2.9.266 + 2.9.267)

Chi tiết: [`SUA-LOI-HINH-CO-NHO.md`](SUA-LOI-HINH-CO-NHO.md).

- **Gốc:** thumbnail "Gần đây" chụp bằng `Page.captureScreenshot({clip:{..., scale: 320/width}})`; trên Chromium
  headless lệnh này làm surface/screencast lệch cỡ → khung ra đúng 320×188 (31,25%) → panel vẽ ảnh nhỏ góc trái.
  Thỉnh thoảng mới xảy ra vì phụ thuộc việc chèn đúng nhịp screencast.
- **Sửa:** thumbnail tạo từ khung vừa gửi bằng `sharp` (không dùng CDP clip.scale); thêm **lưới an toàn** bỏ khung
  < 75% màn hình + khôi phục viewport.
- **Kèm:** nút "Màn hình chính" khi đang ở tab hệ thống nay gọi `window.__rwvShell.home()` để đóng "Gần đây"
  (trước đó `activateTab()` return sớm nên không có tác dụng).
- **Chẩn đoán:** `GET /screens/dbg?id=<màn>` (LAN) trả viewport thật/DPR/zoom/URL — dùng lại khi gặp sự cố hình.

---

## D. Vận hành (đúng trình tự, đã dùng trong phiên)

```bash
# phát hành
git push origin main            # CI build ~2-3 phút
# chờ: DONE completed success <sha>
ssh hass 'ha store reload'      # nếu "No update available" -> chạy reload lần 2-3
ssh hass 'ha apps update b39feb53_remote_webview_server'
ssh hass 'ha apps info b39feb53_remote_webview_server'   # xác nhận version

# đo fps (panel phải ĐANG PHÁT video và KHÔNG bị khoá)
scp scripts/measure-fps.py hass:/tmp/
ssh hass 'DUR=180 LABEL="2.9.267" python3 /tmp/measure-fps.py'
```

Bảng màn: P4 `esp32-80f1b2d35fb5` (.200) · 480×272 `esp32-1cdbd49b2260` (.184) ·
480×480 `esp32-28372f8a0218` (.173) · 800×480 `esp32-84fce66ba3ec` (.167).

---

## E. Việc còn mở (không chặn)

1. `cdp.mjs` (tự mở YouTube để đo) vẫn thiếu — muốn đo hoàn toàn tự động thì viết lại và commit vào `scripts/`.
2. Muốn > 12 fps trên 480×272: chỉ còn cách giảm kích thước khung (~90% → decode ~45 ms → 14-15 fps, mềm nhẹ).
3. Báo thức: có thể thêm nút "＋" ngay trên thẻ màn ở trang chọn để thêm nhanh.

---

## F. Bài học
1. Trang tĩnh gọi API **tương đối** (ingress).
2. `appliedQuality` chỉ là con số báo cáo — kiểm tra bằng `recentFrameBytes`.
3. Không dùng `captureScreenshot` có `clip.scale` trên tab đang screencast (làm lệch cỡ khung).
4. Khi hình sai: `GET /screens/dbg` trước, đừng đoán.
5. Đo fps: kiểm tra cột "video đang phát" và màn không bị khoá, nếu không sẽ ra 0 fps vô nghĩa.

## G. Đổi tên "Darboard" → "Dashboard" (2.9.268)

- Đổi **phần hiển thị**: tên add-on **"Dashboard OS Server"**, tiêu đề thanh bên **"Dashboard"**, tích hợp HA
  **"Dashboard OS"** (component 1.3.1), toàn bộ chữ trong giao diện / tài liệu / log (64 file, 348 dòng).
- **Giữ nguyên định danh** (đổi sẽ hỏng automation/thiết bị):
  slug `remote_webview_server`, image `ghcr.io/minhquanghp86/darboardos-server`, repo GitHub `DarboardOS-Server`,
  domain `dashboard_os`, sự kiện `dashboard_doorbell` / `dashboard_chat_message`, `rest_command.dashboard_hien_camera`,
  `dashboard_ring`, component ESPHome `dashboard_door`, thực thể `…_ha_dashboard_server`, và `TRADEMARKS.md`.
- **ĐÃ HOÀN TẤT (27/10, sau khi restart HA):**
  - Tích hợp: `Dashboard OS` · entry title: `Dashboard OS` (sửa trong `.storage/core.config_entries` lúc HA dừng,
    đã backup `.storage/core.config_entries.bak-dashboard-rename`).
  - 4 thiết bị: manufacturer `Dashboard OS`, model `Màn hình Dashboard OS`.
  - `notify.dashboard_os` hoạt động, service `dashboard_os.send` còn nguyên 9 trường; 4/4 màn online.

## H. Tích hợp HA — GĐ 1 + 2 đã xong (component 1.4.0)

**18 hành động** (1 cũ + 17 mới), đã test thật trên panel: **15/15 đạt**.

| Nhóm | Hành động |
|---|---|
| Thông báo | `send` |
| Điều hướng/hiển thị | `open_app`, `open_url`, `nav` (home/back/recents/unlock), `wake`, `lock`, `reload`, `close_app`, `screenshot` (trả `{path,url}`) |
| Hiển thị/âm thanh/cài đặt | `set_brightness`, `set_volume`, `set_quality`, `set_rotation`, `set_dnd`, `set_no_sleep`, `set_screensaver`, `set_setting`, `say` (TTS) |

- Kiến trúc: `api.py` (client HTTP dùng chung, ánh xạ device_id ↔ `esp32-…`, đọc lỗi JSON của add-on) +
  `services.py` (đăng ký + schema) + `services.yaml` (mô tả cho UI).
- Mọi hành động nhận `target` chuẩn HA **và** `device` (id/tên); bỏ trống = mọi màn đang kết nối.
- `screenshot` lưu vào `/config/www/dashboard/` và trả `{device,path,url}` (`supports_response`).
- Panel không có loa: `say`/`set_volume` trả lỗi rõ ràng (`DarboardOS: Không đọc được: thiet bi khong co media_player`).
- **Đã sửa 2 lỗi khi test:** ham `self._base` (coordinator không setup được) và **tham số `json` che module `json`**
  trong `api._request` (gây AttributeError → HTTP 500).
- Cài lên HA: chép `custom_components/dashboard_os` → restart HA (HA chỉ import module 1 lần).
- Còn lại: GĐ 3 (báo thức), GĐ 4 (list_screens/get_status/cast IPTV/touch), GĐ 5 (entities + events).

### GĐ 3 — báo thức (component 1.5.0, test 7/7)
6 hành động: `alarm_create` (trả báo thức vừa tạo), `alarm_list` (trả danh sách + giờ reo kế tiếp),
`alarm_delete` (theo `alarm_id` hoặc `time`+`label`), `alarm_set_enabled`, `alarm_stop`, `alarm_snooze`.
- `alarm_create` bỏ trống target = báo thức **mọi màn**; có target = gắn danh sách màn cụ thể.
- `alarm_stop`/`alarm_snooze` báo lỗi rõ khi báo thức không reo (server trả `ok:false` → HA nêu lý do).
- Test thật: tạo (target device_id → `devices=['esp32-…']`), tạo mọi màn (`devices='all'`), list, bật/tắt,
  xoá theo time+label, xoá theo id, stop/snooze báo lỗi đúng. Dữ liệu test đã dọn (còn đúng 2 báo thức của bạn).

### GĐ 5 (một phần) — entity + trường chọn thiết bị (component 1.6.0)
- **Nguyên nhân picker trống:** thiết bị của tích hợp **không có entity nào** → bộ chọn "Mục tiêu" không hiện gì.
  Nay mỗi màn có: `binary_sensor …_ket_noi`, `sensor …_ung_dung_dang_mo`, `sensor …_trang_thai_man_hinh`
  (kèm độ sáng/âm lượng/DND/saver), và 6 `button` (home/back/recents/wake/reload/screenshot).
- **Bỏ `target:` trong services.yaml** — mọi hành động nay có trường **`device`** với `selector: device`
  (`integration: dashboard_os`, chọn nhiều), giống `dashboard_os.send`. Vẫn nhận `target: {device_id: …}` trong YAML.
- Kiểm chứng: 12 entity/màn xuất hiện; bấm `button.…_danh_thuc` → màn hết khoá/chờ; services.yaml còn 0 `target:`.

### GĐ 4 — dịch vụ nâng cao (component 1.7.0, test 7/7)
`list_screens` (trả trạng thái 4 màn: online, app, chất lượng, decode, heap…), `get_status` (theo màn),
`cast_iptv` (phát kênh/URL), `touch`, `swipe`, `send_command` (escape hatch, chặn `id`).
- Phát hiện: `/iptv/*` chặn HA vì add-on chạy `host_network` (HA gọi từ IP LAN, không phải 172.30.32.x) →
  server **2.9.270** mở quyền LAN cho `/iptv/*`.
- `example` + mô tả cho **mọi trường** của 30 hành động (1.8.0) để form trong HA dễ điền.
- Lỗi đã gặp: YAML services.yaml bị trùng khoá + chuỗi mô tả chứa dấu `"` chưa escape → HA cảnh báo/không load;
  đã sửa và kiểm bằng `yaml.safe_load` trong container HA (30 dịch vụ, 0 cảnh báo).

### GĐ 5 hoàn tất (component 2.0.0, test 9/9)
- **switch** (3/màn): `man_hinh_cho` (bật = hiện màn chờ, tắt = đánh thức), `khong_lam_phien` (DND), `khong_cho_man_ngu`.
- **number** (3/màn): `do_sang`, `am_luong`, `chat_luong_hinh` (ghi thẳng xuống panel: `b`, `v`, `rwv.quality`).
- **select** (1/màn): `goc_xoay` 0/90/180/270 (đọc từ `/screens/settings`, có cache khi mất kết nối).
- **Options flow**: `scan_interval` 10–300 s, `controls` bật/tắt nhóm switch/number/select.
- **`send` có `priority`**: urgent (mặc định) / critical / high / normal.
- **Không còn alias tên cũ**: chỉ dùng `dashboard_os.*` (đã dẹp hẳn theo yêu cầu; sửa automation nếu có dùng tên cũ).
- Lỗi đã gặp khi test: entity điều khiển cập nhật trễ 30 s → đổi `async_request_refresh` → **`async_refresh`**;
  select không xuất hiện vì chỉ tạo khi rotation đã có → tạo cho mọi màn + cache giá trị.
- **Lưu ý**: `notify.send_message` của HA 2026.10 **không nhận** `data` (400) → muốn `priority`/media thì dùng
  `dashboard_os.send`.

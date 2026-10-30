# Hướng dẫn sử dụng Dashboard OS — từ A đến Z

Tài liệu dành cho **người dùng cuối**: từ nhận firmware, cài add-on, cài tích hợp, đến sử dụng hằng ngày và viết
automation. Đọc tuần tự nếu bạn mới bắt đầu; phần cuối là tra cứu nhanh.

> **Dashboard OS gồm 3 thành phần**
> | Thành phần | Chạy ở đâu | Vai trò |
> |---|---|---|
> | **Firmware** | Màn hình ESP32-S3 / ESP32-P4 | Nhận khung hình, vẽ lên màn, nhận cảm ứng |
> | **Add-on** (Dashboard OS Server) | Home Assistant | Chạy Chrome headless, chụp trang web/dashboard, nén khung, gửi xuống màn |
> | **Tích hợp** (custom component) | Home Assistant | Biến mỗi màn thành thiết bị HA: nút bấm, cảm biến, hành động |

![Màn hình chính](images/menu.png)

---

## 0. Cách hệ thống hoạt động (sơ đồ)

```
┌──────────────┐   WebSocket 8081    ┌─────────────────────────┐   CDP    ┌──────────────┐
│  Màn hình    │ ◄──────────────────►│  Add-on (Chrome headless │ ◄──────► │  Trang web   │
│  ESP32-S3/P4 │   khung JPEG + chạm │  + node server)          │          │  /dashboard  │
└──────────────┘                     └───────────┬─────────────┘          └──────────────┘
       ▲                                        │ HA API
       │ HTTP (chạm/vuốt, chụp)                 ▼
┌──────┴───────┐   hành động / entity  ┌──────────────────┐
│ Tích hợp HA  │ ◄───────────────────► │  Home Assistant  │
└──────────────┘                       └──────────────────┘
```

**Luồng cơ bản**
1. Add-on mở trang web (dashboard HA, hoặc URL bất kỳ) bằng Chrome headless.
2. Chrome chụp khung → add-on nén JPEG ở mức chất lượng/nhịp đã chọn → gửi xuống màn qua WebSocket (cổng 8081).
3. Màn vẽ khung, gửi ngược lại thao tác chạm/vuốt → add-on chuyển thành sự kiện chuột/bàn phím cho trang.
4. Tích hợp HA nói chuyện với add-on qua HTTP để gửi thông báo, đổi cài đặt và đọc trạng thái.

**Vì sao mỗi màn là một thiết bị HA?** Để bạn gán hành động theo từng màn, thấy trạng thái riêng và đưa vào dashboard
HA như mọi thiết bị khác.

## 1. Chuẩn bị

| Hạng mục | Yêu cầu |
|---|---|
| Home Assistant | HA OS hoặc Supervised, kiến trúc **amd64** (bắt buộc — add-on chạy Chrome) |
| Màn hình | ESP32-S3 (480×272, 480×480, 800×480) hoặc ESP32-P4 (1024×600) |
| Mạng | Màn hình và HA cùng một mạng LAN; nên đặt IP tĩnh/DHCP reservation cho từng màn |
| Tài khoản | Quyền admin HA (cài add-on, thêm tích hợp) |

## 2. Nhận firmware và nạp lần đầu

> **Firmware không phát hành công khai.** Liên hệ tác giả để nhận file YAML/`.bin` phù hợp với loại màn của bạn.

1. Liên hệ tác giả, cung cấp **loại màn** (ví dụ `Guition JC4827W543C 480×272`, `Sunton 8048S043C 800×480`, `P4 1024×600`).
2. Nhận file firmware (`.bin` để nạp qua USB lần đầu, hoặc YAML nếu bạn tự build bằng ESPHome).
3. Lần nạp đầu dùng **USB-C** (công cụ như ESPHome Web / esptool).
4. Sau khi nạp, màn hình phát Wi-Fi riêng tên `dashboard-…`: kết nối vào, nhập **Wi-Fi nhà** và **IP máy HA**.
5. Màn khởi động lại, tự kết nối tới add-on (cổng `8081`).

Các lần cập nhật firmware sau: qua **OTA** (Wi-Fi), không cần cắm cáp.

## 3. Cài add-on

1. **Settings → Add-ons → Add-on Store → ⋮ → Repositories**
2. Dán `https://github.com/minhquanghp86/DashboardOS-Server` → **Add**
3. Tìm **Dashboard OS Server** → **Install** (lần đầu tải image ~vài phút)
4. Bấm **Start**, rồi bật **Show in sidebar**

Thanh bên xuất hiện mục **Dashboard**. Mở lên, bạn sẽ thấy:

![Danh sách màn hình](images/screens.png)

## 4. Thêm màn hình vào Dashboard

1. Màn hình đã nạp firmware và nhập đúng Wi-Fi + IP HA sẽ **tự xuất hiện** trong mục **Màn hình**
   (chấm xanh = đang kết nối).
2. Nếu chưa thấy: kiểm tra màn cùng mạng, IP HA đúng, rồi khởi động lại màn.
3. Chạm vào thẻ màn hình để mở **trang điều khiển** của màn đó.

## 5. Cài tích hợp vào Home Assistant

### Cách A — qua HACS (khuyến nghị)
1. HACS → **Integrations** → ⋮ → **Custom repositories**
2. Dán `https://github.com/minhquanghp86/DashboardOS-Server`, chọn loại **Integration** → **Add**
3. Tìm **Dashboard OS** → **Download** → **Restart Home Assistant**

### Cách B — thủ công
1. Chép thư mục `custom_components/dashboard_os` vào `/config/custom_components/`
2. Restart Home Assistant

### Thêm tích hợp
1. **Settings → Devices & Services → + Add Integration → Dashboard OS**
2. Giữ địa chỉ mặc định `http://172.30.32.1:18080` → **Submit**

Mỗi màn hình trở thành **một thiết bị** trong HA, tự cập nhật 30 giây/lần.

![Cài đặt](images/settings.png)

## 6. Sử dụng hằng ngày trên màn hình

| Thao tác | Kết quả |
|---|---|
| Vuốt từ **đáy** lên | Về màn hình chính |
| Vuốt từ **mép trái/phải** | Quay lại (như nút Back) — xem GIF bên dưới |
| Chạm giữ ứng dụng ở màn hình chính | Vào chế độ sắp xếp: đổi thứ tự, gom thư mục, ẩn/hiện |
| Vuốt từ **trên** xuống | Mở bảng thông báo |
| Không chạm ~1 phút | Vào **màn hình chờ** (đồng hồ, lịch âm, thời tiết, ảnh gia đình) |
| Vuốt lên khi ở màn hình khoá | Mở khoá |

![Giao diện OS](images/oshome.png)

*Cử chỉ vuốt ngang (mô phỏng từ ảnh thật của panel):*

![Cử chỉ vuốt](images/swipe.gif)

### Màn hình chờ (screensaver)
- Đồng hồ lớn + ngày âm lịch + thời tiết; tuỳ chọn hiện **ảnh nền** (Google Photos hoặc thư mục media).
- Hiệu ứng chuyển ảnh: Mờ dần, Trượt, Thu phóng, Mờ ảo, Chậm (Ken Burns), Xoay vào/ra, Rơi từ trên, Lật 3D.
- Thời gian chuyển ảnh: 5 giây → 5 phút. Chạm vào màn để quay lại.

![Màn hình chờ](images/weather.png)

### Các ứng dụng có sẵn
Camera (xem/chụp/quay lưu thẻ SD), Frigate, IPTV, YouTube, YouTube TV, nhạc, radio, tin tức, lịch, thời tiết,
ảnh, ghi chú, tệp, gọi video giữa các màn, chuông cửa, báo thức, tin nhắn nội bộ.

![Lịch](images/calendar.png) ![IPTV](images/iptv.png) ![Radio](images/radio.png)

**Một số ứng dụng trên P4**

| YouTube TV | Tin nhắn |
|---|---|
| ![YouTube TV](images/app-yttv.png) | ![Tin nhắn](images/app-chat.png) |

| Gọi video | Camera |
|---|---|
| ![Gọi video](images/app-call.png) | ![Camera](images/app-camera.png) |

**Các ứng dụng khác**

| Frigate | Sự kiện camera | Thư viện |
|---|---|---|
| ![Frigate](images/app-frigate.png) | ![Sự kiện camera](images/app-events.png) | ![Thư viện](images/app-gallery.png) |

| Phòng | Solar | TikTok |
|---|---|---|
| ![Phòng](images/app-rooms.png) | ![Solar](images/app-solar.png) | ![TikTok](images/app-tiktok.png) |

| YouTube Music | Radio | Tin tức |
|---|---|---|
| ![YouTube Music](images/app-music.png) | ![Radio](images/app-radio.png) | ![Tin tức](images/app-news.png) |

| Media | IPTV |
|---|---|
| ![Media](images/app-media.png) | ![IPTV](images/app-iptv.png) |



**Báo thức**: đặt trên màn hoặc từ trang Dashboard; lặp theo thứ, báo lại, chọn màn nào reo. Báo thức lưu ở
server nên **màn tắt vẫn reo đúng giờ**.

![Báo thức](images/alarm.png)

## 7. Sử dụng trang Dashboard trên điện thoại

Mở **Sidebar → Dashboard**:

| Mục | Chức năng |
|---|---|
| **Màn hình** | Trạng thái từng màn (ứng dụng, pin, Wi-Fi/LAN, IP, độ sáng), mở/sửa ứng dụng, đổi Wi-Fi, chất lượng hình, góc xoay |
| **Điều khiển** | Xem màn hình trực tiếp, chạm/vuốt, phím Trở lại / Màn hình chính / Gần đây / Mở khoá, chụp màn hình |
| **Báo thức** | Chọn màn → trình báo thức của màn đó; xem báo thức chung |
| **Tin nhắn** | Nhắn tin/ảnh/video giữa các màn và điện thoại |
| **IPTV** | Danh sách kênh, phát lên màn, điều khiển |
| **Quản lý file** | Duyệt/tải/xoá tệp trên thẻ SD của màn |
| **Chuông cổng** | Nhật ký bấm chuông, ảnh, trả lời |
| **Gọi video** | Gọi giữa các màn |
| **Menu ứng dụng** | Bật/tắt, sắp xếp, đổi biểu tượng/màu lưới ứng dụng từng màn |

![Điều khiển](images/control.png)

## 8. Thông báo lên màn hình

Hành động `dashboard_os.send` — gửi chữ, ảnh, video, âm thanh, camera.

```yaml
action:
  - action: dashboard_os.send
    data:
      title: "Chuông cổng"
      message: "Có người bấm chuông"
      camera: camera.chuong_cua      # hoặc tên luồng go2rtc: chuong_cua
      duration: 20                   # giây (0 = phải chạm để đóng)
      priority: urgent
      device: "4.3 Guition JC4827w543 9b2260"   # bỏ trống = mọi màn
```

| Tham số | Ý nghĩa |
|---|---|
| `message` | Nội dung (có thể bỏ trống nếu chỉ hiện camera/ảnh) |
| `title` | Tiêu đề |
| `duration` | Số giây hiển thị toàn màn (0 = chờ chạm) |
| `priority` | `urgent` (mở khoá + bật đèn + phủ toàn màn), `critical` (xuyên Không làm phiền), `high`, `normal` |
| `image` / `video` / `audio` | URL, media-source, hoặc đường dẫn trong `/config` |
| `camera` | Thực thể camera HA **hoặc** tên luồng go2rtc |
| `device` | Chọn màn trong UI (nhiều màn được); bỏ trống = tất cả |

**Hành vi khi có camera**: ảnh phủ **toàn màn hình** theo đúng kích thước và góc xoay hiện tại; tiêu đề + nội dung
hiện ở **góc trên** màu xanh nõn chuối để không chồng lên watermark giờ của camera.

**Sau khi thông báo kết thúc**, màn trở về đúng trạng thái trước đó: đang khoá → khoá lại; đang mở → về màn hình chính.

## 9. Dùng Blueprint (không cần viết YAML)

Repo client có 6 blueprint sẵn: thông báo, nhắc lịch, chào buổi sáng, hiện camera, chuông cổng báo cả nhà,
cảnh báo an ninh.

1. Chép file `*.blueprint.yaml` trong `DashboardOS-Client/examples/home-assistant/` vào
   `/config/blueprints/automation/dashboard/`
2. **Settings → Automations → + Create → Use a blueprint**
3. Chọn blueprint, điền thông tin (cảm biến kích hoạt, camera, màn hình, thời gian…) → **Save**

> Khi sửa blueprint có sẵn, chạy **Developer Tools → Actions → automation.reload** để áp dụng.

## 10. Dịch vụ (hành động) thường dùng

| Nhóm | Hành động |
|---|---|
| Thông báo | `send` |
| Điều hướng | `open_app`, `open_url`, `nav` (home/back/recents/unlock), `wake`, `lock`, `reload`, `close_app` |
| Hiển thị & âm thanh | `set_brightness`, `set_volume`, `set_quality`, `set_rotation`, `set_dnd`, `set_no_sleep`, `set_screensaver` |
| Giọng nói | `say` (đọc trên loa của màn — chỉ màn có loa như P4) |
| Báo thức | `alarm_create`, `alarm_list`, `alarm_delete`, `alarm_set_enabled`, `alarm_stop`, `alarm_snooze` |
| Nâng cao | `list_screens`, `get_status`, `cast_iptv`, `touch`, `swipe`, `screenshot`, `set_setting`, `send_command` |

Ví dụ thường dùng:

```yaml
# Bật sáng màn lúc 6:30 và mở dashboard
- action: dashboard_os.set_brightness
  target: { device_id: <id màn hình> }
  data: { brightness: 70 }
- action: dashboard_os.open_url
  target: { device_id: <id màn hình> }
  data: { url: "http://192.168.10.2:8123/dashboard-mobile/3" }

# Đọc thông báo bằng giọng nói
- action: dashboard_os.say
  target: { device_id: <id màn hình> }
  data: { message: "Đã bật máy lạnh" }

# Đặt báo thức 06:30 các ngày trong tuần
- action: dashboard_os.alarm_create
  target: { device_id: <id màn hình> }
  data: { time: "06:30", days: [1,2,3,4,5], label: "Dậy đi học", snooze: 10 }

# Chụp màn hình rồi gửi Telegram
- action: dashboard_os.screenshot
  target: { device_id: <id màn hình> }
  data: { filename: hien-tai }
  response_variable: shot
- action: notify.telegram
  data: { message: "Màn hình", data: { photo: "{{ shot.screenshots[0].path }}" } }
```

## 11. Entity của mỗi màn hình

| Loại | Entity và ý nghĩa |
|---|---|
| Cảm biến | `ket_noi` (đang kết nối?), `ung_dung_dang_mo`, `trang_thai_man_hinh` (đang dùng / màn hình chờ / khoá / không làm phiền) |
| Nút bấm | `man_hinh_chinh`, `quay_lai`, `gan_day`, `danh_thuc`, `tai_lai_trang`, `chup_man_hinh` |
| Công tắc | `man_hinh_cho`, `khong_lam_phien`, `khong_cho_man_ngu` |
| Thanh trượt | `do_sang`, `am_luong`, `chat_luong_hinh` |
| Chọn | `goc_xoay` (0 / 90 / 180 / 270) |

Dùng trực tiếp trong dashboard HA hoặc làm điều kiện automation.

## 11.1. Automation mẫu

10 kịch bản copy-paste sẵn (chuông cổng, báo động, chào buổi sáng, nhắc thuốc, báo mưa…):
[`AUTOMATION-MAU.md`](AUTOMATION-MAU.md).

## 12. Xử lý sự cố

| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| Màn không hiện trong danh sách | Sai Wi-Fi / IP HA | Kiểm tra trong cài đặt màn, khởi động lại màn |
| Hình giật, mờ | Chất lượng cao so với mạng | Giảm `Chất lượng hình`, bật nửa phân giải khi xem video |
| Camera không hiện | Tên camera/luồng sai | Dùng đúng tên camera HA hoặc tên luồng go2rtc (xem Frigate → go2rtc) |
| Thông báo hiện 10 giây dù đặt 20 | Blueprint cũ truyền `duration` qua template | Dùng blueprint mới (`duration: !input timeout`) |
| Chữ thông báo không hiện | Bản add-on cũ (< 2.9.290) | Cập nhật add-on |
| Không điều khiển được từ điện thoại | Mở qua tên miền, WebSocket bị chặn | Mở bằng `http://<ip-ha>:18080` |
| Báo thức không reo | Màn không nằm trong "Reo trên" của báo thức | Sửa báo thức, chọn đúng màn |

## 13. Sao lưu & nâng cấp

- Sao lưu add-on trong HA (bộ đệm Chrome đã được loại để bản sao nhẹ).
- Nâng cấp: **Settings → Add-ons → Dashboard OS Server → Update**. Cấu hình màn, báo thức, tin nhắn nằm trong `/data` nên **không mất** khi nâng cấp.
- Cập nhật tích hợp: HACS → Dashboard OS → Update → restart HA.

## 14. Câu hỏi thường gặp

**Có cần Internet không?** Không. Toàn bộ chạy trong LAN.

**Một màn có dùng được nhiều dashboard không?** Có — mỗi màn mở nhiều tab, mỗi tab một URL/dashboard.

**Bao nhiêu màn một server?** Khuyến nghị ≤ 8 màn/add-on (giới hạn `MAX_DEVICES`).

**Màn hình tắt có nhận thông báo không?** Có, thông báo `urgent`/`critical` sẽ đánh thức màn.

**Có thể dùng camera của chính panel (P4) không?** Có — ứng dụng Camera, và luồng H.264 của panel cũng đẩy được sang Frigate.

# Dashboard OS — biến màn hình ESP32 thành bảng điều khiển Home Assistant

**Dashboard OS** truyền giao diện Home Assistant (hoặc bất kỳ trang web nào) xuống màn hình **ESP32-S3 / ESP32-P4**
theo thời gian thực, kèm bộ giao diện kiểu điện thoại: màn hình chính, thanh trạng thái, ứng dụng, thông báo,
chuông cửa, báo thức, tin nhắn, IPTV.

- Cài và cấu hình hoàn toàn bằng giao diện web — không sửa file.
- Mỗi màn hình là một thiết bị trong Home Assistant (nút bấm, thanh trượt, cảm biến).
- Chạy trong mạng nội bộ (LAN/Tailscale), không cần Internet.

![Màn hình chính](images/menu.png)

---

## 1. Tính năng

### Hiển thị
- Chiếu **dashboard Home Assistant** hoặc URL bất kỳ, nhiều tab cho mỗi màn, chuyển tab tức thì.
- Tự điều chỉnh chất lượng hình và nhịp khung theo mạng; chế độ nửa phân giải khi xem video.
- **Màn hình chờ**: đồng hồ lớn, ngày âm lịch, thời tiết, ảnh gia đình (Google Photos hoặc thư mục media).
- Xoay 0/90/180/270, độ sáng, âm lượng, tắt tiếng, chế độ Không làm phiền.

![Màn hình chờ](images/saver.png)

### Giao diện điện thoại
- Màn hình chính dạng lưới: ẩn/hiện ứng dụng, đổi thứ tự, biểu tượng, màu, gom thư mục.
- Thanh trạng thái (pin, Wi-Fi, giờ), kéo xuống để mở bảng thông báo, khoá màn hình bằng vuốt.
- Ứng dụng gần đây, phím Trở lại / Màn hình chính, cử chỉ vuốt bám theo tay.

![Giao diện OS](images/oshome.png)

### Ứng dụng có sẵn
Camera (xem, chụp, quay lưu thẻ SD), Frigate, IPTV, YouTube, YouTube TV, nhạc, radio, tin tức, lịch, thời tiết,
ảnh, ghi chú, tệp, gọi video giữa các màn, chuông cửa, **báo thức**, tin nhắn nội bộ.

![Lịch](images/calendar.png) ![Radio](images/radio.png) ![IPTV](images/iptv.png)

### Chuông cửa
Bấm chuông ở cổng → mọi màn đổ chuông, hiện hình người bấm, nói chuyện 2 chiều, mở cổng.
Không ai nghe → thông báo "cuộc gọi nhỡ" kèm ảnh, lưu nhật ký 30 ngày.

### Báo thức
Đặt trên màn hoặc từ trang Dashboard: lặp theo thứ, báo lại, chọn màn nào reo.
Báo thức lưu ở server nên **màn tắt vẫn reo đúng giờ**.

![Báo thức](images/alarm.png)

### Tin nhắn nội bộ
Gửi tin, ảnh, video giữa các màn hình và điện thoại; màn hình bắn sự kiện về Home Assistant để báo lên điện thoại.

### Điều khiển từ xa
Trang **Điều khiển** trên điện thoại: xem màn hình trực tiếp, chạm/vuốt, phím **Trở lại / Màn hình chính /
Gần đây / Mở khoá**, chụp màn hình.

![Điều khiển](images/control.png)

## 2. Cần gì để bắt đầu

| Thành phần | Yêu cầu |
|---|---|
| Home Assistant | HA OS hoặc Supervised, kiến trúc **amd64** |
| Màn hình | ESP32-S3 / ESP32-P4 đã nạp firmware Dashboard OS |
| Mạng | Màn hình và Home Assistant cùng một mạng LAN |

## 3. Cài đặt (5 phút)

1. **Settings → Add-ons → Add-on Store → ⋮ → Repositories** → dán
   `https://github.com/minhquanghp86/DashboardOS-Server` → **Add**.
2. Tìm **Dashboard OS Server** → **Install** → **Start**.
3. Bật **Show in sidebar**. Thanh bên xuất hiện mục **Dashboard**.
4. Nạp firmware cho màn hình (repo `DashboardOS-Client`, chọn YAML theo loại màn).
   Lần đầu màn hình phát Wi-Fi riêng `dashboard-…` để nhập Wi-Fi nhà.
5. Mở **Dashboard → Màn hình**: màn hình vừa kết nối xuất hiện trong danh sách.

![Danh sách màn hình](images/screens.png)

## 4. Sử dụng hằng ngày

### Trên điện thoại (trang Dashboard)
- **Màn hình**: trạng thái từng màn (đang mở gì, pin, Wi-Fi, độ sáng), mở/sửa ứng dụng, đổi Wi-Fi,
  độ sáng, chất lượng hình.
- **Điều khiển**: xem và thao tác màn hình từ xa.
- **Báo thức**, **Tin nhắn**, **IPTV**, **Quản lý file** (thẻ SD), **Chuông cổng**, **Cuộc gọi** (Nhật ký + Thiết bị).
- **Menu ứng dụng**: bật/tắt, sắp xếp, đổi biểu tượng/màu cho lưới ứng dụng của từng màn.

![Cài đặt](images/settings.png)

### Trên màn hình
- Vuốt từ đáy lên: về màn hình chính. Vuốt từ mép trái/phải: quay lại.
- Chạm để mở ứng dụng; giữ để sắp xếp lưới.
- Cài đặt màn hình: Wi-Fi, độ sáng, màn hình chờ, âm thanh.

## 5. Ứng dụng Android Dashboard OS

Ứng dụng **Dashboard OS** cho Android mang bảng điều khiển vào một app riêng và biến điện thoại thành
**một thiết bị gọi được**: chuông reo cả khi bạn đã đóng app, bấm **Nghe** là nói chuyện được với màn hình P4.

Bản đang phát hành: **1.7** (versionCode **8**) — màn **Kết nối** thiết kế lại, **đăng xuất** sạch phiên, **bong bóng
bánh răng** kéo được, màn **Cài đặt** mới, **Chẩn đoán** xuất log ra tệp, ứng dụng **Cuộc gọi** có nhật ký.

### 5.1. Tải và cài đặt

1. Tải tệp **`DashboardOS-release.apk`** (~2,5 MB) trong thư mục `android/` của repo
   [DashboardOS-Server](https://github.com/minhquanghp86/DashboardOS-Server) — mở tệp rồi bấm **Download**.
   Đúng bản 1.7 khi: **versionCode 8**, md5 `8c4937b6be88968d46dd004d542bfe35`.
2. Trên điện thoại, cho phép cài từ nguồn ngoài: **Cài đặt → Bảo mật → Cài đặt đặc biệt → Cài ứng dụng không rõ
   nguồn gốc** → chọn ứng dụng bạn dùng để mở tệp (Trình quản lý tệp hoặc Chrome).
3. Mở tệp APK → **Cài** → **Mở**.

> Bản phát hành đã **ký** (không phải bản debug). Cài đè bản 1.7 cũ **không mất** địa chỉ đã lưu và mã máy — nhờ vậy
> danh bạ gọi không sinh thêm thiết bị trùng. Nếu máy đang cài bản **debug** cũ (md5 khác, khác chữ ký), Android báo
> "Ứng dụng chưa được cài đặt": phải **gỡ bản debug trước** rồi cài lại — cấu hình cũ (địa chỉ, mã máy) mất, nhập lại
> như máy mới.

### 5.2. Màn Kết nối (màn đầu tiên của app)

(ảnh sẽ bổ sung: màn Kết nối của app 1.7)

Từ trên xuống chỉ còn đúng những gì cần dùng:

| Thành phần | Nội dung |
|---|---|
| Logo + tên app | biểu tượng Dashboard OS · **Dashboard OS** |
| Dòng phiên bản | **v1.7 (8)** — luôn hiện để biết đang cài bản nào |
| Ô nhập | **Địa chỉ Home Assistant** (tên miền hoặc IP LAN) |
| Nút chính | **KẾT NỐI** |
| Dòng trạng thái | **Đã kết nối: …** / **Chưa kết nối** / lỗi ngắn gọn — đúng **1 dòng** |
| Hàng chip | **Cài đặt · Chẩn đoán · Đăng xuất** — "Đăng xuất" chỉ hiện khi đã có cấu hình hoặc phiên đăng nhập |

Mọi đoạn mô tả dài (gợi ý panel, ghi chú IP LAN, footer, danh sách URL đã thử) đã **bỏ khỏi giao diện**; danh sách URL
đã thử vẫn xem được trong **Chẩn đoán**.

### 5.3. Nhập một ô địa chỉ

App chỉ hỏi **một ô**: địa chỉ Home Assistant. Bạn nhập **tên miền** hoặc **IP LAN**, app tự tìm cả trang lẫn API.

| Bạn nhập | App dùng | Gọi video được? |
|---|---|---|
| Tên miền, vd `hass.example.com` | `https://hass.example.com/api/hassio_ingress/<token>/` cho **cả trang lẫn API**, gửi kèm cookie đăng nhập Home Assistant | **Có** micro + camera |
| IP LAN, vd `192.168.10.2` | trang: `https://192.168.10.2:18443/launcher-config.html` (HTTPS **tự ký** của add-on) · API: `http://192.168.10.2:18080` | **Có** — app tự chấp nhận chứng chỉ tự ký của **đúng máy chủ đã nhập** |

- **Nên dùng tên miền**: trang chạy HTTPS thì mới được cấp micro/camera (trình duyệt chỉ cho dùng micro/camera
  trên HTTPS).
- **IP LAN vẫn gọi video được** (add-on **2.9.308** trở lên): add-on tự phục vụ **HTTPS cổng 18443** bằng chứng chỉ
  tự ký, app chấp nhận chứng chỉ đó cho đúng máy chủ bạn nhập. Mở `https://<ip>:18443` bằng **trình duyệt** trên máy
  khác sẽ thấy cảnh báo chứng chỉ — bấm "Tiếp tục / Nâng cao → Vẫn truy cập".
- Lần đầu với **tên miền**, app mở trang đăng nhập Home Assistant. Đăng nhập **một lần**; app giữ cookie cho những
  lần sau. Với **IP LAN** thì không cần đăng nhập HA.
- Bấm **KẾT NỐI** → dòng trạng thái hiện "Đã kết nối: …".
- App **tự đăng ký** với server: sau vài giây, điện thoại xuất hiện trong danh bạ gọi với nhãn **Điện thoại**
  (trên P4: ứng dụng **Cuộc gọi**; trên Dashboard: trang **Cuộc gọi**).

### 5.4. Bong bóng bánh răng

Khi đã vào dashboard, ở góc phải trên có **bong bóng tròn 44 dp hình bánh răng** thay cho nút chữ "URL" cũ.

| Thao tác | Kết quả |
|---|---|
| **Chạm** (nhấc tay trong 200 ms, gần như không dời) | Mở màn **Kết nối** |
| **Kéo** | Dời bong bóng tới bất kỳ đâu trong màn hình; thả ra là **nhớ vị trí** |
| Xoay máy / đổi độ phân giải | Bong bóng vẫn ở **đúng chỗ theo tỉ lệ** (góc phải trên vẫn là góc phải trên) |
| Không chạm **5 giây** | Bong bóng **mờ dần** (vẫn chạm và kéo được) |
| Chạm lại | Sáng lại như cũ |

Bong bóng **không bao giờ tự ẩn** — luôn có lối thoát về màn Kết nối. Mặc định ở góc phải trên, nằm dưới thanh trạng
thái; kéo mạnh tay cũng không ra ngoài màn hình.

### 5.5. Màn Cài đặt (4 nhóm)

Cùng phong cách với màn Kết nối: mỗi dòng một tiêu đề ngắn + trạng thái, bỏ hết khối chữ dài.

| Nhóm card | Nội dung |
|---|---|
| **Kết nối** | Máy chủ, mã máy, trang đang dùng, Home Assistant (chip **Đăng nhập / Trang chủ HA / Đăng nhập lại**), TOKEN ingress |
| **Nhận cuộc gọi** | Công tắc **Nhận cuộc gọi khi app đóng**, dịch vụ nền, cuộc gọi đang đến, chuông, kênh thông báo, lần kiểm tra cuối |
| **Quyền cần thiết** | Thông báo, tối ưu pin, toàn màn hình, cửa sổ nổi, Không làm phiền — kèm chip **Bật / Cho phép / Bỏ** |
| **Chẩn đoán** | **Log & chẩn đoán** (mở màn Chẩn đoán) và **Thông tin app** (cài đặt hệ thống của Android) |

### 5.6. Cấp quyền (làm một lần)

Trong app: **Cài đặt** → bật **Nhận cuộc gọi khi app đóng**, rồi bấm lần lượt các nút cấp quyền:

| Quyền | Để làm gì |
|---|---|
| Thông báo | Hiện thông báo cuộc gọi — không có quyền này thì không có chuông |
| Micro, Camera | Nói và gửi hình trong cuộc gọi |
| Bỏ tối ưu pin | Android không dừng dịch vụ nền khi máy để lâu |
| Hiện toàn màn hình | Màn hình gọi bật lên cả khi máy đang khoá |
| Cửa sổ nổi | Cho phép mở màn hình gọi khi app đang ở nền |
| Bỏ qua Không làm phiền | Chuông vẫn kêu khi máy để Im lặng / Không làm phiền |

### 5.7. Nhận cuộc gọi khi app đóng

- App chạy một **dịch vụ nền**, 2 giây hỏi server một lần → **không cần mở app** vẫn đổ chuông.
- Có cuộc gọi: màn hình gọi **toàn màn** (kể cả khi máy khoá) + chuông + rung theo **kênh thông báo**
  "Cuộc gọi đến", kèm hai nút **Nghe** / **Từ chối** ngay trên thông báo.
- Chuông do kênh thông báo phát nên bạn **tự chọn được nhạc chuông**: Cài đặt → Thông báo → Dashboard OS →
  "Cuộc gọi đến" → Âm thanh. Bản nhạc dài **không bị cắt** (thông báo chỉ đăng lại mỗi 30 giây).
- Máy khởi động lại → app **tự chạy lại** dịch vụ nền (trên Xiaomi/MIUI cần bật thêm "Tự khởi động").

### 5.8. Gọi và nhận cuộc gọi

1. Bấm **Nghe** (trên thông báo hoặc màn hình gọi) → app mở trang gọi và **tự vào cuộc gọi**.
2. Nói chuyện hai chiều; trên màn P4 hiện **hình camera điện thoại**.
3. Bấm **Kết thúc** ở bất kỳ bên nào → cả hai bên đóng ngay. Bấm **Từ chối** thì bên gọi biết ngay, không bị treo.
4. Rớt Wi-Fi vài giây: app tự nối lại, cuộc gọi được giữ trong **6 giây**.
5. Muốn **gọi đi** từ điện thoại: mở trang **Cuộc gọi** trong app rồi chọn màn P4.

Chi tiết đầy đủ (sơ đồ, bảng nút, xử lý lỗi): **chương 7** của [`HUONG-DAN-SU-DUNG.md`](HUONG-DAN-SU-DUNG.md).

![Ứng dụng Cuộc gọi trên màn P4](images/app-call.png)

### 5.9. Ứng dụng **Cuộc gọi** — 2 tab và nhật ký cuộc gọi

Ứng dụng **Gọi** nay đổi tên thành **Cuộc gọi** (tab trong Dashboard và mục trong lưới ứng dụng của P4). Trang
**Cuộc gọi** trên Dashboard/trình duyệt có **2 tab**:

| Tab | Nội dung |
|---|---|
| **Nhật ký** (mở sẵn) | Các cuộc **đã xong** của riêng máy bạn (tối đa **200 cuộc**): hướng gọi, thiết bị, thời gian, thời lượng, trạng thái; tự cập nhật **5 giây/lần** |
| **Thiết bị** | Danh bạ như cũ — **Màn hình → Điện thoại → Trình duyệt**, chấm xanh = online, kèm nút sửa tên / xoá điện thoại |

**Đọc một dòng nhật ký**

| Thành phần | Ý nghĩa |
|---|---|
| Mũi tên chéo **lên** (↖) | Cuộc gọi **đi** (máy này gọi) |
| Mũi tên chéo **xuống** màu xanh lá (↙) | Cuộc gọi **đến và đã nghe** |
| Mũi tên chéo **xuống** màu đỏ (↙) | Cuộc gọi **đến nhưng nhỡ** |
| Tên thiết bị + dòng phụ | Tên bên kia · `Hôm nay 14:32` / `Hôm qua 14:32` / `05/03` · loại thiết bị (màn hình / điện thoại / trình duyệt) |
| Cuối dòng | `00:42` = thời lượng đã nói · **Nhỡ** (gọi nhỡ) · **Từ chối** (máy kia từ chối) / **Đã từ chối** (máy này từ chối) · **Đã huỷ** · **Lỗi** |
| **Bấm vào một dòng** | **Gọi lại** đúng thiết bị đó |

- Nhật ký do **server** giữ (`/data/rwv-call-log.json`, giới hạn **200 cuộc** gần nhất; mỗi cuộc **một bản ghi** có cả
  hai bên `from`/`to`, server tách thành mục **gọi đi** / **gọi đến** theo máy đang hỏi) nên **ai cũng thấy đúng hướng
  gọi của mình**, và nâng cấp add-on không mất. Điện thoại: dù cuộc gọi được ghi dưới id máy hay id phiên web của
  trang `call-web.html` của máy đó, **cả hai đều thấy cùng một mục**.
- Cuộc đang đổ chuông **không** nằm trong nhật ký (nó đã hiện ở màn hình gọi); chỉ liệt kê cuộc đã xong.
- Ứng dụng **Cuộc gọi trên P4** vẫn là danh bạ (màn P4 không có tab Nhật ký); xem nhật ký ở trang **Cuộc gọi** trên
  Dashboard.

### 5.10. Chẩn đoán & xuất log

**Cài đặt → Log & chẩn đoán**, hoặc chip **Chẩn đoán** ngay ở màn Kết nối:

| Thành phần | Chi tiết |
|---|---|
| Nhật ký trong app | **300 dòng** gần nhất, mỗi dòng có giờ `HH:mm:ss` |
| **Sao chép** | Chép toàn bộ chẩn đoán để dán vào tin nhắn cho người hỗ trợ |
| **Chia sẻ** | Gửi nội dung qua Zalo / Telegram / Gmail… |
| **Lưu ra tệp** | Ghi ra `diag-YYYYMMDD-HHmmss.txt`, hiện **đường dẫn**, bật nút **Chia sẻ tệp** |
| Danh sách tệp | **5 tệp mới nhất** (`tên · thời gian · dung lượng`); bấm một dòng = chia sẻ tệp đó; có nút **Xoá tất cả** |
| **Tự lưu khi lỗi** | App **tự ghi** `diag-auto-….txt` khi không nâng được lên trang add-on hoặc gặp lỗi đăng nhập; giữ **5 tệp**, cách nhau ≥ 30 giây để không sinh tệp trùng |

Tệp nằm trong thư mục riêng của app trên điện thoại:

```
/sdcard/Android/data/vn.mqsmarthome.dashboardos/files/
```

Mở bằng ứng dụng **Quản lý tệp** (Android 11+ vào mục "Android/data"), hoặc bấm **Chia sẻ tệp** trong app. Gỡ app
thì thư mục này **mất theo** — hãy chia sẻ tệp trước khi gỡ.

### 5.11. Đăng xuất & đổi tài khoản Home Assistant

Đổi sang tài khoản HA khác (hoặc cho mượn / bán máy) thì **đăng xuất**, đừng chỉ xoá ô địa chỉ.

1. Màn **Kết nối** → chip **Đăng xuất** (màu đỏ). Chip này chỉ hiện khi app **đã có cấu hình hoặc phiên đăng nhập**.
2. Hộp thoại xác nhận → **Đăng xuất**.

App làm **7 bước** theo thứ tự cố định:

| # | Việc |
|---|---|
| 1 | `POST /app/remove` — **huỷ đăng ký thiết bị** trên máy chủ (mục "Điện thoại" trong danh bạ gọi biến mất) |
| 2 | Dừng **dịch vụ nền** (không còn nhận cuộc gọi) |
| 3 | Huỷ **thông báo cuộc gọi** + đóng màn hình gọi nếu đang mở |
| 4 | Xoá **toàn bộ cookie** của máy chủ (phiên đăng nhập HA) |
| 5 | Xoá dữ liệu WebView: **localStorage** (`hassTokens` của HA), cache, form, lịch sử |
| 6 | Xoá **cấu hình app**: địa chỉ, mã máy, TOKEN… (chỉ giữ cờ "đã xem hướng dẫn") |
| 7 | Về **màn Kết nối trống** + báo **Đã đăng xuất** |

Sau đó nhập địa chỉ mới (có thể là Home Assistant của nhà khác) → **KẾT NỐI** → đăng nhập tài khoản mới. Máy chủ cũ
**không còn** giữ thiết bị này trong danh bạ.

### 5.12. Xử lý sự cố thường gặp

| Hiện tượng | Cách xử lý |
|---|---|
| Trang báo **401** / "Cần đăng nhập Home Assistant" | Bấm **Đăng nhập** trong app, đăng nhập HA rồi bấm **Tôi đã đăng nhập**. Nếu vẫn 401: Cài đặt → mục **Home Assistant** → **Đăng nhập lại** |
| **Không tự vào dashboard** sau khi đăng nhập (dừng ở giao diện HA) | Bấm **Mở Dashboard** trên thanh trên cùng; hoặc **Cài đặt → Chẩn đoán** rồi gửi nội dung cho hỗ trợ. App đã tự thử **3 lần** (cách 1,5 giây); hết lượt thì giữ panel để bạn vẫn dùng được |
| Không có **micro/camera** (không gọi video được) | Trang phải chạy **HTTPS**. Dùng **tên miền** HA, hoặc **IP LAN** với add-on ≥ 2.9.308 (app tự dùng `https://<ip>:18443`) |
| Không đổ chuông khi đã đóng app | Cài đặt trong app: bật **Nhận cuộc gọi khi app đóng**; cấp **Thông báo**; **Bỏ tối ưu pin**; bật **Toàn màn hình** + **Cửa sổ nổi** |
| **MIUI/Xiaomi** chặn chuông, không hiện màn gọi | Bật **Autostart (Tự khởi động)**, **Cửa sổ nổi**, **Hiện trên màn khoá**, **Toàn màn hình khi có cuộc gọi**, **Bỏ tối ưu pin**; trong kênh "Cuộc gọi đến" chọn mức **Khẩn cấp**, bật Âm thanh + Rung + bỏ qua Không làm phiền |
| Chuông kêu 4–5 giây rồi lặp lại | App bản cũ. Cài bản APK mới (thông báo chỉ đăng lại mỗi 30 giây) |
| App báo "Không tìm thấy Dashboard OS" | Kiểm tra add-on đang chạy, điện thoại cùng Wi-Fi, nhập đúng tên miền/IP máy HA; nếu dùng tên miền, kiểm tra TOKEN ingress ở **Cài đặt** |
| Điện thoại không có trong danh bạ | Mở app, bấm **KẾT NỐI** (app tự đăng ký lại mỗi 60 giây); kiểm tra dòng "Đã kết nối" |
| Bấm Nghe nhưng không nghe thấy gì | Kiểm tra quyền **Micro** và âm lượng cuộc gọi; cuộc gọi phải từ **P4** (màn có micro + camera) |
| Danh bạ có mục trùng | Trong trang **Cuộc gọi**, dùng nút **sửa tên** / **xoá** để dọn; app tự gộp bản ghi của cùng một máy |
| **Log ở đâu?** | Màn Kết nối → chip **Chẩn đoán** (hoặc Cài đặt → **Log & chẩn đoán**): 300 dòng log + **Sao chép / Chia sẻ / Lưu ra tệp**. Tệp nằm ở `/sdcard/Android/data/vn.mqsmarthome.dashboardos/files/` (giữ 5 tệp; app tự lưu khi lỗi) |
| **Đổi tài khoản Home Assistant** | Màn Kết nối → **Đăng xuất** (xác nhận) → nhập địa chỉ HA mới → **KẾT NỐI**. Xem mục 5.11 để biết những gì bị xoá |
| Bong bóng bánh răng che nút của trang | **Kéo** bong bóng sang chỗ khác — vị trí được nhớ cho lần sau; chạm để mở màn Kết nối |

(ảnh sẽ bổ sung: màn Kết nối, bong bóng bánh răng, màn Cài đặt và màn hình cuộc gọi đến của app)

## 6. Dùng với Home Assistant (tích hợp Dashboard OS)

Mỗi màn hình là một thiết bị trong HA:

| Loại | Dùng để |
|---|---|
| Cảm biến | Màn có kết nối không, đang mở ứng dụng gì, đang khoá / màn hình chờ / đang dùng |
| Nút bấm | Về màn hình chính, quay lại, ứng dụng gần đây, đánh thức, tải lại, chụp màn hình |
| Công tắc | Màn hình chờ, Không làm phiền, giữ màn luôn sáng |
| Thanh trượt | Độ sáng, âm lượng, chất lượng hình |
| Chọn | Góc xoay 0/90/180/270 |

### Cài tích hợp
1. HACS → **Integrations** → ⋮ → **Custom repositories** → dán repo này, chọn *Integration* → **Add**.
2. **Dashboard OS** → **Download** → **Restart Home Assistant**.
3. **Settings → Devices & Services → + Add Integration → Dashboard OS** → giữ địa chỉ mặc định → **Submit**.

### Thông báo từ automation

```yaml
action:
  - action: dashboard_os.send
    data:
      title: "Chuông cổng"
      message: "Có người bấm chuông"
      camera: camera.chuong_cua
      duration: 30
      priority: urgent
```

| Mức ưu tiên | Hành vi |
|---|---|
| `urgent` (mặc định) | Mở khoá màn, bật đèn nền, phủ toàn màn hình |
| `critical` | Như urgent, hiện cả khi đang Không làm phiền |
| `high` | Phủ toàn màn, tôn trọng Không làm phiền |
| `normal` | Chỉ hiện thẻ thông báo |

### Ví dụ khác

```yaml
- action: dashboard_os.open_url          # mở dashboard buổi sáng
  target: { device_id: <id màn hình> }
  data: { url: "http://192.168.10.2:8123/dashboard-mobile/3" }

- action: dashboard_os.say               # đọc thông báo bằng giọng nói
  target: { device_id: <id màn hình> }
  data: { message: "Đã bật máy lạnh" }

- action: dashboard_os.set_quality       # giảm chất lượng khi mạng yếu
  target: { device_id: <id màn hình> }
  data: { quality: 40 }

- action: dashboard_os.alarm_create      # đặt báo thức cho một màn
  target: { device_id: <id màn hình> }
  data: { time: "06:30", days: [1,2,3,4,5], label: "Dậy đi học", snooze: 10 }
```

Danh sách đầy đủ **30 hành động**: [custom_components/dashboard_os/README.md](custom_components/dashboard_os/README.md).
Blueprint sẵn có (thông báo, nhắc lịch, chào buổi sáng, camera, chuông cổng, cảnh báo an ninh):
repo `DashboardOS-Client` → `examples/home-assistant/`.

## 7. Vận hành

| Việc | Ở đâu |
|---|---|
| Xem/sửa từng màn | Sidebar → Dashboard → Màn hình |
| Đổi Wi-Fi, độ sáng, chất lượng | Trên màn hình (Cài đặt) hoặc trang Dashboard |
| Sao lưu | Sao lưu add-on trong Home Assistant |
| Nhật ký | Settings → Add-ons → Dashboard OS Server → Log |

Cổng dùng trong LAN: `18080` (web, điều khiển), `18443` (HTTPS **tự ký** của add-on — dùng cho app Android để có
micro/camera mà không cần ingress) và `8081` (màn hình kết nối).

## 8. Xử lý sự cố

| Hiện tượng | Cách xử lý |
|---|---|
| Màn hình không hiện trong danh sách | Kiểm tra cùng mạng Wi-Fi và đúng IP máy HA; khởi động lại màn |
| Hình giật hoặc mờ | Giảm **Chất lượng hình**, hoặc bật nửa phân giải cho video |
| Màn hình đen sau khi cập nhật | Khởi động lại add-on, xem Log |
| Không điều khiển được từ điện thoại | Mở bằng IP LAN (`http://<ip-ha>:18080`), không qua tên miền |
| Báo thức không reo | Kiểm tra màn có trong danh sách "Reo trên" của báo thức |
| App Android **không tự vào dashboard** | Bấm **Mở Dashboard** trên thanh trên cùng của app; vẫn không được thì **Chẩn đoán → Sao chép** gửi hỗ trợ (mục 5.12) |
| Cần **log của app** (không có adb) | App → **Chẩn đoán** → **Sao chép / Chia sẻ / Lưu ra tệp**; tệp ở `/sdcard/Android/data/vn.mqsmarthome.dashboardos/files/` (mục 5.10) |
| **Đổi tài khoản Home Assistant** trên điện thoại | **Đăng xuất** ở màn Kết nối (huỷ đăng ký thiết bị, xoá cookie + localStorage + cấu hình) rồi kết nối lại (mục 5.11) |

## 9. Giấy phép

Apache-2.0 — xem [LICENSE](LICENSE), [NOTICE](NOTICE), [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
Nhãn hiệu: [TRADEMARKS.md](TRADEMARKS.md).

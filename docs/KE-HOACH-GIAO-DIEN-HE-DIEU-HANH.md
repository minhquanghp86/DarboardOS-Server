# Kế hoạch: giao diện kiểu hệ điều hành cho panel ("Darboard OS")

Ngày lập: 25/09/2026. Mốc quay về: **Bản Ổn định 25/09 đêm** (tag `ban-on-dinh-2026-09-25-dem`, server 2.9.44).

## 0. Quyết định và trạng thái

- Người dùng quyết định (25/09/2026):
  - panel **khởi động vào Home Assistant**;
  - **Gần đây là một nút**; **vuốt lên từ mép dưới = về Home của OS**;
  - các mục khác theo đề xuất (ứng dụng = tab; biểu tượng mục 6, chỉ hiện khi tính năng đã có).
- **OS-1 xong — server 2.9.45**:
  - Shell `src/shell/` (esbuild, Shadow DOM), cử chỉ mép ở server (`src/gestures.ts`), thanh trạng thái kéo xuống,
    Home của OS `/os/home` (đồng hồ, thời tiết, lưới chia trang, dock), "Trang chủ" → ứng dụng Home Assistant.
  - Đo trên P4: YouTube 28,8 fps (không đổi).
  - Việc cần điều tra sau: một lần WiFi nghẽn làm WS đứt và **60 s** mới nối lại (watchdog), lẽ ra < 1 s.
- **OS-2 xong — server 2.9.47**:
  - **Mỗi ứng dụng một tab Chromium riêng** (`Tab` interface, `dev.tabs: Map<string,Tab>` trong `deviceManager.ts`):
    Home Assistant (`key: 'home'`) và màn hình chính (`key: '__system'`) GHIM, tạo khi cần (không tạo trước lúc kết
    nối), không bao giờ bị đóng tự động. Ứng dụng khác mở qua `openApp()` — tạo tab mới hoặc kích hoạt tab đã có.
  - **Chuyển tab tức thì, không tải lại**: `activateTab()` chỉ đổi con trỏ `dev.cdp` sang session của tab kia, dừng
    `Page.startScreencast` ở tab cũ và bật lại ở tab mới — không có `Page.navigate` nào xảy ra khi chuyển đổi.
  - **Âm thanh theo tab**: `buildAudioGuardScript()` ghi đè `HTMLMediaElement.prototype.muted/volume`, đọc cờ
    `window.__rwvAudioAllowed` (server bật/tắt qua `Runtime.evaluate`, tự khẳng định lại mỗi lần tab điều hướng
    thật — chống việc lệnh bật "thua" một navigation đang chạy dở, xem chú thích `setTabAudioAllowed`). Radio/Nhạc
    được đánh dấu `backgroundAudio=true` nên tiếp tục phát khi không active; YouTube/TikTok bị tạm dừng khi rời tab.
  - **Định tuyến "Go Home"/"URL hiển thị"**: `navigateToUrl()` (export, dùng chung bởi `inputRouter.ts` và
    `handleUserEnteredUrl`) phân loại theo GỐC URL — cùng gốc Home URL vào tab `'home'`, khác gốc vào tab
    `'browser'` — vì hai loại lệnh này ĐI CHUNG một gói tin OpenURL ở tầng firmware, không phân biệt được.
  - **Giới hạn tab**: `MAX_APP_TABS` (mặc định 2) ứng dụng phụ mỗi màn hình, LRU theo `tab.lastUsed`; tab active
    hoặc đang phát nhạc nền không bao giờ bị đóng (có thể tạm vượt hạn mức khi cả hai đang giữ chỗ).
  - Shell (`src/shell/main.ts`) đổi từ `location.href = url` sang `sendControl({app: id})` — server quyết định mở
    tab nào, Shell không tự điều hướng ứng dụng nữa (chỉ còn ô nhập URL của "Trình duyệt" dùng `location.href`
    làm phương án dự phòng cho firmware cũ chưa hỗ trợ `urlset`).
  - Kiểm tra: `tsc --noEmit` sạch, 59/59 test qua (thêm 5 test `gestures.test.ts` cho cử chỉ mép).
  - **Lỗi thật gặp khi nạp lên P4/S3 (2.9.47), đã sửa trong 2.9.48**: `Page.startScreencast` báo lỗi CDP
    `Not attached to an active page` cho CẢ BA thiết bị lúc kết nối lần đầu. Nguyên nhân: `createTab()` gọi
    `Page.navigate` tới URL thật (đổi gốc, vd dashboard HA) NGAY TRONG lúc tạo tab, TRƯỚC KHI bật screencast —
    ngược thứ tự an toàn của bản gốc một-tab (luôn bật screencast trên trang `about:blank` ổn định trước, điều
    hướng sau; điều hướng đổi gốc có thể khiến Chrome đổi tiến trình dựng trang — site isolation — đúng lúc phiên
    CDP đang gắn vào mục tiêu đó). Sửa: tách `createTab()` (chỉ tạo target/tiêm script, không điều hướng) khỏi
    `navigateTab()` (điều hướng riêng); mọi nơi gọi đều theo thứ tự tạo tab → `activateTab()` (bật screencast) →
    `navigateTab()`.
  - **Đã xác minh thật trên P4 (2.9.48, xem log `docker logs` + kịch bản CDP tự lái)**:
    - Không còn lỗi `Not attached to an active page` lúc 3 thiết bị cùng kết nối.
    - YouTube vẫn 28,2 khung/giây (không đổi so với trước OS-2).
    - Mở "Camera" từ thanh trạng thái → log `[app] ...: chuyen sang tab "cams" (cams)` — tab mới được tạo và
      kích hoạt.
    - Quay lại "Home Assistant" → log `[app] ...: chuyen sang tab "home" (ha)`, **không có dòng log điều hướng
      nào cho tab "home"** (so với dòng điều hướng duy nhất lúc kết nối lần đầu) — xác nhận không tải lại trang.
    - **Chưa đo được** bằng tai/số liệu: âm thanh nền thật của Radio khi chuyển sang ứng dụng khác (mới xác minh
      logic qua đọc mã + luồng lệnh, chưa nghe thật trên loa P4); RAM addon thực tế khi mở nhiều tab cùng lúc.
- **Bổ sung 2.9.49 (26/09, phiên cloud — CHƯA nạp lên HASS, nằm trên nhánh `claude/two-repo-research-3ulwjd`)**:
  - **Sửa rò tab (race)**: `openApp()`/`navigateToUrl()` giờ chạy tuần tự theo từng thiết bị (`dev.tabOps`,
    `SerialQueue` trong `src/tabPolicy.ts`). Trước đó hai lệnh sát nhau cùng thấy "chưa có tab" và tạo hai tab, tab
    đầu bị ghi đè khỏi `dev.tabs` và không bao giờ đóng. **Đã tái hiện trên server thật + Chromium** (client WS giả,
    3 cử chỉ vuốt-về-Home cách ~13 ms): mã 2.9.48 → 3 tab `/os/home`; 2.9.49 → 1 tab.
  - **Sửa `resolveAppSpec` dùng `baseKind`**: ứng dụng bị đổi biểu tượng ở Menu panel có `kind: 'mdi'`, làm Radio/Nhạc
    mất phát nền và YouTube/TikTok không tự dừng khi rời tab.
  - **Thẻ "Đang phát" (việc 5 của bàn giao cũ)**: script khoá âm thanh (`buildAudioGuardScript`) báo `{media:0|1}` qua
    `__rwvControl` khi thẻ `<audio>/<video>` đổi trạng thái phát; server lưu `tab.mediaPlaying/mediaKnown` và đẩy
    `np` (danh sách tab NỀN đang phát) trong trạng thái Shell. Thanh kéo xuống hiện thẻ với nút Mở / ■ (`{stop:key}` →
    `window.__rwvMediaStop()`, trang radio tự huỷ HLS qua `window.rwvStop`). Chính sách dọn tab: Radio/Nhạc chỉ được
    miễn khi đang phát (hoặc chưa từng báo — thận trọng). Kiểm bằng Chromium thật: báo phát/dừng đúng, bấm ■ gửi đúng
    lệnh, bố cục ở 1024×600, 480×480, 480×272 (màn thấp xếp thẻ thành hàng ngang, bảng không vượt chiều cao màn).
## 1. Ý tưởng của người dùng (tóm lại để thống nhất)

- Panel không còn là "trình duyệt mở dashboard HA + popup menu", mà là **một hệ điều hành nhỏ** kiểu điện thoại / máy
  tính bảng, có nhiều ứng dụng. **Home Assistant (dashboard) là một ứng dụng**, được ưu tiên hơn các ứng dụng khác.
- **Nút ở giữa mép trên** vẫn hiện giờ như hiện nay.
- **Kéo từ bất kỳ điểm nào trên mép trên xuống** thì mở **thanh trạng thái mở rộng** gồm:
  - cài đặt nhanh, tiện ích, thông tin (như popup hiện tại);
  - **không có lưới ứng dụng**;
  - thay vào đó là **các biểu tượng mở trang toàn màn hình**: *Ứng dụng*, *Cài đặt*, *Home Assistant*, và các mục khác
    (mục 6).
- Trang toàn màn hình có **phím điều hướng** (Quay lại / Tiếp / Home) khi cần.
- **Home** (trên màn hình) → trang **Ứng dụng**. Nút/thực thể **Go Home** của ESPHome → tab HA đặt trong `home_url`.
- Mục tiêu: trải nghiệm như hệ điều hành điện thoại — **mượt, đẹp, nhất quán**.

## 2. Ràng buộc kỹ thuật phải thiết kế quanh

| Ràng buộc | Hệ quả thiết kế |
|---|---|
| Mọi thứ trên màn hình là **khung JPEG truyền qua WiFi**; P4 chịu ~28–29 khung/giây đủ màn hình, S3 ~10–15 (giải mã phần mềm 63 ms) | Hiệu ứng phải **ngắn và ít khung**: P4 cho phép kéo theo ngón tay; S3 bật/tắt tức thì. Mỗi thiết bị có một "mức chuyển động" (mục 7) |
| Cảm ứng đi từ panel → server → trình duyệt (tọa độ) | Nhận diện cử chỉ mép màn hình **ở server** (mục 3.3), không phụ thuộc trang web có chặn chạm hay không |
| Một trình duyệt dùng chung, mỗi panel một tab | Mở rộng thành **mỗi panel nhiều tab** (mỗi ứng dụng một tab); server chỉ truyền hình tab đang ở phía trước |
| Chrome **không bóp** tab nền có WebSocket hoặc đang phát tiếng ([Chrome for Developers](https://developer.chrome.com/blog/background_tabs)) | Giữ tab HA "ấm": quay lại HA **tức thì**, không tải lại; radio phát nền được |
| CSS của từng trang web có thể làm vỡ giao diện chèn vào (đã gặp: font đồng hồ) | Giao diện hệ thống nằm trong **Shadow DOM** riêng, trang web không ảnh hưởng được |
| Một số trang có Trusted Types (cấm `innerHTML`) | Lớp hệ thống chỉ dùng DOM API (như hiện nay) |

## 3. Kiến trúc đề xuất

```
                        ┌──────────────── SERVER (addon) ─────────────────────────────┐
 panel ── chạm ───────► │ Bộ nhận diện cử chỉ ──┬─ cử chỉ hệ thống → điều khiển Shell  │
                        │   (mép trên/dưới)     └─ còn lại → trình duyệt (tab trước)   │
                        │                                                               │
                        │ Quản lý ứng dụng (mỗi panel):                                 │
                        │   tab "Hệ thống" (Ứng dụng, Cài đặt, Thông báo…  — 1 SPA)     │
                        │   tab "Home Assistant" (ghim, luôn ấm)                        │
                        │   tab ứng dụng khác (YouTube, Radio…) — tối đa N, cũ nhất đóng │
                        │        ▲ chỉ tab phía trước được truyền hình (screencast)     │
                        │ Shell (lớp phủ Shadow DOM trong MỌI tab): thanh trạng thái,   │
                        │   bảng kéo xuống, thanh điều hướng, báo thức, thông báo nổi   │
 panel ◄── khung JPEG ─ │                                                               │
                        │ Kênh trạng thái: DeviceState / DeviceControl (đã có)          │
                        │ + API Home Assistant (đã có quyền) cho Cài đặt chi tiết       │
                        └───────────────────────────────────────────────────────────────┘
```

### 3.1 Ứng dụng = tab (khuyến nghị) thay vì "điều hướng trong một tab"

| | Một tab, điều hướng (như hiện nay) | **Mỗi ứng dụng một tab** |
|---|---|---|
| Quay lại HA | Tải lại dashboard 2–4 s, mất trạng thái cuộn | **Tức thì**, giữ nguyên |
| Radio / nhạc khi mở ứng dụng khác | Tắt | **Phát nền được** |
| Màn hình "Gần đây" (đa nhiệm) | Không làm được | Có ảnh thu nhỏ từng ứng dụng |
| RAM server | Thấp | +100–250 MB mỗi tab đang mở → **giới hạn N tab/panel**, tự đóng tab lâu không dùng |

Quy tắc: tab *Hệ thống* và *Home Assistant* luôn mở; YouTube/TikTok **tạm dừng** khi rời đi (tránh tiếng chồng);
Radio/Nhạc được **phát nền** (có điều khiển trong bảng kéo xuống).

### 3.2 Shell = một gói JavaScript riêng, Shadow DOM

- Tách khỏi chuỗi template trong `deviceManager.ts` thành mã nguồn riêng `shell/` (TypeScript), đóng gói bằng
  **esbuild** thành một file, tiêm vào mọi tab như hiện nay. Dễ bảo trì, có kiểm thử.
- Toàn bộ giao diện hệ thống nằm trong **Shadow DOM đóng**, font và biến màu riêng: trang web bên dưới không làm vỡ được.
- Trạng thái (giờ, độ sáng, thời tiết, thông báo, hẹn giờ, ứng dụng đang chạy) do server đẩy xuống, như
  `__rwvDeviceState` hiện nay.

### 3.3 Cử chỉ nhận diện ở server

Server đã nhận chuỗi chạm thô từ panel trước khi đưa vào trình duyệt, nên nhận diện ở đó:

- **Chạm xuống trong dải 16 px mép trên + kéo xuống > 24 px** → cử chỉ mở bảng. Server **không** chuyển các chạm này
  cho trang web, mà điều khiển Shell theo vị trí ngón tay (P4: bảng kéo theo ngón; thả quá 1/3 thì mở hẳn).
- **Chạm nhanh** vào mép trên (không kéo) → chuyển cho trang như bình thường (không phá nút của HA ở đầu trang).
  Nút đồng hồ ở giữa vẫn chạm được như cũ.
- **Vuốt lên từ mép dưới** → hiện thanh điều hướng (Quay lại / Home / Gần đây) trên các ứng dụng "trần" như HA,
  YouTube; tự ẩn sau 3 s.
- Ngưỡng và dải mép chỉnh được theo từng panel (cảm ứng của mỗi màn hình khác nhau).

### 3.4 Ứng dụng hệ thống = một trang đơn (SPA)

*Ứng dụng*, *Cài đặt*, *Thông báo*, *Thời tiết*, *Lịch*, *Hẹn giờ*… gộp thành **một SPA** ở cổng 18080 với định tuyến
nội bộ: chuyển giữa chúng **không tải lại trang** (nhanh, có hiệu ứng trượt ngắn). Trang Camera/Radio hiện có được đưa
vào dần. Mỗi trang có **thanh tiêu đề** với nút Quay lại, tiêu đề, và hành động phụ; thanh điều hướng dưới cùng
(Quay lại · Home · Gần đây) như Android.

### 3.5 Cài đặt chi tiết qua API Home Assistant

Các cài đặt của panel (độ sáng, thời gian tắt màn hình, xoay, âm lượng, Home URL, khởi động lại…) **đã là thực thể
ESPHome trong HA**. Trang Cài đặt đọc/ghi chúng qua API HA (addon đã có quyền), kèm số liệu thiết bị (heap, CPU, WiFi,
nhiệt độ, phiên bản firmware). Không phải mở rộng giao thức cho từng cài đặt. Riêng thanh trượt/nút nhanh vẫn đi kênh
`DeviceControl` trực tiếp để phản hồi tức thì.

## 4. Home và Go Home

| Hành động | Đích |
|---|---|
| Nút **Home** trên thanh điều hướng / trong bảng kéo xuống | Trang **Ứng dụng** (màn hình chính của "hệ điều hành") |
| Ứng dụng **Home Assistant** | Tab HA, giữ nguyên chỗ đang xem (không tải lại) |
| Nút / thực thể **Go Home** của ESPHome, tự động hoá HA | Tab HA **về đúng `home_url`** |
| Thực thể **URL hiển thị** (tự động hoá) | URL thuộc HA → tab HA; URL khác → mở trong ứng dụng Trình duyệt |
| Khởi động panel | Tuỳ chọn *Khởi động vào*: Home Assistant (mặc định, như hiện nay) hoặc Màn hình chính |

## 5. Các bề mặt giao diện

### 5.1 Thanh trạng thái (thu gọn)
Nút giọt nước ở giữa như hiện nay (giờ HH:MM). Tuỳ chọn thêm: biểu tượng nhỏ hai bên (WiFi yếu, đang phát nền, có
thông báo, hẹn giờ) — chỉ hiện khi có, để không che trang.

### 5.2 Bảng kéo xuống — 2 nấc (như Android)

**Nấc 1** (kéo ngắn, ~1/3 màn hình): giờ + ngày dương/âm + thời tiết · hàng 6 ô cài đặt nhanh · thanh độ sáng.

**Nấc 2** (kéo tiếp / chạm mở rộng, toàn bảng):
- Lưới **ô cài đặt nhanh** (bật/tắt, chạm giữ → mở trang cài đặt tương ứng): Luôn sáng, Tắt tiếng, Khử vọng, Không làm
  phiền, Chế độ đêm, Màn hình chờ, Khoá trẻ em, Xoay màn hình.
- Thanh **độ sáng** + **âm lượng**.
- Thẻ **Đang phát** (Radio / Nhạc / YouTube nền): tên, nút phát/dừng, tiếp.
- Thẻ **Hẹn giờ** đang chạy.
- **Thông báo** (thông báo của HA, chuông cửa, cảnh báo) — vuốt ngang để xoá.
- **Hàng biểu tượng mở trang toàn màn hình** (mục 6).

### 5.3 Màn hình chính (trang Ứng dụng)
Như màn hình chính điện thoại:
- **Tiện ích** ở trên: đồng hồ lớn, thời tiết, lịch âm, sự kiện kế tiếp.
- **Lưới ứng dụng** theo trang (vuốt ngang để sang trang), có thể có thư mục.
- **Dock** ghim ở dưới, Home Assistant đứng đầu.
- Sắp xếp/ẩn/thêm ứng dụng: trang **Menu panel** trong HA (đã có), sau này chạm giữ để sửa ngay trên màn hình.

### 5.4 Gần đây (đa nhiệm)
Thẻ ảnh chụp các ứng dụng đang mở; vuốt lên để đóng; chạm để chuyển (tức thì nhờ tab ấm).

### 5.5 Trang toàn màn hình
Thanh tiêu đề (← tiêu đề, hành động) + nội dung + thanh điều hướng (khi cần). Hiệu ứng chuyển trang: trượt ngang 150 ms
(P4) / tức thì (S3).

### 5.6 Cài đặt (cây mục)
- **Màn hình**: độ sáng, thời gian tắt, lịch chế độ đêm (tự giảm sáng), màn hình chờ (đồng hồ lớn / ảnh), xoay.
- **Âm thanh**: âm lượng trang web, âm lượng thông báo, tắt tiếng, khử vọng mic.
- **Mạng**: WiFi (tên, cường độ, IP), đo tốc độ, kết nối lại.
- **Ứng dụng**: danh sách, mặc định khởi động, cho phép phát nền.
- **Home Assistant**: Home URL, trang khởi động, tài khoản đang đăng nhập.
- **Thông báo & Không làm phiền**: lịch, ngoại lệ (chuông cửa luôn báo).
- **Thiết bị**: tên, phiên bản firmware, thời gian chạy, bộ nhớ, tải CPU, nhiệt độ, camera, khởi động lại.
- **Máy chủ**: phiên bản addon, các panel đang kết nối, số liệu `/metrics`.
- **Ngày giờ**: múi giờ, đồng bộ RTC.
- **Giới thiệu**: phiên bản, giấy phép, tài liệu.

## 6. Tư vấn các biểu tượng trong bảng kéo xuống

Hàng biểu tượng mở trang toàn màn hình (tối đa 6–8, thứ tự đề xuất):

| Biểu tượng | Mở | Vì sao cần |
|---|---|---|
| **Ứng dụng** | Màn hình chính | Lối vào mọi thứ (theo yêu cầu) |
| **Home Assistant** | Tab HA | Ứng dụng ưu tiên, một chạm từ mọi nơi |
| **Cài đặt** | Cài đặt | Theo yêu cầu |
| **Camera** | Lưới camera / cổng | Việc hay làm nhất trên bảng tường ngoài HA |
| **Thông báo** | Lịch sử thông báo, chuông cửa đã lỡ | Để không bỏ sót khi màn hình tắt |
| **Cảnh** | Nút cảnh/kịch bản | Điều khiển nhanh cả nhà |
| **Trợ lý** (GĐ3) | Hỏi bằng giọng nói | Chuẩn bị chỗ cho trợ lý |
| **Gần đây** | Đa nhiệm | Chuyển nhanh giữa ứng dụng đang mở |

Không đưa vào hàng này: Thời tiết, Lịch, Hẹn giờ (đã có dạng tiện ích / thẻ ngay trong bảng); Radio/Nhạc (thẻ Đang phát).

## 7. Ngân sách mượt mà theo thiết bị

| Mức | Thiết bị | Hiệu ứng |
|---|---|---|
| **Đầy đủ** | ESP32-P4 (1024×600, ~28 khung/s) | Bảng kéo theo ngón, trượt trang 150 ms, mờ nền |
| **Giảm** | ESP32-S3 480×480 | Mở/đóng 2–3 khung (~120 ms), không kéo theo ngón |
| **Tối thiểu** | ESP32-S3 480×272 | Không hiệu ứng, bố cục rút gọn (nấc 1 + biểu tượng) |

Nguyên tắc chung: chỉ dùng `transform`/`opacity`; dựng sẵn DOM của bảng (ẩn) để mở không phải dựng lại; không hiệu ứng
chạy liên tục (mỗi khung động là băng thông WiFi). Mục tiêu đo được: **mở bảng < 150 ms**, **chuyển về HA < 200 ms**,
**không giảm fps video** khi bảng đóng.

## 8. Lộ trình

Mỗi giai đoạn: làm → đo (fps, thời gian mở/chuyển, RAM server) → ảnh chụp → bạn duyệt → mới sang giai đoạn sau.
Bản Ổn định luôn là đường lui.

| GĐ | Nội dung | Nghiệm thu |
|---|---|---|
| **OS-1 Nền móng** | Shell tách thành mã riêng + esbuild + Shadow DOM; bộ nhận diện cử chỉ ở server; bỏ popup cũ bằng bảng kéo xuống nấc 1–2 (dữ liệu hiện có) | Kéo mép trên mở bảng trên P4 mượt; chạm HA bình thường; fps video không đổi |
| **OS-2 Ứng dụng = tab** | Quản lý nhiều tab/panel, chuyển screencast, HA ghim ấm, giới hạn N tab, tạm dừng/phát nền | Về HA < 200 ms, radio phát nền, RAM server trong ngân sách |
| **OS-3 Màn hình chính + SPA hệ thống** | Trang Ứng dụng (tiện ích, lưới, dock, trang), thanh điều hướng, Gần đây; Home / Go Home đúng như mục 4 | Home → Ứng dụng; Go Home → `home_url`; đa nhiệm chạy |
| **OS-4 Cài đặt** | Cây cài đặt qua API HA + số liệu thiết bị | Đổi mọi cài đặt trên panel, HA thấy ngay |
| **OS-5 Thông báo & chế độ** | Thông báo HA / chuông cửa, không làm phiền, chế độ đêm, màn hình chờ, khoá trẻ em | Thông báo nổi + lưu lịch sử; lịch chế độ đêm chạy |
| **OS-6 Panel S3** | Bố cục 480×480 / 480×272, mức chuyển động giảm/tối thiểu | Dùng được trọn vẹn trên cả 3 panel |

Thứ tự này đặt phần **rủi ro kỹ thuật cao nhất** (cử chỉ ở server, nhiều tab) lên trước, để phát hiện vấn đề sớm khi
chưa đầu tư nhiều vào giao diện.

## 9. Rủi ro và cách giảm

| Rủi ro | Giảm thiểu |
|---|---|
| Nhiều tab ăn RAM (máy chủ đang dùng ~1,1 GB với 3 panel) | Giới hạn tab/panel, đóng tab lâu không dùng, đo ở OS-2 trước khi mở rộng |
| Cử chỉ mép trên xung đột với nút đầu trang HA | Chỉ nhận khi **kéo**; chạm nhanh đi thẳng vào trang; dải mép mỏng, chỉnh được |
| Chuyển screencast giữa tab gây chớp đen / khung cũ | Ép khung đầy đủ ngay khi chuyển (cơ chế `requestFullFrame` đã có), chụp sẵn ảnh cho màn hình Gần đây |
| Âm thanh chồng khi nhiều tab phát | Chính sách: chỉ ứng dụng "phát nền" được phép kêu khi không ở phía trước; YouTube tự dừng |
| Khối lượng lớn | Chia 6 giai đoạn độc lập, mỗi giai đoạn dùng được ngay |

## 10. Cần bạn quyết định

1. **Ứng dụng = tab** (mục 3.1) — đồng ý hướng này? (tốn thêm RAM máy chủ, đổi lại chuyển ứng dụng tức thì + phát nền)
2. **Khởi động panel vào đâu**: Home Assistant (như hiện nay) hay Màn hình chính?
3. **Thanh điều hướng**: kiểu 3 nút (Quay lại · Home · Gần đây, hiện khi vuốt lên từ mép dưới) hay chỉ cử chỉ?
4. Danh sách biểu tượng ở mục 6 — thêm/bớt gì?

## 11. Bàn giao cho phiên làm việc sau (kể cả phiên cloud không có hội thoại này)

**Cập nhật 26/09 (phiên cloud)**: đã làm bản **2.9.49** (mục 0 — sửa race rò tab, sửa `baseKind`, thẻ "Đang phát").
Phiên cloud **không truy cập được HASS/LAN**, nên 2.9.49 mới kiểm bằng test + Chromium trong container, **chưa nạp lên
addon, chưa thử trên panel thật**. Việc tiếp theo cho phiên có quyền SSH: merge nhánh `claude/two-repo-research-3ulwjd`
vào `main` → cập nhật addon → làm 3 việc kiểm chứng dưới đây (việc 3 nay nghe thêm: thẻ "Đang phát" hiện khi Radio phát
nền, bấm ■ thì im hẳn và thẻ biến mất). Việc 5 cũ (thẻ Đang phát) đã xong.

**Trạng thái trước đó**: OS-2 đã xong và đang chạy thật trên HASS (192.168.10.2), server bản **2.9.48**, đã xác
minh trên cả 3 màn hình (P4 1024×600, S3 480×480, S3 480×272) không lỗi lúc kết nối, YouTube trên P4 vẫn 28,2 fps.
Toàn bộ mã đã commit và push lên `main` của repo này; addon HASS đã cập nhật lên 2.9.48 (không chỉ commit suông).

**Bản Ổn định CHƯA được cập nhật sang OS-2** — vẫn là bản tối 25/09 (tag `ban-on-dinh-2026-09-25-dem`, trước OS-1
lẫn OS-2, xem `hassio/remote_webview_server/DOCS.md`/`ban-on-dinh-stable-version.md` trong bộ nhớ dự án). Nếu người
dùng xác nhận OS-2 dùng ổn sau vài ngày, nên hỏi họ có muốn chốt bản này thành Bản Ổn định mới không (theo đúng quy
trình đã dùng ở các lần chốt trước — sao lưu firmware+server+Frigate+launcher.json, gắn tag `ban-on-dinh` mới).

**Việc còn lại, ưu tiên theo thứ tự đề xuất**:
1. **Theo dõi thêm vài ngày sử dụng thật** trước khi làm tiếp OS-3 — đây là thay đổi kiến trúc lớn (nhiều tab
   Chromium/thiết bị), rủi ro rò rỉ tab/RAM hoặc lỗi race hiếm gặp cao hơn các bản trước. Xem log addon
   (`docker logs app_5e50eaa0_remote_webview_server`) tìm dòng `[app]`/`Not attached`/`Restarting device` nếu có
   báo cáo bất thường.
2. **Đo RAM addon thực tế với nhiều tab mở cùng lúc** (mở vài ứng dụng trên mỗi màn hình, so với mốc cũ ~1,1 GB/3
   màn hình một-tab) — chưa làm trong phiên này do ưu tiên bàn giao sớm. Lệnh: `docker stats --no-stream
   app_5e50eaa0_remote_webview_server` trước/sau khi mở đủ `MAX_APP_TABS` ứng dụng trên cả 3 màn hình.
3. **Nghe thật âm thanh nền của Radio** khi chuyển sang ứng dụng khác trên P4 (mở Radio → bấm phát → mở YouTube/
   Camera → xác nhận Radio vẫn kêu; mở lại Radio → bấm dừng → xác nhận im hẳn, không còn tiếng rơi lại sang tab
   khác). Logic đã viết đúng theo thiết kế (`backgroundAudio`, `setTabAudioAllowed`) và đã tự kiểm bằng đọc mã,
   nhưng CHƯA nghe thật bằng tai trên loa P4.
4. Sau khi (1)–(3) ổn, tiếp **OS-3** theo mục 8: màn hình "Gần đây" thật (ảnh thu nhỏ từng tab đang mở — có sẵn
   `dev.tabs` để lặp qua, còn thiếu cơ chế chụp ảnh thu nhỏ mỗi tab nền, vd `Page.captureScreenshot` định kỳ hoặc
   khi deactivate), thanh điều hướng Quay lại/Home/Gần đây trên ứng dụng "trần", hoàn thiện trang Ứng dụng.
5. ~~Thẻ "Đang phát" trong thanh trạng thái~~ — **xong ở 2.9.49** (chờ kiểm trên panel thật).

**Chỗ nên đọc trước khi sửa `deviceManager.ts`**: các hàm mới quanh quản lý tab nằm liền nhau, theo thứ tự
`resolveAppSpec` → `openApp` → `countNonPinnedTabs`/`evictIfNeeded`/`closeTab` → `createTab` → `navigateTab` →
`handleTabNavigation` → `activateTab`, ngay trước `setupStableViewport`/`ensureDeviceAsync`. `flushPending` đã
tách thành hàm cấp module (nhận `dev` làm tham số) nằm ngay sau `ensureDeviceAsync`, dùng chung cho mọi tab.

## Nguồn tham khảo

- Hành vi tab nền của Chrome: [Background tabs in Chrome 57](https://developer.chrome.com/blog/background_tabs),
  [Timer throttling in Chrome 88](https://developer.chrome.com/blog/timer-throttling-in-chrome-88)
- Mẫu cài đặt / thông báo Android: [Settings — Android Developers](https://developer.android.com/design/ui/mobile/guides/patterns/settings),
  [Material 3 — Notifications](https://m3.material.io/foundations/content-design/notifications),
  [Material 3 Expressive — quick settings](https://gadgets.beebom.com/guides/best-android-material-3-expressive-features)
- Ứng dụng bảng tường tham khảo: [WallMode](https://github.com/teasdalebrown/WallMode), [WallPanel](https://wallpanel.xyz/)

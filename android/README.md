# Ứng dụng Android — Dashboard OS

App Android (WebView + `PhoneService` nền) để biến điện thoại thành **thiết bị nhận cuộc gọi** của
DashboardOS: nhận cuộc gọi từ màn hình (panel) hoặc trình duyệt, hiện `IncomingCallActivity` toàn màn hình,
rung/chuông, và giữ kết nối với server qua `PhoneService` (poll `GET /app/incoming` mỗi 2 s).

- `applicationId` / package: `vn.mqsmarthome.dashboardos`
- `minSdk` 29 (Android 10) — `targetSdk` 35
- Không phụ thuộc AndroidX/Library ngoài: chỉ dùng lớp framework (`android.*`) nên build **offline** được.

## 1. Build và test

```bash
cd android
JAVA_HOME=/opt/jdk-21.0.12.1+1 ./gradlew assembleDebug        --offline --no-daemon
JAVA_HOME=/opt/jdk-21.0.12.1+1 ./gradlew assembleRelease      --offline --no-daemon
JAVA_HOME=/opt/jdk-21.0.12.1+1 ./gradlew testDebugUnitTest    --offline --no-daemon
```

Kết quả:

| Bản | Đường dẫn |
| --- | --- |
| debug | `android/app/build/outputs/apk/debug/app-debug.apk` |
| release (đã ký) | `android/app/build/outputs/apk/release/app-release.apk` |

Bản phát hành được copy ra ngoài cho người dùng tải:

```bash
cp app/build/outputs/apk/release/app-release.apk android/DashboardOS-release.apk   # từ gốc repo: cp android/app/build/outputs/apk/release/app-release.apk android/DashboardOS-release.apk
```

## 2. Ký APK release

Chữ ký release dùng khoá riêng của DashboardOS, **commit trong repo** (repo private) để mọi máy build ra
APK cùng một chữ ký — nhờ vậy bản mới cài đè (`install -r`) lên bản cũ được, không phải gỡ app.

| Mục | Giá trị |
| --- | --- |
| Keystore | `android/keystore/dashboardos-release.jks` (PKCS12) |
| Alias | `dashboardos` |
| Khoá | RSA 2048, hiệu lực 10.000 ngày (31/10/2026 → 18/03/2054) |
| Chủ thể | `CN=Dashboard OS, O=MQ SmartHome, C=VN` |
| Mật khẩu (store + key) | `DashboardOS2026!` — lưu trong `android/keystore/keystore.properties` |
| SHA-256 chứng chỉ | `3f80869d748fb23fe554109f2589982c907d646308f61d13ea43fb4a52bdf2bb` |
| SHA-1 chứng chỉ | `3aae321266047436af8c9dcd1354a9b328359181` |
| MD5 chứng chỉ | `ce8574ad9dbaa901e18d341077fa057b` |

`android/keystore/keystore.properties`:

```properties
storeFile=keystore/dashboardos-release.jks
storePassword=DashboardOS2026!
keyAlias=dashboardos
keyPassword=DashboardOS2026!
```

`android/app/build.gradle.kts` đọc file này khi build:

- **Có** `keystore.properties` + file `.jks` → release ký bằng khoá `dashboardos` (`signingConfigs.create("release")`).
- **Không có** (máy khác, clone thiếu file) → release **fallback về chữ ký debug** để build không vỡ; APK vẫn
  cài được nhưng **không** dùng khoá phát hành (không cài đè lên bản phát hành được — phải gỡ app trước).
- `isMinifyEnabled = false`, `isShrinkResources = false` (app nhỏ, giữ nguyên hành vi WebView/reflection).

Kiểm tra chữ ký sau khi build:

```bash
/opt/android-sdk/build-tools/35.0.0/apksigner verify --print-certs android/DashboardOS-release.apk
# Signer #1 certificate DN: CN=Dashboard OS, O=MQ SmartHome, C=VN
# Signer #1 certificate SHA-256 digest: 3f80869d748fb23fe554109f2589982c907d646308f61d13ea43fb4a52bdf2bb
```

APK được ký bằng **APK Signature Scheme v2** (`apksigner verify --verbose` → *Verified using v2 scheme: true*) —
đủ cho `minSdk` 29; v1 (JAR signing) chỉ cần cho Android < 7 nên không bật.

Xem mật khẩu / chứng chỉ trong keystore:

```bash
/opt/jdk-21.0.12.1+1/bin/keytool -list -v \
  -keystore android/keystore/dashboardos-release.jks -storepass 'DashboardOS2026!'
```

Tạo lại keystore (chỉ khi làm mất file — **mọi APK đã phát hành sẽ không cài đè được nữa**, người dùng phải gỡ app):

```bash
/opt/jdk-21.0.12.1+1/bin/keytool -genkeypair -noprompt \
  -keystore android/keystore/dashboardos-release.jks -alias dashboardos \
  -keyalg RSA -keysize 2048 -validity 10000 -storetype PKCS12 \
  -storepass 'DashboardOS2026!' -keypass 'DashboardOS2026!' \
  -dname "CN=Dashboard OS, O=MQ SmartHome, C=VN"
```

> ⚠️ Khoá này tương đương "quyền phát hành" app: ai có file + mật khẩu là ký được bản cập nhật cho mọi máy đã
> cài. Repo phải để **private**. Khi public repo, chuyển keystore ra secret (CI) và bỏ 2 file này khỏi git.

## 3. Icon launcher (đủ mật độ)

Nguồn: `hassio/remote_webview_server/icon.png` (1024×1024, RGBA). Sinh lại toàn bộ icon:

```bash
node android/scripts/make-icons.cjs        # cần `sharp` trong node_modules
```

| File | Kích thước | Dung lượng |
| --- | --- | --- |
| `res/mipmap-mdpi/ic_launcher.png` | 48×48 | 5,0 KB |
| `res/mipmap-hdpi/ic_launcher.png` | 72×72 | 10,0 KB |
| `res/mipmap-xhdpi/ic_launcher.png` | 96×96 | 16,5 KB |
| `res/mipmap-xxhdpi/ic_launcher.png` | 144×144 | 33,9 KB |
| `res/mipmap-xxxhdpi/ic_launcher.png` | 192×192 | 56,3 KB |

Trước đây chỉ có **một** `mipmap-xxxhdpi/ic_launcher.png` 1024×1024 (~995 KB) → APK phình và các mật độ khác
phải phóng to icon 1024. Nay tổng 5 icon ~122 KB, giữ kênh alpha, resize lanczos3 (giữ tỉ lệ — ảnh gốc vuông).
Chênh lệch APK (clean build, cùng máy):

| Bản | Trước (icon 1024) | Sau (5 mật độ) | Giảm |
| --- | --- | --- | --- |
| debug | 3.551.246 B (3,39 MB) | 2.658.533 B (2,54 MB) | −892.713 B (−25,1 %) |
| release | 3.187.361 B (3,04 MB) | 2.314.298 B (2,21 MB) | −873.063 B (−27,4 %) |

APK phát hành hiện tại (`android/DashboardOS-release.apk`, đã bỏ luôn cấu hình chữ ký v1 không cần thiết):
**2.388.021 B** — md5 `f5209124eff417b8668451a8ec109376`,
sha256 `cf40c283dcdcddfc18207433ca0d4d371c8812daa7095f60144992469f0de123`.

## 4. Luồng "nhập một ô địa chỉ → đăng nhập Home Assistant → dashboard" (GD10)

App chỉ có **một ô** địa chỉ (`hass.mqsmarthome.io.vn` hoặc `192.168.10.2`). Với tên miền, trang điều khiển nằm
sau **ingress** của Home Assistant: `https://<domain>/api/hassio_ingress/<TOKEN>/launcher-config.html` — nơi này
trả **401** cho tới khi có phiên ingress.

**Vì sao bản trước đứng ở Lovelace:** đăng nhập Lovelace **không** sinh cookie `ingress_session` (HA giữ phiên
trong `localStorage` → `hassTokens`); Supervisor chỉ cấp `ingress_session` khi **mở add-on** (trang HA gọi
`POST /api/hassio/ingress/session/<slug>` rồi đặt cookie). Bản trước dò đúng 2 tên cookie đó nên **không bao giờ**
khớp → phải mở add-on bằng tay rồi khởi động lại app.

Luồng hiện tại (`MainActivity` + `HaLogin` + `HaIngress`):

1. **Kết nối**: `WebTargetResolver.webCandidates` dò ingress / slug / gốc domain (kèm cookie nếu đã đăng nhập).
   401 = đúng add-on nhưng chưa đăng nhập → lưu `webUrl`, mở `https://<domain>/` để đăng nhập.
2. **Nhịp dò 1 s** (`loginTickRunnable`, Logcat tag **`DashboardOS-login`**), mỗi nhịp ghi
   `[login] url=… cookie=yes/no web=200/401 …` (đồng thời hiện trên thanh thông báo):
   - dấu hiệu "đã đăng nhập": URL đã **rời `/auth/…`**, hoặc **có cookie mới** (bất kỳ tên), hoặc đọc được
     `hassTokens` từ `localStorage` (JS chỉ đọc);
   - `GET <webUrl>` (HttpURLConnection, kèm cookie): **200** + body **không** phải `<title>Home Assistant</title>`
     → mở dashboard ngay.
3. **Tự tạo phiên ingress** (`HaIngress`): đọc `access_token` trong `hassTokens` → `POST
   /api/hassio/ingress/session/<slug>` (thử thêm body `{"addon":"<slug>"}` cho bản Supervisor cũ) →
   ghi cookie `ingress_session` (`Path=/`) → dò lại. Đây chính là việc trang HA vẫn làm khi người dùng mở add-on.
4. **Chống kẹt vòng** (`HaLogin.Watch`): 401 hai lần liền dù đã có cookie → thử
   `…/<slug>/launcher-config.html` → `https://<domain>/launcher-config.html` → `http://<host>:18080/launcher-config.html`;
   hết biến thể → màn hình thông báo rõ ràng + nút **Thử lại** (không im lặng). Biến thể chạy được sẽ được lưu
   làm `webUrl` cho lần sau.
5. **Thanh thông báo** ở màn đăng nhập: luôn có nút **Mở Dashboard** (chủ động), nút **Thử lại** (khi tự dò thất
   bại) và **Tôi đã đăng nhập**.
6. **Lần mở app sau**: có cookie → nạp **thẳng** `webUrl` (không đi vòng qua Lovelace); 401 thật thì tự dò/tạo
   phiên ingress trước khi nghĩ tới việc mở trang đăng nhập.

`localStorage` chỉ đọc được trên trang **cùng origin** với HA; nếu WebView đang ở `about:blank`/trang lỗi, app mở
một trang cùng origin rất nhẹ (`/manifest.json`, tối đa 2 lần) để đọc token — không mở Lovelace.

Kiểm chứng trên máy thật:

```bash
adb logcat -c && adb logcat -s DashboardOS-login      # xem nhịp dò 1 s
# lần đầu:  bấm Kết nối → đăng nhập HA → trong ≤ 2 s app tự sang launcher-config.html
# lần sau:  thoát hẳn app → mở lại → vào thẳng dashboard (không thấy Lovelace)
```

## 4b. GD11 — "đăng nhập xong vẫn đứng ở Lovelace" (đã sửa)

**Triệu chứng**: nhập `hass.mqsmarthome.io.vn`, đăng nhập HA thành công, app đứng ở dashboard Lovelace của HA;
bấm **Tôi đã đăng nhập** → trang nạp lại rồi **lại đúng Lovelace**.

**Nguyên nhân (kiểm chứng bằng code)**: không có dòng nào ghi origin của HA vào `webUrl`, nhưng **mọi** đường
"mở trang điều khiển" (`openWeb`, `onLoginConfirmed`, `onOpenDashboardClicked`, `goDashboard`) nạp **nguyên văn**
`webUrl` mà **không kiểm tra** nó có phải trang add-on; khi `webUrl` là origin (`https://<domain>/` — dữ liệu bản
cũ) thì nạp origin = Lovelace; thêm nữa `onAuthRequired` **nạp lại origin mỗi lần gặp 401** (vòng lặp "refresh rồi
lại Lovelace"), và bản GD10 **không có** `onPageFinished` nên không bao giờ phát hiện "đang ở HA".

**Sửa**:

| Hạng mục | Chi tiết |
| --- | --- |
| `DashboardTarget.kt` (mới) | `isValidSaved` (chỉ `…/launcher-config.html`), `candidates` (webUrl → ingress/TOKEN → `<slug>` → gốc domain → `:18080`), `arrival` (ADDON / HOME_ASSISTANT / OFF_INGRESS), `shortUrl` |
| `Prefs` | `setWebUrl`/`saveTargets` **từ chối** URL không phải trang add-on; khoá riêng `KEY_LOGIN_URL` (`login_url`) giữ origin của HA |
| `MainActivity` | mọi lần nạp đi qua `loadWeb()` (ghi `loading=…` + lý do); `onPageFinished` xác thực trang vừa nạp → sai thì **thử ứng viên kế tiếp** + hiện thông báo; `onAuthRequired` chỉ mở origin **một lần**; nút "Tôi đã đăng nhập" dựng lại URL từ TOKEN nếu `webUrl` hỏng |
| Thanh thông báo | hiện **URL đang nạp thật**, rút gọn: `…/api/hassio_ingress/KJjH…/launcher-config.html` |
| Logcat | `[login] saved=… loading=… result=ok|ha-spa|off-ingress|401|404` (`adb logcat -s DashboardOS-login`) |

Kiểm chứng tự động (cài APK + ghi log + kết luận ĐẠT/KHÔNG ĐẠT):

```bash
cd android
./scripts/login-flow-check.sh install    # cài release (giữ dữ liệu) + xoá log
./scripts/login-flow-check.sh watch      # giữ terminal, thao tác trên máy: (a)→(b)→(c)
./scripts/login-flow-check.sh verdict
./scripts/login-flow-check.sh fresh      # xoá dữ liệu app để thử lại kịch bản (a) từ đầu
```

## 4d. GD14 (26/11/2026) — MỞ THẲNG PANEL CỦA ADD-ON TRONG HOME ASSISTANT

**Bối cảnh đã kiểm chứng**: add-on có ingress nên HA tạo mục ở thanh bên với `url_path` =
`b39feb53_remote_webview_server`. Mở `https://<domain>/b39feb53_remote_webview_server` trong trình duyệt **đã đăng
nhập** thì **chính HA frontend** tạo phiên ingress, dựng panel và nhúng add-on vào
`<iframe src="…/api/hassio_ingress/<TOKEN>/…">`. Vào thẳng `/api/hassio_ingress/<TOKEN>/…` thì **luôn 401** — đó là
lý do 4 bản trước thất bại (chúng cố tự tạo phiên thay vì để HA frontend làm).

**Cách làm hiện tại** (không cần TOKEN, không cần IP LAN, không cần Tailscale, chỉ **một ô domain**):

| Hạng mục | Chi tiết |
| --- | --- |
| Ứng viên | `https://<domain>/b39feb53_remote_webview_server` → `…/b39feb53_remote_webview_server/launcher-config.html` → (webUrl hợp lệ đã lưu) → `…/api/hassio_ingress/<TOKEN>/launcher-config.html` (dự phòng) → `https://<domain>/launcher-config.html` → `http://<host>:18080/launcher-config.html` (`DashboardTarget.candidates`) |
| Nhận diện "đã vào đúng" | trang có `<iframe … hassio_ingress>` **hoặc** URL bắt đầu bằng `https://<domain>/b39feb53_remote_webview_server` (khi tiêu đề là `<title>Home Assistant</title>` **trần** thì kiểm tra lại bằng JS dò iframe trong cả shadow DOM, `HaIngress.panelFrameScript`). **SPA HA thuần không phải thành công** (`DashboardTarget.arrival`) |
| Luồng đăng nhập | chưa có phiên → mở `https://<domain>/` (HA chuyển sang `/auth/login`) → đăng nhập → nhịp dò **1 s** thấy URL rời `/auth/` (hoặc có cookie) thì **tự chuyển sang panel**; đang ở Lovelace cũng bị điều hướng sang panel (không để kẹt) |
| API native | `/app/register`, `/app/incoming`, `/app/answer`, `/app/decline`, `/app/hangup` đi qua `https://<domain>/api/hassio_ingress/<TOKEN>` kèm cookie `ingress_session` — chỉ chạy **sau khi panel mở**; chưa có cookie thì `PhoneService` **chờ, thử lại mỗi 5 s**, không bắn 401 liên tục |
| Giao diện | một ô domain, gợi ý "Nhập domain Home Assistant, ví dụ hass.example.com"; chế độ IP LAN vẫn giữ nhưng ghi rõ **KHÔNG khuyến nghị** |
| Logcat | `[nav] url=… ok=panel|ha-spa|login|401` (`adb logcat -s DashboardOS-login`) |

```bash
adb logcat -c && adb logcat -s DashboardOS-login
# lần đầu: nhập hass.example.com → Kết nối → đăng nhập HA → log ra
#          [nav] url=…/auth/login ok=login  →  [nav] url=…/b39feb53_remote_webview_server ok=panel
# lần sau: mở app → vào thẳng panel (không thấy Lovelace), API native chạy vì đã có ingress_session
```

## 4e. GD15 (27/11/2026) — PROMOTE PANEL → TOP-LEVEL INGRESS (micro/camera hoạt động)

**Triệu chứng**: bản GD14 mở **panel của HA** (`https://<domain>/b39feb53_remote_webview_server`) — đúng UI, nhưng
**không gọi điện được**: panel nhúng add-on trong `<iframe src="…/api/hassio_ingress/<TOKEN>/…">` **của HA**, mà iframe
đó **không có** `allow="microphone; camera"`. Permissions Policy của khung cha chặn `navigator.mediaDevices.getUserMedia`
⇒ `NotAllowedError`, dù app đã xin và được cấp `RECORD_AUDIO`/`CAMERA` (`WebChromeClient.onPermissionRequest` không
bao giờ được gọi vì request bị chặn ở tầng tài liệu).

**Cách sửa (thêm MỘT bước, không đổi phần còn lại)** — `IngressPromote` + `MainActivity`:

| Hạng mục | Chi tiết |
| --- | --- |
| Điều kiện "đã có phiên, được phép promote" | (1) `promoteAttempted == false` — **cờ trong bộ nhớ**, chỉ một lần cho mỗi lần mở app; (2) dựng được URL top-level; (3) **`hasPanelSession() == true`** — đã có cookie `ingress_session` (`WebTargetResolver.hasSessionCookie`, dò `CookieManager.getCookie(origin)` **và** `getCookie(origin + "/api/hassio_ingress/")`). Chưa có → chờ tối đa 3 × 700 ms (`IngressPromote.COOKIE_TRIES/COOKIE_RETRY_MS`), **không** promote (sẽ 401 vô ích) |
| URL đích | `https://<domain>/api/hassio_ingress/<TOKEN>/launcher-config.html` (`IngressPromote.topUrl`). **TOKEN lấy từ `src` của iframe** mà HA vừa dựng — `HaIngress.panelFrameSrcScript()` + `HaIngress.readFrameSrc` + `IngressPromote.tokenFromUrl` (dò cả shadow DOM); không đọc được → TOKEN đã lưu (`Prefs.ingressToken`) |
| Thành công | top-level trả trang add-on ⇒ log `[promote] url=… ok=top`, **flush cookie**, chốt `apiBase = https://<domain>/api/hassio_ingress/<TOKEN>`, `registerInBackground()` + `PhoneService.start` ⇒ API native chạy với base ingress + cookie `ingress_session` |
| Fallback | 401/403/404/5xx, **SPA của HA** (tiêu đề `Home Assistant`/`Lovelace`), redirect, mất mạng, hoặc **quá 3 s** (`IngressPromote.TOP_TIMEOUT_MS`) ⇒ log `[promote] url=… ok=401 fail=401 fallback=panel` rồi **nạp lại panel** (iframe) — người dùng vẫn dùng được UI như bản GD14 |
| Chỉ một lần | `promoteAttempted` đặt `true` ngay khi bắt đầu; người dùng tự quay lại panel (nút Back) → log `[promote] url=… ok=panel skip=already`, **không** kéo đi nữa. Chỉ reset khi bấm **Kết nối** |
| Logcat | `[promote] url=… ok=top\|panel\|401` (+ `[promote] start url=… token=frame\|prefs timeout=3000ms`, `[promote] … ok=401 fail=timeout\|ha-spa\|auth\|net\|404 fallback=panel`) |

```bash
adb logcat -c && adb logcat -s DashboardOS-login
# đăng nhập → panel mở:  [nav] url=…/b39feb53_remote_webview_server ok=panel
# promote:               [promote] start url=…/api/hassio_ingress/KJjH…/launcher-config.html token=frame timeout=3000ms
#                        [promote] url=…/api/hassio_ingress/KJjH…/launcher-config.html ok=top
# phiên hết hạn (401):   [promote] url=… ok=401 fail=401 fallback=panel
```

Kịch bản kiểm thử trên máy thật: **xoá dữ liệu app** (`adb shell pm clear vn.mqsmarthome.dashboardos`) → mở app → nhập
domain → Kết nối → đăng nhập HA → (a) thấy **add-on full-screen**, **không** còn thanh bên của HA; (b) bấm micro trong
add-on ⇒ hộp thoại xin quyền của Android hiện ra ⇒ đồng ý ⇒ biểu tượng micro nhấp nháy (đang thu); (c) gọi thử từ màn
hình → chuông + Nghe được. Log phải có đúng một dòng `ok=top` và **không** có dòng `fallback=panel` nào.

## 4f. GD16 (28/11/2026) — CHẨN ĐOÁN TRONG APP + PROMOTE KHÔNG PHỤ THUỘC DÒ IFRAME

**Triệu chứng**: sau khi đăng nhập HA, app **không** tự vào add-on full-screen. Nguyên nhân: bản GD15 chỉ promote
khi JS **dò thấy** `iframe[src*="hassio_ingress"]` trong panel; dò không thấy (panel dựng iframe trễ / dùng shadow DOM
khác / HA đổi cấu trúc) ⇒ bước promote **không bao giờ chạy**.

### 4f.1 Màn "Chẩn đoán" (không cần adb)

Cài đặt → **Chẩn đoán** (mở `DiagActivity`):

| Thành phần | Nội dung |
| --- | --- |
| 5 giá trị | `domain` · `webUrl đang dùng` · `URL hiện tại của WebView` · `cookie ingress_session: có/không` (dò thật `CookieManager`, cả `Path=/api/hassio_ingress/`) · `token ingress` (+ dòng "promote gần nhất" nếu có) |
| Log | `TextView` monospace, chọn/copy được, hiện **toàn bộ ring buffer 300 dòng** (`Diag`), tự cuộn xuống dòng mới nhất |
| Nút | **Sao chép** (clipboard + toast) · **Chia sẻ** (`ACTION_SEND` `text/plain`) · **Xoá log** (`Diag.clear()`) |

`Diag` (ring buffer) giữ **300 dòng** gần nhất, mỗi dòng `HH:mm:ss <nội dung>`; **đồng thời** vẫn ghi Logcat
(`adb logcat -s DashboardOS-login`). Mọi dòng `[nav]` / `[promote]` / `[login]` / `[api]` (kể cả từ `PhoneService`) đều
đi qua `Diag.log(...)`.

### 4f.2 Luồng promote mới

| Hạng mục | Chi tiết |
| --- | --- |
| Thời điểm | sau khi đăng nhập (URL rời `/auth/`, hoặc ở `/`, `/lovelace…`, hoặc có cookie phiên) app nạp **panel** như cũ và **đặt hẹn giờ 2,5 s** (`IngressPromote.PANEL_PROMOTE_DELAY_MS`) kể từ lúc panel **bắt đầu** nạp |
| Promote | hết 2,5 s → nạp `https://<domain>/api/hassio_ingress/<TOKEN>/launcher-config.html`. TOKEN: `src` iframe nếu đọc được (`token=frame`) → `Prefs.ingressToken()` (`token=prefs`) → mặc định `KJjH_rSB8SdDeyjszvdZnnH1pRlxySfVG5VmgDMVf38`. **Không** cần cookie phiên trước khi thử |
| Kết luận | JS `HaIngress.panelProbeScript()` trả `addon` / `ha` / `auth` / `unknown` (dò `launcher-config`, `Dashboard OS`, `<home-assistant>`, tiêu đề) + `IngressPromote.verdict`: HTML có `launcher-config`/`Dashboard OS` hoặc không phải SPA HA và tiêu đề không phải `Home Assistant` ⇒ **giữ** (`ok=top`); 401/403/404, SPA HA, redirect `/auth`, quá **4 s** (`TOP_TIMEOUT_MS`) ⇒ **quay lại panel** (`ok=401 fail=… fallback=panel`) |
| Panel không nạp được (404/mất mạng/HA chỉ trả SPA) | thử **ngay** top-level ingress (`fallback=ingress`), rồi `https://<domain>/launcher-config.html` (`fallback=root`), mỗi bước một lần |
| Chỉ một lần | `IngressPromote.Once` — mỗi lần mở app chỉ thử **một** lần; bấm **Kết nối** mới mở lại quyền thử |
| Log mẫu | xem dưới |

```bash
adb logcat -c && adb logcat -s DashboardOS-login
# 12:31:07 [nav] url=…/auth/login ok=login cookie=no session=no
# 12:31:21 [nav] url=…/lovelace/0 ok=ha-spa cookie=no session=no
# 12:31:21 [promote] arm in=2500ms panel=…/b39feb53_remote_webview_server
# 12:31:23 [promote] fire reason=panel_timer session=no
# 12:31:23 [promote] start url=…/api/hassio_ingress/KJjH…/launcher-config.html token=prefs timeout=4000ms
# 12:31:24 [promote] probe url=…/api/hassio_ingress/KJjH…/launcher-config.html kind=addon title=Dashboard OS
# 12:31:24 [promote] url=…/api/hassio_ingress/KJjH…/launcher-config.html ok=top title=Dashboard OS kind=addon
# 12:31:24 [api] base=…/api/hassio_ingress/KJjH… (promote → top-level ingress)
# — nếu phiên chưa kịp có —
# 12:31:24 [promote] url=…/api/hassio_ingress/KJjH…/launcher-config.html ok=401 fail=401 fallback=panel
# — nếu panel 404 —
# 12:31:05 [promote] panel_fail reason=404 fallback=ingress
# 12:31:09 [promote] fallback=root url=…/launcher-config.html reason=promote_404
```

## 4g. GD17 (29/11/2026) — LƯU CHẨN ĐOÁN RA TỆP + TỰ LƯU KHI LỖI (v1.3)

Vấn đề: log vòng `Diag` chỉ sống trong tiến trình — người dùng tắt app (hoặc app bị hệ thống giết) là mất, và họ
không thể canh đúng lúc lỗi xảy ra để bấm nút. GD17 ghi chẩn đoán ra **tệp** trong thư mục riêng của app rồi chia sẻ
qua `content://`.

### 4g.1 Nơi lưu tệp

```
/sdcard/Android/data/vn.mqsmarthome.dashboardos/files/diag-20261129-101500.txt       # người dùng bấm "Lưu ra tệp"
/sdcard/Android/data/vn.mqsmarthome.dashboardos/files/diag-auto-20261129-101532.txt # app TỰ lưu khi gặp lỗi
```

`context.getExternalFilesDir(null)` là nơi lưu chính (mở/sao chép được bằng ứng dụng quản lý tệp, gỡ app thì thư mục
bị xoá theo); nếu bộ nhớ ngoài không dùng được thì fallback `context.filesDir` (`/data/data/<package>/files`). Tên tệp
`diag[-auto]-YYYYMMDD-HHmmss.txt`, nội dung = header + 5 giá trị chẩn đoán + 300 dòng log gần nhất. **Luôn giữ tối đa
5 tệp mới nhất** — tệp cũ hơn bị xoá sau mỗi lần ghi (`DiagFile.deleteCandidates`).

### 4g.2 Màn Chẩn đoán (mới)

| Thành phần | Chi tiết |
| --- | --- |
| **Lưu ra tệp** | ghi chẩn đoán hiện tại ra `diag-<timestamp>.txt`, hiện **đường dẫn** ngay dưới nút và bật **Chia sẻ tệp** |
| **Chia sẻ tệp** | `ACTION_SEND` + `EXTRA_STREAM` = `content://vn.mqsmarthome.dashboardos.diagfiles/<tệp>`, type `text/plain` (Zalo/Telegram/Gmail…) |
| Danh sách tệp | **tối đa 5 tệp gần nhất**: `tên · thời gian · dung lượng` (+ “(tự lưu)” cho tệp `diag-auto-…`); **bấm một dòng = chia sẻ tệp đó** |
| **Xoá tất cả** | xoá mọi tệp chẩn đoán trong thư mục của app (log trong bộ nhớ giữ nguyên) |

Chia sẻ dùng `DiagFileProvider` (`android.content.ContentProvider`, authority `${applicationId}.diagfiles`) — **cùng
giao kèo với `FileProvider`** của androidx (provider + `android.support.FILE_PROVIDER_PATHS` → `res/xml/file_paths.xml`
khai `<external-files-path>` + `<files-path>`), nhưng không thêm phụ thuộc runtime để build vẫn offline. Provider chỉ
phục vụ **đọc** tệp `diag-…txt`, chặn `..`/`/`.

### 4g.3 Tự lưu khi lỗi

`MainActivity.onCreate` gắn `DiagAutoSave` vào `Diag.onLine` (người nghe mọi dòng log, kể cả dòng của `PhoneService`):

- kích hoạt khi dòng log bắt đầu bằng `[promote]` và có `fail=`, hoặc khi dòng log nhắc tới **401** (`ok=401`,
  `code=401`, `HTTP 401`…);
- ghi `diag-auto-<timestamp>.txt` (nội dung kèm dòng `lý do tự lưu: …`), **giãn cách tối thiểu 30 s** giữa hai lần
  tự lưu để một chuỗi lỗi không đẻ ra 5 tệp trùng nhau;
- tối đa **5 tệp** như trên; ghi ở luồng nền (`diag-file`), không chặn UI, và **không bao giờ** làm hỏng luồng điều
  hướng (mọi lỗi I/O bị nuốt).

### 4g.4 Kiểm thử

```bash
cd android && ./gradlew testDebugUnitTest --offline --no-daemon   # DiagFileTest: 16 test (đặt tên tệp, giữ 5 tệp mới nhất, kích hoạt tự lưu, giãn cách, hiển thị)
```

## 4h. GD18 (30/11/2026) — TỰ ĐỘNG MỞ DASHBOARD (v1.4)

**Sự thật đã kiểm chứng trên máy thật (bản 1.2):** đăng nhập HA xong app **vẫn không tự chuyển**; người dùng **phải
bấm nút “Mở Dashboard”** thì mới vào được add-on ⇒ thân nút là code **chạy ĐÚNG**, còn chuỗi điều kiện trung gian của
đường tự động (`promoteIfSessionReady`, `loginTick`, hẹn giờ 2,5 s) **không kích hoạt** dù log có
`cookie=yes session=yes`.

### 4h.1 Sửa gì (tái dùng đúng code của nút)

| Thay đổi | Chỗ nào |
| --- | --- |
| thân nút “Mở Dashboard” **tách** thành `openDashboardNow(reason)` | `MainActivity.openDashboardNow` (nút: `onOpenDashboardClicked` = `openDashboardNow("manual_open_dashboard", manual = true)`) |
| **đường tự động**: có phiên ⇒ gọi **đúng hàm đó**, không gate/hẹn giờ | `MainActivity.autoOpenIfSessionReady` ← `loginTick` (ưu tiên số 1) + `onPanelLoaded` |
| **cờ riêng** “một lần mỗi lần mở app” + tối đa 3 lần cách 1,5 s | `MainActivity.autoOpenLatch` (`AutoOpen.Latch`, reset ở `buildWebScreen`/`resetPromoteState`) |
| dòng chẩn đoán mỗi nhịp 1 s (chỉ khi `session=yes`) | `[auto] tick cookie=… session=… called=yes/no` |
| fallback giữ nguyên | top-level 401 / SPA HA → `onPromoteFailed` quay lại panel + `[promote] … ok=401 fail=… fallback=panel`; auto thử lại tối đa 3 lần rồi `[auto] give_up try=3/3 session=yes` |

`AutoOpen` (`AutoOpen.kt`) là phần **THUẦN** (cờ + định dạng log) nên unit test được trên JVM; hằng số của nó khớp
`IngressPromote` (`MAX_PROMOTE_ATTEMPTS` = 3, `PROMOTE_RETRY_GAP_MS` = 1500) để một lần 401 chỉ tốn đúng một lượt
promote.

### 4h.2 Log kỳ vọng (Cài đặt → Chẩn đoán, hoặc `adb logcat -s DashboardOS-login`)

```
# ... đăng nhập HA xong, panel vừa mở ...
[auto] tick cookie=yes session=yes called=yes
[auto] attempt=1/3
[auto] openDashboard reason=session_ready
[login] auto=open_dashboard reason=session_ready → top-level ingress
[promote] retry=1 url=…/api/hassio_ingress/KJjH…/launcher-config.html token=frame session=yes try=1/3
[promote] probe url=…/api/hassio_ingress/KJjH…/launcher-config.html kind=addon title=Dashboard OS
[promote] url=…/api/hassio_ingress/KJjH…/launcher-config.html ok=top title=Dashboard OS kind=addon
# — nếu phiên chưa dùng được —
[promote] url=…/api/hassio_ingress/KJjH…/launcher-config.html ok=401 fail=401 fallback=panel
[auto] tick cookie=yes session=yes called=no
[auto] attempt=2/3
[auto] openDashboard reason=session_ready
# — hết 3 lượt mà vẫn không vào được —
[auto] give_up try=3/3 session=yes
```

### 4h.3 Kiểm thử

```bash
cd android && ./gradlew testDebugUnitTest --offline --no-daemon   # AutoOpenTest: 8 test (cờ một-lần, 3 lần/1,5 s, reset, định dạng log)
```

## 5. Smoke test trên máy thật

`android/scripts/smoke-test.sh` chạy cả chuỗi "cài app → mở app → PhoneService sống → server thấy máy →
gọi từ màn hình → từ chối". Không cần thiết bị lúc viết script; chỉ cần lúc chạy.

```bash
# từ gốc repo
ADB=adb SERIAL=<serial> PHONE=<id thiết bị> API=http://192.168.10.2:18080 \
  ./android/scripts/smoke-test.sh

# hoặc trong android/
cd android && SERIAL=<serial> PHONE=<id thiết bị> ./scripts/smoke-test.sh
```

`<serial>`: xem `adb devices -l`. `<id thiết bị>`: id của điện thoại trong `GET /app/list` (app đăng ký khi
chạy lần đầu; cũng thấy trong Cài đặt app).

Các bước (mỗi bước in `PASS`/`FAIL`, cuối cùng in tổng kết — **exit ≠ 0 nếu có FAIL**):

1. `adb -s $SERIAL install -r android/DashboardOS-release.apk` (APK: biến `APK=…`).
2. Mở app: `am start -n vn.mqsmarthome.dashboardos/.MainActivity`, đợi `WAIT_APP` giây (mặc định 8).
3. `adb logcat -d | grep -E "PhoneService|dashboardos"` + `dumpsys activity services` → service sống.
4. `curl $API/app/list` → `lastSeen` của `PHONE` tăng trong 10 s (app đang poll server).
5. `curl -X POST "$API/calls/start?from=<CALLER>&to=$PHONE"` → đợi tối đa 10 s → `dumpsys activity activities`
   phải có `IncomingCallActivity`.
6. `curl -X POST "$API/app/decline?phone=$PHONE&call=<id>"` → `IncomingCallActivity` phải đóng (tối đa 8 s).
7. In `PASS`/`FAIL` từng bước; exit 1 nếu có FAIL (exit 2 khi thiếu tham số / không thấy thiết bị).

Biến môi trường: `ADB`, `SERIAL`, `API` (mặc định `http://192.168.10.2:18080`), `PHONE`, `APK`
(mặc định `android/DashboardOS-release.apk`), `CALLER` (mặc định `esp32-80f1b2d35fb5`), `PKG`, `WAIT_APP`.

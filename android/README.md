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

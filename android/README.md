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
**2.338.053 B** — md5 `37985ea074080f31141d9cabfe5337f0`,
sha256 `1c42945ce3909f4065a6410e9f1f5d32c1561b9d32e08f318ba568cafa940860`.

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

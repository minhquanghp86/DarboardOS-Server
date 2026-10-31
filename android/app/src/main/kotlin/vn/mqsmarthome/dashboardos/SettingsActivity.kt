package vn.mqsmarthome.dashboardos

import android.Manifest
import android.app.Activity
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.webkit.CookieManager
import android.widget.Button
import android.widget.EditText
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * (10/11/2026) GD2 — màn Cài đặt nhỏ: bật/tắt "Nhận cuộc gọi khi app đóng" và xin các quyền cần thiết.
 * (11/11/2026) GD3 — thêm lối tắt cài đặt MIUI, cài đặt thông báo/kênh cuộc gọi, và khối trạng thái debug.
 * (13/11/2026) GD6 — thêm khối "Máy chủ đang dùng" (hiện ĐÚNG 2 giá trị webUrl / apiBase + TOKEN ingress),
 * nút "Đăng nhập Home Assistant" (mở webUrl trong WebView của app) và ô sửa TOKEN ingress.
 * (14/11/2026) GD7 — thêm "Đã đăng nhập: có/không" (dò cookie `ingress_session` / `hassio_ingress` của origin) và
 * nút "Đăng nhập lại Home Assistant" (xoá cookie của origin rồi mở origin trong chế độ đăng nhập của MainActivity).
 *
 * Những thứ quyết định chuông có kêu + màn hình gọi có bật lên khi máy khoá:
 *   1. quyền POST_NOTIFICATIONS (Android 13+) — không có thì không có thông báo full-screen,
 *   2. quyền "hiện toàn màn hình" / full-screen intent (Android 14+, trên MIUI là "Màn hình khóa & thông báo"),
 *   3. "hiện cửa sổ nổi" (overlay) — cho phép app mở activity từ nền,
 *   4. bỏ tối ưu pin + MIUI "Tự khởi động" + "Không hạn chế pin",
 *   5. kênh thông báo "Cuộc gọi đến" không bị người dùng hạ mức.
 * Khối trạng thái đọc PhoneStatus (service ghi) và cập nhật qua broadcast nội bộ mỗi lần service poll.
 */
class SettingsActivity : Activity() {

    companion object {
        private const val REQ_NOTIFICATIONS = 2001

        /** Màu phụ đề (#8c9ab2) và màu "chưa đạt" (#ff8f8f) — cùng bảng màu trang Kết nối. */
        private const val COLOR_SUB = 0xFF8C9AB2.toInt()
        private const val COLOR_BAD = 0xFFFF8F8F.toInt()
    }

    // (1.7) Màn Cài đặt thiết kế lại: mỗi hàng chỉ còn MỘT dòng trạng thái ngắn (phụ đề 12sp), không còn khối chữ dài.
    private lateinit var receiveSwitch: Switch
    private lateinit var serverView: TextView
    private lateinit var phoneIdView: TextView
    private lateinit var urlView: TextView
    private lateinit var haStatusView: TextView
    private lateinit var serviceView: TextView
    private lateinit var callView: TextView
    private lateinit var ringView: TextView
    private lateinit var pollView: TextView
    private lateinit var channelView: TextView
    private lateinit var notifView: TextView
    private lateinit var batteryView: TextView
    private lateinit var fullView: TextView
    private lateinit var overlayView: TextView
    private lateinit var dndView: TextView
    private lateinit var tokenInput: EditText
    private var receiverRegistered = false

    private val statusReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == PhoneStatus.ACTION_STATUS) renderStatus()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)

        receiveSwitch = findViewById(R.id.receiveSwitch)
        serverView = findViewById(R.id.serverView)
        phoneIdView = findViewById(R.id.phoneIdView)
        urlView = findViewById(R.id.urlView)
        haStatusView = findViewById(R.id.haStatusView)
        serviceView = findViewById(R.id.serviceView)
        callView = findViewById(R.id.callView)
        ringView = findViewById(R.id.ringView)
        pollView = findViewById(R.id.pollView)
        channelView = findViewById(R.id.channelView)
        notifView = findViewById(R.id.notifView)
        batteryView = findViewById(R.id.batteryView)
        fullView = findViewById(R.id.fullView)
        overlayView = findViewById(R.id.overlayView)
        dndView = findViewById(R.id.dndView)
        tokenInput = findViewById(R.id.tokenInput)

        receiveSwitch.isChecked = Prefs.receiveEnabled(this)
        receiveSwitch.setOnCheckedChangeListener { _, on ->
            Prefs.setReceiveEnabled(this, on)
            if (on) PhoneService.start(this) else PhoneService.stop(this)
            renderStatus()
        }

        // (13/11/2026) GD6 — TOKEN ingress (chuỗi sau /api/hassio_ingress/) sửa được tại đây.
        tokenInput.setText(Prefs.ingressToken(this))
        findViewById<Button>(R.id.saveTokenButton).setOnClickListener { saveToken() }

        // (13/11/2026) GD6 — đăng nhập Home Assistant: mở trang điều khiển (https) trong WebView của app.
        // (19/11/2026) GD11 — mở ĐÚNG trang add-on: `webUrl` hỏng (origin/URL đăng nhập) thì dựng lại từ TOKEN.
        findViewById<Button>(R.id.haLoginButton).setOnClickListener { openInWeb(webDashboardUrl()) }
        // 401 từ ingress cần đăng nhập HA ở chính domain: mở trang chủ HA rồi quay lại trang điều khiển.
        findViewById<Button>(R.id.haHomeButton).setOnClickListener {
            openInWeb(WebTargetResolver.loginUrl(Prefs.webUrl(this)) ?: Prefs.loginUrl(this))
        }
        // (14/11/2026) GD7 — "Đăng nhập lại Home Assistant": xoá cookie của origin rồi mở origin (banner + dò cookie).
        findViewById<Button>(R.id.haReloginButton).setOnClickListener { reloginHomeAssistant() }

        findViewById<Button>(R.id.notifButton).setOnClickListener { requestNotifications() }
        findViewById<Button>(R.id.batteryButton).setOnClickListener { requestIgnoreBattery() }
        findViewById<Button>(R.id.fullScreenButton).setOnClickListener { requestFullScreenIntent() }
        findViewById<Button>(R.id.overlayButton).setOnClickListener { requestOverlay() }
        findViewById<Button>(R.id.dndButton).setOnClickListener { requestDndAccess() }

        findViewById<Button>(R.id.notifSettingsButton).setOnClickListener { openAppNotificationSettings() }
        findViewById<Button>(R.id.callChannelButton).setOnClickListener { openCallChannelSettings() }
        findViewById<Button>(R.id.miuiAutostartButton).setOnClickListener { openMiuiAutostart() }
        findViewById<Button>(R.id.miuiPermButton).setOnClickListener { openMiuiPermissions() }
        findViewById<Button>(R.id.appDetailsButton).setOnClickListener { openAppDetails() }

        findViewById<Button>(R.id.closeButton).setOnClickListener { finish() }

        // (28/11/2026) GD16 — CHẨN ĐOÁN: màn hiện log vòng 300 dòng ([Diag]) + 5 giá trị, có Sao chép/Chia sẻ/Xoá log.
        // Người dùng không cần adb: bấm Chẩn đoán → Sao chép → gửi nội dung cho hỗ trợ.
        findViewById<Button>(R.id.diagButton).setOnClickListener {
            if (!tryStart(Intent(this, DiagActivity::class.java))) {
                toast(getString(R.string.st_no_screen))
            }
        }

        renderStatus()
    }

    override fun onResume() {
        super.onResume()
        registerStatusReceiver()
        renderStatus()
    }

    override fun onPause() {
        unregisterStatusReceiver()
        super.onPause()
    }

    // ── trạng thái: nghe broadcast nội bộ từ PhoneService

    @Suppress("UnspecifiedRegisterReceiverFlag", "DEPRECATION")
    private fun registerStatusReceiver() {
        if (receiverRegistered) return
        val filter = IntentFilter(PhoneStatus.ACTION_STATUS)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(statusReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                registerReceiver(statusReceiver, filter)
            }
            receiverRegistered = true
        } catch (t: Throwable) {
            receiverRegistered = false
        }
    }

    private fun unregisterStatusReceiver() {
        if (!receiverRegistered) return
        receiverRegistered = false
        try {
            unregisterReceiver(statusReceiver)
        } catch (t: Throwable) {
            // bỏ qua
        }
    }

    // ── quyền thông báo

    private fun requestNotifications() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            toast(getString(R.string.st_notif_ok))
            return
        }
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            toast(getString(R.string.st_notif_ok))
            return
        }
        requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIFICATIONS)
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQ_NOTIFICATIONS) return
        val ok = checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        toast(getString(if (ok) R.string.st_notif_ok else R.string.st_notif_no))
        if (!ok) openAppNotificationSettings()
        renderStatus()
    }

    private fun openAppNotificationSettings() {
        val ok = tryStart(
            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
        )
        if (!ok) {
            // Máy cũ / ROM lạ: đi đường thông tin app.
            openAppDetails()
        }
    }

    /** Cài đặt riêng của kênh "Cuộc gọi đến" (mức ưu tiên, âm thanh, hiện trên màn khoá). */
    private fun openCallChannelSettings() {
        val ok = tryStart(
            Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
                .putExtra(Settings.EXTRA_CHANNEL_ID, CallNotifications.CHANNEL_ID)
        )
        if (!ok) openAppNotificationSettings()
    }

    // ── tối ưu pin

    private fun requestIgnoreBattery() {
        val pm = getSystemService(PowerManager::class.java)
        if (pm?.isIgnoringBatteryOptimizations(packageName) == true) {
            toast(getString(R.string.st_battery_ok))
            return
        }
        val ok = tryStart(
            Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))
        )
        if (!ok) {
            tryStart(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
                .also { if (!it) toast(getString(R.string.st_battery_no)) }
        }
    }

    // ── toàn màn hình (Android 14+)

    private fun requestFullScreenIntent() {
        if (Build.VERSION.SDK_INT < 34) {
            // Android 10-13: quyền này tự có, chỉ cần app không bị ROM chặn (MIUI: bật "Màn hình khóa & thông báo").
            toast(getString(R.string.st_full_ok))
            openAppNotificationSettings()
            return
        }
        val nm = getSystemService(NotificationManager::class.java)
        if (nm?.canUseFullScreenIntent() == true) {
            toast(getString(R.string.st_full_ok))
            return
        }
        val ok = tryStart(
            Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:$packageName"))
        )
        if (!ok) {
            toast(getString(R.string.st_full_no))
            openAppDetails()
        }
    }

    // ── cửa sổ nổi (cho phép mở activity từ nền)

    private fun requestOverlay() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && Settings.canDrawOverlays(this)) {
            toast(getString(R.string.st_full_ok))
            return
        }
        val ok = tryStart(
            Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))
        )
        if (!ok) openAppDetails()
    }

    // ── bỏ qua Không làm phiền (để đặt setBypassDnd cho kênh cuộc gọi)

    private fun requestDndAccess() {
        val nm = getSystemService(NotificationManager::class.java)
        if (nm != null && CallNotifications.canBypassDnd(nm)) {
            toast(getString(R.string.st_full_ok))
            return
        }
        val ok = tryStart(Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS))
        if (!ok) openAppDetails()
    }

    // ── lối tắt cài đặt MIUI

    /**
     * MIUI: Tự khởi động (Autostart). Tên lớp thay đổi theo phiên bản MIUI/HyperOS nên thử lần lượt;
     * mở được cái nào thì dừng, không mở được cái nào thì rơi về "Thông tin app".
     */
    private fun openMiuiAutostart() {
        val candidates = listOf(
            ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"),
            ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartActivity"),
            ComponentName("com.miui.securitycenter", "com.miui.permcenter.MainAcitvity")
        )
        for (c in candidates) {
            if (tryStart(Intent().setComponent(c))) return
        }
        toast(getString(R.string.st_no_screen))
        openAppDetails()
    }

    /** MIUI: "Quyền của app" (quyền khác, hiện trên màn khoá, chạy nền...). */
    private fun openMiuiPermissions() {
        val candidates = listOf(
            Intent()
                .setComponent(
                    ComponentName(
                        "com.miui.securitycenter",
                        "com.miui.permcenter.permissions.PermissionsEditorActivity"
                    )
                )
                .putExtra("extra_pkgname", packageName),
            Intent()
                .setComponent(
                    ComponentName(
                        "com.miui.securitycenter",
                        "com.miui.permcenter.permissions.AppPermissionsEditorActivity"
                    )
                )
                .putExtra("extra_pkgname", packageName),
            Intent()
                .setComponent(ComponentName("com.miui.securitycenter", "com.miui.permcenter.MainAcitvity"))
                .putExtra("extra_pkgname", packageName)
        )
        for (i in candidates) {
            if (tryStart(i)) return
        }
        toast(getString(R.string.st_no_screen))
        openAppDetails()
    }

    /** Thông tin app của hệ thống — nơi MIUI đặt "Màn hình khóa & thông báo", "Tiết kiệm pin", quyền... */
    private fun openAppDetails() {
        val ok = tryStart(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
        if (!ok) toast(getString(R.string.st_no_settings_screen))
    }

    /** Mở một Intent; trả về false nếu ROM không có màn hình đó (không bao giờ ném ra ngoài). */
    private fun tryStart(intent: Intent): Boolean = try {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        startActivity(intent)
        true
    } catch (t: Throwable) {
        false
    }

    // ── máy chủ đang dùng + TOKEN ingress

    /**
     * (19/11/2026) GD11 — URL trang điều khiển THẬT SỰ dùng để mở WebView: `webUrl` nếu hợp lệ
     * ([DashboardTarget.isValidSaved]), nếu không thì ứng viên dựng lại từ TOKEN
     * (`https://<domain>/api/hassio_ingress/<TOKEN>/launcher-config.html` → `<slug>` → gốc domain).
     */
    private fun webDashboardUrl(): String? = DashboardTarget.candidates(
        saved = Prefs.webUrl(this),
        loginUrl = Prefs.loginUrl(this),
        typed = Prefs.oneInput(this),
        token = Prefs.ingressToken(this)
    ).firstOrNull()

    /**
     * (13/11/2026) GD6 — hiện ĐÚNG 2 giá trị đang dùng (không suy ra giá trị này từ giá trị kia):
     * webUrl cho WebView và apiBase cho API LAN.
     *
     * (19/11/2026) GD11 — thêm dòng origin đăng nhập (`loginUrl`, khoá riêng) để phân biệt rõ "trang điều khiển"
     * với "trang đăng nhập Home Assistant".
     */
    private fun renderTargets() {
        val saved = Prefs.webUrl(this)
        // (21/11/2026) GD13 — URL ĐANG DÙNG (thật sự mở trong WebView): `webUrl` nếu hợp lệ, không thì ứng viên dựng
        // lại (với IP LAN: `https://<ip>:18443/launcher-config.html` — HTTPS tự ký của add-on).
        val inUse = saved?.takeIf { DashboardTarget.isValidSaved(it) } ?: webDashboardUrl()
        // (1.7) Chỉ MỘT dòng ngắn: URL đang dùng (+ "chứng chỉ tự ký" khi là HTTPS của add-on).
        urlView.text = buildString {
            append(inUse ?: getString(R.string.st_none))
            if (TlsPolicy.isSelfSignedUrl(inUse)) append(getString(R.string.st_url_self))
        }
    }

    // ── đăng nhập Home Assistant (GD7)

    /**
     * (14/11/2026) GD7 — "Đã đăng nhập: có/không", dò bằng cookie thật của WebView:
     * `CookieManager.getInstance().getCookie(origin)`.
     *
     * (18/11/2026) GD10 — KHÔNG chỉ dò 2 tên `ingress_session`/`hassio_ingress` nữa: đăng nhập Lovelace của HA
     * không sinh cookie nào trong hai tên đó (HA giữ phiên trong `localStorage`), nên bản cũ hiện "không" dù đã
     * đăng nhập. Nay có **cookie bất kỳ** của domain là coi như đã có phiên; `ingress_session` (khi app tự tạo —
     * xem [HaIngress]) vẫn được nhận riêng.
     */
    private fun renderHaLogin() {
        val web = Prefs.webUrl(this)
        // (19/11/2026) GD11 — origin lấy từ `webUrl` hoặc khoá riêng `loginUrl` (webUrl có thể chưa có).
        val origin = DashboardTarget.originOf(web) ?: DashboardTarget.originOf(Prefs.loginUrl(this))
        var cookie: String? = null
        if (origin != null) {
            cookie = try {
                CookieManager.getInstance().getCookie(origin)
            } catch (t: Throwable) {
                null
            }
        }
        val logged = WebTargetResolver.hasSessionCookie(cookie) || HaLogin.hasAnyCookie(cookie)
        // (1.7) Một dòng ngắn: "đã đăng nhập" / "chưa đăng nhập" (+ " · cần đăng nhập" khi đang chờ).
        haStatusView.text = buildString {
            append(getString(if (logged) R.string.st_val_logged else R.string.st_val_not_logged))
            if (Prefs.needHaLogin(this@SettingsActivity)) append(getString(R.string.st_val_need_login))
        }
        haStatusView.setTextColor(if (logged) COLOR_SUB else COLOR_BAD)
    }

    /**
     * (14/11/2026) GD7 — "Đăng nhập lại Home Assistant": xoá cookie phiên của origin (và cookie theo path ingress
     * của webUrl), đặt `need_ha_login = true`, rồi mở origin trong WebView của app ở CHẾ ĐỘ đăng nhập
     * (thanh thông báo + nhịp dò 1 s → tự sang trang điều khiển khi đăng nhập xong; GD10).
     */
    private fun reloginHomeAssistant() {
        val web = Prefs.webUrl(this)
        // (19/11/2026) GD11 — origin của HA lấy từ `loginUrl` (khoá riêng) hoặc từ chính `webUrl`; KHÔNG ghi origin
        // vào `webUrl` (xem DashboardTarget).
        val origin = DashboardTarget.originOf(web)
            ?: DashboardTarget.originOf(Prefs.loginUrl(this))
            ?: DashboardTarget.originOf(Prefs.oneInput(this))
        if (origin == null) {
            toast(getString(R.string.st_ha_login_no_web))
            return
        }
        clearHaCookies(origin, web)
        Prefs.setNeedHaLogin(this, true)
        Prefs.setLoginUrl(this, WebTargetResolver.loginUrl(web) ?: "$origin/")
        renderHaLogin()

        val loginUrl = Prefs.loginUrl(this) ?: "$origin/"
        val i = Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(MainActivity.EXTRA_OPEN_URL, loginUrl)
            .putExtra(MainActivity.EXTRA_HA_LOGIN, true)
        if (!tryStart(i)) toast(getString(R.string.st_no_settings_screen))
    }

    /**
     * Xoá cookie phiên Home Assistant của [origin] (và của [webUrl] — cookie ingress có thể nằm ở path
     * `/api/hassio_ingress/<TOKEN>/`). Dùng `Max-Age=0` cho đúng từng (tên, path) đã có, nên không cần biết giá trị;
     * kèm 2 tên cookie phiên để chắc chắn sạch kể cả khi `getCookie` không trả về (cookie HttpOnly).
     */
    private fun clearHaCookies(origin: String, webUrl: String?) {
        val cm = CookieManager.getInstance()
        cm.setAcceptCookie(true)
        val names = LinkedHashSet<String>(WebTargetResolver.SESSION_COOKIE_NAMES)
        val paths = LinkedHashSet<String>()
        paths.add("/")
        webTargetPaths(webUrl).forEach { paths.add(it) }

        for (target in listOfNotNull(origin, webUrl).distinct()) {
            val header = try {
                cm.getCookie(target)
            } catch (t: Throwable) {
                null
            }
            if (!header.isNullOrBlank()) {
                for (part in header.split(';')) {
                    val name = part.substringBefore('=').trim()
                    if (name.isNotEmpty()) names.add(name)
                }
            }
        }

        for (target in listOfNotNull(origin, webUrl).distinct()) {
            for (path in paths) {
                for (name in names) {
                    try {
                        cm.setCookie(target, "$name=; Max-Age=0; Path=$path")
                    } catch (t: Throwable) {
                        // bỏ qua: cookie của domain khác thì CookieManager từ chối, không sao
                    }
                }
            }
        }
        cm.flush()
    }

    /** Các path có thể chứa cookie của [url]: thư mục của chính URL (vd `/api/hassio_ingress/<TOKEN>/`). */
    private fun webTargetPaths(url: String?): List<String> {
        val u = url?.trim().orEmpty()
        val schemeEnd = u.indexOf("://")
        if (schemeEnd < 0) return emptyList()
        val noQuery = u.substring(0, u.indexOfAny(charArrayOf('?', '#')).takeIf { it >= 0 } ?: u.length)
        val slash = noQuery.indexOf('/', schemeEnd + 3)
        if (slash < 0) return emptyList()
        val path = noQuery.substring(slash)
        val dir = path.substringBeforeLast('/')
        val out = ArrayList<String>(2)
        out.add(if (dir.isEmpty()) "/" else "$dir/")
        // Cookie ingress của HA cũng có thể đặt ở path cha `/api/hassio_ingress`.
        val parent = dir.substringBeforeLast('/')
        if (parent.isNotEmpty()) out.add("$parent/")
        return out.distinct()
    }

    /** Lưu TOKEN ingress người dùng vừa sửa (áp dụng cho lần dò kế tiếp). */
    private fun saveToken() {
        val token = tokenInput.text?.toString()?.trim().orEmpty()
        Prefs.setIngressToken(this, token)
        tokenInput.setText(Prefs.ingressToken(this))
        toast(getString(R.string.st_token_saved))
        renderTargets()
    }

    /**
     * Mở một URL trong WebView của MainActivity (dùng chung cookie WebView với lần đăng nhập HA).
     * url = null (chưa cấu hình) -> báo rõ cho người dùng.
     */
    private fun openInWeb(url: String?) {
        if (url.isNullOrBlank()) {
            toast(getString(R.string.st_ha_login_no_web))
            return
        }
        val i = Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(MainActivity.EXTRA_OPEN_URL, url)
        if (!tryStart(i)) toast(getString(R.string.st_no_settings_screen))
    }

    // ── trạng thái

    private fun renderStatus() {
        renderTargets()
        renderHaLogin()

        // (1.7) Mỗi thông tin = MỘT dòng ngắn dưới tiêu đề hàng (không còn khối chữ dài như bản 1.6).
        phoneIdView.text = Prefs.phoneId(this)
        serverView.text = Prefs.apiBase(this) ?: getString(R.string.st_none)
        serviceView.text = getString(if (PhoneService.isRunning()) R.string.st_on else R.string.st_off)

        // Cuộc gọi đang đến / chuông / lần poll cuối (service cập nhật liên tục).
        val callId = PhoneStatus.callId
        callView.text = if (callId.isNullOrBlank()) getString(R.string.st_val_none) else callId
        ringView.text = getString(if (PhoneStatus.ringing) R.string.st_val_ring_on else R.string.st_val_ring_off)
        pollView.text = formatTime(PhoneStatus.lastPollAt)

        // Quyền thông báo (Android 13+): chưa bật thì tô đỏ để người dùng thấy ngay.
        val notifOk = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        setState(notifView, notifOk, R.string.st_val_on, R.string.st_val_off)

        // Kênh thông báo "Cuộc gọi đến" (âm thanh + rung + hiện trên màn khoá do kênh này phát).
        val nm = getSystemService(NotificationManager::class.java)
        val channel = try {
            nm?.getNotificationChannel(CallNotifications.CHANNEL_ID)
        } catch (t: Throwable) {
            null
        }
        val channelOk = channel != null && channel.importance >= NotificationManager.IMPORTANCE_HIGH
        channelView.text = when {
            channel == null -> getString(R.string.st_never)
            channelOk -> getString(R.string.st_val_channel_ok)
            else -> getString(R.string.st_val_channel_bad)
        }
        channelView.setTextColor(if (channelOk) COLOR_SUB else COLOR_BAD)

        val pm = getSystemService(PowerManager::class.java)
        val batteryOk = pm?.isIgnoringBatteryOptimizations(packageName) == true
        batteryView.text = getString(if (batteryOk) R.string.st_val_batt_ok else R.string.st_val_not_allowed)
        batteryView.setTextColor(if (batteryOk) COLOR_SUB else COLOR_BAD)

        setState(fullView, CallNotifications.canUseFullScreen(this), R.string.st_val_allowed, R.string.st_val_not_allowed)
        setState(overlayView, canDrawOverlays(), R.string.st_val_allowed, R.string.st_val_not_allowed)
        setState(dndView, canBypassDnd(), R.string.st_val_allowed, R.string.st_val_not_allowed)
    }

    /** Ghi một dòng trạng thái ngắn: đạt -> chữ màu phụ, chưa đạt -> chữ đỏ nhạt. */
    private fun setState(view: TextView, ok: Boolean, okText: Int, badText: Int) {
        view.text = getString(if (ok) okText else badText)
        view.setTextColor(if (ok) COLOR_SUB else COLOR_BAD)
    }

    /** "Hiện cửa sổ nổi" — cho phép app mở màn gọi từ nền (Android 10+). */
    private fun canDrawOverlays(): Boolean = try {
        Settings.canDrawOverlays(this)
    } catch (t: Throwable) {
        false
    }

    /** Quyền bỏ qua Không làm phiền (để kênh cuộc gọi đặt setBypassDnd). */
    private fun canBypassDnd(): Boolean = try {
        val nm = getSystemService(NotificationManager::class.java)
        nm != null && CallNotifications.canBypassDnd(nm)
    } catch (t: Throwable) {
        false
    }

    private fun formatTime(at: Long): String {
        if (at <= 0L) return getString(R.string.st_never)
        return try {
            SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(Date(at))
        } catch (t: Throwable) {
            getString(R.string.st_never)
        }
    }

    private fun toast(msg: String) {
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
    }
}

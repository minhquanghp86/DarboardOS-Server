package vn.mqsmarthome.dashboardos

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast

/**
 * Phase 1 + phase 2 of Dashboard OS.
 *
 * (13/11/2026) GD6 — màn nhập HAI Ô (bối cảnh đã kiểm chứng):
 *  1. **"Trang điều khiển (https)"** — domain hoặc URL đầy đủ. Nếu người dùng chỉ gõ domain, app thử lần lượt
 *     `https://<domain>/api/hassio_ingress/<TOKEN>/launcher-config.html` → `https://<domain>/<slug>/launcher-config.html`
 *     → `https://<domain>/launcher-config.html` ([WebTargetResolver.webCandidates]). Đúng add-on khi mã **200 hoặc 401**
 *     và body KHÔNG phải SPA của Home Assistant (`<title>Home Assistant</title>`).
 *  2. **"Máy chủ API (LAN)"** — mặc định giá trị đã lưu hoặc `192.168.10.2:18080`; kiểm tra `GET <base>/app/ping`
 *     phải trả `{"service":"dashboard-os"}` ([ServerResolver.probe]). Bỏ trống ô này = suy ra `http://<ip>:18080` từ ô 1
 *     khi ô 1 là IP LAN ([WebTargetResolver.apiBaseOrNull]).
 *
 * Lưu 2 giá trị RIÊNG: [Prefs.KEY_WEB_URL] cho WebView, [Prefs.KEY_API_BASE] cho PhoneService / register / incoming /
 * answer / decline. Không suy ra cái này từ cái kia khi đã có cả hai.
 *
 * (14/11/2026) GD7 — **401 nghĩa là "phải đăng nhập Home Assistant", KHÔNG phải "mở trang lỗi"**:
 *  - dò thấy 401/403 → lưu `webUrl` **và** đặt [Prefs.KEY_NEED_HA_LOGIN] = true (KHÔNG mở thẳng webUrl nữa, vì
 *    Home Assistant trả body text `401: Unauthorized` chứ không redirect sang trang đăng nhập);
 *  - cần đăng nhập → mở WebView tại **origin của HA** (`https://<domain>/`) + thanh thông báo 40dp phía trên
 *    ("Đăng nhập Home Assistant để tiếp tục" + nút "Tôi đã đăng nhập");
 *  - **dò cookie mỗi 1,5 s**: `CookieManager.getInstance().getCookie(origin)` có `ingress_session` (hoặc
 *    `hassio_ingress`) → tự chuyển sang `webUrl`, ẩn thanh thông báo, lưu `need_ha_login = false`;
 *  - nút "Tôi đã đăng nhập" làm đúng việc đó ngay (dự phòng khi không dò được cookie);
 *  - `onReceivedHttpError` 401/403 trên ingress → **không load nội dung lỗi thô**: quay về origin (nếu là chính
 *    trang điều khiển) hoặc hiện màn hình "Cần đăng nhập Home Assistant" có nút Đăng nhập.
 *
 * (18/11/2026) GD10 — "ĐĂNG NHẬP XONG MÀ KHÔNG TỰ SANG DASHBOARD" (lỗi người dùng báo, tái hiện được):
 *  - **Nguyên nhân**: dò "đã đăng nhập" bằng TÊN cookie (`ingress_session` / `hassio_ingress`) là sai bản chất.
 *    Đăng nhập Lovelace KHÔNG tạo cookie nào — HA giữ phiên trong `localStorage` (`hassTokens`), còn
 *    `ingress_session` chỉ được Supervisor cấp khi **mở add-on** (trang HA gọi `POST /api/hassio/ingress/session/<slug>`
 *    rồi đặt cookie). Vì thế nhịp dò cũ không bao giờ khớp → app đứng ở Lovelace cho tới khi người dùng mở add-on
 *    bằng tay và khởi động lại app.
 *  - **Cách sửa**: nhịp dò **1 s** ([loginTick]) dựa trên HÀNH VI, không dựa tên cookie:
 *      • `GET <webUrl>` (kèm cookie) trả **200** + body không phải `<title>Home Assistant</title>` → mở dashboard;
 *      • URL đã rời `/auth/…` của HA **hoặc** có cookie mới (bất kỳ tên) **hoặc** đọc được `hassTokens` → coi là
 *        đã đăng nhập, thử mở dashboard ngay ([HaLogin]);
 *      • **tự tạo phiên ingress** (`POST /api/hassio/ingress/session/<slug>` bằng access token đọc từ
 *        `localStorage` → ghi cookie `ingress_session`) — đúng việc trang HA vẫn làm khi mở add-on ([HaIngress]);
 *      • 401 hai lần liền dù có cookie → thử biến thể `…/<slug>/launcher-config.html` →
 *        `https://<domain>/launcher-config.html` → `http://<host>:18080/launcher-config.html` ([HaLogin.Watch]);
 *        hết biến thể → màn hình thông báo rõ ràng + nút **Thử lại** (không im lặng).
 *  - Thanh thông báo có thêm nút **Mở Dashboard** (luôn hiện) và dòng chẩn đoán `[login] url=… cookie=… web=…`
 *    (giống hệt dòng ghi ra Logcat với tag [LOG_TAG_LOGIN]).
 *  - Lần mở app SAU: có cookie (bất kỳ) → nạp THẲNG `webUrl`, không đi vòng qua Lovelace (hết nhấp nháy).
 *
 * Vẫn giữ nguyên: WebView full screen + WebRTC (micro/camera), tự đăng ký thiết bị, PhoneService nhận cuộc gọi khi
 * app đóng, chuông theo kênh thông báo, nút "URL" ở góc phải dưới để quay lại màn nhập.
 */
class MainActivity : Activity() {

    companion object {
        /** (10/11/2026) Mo WebView thang mot URL (vd call-web.html?call=<id> sau khi bam "Nghe"). */
        const val EXTRA_OPEN_URL = "open_url"

        /**
         * (14/11/2026) GD7 — mở WebView RỒI vào thẳng bước đăng nhập Home Assistant (thanh thông báo + dò cookie),
         * dùng cho nút "Đăng nhập lại Home Assistant" ở Cài đặt (url kèm theo là origin của HA).
         */
        const val EXTRA_HA_LOGIN = "ha_login"

        private const val REQ_WEB_MEDIA = 1001
        private const val OVERLAY_VISIBLE_MS = 4000L

        /** Do dam luc nghi cua nut URL o goc phai duoi (van bam duoc, khong che noi dung). */
        private const val URL_BUTTON_ALPHA = 0.45f

        /**
         * (18/11/2026) GD10 — nhịp dò "đã đăng nhập Home Assistant" **mỗi 1 giây** (bản cũ 1,5 s và chỉ dò cookie
         * theo tên). Mỗi nhịp ghi một dòng `[login] url=… cookie=… web=…` ra Logcat (tag [LOG_TAG_LOGIN]).
         */
        private const val LOGIN_POLL_MS = 1000L

        /**
         * (18/11/2026) GD10 — tag Logcat của luồng đăng nhập. Xem trên máy thật:
         * `adb logcat -s DashboardOS-login`.
         */
        const val LOG_TAG_LOGIN = "DashboardOS-login"

        /** Giãn cách tối thiểu giữa hai lần đọc `localStorage.hassTokens` (JS) — tránh gọi liên tục. */
        private const val TOKEN_ASK_MIN_GAP_MS = 2500L

        /**
         * (18/11/2026) GD10 — đoạn JS **chỉ ĐỌC** access token của phiên HA từ `localStorage` của chính trang HA
         * (`hassTokens`). Token này dùng để app tự tạo phiên ingress ([HaIngress]) — thứ duy nhất khiến
         * `/api/hassio_ingress/<TOKEN>/launcher-config.html` trả 200 thay vì 401 ngay sau khi đăng nhập.
         *
         * Không sửa gì trên trang (không đụng DOM, không gọi mạng): chỉ đọc khoá `hassTokens`.
         */
        private const val JS_HA_ACCESS_TOKEN =
            "(function(){try{var r=window.localStorage.getItem('hassTokens');if(!r){return '';}" +
                "var o=JSON.parse(r);return (o&&o.access_token)?String(o.access_token):'';}catch(e){return '';}})()"

        /** (18/11/2026) GD10 — 2 "liên kết" của màn hình lỗi (bắt ở [DashboardWebClient.shouldOverrideUrlLoading]). */
        private const val RETRY_HREF = "dashboardos://retry"
        private const val LOGIN_HREF = "dashboardos://login"
    }

    private lateinit var prefs: SharedPreferences
    private val mainHandler = Handler(Looper.getMainLooper())

    private var webView: WebView? = null
    private var webInput: EditText? = null
    private var statusView: TextView? = null
    private var showingWeb = false
    private var pendingPermissionRequest: PermissionRequest? = null

    /** Thanh thông báo đăng nhập + câu chữ của nó (chỉ có ở màn WebView). */
    private var loginBar: View? = null
    private var loginBarText: TextView? = null

    /** Trang điều khiển đã lưu ([Prefs.KEY_WEB_URL]) — đích thật của WebView. */
    private var targetUrl: String? = null

    /** Origin của Home Assistant (`https://<domain>`), null khi webUrl không phải URL http(s). */
    private var haOrigin: String? = null

    /** Đang ở bước "đăng nhập HA": thanh thông báo hiện + nhịp dò 1 s chạy. */
    private var loginFlowActive = false

    /** URL sẽ mở sau khi đăng nhập xong (mặc định = [targetUrl]). */
    private var afterLoginUrl: String? = null

    // ── (18/11/2026) GD10 — trạng thái dò "đã đăng nhập" (không dựa tên cookie)

    /** Máy trạng thái dò `webUrl` + các biến thể URL ([HaLogin.Watch]). null = chưa vào luồng đăng nhập. */
    private var loginWatch: HaLogin.Watch? = null

    /** Tên cookie của origin LÚC BẮT ĐẦU luồng — có tên mới = dấu hiệu "vừa đăng nhập". */
    private var baselineCookieNames: Set<String> = emptySet()

    /** Mã HTTP của lần dò `webUrl` gần nhất (chỉ để log + hiện trên thanh thông báo). */
    private var lastWebStatus: Int? = null

    /** Đang dò ở luồng nền (không dò chồng). */
    private var probing = false

    /** Tăng mỗi lần vào lại luồng đăng nhập — kết quả dò của luồng cũ bị bỏ qua. */
    @Volatile
    private var probeGen = 0

    /** Đang chờ kết quả `evaluateJavascript` đọc `hassTokens`. */
    private var tokenAskPending = false

    /** Lần cuối hỏi token (giãn cách [TOKEN_ASK_MIN_GAP_MS]). */
    private var lastTokenAskAt = 0L

    /** Access token của phiên HA (đọc từ `localStorage`) — có thì tự tạo được phiên ingress. */
    private var haAccessToken: String? = null

    /** Số lần đã mở trang cùng origin rất nhẹ (`/manifest.json`) để đọc `hassTokens` (tối đa 2 — xem [ensureSameOriginForTokens]). */
    private var neutralLoads = 0

    /** Đã thấy dấu hiệu "đăng nhập xong" (rời /auth/, cookie mới, token) trong luồng hiện tại. */
    private var loggedInSignal = false

    /** Tự dò đã thất bại (hết biến thể mà vẫn 401) → hiện thông báo + nút "Thử lại". */
    private var loginFailed = false

    /** Đang dò máy chủ ở luồng nền (chặn bấm "Kết nối" 2 lần). */
    @Volatile
    private var searching = false

    /** Tăng mỗi lần dò; kết quả của lần cũ bị bỏ qua. */
    @Volatile
    private var searchToken = 0

    private val hideOverlayRunnable = Runnable {
        val button: Button? = findViewById(R.id.changeUrlButton)
        button?.animate()?.alpha(0f)?.setDuration(300)?.withEndAction {
            button.visibility = View.GONE
        }?.start()
    }

    /**
     * (18/11/2026) GD10 — NHỊP DÒ 1 GIÂY trong lúc chờ/đã đăng nhập Home Assistant.
     *
     * Bản cũ ([cookieWatchRunnable], 1,5 s) chỉ hỏi "cookie có tên `ingress_session`/`hassio_ingress` chưa" — mà
     * đăng nhập Lovelace **không** sinh cookie đó (xem KDoc đầu tệp), nên nó không bao giờ khớp. Nhịp mới dò
     * HÀNH VI: probe `GET <webUrl>` trả 200 & không phải SPA của HA, URL đã rời `/auth/…`, cookie mới bất kỳ, hoặc
     * đọc được `hassTokens` → mở dashboard ngay.
     */
    private val loginTickRunnable = object : Runnable {
        override fun run() {
            if (isFinishing || isDestroyed) return
            if (!showingWeb || !loginFlowActive) return
            loginTick()
            if (showingWeb && loginFlowActive) mainHandler.postDelayed(this, LOGIN_POLL_MS)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs.get(this)

        // (10/11/2026) GD2: nhan cuoc goi khi app dong — foreground service + poll 2 s (tat trong Cai dat).
        if (Prefs.receiveEnabled(this)) PhoneService.start(this)

        if (openFromIntent(intent)) return
        // (13/11/2026) GD6 / (14/11/2026) GD7: đã có webUrl → vào WebView; nếu lần dò trước trả 401 thì mở
        // origin của HA để đăng nhập trước (không mở thẳng webUrl = chỉ hiện "401: Unauthorized").
        autoConnectSaved()
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (!openFromIntent(intent)) return
    }

    /** Mo URL tu extra (trang cuoc goi / nut "Dang nhap Home Assistant"). true = da xu ly. */
    private fun openFromIntent(intent: Intent?): Boolean {
        val raw = intent?.getStringExtra(EXTRA_OPEN_URL) ?: return false
        val url = raw.trim()
        if (!url.startsWith("http://") && !url.startsWith("https://")) return false
        val startLogin = intent.getBooleanExtra(EXTRA_HA_LOGIN, false)
        intent.removeExtra(EXTRA_OPEN_URL)
        intent.removeExtra(EXTRA_HA_LOGIN)

        buildWebScreen()
        if (startLogin) {
            // (14/11/2026) GD7: "Đăng nhập lại Home Assistant" — mở trang đăng nhập + thanh thông báo + dò cookie.
            afterLoginUrl = targetUrl ?: url
            // Chưa có webUrl để lấy origin thì dùng chính URL được truyền vào (Cài đặt truyền origin của HA).
            if (haOrigin == null) haOrigin = WebTargetResolver.originUrl(url)
            startLoginFlow(openOrigin = true)
        } else {
            webView?.loadUrl(url)
        }
        return true
    }

    // ------------------------------------------------------------------ mở lại cấu hình đã lưu

    /**
     * (13/11/2026) GD6 — lần sau mở app: có [Prefs.KEY_WEB_URL] thì mở WebView luôn.
     *
     * (14/11/2026) GD7 — nhưng nếu [Prefs.KEY_NEED_HA_LOGIN] đang bật (lần dò trước trả 401) và WebView chưa có
     * cookie phiên HA thì [openWeb] sẽ đưa người dùng tới trang đăng nhập của HA trước.
     *
     * API (LAN) do PhoneService tự poll ở nền; hỏng thì Cài đặt hiện giá trị đang dùng để sửa.
     */
    private fun autoConnectSaved() {
        val web = Prefs.webUrl(this)
        if (web == null) {
            showUrlScreen()
            return
        }
        if (Prefs.receiveEnabled(this)) PhoneService.start(this)
        openWeb(web)
    }

    // ------------------------------------------------------------------ màn nhập 2 ô

    private fun showUrlScreen(status: String? = null) {
        showingWeb = false
        disposeWebView()

        setContentView(R.layout.activity_url)

        // (17/11/2026) GD9 — MOT O: domain hoặc IP LAN. Dữ liệu 2 ô của bản cũ vẫn được điền sẵn (Prefs.oneInput).
        val web = findViewById<EditText>(R.id.webInput)
        webInput = web
        web.setText(Prefs.oneInput(this) ?: "")
        web.setSelection(web.text.length)

        statusView = findViewById(R.id.urlStatus)
        setStatus(status ?: defaultStatus())

        findViewById<Button>(R.id.connectButton).setOnClickListener { connect() }
        // (10/11/2026) GD2: Cai dat nhan cuoc goi khi app dong + quyen thong bao / toi uu pin.
        findViewById<Button>(R.id.settingsButton).setOnClickListener {
            startActivity(Intent(this, SettingsActivity::class.java))
        }

        web.setOnEditorActionListener { _, actionId, _ -> connectOnAction(actionId) }
    }

    private fun connectOnAction(actionId: Int): Boolean {
        if (actionId == EditorInfo.IME_ACTION_GO || actionId == EditorInfo.IME_ACTION_DONE) {
            connect()
            return true
        }
        return false
    }

    /** "Đã kết nối: <webUrl> · API <apiBase> · Điện thoại: <name>" (hoặc rỗng khi chưa kết nối lần nào). */
    private fun defaultStatus(): String {
        val web = Prefs.webUrl(this) ?: return ""
        val api = Prefs.apiBase(this) ?: WebTargetResolver.DEFAULT_API_INPUT
        val base = getString(R.string.status_connected, web, api, Prefs.phoneName())
        // (14/11/2026) GD7 — nói rõ vì sao lần trước dừng ở trang đăng nhập.
        val login = if (Prefs.needHaLogin(this)) "\n" + getString(R.string.status_need_login) else ""
        // (17/11/2026) GD9 — địa chỉ KHÔNG phải https: nói thẳng là mất micro/camera.
        val insecure = if (WebTargetResolver.lacksSecureContext(web)) "\n" + getString(R.string.warn_no_secure, web) else ""
        return base + insecure + login
    }

    private fun setStatus(text: String?) {
        statusView?.text = text.orEmpty()
        statusView?.visibility = if (text.isNullOrEmpty()) View.GONE else View.VISIBLE
    }

    /**
     * (13/11/2026) GD6 — "Kết nối":
     *  1. ô 1 → [WebTargetResolver.webCandidates] (domain → ingress HA / slug / gốc domain), GET từng cái, nhận
     *     nếu 200|401 và không phải SPA Home Assistant,
     *  2. ô 2 → [WebTargetResolver.apiCandidates]; trống thì [WebTargetResolver.apiBaseOrNull] suy ra từ ô 1
     *     (chỉ khi ô 1 là IP LAN — không thì báo lỗi rõ ràng),
     *  3. lưu webUrl + apiBase (2 giá trị riêng), đăng ký thiết bị, khởi động PhoneService, mở WebView.
     *
     * (14/11/2026) GD7 — 401/403 ở bước 1 KHÔNG mở thẳng webUrl: lưu `webUrl` + `need_ha_login = true` rồi vào
     * bước đăng nhập Home Assistant ([startLoginFlow]).
     */
    private fun connect() {
        if (searching) return
        // (17/11/2026) GD9 — MOT O: "hass.mqsmarthome.io.vn" hoặc "192.168.10.2" (hoặc URL đầy đủ nếu đã dán).
        val text = webInput?.text?.toString()?.trim().orEmpty()
        // Ô thứ hai không còn trên giao diện; ghi rỗng để dữ liệu cũ không quay lại (Prefs vẫn giữ khoá cũ).
        Prefs.saveInputs(this, text, "")

        val token = Prefs.ingressToken(this)
        val webList = WebTargetResolver.webCandidates(text, token)
        if (webList.isEmpty()) {
            val msg = if (text.isEmpty()) getString(R.string.err_empty_web) else getString(R.string.err_bad_web)
            setStatus(msg)
            toast(msg)
            return
        }
        // Gốc API suy ra từ ĐÚNG ô đó: domain -> ingress HA (cần cookie), IP LAN -> http://<ip>:18080.
        val apiList = WebTargetResolver.apiBasesForInput(text, token)
        if (apiList.isEmpty()) {
            val msg = getString(R.string.err_api_underivable)
            setStatus(msg)
            toast(msg)
            return
        }

        val t = ++searchToken
        searching = true
        setSearchingUi(true)
        setStatus(getString(R.string.status_searching_web, 1, webList.size))

        Thread {
            // ── 1) trang điều khiển (gửi kèm cookie HA nếu đã đăng nhập -> sau khi đăng nhập sẽ thấy 200)
            var foundWeb: String? = null
            var foundCheck: WebTargetResolver.WebCheck? = null
            val triedWeb = ArrayList<String>(webList.size)
            for ((index, url) in webList.withIndex()) {
                if (t != searchToken) return@Thread
                post { if (t == searchToken) setStatus(getString(R.string.status_searching_web, index + 1, webList.size)) }
                triedWeb.add(url)
                val check = WebTargetResolver.probeWeb(url, HaCookie.header(url))
                if (check != null && check.accepted) {
                    foundWeb = check.url
                    foundCheck = check
                    break
                }
            }
            val webUrl = foundWeb
            if (webUrl == null) {
                post {
                    if (t != searchToken) return@post
                    searching = false
                    setSearchingUi(false)
                    showNotFound(getString(R.string.status_web_not_found), triedWeb, getString(R.string.status_web_hint))
                }
                return@Thread
            }
            // (14/11/2026) GD7 — 401/403 = đúng add-on nhưng CHƯA có cookie HA.
            var needLogin = WebTargetResolver.needsHaLogin(foundCheck?.status ?: 0)

            // ── 2) gốc API (cùng một ô): 200 = đúng add-on; 401/403 = đúng đường dẫn nhưng thiếu cookie HA;
            //        404 = sai TOKEN ingress -> thử ứng viên kế tiếp (slug add-on -> gốc domain -> cổng 18080).
            var foundApi: String? = null
            var authApi: String? = null
            val triedApi = ArrayList<String>(apiList.size)
            for ((index, base) in apiList.withIndex()) {
                if (t != searchToken) return@Thread
                post { if (t == searchToken) setStatus(getString(R.string.status_searching_api, index + 1, apiList.size)) }
                triedApi.add(base)
                val cookie = HaCookie.header(base)
                if (ServerResolver.probe(base, cookie) != null) {
                    foundApi = base
                    break
                }
                val code = ServerResolver.probeStatus(base, cookie) ?: continue
                if (authApi == null && WebTargetResolver.needsHaLogin(code)) {
                    authApi = base                 // đúng ingress, chỉ thiếu đăng nhập -> dùng sau khi đăng nhập
                    needLogin = true
                    break
                }
            }
            // Không có ứng viên 200 nhưng có ứng viên "cần đăng nhập HA" -> vẫn lưu để đăng nhập rồi dùng.
            val apiBase = foundApi ?: authApi
            if (apiBase == null) {
                post {
                    if (t != searchToken) return@post
                    searching = false
                    setSearchingUi(false)
                    showNotFound(getString(R.string.status_api_not_found), triedApi, getString(R.string.status_api_hint))
                }
                return@Thread
            }

            // ── 3) lưu, đăng ký thiết bị (kèm cookie), khởi động service, mở trang.
            Prefs.saveTargets(this, webUrl, apiBase, text, "")
            Prefs.setNeedHaLogin(this, needLogin)
            val id = Prefs.phoneId(this)
            // (GD8) gui kem deviceKey + model; server co the GOP ban ghi trung va tra id CHUAN -> cap nhat lai Prefs.
            val registeredId = PhoneApi.register(
                apiBase, webUrl, id, Prefs.phoneName(), Prefs.deviceKey(this), Prefs.phoneModel(), HaCookie.header(apiBase)
            )
            val registered = registeredId != null
            if (registeredId != null && registeredId != id) Prefs.setPhoneId(this, registeredId)
            if (Prefs.receiveEnabled(this)) PhoneService.start(this)

            post {
                if (t != searchToken) return@post
                searching = false
                setSearchingUi(false)
                toast(getString(if (registered) R.string.connect_ok else R.string.connect_ok_noreg))
                // Không phải https -> KHÔNG có micro/camera: nói rõ ngay (vẫn mở trang).
                if (WebTargetResolver.lacksSecureContext(webUrl)) toast(getString(R.string.warn_no_secure, webUrl))
                // openWeb() tự quyết: need_ha_login = true → mở origin của HA để đăng nhập trước.
                openWeb(webUrl)
            }
        }.also { it.isDaemon = true; it.name = "target-probe" }.start()
    }

    private fun setSearchingUi(busy: Boolean) {
        findViewById<Button>(R.id.connectButton)?.isEnabled = !busy
        webInput?.isEnabled = !busy
    }

    /** Tiêu đề + danh sách đã thử + gợi ý. */
    private fun showNotFound(title: String, tried: List<String>, hint: String) {
        val sb = StringBuilder(title)
        for (url in tried) sb.append('\n').append("• ").append(url)
        sb.append("\n\n").append(hint)
        setStatus(sb.toString())
    }

    // ------------------------------------------------------------------ Web screen

    /**
     * (14/11/2026) GD7 — mở WebView cho [url].
     *
     * (18/11/2026) GD10 — "lần sau mở app" phải vào THẲNG dashboard, không nhấp nháy qua Lovelace: nếu [url] là
     * chính trang điều khiển đã lưu và WebView **đã có cookie** (bất kỳ tên — xem [hasAnyCookie]) thì nạp luôn
     * trang đó; chỉ khi **không có cookie nào** mới mở origin của HA để đăng nhập. 401 thật (cookie cũ/hết hạn)
     * do [DashboardWebClient.onReceivedHttpError] → [onAuthRequired] xử lý: dò + tự tạo phiên ingress trước, chỉ
     * khi không được mới đưa về trang đăng nhập.
     *
     * Các URL khác (trang gọi `call-web.html?call=…`) vẫn mở ngay như trước.
     */
    private fun openWeb(url: String) {
        buildWebScreen()

        val target = targetUrl
        if (target != null && WebTargetResolver.sameUrl(url, target)) {
            afterLoginUrl = target
            if (hasAnyCookie() || !Prefs.needHaLogin(this)) {
                // (GD10) có cookie (hoặc lần dò trước đã 200) → vào thẳng trang điều khiển.
                Prefs.setNeedHaLogin(this, false)
                webView?.loadUrl(url)
                return
            }
            startLoginFlow(openOrigin = true)
            return
        }
        webView?.loadUrl(url)
    }

    /**
     * (18/11/2026) GD10 — cookie header của origin HA + trang điều khiển (gộp cả hai path, xem [HaCookie.header]).
     * null = WebView chưa có cookie nào.
     */
    private fun currentCookieHeader(): String? =
        HaCookie.header(targetUrl) ?: haOrigin?.let { HaCookie.header(it) }

    /**
     * (18/11/2026) GD10 — đã có cookie BẤT KỲ chưa (**không** ràng buộc tên: `ingress_session`, `hassio_ingress`
     * hay bất cứ tên nào HA/Supervisor dùng). Đây là dấu hiệu "đã từng đăng nhập" — đủ để thử mở thẳng dashboard
     * thay vì đẩy người dùng về trang chủ HA.
     */
    private fun hasAnyCookie(): Boolean = HaLogin.hasAnyCookie(currentCookieHeader())

    /** Dựng màn WebView + thanh thông báo + nút URL (dùng chung cho mọi đường vào). */
    private fun buildWebScreen() {
        showingWeb = true
        disposeWebView()
        statusView = null

        setContentView(R.layout.activity_web)

        val web = findViewById<WebView>(R.id.webView)
        webView = web
        configureWebView(web)

        targetUrl = Prefs.webUrl(this)
        haOrigin = WebTargetResolver.originUrl(targetUrl)
        afterLoginUrl = targetUrl
        loginWatch = null

        loginBar = findViewById(R.id.haLoginBar)
        loginBarText = findViewById(R.id.haLoginText)
        loginBarText?.text = getString(R.string.ha_login_banner)
        // (GD10) ba nút của thanh thông báo: "Mở Dashboard" (luôn hiện), "Thử lại" (hiện khi tự dò thất bại),
        // "Tôi đã đăng nhập" (dự phòng cũ).
        findViewById<Button>(R.id.haLoginDoneButton).setOnClickListener { onLoginConfirmed() }
        findViewById<Button>(R.id.haDashboardButton).setOnClickListener { onOpenDashboardClicked() }
        findViewById<Button>(R.id.haRetryButton).setOnClickListener { onRetryClicked() }
        showLoginBar(false)

        val changeUrlButton = findViewById<Button>(R.id.changeUrlButton)
        // (30/10/2026) GD4: nút URL mở lại màn nhập ĐỊA CHỈ (điền sẵn giá trị cũ) để đổi máy chủ nhanh.
        changeUrlButton.setOnClickListener { showUrlScreen() }
        // (12/11/2026) Nut nam o goc phai DUOI (40dp) de khong de len nut cua trang (goc phai tren la cho
        // nut "Chọn" cua trang Chuông cổng / banh rang cua trang Cuoc goi). Hien ro 4 s dau roi mo ve alpha 0.45
        // — van luon bam duoc.
        changeUrlButton.alpha = 0.75f
        changeUrlButton.visibility = View.VISIBLE
        mainHandler.removeCallbacks(hideOverlayRunnable)
        mainHandler.postDelayed({
            changeUrlButton.animate().alpha(URL_BUTTON_ALPHA).setDuration(400).start()
        }, OVERLAY_VISIBLE_MS)
    }

    /**
     * (13/11/2026) GD6 — WebView cho trang HTTPS của add-on (ingress HA):
     *  - `domStorageEnabled` + cookie bật sẵn (localStorage của launcher-config.html, phiên đăng nhập HA),
     *  - `mediaPlaybackRequiresUserGesture=false` + WebChromeClient cấp micro/camera (secure context https),
     *  - (14/11/2026) GD7 — 401/403 của ingress KHÔNG được hiện ra: xem [DashboardWebClient.onReceivedHttpError].
     */
    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView(web: WebView) {
        val settings: WebSettings = web.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        settings.builtInZoomControls = false
        settings.displayZoomControls = false
        settings.setSupportZoom(false)
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        settings.safeBrowsingEnabled = true

        // Cookie (phiên đăng nhập Home Assistant) là điều kiện để ingress trả trang thay vì 401.
        val cookies = CookieManager.getInstance()
        cookies.setAcceptCookie(true)
        cookies.setAcceptThirdPartyCookies(web, true)

        web.setBackgroundColor(Color.BLACK)
        web.overScrollMode = View.OVER_SCROLL_NEVER
        web.isScrollbarFadingEnabled = true
        web.webViewClient = DashboardWebClient()
        web.webChromeClient = DashboardChromeClient()
    }

    private fun disposeWebView() {
        mainHandler.removeCallbacks(hideOverlayRunnable)
        stopLoginTick()
        loginFlowActive = false
        probeGen++
        probing = false
        loginBar = null
        loginBarText = null
        val web = webView ?: return
        webView = null
        (web.parent as? ViewGroup)?.removeView(web)
        web.stopLoading()
        web.webChromeClient = null
        web.loadUrl("about:blank")
        web.destroy()
    }

    // ------------------------------------------------------------------ đăng nhập Home Assistant (GD7)

    private fun showLoginBar(shown: Boolean) {
        loginBar?.visibility = if (shown) View.VISIBLE else View.GONE
    }

    /**
     * (14/11/2026) GD7 / (18/11/2026) GD10 — vào bước "đăng nhập Home Assistant": hiện thanh thông báo,
     * (tuỳ chọn) mở origin của HA (`https://<domain>/` — Lovelace hiện form đăng nhập) và bật nhịp dò **1 s**.
     *
     * openOrigin = false dùng khi người dùng ĐÃ đăng nhập (đã có cookie) mà ingress vẫn 401: giữ nguyên trang hiện
     * tại, chỉ dò + tự tạo phiên ingress — KHÔNG đẩy người dùng về Lovelace thêm lần nữa.
     */
    private fun startLoginFlow(openOrigin: Boolean) {
        loginFlowActive = true
        Prefs.setNeedHaLogin(this, true)
        showLoginBar(true)
        resetLoginWatch()
        startLoginTick()

        val origin = haOrigin
        if (origin == null) {
            // webUrl không phải URL http(s) (vd apiBase LAN): không có trang đăng nhập để mở.
            showLoginPanel(
                getString(R.string.ha_login_required_title),
                getString(R.string.ha_login_required_hint),
                withRetry = true
            )
            return
        }
        if (openOrigin) {
            loginBarText?.text = getString(R.string.ha_login_banner)
            webView?.loadUrl(loginPageUrl(origin))
        }
    }

    /** `https://<domain>` → `https://<domain>/` (đúng origin của HA). */
    private fun loginPageUrl(origin: String): String = origin.trimEnd('/') + "/"

    // ── (18/11/2026) GD10 — nhịp dò 1 s: "đã đăng nhập chưa" và "đã vào được add-on chưa"

    private fun startLoginTick() {
        mainHandler.removeCallbacks(loginTickRunnable)
        mainHandler.post(loginTickRunnable)
    }

    private fun stopLoginTick() {
        mainHandler.removeCallbacks(loginTickRunnable)
    }

    /** Ghi một dòng log chẩn đoán (Logcat tag [LOG_TAG_LOGIN] — `adb logcat -s DashboardOS-login`). */
    private fun log(line: String) {
        Log.i(LOG_TAG_LOGIN, line)
    }

    private fun yn(value: Boolean): String = if (value) "yes" else "no"

    /**
     * (18/11/2026) GD10 — quên trạng thái của lần dò trước (cookie baseline, token, biến thể URL).
     * Dùng mỗi lần vào / vào lại luồng đăng nhập (kể cả nút "Thử lại").
     */
    private fun resetLoginWatch() {
        probeGen++
        // afterLoginUrl dùng khi webUrl chưa có (đường vào từ Cài đặt: "Đăng nhập lại Home Assistant").
        val watch = HaLogin.Watch(targetUrl ?: afterLoginUrl)
        loginWatch = watch
        baselineCookieNames = HaLogin.cookieNames(currentCookieHeader())
        lastWebStatus = null
        loggedInSignal = false
        loginFailed = false
        haAccessToken = null
        neutralLoads = 0
        tokenAskPending = false
        probing = false
        showRetryButton(false)
        log(
            "[login] start web=${targetUrl ?: "-"} variants=${watch.variants.size} " +
                "cookie=${yn(hasAnyCookie())} baseline=${baselineCookieNames.joinToString("/").ifEmpty { "-" }}"
        )
    }

    /**
     * (18/11/2026) GD10 — MỘT nhịp dò (mỗi 1 s):
     *  1. ghi `[login] url=… cookie=… web=…` ra Logcat **và** lên thanh thông báo,
     *  2. nhận dấu hiệu "đã đăng nhập": URL đã rời `/auth/…` của HA, hoặc có cookie MỚI (bất kỳ tên), hoặc đọc
     *     được `hassTokens` trong `localStorage` ([maybeReadHaTokens]),
     *  3. dò `GET <candidate>` kèm cookie ([probeCandidate]) — 200 + body không phải SPA của HA là xong.
     */
    private fun loginTick() {
        val url = webView?.url
        val cookieHeader = currentCookieHeader()
        val cookiePresent = !cookieHeader.isNullOrBlank()
        val newNames = HaLogin.newCookieNames(baselineCookieNames, HaLogin.cookieNames(cookieHeader))
        val leftAuth = HaLogin.leftAuthPage(url, haOrigin)
        if (!loggedInSignal && (leftAuth || newNames.isNotEmpty())) {
            loggedInSignal = true
            // Dò LẠI TỪ BIẾN THỂ ĐẦU: trong lúc người dùng còn đăng nhập, các biến thể có thể đã bị "thử" (nếu
            // origin có cookie lạ) — sau khi đăng nhập xong phải thử lại từ `webUrl` (ingress là dạng chính).
            loginWatch?.reset()
            log(
                "[login] signal=logged_in left_auth=$leftAuth " +
                    "new_cookie=${newNames.joinToString("/").ifEmpty { "-" }}"
            )
        }
        log(
            HaLogin.pollLogLine(
                url,
                cookiePresent,
                lastWebStatus,
                "left_auth=$leftAuth new_cookie=${newNames.size} " +
                    "token=${yn(haAccessToken != null)} sig=${yn(loggedInSignal)}"
            )
        )
        showLoginDiag(url, cookiePresent)
        // Có dấu hiệu đăng nhập → đọc access token (JS, CHỈ đọc localStorage) để tự tạo phiên ingress.
        if (loggedInSignal) maybeReadHaTokens()
        if (loggedInSignal) ensureSameOriginForTokens()
        if (!probing) probeCandidate(cookiePresent)
    }

    /** Dòng chẩn đoán trên thanh thông báo (đúng dòng vừa ghi ra Logcat). */
    private fun showLoginDiag(url: String?, cookiePresent: Boolean) {
        if (loginFailed) return
        val base = if (loggedInSignal) {
            getString(R.string.ha_login_probing, lastWebStatus?.toString() ?: "-")
        } else {
            getString(R.string.ha_login_banner)
        }
        loginBarText?.text = base + "\n" + HaLogin.pollLogLine(url, cookiePresent, lastWebStatus)
    }

    /**
     * (18/11/2026) GD10 — dò trang điều khiển ở LUỒNG NỀN (không chặn UI): `GET <candidate>` kèm cookie hiện có
     * ([HaCookie.header]) rồi trả kết quả về UI ([onProbeResult]). Đây là phép thử "đã đăng nhập" **không** dựa
     * vào tên cookie: ingress trả 200 kèm `<title>Dashboard</title>` khi phiên hợp lệ, 401 khi chưa.
     */
    private fun probeCandidate(cookiePresent: Boolean) {
        val watch = loginWatch ?: return
        val url = watch.current ?: return
        val gen = probeGen
        probing = true
        Thread {
            val cookie = HaCookie.header(url)
            val check = WebTargetResolver.probeWeb(url, cookie)
            post {
                if (gen != probeGen) return@post      // đã vào lại luồng khác → bỏ kết quả cũ
                probing = false
                if (!loginFlowActive) return@post
                val cookieNow = cookiePresent || !HaCookie.header(url).isNullOrBlank()
                val status = check?.status
                lastWebStatus = status
                onProbeResult(
                    url,
                    status,
                    HaLogin.isDashboardResponse(status ?: 0, check?.body),
                    cookieNow
                )
            }
        }.also { it.isDaemon = true; it.name = "login-probe" }.start()
    }

    /**
     * (18/11/2026) GD10 — quyết định theo [HaLogin.Watch]:
     * 200 + không phải SPA của HA → mở dashboard; 401 hai lần liền dù đã có cookie → biến thể URL kế tiếp;
     * hết biến thể → thông báo rõ ràng + nút "Thử lại" (không im lặng).
     */
    private fun onProbeResult(url: String, status: Int?, dashboard: Boolean, cookiePresent: Boolean) {
        val watch = loginWatch ?: return
        // 200 + không phải SPA của HA = đã vào được add-on: mở NGAY, không cần chờ thêm dấu hiệu đăng nhập nào.
        if (dashboard) {
            log("[login] probe url=$url web=${status ?: "-"} dash=true → NAVIGATE")
            goDashboard(url)
            return
        }
        // CHƯA có dấu hiệu đăng nhập thì 401 là chuyện đương nhiên (người dùng còn ở form đăng nhập): không đếm
        // lỗi, không đổi biến thể — tránh việc "đi hết biến thể" trong lúc còn đang đăng nhập (rồi kẹt ở biến thể
        // cuối và không bao giờ thử lại ingress sau khi đăng nhập xong).
        if (!loggedInSignal) {
            log("[login] probe url=$url web=${status ?: "-"} dash=false → WAIT (chưa đăng nhập)")
            return
        }
        val step = watch.onProbe(status, dashboard, cookiePresent)
        log("[login] probe url=$url web=${status ?: "-"} dash=$dashboard cookie=$cookiePresent → ${step.action}")
        when (step.action) {
            HaLogin.Action.NAVIGATE -> step.url?.let { goDashboard(it) }

            HaLogin.Action.NEXT_VARIANT -> log(
                "[login] next_variant=${watch.index + 1}/${watch.variants.size} url=${step.url ?: "-"}"
            )

            HaLogin.Action.GIVE_UP -> onLoginFailed(status)

            HaLogin.Action.WAIT -> Unit
        }
    }

    /**
     * (18/11/2026) GD10 — ĐÃ VÀO ĐƯỢC add-on: nạp [url] vào WebView, tắt thanh thông báo, lưu `webUrl` nếu đây
     * là một BIẾN THỂ khác (lần sau vào thẳng, không dò lại), rồi đăng ký thiết bị + chạy PhoneService.
     */
    private fun goDashboard(url: String) {
        stopLoginTick()
        probeGen++
        probing = false
        loginFlowActive = false
        loginFailed = false
        loggedInSignal = false
        Prefs.setNeedHaLogin(this, false)
        showLoginBar(false)
        afterLoginUrl = url
        if (!WebTargetResolver.sameUrl(url, targetUrl)) {
            // Biến thể khác đã chạy được (vd add-on ở gốc domain / cổng 18080) → nhớ luôn cho lần sau.
            Prefs.setWebUrl(this, url)
            targetUrl = url
            haOrigin = WebTargetResolver.originUrl(url)
            log("[login] webUrl=$url (lưu biến thể chạy được)")
        }
        // Giữ cookie (kể cả `ingress_session` vừa tạo) qua lần mở app sau.
        runCatching { CookieManager.getInstance().flush() }
        toast(getString(R.string.ha_login_ok))
        if (Prefs.receiveEnabled(this)) PhoneService.start(this)
        registerInBackground()
        webView?.loadUrl(url)
    }

    /**
     * (18/11/2026) GD10 — tự dò thất bại (đã thử hết biến thể mà vẫn 401/403): **KHÔNG im lặng**.
     * Hiện thông báo rõ ràng + nút **Thử lại** trên thanh thông báo và một màn hình có 2 lối thoát
     * (Thử lại / Đăng nhập Home Assistant).
     */
    private fun onLoginFailed(status: Int?) {
        loginFailed = true
        stopLoginTick()
        probing = false
        showLoginBar(true)
        showRetryButton(true)
        val code = status?.toString() ?: "-"
        loginBarText?.text = getString(R.string.ha_login_failed_banner, code)
        toast(getString(R.string.ha_login_failed_banner, code))
        val tried = loginWatch?.variants?.joinToString("\n") { "• $it" }.orEmpty()
        log("[login] give_up web=$code tried=${loginWatch?.variants?.size ?: 0}")
        // Người dùng đang gõ ở FORM ĐĂNG NHẬP của HA: KHÔNG thay trang (chỉ báo trên thanh thông báo + nút Thử lại).
        if (HaLogin.isAuthPage(webView?.url)) return
        showLoginPanel(
            getString(R.string.ha_login_failed_title),
            getString(R.string.ha_login_failed_hint, code, tried),
            withRetry = true
        )
    }

    /**
     * (18/11/2026) GD10 — nút **"Thử lại"** (trên thanh thông báo hoặc màn hình thất bại): dò LẠI TỪ ĐẦU
     * (biến thể 1, đếm 401 lại từ 0, đọc lại token) — không phải thoát app rồi mở lại.
     */
    private fun onRetryClicked() {
        loginFlowActive = true
        showLoginBar(true)
        resetLoginWatch()
        // Người dùng CHỦ ĐỘNG bấm "Thử lại" → coi như đã đăng nhập: dò và báo kết quả rõ ràng (không im lặng).
        loggedInSignal = true
        startLoginTick()
        maybeReadHaTokens()
        if (!probing) probeCandidate(hasAnyCookie())
    }

    /**
     * (18/11/2026) GD10 — nút **"Mở Dashboard"** (LUÔN hiện ở màn đăng nhập): người dùng chủ động, không chờ dò.
     * Nạp thẳng URL đang thử; nếu vẫn 401 thì [onAuthRequired] chạy chuỗi dò + tự tạo phiên ingress như cũ.
     */
    private fun onOpenDashboardClicked() {
        // Nhịp dò cần biết URL/biến thể: chưa có (mở app bình thường) hoặc lần dò trước đã thất bại thì dựng lại
        // từ ĐẦU (biến thể 1) — nếu không sẽ thử tiếp đúng biến thể vừa hỏng.
        if (loginWatch == null || loginFailed) resetLoginWatch()
        val url = loginWatch?.current ?: afterLoginUrl ?: targetUrl
        if (url == null) {
            toast(getString(R.string.st_ha_login_no_web))
            return
        }
        runCatching { CookieManager.getInstance().flush() }
        loginFlowActive = true
        // Người dùng CHỦ ĐỘNG đòi mở dashboard → bật cờ để nhịp dò dám thử/đổi biến thể và báo kết quả rõ ràng.
        loggedInSignal = true
        showLoginBar(true)
        startLoginTick()
        log("[login] manual_open url=$url cookie=${yn(hasAnyCookie())}")
        webView?.loadUrl(url)
    }

    private fun showRetryButton(shown: Boolean) {
        findViewById<Button>(R.id.haRetryButton)?.visibility = if (shown) View.VISIBLE else View.GONE
    }

    /**
     * (14/11/2026) GD7 — nút "Tôi đã đăng nhập" (dự phòng khi trình duyệt nhúng không ghi cookie hoặc cookie nằm
     * ở path khác): thử sang `webUrl` NGAY, không cần chờ dò.
     * (18/11/2026) GD10 — vẫn bật nhịp dò 1 s để tự tạo phiên ingress nếu ingress trả 401.
     */
    private fun onLoginConfirmed() {
        toast(getString(R.string.ha_login_ok))
        onOpenDashboardClicked()
    }

    /**
     * (18/11/2026) GD10 — đọc access token của phiên HA từ `localStorage.hassTokens` của CHÍNH trang HA
     * ([JS_HA_ACCESS_TOKEN] — chỉ đọc, không sửa trang) rồi tự tạo phiên ingress ([HaIngress] +
     * [HaCookie.setIngressSession]).
     *
     * Đây là mảnh còn thiếu của bản cũ: đăng nhập Lovelace **không** sinh cookie `ingress_session`; chỉ khi app
     * tự tạo phiên thì `GET <webUrl>` mới trả 200 ngay, không phải mở add-on bằng tay rồi khởi động lại app.
     */
    private fun maybeReadHaTokens() {
        if (haAccessToken != null || tokenAskPending) return
        val web = webView ?: return
        val now = System.currentTimeMillis()
        if (now - lastTokenAskAt < TOKEN_ASK_MIN_GAP_MS) return
        lastTokenAskAt = now
        tokenAskPending = true
        try {
            web.evaluateJavascript(JS_HA_ACCESS_TOKEN) { raw ->
                tokenAskPending = false
                val token = HaLogin.tokenFromJsValue(raw)
                log("[login] tokens=${if (token == null) "no" else "yes"}")
                if (token != null && haAccessToken == null) {
                    haAccessToken = token
                    loggedInSignal = true
                    mintIngressSession(token)
                }
            }
        } catch (t: Throwable) {
            tokenAskPending = false
            log("[login] tokens=error ${t.javaClass.simpleName}")
        }
    }

    /**
     * (18/11/2026) GD10 — `localStorage` (`hassTokens`) chỉ đọc được trên một trang **cùng origin** với HA.
     * Nếu WebView đang ở `about:blank` / trang lỗi (vd sau khi chặn body `401: Unauthorized`), mở một trang
     * cùng origin RẤT nhẹ (`/manifest.json` — không phải Lovelace, không phải form đăng nhập) để đọc token,
     * rồi nhịp 1 s sẽ tự tạo phiên ingress. Tối đa 2 lần cho mỗi luồng, chỉ khi đã có dấu hiệu đăng nhập và
     * CHƯA có token — không bao giờ đẩy người dùng ra khỏi trang HA thật.
     */
    private fun ensureSameOriginForTokens() {
        if (haAccessToken != null || tokenAskPending) return
        val origin = haOrigin ?: return
        val url = webView?.url
        if (HaLogin.isSameOrigin(url, origin)) return
        if (neutralLoads >= 2) return
        neutralLoads++
        val probePage = origin.trimEnd('/') + "/manifest.json"
        log("[login] neutral_load=$probePage (đọc hassTokens cùng origin)")
        webView?.loadUrl(probePage)
    }

    /** (18/11/2026) GD10 — tạo phiên ingress thật rồi ghi cookie `ingress_session` (luồng nền). */
    private fun mintIngressSession(accessToken: String) {
        val origin = haOrigin ?: return
        if (loginWatch == null) return
        Thread {
            val session = HaIngress.createSession(origin, ServerResolver.ADDON_SLUG, accessToken) { line -> log(line) }
            if (session == null) {
                log("[login] ingress_session=none")
                return@Thread
            }
            // CookieManager: ghi ở luồng UI cho chắc chắn (WebView cookie store).
            post {
                val ok = HaCookie.setIngressSession(origin, session)
                log("[login] ingress_session=ok written=$ok")
                // Dò NGAY (không chờ nhịp 1 s kế tiếp) để tổng thời gian từ "đăng nhập xong" tới dashboard ≤ 2 s.
                if (!probing) probeCandidate(cookiePresent = true)
            }
        }.also { it.isDaemon = true; it.name = "ha-ingress-session" }.start()
    }

    /**
     * (17/11/2026) GD9 — đăng ký lại thiết bị ở luồng nền (không chặn UI): dùng sau khi đăng nhập Home Assistant
     * xong, vì lúc bấm "Kết nối" có thể chưa có cookie nên lần đăng ký đó thất bại (401).
     */
    private fun registerInBackground() {
        val api = Prefs.apiBase(this) ?: return
        val web = Prefs.webUrl(this)
        Thread {
            try {
                val id = Prefs.phoneId(this)
                val canonical = PhoneApi.register(
                    api, web, id, Prefs.phoneName(), Prefs.deviceKey(this), Prefs.phoneModel(), HaCookie.header(api)
                )
                if (canonical != null && canonical != id) Prefs.setPhoneId(this, canonical)
            } catch (t: Throwable) {
                // mất mạng: service sẽ tự đăng ký lại ở nhịp 60 s
            }
        }.also { it.isDaemon = true; it.name = "register-after-login" }.start()
    }

    /**
     * (18/11/2026) GD10 — màn hình thay thế cho trang lỗi thô (người dùng KHÔNG bao giờ thấy
     * `401: Unauthorized`): tiêu đề + giải thích + lối thoát dạng liên kết `dashboardos://retry` /
     * `dashboardos://login` (bắt ở [DashboardWebClient.shouldOverrideUrlLoading], không phải URL thật).
     */
    private fun showLoginPanel(title: String, message: String, withRetry: Boolean) {
        val web = webView ?: return
        val base = haOrigin?.let { loginPageUrl(it) }
        val body = message.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br>")
        val buttons = StringBuilder()
        if (withRetry) {
            buttons.append("<a href=\"$RETRY_HREF\">").append(getString(R.string.ha_retry_button)).append("</a>")
        }
        if (base != null) {
            buttons.append("<a class=\"ghost\" href=\"$LOGIN_HREF\">")
                .append(getString(R.string.ha_login_again_button))
                .append("</a>")
        }
        val html = """
            <!doctype html>
            <html><head><meta charset="utf-8">
            <meta name="viewport" content="width=device-width,initial-scale=1">
            <style>
            body{margin:0;min-height:100vh;background:#0b1220;color:#e8eef7;font-family:sans-serif;
            display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;
            text-align:center;box-sizing:border-box}
            h1{font-size:20px;margin:0 0 10px}
            p{color:#9aa7bd;font-size:14px;line-height:1.45;margin:0 0 22px;max-width:560px}
            a{display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:14px 26px;
            border-radius:10px;font-size:16px;font-weight:bold;margin:4px}
            a.ghost{background:#243044}
            </style></head>
            <body>
            <h1>$title</h1>
            <p>$body</p>
            <div>$buttons</div>
            </body></html>
        """.trimIndent()
        web.loadDataWithBaseURL(base, html, "text/html", "utf-8", null)
    }

    /**
     * (14/11/2026) GD7 / (18/11/2026) GD10 — gặp 401/403 trên ingress.
     *
     * (GD10) 401 **KHÔNG** còn đồng nghĩa "phải mở trang đăng nhập": HA có thể đã có phiên nhưng thiếu cookie
     * `ingress_session` (đăng nhập Lovelace không sinh cookie đó). Nên:
     *  - đang trong luồng dò → để nhịp 1 s tự lo (dò lại / tự tạo phiên ingress / đổi biến thể URL); chỉ khi
     *    **chưa có dấu hiệu đăng nhập và chưa có cookie nào** mới mở trang đăng nhập;
     *  - ngoài luồng dò → vào luồng, và chỉ `openOrigin = true` (mở Lovelace) khi chưa có cookie nào.
     */
    private fun onAuthRequired(url: String) {
        Prefs.setNeedHaLogin(this, true)
        afterLoginUrl = if (WebTargetResolver.sameUrl(url, targetUrl)) targetUrl else url
        val cookie = hasAnyCookie()
        log("[login] auth_required url=$url cookie=${yn(cookie)} flow=${yn(loginFlowActive)} sig=${yn(loggedInSignal)}")

        if (loginFlowActive) {
            if (haAccessToken == null && !cookie) {
                val origin = haOrigin
                if (origin != null && !HaLogin.isAuthPage(webView?.url)) {
                    // Không có cookie VÀ chưa đọc được `hassTokens`: người dùng còn phải đăng nhập → mở trang đăng nhập.
                    webView?.loadUrl(loginPageUrl(origin))
                }
            }
            return
        }
        startLoginFlow(openOrigin = !cookie)
    }

    // ------------------------------------------------------------------ WebView clients

    private inner class DashboardWebClient : WebViewClient() {

        override fun shouldOverrideUrlLoading(
            view: WebView?,
            request: WebResourceRequest?
        ): Boolean {
            val uri: Uri = request?.url ?: return false
            val scheme = uri.scheme?.lowercase()
            // (18/11/2026) GD10 — 2 "liên kết" của màn hình lỗi tự dựng ([showLoginPanel]): không phải URL thật,
            // bắt ở đây rồi làm đúng việc (thử lại / mở trang đăng nhập của HA).
            if (scheme == "dashboardos") {
                when (uri.host?.lowercase()) {
                    "retry" -> onRetryClicked()
                    "login" -> {
                        val origin = haOrigin
                        if (origin == null) {
                            toast(getString(R.string.st_ha_login_no_web))
                        } else {
                            loginFlowActive = true
                            showLoginBar(true)
                            startLoginTick()
                            webView?.loadUrl(loginPageUrl(origin))
                        }
                    }
                }
                return true
            }
            return when (scheme) {
                null, "http", "https", "about", "blob", "data", "javascript" -> false
                else -> {
                    // mailto:, tel:, intent:, ... -> hand over to the system.
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
                    true
                }
            }
        }

        /**
         * (13/11/2026) GD6 — 401/403 của ingress = add-on đúng nhưng Home Assistant yêu cầu đăng nhập.
         *
         * (14/11/2026) GD7 — KHÔNG để nội dung lỗi (`401: Unauthorized`) hiện ra: `stopLoading()` rồi đưa người
         * dùng về trang đăng nhập của HA (hoặc màn "Cần đăng nhập Home Assistant"), bật thanh thông báo + dò cookie.
         */
        override fun onReceivedHttpError(
            view: WebView?,
            request: WebResourceRequest?,
            errorResponse: WebResourceResponse?
        ) {
            val code = errorResponse?.statusCode ?: return
            if (request?.isForMainFrame != true) return
            val url = request.url?.toString().orEmpty()

            val authError = WebTargetResolver.needsHaLogin(code) &&
                (WebTargetResolver.isIngressUrl(url) || WebTargetResolver.sameUrl(url, targetUrl))
            if (authError) {
                view?.stopLoading()   // chặn body "401: Unauthorized"
                onAuthRequired(url)
                return
            }
            if (code >= 500) toast(getString(R.string.err_load))
        }

        override fun onReceivedError(
            view: WebView?,
            request: WebResourceRequest?,
            error: WebResourceError?
        ) {
            if (request?.isForMainFrame != true) return
            toast(getString(R.string.err_load))
            // Keep the URL button reachable so the user can fix a bad address.
            val button: Button? = findViewById(R.id.changeUrlButton)
            button?.animate()?.cancel()
            button?.alpha = 0.75f
            button?.visibility = View.VISIBLE
            mainHandler.removeCallbacks(hideOverlayRunnable)
        }
    }

    private inner class DashboardChromeClient : WebChromeClient() {

        /**
         * WebRTC (getUserMedia) inside the dashboard. The runtime permission for
         * RECORD_AUDIO / CAMERA is requested here, then the WebView request is
         * granted or denied based on what the user answered.
         */
        override fun onPermissionRequest(request: PermissionRequest) {
            val needed = ArrayList<String>(2)
            for (resource in request.resources) {
                when (resource) {
                    PermissionRequest.RESOURCE_AUDIO_CAPTURE ->
                        if (!isGranted(Manifest.permission.RECORD_AUDIO)) {
                            needed.add(Manifest.permission.RECORD_AUDIO)
                        }

                    PermissionRequest.RESOURCE_VIDEO_CAPTURE ->
                        if (!isGranted(Manifest.permission.CAMERA)) {
                            needed.add(Manifest.permission.CAMERA)
                        }

                    else -> Unit // protected media / MIDI: nothing to ask for
                }
            }

            if (needed.isEmpty()) {
                request.grant(request.resources)
                return
            }

            pendingPermissionRequest?.deny()
            pendingPermissionRequest = request
            try {
                requestPermissions(needed.toTypedArray(), REQ_WEB_MEDIA)
            } catch (t: Throwable) {
                pendingPermissionRequest = null
                request.deny()
            }
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQ_WEB_MEDIA) return

        val request = pendingPermissionRequest
        pendingPermissionRequest = null
        if (request == null) return

        val allGranted = permissions.isNotEmpty() && permissions.all { isGranted(it) }
        if (allGranted) {
            request.grant(request.resources)
        } else {
            request.deny()
            toast(getString(R.string.perm_denied))
        }
    }

    // ------------------------------------------------------------------ Back handling

    @Deprecated("Deprecated in Java")
    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        val web = webView
        if (showingWeb && web != null) {
            if (web.canGoBack()) {
                web.goBack()
            } else {
                finish()
            }
            return
        }
        super.onBackPressed()
    }

    // ------------------------------------------------------------------ Lifecycle helpers

    override fun onResume() {
        super.onResume()
        // (14/11/2026) GD7 / (18/11/2026) GD10 — quay lại app giữa lúc đăng nhập: chạy tiếp nhịp dò 1 s.
        if (showingWeb && loginFlowActive) startLoginTick()
    }

    /**
     * (18/11/2026) GD10 — ghi cookie xuống đĩa khi app bị đẩy xuống nền: `ingress_session` (và các cookie phiên)
     * phải còn cho lần mở app sau, nếu không "lần sau vào thẳng dashboard" sẽ lại phải dò/đăng nhập.
     */
    override fun onPause() {
        runCatching { CookieManager.getInstance().flush() }
        super.onPause()
    }

    override fun onDestroy() {
        searchToken++
        searching = false
        mainHandler.removeCallbacks(hideOverlayRunnable)
        stopLoginTick()
        pendingPermissionRequest?.let {
            it.deny()
            pendingPermissionRequest = null
        }
        disposeWebView()
        super.onDestroy()
    }

    // ------------------------------------------------------------------ Utilities

    private fun isGranted(permission: String): Boolean =
        checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED

    private fun post(body: () -> Unit) {
        mainHandler.post { if (!isFinishing && !isDestroyed) body() }
    }

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }
}

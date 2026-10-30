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

        /** (14/11/2026) GD7 — nhịp dò cookie phiên Home Assistant khi đang ở bước đăng nhập. */
        private const val COOKIE_POLL_MS = 1500L
    }

    private lateinit var prefs: SharedPreferences
    private val mainHandler = Handler(Looper.getMainLooper())

    private var webView: WebView? = null
    private var webInput: EditText? = null
    private var statusView: TextView? = null
    private var showingWeb = false
    private var pendingPermissionRequest: PermissionRequest? = null

    /** Thanh thông báo 40dp + câu chữ của nó (chỉ có ở màn WebView). */
    private var loginBar: View? = null
    private var loginBarText: TextView? = null

    /** Trang điều khiển đã lưu ([Prefs.KEY_WEB_URL]) — đích thật của WebView. */
    private var targetUrl: String? = null

    /** Origin của Home Assistant (`https://<domain>`), null khi webUrl không phải URL http(s). */
    private var haOrigin: String? = null

    /** Đang ở bước "đăng nhập HA": thanh thông báo hiện + dò cookie 1,5 s. */
    private var loginFlowActive = false

    /** URL sẽ mở sau khi đăng nhập xong (mặc định = [targetUrl]). */
    private var afterLoginUrl: String? = null

    /**
     * (14/11/2026) GD7 — số lần đã tự chuyển về origin vì 401. Chặn vòng lặp
     * origin → webUrl → 401 → origin → … (cookie không đủ): từ lần thứ 3 thì hiện màn hình
     * "Cần đăng nhập Home Assistant" để người dùng tự bấm Đăng nhập.
     */
    private var authRedirects = 0

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
     * (14/11/2026) GD7 — nhịp dò cookie 1,5 s trong lúc chờ người dùng đăng nhập Home Assistant.
     *
     * Không dùng `onPageFinished` để đoán "đã đăng nhập" vì trang 401 cũng bắn sự kiện đó; cookie là bằng chứng
     * duy nhất đáng tin (HA đặt `ingress_session` cho domain ngay khi đăng nhập thành công).
     */
    private val cookieWatchRunnable = object : Runnable {
        override fun run() {
            if (isFinishing || isDestroyed) return
            if (!showingWeb || !loginFlowActive) return
            if (hasHaCookie()) {
                onLoginDetected()
                return
            }
            mainHandler.postDelayed(this, COOKIE_POLL_MS)
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
     * Nếu [url] chính là trang điều khiển đã lưu (`webUrl`) mà lần dò trước trả 401 (`need_ha_login`) và WebView
     * chưa có cookie HA → KHÔNG mở thẳng (sẽ chỉ thấy "401: Unauthorized") mà vào bước đăng nhập Home Assistant.
     * Các URL khác (trang gọi `call-web.html?call=…`) vẫn mở ngay như trước.
     */
    private fun openWeb(url: String) {
        buildWebScreen()

        val target = targetUrl
        if (target != null && WebTargetResolver.sameUrl(url, target)) {
            afterLoginUrl = target
            if (hasHaCookie()) {
                Prefs.setNeedHaLogin(this, false)
            } else if (Prefs.needHaLogin(this)) {
                startLoginFlow(openOrigin = true)
                return
            }
        }
        webView?.loadUrl(url)
    }

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
        authRedirects = 0

        loginBar = findViewById(R.id.haLoginBar)
        loginBarText = findViewById(R.id.haLoginText)
        loginBarText?.text = getString(R.string.ha_login_banner)
        findViewById<Button>(R.id.haLoginDoneButton).setOnClickListener { onLoginConfirmed() }
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
        stopCookieWatch()
        loginFlowActive = false
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
     * (14/11/2026) GD7 — bước "đăng nhập Home Assistant": hiện thanh thông báo 40dp, (tuỳ chọn) mở origin của HA
     * (`https://<domain>/` — Lovelace tự hiện form đăng nhập) và bắt đầu dò cookie mỗi 1,5 s.
     *
     * openOrigin = false dùng khi phía trên đã có nội dung khác (màn "Cần đăng nhập Home Assistant").
     */
    private fun startLoginFlow(openOrigin: Boolean) {
        loginFlowActive = true
        Prefs.setNeedHaLogin(this, true)
        showLoginBar(true)
        startCookieWatch()

        val origin = haOrigin
        if (origin == null) {
            // webUrl không phải URL http(s) (vd apiBase LAN): không có trang đăng nhập để mở.
            showLoginRequiredPanel()
            return
        }
        if (openOrigin) webView?.loadUrl(loginPageUrl(origin))
    }

    /** `https://<domain>` → `https://<domain>/` (đúng origin của HA). */
    private fun loginPageUrl(origin: String): String = origin.trimEnd('/') + "/"

    /**
     * (14/11/2026) GD7 — đã có phiên HA: ẩn thanh thông báo, xoá cờ, chuyển sang [afterLoginUrl] (= `webUrl`).
     * Dùng chung cho nhịp dò cookie và nút "Tôi đã đăng nhập".
     */
    private fun finishLoginFlow() {
        stopCookieWatch()
        loginFlowActive = false
        authRedirects = 0
        Prefs.setNeedHaLogin(this, false)
        showLoginBar(false)
        // (17/11/2026) GD9 — đã có cookie phiên HA: API qua ingress mới dùng được. Đăng ký lại thiết bị + chạy
        // PhoneService NGAY (trước đây service poll 401 liên tục cho tới khi có người mở Cài đặt).
        if (Prefs.receiveEnabled(this)) PhoneService.start(this)
        registerInBackground()
        val next = afterLoginUrl ?: targetUrl
        if (next != null) {
            webView?.loadUrl(next)
        } else {
            showUrlScreen()
        }
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
     * (14/11/2026) GD7 — nút "Tôi đã đăng nhập": chuyển sang `webUrl` NGAY, không cần dò được cookie
     * (dự phòng khi trình duyệt nhúng không ghi cookie hoặc cookie nằm ở path khác).
     */
    private fun onLoginConfirmed() {
        runCatching { CookieManager.getInstance().flush() }
        toast(getString(R.string.ha_login_ok))
        finishLoginFlow()
    }

    /** Nhịp dò cookie phát hiện phiên HA → tự chuyển sang `webUrl`. */
    private fun onLoginDetected() {
        runCatching { CookieManager.getInstance().flush() }
        toast(getString(R.string.ha_login_ok))
        finishLoginFlow()
    }

    private fun startCookieWatch() {
        mainHandler.removeCallbacks(cookieWatchRunnable)
        mainHandler.postDelayed(cookieWatchRunnable, COOKIE_POLL_MS)
    }

    private fun stopCookieWatch() {
        mainHandler.removeCallbacks(cookieWatchRunnable)
    }

    /**
     * (14/11/2026) GD7 — WebView đã có phiên Home Assistant chưa?
     *
     * Dò `CookieManager.getInstance().getCookie(origin)` (và cả cookie của chính `webUrl`, vì một số bản HA đặt
     * cookie theo path ingress) tìm [WebTargetResolver.SESSION_COOKIE_NAMES] = `ingress_session` / `hassio_ingress`.
     */
    private fun hasHaCookie(): Boolean {
        val cm = CookieManager.getInstance()
        val urls = listOfNotNull(haOrigin, targetUrl).distinct()
        for (url in urls) {
            val header = try {
                cm.getCookie(url)
            } catch (t: Throwable) {
                null
            }
            if (WebTargetResolver.hasSessionCookie(header)) return true
        }
        return false
    }

    /**
     * (14/11/2026) GD7 — màn hình thay thế cho trang lỗi thô: "Cần đăng nhập Home Assistant" + nút **Đăng nhập**
     * (mở origin). Không bao giờ để người dùng thấy `401: Unauthorized`.
     */
    private fun showLoginRequiredPanel() {
        val web = webView ?: return
        val base = haOrigin?.let { loginPageUrl(it) }
        val href = base.orEmpty()
        val html = """
            <!doctype html>
            <html><head><meta charset="utf-8">
            <meta name="viewport" content="width=device-width,initial-scale=1">
            <style>
            body{margin:0;min-height:100vh;background:#0b1220;color:#e8eef7;font-family:sans-serif;
            display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;
            text-align:center;box-sizing:border-box}
            h1{font-size:20px;margin:0 0 10px}
            p{color:#9aa7bd;font-size:14px;line-height:1.45;margin:0 0 22px;max-width:520px}
            a{display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:14px 26px;
            border-radius:10px;font-size:16px;font-weight:bold}
            </style></head>
            <body>
            <h1>${getString(R.string.ha_login_required_title)}</h1>
            <p>${getString(R.string.ha_login_required_hint)}</p>
            <a href="$href">${getString(R.string.ha_login_button)}</a>
            </body></html>
        """.trimIndent()
        web.loadDataWithBaseURL(base, html, "text/html", "utf-8", null)
    }

    /**
     * (14/11/2026) GD7 — gặp 401/403 trên ingress:
     *  - nếu đúng là trang điều khiển đã lưu → quay về origin của HA để đăng nhập lại (kèm thanh thông báo),
     *  - ngược lại (trang gọi, URL ingress khác) → hiện màn "Cần đăng nhập Home Assistant" có nút Đăng nhập.
     * Cả hai trường hợp: đặt `need_ha_login = true` và bắt đầu dò cookie.
     */
    private fun onAuthRequired(url: String) {
        Prefs.setNeedHaLogin(this, true)
        afterLoginUrl = if (WebTargetResolver.sameUrl(url, targetUrl)) targetUrl else url

        val control = targetUrl
        if (control != null && WebTargetResolver.sameUrl(url, control) && haOrigin != null) {
            // Chống vòng lặp: đã tự chuyển về origin 2 lần mà vẫn 401 → cho người dùng tự đăng nhập.
            if (authRedirects >= 2) {
                showAuthPanel()
                return
            }
            authRedirects++
            startLoginFlow(openOrigin = true)
            return
        }
        showAuthPanel()
    }

    /** 401/403 không tự chuyển được: thanh thông báo + màn hình "Cần đăng nhập Home Assistant". */
    private fun showAuthPanel() {
        loginFlowActive = true
        showLoginBar(true)
        startCookieWatch()
        showLoginRequiredPanel()
    }

    // ------------------------------------------------------------------ WebView clients

    private inner class DashboardWebClient : WebViewClient() {

        override fun shouldOverrideUrlLoading(
            view: WebView?,
            request: WebResourceRequest?
        ): Boolean {
            val uri: Uri = request?.url ?: return false
            return when (uri.scheme?.lowercase()) {
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
        // (14/11/2026) GD7 — quay lại app giữa lúc đăng nhập: dò cookie tiếp.
        if (showingWeb && loginFlowActive) startCookieWatch()
    }

    override fun onDestroy() {
        searchToken++
        searching = false
        mainHandler.removeCallbacks(hideOverlayRunnable)
        stopCookieWatch()
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

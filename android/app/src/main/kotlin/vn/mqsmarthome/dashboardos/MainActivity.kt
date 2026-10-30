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
 *     và body KHÔNG phải SPA của Home Assistant (`<title>Home Assistant</title>`). 401 = add-on đúng nhưng WebView chưa
 *     có cookie HA → vẫn mở bình thường để người dùng đăng nhập HA.
 *  2. **"Máy chủ API (LAN)"** — mặc định giá trị đã lưu hoặc `192.168.10.2:18080`; kiểm tra `GET <base>/app/ping`
 *     phải trả `{"service":"dashboard-os"}` ([ServerResolver.probe]). Bỏ trống ô này = suy ra `http://<ip>:18080` từ ô 1
 *     khi ô 1 là IP LAN ([WebTargetResolver.apiBaseOrNull]).
 *
 * Lưu 2 giá trị RIÊNG: [Prefs.KEY_WEB_URL] cho WebView, [Prefs.KEY_API_BASE] cho PhoneService / register / incoming /
 * answer / decline. Không suy ra cái này từ cái kia khi đã có cả hai.
 *
 * Vẫn giữ nguyên: WebView full screen + WebRTC (micro/camera), tự đăng ký thiết bị, PhoneService nhận cuộc gọi khi
 * app đóng, chuông theo kênh thông báo, nút "URL" ở góc phải dưới để quay lại màn nhập.
 */
class MainActivity : Activity() {

    companion object {
        /** (10/11/2026) Mo WebView thang mot URL (vd call-web.html?call=<id> sau khi bam "Nghe"). */
        const val EXTRA_OPEN_URL = "open_url"

        private const val REQ_WEB_MEDIA = 1001
        private const val OVERLAY_VISIBLE_MS = 4000L

        /** Do dam luc nghi cua nut URL o goc phai duoi (van bam duoc, khong che noi dung). */
        private const val URL_BUTTON_ALPHA = 0.45f
    }

    private lateinit var prefs: SharedPreferences
    private val mainHandler = Handler(Looper.getMainLooper())

    private var webView: WebView? = null
    private var webInput: EditText? = null
    private var apiInput: EditText? = null
    private var statusView: TextView? = null
    private var showingWeb = false
    private var pendingPermissionRequest: PermissionRequest? = null

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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs.get(this)

        // (10/11/2026) GD2: nhan cuoc goi khi app dong — foreground service + poll 2 s (tat trong Cai dat).
        if (Prefs.receiveEnabled(this)) PhoneService.start(this)

        if (openFromIntent(intent)) return
        // (13/11/2026) GD6: đã có webUrl đã lưu -> vào thẳng WebView (trang có thể 401 = hãy đăng nhập HA).
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
        openWeb(url)
        intent.removeExtra(EXTRA_OPEN_URL)
        return true
    }

    // ------------------------------------------------------------------ mở lại cấu hình đã lưu

    /**
     * (13/11/2026) GD6 — lần sau mở app: có [Prefs.KEY_WEB_URL] thì mở WebView luôn.
     *
     * Cố ý KHÔNG chặn khi trang trả 401: 401 = add-on đúng nhưng WebView chưa đăng nhập Home Assistant, phải hiện
     * trang để người dùng đăng nhập (đăng nhập một lần, cookie được giữ cho các lần sau). API (LAN) do PhoneService
     * tự poll ở nền; hỏng thì Cài đặt hiện giá trị đang dùng để sửa.
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

        val web = findViewById<EditText>(R.id.webInput)
        webInput = web
        web.setText(Prefs.webInput(this) ?: "")
        web.setSelection(web.text.length)

        val api = findViewById<EditText>(R.id.apiInput)
        apiInput = api
        api.setText(Prefs.apiInput(this) ?: WebTargetResolver.DEFAULT_API_INPUT)
        api.setSelection(api.text.length)

        statusView = findViewById(R.id.urlStatus)
        setStatus(status ?: defaultStatus())

        findViewById<Button>(R.id.connectButton).setOnClickListener { connect() }
        // (10/11/2026) GD2: Cai dat nhan cuoc goi khi app dong + quyen thong bao / toi uu pin.
        findViewById<Button>(R.id.settingsButton).setOnClickListener {
            startActivity(Intent(this, SettingsActivity::class.java))
        }

        web.setOnEditorActionListener { _, actionId, _ -> connectOnAction(actionId) }
        api.setOnEditorActionListener { _, actionId, _ -> connectOnAction(actionId) }
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
        return getString(R.string.status_connected, web, api, Prefs.phoneName())
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
     */
    private fun connect() {
        if (searching) return
        val webText = webInput?.text?.toString()?.trim().orEmpty()
        val apiText = apiInput?.text?.toString()?.trim().orEmpty()
        Prefs.saveInputs(this, webText, apiText)

        val webList = WebTargetResolver.webCandidates(webText, Prefs.ingressToken(this))
        if (webList.isEmpty()) {
            val msg = if (webText.isEmpty()) getString(R.string.err_empty_web) else getString(R.string.err_bad_web)
            setStatus(msg)
            toast(msg)
            return
        }

        // apiBase: ưu tiên ô 2; ô 2 trống -> suy ra từ ô 1 nếu là IP LAN.
        val preferredApi = WebTargetResolver.apiBaseOrNull(webText, apiText)
        if (preferredApi == null) {
            val msg = if (apiText.isEmpty()) getString(R.string.err_api_underivable) else getString(R.string.err_bad_api)
            setStatus(msg)
            toast(msg)
            return
        }
        val apiList = if (apiText.isEmpty()) listOf(preferredApi) else WebTargetResolver.apiCandidates(apiText)

        val token = ++searchToken
        searching = true
        setSearchingUi(true)
        setStatus(getString(R.string.status_searching_web, 1, webList.size))

        Thread {
            // ── 1) trang điều khiển
            var foundWeb: String? = null
            val triedWeb = ArrayList<String>(webList.size)
            for ((index, url) in webList.withIndex()) {
                if (token != searchToken) return@Thread
                post { if (token == searchToken) setStatus(getString(R.string.status_searching_web, index + 1, webList.size)) }
                triedWeb.add(url)
                val check = WebTargetResolver.probeWeb(url)
                if (check != null && check.accepted) {
                    foundWeb = check.url
                    break
                }
            }
            val webUrl = foundWeb
            if (webUrl == null) {
                post {
                    if (token != searchToken) return@post
                    searching = false
                    setSearchingUi(false)
                    showNotFound(getString(R.string.status_web_not_found), triedWeb, getString(R.string.status_web_hint))
                }
                return@Thread
            }

            // ── 2) máy chủ API (LAN)
            var foundApi: String? = null
            val triedApi = ArrayList<String>(apiList.size)
            for ((index, base) in apiList.withIndex()) {
                if (token != searchToken) return@Thread
                post { if (token == searchToken) setStatus(getString(R.string.status_searching_api, index + 1, apiList.size)) }
                triedApi.add(base)
                val hit = ServerResolver.probe(base)
                if (hit != null) {
                    foundApi = hit.apiBase
                    break
                }
            }
            val apiBase = foundApi
            if (apiBase == null) {
                post {
                    if (token != searchToken) return@post
                    searching = false
                    setSearchingUi(false)
                    showNotFound(getString(R.string.status_api_not_found), triedApi, getString(R.string.status_api_hint))
                }
                return@Thread
            }

            // ── 3) lưu 2 giá trị RIÊNG, đăng ký, khởi động service, mở trang.
            Prefs.saveTargets(this, webUrl, apiBase, webText, apiText)
            val id = Prefs.phoneId(this)
            val registered = PhoneApi.register(apiBase, webUrl, id, Prefs.phoneName())
            if (Prefs.receiveEnabled(this)) PhoneService.start(this)

            post {
                if (token != searchToken) return@post
                searching = false
                setSearchingUi(false)
                toast(getString(if (registered) R.string.connect_ok else R.string.connect_ok_noreg))
                openWeb(webUrl)
            }
        }.also { it.isDaemon = true; it.name = "target-probe" }.start()
    }

    private fun setSearchingUi(busy: Boolean) {
        findViewById<Button>(R.id.connectButton)?.isEnabled = !busy
        webInput?.isEnabled = !busy
        apiInput?.isEnabled = !busy
    }

    /** Tiêu đề + danh sách đã thử + gợi ý. */
    private fun showNotFound(title: String, tried: List<String>, hint: String) {
        val sb = StringBuilder(title)
        for (url in tried) sb.append('\n').append("• ").append(url)
        sb.append("\n\n").append(hint)
        setStatus(sb.toString())
    }

    // ------------------------------------------------------------------ Web screen

    private fun openWeb(url: String) {
        showingWeb = true
        disposeWebView()
        statusView = null

        setContentView(R.layout.activity_web)

        val web = findViewById<WebView>(R.id.webView)
        webView = web
        configureWebView(web)
        web.loadUrl(url)

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
     *  - trang trả **401** được hiển thị BÌNH THƯỜNG (để người dùng đăng nhập HA), không chặn.
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
        val web = webView ?: return
        webView = null
        (web.parent as? ViewGroup)?.removeView(web)
        web.stopLoading()
        web.webChromeClient = null
        web.loadUrl("about:blank")
        web.destroy()
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
         * (13/11/2026) GD6 — 401/403 của trang là CHUYỆN BÌNH THƯỜNG: add-on đi qua ingress nên Home Assistant
         * yêu cầu đăng nhập. Không chặn, không báo lỗi — cứ để WebView hiện trang để người dùng đăng nhập HA
         * (sau đó tải lại là vào được launcher-config.html).
         */
        override fun onReceivedHttpError(
            view: WebView?,
            request: WebResourceRequest?,
            errorResponse: WebResourceResponse?
        ) {
            val code = errorResponse?.statusCode ?: return
            if (code == 401 || code == 403) return
            if (request?.isForMainFrame != true) return
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

    override fun onDestroy() {
        searchToken++
        searching = false
        mainHandler.removeCallbacks(hideOverlayRunnable)
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

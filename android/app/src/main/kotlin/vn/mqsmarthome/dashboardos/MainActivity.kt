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
 * A deliberately tiny single-activity app:
 *  - (30/10/2026 GD4) màn nhập CHỈ hỏi "Địa chỉ Home Assistant" (IP hoặc domain); bấm "Kết nối" thì
 *    [ServerResolver] tự dò add-on Dashboard OS, tự đăng ký thiết bị (/app/register), khởi động PhoneService
 *    rồi mở WebView tới `<apiBase>/call-web.html`,
 *  - a full screen WebView that remembers the server in SharedPreferences,
 *  - WebRTC microphone/camera support through WebChromeClient.onPermissionRequest,
 *  - (10/11/2026 GD2) PhoneService: nhận cuộc gọi từ màn hình P4 khi app đóng/nền (polling 2 s).
 *
 * Only framework (android.*) APIs are used, so the build stays dependency free.
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
    private var urlInput: EditText? = null
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
        // (30/10/2026) GD4: đã có gốc API từ lần trước -> ping lại 1 lần rồi vào thẳng WebView.
        autoConnectSaved()
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (!openFromIntent(intent)) return
    }

    /** Mo URL tu extra (trang cuoc goi). true = da xu ly. */
    private fun openFromIntent(intent: Intent?): Boolean {
        val raw = intent?.getStringExtra(EXTRA_OPEN_URL) ?: return false
        val url = raw.trim()
        if (!url.startsWith("http://") && !url.startsWith("https://")) return false
        openWeb(url)
        intent.removeExtra(EXTRA_OPEN_URL)
        return true
    }

    // ------------------------------------------------------------------ tự kết nối lại máy chủ đã lưu

    /**
     * (30/10/2026) GD4 — lần sau mở app: có [Prefs.KEY_API_BASE] thì ping lại 1 lần.
     * Thành công: vào thẳng WebView. Thất bại: ở lại màn nhập (giữ nguyên giá trị cũ) + báo lỗi.
     */
    private fun autoConnectSaved() {
        val base = Prefs.apiBase(this)
        val web = Prefs.webUrl(this)
        if (base == null || web == null) {
            showUrlScreen(prefill = Prefs.lastInput(this))
            return
        }
        showUrlScreen(prefill = Prefs.lastInput(this), status = getString(R.string.status_checking))
        val token = ++searchToken
        Thread {
            val hit = ServerResolver.probe(base)
            post {
                if (token != searchToken || showingWeb || isFinishing) return@post
                if (hit != null) {
                    Prefs.saveServer(this, hit.apiBase, hit.webUrl, Prefs.lastInput(this))
                    if (Prefs.receiveEnabled(this)) PhoneService.start(this)
                    openWeb(hit.webUrl)
                } else {
                    setStatus(getString(R.string.status_offline, base))
                }
            }
        }.also { it.isDaemon = true; it.name = "server-ping" }.start()
    }

    // ------------------------------------------------------------------ URL screen

    private fun showUrlScreen(prefill: String?, status: String? = null) {
        showingWeb = false
        disposeWebView()

        setContentView(R.layout.activity_url)

        val input = findViewById<EditText>(R.id.urlInput)
        urlInput = input
        input.setText(prefill ?: Prefs.lastInput(this) ?: "")
        input.setSelection(input.text.length)
        statusView = findViewById(R.id.urlStatus)
        setStatus(status ?: defaultStatus())

        findViewById<Button>(R.id.connectButton).setOnClickListener { connect() }
        // (10/11/2026) GD2: Cai dat nhan cuoc goi khi app dong + quyen thong bao / toi uu pin.
        findViewById<Button>(R.id.settingsButton).setOnClickListener {
            startActivity(Intent(this, SettingsActivity::class.java))
        }

        input.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_GO || actionId == EditorInfo.IME_ACTION_DONE) {
                connect()
                true
            } else {
                false
            }
        }
    }

    /** "Đã kết nối: <apiBase> · Điện thoại: <name>" (hoặc rỗng khi chưa kết nối lần nào). */
    private fun defaultStatus(): String {
        val base = Prefs.apiBase(this) ?: return ""
        return getString(R.string.status_connected, base, Prefs.phoneName())
    }

    private fun setStatus(text: String?) {
        statusView?.text = text.orEmpty()
        statusView?.visibility = if (text.isNullOrEmpty()) View.GONE else View.VISIBLE
    }

    /**
     * (30/10/2026) GD4 — "Kết nối": dò lần lượt các ứng viên từ [ServerResolver.candidates].
     * Tìm thấy -> lưu apiBase/webUrl, đăng ký thiết bị, khởi động PhoneService, mở WebView.
     * Không thấy -> hiện danh sách đã thử + gợi ý.
     */
    private fun connect() {
        if (searching) return
        val typed = urlInput?.text?.toString()?.trim().orEmpty()
        prefs.edit().putString(Prefs.KEY_URL, typed).apply()

        val list = ServerResolver.candidates(typed)
        if (list.isEmpty()) {
            val msg = if (typed.isEmpty()) getString(R.string.err_empty_url) else getString(R.string.err_bad_address)
            setStatus(msg)
            toast(msg)
            return
        }

        val token = ++searchToken
        searching = true
        setSearchingUi(true)
        setStatus(getString(R.string.status_searching, 1, list.size))

        Thread {
            var found: ServerResolver.Server? = null
            val tried = ArrayList<String>(list.size)
            for ((index, base) in list.withIndex()) {
                val n = index + 1
                if (token != searchToken) return@Thread
                post { if (token == searchToken) setStatus(getString(R.string.status_searching, n, list.size)) }
                tried.add(base)
                val hit = ServerResolver.probe(base)
                if (hit != null) {
                    found = hit
                    break
                }
            }

            val server = found
            if (server == null) {
                post {
                    if (token != searchToken) return@post
                    searching = false
                    setSearchingUi(false)
                    showNotFound(tried)
                }
                return@Thread
            }

            // Lưu trước (PhoneService đọc từ Prefs), rồi đăng ký, rồi khởi động service, rồi mở trang.
            Prefs.saveServer(this, server.apiBase, server.webUrl, typed)
            val id = Prefs.phoneId(this)
            val registered = PhoneApi.register(server.apiBase, server.webUrl, id, Prefs.phoneName())
            if (Prefs.receiveEnabled(this)) PhoneService.start(this)

            post {
                if (token != searchToken) return@post
                searching = false
                setSearchingUi(false)
                toast(getString(if (registered) R.string.connect_ok else R.string.connect_ok_noreg))
                openWeb(server.webUrl)
            }
        }.also { it.isDaemon = true; it.name = "server-probe" }.start()
    }

    private fun setSearchingUi(busy: Boolean) {
        findViewById<Button>(R.id.connectButton)?.isEnabled = !busy
        urlInput?.isEnabled = !busy
    }

    /** Danh sách đã thử + gợi ý kiểm tra. */
    private fun showNotFound(tried: List<String>) {
        val sb = StringBuilder(getString(R.string.status_not_found))
        for (url in tried) sb.append('\n').append("• ").append(url)
        sb.append("\n\n").append(getString(R.string.status_hint))
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
        changeUrlButton.setOnClickListener { showUrlScreen(prefill = Prefs.lastInput(this)) }
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

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView(web: WebView) {
        val settings: WebSettings = web.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
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

        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)

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

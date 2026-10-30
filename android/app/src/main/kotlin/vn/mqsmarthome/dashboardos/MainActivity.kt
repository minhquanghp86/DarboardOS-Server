package vn.mqsmarthome.dashboardos

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
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
import android.widget.Toast

/**
 * Phase 1 of Dashboard OS.
 *
 * A deliberately tiny single-activity app:
 *  - a URL entry screen (prefilled with the last used URL),
 *  - a full screen WebView that remembers the URL in SharedPreferences,
 *  - WebRTC microphone/camera support through WebChromeClient.onPermissionRequest,
 *  - sane hardware back handling (history -> goBack, otherwise exit).
 *
 * Only framework (android.*) APIs are used, so the build stays dependency free.
 */
class MainActivity : Activity() {

    private companion object {
        const val PREFS = "dashboard_os"
        const val KEY_URL = "url"

        const val DEFAULT_URL =
            "https://hass.mqsmarthome.io.vn/b39feb53_remote_webview_server/call-web.html"

        const val REQ_WEB_MEDIA = 1001
        const val OVERLAY_VISIBLE_MS = 4000L
    }

    private lateinit var prefs: SharedPreferences
    private val mainHandler = Handler(Looper.getMainLooper())

    private var webView: WebView? = null
    private var urlInput: EditText? = null
    private var showingWeb = false
    private var pendingPermissionRequest: PermissionRequest? = null

    private val hideOverlayRunnable = Runnable {
        val button: Button? = findViewById(R.id.changeUrlButton)
        button?.animate()?.alpha(0f)?.setDuration(300)?.withEndAction {
            button.visibility = View.GONE
        }?.start()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)

        val saved = normalizeUrl(prefs.getString(KEY_URL, null))
        if (saved != null) {
            openWeb(saved)
        } else {
            showUrlScreen(prefill = null)
        }
    }

    // ------------------------------------------------------------------ URL screen

    private fun showUrlScreen(prefill: String?) {
        showingWeb = false
        disposeWebView()

        setContentView(R.layout.activity_url)

        val input = findViewById<EditText>(R.id.urlInput)
        urlInput = input
        input.setText(prefill ?: prefs.getString(KEY_URL, null) ?: DEFAULT_URL)
        input.setSelection(input.text.length)

        findViewById<Button>(R.id.openButton).setOnClickListener { openFromInput() }

        input.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_GO || actionId == EditorInfo.IME_ACTION_DONE) {
                openFromInput()
                true
            } else {
                false
            }
        }
    }

    private fun openFromInput() {
        val url = normalizeUrl(urlInput?.text?.toString())
        if (url == null) {
            toast(getString(R.string.err_empty_url))
            return
        }
        openWeb(url)
    }

    // ------------------------------------------------------------------ Web screen

    private fun openWeb(url: String) {
        prefs.edit().putString(KEY_URL, url).apply()

        showingWeb = true
        disposeWebView()

        setContentView(R.layout.activity_web)

        val web = findViewById<WebView>(R.id.webView)
        webView = web
        configureWebView(web)
        web.loadUrl(url)

        val changeUrlButton = findViewById<Button>(R.id.changeUrlButton)
        changeUrlButton.setOnClickListener { showUrlScreen(prefill = prefs.getString(KEY_URL, null)) }
        changeUrlButton.alpha = 0.75f
        changeUrlButton.visibility = View.VISIBLE
        mainHandler.removeCallbacks(hideOverlayRunnable)
        mainHandler.postDelayed(hideOverlayRunnable, OVERLAY_VISIBLE_MS)
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

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }

    /**
     * Trims the input, adds a https:// scheme when missing and rejects anything
     * that is not a usable absolute http(s) URL.
     */
    private fun normalizeUrl(raw: String?): String? {
        var value = raw?.trim().orEmpty()
        if (value.isEmpty()) return null

        if (!value.startsWith("http://", ignoreCase = true) &&
            !value.startsWith("https://", ignoreCase = true)
        ) {
            value = "https://$value"
        }

        val uri = Uri.parse(value)
        val host = uri.host
        if (!uri.scheme.equals("http", true) && !uri.scheme.equals("https", true)) return null
        if (host.isNullOrEmpty()) return null
        return uri.toString()
    }
}

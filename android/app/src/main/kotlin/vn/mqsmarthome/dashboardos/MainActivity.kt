package vn.mqsmarthome.dashboardos

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.net.http.SslError
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.SslErrorHandler
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
 * (26/11/2026) GD14 — **MỞ THẲNG PANEL CỦA ADD-ON TRONG HOME ASSISTANT**.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────────────
 * BỐI CẢNH ĐÃ KIỂM CHỨNG (4 bản trước đều thất bại ở đây):
 *  - Add-on có ingress nên HA tạo một mục ở thanh bên với `url_path` = slug add-on. Mở
 *    `https://<domain>/b39feb53_remote_webview_server` trong trình duyệt **đã đăng nhập** thì CHÍNH HA FRONTEND
 *    tạo phiên ingress, dựng panel và nhúng add-on vào `<iframe src="…/api/hassio_ingress/<TOKEN>/…">`.
 *  - Vào THẲNG `/api/hassio_ingress/<TOKEN>/launcher-config.html` thì **luôn 401**: phiên ingress chỉ được cấp khi
 *    HA frontend mở panel. Mọi nỗ lực "tự tạo phiên" trong app (native POST, JS + WebSocket supervisor) đều không
 *    thay thế được việc đó — và cũng không cần nữa.
 *
 * ⇒ CÁCH LÀM ĐÚNG (bản này):
 *  1. Ô nhập chỉ còn **một ô domain** (`hass.example.com`). ĐÍCH của WebView là
 *     `https://<domain>/b39feb53_remote_webview_server` (panel), rồi
 *     `…/b39feb53_remote_webview_server/launcher-config.html`, rồi mới tới các ứng viên ingress cũ
 *     (`/api/hassio_ingress/<TOKEN>/…`, gốc domain, `http://<host>:18080/…`) làm **dự phòng**
 *     ([DashboardTarget.candidates]).
 *  2. **Nhận diện "đã vào đúng"** ([DashboardTarget.arrival]): trang có `<iframe … hassio_ingress>` **hoặc** URL
 *     bắt đầu bằng `https://<domain>/b39feb53_remote_webview_server` (và tiêu đề KHÔNG phải `<title>Home
 *     Assistant</title>` trần). SPA HA thuần (Lovelace, `/`, "Page not found") **không** phải thành công.
 *     Tiêu đề trần → kiểm tra lại bằng JS `document.querySelector('iframe[src*="hassio_ingress"]')` dò cả shadow
 *     DOM ([HaIngress.panelFrameScript]) trước khi kết luận.
 *  3. **Luồng đăng nhập**: chưa có phiên → mở `https://<domain>/` (HA tự chuyển sang `/auth/login`) → người dùng
 *     đăng nhập → nhịp dò **1 s** ([loginTick]) thấy URL đã rời `/auth/` (hoặc đã có cookie) thì **tự chuyển sang
 *     panel**. Nếu vẫn đứng ở Lovelace thì nhịp dò vẫn điều hướng sang panel — người dùng KHÔNG bị kẹt.
 *  4. **API native** (`/app/register`, `/app/incoming`, `/app/answer`, `/app/decline`, `/app/hangup`) đi qua ingress
 *     `https://<domain>/api/hassio_ingress/<TOKEN>` kèm cookie `ingress_session` — và chỉ chạy SAU KHI panel đã mở
 *     (chính panel tạo phiên). Chưa có cookie thì [PhoneService] **chờ**, thử lại mỗi 5 s, không bắn 401 liên tục.
 *  5. Log: `[nav] url=… ok=panel|ha-spa|login|401` (xem [DashboardTarget.navLine]) — xem trên máy thật bằng
 *     `adb logcat -s DashboardOS-login`.
 *
 * (27/11/2026) GD15 — **PROMOTE PANEL → TOP-LEVEL INGRESS** (thêm MỘT bước, phần còn lại giữ nguyên):
 *  - Lý do: panel của HA nhúng add-on trong `<iframe>` **không có** `allow="microphone; camera"` ⇒ Permissions Policy
 *    của khung cha chặn `getUserMedia` ⇒ **không gọi điện được** (quyền RECORD_AUDIO/CAMERA của app không cứu được).
 *  - Sau khi panel load xong **và** đã có cookie `ingress_session` ([hasPanelSession]), app tự chuyển sang **TOP-LEVEL**
 *    đúng trang của add-on `https://<domain>/api/hassio_ingress/<TOKEN>/launcher-config.html` ([IngressPromote]) ⇒
 *    không còn khung cha ⇒ micro/camera được cấp; phiên ingress đã có nên không 401.
 *  - Top-level trả 401/403, SPA của HA, hoặc quá 3 s ([IngressPromote.TOP_TIMEOUT_MS]) → **quay lại panel** (iframe)
 *    để người dùng vẫn dùng được UI: `[promote] url=… ok=401 fail=401 fallback=panel`.
 *  - Chỉ promote **một lần** cho mỗi lần mở app (`promoteAttempted`, cờ trong bộ nhớ); người dùng tự quay lại panel thì
 *    tôn trọng (`[promote] url=… ok=panel skip=already`).
 *  - Log: `[promote] url=… ok=top|panel|401` (cùng tag `DashboardOS-login`).
 *
 * Chế độ **IP LAN** (bản GD13) vẫn được giữ nhưng KHÔNG khuyến nghị: nó dựa vào chứng chỉ tự ký cổng 18443, không
 * có phiên HA nào để API native dùng. Giao diện đã ghi rõ điều này.
 *
 * Phần còn lại giữ nguyên: WebView full screen + WebRTC (micro/camera), tự đăng ký thiết bị, PhoneService nhận cuộc
 * gọi khi app đóng, chuông theo kênh thông báo, nút "URL" ở góc phải dưới để quay lại màn nhập.
 */
class MainActivity : Activity() {

    companion object {
        /** (10/11/2026) Mo WebView thang mot URL (vd call-web.html?call=<id> sau khi bam "Nghe"). */
        const val EXTRA_OPEN_URL = "open_url"

        /**
         * (14/11/2026) GD7 — mở WebView RỒI vào thẳng bước đăng nhập Home Assistant (thanh thông báo + dò),
         * dùng cho nút "Đăng nhập lại Home Assistant" ở Cài đặt (url kèm theo là origin của HA).
         */
        const val EXTRA_HA_LOGIN = "ha_login"

        private const val REQ_WEB_MEDIA = 1001
        private const val OVERLAY_VISIBLE_MS = 4000L

        /** Do dam luc nghi cua nut URL o goc phai duoi (van bam duoc, khong che noi dung). */
        private const val URL_BUTTON_ALPHA = 0.45f

        /**
         * (18/11/2026) GD10 — nhịp dò **mỗi 1 giây** trong lúc chờ đăng nhập HA / chờ panel mở.
         * Mỗi nhịp ghi một dòng `[nav] url=… ok=…` ra Logcat (tag [LOG_TAG_LOGIN]).
         */
        private const val LOGIN_POLL_MS = 1000L

        /**
         * (18/11/2026) GD10 — tag Logcat của luồng đăng nhập/điều hướng. Xem trên máy thật:
         * `adb logcat -s DashboardOS-login`.
         */
        const val LOG_TAG_LOGIN = "DashboardOS-login"

        /** (26/11/2026) GD14 — giãn cách tối thiểu giữa hai lần "điều hướng sang panel". */
        private const val PANEL_NAV_MIN_GAP_MS = 1200L

        /** (26/11/2026) GD14 — số lần tối đa tự điều hướng sang panel trong một luồng (chống lặp vô hạn). */
        private const val MAX_PANEL_NAV = 6

        /** (26/11/2026) GD14 — số lần kiểm tra iframe của panel + giãn cách (tiêu đề `<title>Home Assistant</title>`). */
        private const val PANEL_FRAME_TRIES = 3
        private const val PANEL_FRAME_RETRY_MS = 1000L

        /** (27/11/2026) GD15 — quá 3 s mà trang top-level chưa kết luận → quay lại panel. */
        private const val PROMOTE_TIMEOUT_MS = IngressPromote.TOP_TIMEOUT_MS

        /** (18/11/2026) GD10 — 2 "liên kết" của màn hình lỗi (bắt ở [DashboardWebClient.shouldOverrideUrlLoading]). */
        private const val RETRY_HREF = "dashboardos://retry"
        private const val LOGIN_HREF = "dashboardos://login"

        // ── lý do của lần nạp trang (ghi vào log `[login] saved=… loading=… result=…`).

        /** Ứng viên đầu tiên (panel của HA khi ở chế độ domain). */
        private const val LOAD_SAVED = "saved"

        /** Nút "Tôi đã đăng nhập" — nạp lại đích đã xác thực. */
        private const val LOAD_CONFIRMED = "confirmed"

        /** Nút "Mở Dashboard". */
        private const val LOAD_MANUAL = "manual"

        /** Ứng viên kế tiếp sau khi trang vừa nạp hoá ra là Home Assistant. */
        private const val LOAD_NEXT = "next"

        /** Nút "Thử lại". */
        private const val LOAD_RETRY = "retry"

        /** (26/11/2026) GD14 — nạp PANEL của add-on (`https://<domain>/b39feb53_remote_webview_server`). */
        private const val LOAD_PANEL = "panel"

        /**
         * (27/11/2026) GD15 — nạp **TOP-LEVEL** trang add-on sau ingress
         * (`https://<domain>/api/hassio_ingress/<TOKEN>/launcher-config.html`) để `getUserMedia` không bị
         * Permissions Policy của iframe HA chặn (xem [IngressPromote]).
         */
        private const val LOAD_PROMOTE = "promote"

        /**
         * Trang ĐĂNG NHẬP của Home Assistant (`https://<domain>/`) — nạp có chủ đích, nên `onPageFinished`
         * KHÔNG được coi đây là "sai trang" (người dùng còn đang gõ mật khẩu).
         */
        private const val LOAD_LOGIN_PAGE = "login-page"

        /** Trang khác (trang gọi `call-web.html?call=…`, liên kết ngoài…). */
        private const val LOAD_OTHER = "other"
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

    /** ĐÍCH hiện tại của WebView (panel của HA khi ở chế độ domain, `https://<ip>:18443/…` khi ở chế độ IP LAN). */
    private var targetUrl: String? = null

    /** `https://<domain>/b39feb53_remote_webview_server` — panel của add-on trên HA (null khi không có domain). */
    private var panelTarget: String? = null

    /** `webUrl` ĐANG LƯU trong [Prefs] (nguyên văn, kể cả khi hỏng — chỉ để so sánh/ghi log). */
    private var savedWebUrl: String? = null

    /** URL THẬT SỰ đang nạp vào WebView (hiện trên thanh thông báo + ghi log) — xem [loadWeb]. */
    private var loadingUrl: String? = null

    /** Lý do của lần nạp hiện tại ([LOAD_PANEL], [LOAD_LOGIN_PAGE]…). */
    private var loadingReason: String = "-"

    /** Kết quả lần nạp hiện tại: `pending` / `panel` / `ha-spa` / `login` / `401` / `404` / `net`. */
    private var loadResult: String = "-"

    /** Đã mở origin của HA (trang đăng nhập) trong luồng hiện tại chưa — chỉ mở TỐI ĐA MỘT lần. */
    private var originShown = false

    /** Origin của Home Assistant (`https://<domain>`), null khi không xác định được. */
    private var haOrigin: String? = null

    /**
     * (21/11/2026) GD13 — host được phép **chấp nhận chứng chỉ tự ký** (HTTPS 18443 của chính add-on). Lấy từ địa chỉ
     * người dùng đã nhập/đã lưu (`webUrl`, `loginUrl`, ô nhập, `apiBase`); host KHÁC vẫn bị chặn như mặc định.
     */
    private var allowedTlsHosts: Set<String> = emptySet()

    /** Đang trong luồng "chờ đăng nhập → mở panel": nhịp dò 1 s chạy. */
    private var loginFlowActive = false

    /** Tự dò thất bại hẳn → hiện thông báo + nút "Thử lại". */
    private var loginFailed = false

    /** Danh sách ứng viên dự phòng (ingress, gốc domain…) để thử khi panel không mở được. */
    private var loginWatch: HaLogin.Watch? = null

    /** Số lần đã tự điều hướng sang panel trong luồng hiện tại ([MAX_PANEL_NAV]). */
    private var panelNavCount = 0

    /** Lần cuối điều hướng sang panel ([PANEL_NAV_MIN_GAP_MS]). */
    private var lastPanelNavAt = 0L

    /** URL sẽ mở sau khi đăng nhập xong (mặc định = [targetUrl]). */
    private var afterLoginUrl: String? = null

    // ── (27/11/2026) GD15 — promote panel (iframe) → TOP-LEVEL ingress (xem [IngressPromote])

    /**
     * Đã **thử** promote trong lần mở app này chưa — cờ trong bộ nhớ, đúng yêu cầu "chỉ promote một lần".
     * Đặt `true` NGAY khi bắt đầu nạp trang top-level để dù thành công hay thất bại cũng không promote lại; người dùng
     * tự quay lại panel thì được tôn trọng. Chỉ reset khi người dùng bấm "Kết nối" lại ([connect]).
     */
    private var promoteAttempted = false

    /** Đang chờ kết luận của trang top-level (bật timeout 3 s, tắt khi có `onPageFinished`/lỗi). */
    private var promotePending = false

    /** URL top-level đang chờ kết luận (`…/api/hassio_ingress/<TOKEN>/launcher-config.html`). */
    private var promoteUrl: String? = null

    /** TOKEN lấy từ đâu: `frame` (đọc `src` iframe của panel) hay `prefs` (TOKEN đã lưu) — chỉ để ghi log. */
    private var promoteTokenSource: String = "-"

    /**
     * (27/11/2026) GD15 — hết [PROMOTE_TIMEOUT_MS] mà trang top-level không kết luận được (không `onPageFinished`,
     * không lỗi HTTP) → coi như `fail=timeout` và **quay lại panel** (iframe) để người dùng vẫn dùng được UI.
     */
    private val promoteTimeoutRunnable = Runnable {
        if (!promotePending) return@Runnable
        log("[promote] timeout sau ${PROMOTE_TIMEOUT_MS}ms chưa có onPageFinished")
        onPromoteFailed("timeout")
    }

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
     * (26/11/2026) GD14 — NHỊP DÒ 1 GIÂY của luồng "đăng nhập → panel":
     *  - URL đã là panel → để `onPageFinished` chốt (`ok=panel`);
     *  - URL ở `/auth/…` → chờ người dùng đăng nhập (`ok=login`), chỉ điều hướng khi đã có cookie;
     *  - URL cùng origin mà KHÔNG phải `/auth/` (Lovelace, trang chủ) → **điều hướng sang panel ngay** (yêu cầu:
     *    không để người dùng kẹt ở Lovelace).
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
            // (14/11/2026) GD7: "Đăng nhập lại Home Assistant" — mở trang đăng nhập + thanh thông báo + dò.
            afterLoginUrl = targetUrl ?: url
            if (haOrigin == null) haOrigin = DashboardTarget.originOf(url)
            panelTarget = DashboardTarget.panelUrl(haOrigin)
            originShown = false
            startLoginFlow(openOrigin = true)
            return true
        }
        // (26/11/2026) GD14 — URL trùng ĐÍCH đã cấu hình (panel của add-on) thì đi đúng luồng panel (chưa có phiên thì
        // đăng nhập trước rồi tự sang panel). URL khác (trang gọi `call-web.html?call=…`) mở thẳng như trước.
        val target = targetUrl
        if (target != null && WebTargetResolver.sameUrl(url, target)) {
            afterLoginUrl = target
            startLoginFlow(openOrigin = !hasPanelSession())
        } else {
            loadWeb(url, LOAD_OTHER)
        }
        return true
    }

    // ------------------------------------------------------------------ mở lại cấu hình đã lưu

    /**
     * Lần sau mở app: đã có [Prefs.KEY_WEB_URL] (panel của HA) thì mở WebView luôn — chưa có phiên thì
     * [startLoginFlow] đưa người dùng tới trang đăng nhập HA trước rồi tự sang panel.
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

    // ------------------------------------------------------------------ màn nhập 1 ô

    private fun showUrlScreen(status: String? = null) {
        showingWeb = false
        disposeWebView()

        setContentView(R.layout.activity_url)

        val web = findViewById<EditText>(R.id.webInput)
        webInput = web
        web.setText(Prefs.oneInput(this) ?: "")
        web.setSelection(web.text.length)

        statusView = findViewById<TextView>(R.id.urlStatus)
        setStatus(status ?: defaultStatus())

        findViewById<Button>(R.id.connectButton).setOnClickListener { connect() }
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
        val api = Prefs.apiBase(this) ?: "-"
        val base = getString(R.string.status_connected, web, api, Prefs.phoneName())
        val login = if (Prefs.needHaLogin(this)) "\n" + getString(R.string.status_need_login) else ""
        val insecure = if (WebTargetResolver.lacksSecureContext(web)) "\n" + getString(R.string.warn_no_secure, web) else ""
        return base + insecure + login
    }

    private fun setStatus(text: String?) {
        statusView?.text = text.orEmpty()
        statusView?.visibility = if (text.isNullOrEmpty()) View.GONE else View.VISIBLE
    }

    /**
     * "Kết nối":
     *  1. ô duy nhất → [WebTargetResolver.webCandidates] / [DashboardTarget.candidates]: **panel của HA là đích đầu
     *     tiên** ở chế độ domain (`https://<domain>/b39feb53_remote_webview_server`), sau đó mới tới
     *     `…/launcher-config.html` và các ứng viên ingress cũ (dự phòng). Ở chế độ IP LAN: `https://<ip>:18443`;
     *  2. ô đó cũng suy ra gốc API ([WebTargetResolver.apiBasesForInput]): domain → ingress + TOKEN (cần cookie
     *     `ingress_session` do chính panel tạo), IP LAN → `http://<ip>:18080`;
     *  3. lưu `webUrl` (panel) + `apiBase`, đăng ký thiết bị, khởi động PhoneService, mở WebView.
     */
    private fun connect() {
        if (searching) return
        val text = webInput?.text?.toString()?.trim().orEmpty()
        // (27/11/2026) GD15 — "Kết nối" = một lần mở app mới: cho phép promote lại (vẫn chỉ MỘT lần cho lần này).
        resetPromoteState()
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
        val apiList = WebTargetResolver.apiBasesForInput(text, token)
        if (apiList.isEmpty()) {
            val msg = getString(R.string.err_api_underivable)
            setStatus(msg)
            toast(msg)
            return
        }

        val addr = ServerResolver.parse(text)
        val lan = addr?.lan == true
        val origin = DashboardTarget.originOf(text)
        // (26/11/2026) GD14 — chế độ domain: ĐÍCH là panel của add-on trên HA (không cần dò nội dung, không cần
        // TOKEN: chính HA frontend dựng panel + tạo phiên ingress + nhúng add-on).
        val panel = if (lan) null else DashboardTarget.panelUrl(origin)

        val t = ++searchToken
        searching = true
        setSearchingUi(true)
        allowedTlsHosts = TlsPolicy.allowedHosts(text, Prefs.webUrl(this), Prefs.oneInput(this), Prefs.apiBase(this))
        val tlsHosts = allowedTlsHosts
        setStatus(getString(R.string.status_searching_api, 1, apiList.size))

        Thread {
            // ── gốc API: 200 = đúng add-on; 401/403 = đúng đường dẫn nhưng thiếu cookie `ingress_session`;
            //    404 = sai TOKEN ingress → thử ứng viên kế tiếp (ingress → slug → gốc domain → cổng 18080).
            var foundApi: String? = null
            var authApi: String? = null
            var anyReply = false
            val triedApi = ArrayList<String>(apiList.size)
            for ((index, base) in apiList.withIndex()) {
                if (t != searchToken) return@Thread
                post { if (t == searchToken) setStatus(getString(R.string.status_searching_api, index + 1, apiList.size)) }
                triedApi.add(base)
                val cookie = HaCookie.header(base)
                val code = ServerResolver.probeStatus(base, cookie, tlsHosts) ?: continue
                anyReply = true
                if (code == 200 && ServerResolver.probe(base, cookie, tlsHosts) != null) {
                    foundApi = base
                    break
                }
                if (authApi == null && WebTargetResolver.needsHaLogin(code)) authApi = base
            }
            // Chưa có cookie `ingress_session` (panel chưa mở lần nào) → dùng tạm ingress dựng từ TOKEN; PhoneService
            // sẽ CHỜ cookie rồi mới gọi (xem PhoneService) nên không có 401 nào bị bắn liên tục.
            val apiBase = foundApi ?: authApi ?: apiList.firstOrNull()
            if (apiBase == null) {
                post {
                    if (t != searchToken) return@post
                    searching = false
                    setSearchingUi(false)
                    showNotFound(getString(R.string.status_api_not_found), triedApi, getString(R.string.status_api_hint))
                }
                return@Thread
            }
            // ── đích của WebView.
            val webUrl: String? = if (panel != null) {
                panel
            } else {
                // IP LAN (KHÔNG khuyến nghị): thử https 18443 trước, rồi http://<ip>:18080 — như bản GD13.
                webList.firstOrNull { candidate ->
                    val check = WebTargetResolver.probeWeb(candidate, HaCookie.header(candidate), tlsHosts)
                    check != null && check.accepted
                } ?: webList.firstOrNull()
            }
            // (26/11/2026) GD14 — chế độ domain: không có gì trả lời ở /app/ping (thường do gõ sai domain) thì thử
            // đúng origin một lần; vẫn không tới được → báo rõ "không thấy" thay vì mở một trang lỗi trắng.
            if (panel != null && !anyReply && origin != null) {
                val reachable = WebTargetResolver.probeWeb(origin.trimEnd('/') + "/", null, tlsHosts) != null
                if (!reachable) {
                    post {
                        if (t != searchToken) return@post
                        searching = false
                        setSearchingUi(false)
                        showNotFound(getString(R.string.status_web_not_found), webList, getString(R.string.status_web_hint))
                    }
                    return@Thread
                }
            }
            if (webUrl == null) return@Thread

            // ── lưu, đăng ký thiết bị (kèm cookie nếu đã có phiên ingress), khởi động service, mở WebView.
            Prefs.saveTargets(this, webUrl, apiBase, text, "")
            Prefs.setLoginUrl(this, origin?.trimEnd('/')?.plus("/"))
            Prefs.setNeedHaLogin(this, false)
            val cookie = HaCookie.header(apiBase)
            if (WebTargetResolver.isIngressBase(apiBase) && !WebTargetResolver.hasSessionCookie(cookie)) {
                // Panel chưa mở lần nào ⇒ chưa có `ingress_session` ⇒ chưa gọi API (đăng ký sẽ làm sau khi panel mở).
                log("[api] base=${DashboardTarget.shortUrl(apiBase)} cookie=no → chờ panel mở (PhoneService chờ 5 s/nhịp)")
            } else {
                val id = Prefs.phoneId(this)
                val registeredId = PhoneApi.register(
                    apiBase, webUrl, id, Prefs.phoneName(), Prefs.deviceKey(this), Prefs.phoneModel(), cookie
                )
                if (registeredId != null && registeredId != id) Prefs.setPhoneId(this, registeredId)
            }
            if (Prefs.receiveEnabled(this)) PhoneService.start(this)

            post {
                if (t != searchToken) return@post
                searching = false
                setSearchingUi(false)
                if (TlsPolicy.isSelfSignedUrl(webUrl)) {
                    log(
                        "[tls] webUrl=${DashboardTarget.shortUrl(webUrl)} host=${TlsPolicy.hostOf(webUrl) ?: "-"} " +
                            "→ HTTPS tự ký của add-on (IP LAN, KHÔNG khuyến nghị)"
                    )
                }
                toast(getString(R.string.connect_ok))
                if (WebTargetResolver.lacksSecureContext(webUrl)) toast(getString(R.string.warn_no_secure, webUrl))
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
     * Mở WebView cho [url] (dùng chung cho: mở app, "Kết nối", mở trang gọi, đăng nhập lại).
     *
     * Nếu [url] chính là đích đã cấu hình (panel của HA) thì đi vào **luồng panel**: chưa có phiên
     * (`ingress_session`) → mở `https://<domain>/` để đăng nhập trước rồi tự sang panel; đã có phiên → mở panel
     * ngay. URL khác (trang gọi `call-web.html?call=…`) mở thẳng như trước.
     */
    private fun openWeb(url: String) {
        buildWebScreen()

        val saved = savedWebUrl
        val target = targetUrl
        val isTarget = target != null && (WebTargetResolver.sameUrl(url, target) ||
            (saved != null && WebTargetResolver.sameUrl(url, saved)))
        if (isTarget) {
            afterLoginUrl = target
            startLoginFlow(openOrigin = !hasPanelSession())
            return
        }
        loadWeb(url, LOAD_OTHER)
    }

    /** Cookie header của origin HA + trang đích (gộp cả hai path, xem [HaCookie.header]). */
    private fun currentCookieHeader(): String? =
        HaCookie.header(targetUrl) ?: haOrigin?.let { HaCookie.header(it) }

    /** Đã có cookie BẤT KỲ chưa (dấu hiệu "đã từng đăng nhập HA"). */
    private fun hasAnyCookie(): Boolean = HaLogin.hasAnyCookie(currentCookieHeader())

    /**
     * (26/11/2026) GD14 — đã có **phiên ingress** chưa (`ingress_session`, `Path=/api/hassio_ingress/`). Phiên này
     * chỉ tồn tại SAU KHI panel của add-on đã mở một lần (chính HA frontend tạo) — nên nó vừa là dấu hiệu "lần sau
     * mở app vào thẳng panel được", vừa là điều kiện để API native chạy.
     */
    private fun hasPanelSession(): Boolean {
        val direct = WebTargetResolver.hasSessionCookie(currentCookieHeader())
        if (direct) return true
        val origin = haOrigin ?: return false
        return WebTargetResolver.hasSessionCookie(HaCookie.header(origin + HaIngress.COOKIE_PATH))
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

        savedWebUrl = Prefs.webUrl(this)
        haOrigin = DashboardTarget.originOf(savedWebUrl)
            ?: DashboardTarget.originOf(Prefs.loginUrl(this))
            ?: DashboardTarget.originOf(Prefs.oneInput(this))
        panelTarget = DashboardTarget.panelUrl(haOrigin)
        allowedTlsHosts = TlsPolicy.allowedHosts(
            savedWebUrl,
            Prefs.loginUrl(this),
            Prefs.oneInput(this),
            Prefs.apiBase(this)
        )
        // (26/11/2026) GD14 — ĐÍCH: panel của add-on (`https://<domain>/b39feb53_remote_webview_server`) là ứng
        // viên ĐẦU TIÊN; chỉ khi không dựng được panel (IP LAN) mới dùng các ứng viên còn lại.
        targetUrl = DashboardTarget.candidates(
            saved = savedWebUrl,
            loginUrl = Prefs.loginUrl(this),
            typed = Prefs.oneInput(this),
            token = Prefs.ingressToken(this)
        ).firstOrNull()
        afterLoginUrl = targetUrl
        loginWatch = null
        loginFlowActive = false
        loginFailed = false
        panelNavCount = 0
        lastPanelNavAt = 0L
        originShown = false
        loadingUrl = null
        loadingReason = "-"
        loadResult = "-"

        if (savedWebUrl != null && !DashboardTarget.isValidSaved(savedWebUrl)) {
            // Dữ liệu cũ (bản trước / người dùng dán origin) — KHÔNG báo lỗi, chỉ dựng lại và ghi log.
            log(
                "[login] repair saved=${DashboardTarget.shortUrl(savedWebUrl)} " +
                    "loading=${DashboardTarget.shortUrl(targetUrl)} result=rebuild"
            )
        }
        log(
            "[nav] panel=${DashboardTarget.shortUrl(panelTarget)} target=${DashboardTarget.shortUrl(targetUrl)} " +
                "origin=${haOrigin ?: "-"} session=${yn(hasPanelSession())}"
        )

        loginBar = findViewById(R.id.haLoginBar)
        loginBarText = findViewById(R.id.haLoginText)
        loginBarText?.text = getString(R.string.ha_login_banner)
        findViewById<Button>(R.id.haLoginDoneButton).setOnClickListener { onLoginConfirmed() }
        findViewById<Button>(R.id.haDashboardButton).setOnClickListener { onOpenDashboardClicked() }
        findViewById<Button>(R.id.haRetryButton).setOnClickListener { onRetryClicked() }
        showLoginBar(false)

        val changeUrlButton = findViewById<Button>(R.id.changeUrlButton)
        changeUrlButton.setOnClickListener { showUrlScreen() }
        changeUrlButton.alpha = 0.75f
        changeUrlButton.visibility = View.VISIBLE
        mainHandler.removeCallbacks(hideOverlayRunnable)
        mainHandler.postDelayed({
            changeUrlButton.animate().alpha(URL_BUTTON_ALPHA).setDuration(400).start()
        }, OVERLAY_VISIBLE_MS)
    }

    /**
     * WebView cho trang HTTPS của add-on / panel của HA:
     *  - `domStorageEnabled` + cookie bật sẵn (localStorage `hassTokens` của HA, cookie `ingress_session`),
     *  - `mediaPlaybackRequiresUserGesture=false` + WebChromeClient cấp micro/camera (secure context https),
     *  - 401/403 không được hiện ra: xem [DashboardWebClient.onReceivedHttpError].
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

        // Cookie: HA dùng cookie cho phiên ingress (`ingress_session`) mà API native cần.
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
        // (27/11/2026) GD15 — bỏ timeout promote còn treo (WebView sắp bị huỷ nên không còn gì để kết luận).
        mainHandler.removeCallbacks(promoteTimeoutRunnable)
        promotePending = false
        stopLoginTick()
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

    // ------------------------------------------------------------------ luồng "đăng nhập Home Assistant → panel"

    private fun showLoginBar(shown: Boolean) {
        loginBar?.visibility = if (shown) View.VISIBLE else View.GONE
    }

    /**
     * Vào luồng "đăng nhập HA → panel của add-on":
     *
     *  - [openOrigin] = true → chưa có phiên: mở `https://<domain>/` (HA tự chuyển sang `/auth/login`), hiện thanh
     *    thông báo và bật nhịp dò 1 s; đăng nhập xong thì [loginTick] tự chuyển sang panel;
     *  - [openOrigin] = false → đã có phiên `ingress_session`: mở panel ngay
     *    (`https://<domain>/b39feb53_remote_webview_server`).
     */
    private fun startLoginFlow(openOrigin: Boolean) {
        // (21/11/2026) GD13 — CHẾ ĐỘ IP LAN (KHÔNG khuyến nghị): add-on tự phục vụ HTTPS (18443) nên KHÔNG có
        // ingress, KHÔNG cần phiên HA. Đẩy người dùng sang trang đăng nhập HA ở đây chính là vòng lặp "đăng nhập
        // xong vẫn đứng ở Lovelace" mà họ báo. Nên: bỏ hẳn nhánh đăng nhập, chỉ báo rõ + cho "Thử lại".
        if (isLanMode()) {
            log("[login] skip=ha_login (IP LAN: HTTPS tự ký của add-on, không cần đăng nhập HA)")
            Prefs.setNeedHaLogin(this, false)
            loginFlowActive = false
            showLoginBar(false)
            showLoginPanel(
                getString(R.string.lan_no_ha_title),
                getString(R.string.lan_no_ha_hint, DashboardTarget.shortUrl(targetUrl ?: savedWebUrl)),
                withRetry = true
            )
            return
        }
        loginFlowActive = true
        loginFailed = false
        resetLoginWatch()
        startLoginTick()

        val origin = haOrigin
        if (origin == null) {
            showLoginPanel(
                getString(R.string.ha_login_required_title),
                getString(R.string.ha_login_required_hint),
                withRetry = true
            )
            return
        }
        Prefs.setLoginUrl(this, loginPageUrl(origin))
        panelTarget = DashboardTarget.panelUrl(origin) ?: panelTarget
        val panel = panelTarget
        if (openOrigin && !originShown) {
            originShown = true
            Prefs.setNeedHaLogin(this, true)
            showLoginBar(true)
            loginBarText?.text = getString(R.string.ha_login_banner)
            log(DashboardTarget.navLine(loginPageUrl(origin), "login", "(bắt đầu luồng đăng nhập)"))
            loadWeb(loginPageUrl(origin), LOAD_LOGIN_PAGE)
            return
        }
        if (panel != null) {
            goPanel("start", force = true)
        } else {
            onLoginFailed(null)
        }
    }

    /** `https://<domain>` → `https://<domain>/` (đúng origin của HA). */
    private fun loginPageUrl(origin: String): String = origin.trimEnd('/') + "/"

    /** App đang ở **chế độ IP LAN** (địa chỉ đã cấu hình là IP riêng / localhost). */
    private fun isLanMode(): Boolean =
        TlsPolicy.isLanUrl(targetUrl) ||
            TlsPolicy.isLanUrl(savedWebUrl) ||
            TlsPolicy.isLanInput(Prefs.oneInput(this)) ||
            TlsPolicy.isLanUrl(Prefs.apiBase(this))

    // ── nạp trang + log

    /**
     * Nạp [url] vào WebView và GHI NHỚ nó là URL đang nạp ([loadingUrl]) + lý do ([loadingReason]) + kết quả
     * ([loadResult] = `pending`). Mọi lần nạp đều đi qua đây để log luôn có dòng `[login] saved=… loading=…` và
     * thanh thông báo hiện **đúng URL đang nạp**.
     */
    private fun loadWeb(url: String?, reason: String) {
        val u = url?.trim().orEmpty()
        if (u.isEmpty()) return
        loadingUrl = u
        loadingReason = reason
        loadResult = "pending"
        loginLog()
        showLoginDiag(webView?.url, !currentCookieHeader().isNullOrBlank())
        webView?.loadUrl(u)
    }

    /** `[login] saved=… loading=… result=… (lý do)` — một dòng cho mỗi lần nạp/kết luận. */
    private fun loginLog(extra: String? = null) {
        log(HaLogin.progressLine(savedWebUrl, loadingUrl, loadResult, extra ?: "($loadingReason)"))
    }

    /** (26/11/2026) GD14 — dòng log điều hướng chuẩn `[nav] url=… ok=…`. */
    private fun navLog(url: String?, ok: String, extra: String? = null) {
        log(DashboardTarget.navLine(url, ok, extra))
    }

    /**
     * Lần nạp hiện tại có NHẮM **đích của app** không (panel của HA / trang điều khiển add-on) — nên mới cần xác
     * thực "đây có phải add-on". Trang gọi (`call-web.html?call=…`) và liên kết ngoài thì không.
     */
    private fun isDashboardAttempt(): Boolean = when (loadingReason) {
        LOAD_SAVED, LOAD_CONFIRMED, LOAD_MANUAL, LOAD_NEXT, LOAD_RETRY, LOAD_PANEL -> true
        else -> false
    }

    /**
     * (26/11/2026) GD14 — ĐÃ VÀO ĐÚNG PANEL: chốt trạng thái.
     *  - log `[nav] url=… ok=panel`;
     *  - ẩn thanh thông báo, tắt nhịp dò;
     *  - lưu `webUrl` = URL panel (chỉ ghi giá trị đã xác thực — [DashboardTarget.isValidSaved]);
     *  - flush cookie (`ingress_session` do panel vừa tạo) rồi đăng ký thiết bị + chạy PhoneService: API native chỉ
     *    được gọi SAU bước này.
     */
    private fun onPanelLoaded(url: String?) {
        val u = url?.trim().orEmpty()
        if (u.isEmpty()) return
        loadResult = DashboardTarget.Arrival.ADDON.label
        navLog(u, "panel", "cookie=" + yn(!currentCookieHeader().isNullOrBlank()))
        stopLoginTick()
        loginFlowActive = false
        loginFailed = false
        panelNavCount = 0
        // Sau khi đã vào panel, các lần điều hướng tiếp theo là do NGƯỜI DÙNG (thanh bên của HA, trang con của
        // add-on) — không được coi là "lần nạp nhắm panel" nữa, nếu không app sẽ kéo người dùng về panel.
        loadingReason = LOAD_OTHER
        Prefs.setNeedHaLogin(this, false)
        showRetryButton(false)
        showLoginBar(false)
        afterLoginUrl = u
        targetUrl = u
        haOrigin = DashboardTarget.originOf(u) ?: haOrigin
        panelTarget = DashboardTarget.panelUrl(haOrigin) ?: panelTarget
        if (DashboardTarget.isValidSaved(u) && !WebTargetResolver.sameUrl(u, savedWebUrl)) {
            Prefs.setWebUrl(this, u)
            savedWebUrl = u
            log("[login] saved=${DashboardTarget.shortUrl(u)} (đã xác thực panel — lần sau vào thẳng)")
        }
        runCatching { CookieManager.getInstance().flush() }
        // Panel vừa mở ⇒ `ingress_session` đã có ⇒ API native (register/incoming/…) chạy được.
        registerInBackground()
        if (Prefs.receiveEnabled(this)) PhoneService.start(this)
        // (27/11/2026) GD15 — BƯỚC THÊM: panel (iframe) đã mở xong và đã có phiên ingress ⇒ chuyển sang TOP-LEVEL
        // để `getUserMedia` không bị Permissions Policy của iframe HA chặn (xem [IngressPromote]).
        maybePromotePanel(u)
    }

    // ------------------------------------------------------------------ (27/11/2026) GD15 — promote panel → top-level

    /** Quên trạng thái promote (dùng khi người dùng bấm "Kết nối" — một "lần mở app" mới). */
    private fun resetPromoteState() {
        mainHandler.removeCallbacks(promoteTimeoutRunnable)
        promoteAttempted = false
        promotePending = false
        promoteUrl = null
        promoteTokenSource = "-"
    }

    /**
     * (27/11/2026) GD15 — quyết định có **promote panel (iframe) → TOP-LEVEL ingress** hay không.
     *
     * Điều kiện "đã có phiên, được phép promote" (đúng thứ tự kiểm tra của [IngressPromote.decide]):
     *  1. `promoteAttempted == false` — chưa thử trong lần mở app này (chỉ MỘT lần, không lặp vô hạn);
     *  2. dựng được URL top-level `https://<domain>/api/hassio_ingress/<TOKEN>/launcher-config.html`
     *     ([IngressPromote.topUrl], origin lấy từ URL panel/ `haOrigin`);
     *  3. **[hasPanelSession] == true** — đã có cookie `ingress_session` (`WebTargetResolver.hasSessionCookie`, dò cả
     *     `CookieManager.getCookie(origin)` và `getCookie(origin + "/api/hassio_ingress/")`). Chưa có thì promote chỉ
     *     nhận 401 vô ích → chờ (tối đa [IngressPromote.COOKIE_TRIES] lần × [IngressPromote.COOKIE_RETRY_MS]).
     *
     * TOKEN ưu tiên đọc từ **`src` của iframe ingress** mà HA vừa dựng ([HaIngress.panelFrameSrcScript] +
     * [HaIngress.readFrameSrc] + [IngressPromote.tokenFromUrl]) — đó là TOKEN Supervisor vừa cấp; không đọc được thì
     * dùng TOKEN đã lưu ([Prefs.ingressToken]).
     */
    private fun maybePromotePanel(panel: String?, attempt: Int = 1) {
        if (isFinishing || isDestroyed) return
        if (isLanMode()) {
            log(IngressPromote.skipLine(null, IngressPromote.Decision.NO_URL, "lan=yes"))
            return
        }
        val origin = DashboardTarget.originOf(panel) ?: haOrigin
        val preview = IngressPromote.topUrl(origin, Prefs.ingressToken(this))
        val session = hasPanelSession()
        val decision = IngressPromote.decide(session, promoteAttempted, preview)
        when (decision) {
            IngressPromote.Decision.PROMOTE -> beginPromote(origin, panel)
            IngressPromote.Decision.NO_SESSION -> {
                // HA vừa dựng panel nên cookie `ingress_session` có thể chưa đọc lại được ngay — thử lại vài lần,
                // nhưng KHÔNG promote khi vẫn chưa có phiên (sẽ 401 vô ích).
                if (attempt < IngressPromote.COOKIE_TRIES) {
                    mainHandler.postDelayed({
                        if (isFinishing || isDestroyed) return@postDelayed
                        if (promoteAttempted) return@postDelayed
                        if (!DashboardTarget.isPanel(webView?.url)) return@postDelayed
                        maybePromotePanel(panel, attempt + 1)
                    }, IngressPromote.COOKIE_RETRY_MS)
                    return
                }
                log(IngressPromote.skipLine(preview, decision, "try=$attempt"))
            }

            else -> log(IngressPromote.skipLine(preview, decision))
        }
    }

    /** Đọc `src` iframe ingress rồi bắt đầu promote (hoặc dùng TOKEN đã lưu khi không đọc được). */
    private fun beginPromote(origin: String?, panel: String?) {
        val web = webView
        if (web == null) {
            startPromote(origin, null)
            return
        }
        try {
            web.evaluateJavascript(HaIngress.panelFrameSrcScript()) { raw ->
                if (isFinishing || isDestroyed) return@evaluateJavascript
                startPromote(origin ?: DashboardTarget.originOf(panel), HaIngress.readFrameSrc(raw))
            }
        } catch (t: Throwable) {
            startPromote(origin, null)
        }
    }

    /**
     * Nạp **TOP-LEVEL** `https://<domain>/api/hassio_ingress/<TOKEN>/launcher-config.html` + bật timeout 3 s.
     * [frameSrc] = `src` của iframe trong panel (nguồn TOKEN chính xác nhất); null = dùng TOKEN đã lưu.
     */
    private fun startPromote(origin: String?, frameSrc: String?) {
        if (promoteAttempted || isFinishing || isDestroyed) return
        // Người dùng đã rời màn WebView (bấm "URL" / Cài đặt) trong lúc đọc iframe → không promote nữa.
        if (!showingWeb || webView == null) return
        val frameToken = IngressPromote.tokenFromUrl(frameSrc)
        val top = IngressPromote.topUrl(origin, frameToken ?: Prefs.ingressToken(this))
        if (top == null) {
            log(IngressPromote.skipLine(null, IngressPromote.Decision.NO_URL))
            return
        }
        promoteAttempted = true
        promotePending = true
        promoteUrl = top
        promoteTokenSource = if (frameToken != null) "frame" else "prefs"
        log(IngressPromote.startLine(top, promoteTokenSource))
        mainHandler.removeCallbacks(promoteTimeoutRunnable)
        mainHandler.postDelayed(promoteTimeoutRunnable, PROMOTE_TIMEOUT_MS)
        runCatching { CookieManager.getInstance().flush() }
        loadWeb(top, LOAD_PROMOTE)
    }

    /** Lần nạp hiện tại có phải chính trang top-level đang chờ kết luận không. */
    private fun isPromoteNavigation(url: String?): Boolean =
        promotePending && WebTargetResolver.sameUrl(url, promoteUrl)

    /**
     * Trang top-level đã nạp xong: dùng được ⇒ `[promote] url=… ok=top`, chốt phiên và để API native chạy với base
     * ingress + cookie; là SPA của HA ⇒ coi như thất bại (`fail=ha-spa`) và quay lại panel.
     */
    private fun onPromoteLoaded(url: String?, status: Int?, title: String?) {
        if (!promotePending) return
        mainHandler.removeCallbacks(promoteTimeoutRunnable)
        promotePending = false
        val top = promoteUrl ?: url
        if (IngressPromote.verdict(status, title) != IngressPromote.Verdict.TOP) {
            onPromoteFailed(IngressPromote.failReason(status, title))
            return
        }
        log(IngressPromote.logLine(top, IngressPromote.OK_TOP, "title=" + (title ?: "-")))
        // Đang ở top-level ingress: các lần điều hướng tiếp theo là của người dùng (trang con của add-on) — không
        // còn là "lần nạp nhắm panel" nữa.
        loadingReason = LOAD_OTHER
        loadResult = IngressPromote.OK_TOP
        loginFlowActive = false
        loginFailed = false
        stopLoginTick()
        showLoginBar(false)
        // (4) API native dùng đúng base ingress + cookie `ingress_session` đã có ⇒ PhoneService chạy bình thường.
        ensureIngressApiBase(top)
        runCatching { CookieManager.getInstance().flush() }
        registerInBackground()
        if (Prefs.receiveEnabled(this)) PhoneService.start(this)
    }

    /**
     * Promote thất bại (401/403, SPA HA, redirect, timeout, mất mạng): ghi
     * `[promote] url=… ok=401 fail=<lý do> fallback=panel` rồi **quay lại panel (iframe)** để người dùng vẫn dùng được
     * UI. Cờ [promoteAttempted] đã bật nên KHÔNG promote lại (không lặp vô hạn; người dùng tự quay lại panel thì tôn
     * trọng).
     */
    private fun onPromoteFailed(reason: String) {
        if (!promoteAttempted) return
        mainHandler.removeCallbacks(promoteTimeoutRunnable)
        promotePending = false
        val top = promoteUrl
        log(IngressPromote.failLine(top, reason))
        loadResult = IngressPromote.OK_FAIL
        val panel = panelTarget ?: DashboardTarget.panelUrl(haOrigin)
        if (panel == null) {
            // Không có panel để quay lại (dữ liệu cũ) → để nguyên những gì đang có + nhịp dò tiếp tục.
            loginBarText?.text = getString(R.string.ha_panel_banner)
            return
        }
        // QUAY LẠI PANEL: nạp lại đúng panel của HA (iframe) — người dùng vẫn vào được UI như trước bản này.
        loadWeb(panel, LOAD_PANEL)
    }

    /**
     * Base API native phải là `https://<domain>/api/hassio_ingress/<TOKEN>` khi đang ở top-level ingress — đúng base
     * đã dùng cho panel; nếu `Prefs` đang giữ base khác (dữ liệu cũ: URL đầy đủ, cổng LAN…) thì chuyển về ingress.
     */
    private fun ensureIngressApiBase(topUrl: String?) {
        val base = IngressPromote.apiBase(topUrl) ?: return
        val current = Prefs.apiBase(this)
        if (WebTargetResolver.sameUrl(current, base)) return
        Prefs.setApiBase(this, base)
        log("[api] base=${DashboardTarget.shortUrl(base)} (promote → top-level ingress)")
    }

    /**
     * (26/11/2026) GD14 — trang vừa nạp KHÔNG phải panel (SPA HA, trang lỗi…): **không im lặng** — ghi
     * `[nav] url=… ok=ha-spa|login|401`, hiện thông báo và thử **ứng viên kế tiếp** ([HaLogin.Watch] skip).
     */
    private fun onWrongPage(url: String?, arrival: DashboardTarget.Arrival, label: String? = null) {
        if (!isDashboardAttempt()) return
        if (loadingReason == LOAD_LOGIN_PAGE) return      // người dùng còn đang gõ mật khẩu
        val reason = label ?: arrival.label
        loadResult = reason
        navLog(url ?: loadingUrl, reason)
        loginLog()
        loginFailed = false
        showLoginBar(true)
        showRetryButton(false)
        if (!loginFlowActive) {
            loginFlowActive = true
            startLoginTick()
        }
        if (loginWatch == null) resetLoginWatch()
        val shown = DashboardTarget.shortUrl(url ?: loadingUrl)
        val message = getString(R.string.ha_login_not_addon, reason, shown)
        loginBarText?.text = message
        val step = loginWatch?.skip() ?: HaLogin.Step(HaLogin.Action.GIVE_UP, null)
        if (step.action == HaLogin.Action.NEXT_VARIANT) {
            val next = step.url
            if (next == null) {
                onLoginFailed(null)
                return
            }
            loginBarText?.text = message + "\n" + getString(R.string.ha_login_try_next, DashboardTarget.shortUrl(next))
            loadWeb(next, LOAD_NEXT)
            return
        }
        onLoginFailed(null)
    }

    // ── nhịp dò 1 s

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

    /** Quên trạng thái của luồng trước (biến thể URL, số lần điều hướng…) — dùng mỗi lần vào/ vào lại luồng. */
    private fun resetLoginWatch() {
        loginWatch = HaLogin.Watch(
            webUrl = savedWebUrl ?: targetUrl ?: afterLoginUrl,
            token = Prefs.ingressToken(this),
            fallbackInput = Prefs.oneInput(this)
        )
        panelNavCount = 0
        lastPanelNavAt = 0L
        originShown = false
        loginFailed = false
        showRetryButton(false)
        log(
            "[login] start saved=${DashboardTarget.shortUrl(savedWebUrl)} panel=${DashboardTarget.shortUrl(panelTarget)} " +
                "variants=${loginWatch?.variants?.size ?: 0} cookie=${yn(hasAnyCookie())} session=${yn(hasPanelSession())}"
        )
    }

    /**
     * (26/11/2026) GD14 — MỘT nhịp dò (mỗi 1 s) của luồng "đăng nhập → panel":
     *
     *  1. ghi `[nav] url=… ok=panel|ha-spa|login` (kèm `[login] …` chi tiết) ra Logcat + thanh thông báo;
     *  2. URL là **panel** → để `onPageFinished` chốt (`ok=panel`);
     *  3. URL ở `/auth/…` → chờ người dùng đăng nhập (`ok=login`); chỉ điều hướng khi đã có cookie;
     *  4. URL **cùng origin mà không phải `/auth/`** (Lovelace, `/`, `/lovelace/0`…) → `ok=ha-spa` rồi **điều hướng
     *     sang panel ngay** — đúng yêu cầu "không để người dùng kẹt ở Lovelace".
     */
    private fun loginTick() {
        if (isFinishing || isDestroyed) return
        // (27/11/2026) GD15 — đang chờ kết luận của trang TOP-LEVEL (promote): nhịp dò không được kéo WebView về panel.
        if (promotePending) return
        val url = webView?.url
        val cookiePresent = !currentCookieHeader().isNullOrBlank()
        val auth = DashboardTarget.isAuthPage(url)
        val sameOrigin = HaLogin.isSameOrigin(url, haOrigin)
        val cookieInfo = "cookie=" + yn(cookiePresent) + " session=" + yn(hasPanelSession())

        when {
            url != null && DashboardTarget.isPanel(url) -> {
                // Panel đang mở/nạp: onPageFinished (hoặc bước kiểm tra iframe) sẽ chốt kết quả.
                navLog(url, "panel", cookieInfo)
                showLoginDiag(url, cookiePresent)
                return
            }

            auth -> {
                navLog(url, "login", cookieInfo)
                showLoginDiag(url, cookiePresent)
                Prefs.setNeedHaLogin(this, true)
                showLoginBar(true)
                // Đã có cookie (HA vừa đặt sau khi đăng nhập) mà vẫn đứng ở /auth → sang panel.
                if (cookiePresent) goPanel("login_cookie")
                return
            }

            sameOrigin -> {
                navLog(url, "ha-spa", cookieInfo)
                showLoginDiag(url, cookiePresent)
                // Rời /auth (hoặc đang ở Lovelace) → LUÔN điều hướng sang panel path.
                goPanel(if (cookiePresent) "cookie" else "left_auth")
                return
            }

            else -> {
                if (url == null) return
                if (url.startsWith("about:", ignoreCase = true) || url.startsWith("data:", ignoreCase = true)) return
                navLog(url, "other", cookieInfo)
                if (cookiePresent) goPanel("off_origin")
            }
        }
    }

    /**
     * Điều hướng sang **panel của add-on** (`https://<domain>/b39feb53_remote_webview_server`), có giới hạn:
     * giãn cách [PANEL_NAV_MIN_GAP_MS], tối đa [MAX_PANEL_NAV] lần cho mỗi luồng (chống lặp vô hạn khi HA không có
     * panel đó ⇒ hết lượt thì hiện thông báo + nút "Thử lại").
     */
    private fun goPanel(reason: String, force: Boolean = false) {
        val panel = panelTarget ?: DashboardTarget.panelUrl(haOrigin)
        if (panel == null) {
            onLoginFailed(null)
            return
        }
        if (force) {
            panelNavCount = 0
            lastPanelNavAt = 0L
        }
        if (panelNavCount >= MAX_PANEL_NAV) {
            log(DashboardTarget.navLine(panel, "ha-spa", "panel_nav_limit=$panelNavCount reason=$reason"))
            showLoginBar(true)
            showRetryButton(true)
            loginBarText?.text = getString(R.string.ha_panel_retry_hint, DashboardTarget.shortUrl(panel))
            return
        }
        val now = System.currentTimeMillis()
        if (now - lastPanelNavAt < PANEL_NAV_MIN_GAP_MS) return
        if (!force && WebTargetResolver.sameUrl(webView?.url, panel)) return
        panelNavCount++
        lastPanelNavAt = now
        log("[login] panel_nav=$panelNavCount reason=$reason panel=${DashboardTarget.shortUrl(panel)}")
        loadWeb(panel, LOAD_PANEL)
    }

    /**
     * Kiểm tra **iframe ingress** trong panel bằng JS (dò cả shadow DOM — HA dựng panel trong `ha-panel-*`).
     * Dùng khi URL là panel nhưng tiêu đề vẫn là `<title>Home Assistant</title>` trần (frontend chưa dựng xong
     * panel): thử tối đa [PANEL_FRAME_TRIES] lần, mỗi lần cách [PANEL_FRAME_RETRY_MS]; thấy iframe → chốt panel,
     * không thấy → coi như SPA HA thuần và thử ứng viên kế tiếp ([onWrongPage]).
     */
    private fun verifyPanelFrame(url: String?, attempt: Int = 1) {
        if (!isDashboardAttempt() || !loginFlowActive) return
        val web = webView ?: return
        try {
            web.evaluateJavascript(HaIngress.panelFrameScript()) { raw ->
                val has = HaIngress.isFrameResult(raw)
                log(
                    DashboardTarget.navLine(
                        url,
                        if (has) "panel" else "ha-spa",
                        "frame=" + yn(has) + " try=$attempt"
                    )
                )
                if (has) {
                    onPanelLoaded(url ?: web.url)
                    return@evaluateJavascript
                }
                if (attempt < PANEL_FRAME_TRIES && loginFlowActive) {
                    mainHandler.postDelayed({
                        if (!isFinishing && !isDestroyed) verifyPanelFrame(url, attempt + 1)
                    }, PANEL_FRAME_RETRY_MS)
                } else if (loginFlowActive) {
                    onWrongPage(url, DashboardTarget.Arrival.HOME_ASSISTANT, "ha-spa")
                }
            }
        } catch (t: Throwable) {
            onWrongPage(url, DashboardTarget.Arrival.HOME_ASSISTANT, "ha-spa")
        }
    }

    /**
     * Dòng chẩn đoán trên thanh thông báo (đúng dòng vừa ghi ra Logcat) + **URL đang thực sự nạp**
     * (rút gọn bằng [DashboardTarget.shortUrl]).
     */
    private fun showLoginDiag(url: String?, cookiePresent: Boolean) {
        if (loginFailed) return
        val base = if (DashboardTarget.isAuthPage(url)) {
            getString(R.string.ha_panel_login_hint)
        } else {
            getString(R.string.ha_panel_banner)
        }
        val shown = DashboardTarget.shortUrl(loadingUrl ?: targetUrl ?: savedWebUrl)
        loginBarText?.text = base +
            "\n" + getString(R.string.ha_login_loading_url, shown, loadResult) +
            "\n" + HaLogin.pollLogLine(url, cookiePresent, null)
    }

    /**
     * Tự dò thất bại (hết ứng viên mà vẫn không mở được panel): **KHÔNG im lặng** — hiện thông báo rõ ràng + nút
     * **Thử lại** trên thanh thông báo và một màn hình có 2 lối thoát (Thử lại / Đăng nhập Home Assistant).
     */
    private fun onLoginFailed(status: Int?) {
        loginFailed = true
        stopLoginTick()
        showLoginBar(true)
        showRetryButton(true)
        val code = status?.toString() ?: "-"
        loadResult = if (loadResult == "pending") code else loadResult
        navLog(loadingUrl ?: targetUrl, if (code == "-") "ha-spa" else code)
        loginLog()
        loginBarText?.text = getString(R.string.ha_login_failed_banner, code) +
            "\n" + getString(R.string.ha_login_loading_url, DashboardTarget.shortUrl(loadingUrl), loadResult) +
            "\n" + getString(R.string.ha_manual_steps)
        toast(getString(R.string.ha_login_failed_banner, code))
        log("[login] give_up web=$code loading=${DashboardTarget.shortUrl(loadingUrl)}")
        if (HaLogin.isAuthPage(webView?.url)) return
        val tried = loginWatch?.variants?.joinToString("\n") { "• $it" }.orEmpty()
        showLoginPanel(
            getString(R.string.ha_login_failed_title),
            getString(R.string.ha_login_failed_hint, code, tried) + "\n\n" + getString(R.string.ha_manual_steps),
            withRetry = true
        )
    }

    /** Nút **"Thử lại"**: dò LẠI TỪ ĐẦU (biến thể 1, số lần điều hướng về 0) — không phải thoát app rồi mở lại. */
    private fun onRetryClicked() {
        loginFlowActive = true
        loginFailed = false
        showLoginBar(true)
        showRetryButton(false)
        resetLoginWatch()
        startLoginTick()
        runCatching { CookieManager.getInstance().flush() }
        if (panelTarget == null) panelTarget = DashboardTarget.panelUrl(haOrigin)
        if (panelTarget != null) {
            goPanel("retry", force = true)
            return
        }
        val url = loginWatch?.current
        if (url == null) {
            toast(getString(R.string.st_ha_login_no_web))
            return
        }
        loadWeb(url, LOAD_RETRY)
    }

    /**
     * Nút **"Mở Dashboard"** (LUÔN hiện ở màn đăng nhập): người dùng chủ động, không chờ nhịp dò —
     * điều hướng NGAY sang panel của add-on (`https://<domain>/b39feb53_remote_webview_server`).
     */
    private fun onOpenDashboardClicked() {
        if (loginWatch == null || loginFailed) resetLoginWatch()
        loginFlowActive = true
        loginFailed = false
        showLoginBar(true)
        showRetryButton(false)
        startLoginTick()
        runCatching { CookieManager.getInstance().flush() }
        if (panelTarget == null) panelTarget = DashboardTarget.panelUrl(haOrigin)
        if (panelTarget != null) {
            log("[login] manual=open_dashboard → panel của add-on")
            goPanel("manual", force = true)
            return
        }
        val url = loginWatch?.current
            ?: DashboardTarget.candidates(
                saved = Prefs.webUrl(this),
                loginUrl = Prefs.loginUrl(this),
                typed = Prefs.oneInput(this),
                token = Prefs.ingressToken(this)
            ).firstOrNull()
        if (url == null) {
            toast(getString(R.string.st_ha_login_no_web))
            return
        }
        loadWeb(url, LOAD_MANUAL)
    }

    private fun showRetryButton(shown: Boolean) {
        findViewById<Button>(R.id.haRetryButton)?.visibility = if (shown) View.VISIBLE else View.GONE
    }

    /**
     * Nút **"Tôi đã đăng nhập"**: nạp lại ĐÍCH đã cấu hình NGAY (panel của add-on), không chờ nhịp dò và **không**
     * đẩy người dùng về origin của HA thêm lần nữa (đó chính là vòng lặp "refresh rồi lại Lovelace").
     */
    private fun onLoginConfirmed() {
        savedWebUrl = Prefs.webUrl(this)
        loginFlowActive = true
        loginFailed = false
        originShown = true
        showLoginBar(true)
        showRetryButton(false)
        startLoginTick()
        resetLoginWatch()
        runCatching { CookieManager.getInstance().flush() }
        if (panelTarget == null) panelTarget = DashboardTarget.panelUrl(haOrigin)
        if (panelTarget != null) {
            goPanel("login_done", force = true)
            return
        }
        val url = DashboardTarget.candidates(
            saved = savedWebUrl,
            loginUrl = Prefs.loginUrl(this),
            typed = Prefs.oneInput(this),
            token = Prefs.ingressToken(this)
        ).firstOrNull()
        if (url == null) {
            toast(getString(R.string.st_ha_login_no_web))
            return
        }
        loadWeb(url, LOAD_CONFIRMED)
    }

    /**
     * Đăng ký lại thiết bị ở luồng nền (không chặn UI): dùng sau khi panel mở (đã có `ingress_session`), vì lúc
     * "Kết nối" có thể chưa có phiên nên lần đăng ký đó bị bỏ qua.
     */
    private fun registerInBackground() {
        val api = Prefs.apiBase(this) ?: return
        val web = Prefs.webUrl(this)
        Thread {
            try {
                val cookie = HaCookie.header(api)
                if (WebTargetResolver.isIngressBase(api) && !WebTargetResolver.hasSessionCookie(cookie)) {
                    // Panel vừa mở nhưng cookie chưa đọc lại được — PhoneService sẽ tự đăng ký ở nhịp sau.
                    log("[api] register skipped: chưa có cookie ingress_session")
                    return@Thread
                }
                val id = Prefs.phoneId(this)
                val canonical = PhoneApi.register(
                    api, web, id, Prefs.phoneName(), Prefs.deviceKey(this), Prefs.phoneModel(), cookie
                )
                if (canonical != null && canonical != id) Prefs.setPhoneId(this, canonical)
            } catch (t: Throwable) {
                // mất mạng: service sẽ tự đăng ký lại ở nhịp 60 s
            }
        }.also { it.isDaemon = true; it.name = "register-after-panel" }.start()
    }

    /**
     * Màn hình thay thế cho trang lỗi thô (người dùng KHÔNG bao giờ thấy `401: Unauthorized`): tiêu đề + giải thích
     * + lối thoát dạng liên kết `dashboardos://retry` / `dashboardos://login` (bắt ở
     * [DashboardWebClient.shouldOverrideUrlLoading], không phải URL thật).
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
     * Gặp 401/403 trên ingress (`/api/hassio_ingress/…`): KHÔNG hiện nội dung lỗi thô, KHÔNG nạp lại origin nhiều
     * lần. Ở chế độ domain, đích đúng là **panel** (HA tự tạo phiên khi mở panel) nên app chỉ báo + điều hướng sang
     * panel (tối đa một lần mở origin cho mỗi luồng).
     */
    private fun onAuthRequired(url: String) {
        Prefs.setNeedHaLogin(this, true)
        afterLoginUrl = if (WebTargetResolver.sameUrl(url, targetUrl)) targetUrl else url
        val cookie = hasAnyCookie()
        loadResult = "401"
        navLog(url, "401", "cookie=" + yn(cookie))
        loginLog()
        if (!loginFlowActive) {
            loginFlowActive = true
            startLoginTick()
            showLoginBar(true)
        }
        // 401 chỉ có nghĩa "chưa có phiên ingress" — phiên đó do CHÍNH panel tạo, nên việc cần làm là mở panel.
        if (panelTarget != null) {
            goPanel("auth_required")
            return
        }
        if (!cookie && !originShown && haOrigin != null && !HaLogin.isAuthPage(webView?.url)) {
            originShown = true
            loadWeb(loginPageUrl(haOrigin!!), LOAD_LOGIN_PAGE)
            return
        }
        loginBarText?.text = getString(R.string.ha_login_401, DashboardTarget.shortUrl(url))
    }

    // ------------------------------------------------------------------ WebView clients

    private inner class DashboardWebClient : WebViewClient() {

        override fun shouldOverrideUrlLoading(
            view: WebView?,
            request: WebResourceRequest?
        ): Boolean {
            val uri: Uri = request?.url ?: return false
            val scheme = uri.scheme?.lowercase()
            // 2 "liên kết" của màn hình lỗi tự dựng ([showLoginPanel]): không phải URL thật.
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
                            originShown = true
                            Prefs.setLoginUrl(this@MainActivity, loginPageUrl(origin))
                            loadWeb(loginPageUrl(origin), LOAD_LOGIN_PAGE)
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
         * (26/11/2026) GD14 — **XÁC THỰC trang vừa nạp xong**:
         *  - panel của add-on (URL `https://<domain>/b39feb53_remote_webview_server`, hoặc trang có
         *    `<iframe … hassio_ingress>`) → chốt `[nav] … ok=panel`;
         *  - trang đăng nhập HA (`/auth/…`) → `ok=login`, chờ người dùng đăng nhập;
         *  - SPA HA thuần (Lovelace, `/`, "Page not found") trên URL panel → kiểm tra iframe bằng JS
         *    ([verifyPanelFrame]); trên URL khác → thử ứng viên kế tiếp ([onWrongPage]).
         */
        override fun onPageFinished(view: WebView?, url: String?) {
            super.onPageFinished(view, url)
            if (isFinishing || isDestroyed) return
            val loaded = url ?: view?.url
            val title = try {
                view?.title
            } catch (t: Throwable) {
                null
            }
            val arrival = DashboardTarget.arrival(loaded, title)
            loadResult = arrival.label

            // (27/11/2026) GD15 — trang TOP-LEVEL đang chờ kết luận (promote): xử lý riêng TRƯỚC mọi nhánh khác để
            // panel/top-level không bị nhầm là "đã vào panel" hay "sai trang".
            if (isPromoteNavigation(loaded)) {
                onPromoteLoaded(loaded, null, title)
                return
            }

            // Trang nạp CÓ CHỦ ĐÍCH (form đăng nhập của HA): chỉ ghi log — người dùng còn đang gõ mật khẩu.
            if (loadingReason == LOAD_LOGIN_PAGE) {
                // Nhãn log đúng theo trang ĐANG hiện (HA có thể đã chuyển sang /auth/login, hoặc về Lovelace nếu
                // người dùng vốn đã đăng nhập) — và panel thì chốt luôn.
                val label = when (arrival) {
                    DashboardTarget.Arrival.ADDON -> "panel"
                    DashboardTarget.Arrival.LOGIN -> "login"
                    DashboardTarget.Arrival.HOME_ASSISTANT, DashboardTarget.Arrival.OFF_INGRESS -> "ha-spa"
                    DashboardTarget.Arrival.OTHER -> "other"
                }
                navLog(loaded, label, "title=" + (title ?: "-"))
                loginLog()
                if (arrival == DashboardTarget.Arrival.ADDON) {
                    onPanelLoaded(loaded)
                    return
                }
                if (!loginFlowActive) {
                    loginFlowActive = true
                    startLoginTick()
                }
                showLoginBar(true)
                showLoginDiag(loaded, !currentCookieHeader().isNullOrBlank())
                return
            }

            when (arrival) {
                DashboardTarget.Arrival.ADDON -> {
                    // Trang đúng: chỉ chốt khi đây là trang mình VỪA YÊU CẦU (hoặc đang trong luồng đăng nhập).
                    if (!WebTargetResolver.sameUrl(loaded, loadingUrl) && !loginFlowActive) return
                    onPanelLoaded(loaded)
                }

                DashboardTarget.Arrival.LOGIN -> {
                    // (27/11/2026) GD15 — đang promote mà HA điều hướng về `/auth/…` ⇒ phiên không dùng được cho
                    // top-level: fallback về panel (không kéo người dùng vào luồng đăng nhập giữa lúc đang chạy).
                    if (promotePending) {
                        onPromoteFailed("auth")
                        return
                    }
                    navLog(loaded, "login")
                    Prefs.setNeedHaLogin(this@MainActivity, true)
                    showLoginBar(true)
                    if (!loginFlowActive) {
                        loginFlowActive = true
                        startLoginTick()
                    }
                    showLoginDiag(loaded, !currentCookieHeader().isNullOrBlank())
                }

                DashboardTarget.Arrival.HOME_ASSISTANT,
                DashboardTarget.Arrival.OFF_INGRESS -> {
                    // Panel của HA trả SPA của chính nó rồi mới nhúng add-on → kiểm tra iframe trước khi kết luận.
                    if (loaded != null && DashboardTarget.isPanel(loaded) && isDashboardAttempt()) {
                        navLog(loaded, "ha-spa", "title=" + (title ?: "-") + " → kiểm tra iframe")
                        verifyPanelFrame(loaded)
                        return
                    }
                    if (!isDashboardAttempt()) return
                    onWrongPage(loaded, arrival)
                }

                DashboardTarget.Arrival.OTHER -> Unit
            }
        }

        /**
         * 401/403 của ingress → [onAuthRequired] (không để nội dung `401: Unauthorized` hiện ra).
         * 404 trong luồng → thử ứng viên kế tiếp (không im lặng).
         */
        override fun onReceivedHttpError(
            view: WebView?,
            request: WebResourceRequest?,
            errorResponse: WebResourceResponse?
        ) {
            val code = errorResponse?.statusCode ?: return
            if (request?.isForMainFrame != true) return
            val url = request.url?.toString().orEmpty()

            // (27/11/2026) GD15 — lỗi HTTP của chính trang TOP-LEVEL đang promote (401/403/404/5xx…):
            // KHÔNG hiện nội dung lỗi, KHÔNG đi luồng đăng nhập — ghi `[promote] … ok=401 fail=… fallback=panel` rồi
            // quay lại panel (iframe) để người dùng vẫn dùng được UI.
            if (promotePending && WebTargetResolver.sameUrl(url, promoteUrl)) {
                loadResult = code.toString()
                view?.stopLoading()
                onPromoteFailed(IngressPromote.failReason(code, null))
                return
            }

            val authError = WebTargetResolver.needsHaLogin(code) &&
                (WebTargetResolver.isIngressUrl(url) || WebTargetResolver.sameUrl(url, targetUrl))
            if (authError) {
                loadResult = code.toString()
                navLog(url, code.toString())
                loginLog()
                view?.stopLoading()   // chặn body "401: Unauthorized"
                onAuthRequired(url)
                return
            }
            if (code == 404 && loginFlowActive) {
                loadResult = code.toString()
                navLog(url, code.toString())
                loginLog()
                onWrongPage(url, DashboardTarget.Arrival.OFF_INGRESS, code.toString())
                return
            }
            if (code >= 500) toast(getString(R.string.err_load))
        }

        /**
         * (21/11/2026) GD13 — CHẤP NHẬN CHỨNG CHỈ TỰ KÝ, nhưng CHỈ cho host đã cấu hình (chế độ IP LAN).
         * Host khác → `cancel()` như mặc định. Mọi lần chấp nhận/từ chối đều ghi log `[tls] ssl=…`.
         */
        override fun onReceivedSslError(view: WebView?, handler: SslErrorHandler?, error: SslError?) {
            val url = error?.url?.toString().orEmpty()
            val host = TlsPolicy.hostOf(url)
            val primary = error?.primaryError ?: -1
            val certError = primary == SslError.SSL_UNTRUSTED ||
                primary == SslError.SSL_IDMISMATCH ||
                primary == SslError.SSL_INVALID ||
                primary == SslError.SSL_EXPIRED ||
                primary == SslError.SSL_NOTYETVALID ||
                primary == SslError.SSL_DATE_INVALID
            val allow = TlsPolicy.allowProceed(host, allowedTlsHosts, certError)
            log(
                "[tls] ssl=${if (allow) "proceed" else "block"} host=${host ?: "-"} err=${sslLabel(primary)} " +
                    "url=${DashboardTarget.shortUrl(url)} allowed=${allowedTlsHosts.joinToString("/").ifEmpty { "-" }}"
            )
            if (allow) {
                runCatching { handler?.proceed() }
            } else {
                runCatching { handler?.cancel() }
                toast(getString(R.string.err_tls_blocked, host ?: "-"))
            }
        }

        /** Tên lỗi SSL cho log — hằng số của [SslError]. */
        private fun sslLabel(primary: Int): String = when (primary) {
            SslError.SSL_UNTRUSTED -> "untrusted"
            SslError.SSL_IDMISMATCH -> "id_mismatch"
            SslError.SSL_EXPIRED -> "expired"
            SslError.SSL_NOTYETVALID -> "not_yet_valid"
            SslError.SSL_DATE_INVALID -> "date_invalid"
            SslError.SSL_INVALID -> "invalid"
            else -> "other($primary)"
        }

        override fun onReceivedError(
            view: WebView?,
            request: WebResourceRequest?,
            error: WebResourceError?
        ) {
            if (request?.isForMainFrame != true) return
            // (27/11/2026) GD15 — mất mạng/ lỗi tải trang TOP-LEVEL đang promote → fallback về panel (không toast
            // "không tải được" vì người dùng vẫn còn panel dùng được).
            if (promotePending && WebTargetResolver.sameUrl(request.url?.toString(), promoteUrl)) {
                onPromoteFailed("net")
                return
            }
            loadResult = "net"
            navLog(request.url?.toString(), "net")
            loginLog()
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
        // Quay lại app giữa lúc đăng nhập: chạy tiếp nhịp dò 1 s.
        if (showingWeb && loginFlowActive) startLoginTick()
    }

    /**
     * Ghi cookie xuống đĩa khi app bị đẩy xuống nền: `ingress_session` (do panel tạo) phải còn cho lần mở app sau —
     * vừa để vào thẳng panel, vừa để API native chạy mà không phải đăng nhập lại.
     */
    override fun onPause() {
        runCatching { CookieManager.getInstance().flush() }
        super.onPause()
    }

    override fun onDestroy() {
        searchToken++
        searching = false
        mainHandler.removeCallbacks(hideOverlayRunnable)
        mainHandler.removeCallbacks(promoteTimeoutRunnable)
        promotePending = false
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

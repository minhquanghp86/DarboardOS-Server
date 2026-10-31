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
import android.webkit.JavascriptInterface
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
 * (19/11/2026) GD11 — "ĐĂNG NHẬP XONG VẪN ĐỨNG Ở LOVELACE, BẤM 'TÔI ĐÃ ĐĂNG NHẬP' THÌ NẠP LẠI ĐÚNG LOVELACE":
 *  - **Đã kiểm chứng bằng code**: KHÔNG có chỗ nào ghi origin của HA vào `webUrl`; nhưng **mọi** đường "mở
 *    dashboard" đều nạp **nguyên văn** `webUrl` mà **không kiểm tra** nó có phải trang add-on hay không
 *    ([openWeb], [onLoginConfirmed], [onOpenDashboardClicked], [goDashboard]). Khi `webUrl` là origin
 *    (`https://<domain>/` — dữ liệu của bản cũ / do người dùng dán) thì WebView nạp đúng origin, HA đã có phiên
 *    nên hiện Lovelace; và khi ingress trả 401 thì [onAuthRequired] **lại nạp origin** → vòng lặp "refresh rồi
 *    lại Lovelace". Ngoài ra bản GD10 **không có** `onPageFinished` nên không bao giờ phát hiện "đang ở HA".
 *  - **Cách sửa**:
 *      • [DashboardTarget] (tệp mới, thuần, unit test được) là hàng rào: `webUrl` chỉ hợp lệ khi là
 *        `…/launcher-config.html` ([DashboardTarget.isValidSaved]); origin/URL đăng nhập bị loại và được **dựng
 *        lại từ TOKEN** (`…/api/hassio_ingress/<TOKEN>/launcher-config.html` → `<slug>` → gốc domain);
 *        [Prefs.setWebUrl]/[Prefs.saveTargets] từ chối ghi giá trị không hợp lệ, [Prefs.KEY_LOGIN_URL] giữ origin
 *        của HA **tách riêng**;
 *      • mọi lần nạp trang điều khiển đi qua [loadWeb] (ghi `loadingUrl` + lý do), nên log luôn có dòng
 *        `[login] saved=… loading=… result=ok|ha-spa|401` và **thanh thông báo hiện đúng URL đang nạp** (rút gọn);
 *      • `onPageFinished` **xác thực** trang vừa nạp ([DashboardTarget.arrival]): tiêu đề/URL là của Home
 *        Assistant (hoặc nằm ngoài `/api/hassio_ingress/`) → [onWrongPage] thử **ứng viên kế tiếp** + hiện thông
 *        báo, không im lặng dừng ở Lovelace;
 *      • [onAuthRequired] chỉ mở origin **tối đa MỘT lần** trong một luồng ([originShown]) — hết vòng lặp 401 →
 *        origin → Lovelace.
 *
 * (20/11/2026) GD12 — "ĐĂNG NHẬP XONG VẪN KHÔNG TỰ SANG ADD-ON" (người dùng xác nhận lại; nguyên nhân thật):
 *  - Người dùng phải **mở add-on từ thanh bên của HA một lần**, rồi **thoát hẳn app** và mở lại mới vào thẳng
 *    add-on ⇒ phiên ingress (`ingress_session`) KHÔNG được tạo bởi việc đăng nhập: nó chỉ có khi **chính HA
 *    frontend mở panel** (frontend gọi WebSocket rồi tự đặt cookie).
 *  - Bản GD10 cố tự tạo phiên bằng `HttpURLConnection` tới `POST /api/hassio/ingress/session[/<slug>]` — endpoint
 *    này **không** phải API HTTP của HA core (core chỉ chuyển tiếp whitelist không có `ingress/session`), nên luôn
 *    401; và cookie do `HttpURLConnection` tạo cũng không nằm trong cookie store của WebView.
 *  - **Cách sửa (đúng luồng frontend, có bằng chứng trong [HaIngress])**: chạy **JS trong trang HA** để
 *    (1) lấy access token — `document.querySelector('home-assistant').hass.callWS(...)` hoặc
 *    `localStorage['hassTokens']` + `POST /auth/token` (refresh_token) khi hết hạn,
 *    (2) mở `wss://<domain>/api/websocket` → `auth` → `{type:"supervisor/api", endpoint:"/ingress/session",
 *        method:"post"}` (dự phòng `{type:"supervisor/ingress/session", slug}`) → `{session}`,
 *    (3) `document.cookie = "ingress_session=…;path=/api/hassio_ingress/;SameSite=Strict[;Secure]"`,
 *    (4) báo kết quả về app qua bridge → app **điều hướng ngay** sang `…/launcher-config.html`
 *        ([IngressBridge] → [onIngressBridgeResult] → [onIngressSessionReady]).
 *  - Log từng bước: `[login] step=token result=…`, `[login] step=session result=…`, `[login] step=nav result=…`
 *    ([HaIngress.logLine]); nút **Mở Dashboard** chạy đúng luồng mới này ([onOpenDashboardClicked]).
 *  - Khi mọi cách thất bại: hiện hướng dẫn ngắn — "Mở Home Assistant → thanh bên → Dashboard OS (một lần), sau đó
 *    quay lại app" ([R.string.ha_manual_steps]) — vì đó chính là cách người dùng đang phải làm.
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

        /** Giãn cách tối thiểu giữa hai lần chạy JS tạo phiên ingress — tránh gọi liên tục mỗi nhịp 1 s. */
        private const val INGRESS_ASK_MIN_GAP_MS = 2500L

        /** Chờ tối đa bao lâu cho câu trả lời của JS trước khi coi là "không trả lời" (WebSocket 9 s bên trong). */
        private const val INGRESS_ASK_TIMEOUT_MS = 12000L

        /** Số lần tạo phiên ingress thất bại trước khi hiện hướng dẫn mở add-on bằng tay (yêu cầu 6). */
        private const val INGRESS_FAILS_BEFORE_HINT = 2

        /** Số lần tối đa thử tạo phiên trong một luồng (không lặp vô hạn khi tài khoản không phải admin). */
        private const val INGRESS_MAX_ATTEMPTS = 4

        /**
         * (20/11/2026) GD12 — KHÔNG còn đoạn JS "chỉ đọc access token": việc lấy token, tạo phiên ingress bằng
         * WebSocket và đặt cookie `ingress_session` gói trong MỘT script duy nhất ([HaIngress.sessionScript]) do
         * chính trang HA chạy, nên không có token nào đi qua lớp Kotlin nữa.
         */

        /** (18/11/2026) GD10 — 2 "liên kết" của màn hình lỗi (bắt ở [DashboardWebClient.shouldOverrideUrlLoading]). */
        private const val RETRY_HREF = "dashboardos://retry"
        private const val LOGIN_HREF = "dashboardos://login"

        // ── (19/11/2026) GD11 — lý do của lần nạp trang (ghi vào log `[login] saved=… loading=… result=…`).

        /** Trang điều khiển đã lưu (`webUrl`) / đã dựng lại từ nó. */
        private const val LOAD_SAVED = "saved"

        /** Nút "Tôi đã đăng nhập" — nạp đúng `webUrl` (dựng lại từ TOKEN nếu `webUrl` hỏng). */
        private const val LOAD_CONFIRMED = "confirmed"

        /** Nút "Mở Dashboard". */
        private const val LOAD_MANUAL = "manual"

        /** Ứng viên kế tiếp sau khi trang vừa nạp hoá ra là Home Assistant. */
        private const val LOAD_NEXT = "next"

        /** Nút "Thử lại". */
        private const val LOAD_RETRY = "retry"

        /** Điều hướng do tự dò thấy 200 + trang add-on. */
        private const val LOAD_PROBE = "probe"

        /**
         * (20/11/2026) GD12 — nạp trang add-on NGAY SAU KHI JS trong trang HA vừa tạo xong phiên ingress
         * ([onIngressSessionReady]) — đây là đường chính của luồng mới.
         */
        private const val LOAD_SESSION = "session"

        /**
         * Trang ĐĂNG NHẬP của Home Assistant (`https://<domain>/`) — nạp có chủ đích, nên `onPageFinished`
         * KHÔNG được coi đây là "sai trang" (người dùng còn đang gõ mật khẩu).
         */
        private const val LOAD_LOGIN_PAGE = "login-page"

        /** Trang cùng origin rất nhẹ (`/manifest.json`) chỉ để đọc `hassTokens` — nạp có chủ đích. */
        private const val LOAD_TOKENS = "tokens"

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

    /** Trang điều khiển đã lưu ([Prefs.KEY_WEB_URL]) — đích thật của WebView. */
    private var targetUrl: String? = null

    // ── (19/11/2026) GD11 — "luôn nhắm trang add-on, không bao giờ nạp origin của HA"

    /**
     * `webUrl` ĐANG LƯU trong [Prefs] (nguyên văn, kể cả khi hỏng — chỉ để so sánh/ghi log).
     * KHÔNG BAO GIỜ được nạp thẳng vào WebView: `targetUrl` là bản đã kiểm/dựng lại.
     */
    private var savedWebUrl: String? = null

    /** URL THẬT SỰ đang nạp vào WebView (hiện trên thanh thông báo + ghi log) — xem [loadWeb]. */
    private var loadingUrl: String? = null

    /** Lý do của lần nạp hiện tại ([LOAD_SAVED], [LOAD_CONFIRMED], [LOAD_LOGIN_PAGE]…). */
    private var loadingReason: String = "-"

    /** Kết quả lần nạp hiện tại: `pending` / `ok` / `ha-spa` / `off-ingress` / `401` / `404` / `net`. */
    private var loadResult: String = "-"

    /** Đã mở origin của HA (trang đăng nhập) trong luồng hiện tại chưa — chỉ mở TỐI ĐA MỘT lần. */
    private var originShown = false

    /** Origin của Home Assistant (`https://<domain>`), null khi webUrl không phải URL http(s). */
    private var haOrigin: String? = null

    /**
     * (21/11/2026) GD13 — host được phép **chấp nhận chứng chỉ tự ký** (HTTPS 18443 của chính add-on). Lấy từ địa chỉ
     * người dùng đã nhập/đã lưu (`webUrl`, `loginUrl`, ô nhập, `apiBase`); host KHÁC vẫn bị chặn như mặc định.
     * Xem [TlsPolicy] và [DashboardWebClient.onReceivedSslError].
     */
    private var allowedTlsHosts: Set<String> = emptySet()

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

    // ── (20/11/2026) GD12 — tự tạo phiên ingress TRONG WebView (JS), đúng luồng HA frontend

    /** Đã chạy [HaIngress.sessionScript] và đang chờ bridge trả kết quả. */
    private var sessionPending = false

    /** Lần cuối chạy script tạo phiên (giãn cách [INGRESS_ASK_MIN_GAP_MS]). */
    private var lastSessionAskAt = 0L

    /** Số lần đã chạy script trong luồng hiện tại (tối đa [INGRESS_MAX_ATTEMPTS]). */
    private var sessionAttempts = 0

    /** Số lần tạo phiên THẤT BẠI liên tiếp — đủ [INGRESS_FAILS_BEFORE_HINT] thì hiện hướng dẫn mở add-on tay. */
    private var sessionFails = 0

    /**
     * Session token của Supervisor mà app đã tạo được (`{"session": "…"}`). Có nó nghĩa là cookie
     * `ingress_session` đã được đặt (`Path=/api/hassio_ingress/`) → `GET …/launcher-config.html` phải trả 200.
     */
    private var ingressSession: String? = null

    /** Đã hẹn giờ "JS không trả lời" cho lần chạy hiện tại chưa (tránh hẹn chồng). */
    private var sessionWatchdogArmed = false

    /** Số lần đã mở trang cùng origin rất nhẹ (`/manifest.json`) để chạy script (tối đa 2 — xem [ensureSameOriginForScript]). */
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

    /**
     * (20/11/2026) GD12 — JS không trả lời trong [INGRESS_ASK_TIMEOUT_MS] (trang bị thay giữa lúc chạy, WebView
     * đã huỷ, hoặc trình duyệt nhúng chặn WebSocket): coi là một lần thất bại để app không kẹt ở `sessionPending`
     * mãi mãi — nhịp 1 s sẽ thử lại (giãn cách [INGRESS_ASK_MIN_GAP_MS]).
     */
    private val ingressWatchdogRunnable = Runnable {
        sessionWatchdogArmed = false
        if (!sessionPending) return@Runnable
        sessionPending = false
        onIngressSessionFailed("timeout")
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
            loadWeb(url, LOAD_OTHER)
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
        // (21/11/2026) GD13 — host được CHẤP NHẬN chứng chỉ tự ký = đúng địa chỉ người dùng vừa nhập (+ địa chỉ đã
        // lưu). Nhờ vậy lần dò `https://<ip>:18443` (HTTPS tự ký của add-on) không bị SSLHandshakeException, còn
        // host lạ thì vẫn xác thực TLS bình thường.
        allowedTlsHosts = TlsPolicy.allowedHosts(text, Prefs.webUrl(this), Prefs.oneInput(this), Prefs.apiBase(this))
        val tlsHosts = allowedTlsHosts
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
                val check = WebTargetResolver.probeWeb(url, HaCookie.header(url), tlsHosts)
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
                if (ServerResolver.probe(base, cookie, tlsHosts) != null) {
                    foundApi = base
                    break
                }
                val code = ServerResolver.probeStatus(base, cookie, tlsHosts) ?: continue
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
                // (21/11/2026) GD13 — vào thẳng bằng HTTPS tự ký của add-on: KHÔNG cần phiên HA/ingress. Ghi rõ để
                // lần sau đọc log là biết app đang đi đường nào (`adb logcat -s DashboardOS-login`).
                if (TlsPolicy.isSelfSignedUrl(webUrl)) {
                    log("[tls] webUrl=${DashboardTarget.shortUrl(webUrl)} host=${TlsPolicy.hostOf(webUrl) ?: "-"} " +
                        "→ HTTPS tự ký của add-on, không cần đăng nhập HA")
                }
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

        val saved = savedWebUrl
        val target = targetUrl
        // (19/11/2026) GD11 — "mở trang đã lưu" LUÔN dùng `targetUrl` (đã kiểm/dựng lại), không dùng nguyên văn
        // `url`: nếu `webUrl` là origin của HA thì nạp nó = hiện Lovelace (đúng lỗi người dùng báo).
        if (saved != null && WebTargetResolver.sameUrl(url, saved) && target != null) {
            afterLoginUrl = target
            if (hasAnyCookie() || !Prefs.needHaLogin(this)) {
                // (GD10) có cookie (hoặc lần dò trước đã 200) → vào thẳng trang điều khiển.
                Prefs.setNeedHaLogin(this, false)
                loadWeb(target, LOAD_SAVED)
                return
            }
            startLoginFlow(openOrigin = true)
            return
        }
        loadWeb(url, LOAD_OTHER)
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

        // (19/11/2026) GD11 — `targetUrl` KHÔNG phải bản sao nguyên văn của `webUrl`: nếu `webUrl` trống/hỏng
        // (origin, URL đăng nhập, thiếu `launcher-config.html`) thì dựng lại từ TOKEN (xem [DashboardTarget]).
        savedWebUrl = Prefs.webUrl(this)
        haOrigin = DashboardTarget.originOf(savedWebUrl)
            ?: DashboardTarget.originOf(Prefs.loginUrl(this))
            ?: DashboardTarget.originOf(Prefs.oneInput(this))
        // (21/11/2026) GD13 — host được chấp nhận chứng chỉ tự ký: địa chỉ người dùng đã cấu hình (ô nhập / webUrl /
        // apiBase). Trang WebView mở bằng `https://<ip>:18443` sẽ gọi [DashboardWebClient.onReceivedSslError].
        allowedTlsHosts = TlsPolicy.allowedHosts(
            savedWebUrl,
            Prefs.loginUrl(this),
            Prefs.oneInput(this),
            Prefs.apiBase(this)
        )
        targetUrl = DashboardTarget.candidates(
            saved = savedWebUrl,
            loginUrl = Prefs.loginUrl(this),
            typed = Prefs.oneInput(this),
            token = Prefs.ingressToken(this)
        ).firstOrNull()
        afterLoginUrl = targetUrl
        loginWatch = null
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
        // (20/11/2026) GD12 — cầu để JS trong trang HA báo kết quả tạo phiên ingress
        // ([HaIngress.sessionScript] gọi `window.DashboardOS.postResult(json)`).
        runCatching { web.addJavascriptInterface(IngressBridge(), HaIngress.BRIDGE) }
    }

    /**
     * (20/11/2026) GD12 — cầu JS → Kotlin của luồng tạo phiên ingress.
     *
     * JS chạy trong trang HA gọi [postResult] với JSON một bước (`{"step":"token"|"session",…}` —
     * [HaIngress.parseResult]). Bridge được gọi ở luồng nền nên mọi việc đi qua [post] (main thread). Chỉ xử lý khi
     * app ĐANG chờ kết quả ([sessionPending]) — trang add-on tự do không thể "bơm" phiên giả vào app.
     */
    private inner class IngressBridge {
        @JavascriptInterface
        fun postResult(json: String?) {
            post {
                if (!sessionPending) {
                    log(HaIngress.logLine(HaIngress.STEP_SESSION, "ignored", "why=not_waiting"))
                    return@post
                }
                onIngressBridgeResult(json)
            }
        }
    }

    private fun disposeWebView() {
        mainHandler.removeCallbacks(hideOverlayRunnable)
        mainHandler.removeCallbacks(ingressWatchdogRunnable)
        sessionWatchdogArmed = false
        sessionPending = false
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
        // (21/11/2026) GD13 — CHẾ ĐỘ IP LAN: add-on tự phục vụ HTTPS (18443) nên KHÔNG có ingress, KHÔNG cần phiên
        // HA, KHÔNG cần `hassTokens`. Đẩy người dùng sang trang đăng nhập HA ở đây chính là vòng lặp "đăng nhập xong
        // vẫn đứng ở Lovelace" mà họ báo. Nên: bỏ hẳn nhánh đăng nhập, chỉ báo rõ + cho "Thử lại".
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
        // (19/11/2026) GD11 — origin của HA lưu ở KHOÁ RIÊNG (`loginUrl`), không bao giờ vào `webUrl`.
        Prefs.setLoginUrl(this, loginPageUrl(origin))
        if (openOrigin && !originShown) {
            originShown = true
            loginBarText?.text = getString(R.string.ha_login_banner)
            loadWeb(loginPageUrl(origin), LOAD_LOGIN_PAGE)
        }
    }

    /** `https://<domain>` → `https://<domain>/` (đúng origin của HA). */
    private fun loginPageUrl(origin: String): String = origin.trimEnd('/') + "/"

    /**
     * (21/11/2026) GD13 — app đang ở **chế độ IP LAN** (địa chỉ đã cấu hình là IP riêng / localhost): add-on phục vụ
     * HTTPS tự ký ở cổng 18443 nên mọi thứ đi thẳng, KHÔNG có ingress và KHÔNG cần đăng nhập Home Assistant.
     *
     * Dùng để chặn hai đường phụ thuộc HA — đúng yêu cầu "bỏ luồng `hassTokens`/`ingress/session` khỏi đường vào
     * dashboard khi dùng IP":
     *  - [startLoginFlow] (không đẩy người dùng sang form đăng nhập HA),
     *  - [canRunIngressScript] (không chạy JS lấy `hassTokens` / tạo phiên ingress).
     */
    private fun isLanMode(): Boolean =
        TlsPolicy.isLanUrl(targetUrl) ||
            TlsPolicy.isLanUrl(savedWebUrl) ||
            TlsPolicy.isLanInput(Prefs.oneInput(this)) ||
            TlsPolicy.isLanUrl(Prefs.apiBase(this))

    // ── (19/11/2026) GD11 — nạp trang + xác thực "đây có phải add-on không"

    /**
     * Nạp [url] vào WebView và GHI NHỚ nó là URL đang nạp ([loadingUrl]) + lý do ([loadingReason]).
     *
     * Mọi lần nạp trang điều khiển (kể cả trang đăng nhập) đều phải đi qua đây để:
     *  - log có dòng chuẩn `[login] saved=… loading=… result=pending` ([HaLogin.progressLine]),
     *  - thanh thông báo hiện **đúng URL đang nạp** (rút gọn — [DashboardTarget.shortUrl]),
     *  - `onPageFinished` biết trang vừa xong có đúng là trang mình vừa yêu cầu hay không.
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

    /**
     * Lần nạp hiện tại có NHẮM **trang điều khiển của add-on** không (nên mới cần xác thực "đây có phải add-on").
     * Trang gọi (`call-web.html?call=…`) và liên kết ngoài thì không — chúng hợp lệ ở bất kỳ URL nào.
     */
    private fun isDashboardAttempt(): Boolean = when (loadingReason) {
        LOAD_SAVED, LOAD_CONFIRMED, LOAD_MANUAL, LOAD_NEXT, LOAD_RETRY, LOAD_PROBE, LOAD_SESSION -> true
        else -> false
    }

    /**
     * (19/11/2026) GD11 — trang VỪA NẠP XONG hoá ra là Home Assistant (tiêu đề/URL), không phải add-on:
     * **không im lặng** — hiện thông báo (URL thật + lý do) và thử **ứng viên kế tiếp** của [HaLogin.Watch]
     * (ingress từ TOKEN → `<slug>` → gốc domain → cổng 18080). Hết ứng viên → [onLoginFailed] (màn hình + nút
     * "Thử lại"/"Đăng nhập Home Assistant").
     */
    private fun onWrongPage(url: String?, arrival: DashboardTarget.Arrival, label: String? = null) {
        // Chỉ có ý nghĩa khi lần nạp vừa rồi NHẮM trang điều khiển; trang gọi / liên kết ngoài thì bỏ qua.
        if (!isDashboardAttempt()) return
        // Trang đăng nhập của HA: nạp có chủ đích, người dùng còn đang gõ mật khẩu — không phải "sai trang".
        if (loadingReason == LOAD_LOGIN_PAGE) return
        val reason = label ?: arrival.label
        loadResult = reason
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
        toast(message)
        val step = loginWatch?.skip() ?: HaLogin.Step(HaLogin.Action.GIVE_UP, null)
        when (step.action) {
            HaLogin.Action.NEXT_VARIANT -> {
                val next = step.url
                if (next == null) {
                    onLoginFailed(lastWebStatus)
                    return
                }
                loginBarText?.text = message + "\n" + getString(
                    R.string.ha_login_try_next,
                    DashboardTarget.shortUrl(next)
                )
                loadWeb(next, LOAD_NEXT)
            }

            HaLogin.Action.GIVE_UP -> onLoginFailed(lastWebStatus)
            else -> Unit
        }
    }

    /**
     * (19/11/2026) GD11 — trang vừa nạp XONG đúng là trang điều khiển của add-on
     * ([DashboardTarget.Arrival.ADDON]) → chốt: ẩn thanh thông báo, tắt nhịp dò, lưu `webUrl` (đây là lần ghi
     * DUY NHẤT của `webUrl` ngoài lúc dò ingress — và chỉ ghi giá trị đã xác thực).
     */
    private fun onDashboardLoaded(url: String?) {
        val u = url?.trim().orEmpty()
        if (u.isEmpty() || !DashboardTarget.isValidSaved(u)) return
        loadResult = DashboardTarget.Arrival.ADDON.label
        loginLog()
        // (20/11/2026) GD12 — kết thúc bước `nav` của luồng tự tạo phiên ingress: log `[login] step=nav result=ok`.
        if (loadingReason == LOAD_SESSION || ingressSession != null) {
            log(HaIngress.logLine(HaIngress.STEP_NAV, "ok", DashboardTarget.shortUrl(u)))
        }
        stopLoginTick()
        mainHandler.removeCallbacks(ingressWatchdogRunnable)
        sessionWatchdogArmed = false
        sessionPending = false
        probeGen++
        probing = false
        loginFlowActive = false
        loginFailed = false
        loggedInSignal = false
        sessionFails = 0
        Prefs.setNeedHaLogin(this, false)
        showRetryButton(false)
        showLoginBar(false)
        afterLoginUrl = u
        targetUrl = u
        haOrigin = DashboardTarget.originOf(u) ?: haOrigin
        if (!WebTargetResolver.sameUrl(u, savedWebUrl)) {
            Prefs.setWebUrl(this, u)
            savedWebUrl = u
            log("[login] saved=${DashboardTarget.shortUrl(u)} (đã xác thực trang add-on — lần sau vào thẳng)")
        }
        runCatching { CookieManager.getInstance().flush() }
    }

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
     *
     * (19/11/2026) GD11 — biến thể URL dựng từ [DashboardTarget]: `webUrl` hỏng (origin / URL đăng nhập) bị thay
     * bằng ứng viên dựng lại từ TOKEN (`…/api/hassio_ingress/<TOKEN>/launcher-config.html`), nên `Watch` **không
     * bao giờ** chứa origin của HA.
     */
    private fun resetLoginWatch() {
        probeGen++
        // afterLoginUrl dùng khi webUrl chưa có (đường vào từ Cài đặt: "Đăng nhập lại Home Assistant").
        val watch = HaLogin.Watch(
            webUrl = savedWebUrl ?: targetUrl ?: afterLoginUrl,
            token = Prefs.ingressToken(this),
            fallbackInput = Prefs.oneInput(this)
        )
        loginWatch = watch
        baselineCookieNames = HaLogin.cookieNames(currentCookieHeader())
        lastWebStatus = null
        loggedInSignal = false
        loginFailed = false
        ingressSession = null
        neutralLoads = 0
        sessionPending = false
        sessionAttempts = 0
        sessionFails = 0
        lastSessionAskAt = 0L
        mainHandler.removeCallbacks(ingressWatchdogRunnable)
        sessionWatchdogArmed = false
        probing = false
        originShown = false
        showRetryButton(false)
        log(
            "[login] start saved=${DashboardTarget.shortUrl(savedWebUrl)} web=${targetUrl ?: "-"} " +
                "variants=${watch.variants.size} first=${DashboardTarget.shortUrl(watch.variants.firstOrNull())} " +
                "cookie=${yn(hasAnyCookie())} baseline=${baselineCookieNames.joinToString("/").ifEmpty { "-" }}"
        )
    }

    /**
     * (18/11/2026) GD10 — MỘT nhịp dò (mỗi 1 s):
     *  1. ghi `[login] url=… cookie=… web=…` ra Logcat **và** lên thanh thông báo,
     *  2. nhận dấu hiệu "đã đăng nhập": URL đã rời `/auth/…` của HA, hoặc có cookie MỚI (bất kỳ tên), hoặc đọc
     *     được `hassTokens` trong `localStorage`,
     *  3. **(20/11/2026) GD12** — chạy JS TRONG trang HA để tự tạo phiên ingress ([requestIngressSession]): lấy
     *     access token (`hass.callWS` hoặc `hassTokens` + `/auth/token`) → WebSocket `supervisor/api`
     *     `/ingress/session` → `document.cookie` `ingress_session` `Path=/api/hassio_ingress/` → nạp
     *     `launcher-config.html`,
     *  4. dò `GET <candidate>` kèm cookie ([probeCandidate]) — 200 + body không phải SPA của HA là xong.
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
                    "session=${yn(ingressSession != null)} sig=${yn(loggedInSignal)}"
            )
        )
        showLoginDiag(url, cookiePresent)
        // Đã đăng nhập → chạy JS tạo phiên ingress ngay trong trang HA (đúng luồng frontend, xem [HaIngress]).
        if (loggedInSignal) ensureSameOriginForScript()
        if (loggedInSignal) requestIngressSession(force = false)
        if (!probing) probeCandidate(cookiePresent)
    }

    /**
     * Dòng chẩn đoán trên thanh thông báo (đúng dòng vừa ghi ra Logcat) + **URL đang thực sự nạp**
     * (19/11/2026 GD11 — rút gọn bằng [DashboardTarget.shortUrl], vd `…/api/hassio_ingress/KJjH…/launcher-config.html`).
     */
    private fun showLoginDiag(url: String?, cookiePresent: Boolean) {
        if (loginFailed) return
        val base = if (sessionPending) {
            // (20/11/2026) GD12 — đang chờ JS trong trang HA trả `{session}`.
            getString(R.string.ha_login_creating_session)
        } else if (loggedInSignal) {
            getString(R.string.ha_login_probing, lastWebStatus?.toString() ?: "-")
        } else {
            getString(R.string.ha_login_banner)
        }
        val shown = DashboardTarget.shortUrl(loadingUrl ?: targetUrl ?: savedWebUrl)
        loginBarText?.text = base +
            "\n" + getString(R.string.ha_login_loading_url, shown, loadResult) +
            "\n" + HaLogin.pollLogLine(url, cookiePresent, lastWebStatus)
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
            val check = WebTargetResolver.probeWeb(url, cookie, allowedTlsHosts)
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
        // Lỗi mạng ở biến thể CUỐI: không còn địa chỉ nào để thử → báo rõ + nút "Thử lại" thay vì quay vô hạn ở
        // một địa chỉ không tới được (19/11/2026 GD11 — "không im lặng").
        if (status == null && watch.index >= watch.variants.lastIndex) {
            log("[login] probe url=$url web=net → GIVE_UP (biến thể cuối)")
            onLoginFailed(null)
            return
        }
        // (19/11/2026) GD11 — người dùng ĐÃ khẳng định đăng nhập (nút "Tôi đã đăng nhập"/"Thử lại") thì 401 phải
        // được ĐẾM là lỗi kể cả khi chưa có cookie: bản GD10 coi "chưa có cookie → WAIT" nên kẹt vĩnh viễn ở
        // Lovelace mà không báo gì (đúng lỗi người dùng báo).
        val step = watch.onProbe(status, dashboard, cookiePresent || loggedInSignal)
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
     *
     * (19/11/2026) GD11 — chỉ lưu `webUrl` khi [url] đã xác thực là **trang điều khiển** ([DashboardTarget.isValidSaved]);
     * origin của HA không bao giờ được lưu vào `webUrl`.
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
        if (DashboardTarget.isValidSaved(url) && !WebTargetResolver.sameUrl(url, savedWebUrl)) {
            // Biến thể khác đã chạy được (vd add-on ở gốc domain / cổng 18080) → nhớ luôn cho lần sau.
            Prefs.setWebUrl(this, url)
            savedWebUrl = url
            log("[login] saved=${DashboardTarget.shortUrl(url)} (lưu ứng viên đã dò được 200)")
        }
        targetUrl = url
        haOrigin = DashboardTarget.originOf(url) ?: haOrigin
        // Giữ cookie (kể cả `ingress_session` vừa tạo) qua lần mở app sau.
        runCatching { CookieManager.getInstance().flush() }
        toast(getString(R.string.ha_login_ok))
        if (Prefs.receiveEnabled(this)) PhoneService.start(this)
        registerInBackground()
        loadWeb(url, LOAD_PROBE)
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
        loadResult = if (loadResult == "pending") code else loadResult
        loginLog()
        // (20/11/2026) GD12 — yêu cầu 6: khi MỌI cách tự động thất bại, hiện hướng dẫn NGẮN đúng cách người dùng
        // đang phải làm (mở add-on một lần trong HA để chính HA frontend tạo phiên ingress).
        loginBarText?.text = getString(R.string.ha_login_failed_banner, code) +
            "\n" + getString(R.string.ha_login_loading_url, DashboardTarget.shortUrl(loadingUrl), loadResult) +
            "\n" + getString(R.string.ha_manual_steps)
        toast(getString(R.string.ha_login_failed_banner, code))
        val tried = loginWatch?.variants?.joinToString("\n") { "• $it" }.orEmpty()
        log("[login] give_up web=$code tried=${loginWatch?.variants?.size ?: 0} loading=${DashboardTarget.shortUrl(loadingUrl)}")
        // Người dùng đang gõ ở FORM ĐĂNG NHẬP của HA: KHÔNG thay trang (chỉ báo trên thanh thông báo + nút Thử lại).
        if (HaLogin.isAuthPage(webView?.url)) return
        showLoginPanel(
            getString(R.string.ha_login_failed_title),
            getString(R.string.ha_login_failed_hint, code, tried) + "\n\n" + getString(R.string.ha_manual_steps),
            withRetry = true
        )
    }

    /**
     * (18/11/2026) GD10 — nút **"Thử lại"** (trên thanh thông báo hoặc màn hình thất bại): dò LẠI TỪ ĐẦU
     * (biến thể 1, đếm 401 lại từ 0, đọc lại token) — không phải thoát app rồi mở lại.
     *
     * (19/11/2026) GD11 — nạp LẠI ứng viên đầu (dựng từ `webUrl`/TOKEN) thay vì chỉ dò ngầm: người dùng thấy ngay
     * app đang nhắm trang nào.
     */
    private fun onRetryClicked() {
        loginFlowActive = true
        showLoginBar(true)
        resetLoginWatch()
        // Người dùng CHỦ ĐỘNG bấm "Thử lại" → coi như đã đăng nhập: dò và báo kết quả rõ ràng (không im lặng).
        loggedInSignal = true
        startLoginTick()
        runCatching { CookieManager.getInstance().flush() }
        // (20/11/2026) GD12 — đang ở trang HA cùng origin thì TẠO LẠI PHIÊN INGRESS TRƯỚC (JS), rồi mới điều hướng;
        // rời trang HA trước thì không còn `localStorage`/`hass.callWS` để tạo phiên nữa.
        if (canRunIngressScript()) {
            requestIngressSession(force = true)
            return
        }
        val url = loginWatch?.current
        if (url == null) {
            toast(getString(R.string.st_ha_login_no_web))
            return
        }
        loadWeb(url, LOAD_RETRY)
        if (!probing) probeCandidate(hasAnyCookie())
    }

    /**
     * (18/11/2026) GD10 — nút **"Mở Dashboard"** (LUÔN hiện ở màn đăng nhập): người dùng chủ động, không chờ dò.
     *
     * (19/11/2026) GD11 — URL đang thử LUÔN là ứng viên add-on ([HaLogin.Watch] không bao giờ chứa origin của HA);
     * nếu `webUrl` hỏng thì dựng lại từ TOKEN trước khi nạp.
     *
     * (20/11/2026) GD12 — **LUỒNG MỚI**: nếu WebView đang ở trang HA cùng origin (người dùng vừa đăng nhập) thì
     * nút này (a) chạy JS tạo phiên ingress ngay ([requestIngressSession]), (b) khi JS trả `{session}` thì app đặt
     * cookie `ingress_session` và (c) tự điều hướng sang `…/launcher-config.html` ([onIngressSessionReady]).
     * Chỉ khi KHÔNG chạy được JS (chưa ở trang HA) mới nạp thẳng ứng viên ingress như bản cũ.
     */
    private fun onOpenDashboardClicked() {
        // Nhịp dò cần biết URL/biến thể: chưa có (mở app bình thường) hoặc lần dò trước đã thất bại thì dựng lại
        // từ ĐẦU (biến thể 1) — nếu không sẽ thử tiếp đúng biến thể vừa hỏng.
        if (loginWatch == null || loginFailed) resetLoginWatch()
        loginFlowActive = true
        // Người dùng CHỦ ĐỘNG đòi mở dashboard → bật cờ để nhịp dò dám thử/đổi biến thể và báo kết quả rõ ràng.
        loggedInSignal = true
        loginFailed = false
        showLoginBar(true)
        showRetryButton(false)
        startLoginTick()
        runCatching { CookieManager.getInstance().flush() }
        if (canRunIngressScript()) {
            // Người dùng bấm nút = ý định rõ ràng: cho phép thử lại từ đầu (kể cả khi lần trước đã hết lượt).
            sessionAttempts = 0
            sessionFails = 0
            log("[login] manual=open_dashboard → tạo phiên ingress trong WebView")
            requestIngressSession(force = true)
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
     * (14/11/2026) GD7 — nút **"Tôi đã đăng nhập"** (dự phòng khi trình duyệt nhúng không ghi cookie hoặc cookie
     * nằm ở path khác): nạp trang điều khiển NGAY, không cần chờ dò.
     *
     * (18/11/2026) GD10 — vẫn bật nhịp dò 1 s để tự tạo phiên ingress nếu ingress trả 401.
     *
     * (19/11/2026) GD11 — nút này **phải nạp đúng `webUrl` đã lưu**; nếu `webUrl` trống/không hợp lệ (bằng origin,
     * thiếu `launcher-config.html`) thì **tự dựng lại từ TOKEN**:
     * `https://<domain>/api/hassio_ingress/<TOKEN>/launcher-config.html` → `…/<slug>/launcher-config.html` →
     * `https://<domain>/launcher-config.html` ([DashboardTarget.candidates]). Bản GD10 nạp nguyên văn `webUrl`
     * nên khi `webUrl` là origin thì bấm nút chỉ "refresh" đúng trang Lovelace của HA — đúng lỗi người dùng báo.
     */
    private fun onLoginConfirmed() {
        savedWebUrl = Prefs.webUrl(this)
        val candidates = DashboardTarget.candidates(
            saved = savedWebUrl,
            loginUrl = Prefs.loginUrl(this),
            typed = Prefs.oneInput(this),
            token = Prefs.ingressToken(this)
        )
        val url = candidates.firstOrNull()
        if (url == null) {
            toast(getString(R.string.st_ha_login_no_web))
            return
        }
        if (savedWebUrl != null && !DashboardTarget.isValidSaved(savedWebUrl)) {
            log(
                "[login] rebuild saved=${DashboardTarget.shortUrl(savedWebUrl)} " +
                    "loading=${DashboardTarget.shortUrl(url)} (webUrl không phải trang add-on)"
            )
        }
        resetLoginWatch()
        loginFlowActive = true
        loggedInSignal = true      // người dùng khẳng định đã đăng nhập → được phép dò/đổi biến thể + báo kết quả
        loginFailed = false
        // Người dùng VỪA nói "tôi đã đăng nhập": KHÔNG đẩy họ về origin của HA nữa (đó chính là việc nạp lại
        // Lovelace mà họ vừa báo lỗi). Nếu add-on vẫn 401 thì app thử ứng viên khác rồi hiện thông báo + lối
        // "Đăng nhập Home Assistant" ở màn thất bại.
        originShown = true
        showLoginBar(true)
        showRetryButton(false)
        startLoginTick()
        runCatching { CookieManager.getInstance().flush() }
        // (20/11/2026) GD12 — LUỒNG MỚI: vừa đăng nhập xong (đang ở trang HA cùng origin) → tạo phiên ingress bằng
        // JS rồi mới điều hướng. Nếu không chạy được JS thì mới nạp thẳng trang add-on như bản cũ.
        if (canRunIngressScript()) {
            sessionAttempts = 0
            sessionFails = 0
            log("[login] manual=login_done → tạo phiên ingress trong WebView")
            requestIngressSession(force = true)
            return
        }
        toast(getString(R.string.ha_login_ok))
        loadWeb(url, LOAD_CONFIRMED)
    }

    // ── (20/11/2026) GD12 — TỰ TẠO PHIÊN INGRESS TRONG WEBVIEW (JS), ĐÚNG LUỒNG HA FRONTEND
    //
    // Bối cảnh đã kiểm chứng (xem KDoc của [HaIngress]): `POST /api/hassio/ingress/session[/<slug>]` mà bản GD10
    // gọi bằng HttpURLConnection KHÔNG phải API của core (luôn 401), và cookie do HttpURLConnection tạo cũng không
    // vào cookie store của WebView. HA frontend làm khác hẳn: WebSocket `supervisor/api` `endpoint=/ingress/session`
    // → nhận `{session}` → tự đặt `document.cookie = "ingress_session=…;path=/api/hassio_ingress/;SameSite=Strict"`.
    // App nay chạy CHÍNH đoạn JS đó trong trang HA ([HaIngress.sessionScript]) và nhận kết quả qua bridge.

    /**
     * Trang đang mở có chạy được script không: phải là **document thật của HA, cùng origin**, KHÔNG phải đường dẫn
     * ingress (trang ingress 401 sau `stopLoading()` không có `localStorage`) và KHÔNG phải form đăng nhập (chưa có
     * `hassTokens`).
     */
    private fun canRunIngressScript(): Boolean {
        // (21/11/2026) GD13 — chế độ IP LAN: không có ingress để tạo phiên, và cũng KHÔNG cần (`https://<ip>:18443`
        // của add-on trả trang trực tiếp). Không chạy JS `hassTokens`/WebSocket supervisor → không còn phụ thuộc HA.
        if (isLanMode()) return false
        val origin = haOrigin ?: return false
        val url = webView?.url ?: return false
        if (!DashboardTarget.isHttp(url)) return false
        if (DashboardTarget.isIngress(url)) return false
        if (HaLogin.isAuthPage(url)) return false
        return HaLogin.isSameOrigin(url, origin)
    }

    /**
     * (20/11/2026) GD12 — `localStorage` (`hassTokens`) và `hass.callWS` chỉ dùng được trên một trang **cùng
     * origin** với HA. Khi WebView đang ở `about:blank` / trang lỗi 401 (đã `stopLoading()`), mở một trang cùng
     * origin RẤT nhẹ (`/manifest.json` — không phải Lovelace, không phải form đăng nhập) để chạy script, rồi
     * `onPageFinished` sẽ chạy script ngay. Tối đa 2 lần cho mỗi luồng — không đẩy người dùng ra khỏi trang HA thật.
     */
    private fun ensureSameOriginForScript() {
        if (ingressSession != null || sessionPending) return
        if (canRunIngressScript()) return
        val origin = haOrigin ?: return
        if (sessionAttempts >= INGRESS_MAX_ATTEMPTS) return
        if (neutralLoads >= 2) return
        neutralLoads++
        val page = origin.trimEnd('/') + "/manifest.json"
        log("[login] neutral_load=$page (chạy JS tạo phiên ingress cùng origin)")
        // Đi qua loadWeb với lý do [LOAD_TOKENS] để `onPageFinished` không hiểu nhầm đây là "trang sai".
        loadWeb(page, LOAD_TOKENS)
    }

    /**
     * Chạy [HaIngress.sessionScript] trong trang HA: lấy access token (`hass.callWS` của frontend, hoặc
     * `localStorage.hassTokens` + `POST /auth/token` khi hết hạn) → WebSocket `supervisor/api` `/ingress/session`
     * → `document.cookie` `ingress_session` `Path=/api/hassio_ingress/`.
     *
     * Kết quả về qua bridge ([IngressBridge] → [onIngressBridgeResult]). [force] = bỏ giãn cách
     * [INGRESS_ASK_MIN_GAP_MS] (dùng khi người dùng bấm nút hoặc vừa nạp xong trang cùng origin).
     */
    private fun requestIngressSession(force: Boolean) {
        val web = webView ?: return
        if (sessionPending) return
        if (ingressSession != null) return
        if (sessionAttempts >= INGRESS_MAX_ATTEMPTS) return
        val now = System.currentTimeMillis()
        if (!force && now - lastSessionAskAt < INGRESS_ASK_MIN_GAP_MS) return
        if (!canRunIngressScript()) return
        sessionAttempts++
        lastSessionAskAt = now
        sessionPending = true
        log(HaIngress.logLine(HaIngress.STEP_TOKEN, "pending", "attempt=$sessionAttempts"))
        try {
            web.evaluateJavascript(HaIngress.sessionScript(ServerResolver.ADDON_SLUG), null)
        } catch (t: Throwable) {
            sessionPending = false
            onIngressSessionFailed("eval_" + t.javaClass.simpleName)
            return
        }
        if (!sessionWatchdogArmed) {
            sessionWatchdogArmed = true
            mainHandler.postDelayed(ingressWatchdogRunnable, INGRESS_ASK_TIMEOUT_MS)
        }
    }

    /**
     * Kết quả từ bridge của JS ([HaIngress.parseResult]): `step=token` chỉ để ghi log, `step=session` mới quyết
     * định — OK thì điều hướng sang `…/launcher-config.html` ([onIngressSessionReady]), hỏng thì đếm lần thất bại.
     */
    private fun onIngressBridgeResult(json: String?) {
        val result = HaIngress.parseResult(json)
        if (result == null) {
            log(HaIngress.logLine(HaIngress.STEP_SESSION, "bad_bridge"))
            return
        }
        when (result.step) {
            HaIngress.STEP_TOKEN -> log(
                HaIngress.logLine(
                    HaIngress.STEP_TOKEN,
                    if (result.ok) "ok" else "fail",
                    result.detail?.let { "detail=$it" }
                )
            )

            HaIngress.STEP_SESSION -> {
                mainHandler.removeCallbacks(ingressWatchdogRunnable)
                sessionWatchdogArmed = false
                sessionPending = false
                if (result.sessionReady) {
                    onIngressSessionReady(result.session.orEmpty(), result.how, result.cookie)
                } else {
                    onIngressSessionFailed(result.detail ?: "no_session")
                }
            }
        }
    }

    /**
     * (20/11/2026) GD12 — ĐÃ CÓ PHIÊN: JS vừa đặt cookie `ingress_session` (đúng `Path=/api/hassio_ingress/` như
     * frontend). Ghi hộ thêm một lần bằng [CookieManager] (cùng giá trị, cùng `Path` — lưới an toàn khi trình
     * duyệt nhúng chặn `document.cookie`), `flush()` xuống đĩa, rồi **điều hướng ngay** sang
     * `…/api/hassio_ingress/<TOKEN>/launcher-config.html`.
     */
    private fun onIngressSessionReady(session: String, how: String?, jsCookie: Boolean) {
        ingressSession = session
        val origin = haOrigin
        val wrote = HaCookie.setIngressSession(origin, session)
        runCatching { CookieManager.getInstance().flush() }
        log(
            HaIngress.logLine(
                HaIngress.STEP_SESSION,
                "ok",
                "how=${how ?: "-"} cookie=${yn(wrote || jsCookie)} js_cookie=${yn(jsCookie)}"
            )
        )
        val url = ingressLauncherUrl()
        if (url == null) {
            onLoginFailed(null)
            return
        }
        // Dò lại từ biến thể ĐẦU (ingress dựng từ TOKEN) — phiên vừa tạo phải làm nó trả 200.
        loginWatch?.reset()
        log(HaIngress.logLine(HaIngress.STEP_NAV, "pending", DashboardTarget.shortUrl(url)))
        loadWeb(url, LOAD_SESSION)
        if (!probing) probeCandidate(cookiePresent = true)
    }

    /** Trang điều khiển của add-on (ưu tiên URL ingress đang nhắm, không thì dựng lại từ TOKEN). */
    private fun ingressLauncherUrl(): String? {
        val target = targetUrl
        if (target != null && DashboardTarget.isIngress(target) && DashboardTarget.hasLauncherPage(target)) {
            return target
        }
        val origin = haOrigin ?: return target
        return DashboardTarget.ingressUrl(origin, Prefs.ingressToken(this))
    }

    /**
     * (20/11/2026) GD12 — không tạo được phiên (JS báo lỗi, hoặc quá hạn chờ). **Không im lặng**: ghi log
     * `[login] step=session result=fail detail=…`, và sau [INGRESS_FAILS_BEFORE_HINT] lần thì hiện hướng dẫn ngắn
     * trên thanh thông báo — đúng cách người dùng đang phải làm bằng tay.
     */
    private fun onIngressSessionFailed(detail: String?) {
        sessionPending = false
        sessionFails++
        mainHandler.removeCallbacks(ingressWatchdogRunnable)
        sessionWatchdogArmed = false
        log(HaIngress.logLine(HaIngress.STEP_SESSION, "fail", "detail=${detail ?: "-"} fails=$sessionFails"))
        if (sessionFails >= INGRESS_FAILS_BEFORE_HINT) showManualHint()
    }

    /**
     * (20/11/2026) GD12 — hướng dẫn ngắn khi MỌI cách tự động thất bại (yêu cầu 6): mở add-on bằng tay trong HA
     * một lần (chính HA frontend sẽ tạo phiên ingress), sau đó quay lại app.
     */
    private fun showManualHint() {
        if (loginFailed || !loginFlowActive) return
        loginBarText?.text = getString(R.string.ha_manual_steps)
        log(HaIngress.logLine("manual", "hint"))
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
     *
     * (19/11/2026) GD11 — **origin của HA chỉ được mở TỐI ĐA MỘT LẦN cho mỗi luồng** ([originShown]). Bản GD10 mở
     * origin mỗi lần gặp 401, nên sau khi đăng nhập xong (cookie vẫn chưa có / chưa đọc được `hassTokens`) app
     * nạp lại origin → Lovelace: đúng hiện tượng "bấm 'Tôi đã đăng nhập' → refresh rồi lại vào đúng dashboard HA".
     * Hết lượt mở origin → báo rõ trên thanh thông báo + thử ứng viên kế tiếp ([onWrongPage]).
     */
    private fun onAuthRequired(url: String) {
        Prefs.setNeedHaLogin(this, true)
        afterLoginUrl = if (WebTargetResolver.sameUrl(url, targetUrl)) targetUrl else url
        val cookie = hasAnyCookie()
        log(
            "[login] auth_required url=$url cookie=${yn(cookie)} flow=${yn(loginFlowActive)} " +
                "sig=${yn(loggedInSignal)} origin_shown=${yn(originShown)}"
        )
        loadResult = "401"
        loginLog()
        val origin = haOrigin
        if (!loginFlowActive) {
            startLoginFlow(openOrigin = !cookie && !originShown && origin != null)
            return
        }
        if (origin != null && ingressSession == null && !cookie && !originShown &&
            !HaLogin.isAuthPage(webView?.url)
        ) {
            // Không có cookie VÀ chưa đọc được `hassTokens`: người dùng còn phải đăng nhập → mở trang đăng nhập
            // (một lần duy nhất; xem KDoc).
            originShown = true
            Prefs.setLoginUrl(this, loginPageUrl(origin))
            loadWeb(loginPageUrl(origin), LOAD_LOGIN_PAGE)
            return
        }
        // Đã đăng nhập rồi mà ingress vẫn 401: KHÔNG nạp lại origin nữa — báo rõ + thử ứng viên kế tiếp.
        loginBarText?.text = getString(R.string.ha_login_401, DashboardTarget.shortUrl(url))
        log("[login] 401 loading=${DashboardTarget.shortUrl(url)} → next variant (không nạp origin)")
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
         * (19/11/2026) GD11 — **XÁC THỰC trang vừa nạp xong** (yêu cầu 3): nếu tiêu đề/URL là của Home Assistant
         * (Lovelace, trang chủ, form đăng nhập) hoặc URL nằm ngoài `/api/hassio_ingress/` mà không phải trang điều
         * khiển → coi như CHƯA vào được add-on, thử ứng viên kế tiếp và hiện thông báo ([onWrongPage]).
         * Bản GD10 **không có** `onPageFinished` nên không bao giờ phát hiện việc này (app im lặng ở Lovelace).
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
            // Trang nạp CÓ CHỦ ĐÍCH mà không phải đích add-on (form đăng nhập của HA, trang đọc `hassTokens`):
            // chỉ ghi log, không đổi trang.
            if (loadingReason == LOAD_LOGIN_PAGE || loadingReason == LOAD_TOKENS) {
                loadResult = arrival.label
                loginLog()
                // (20/11/2026) GD12 — vừa nạp xong trang CÙNG ORIGIN rất nhẹ (`/manifest.json`): đây là lúc chạy
                // script tạo phiên ingress (trước đó WebView ở trang lỗi 401 nên không có `localStorage`).
                if (loadingReason == LOAD_TOKENS && loginFlowActive) requestIngressSession(force = true)
                return
            }
            when (arrival) {
                DashboardTarget.Arrival.ADDON -> {
                    // Trang đúng của add-on: chỉ chốt khi đây là trang mình VỪA YÊU CẦU (hoặc đang trong luồng đăng
                    // nhập) — tránh việc điều hướng nội bộ của add-on bị hiểu nhầm.
                    if (!WebTargetResolver.sameUrl(loaded, loadingUrl) && !loginFlowActive) return
                    onDashboardLoaded(loaded)
                }

                DashboardTarget.Arrival.HOME_ASSISTANT,
                DashboardTarget.Arrival.OFF_INGRESS -> {
                    // CHỈ xác thực khi lần nạp này NHẮM trang điều khiển. Trang gọi (`call-web.html?call=…`) và các
                    // trang khác của add-on (ở gốc domain, không có `launcher-config.html`) hoàn toàn hợp lệ.
                    if (!isDashboardAttempt()) return
                    onWrongPage(loaded, arrival)
                }

                DashboardTarget.Arrival.OTHER -> Unit
            }
        }

        /**
         * (13/11/2026) GD6 — 401/403 của ingress = add-on đúng nhưng Home Assistant yêu cầu đăng nhập.
         *
         * (14/11/2026) GD7 — KHÔNG để nội dung lỗi (`401: Unauthorized`) hiện ra: `stopLoading()` rồi đưa người
         * dùng về trang đăng nhập của HA (hoặc màn "Cần đăng nhập Home Assistant"), bật thanh thông báo + dò cookie.
         *
         * (19/11/2026) GD11 — ghi `result=401` vào log chẩn đoán; [onAuthRequired] chỉ mở origin MỘT lần (hết vòng
         * lặp "refresh rồi lại Lovelace").
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
                loadResult = code.toString()
                loginLog()
                view?.stopLoading()   // chặn body "401: Unauthorized"
                onAuthRequired(url)
                return
            }
            if (code == 404 && loginFlowActive) {
                // Sai TOKEN ingress / sai đường dẫn: báo rõ + thử ứng viên kế tiếp (không im lặng).
                loadResult = code.toString()
                loginLog()
                onWrongPage(url, DashboardTarget.Arrival.OFF_INGRESS, code.toString())
                return
            }
            if (code >= 500) toast(getString(R.string.err_load))
        }

        /**
         * (21/11/2026) GD13 — CHẤP NHẬN CHỨNG CHỈ TỰ KÝ, nhưng CHỈ cho host đã cấu hình.
         *
         * Đây là mảnh cuối của việc bỏ ingress: add-on tự phục vụ `https://<ip>:18443` bằng chứng chỉ tự ký
         * (`src/tls.ts`), mà WebView mặc định **chặn** mọi chứng chỉ không do CA công cộng ký — chặn thì trang không
         * mở được, và micro/camera (chỉ có trong secure context) cũng không có.
         *
         * Nguyên tắc (xem [TlsPolicy]):
         *  - `proceed()` **chỉ khi** `error.url.host` nằm trong [allowedTlsHosts] (IP/domain người dùng đã cấu hình)
         *    **và** lỗi là lỗi chứng chỉ (tự ký / không tin cậy / sai tên / hết hạn / chưa hiệu lực);
         *  - host khác (quảng cáo, iframe, chuyển hướng ra Internet) → **cancel()** như mặc định;
         *  - mọi lần chấp nhận/từ chối đều ghi log `[tls] ssl=…` (Logcat: `adb logcat -s DashboardOS-login`).
         */
        override fun onReceivedSslError(view: WebView?, handler: SslErrorHandler?, error: SslError?) {
            val url = error?.url?.toString().orEmpty()
            // (21/11/2026) GD13 — host lấy qua [TlsPolicy.hostOf] (cùng logic với phần dò URL) thay vì `Uri.getHost()`
            // để một chỗ duy nhất quyết định "host nào đã được cấu hình".
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
                // Chứng chỉ tự ký của add-on trong LAN/Tailscale: chấp nhận để trang chạy trong secure context.
                runCatching { handler?.proceed() }
            } else {
                runCatching { handler?.cancel() }
                toast(getString(R.string.err_tls_blocked, host ?: "-"))
            }
        }

        /** Tên lỗi SSL cho log (`ssl=proceed` kèm lý do) — hằng số của [SslError]. */
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
            loadResult = "net"
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

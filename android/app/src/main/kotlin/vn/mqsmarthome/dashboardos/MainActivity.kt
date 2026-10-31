package vn.mqsmarthome.dashboardos

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.net.http.SslError
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.TypedValue
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.TextView
import android.widget.Toast
import kotlin.math.abs
import kotlin.math.roundToInt

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
 *  5. Log: `[nav] url=… ok=panel|ha-spa|login|401` (xem [DashboardTarget.navLine]) — ghi vào [Diag] (Cài đặt →
 *     Chẩn đoán) **và** Logcat (`adb logcat -s DashboardOS-login`).
 *
 * (28/11/2026) GD16 / (1.2) — **PROMOTE CHẮC CHẮN, CÓ THỬ LẠI** (bản GD15 dò `iframe[src*="hassio_ingress"]` rồi mới
 * promote ⇒ dò không thấy nên promote **không bao giờ chạy**):
 *  - Lý do promote: panel của HA nhúng add-on trong `<iframe>` **không có** `allow="microphone; camera"` ⇒
 *    Permissions Policy của khung cha chặn `getUserMedia` ⇒ không gọi điện được. Cần **TOP-LEVEL**
 *    `https://<domain>/api/hassio_ingress/<TOKEN>/launcher-config.html` ([IngressPromote]) để micro/camera được cấp.
 *  - (1.2) **SỬA LỖI "promote bắn một lần quá sớm rồi bị khoá"**: promote chạy **ngay khi** nhịp dò / `onPageFinished`
 *    thấy `cookie=yes session=yes` ([promoteIfSessionReady]) — không chờ hẹn giờ 2,5 s; được thử lại tối đa
 *    [IngressPromote.MAX_PROMOTE_ATTEMPTS] (3) lần, cách nhau ≥ [IngressPromote.PROMOTE_RETRY_GAP_MS] (1,5 s);
 *    `skip=already` **chỉ** khi đã `ok=top`.
 *  - Trang top-level được dò loại bằng JS ([HaIngress.panelProbeScript]): HTML có `launcher-config` / `Dashboard OS`
 *    → **giữ** + ẩn thanh "Đăng nhập" (`ok=top`); 401/403, SPA của HA, redirect `/auth`, timeout 4 s → **quay lại
 *    panel** + log rõ (`[promote] url=… ok=401 fail=401 fallback=panel`) và **vẫn giữ quyền thử lại** ở nhịp sau.
 *  - Panel cũng không nạp được (404/mất mạng/HA chỉ trả SPA): thử **ngay** top-level ingress, rồi
 *    `https://<domain>/launcher-config.html` ([loadRootFallback]) — mỗi bước một lần.
 *  - Nút "Mở Dashboard" nạp **top-level ingress** (không phải gốc domain, không dừng ở panel) —
 *    [onOpenDashboardClicked] → thân nút nay là [openDashboardNow].
 *  - Mọi bước ghi vào [Diag] → người dùng bấm Cài đặt → **Chẩn đoán** → Sao chép gửi là đủ, không cần adb.
 *  - Bấm "Kết nối" = phiên app mới ([resetPromoteState]).
 *
 * (30/11/2026) GD18 / **(1.4) — TỰ ĐỘNG MỞ DASHBOARD, TÁI DÙNG ĐÚNG CODE CỦA NÚT**:
 *  - Sự thật đã kiểm chứng trên máy thật (1.2): đăng nhập HA xong app **vẫn không tự chuyển**; người dùng **phải bấm
 *    nút "Mở Dashboard"** mới vào được add-on ⇒ thân nút chạy **ĐÚNG**, còn chuỗi điều kiện trung gian
 *    (`promoteIfSessionReady` / `loginTick` / hẹn giờ 2,5 s) **không** kích hoạt dù log có `cookie=yes session=yes`.
 *  - Cách sửa: thân nút tách thành **[openDashboardNow]**, và nhịp dò 1 s ([loginTick]) / [onPanelLoaded] gọi **đúng
 *    hàm đó** ngay khi có phiên ([autoOpenIfSessionReady]) — **một lần** mỗi lần mở app (cờ riêng [autoOpenLatch]).
 *  - Log chuẩn: `[auto] tick cookie=yes session=yes called=no` (mỗi nhịp, chỉ khi `session=yes`),
 *    `[auto] openDashboard reason=session_ready` → `[promote] … ok=top`.
 *  - Fallback giữ nguyên: top-level trả 401 / SPA HA → **quay lại panel** + log lý do; auto thử tối đa
 *    [AutoOpen.MAX_ATTEMPTS] = 3 lần, cách ≥ [AutoOpen.RETRY_GAP_MS] = 1,5 s rồi thôi (`[auto] give_up`).
 *
 * (1.5) **HẾT NHẤP NHÁY THANH THÔNG BÁO ĐĂNG NHẬP** (người dùng báo: lần mở app SAU — đã đăng nhập, có phiên
 * ingress — thanh trên cùng vẫn hiện 1–2 s rồi mới tự ẩn):
 *  - **Nguyên nhân**: thanh bị bật bởi mọi chỗ gọi `showLoginBar(true)`, kể cả những chỗ **không cần đăng nhập** —
 *    nặng nhất là [openDashboardNow] (đường TỰ ĐỘNG mở dashboard, chạy mỗi lần mở app khi đã có phiên): panel vừa
 *    nạp xong là thanh hiện ra, rồi `onPromoteLoaded` (`ok=top`) ẩn đi ⇒ nhấp nháy đúng 1–2 s + layout giật (thanh
 *    nằm trong luồng layout nên đẩy WebView xuống rồi kéo lên).
 *  - **Cách sửa**: mọi lần đổi visibility đi qua **một cửa duy nhất** [showLoginBar] + chính sách thuần [LoginBar]:
 *    mặc định `GONE`; chỉ HIỆN với lý do *cần thật* (`401/403` trên ingress → [LoginBar.Reason.AUTH_HTTP], URL
 *    `/auth/…` → [LoginBar.Reason.AUTH_URL], [startLoginFlow] mở trang đăng nhập → [LoginBar.Reason.LOGIN_FLOW],
 *    trang sai, hết cách, hoặc nút người dùng bấm); **đã có phiên ⇒ KHÔNG BAO GIỜ hiện** (kể cả khung hình đầu);
 *    và có **thời gian ân hạn** [LoginBar.SETTLE_MS] (2,5 s) khi lần mở app này đã có phiên (panel/promote đang tự
 *    phục hồi) — hết ân hạn mà vẫn cần thì thanh mới hiện ([recheckLoginBarAfterSettle]).
 *  - **Kiểm chứng trên máy thật**: Cài đặt → Chẩn đoán có dòng `[ui] bar=show|hide reason=…` (chỉ ghi khi trạng
 *    thái ĐỔI, tiền tố `[ui]` **không** kích hoạt tự lưu tệp chẩn đoán). Lần mở app sau phải thấy
 *    `[ui] bar=hide reason=startup session=yes` → `[ui] bar=hide reason=open_dashboard …` — **không** có `bar=show`.
 *
 * Chế độ **IP LAN** (bản GD13) vẫn được giữ nhưng KHÔNG khuyến nghị: nó dựa vào chứng chỉ tự ký cổng 18443, không
 * có phiên HA nào để API native dùng. Giao diện đã ghi rõ điều này.
 *
 * Phần còn lại giữ nguyên: WebView full screen + WebRTC (micro/camera), tự đăng ký thiết bị, PhoneService nhận cuộc
 * gọi khi app đóng, chuông theo kênh thông báo, BONG BÓNG “Kết nối” (1.7: icon bánh răng, 44dp, KÉO ĐƯỢC khắp màn
 * hình và nhớ vị trí theo tỉ lệ) để quay lại màn nhập.
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

        /**
         * (1.7) **BONG BÓNG “KẾT NỐI” THAY NÚT “URL”** — mọi hằng số của nó (44dp, ngưỡng tap 8dp/200ms, alpha
         * 0.55/0.85/0.4, mờ sau 5 s, khoảng cách mép 12dp) nằm trong [BubbleDrag] để unit test được trên JVM
         * ([BubbleDragTest]); ở đây chỉ còn phần gắn `MotionEvent` vào view.
         */

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

        /**
         * (27/11/2026) GD15 / (28/11/2026) GD16 — quá **4 s** mà trang top-level chưa kết luận → quay lại panel.
         */
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
         * (1.2) Lý do promote — chỉ để ghi log/ chẩn đoán (`[promote] retry=… reason=…`); promote KHÔNG còn chờ
         * hẹn giờ 2,5 s mà chạy ngay khi đã có phiên ([promoteIfSessionReady]).
         *
         * (1.4) Lý do `session_ready` của **đường tự động** nằm ở [AutoOpen.REASON_SESSION_READY] — auto **không**
         * còn đi qua [promoteIfSessionReady] mà gọi thẳng [openDashboardNow] (đúng hàm của nút "Mở Dashboard").
         */
        private const val PROMOTE_REASON_PANEL_READY = "panel_ready"
        private const val PROMOTE_REASON_PANEL_TIMER = "panel_timer"

        /**
         * (28/11/2026) GD16 — nạp **dự phòng cuối** `https://<domain>/launcher-config.html` (add-on phục vụ thẳng ở
         * gốc domain) khi cả panel của HA và ingress đều không dùng được.
         */
        private const val LOAD_ROOT_FALLBACK = "root"

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

    // ── (1.5) THANH THÔNG BÁO: **MẶC ĐỊNH ẨN**, chỉ hiện khi THẬT SỰ cần đăng nhập (xem [LoginBar])

    /**
     * Lý do **đang chờ xét lại** sau thời gian ân hạn ([LoginBar.SETTLE_MS]) — chỉ đặt khi thanh bị hoãn vì còn ân
     * hạn (`why=settling`), để hết ân hạn mà vẫn cần đăng nhập thì thanh mới hiện ([recheckLoginBarAfterSettle]).
     */
    private var pendingLoginBarReason: LoginBar.Reason? = null

    /**
     * Lần mở app này (lần dựng màn WebView) **đã có phiên ingress** chưa — nếu có thì trong [LoginBar.SETTLE_MS]
     * đầu KHÔNG hiện thanh (panel/promote đang tự phục hồi; đây chính là 1–2 s nhấp nháy người dùng báo).
     */
    private var launchHadSession = false

    /** Thời điểm dựng màn WebView (ms) — mốc của thời gian ân hạn [LoginBar.SETTLE_MS]. */
    private var launchAtMs = 0L

    /** Dòng `[ui] bar=…` gần nhất đã ghi — chỉ ghi khi trạng thái ĐỔI (không spam ring buffer 300 dòng). */
    private var lastBarLine: String? = null

    /** Hết thời gian ân hạn → xét lại thanh nếu còn lý do cần đăng nhập đang chờ. */
    private val loginBarSettleRunnable = Runnable { recheckLoginBarAfterSettle() }

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

    // ── (28/11/2026) GD16 — promote panel (iframe) → TOP-LEVEL ingress, KHÔNG phụ thuộc dò iframe
    //    (xem [IngressPromote]; log từng bước vào [Diag] để người dùng gửi chẩn đoán).

    /**
     * (1.2) **CỔNG PROMOTE CÓ THỬ LẠI** ([IngressPromote.Gate]) — thay cho cờ "chỉ một lần" của bản GD16.
     *
     * Lỗi đã sửa (log thật của người dùng): promote bắn **một lần duy nhất quá sớm** (2,5 s, `session=no`) → 401 →
     * bị khoá vĩnh viễn bằng `skip=already`; lúc phiên ingress xuất hiện (12:58:01) app **không thử lại**.
     * Nay: thử lại khi có phiên, tối đa [IngressPromote.MAX_PROMOTE_ATTEMPTS] lần, cách nhau
     * ≥ [IngressPromote.PROMOTE_RETRY_GAP_MS]; `skip=already` **chỉ** khi đã `ok=top` ([IngressPromote.Gate.success]).
     */
    private val promoteGate = IngressPromote.Gate()

    // ── (30/11/2026) GD18 / (1.4) — TỰ ĐỘNG MỞ DASHBOARD (xem [AutoOpen])

    /**
     * **CỜ RIÊNG của đường tự động** ([AutoOpen.Latch]) — "đã tự gọi [openDashboardNow] trong lần mở app này chưa".
     *
     * Sự thật đã kiểm chứng trên máy thật (1.2): nút "Mở Dashboard" chạy ĐÚNG, còn các điều kiện trung gian của
     * đường tự động (`promoteGate` / `promoteIfSessionReady` / hẹn giờ 2,5 s) thì **không** kích hoạt dù log có
     * `cookie=yes session=yes`. Vì vậy auto dùng cờ RIÊNG này: có phiên ⇒ gọi thẳng [openDashboardNow], tối đa
     * [AutoOpen.MAX_ATTEMPTS] lần cách ≥ [AutoOpen.RETRY_GAP_MS] (thất bại 401/SPA HA thì thử lại, không lặp vô hạn).
     */
    private val autoOpenLatch = AutoOpen.Latch()

    /** Đã ghi `[auto] give_up` (hết lượt tự gọi) chưa — tránh spam log mỗi nhịp dò 1 s. */
    private var autoGiveUpLogged = false

    /** Số thứ tự lần promote đang chạy (1-based) — chỉ để ghi log `retry=<n>`. */
    private var promoteAttempt = 0

    /** Đã ghi `skip=limit` (hết lượt promote) chưa — tránh spam log mỗi nhịp dò 1 s. */
    private var promoteLimitLogged = false

    /** Đang chờ kết luận của trang top-level (bật timeout 4 s, tắt khi có `onPageFinished`/lỗi). */
    private var promotePending = false

    /** URL top-level đang chờ kết luận (`…/api/hassio_ingress/<TOKEN>/launcher-config.html`). */
    private var promoteUrl: String? = null

    /** TOKEN lấy từ đâu: `frame` (đọc `src` iframe của panel) hay `prefs` (TOKEN đã lưu) — chỉ để ghi log. */
    private var promoteTokenSource: String = "-"

    /** Đã đặt hẹn giờ promote cho panel đang nạp chưa ([IngressPromote.PANEL_PROMOTE_DELAY_MS]). */
    private var panelPromoteArmed = false

    /** Promote này được kích hoạt vì **panel không nạp được** → thất bại thì thử tiếp gốc domain. */
    private var promoteFallback = false

    /** Đã thử `https://<domain>/launcher-config.html` (dự phòng cuối) chưa — chống lặp. */
    private var rootFallbackTried = false

    /** Origin dùng cho lần promote đang chạy (đọc `src` iframe là bất đồng bộ). */
    private var promoteOrigin: String? = null

    /**
     * (28/11/2026) GD16 / (1.2) — **LƯỚI AN TOÀN**: hết [IngressPromote.PANEL_PROMOTE_DELAY_MS] (2,5 s) kể từ khi
     * panel bắt đầu nạp thì thử promote một lần. Nếu lúc đó **chưa có phiên** thì [promoteNow] từ chối
     * (`skip=no_session`) — nhịp dò sẽ promote ngay khi phiên xuất hiện.
     */
    private val promoteAfterPanelRunnable = Runnable {
        panelPromoteArmed = false
        promoteNow(PROMOTE_REASON_PANEL_TIMER)
    }

    /**
     * (28/11/2026) GD16 — lưới an toàn cho bước đọc `src` iframe (bất đồng bộ): quá
     * [IngressPromote.PROMOTE_TOKEN_READ_MS] mà chưa bắt đầu nạp top-level thì promote bằng TOKEN đã lưu.
     */
    private val promoteStartGuardRunnable = Runnable { finishPromoteStart(null) }

    /**
     * (28/11/2026) GD16 — hết [PROMOTE_TIMEOUT_MS] (4 s) mà trang top-level không kết luận được (không
     * `onPageFinished`, không lỗi HTTP) → coi như `fail=timeout` và **quay lại panel** (iframe).
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

    // ── (1.7) BONG BÓNG “KẾT NỐI” KÉO ĐƯỢC (thay nút “URL” cố định ở góc — yêu cầu 1..6 của người dùng)

    /** Khung chứa WebView + bong bóng (`activity_web.xml` → `webHost`) = **phạm vi kéo** và gốc toạ độ. */
    private var bubbleHost: ViewGroup? = null

    /** Bong bóng 44dp (icon bánh răng, nền tròn `url_button_bg`). */
    private var urlBubble: View? = null

    /** Vị trí hiện tại của bong bóng (px, góc trên-trái) — đúng bằng `leftMargin` / `topMargin` của nó. */
    private var bubbleX = 0f
    private var bubbleY = 0f

    /** Vị trí đã chuẩn hoá 0..1 (đọc từ [Prefs] khi mở màn, ghi lại sau mỗi lần KÉO). */
    private var bubbleRatio: BubbleDrag.Pos? = null

    /** Kích thước khung ở lần bố cục trước — đổi (xoay máy / thanh đăng nhập bật-tắt) thì đặt lại theo tỉ lệ. */
    private var bubbleHostW = 0
    private var bubbleHostH = 0

    /** Đang KÉO (đã vượt ngưỡng 8dp) — dùng để không tụt alpha giữa lúc kéo. */
    private var bubbleDragging = false

    /**
     * (1.7) YÊU CẦU 5 — **5 s không chạm thì mờ về [BubbleDrag.ALPHA_FADED] (0.4)**, KHÔNG BAO GIỜ ẩn hẳn: bong bóng
     * vẫn bấm và kéo được (khác nút “URL” cũ: nó tự `GONE` sau 4 s, sai yêu cầu).
     */
    private val bubbleIdleRunnable = Runnable {
        val b = urlBubble ?: return@Runnable
        if (bubbleDragging) return@Runnable
        b.animate().alpha(BubbleDrag.ALPHA_FADED).setDuration(600).start()
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

        // (29/11/2026) GD17 — TỰ LƯU CHẨN ĐOÁN KHI LỖI: mọi dòng log đi qua [Diag] (cả dòng [promote] … fail= và
        // 401 do chính màn này hoặc PhoneService ghi) đều được [DiagAutoSave] xét; gặp lỗi ⇒ ghi
        // diag-auto-<timestamp>.txt (tối đa 5 tệp, tệp cũ bị xoá) để người dùng chỉ việc vào Chẩn đoán → chia sẻ.
        Diag.onLine = { line -> DiagAutoSave.maybeSave(applicationContext, line) }

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

    /**
     * (1.6) **TRANG NHẬP ĐỊA CHỈ GỌN** (`activity_url.xml`): logo · tiêu đề · phụ đề 1 dòng · phiên bản · 1 ô nhập ·
     * 1 nút chính · 1 dòng trạng thái · hàng chip **Cài đặt / Chẩn đoán / Đăng xuất**.
     *
     * Nút "Đăng xuất" **chỉ hiện khi đã có phiên/cấu hình** ([Logout.showChip]) — máy mới thì không có gì để xoá.
     */
    private fun showUrlScreen(status: String? = null) {
        showingWeb = false
        disposeWebView()

        setContentView(R.layout.activity_url)

        // (1.6) YÊU CẦU 3 — phiên bản `v<versionName> (<versionCode>)`: đọc từ PackageInfo (không cần BuildConfig).
        val (versionName, versionCode) = appVersion()
        findViewById<TextView>(R.id.appVersion).text = AppVersion.line(versionName, versionCode)

        val web = findViewById<EditText>(R.id.webInput)
        webInput = web
        web.setText(Prefs.oneInput(this) ?: "")
        web.setSelection(web.text.length)

        // (1.6) YÊU CẦU 4 — trạng thái NGẮN, đúng 1 dòng: "Đã kết nối: <host>" hoặc "Chưa kết nối".
        statusView = findViewById<TextView>(R.id.urlStatus)
        setStatus(status ?: defaultStatus())

        findViewById<Button>(R.id.connectButton).setOnClickListener { connect() }
        findViewById<Button>(R.id.settingsButton).setOnClickListener {
            startActivity(Intent(this, SettingsActivity::class.java))
        }
        // (1.6) YÊU CẦU 5 — "Chẩn đoán" ra thẳng trang đầu (trước đây phải vào Cài đặt).
        findViewById<Button>(R.id.diagButton).setOnClickListener { openDiag() }
        // (1.6) YÊU CẦU 2 — "Đăng xuất" (chỉ hiện khi đã có phiên/cấu hình) → hộp thoại xác nhận.
        val logout = findViewById<Button>(R.id.logoutButton)
        logout.visibility = if (Logout.showChip(hasSavedConfig(), hasSavedHaSession())) View.VISIBLE else View.GONE
        logout.setOnClickListener { confirmLogout() }

        web.setOnEditorActionListener { _, actionId, _ -> connectOnAction(actionId) }
    }

    private fun connectOnAction(actionId: Int): Boolean {
        if (actionId == EditorInfo.IME_ACTION_GO || actionId == EditorInfo.IME_ACTION_DONE) {
            connect()
            return true
        }
        return false
    }

    /**
     * (1.6) Dòng trạng thái NGẮN dưới nút chính — đúng 1 dòng: `Đã kết nối: hass.example.com` hoặc `Chưa kết nối`
     * (`activity_url.xml` đặt `maxLines=1` + `ellipsize=end`, nên không bao giờ thành khối chữ).
     */
    private fun defaultStatus(): String {
        val host = connectedHost()
        return if (host == null) {
            getString(R.string.status_not_connected)
        } else {
            getString(R.string.status_connected_short, host)
        }
    }

    /** `hass.example.com` / `192.168.10.2:18080` — host của địa chỉ đã lưu (null = chưa cấu hình gì). */
    private fun connectedHost(): String? {
        val saved = Prefs.webUrl(this) ?: Prefs.apiBase(this) ?: Prefs.loginUrl(this) ?: return null
        val origin = DashboardTarget.originOf(saved) ?: return null
        return origin.removePrefix("https://").removePrefix("http://").trimEnd('/').ifEmpty { null }
    }

    /** Đã lưu cấu hình nào chưa (`webUrl` / `apiBase` / `loginUrl`) — điều kiện hiện nút "Đăng xuất". */
    private fun hasSavedConfig(): Boolean =
        Prefs.webUrl(this) != null || Prefs.apiBase(this) != null || Prefs.loginUrl(this) != null

    /** Đã có cookie (bất kỳ) của Home Assistant cho địa chỉ đã lưu — dấu hiệu "đã có phiên". */
    private fun hasSavedHaSession(): Boolean {
        val url = Prefs.webUrl(this) ?: Prefs.loginUrl(this) ?: Prefs.oneInput(this) ?: return false
        return HaLogin.hasAnyCookie(HaCookie.header(url))
    }

    /** `versionName` + `versionCode` từ `PackageInfo` (không cần bật `buildFeatures.buildConfig`). */
    private fun appVersion(): Pair<String?, Long> = try {
        val info = packageManager.getPackageInfo(packageName, 0)
        info.versionName to info.longVersionCode
    } catch (t: Throwable) {
        null to 0L
    }

    /** Mở màn **Chẩn đoán** (`DiagActivity`) — nút trên trang đầu (1.6) và trong Cài đặt. */
    private fun openDiag() {
        try {
            startActivity(Intent(this, DiagActivity::class.java))
        } catch (t: Throwable) {
            toast(getString(R.string.st_no_screen))
        }
    }

    private fun setStatus(text: String?) {
        statusView?.text = text.orEmpty()
        statusView?.visibility = if (text.isNullOrEmpty()) View.GONE else View.VISIBLE
    }

    // ------------------------------------------------------------------ (1.6) ĐĂNG XUẤT

    /**
     * (1.6) YÊU CẦU 2 — nút **“Đăng xuất”**: hỏi lại bằng [AlertDialog] (chữ đúng yêu cầu) rồi mới [performLogout].
     * Không làm gì khi bấm "Huỷ".
     */
    private fun confirmLogout() {
        AlertDialog.Builder(this)
            .setTitle(R.string.action_logout)
            .setMessage(R.string.logout_confirm)
            .setNegativeButton(R.string.logout_cancel, null)
            .setPositiveButton(R.string.action_logout) { _, _ -> performLogout() }
            .show()
    }

    /**
     * (1.6) **ĐĂNG XUẤT — bước 1/6 (mạng) rồi [finishLogout]**.
     *
     * Bước 1 = `POST <apiBase>/app/remove` `{id: phoneId}` ([PhoneApi.remove]) chạy ở **luồng nền** và phải chạy
     * **TRƯỚC** khi xoá cookie: gốc API có thể nằm sau ingress của Home Assistant nên lời gọi này cần cookie
     * `ingress_session`. Lỗi mạng / 401 / 404 **bỏ qua nhưng vẫn đi tiếp** — máy phải sạch dù server không trả lời.
     *
     * `apiBase` và `phoneId` được đọc **trước** khi xoá Prefs; danh sách bước do [Logout.plan] quyết (thuần, có test).
     */
    private fun performLogout() {
        val state = Logout.State(Prefs.apiBase(this), runCatching { Prefs.phoneId(this) }.getOrNull())
        val plan = Logout.plan(state)

        // Phản hồi ngay trên UI: chặn bấm 2 lần, đổi dòng trạng thái.
        findViewById<Button>(R.id.connectButton)?.isEnabled = false
        findViewById<Button>(R.id.logoutButton)?.isEnabled = false
        setStatus(getString(R.string.logout_running))

        Thread {
            val callServer = Logout.callsServer(state)
            val code = if (callServer) {
                // Cookie của phiên hiện tại là thứ duy nhất cho phép gọi /app/remove qua ingress.
                PhoneApi.remove(state.apiBase, state.phoneId.orEmpty(), HaCookie.header(state.apiBase))
            } else {
                null
            }
            val extra = if (callServer) Logout.reasonExtra(code) else "skip=" + Logout.REASON_SKIPPED
            log(Logout.line(Logout.Step.REMOVE_DEVICE, callServer && Logout.removed(code), extra))
            post { finishLogout(plan) }
        }.also { it.isDaemon = true; it.name = "logout-remove" }.start()
    }

    /**
     * (1.6) **ĐĂNG XUẤT — bước 2..6**, đúng thứ tự [Logout.ORDER] (mỗi bước ghi một dòng `[logout] step=… ok=…`):
     *
     *  2a. dừng [PhoneService] ([PhoneService.stop]) — không còn hỏi `/app/incoming`;
     *  2b. huỷ notification cuộc gọi đang có ([CallNotifications.cancel]) + đóng màn gọi ([IncomingCallActivity.dismissFor]);
     *  3.  xoá **toàn bộ** cookie của domain ([CookieManager.removeAllCookies] + `flush`) — để lần sau đăng nhập
     *      một **tài khoản Home Assistant khác**;
     *  4.  xoá dữ liệu WebView ([WebStorage.deleteAllData] = localStorage `hassTokens` của HA, `clearCache(true)`,
     *      `clearFormData`, `clearHistory`);
     *  5.  xoá Prefs ([Prefs.clearForLogout]) — chỉ giữ cờ “đã xem hướng dẫn” ([Logout.KEEP_KEYS]);
     *  6.  đưa UI về trạng thái ban đầu ([resetAfterLogout] + [showUrlScreen]) và hiện toast **“Đã đăng xuất”**.
     */
    private fun finishLogout(plan: List<Logout.Step>) {
        if (isFinishing || isDestroyed) return

        // 2a) Dừng dịch vụ nền (bỏ luôn foreground notification của service).
        log(Logout.line(Logout.Step.STOP_SERVICE, runCatching { PhoneService.stop(this) }.isSuccess))

        // 2b) Huỷ thông báo cuộc gọi + đóng màn hình gọi đang mở (nếu có).
        val cancelOk = runCatching {
            CallNotifications.cancel(this)
            RingState.stop()
            PhoneStatus.callId = null
            PhoneStatus.ringing = false
            PhoneStatus.needLogin = false
            PhoneStatus.handledCallId = null
            PhoneStatus.publish(this)
            IncomingCallActivity.dismissFor(null)
        }.isSuccess
        log(Logout.line(Logout.Step.CANCEL_CALL_NOTIFICATION, cancelOk))

        // 3) Xoá TOÀN BỘ cookie của domain (đăng nhập tài khoản khác phải sạch phiên cũ).
        val cookieOk = runCatching {
            val cm = CookieManager.getInstance()
            cm.setAcceptCookie(true)
            cm.removeAllCookies(null)
            cm.flush()
        }.isSuccess
        log(Logout.line(Logout.Step.CLEAR_COOKIES, cookieOk))

        // 4) Xoá dữ liệu WebView — localStorage của HA (`hassTokens`) nằm trong WebStorage.
        val webDataOk = runCatching {
            WebStorage.getInstance().deleteAllData()
            val w = WebView(this)
            w.clearCache(true)
            w.clearFormData()
            w.clearHistory()
            w.destroy()
        }.isSuccess
        log(Logout.line(Logout.Step.CLEAR_WEBVIEW_DATA, webDataOk))

        // 5) Xoá Prefs của app (giữ cờ "đã xem hướng dẫn").
        val removedKeys = runCatching { Prefs.clearForLogout(this) }.getOrElse { -1 }
        log(Logout.line(Logout.Step.CLEAR_PREFS, removedKeys >= 0, "keys=" + removedKeys))

        // 6) UI về trạng thái ban đầu: không còn webUrl/apiBase/phiên ⇒ nút "Đăng xuất" ẩn, ô nhập trống.
        resetAfterLogout()
        showUrlScreen(getString(R.string.status_not_connected))
        log(Logout.line(Logout.Step.RESET_UI, true, "steps=" + plan.size))
        toast(getString(R.string.logout_done))
    }

    /** Quên toàn bộ trạng thái trong bộ nhớ của phiên cũ (đăng xuất không được để lại URL/phiên nào). */
    private fun resetAfterLogout() {
        resetPromoteState()
        savedWebUrl = null
        targetUrl = null
        panelTarget = null
        haOrigin = null
        afterLoginUrl = null
        loadingUrl = null
        loadingReason = "-"
        loadResult = "-"
        allowedTlsHosts = emptySet()
        loginWatch = null
        loginFlowActive = false
        loginFailed = false
        originShown = false
        launchHadSession = false
        panelNavCount = 0
        lastPanelNavAt = 0L
        searching = false
        searchToken++
        DiagState.reset()
        DiagState.domain = null
        DiagState.webViewOpened = false
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
        // (28/11/2026) GD16 — quên giá trị WebView của phiên trước để màn Chẩn đoán không hiện URL cũ.
        DiagState.reset()
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
                    showNotFound(
                        getString(R.string.status_not_found_short, triedApi.firstOrNull() ?: "-")
                    )
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
                        showNotFound(
                            getString(R.string.status_web_not_found_short, webList.firstOrNull() ?: "-")
                        )
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

    /**
     * (1.6) Trạng thái LỖI **ngắn, đúng 1 dòng** (`activity_url.xml`: `maxLines=1` + `ellipsize=end`): chỉ tiêu đề +
     * địa chỉ đầu tiên đã thử. Danh sách đầy đủ các URL đã thử vẫn nằm trong **Chẩn đoán** (`Diag`), không bày trên
     * trang nhập nữa — yêu cầu "bỏ mọi khối chữ dài".
     */
    private fun showNotFound(message: String) {
        setStatus(message)
        toast(message)
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

        // (1.5) YÊU CẦU 1 — THANH THÔNG BÁO **GONE NGAY TỪ KHUNG HÌNH ĐẦU** (đã `gone` trong `activity_web.xml`,
        // đặt lại ngay sau `setContentView` để không có khung hình nào thanh hiện ra trong lúc kiểm tra phiên).
        // Chỉ [showLoginBar] với lý do "cần thật" của [LoginBar] mới bật nó lên.
        loginBar = findViewById(R.id.haLoginBar)
        loginBarText = findViewById(R.id.haLoginText)
        loginBar?.visibility = View.GONE
        lastBarLine = null
        pendingLoginBarReason = null
        mainHandler.removeCallbacks(loginBarSettleRunnable)

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
        // (1.5) YÊU CẦU 3 — GHI NHỚ "lần mở app này đã có phiên chưa" để bật **thời gian ân hạn** [LoginBar.SETTLE_MS]:
        // có phiên ⇒ trong 2,5 s đầu KHÔNG hiện thanh dù có 401/`/auth` tạm thời (panel/promote đang tự phục hồi) —
        // đây chính là 1–2 s nhấp nháy người dùng báo; hết ân hạn mà vẫn cần thì thanh mới hiện.
        launchAtMs = System.currentTimeMillis()
        launchHadSession = hasPanelSession()
        loginWatch = null
        loginFlowActive = false
        loginFailed = false
        // (1.4) Màn WebView dựng lại = "một lần mở app" mới ⇒ cờ của đường tự động quên hết, để nó được tự mở
        // dashboard đúng MỘT lần nữa (xem [autoOpenLatch] / [AutoOpen.Latch]).
        autoOpenLatch.reset()
        autoGiveUpLogged = false
        panelNavCount = 0
        lastPanelNavAt = 0L
        originShown = false
        loadingUrl = null
        loadingReason = "-"
        loadResult = "-"
        // (28/11/2026) GD16 — màn Chẩn đoán đọc các giá trị này khi WebView đang mở ở nền.
        DiagState.domain = haOrigin
        DiagState.webUrlInUse = savedWebUrl?.takeIf { DashboardTarget.isValidSaved(it) } ?: targetUrl
        DiagState.currentUrl = null
        DiagState.webViewOpened = true

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

        loginBarText = findViewById(R.id.haLoginText)
        loginBarText?.text = getString(R.string.ha_login_banner)
        findViewById<Button>(R.id.haLoginDoneButton).setOnClickListener { onLoginConfirmed() }
        findViewById<Button>(R.id.haDashboardButton).setOnClickListener { onOpenDashboardClicked() }
        findViewById<Button>(R.id.haRetryButton).setOnClickListener { onRetryClicked() }
        // (1.5) YÊU CẦU 1 — dựng màn xong vẫn KHÔNG hiện thanh: "chưa biết trạng thái" không phải "cần đăng nhập".
        showLoginBar(false, LoginBar.Reason.STARTUP)

        // (1.7) YÊU CẦU 1..6 — BONG BÓNG “KẾT NỐI” (44dp, icon bánh răng) KÉO ĐƯỢC khắp màn hình, nhớ vị trí.
        // Thay hẳn nút “URL” cố định (nó tự `GONE` sau 4 s và che nội dung một số trang).
        setupUrlBubble()
    }

    // ------------------------------------------------------------------ (1.7) BONG BÓNG KÉO ĐƯỢC

    /**
     * (1.7) **DỰNG BONG BÓNG “KẾT NỐI” KÉO ĐƯỢC** — đúng 6 yêu cầu của người dùng:
     *
     *  1. view là `ImageView` 44dp trong `webHost` (icon bánh răng `ic_bubble_settings`, nền tròn `url_button_bg`) —
     *     KHÔNG còn chữ “URL” (layout `activity_web.xml`);
     *  2. **kéo tự do** trong `webHost`: [BubbleTouchListener] cập nhật `margin` theo ngón tay ([moveBubble]);
     *  3. **tap** ⇒ [showUrlScreen] (hành vi cũ), **kéo** ⇒ không mở (ngưỡng ở [BubbleDrag.isTap]);
     *  4. **nhớ vị trí**: khôi phục từ [Prefs.bubblePos] (tỉ lệ 0..1), chưa có thì góc phải trên 12dp dưới status bar;
     *     lưu lại sau mỗi lần kéo ([saveBubblePos]);
     *  5. **luôn nằm trên WebView**: cùng `FrameLayout`, khai báo SAU WebView + `elevation` 8dp + `bringToFront()` mỗi
     *     lần chạm; alpha 0.55 / 0.85 khi kéo / 0.4 sau 5 s không chạm — **không bao giờ tự ẩn**;
     *  6. **không cản cuộn trang**: chỉ đúng vùng 44dp của bong bóng nhận sự kiện (`onTouch` trả `true` chỉ khi chạm
     *     vào nó); phần còn lại của `webHost` vẫn thuộc WebView.
     */
    private fun setupUrlBubble() {
        val host = findViewById<ViewGroup>(R.id.webHost) ?: return
        val bubble = findViewById<View>(R.id.urlBubble) ?: return
        bubbleHost = host
        urlBubble = bubble
        bubbleRatio = Prefs.bubblePos(this)
        bubbleHostW = host.width
        bubbleHostH = host.height
        bubbleDragging = false
        bubble.alpha = BubbleDrag.ALPHA_IDLE
        bubble.elevation = dp(8).toFloat()
        bubble.bringToFront()
        bubble.setOnClickListener { showUrlScreen() }
        bubble.setOnTouchListener(BubbleTouchListener())

        // Khung đổi kích thước (XOAY MÁY, thanh đăng nhập bật/tắt, màn hình khác) ⇒ đặt lại vị trí theo TỈ LỆ đã lưu:
        // đây là lý do phải lưu tỉ lệ 0..1 chứ không lưu px (yêu cầu 4).
        host.addOnLayoutChangeListener { _, l, t, r, bt, _, _, _, _ ->
            val w = r - l
            val h = bt - t
            if (w == bubbleHostW && h == bubbleHostH) return@addOnLayoutChangeListener
            bubbleHostW = w
            bubbleHostH = h
            applyBubblePos()
        }
        // Ngay sau `setContentView` khung có thể chưa bố cục (0x0) → chờ một nhịp.
        host.post { applyBubblePos() }
        armBubbleIdleFade()
    }

    /**
     * Đặt bong bóng về vị trí đã lưu ([bubbleRatio]) hoặc **mặc định góc phải trên** ([BubbleDrag.defaultPos]):
     * cách mép phải 12dp, cách mép trên 12dp dưới status bar (yêu cầu 4).
     */
    private fun applyBubblePos() {
        val host = bubbleHost ?: return
        val w = host.width
        val h = host.height
        if (w <= 0 || h <= 0) return
        val size = dp(BubbleDrag.SIZE_DP)
        val pos = bubbleRatio
            ?.let { BubbleDrag.fromRatio(it, w, h, size, bubbleTopInsetPx()) }
            ?: BubbleDrag.defaultPos(w, h, size, dp(BubbleDrag.EDGE_GAP_DP), bubbleTopInsetPx())
        moveBubble(pos.x, pos.y)
        // XML để `invisible` (không có khung hình nào bong bóng hiện SAI CHỖ ở góc trái trên): chỉ hiện sau lần đặt
        // vị trí ĐẦU TIÊN, khi khung đã có kích thước thật.
        urlBubble?.visibility = View.VISIBLE
    }

    /**
     * Dời bong bóng tới (`x`,`y`) px trong khung, **kẹp trong màn hình** ([BubbleDrag.clamp]) rồi ghi vào `margin`
     * của `FrameLayout.LayoutParams` — nhờ vậy vị trí là thật trong layout (không dùng `translationX/Y` để khỏi lệch
     * khi khung đổi kích thước) và không cần tính lại offset gốc.
     */
    private fun moveBubble(x: Float, y: Float) {
        val host = bubbleHost ?: return
        val bubble = urlBubble ?: return
        val size = dp(BubbleDrag.SIZE_DP)
        val p = BubbleDrag.clamp(BubbleDrag.Pos(x, y), host.width, host.height, size, bubbleTopInsetPx())
        val lp = bubble.layoutParams as? FrameLayout.LayoutParams ?: return
        lp.leftMargin = BubbleDrag.px(p.x)
        lp.topMargin = BubbleDrag.px(p.y)
        bubble.layoutParams = lp
        bubbleX = BubbleDrag.px(p.x).toFloat()
        bubbleY = BubbleDrag.px(p.y).toFloat()
    }

    /**
     * Lưu vị trí hiện tại dưới dạng **tỉ lệ 0..1** (`bubble_x`, `bubble_y`) — gọi sau mỗi lần KÉO.
     * Tỉ lệ (không phải px) nên lần mở sau / sau khi xoay máy bong bóng vẫn ở đúng góc tương ứng.
     */
    private fun saveBubblePos() {
        val host = bubbleHost ?: return
        if (host.width <= 0 || host.height <= 0) return
        val ratio = BubbleDrag.ratioOf(
            BubbleDrag.Pos(bubbleX, bubbleY),
            host.width,
            host.height,
            dp(BubbleDrag.SIZE_DP),
            bubbleTopInsetPx()
        )
        bubbleRatio = ratio
        Prefs.setBubblePos(this, ratio)
    }

    /** Hẹn lại mốc “5 s không chạm ⇒ mờ 0.4” (mỗi lần chạm đều đặt lại). */
    private fun armBubbleIdleFade() {
        mainHandler.removeCallbacks(bubbleIdleRunnable)
        mainHandler.postDelayed(bubbleIdleRunnable, BubbleDrag.FADE_AFTER_MS)
    }

    /**
     * Trang lỗi / cần lối thoát: bong bóng phải **nằm trên WebView** và ở độ đậm bình thường (yêu cầu 5) —
     * trước đây là “hiện lại nút URL rồi hẹn giờ ẩn”.
     */
    private fun bringBubbleToFront() {
        val b = urlBubble ?: return
        b.visibility = View.VISIBLE
        b.bringToFront()
        b.animate().cancel()
        b.animate().alpha(BubbleDrag.ALPHA_IDLE).setDuration(160).start()
        armBubbleIdleFade()
    }

    /**
     * Chiều cao vùng **status bar** cần chừa (px) — chỉ khác 0 khi cửa sổ vẽ TRÀN xuống dưới status bar
     * (`FLAG_FULLSCREEN` / `FLAG_LAYOUT_NO_LIMITS`). App dùng `Theme.Material.NoActionBar` (không tràn) nên bình
     * thường = 0, và 12dp mặc định đã nằm dưới status bar (yêu cầu 4: “dưới status bar”).
     */
    private fun bubbleTopInsetPx(): Int {
        val flags = window?.attributes?.flags ?: 0
        val overStatusBar = (flags and WindowManager.LayoutParams.FLAG_FULLSCREEN) != 0 ||
            (flags and WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS) != 0
        if (!overStatusBar) return 0
        val id = resources.getIdentifier("status_bar_height", "dimen", "android")
        return if (id > 0) runCatching { resources.getDimensionPixelSize(id) }.getOrDefault(0) else 0
    }

    /** dp → px (bong bóng 44dp, ngưỡng tap 8dp, khoảng cách mép 12dp đều tính bằng dp). */
    private fun dp(value: Int): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics).toInt()

    /**
     * (1.7) **CHẠM / KÉO BONG BÓNG** — trái tim của yêu cầu 2 + 3.
     *
     *  - `ACTION_DOWN`: ghi mốc ngón tay (`rawX/rawY` — toạ độ màn hình, không bị ảnh hưởng khi view tự dời), vị trí
     *    bắt đầu của bong bóng, thời điểm chạm; **sáng lên 0.85** ([BubbleDrag.ALPHA_DRAG]), `bringToFront()` để chắc
     *    chắn nằm trên WebView, và huỷ hẹn giờ mờ;
     *  - `ACTION_MOVE`: vượt **8dp** ⇒ coi là KÉO, dời bong bóng theo `start + (raw - down)`; chưa vượt ⇒ KHÔNG dời
     *    (rung tay vài px vẫn là “bấm”, bong bóng không bị giật);
     *  - `ACTION_UP`: **TAP** ⇔ chưa vượt 8dp **và** < 200 ms ([BubbleDrag.isTap]) ⇒ `performClick()` → mở màn Kết
     *    nối (hành vi cũ); **KÉO** ⇒ chỉ lưu vị trí ([saveBubblePos]), KHÔNG mở gì;
     *  - `ACTION_CANCEL`: trả alpha về 0.55, không mở.
     *
     * `onTouch` chỉ nhận sự kiện **trong phạm vi 44dp của bong bóng** nên cuộn trang (WebView) không bị cản — yêu cầu 6.
     */
    private inner class BubbleTouchListener : View.OnTouchListener {
        private var downRawX = 0f
        private var downRawY = 0f
        private var startX = 0f
        private var startY = 0f
        private var downAtMs = 0L

        override fun onTouch(v: View, e: MotionEvent): Boolean {
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downRawX = e.rawX
                    downRawY = e.rawY
                    startX = bubbleX
                    startY = bubbleY
                    downAtMs = SystemClock.uptimeMillis()
                    bubbleDragging = false
                    mainHandler.removeCallbacks(bubbleIdleRunnable)
                    v.animate().cancel()
                    v.alpha = BubbleDrag.ALPHA_DRAG
                    v.bringToFront()
                    return true
                }

                MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX - downRawX
                    val dy = e.rawY - downRawY
                    if (!bubbleDragging) {
                        val slop = dp(BubbleDrag.TAP_SLOP_DP).toFloat()
                        bubbleDragging = abs(dx) > slop || abs(dy) > slop
                    }
                    if (bubbleDragging) moveBubble(startX + dx, startY + dy)
                    return true
                }

                MotionEvent.ACTION_UP -> {
                    val dx = e.rawX - downRawX
                    val dy = e.rawY - downRawY
                    val heldMs = SystemClock.uptimeMillis() - downAtMs
                    val tap = !bubbleDragging &&
                        BubbleDrag.isTap(dx, dy, heldMs, dp(BubbleDrag.TAP_SLOP_DP).toFloat())
                    bubbleDragging = false
                    v.animate().cancel()
                    v.animate().alpha(BubbleDrag.ALPHA_IDLE).setDuration(160).start()
                    armBubbleIdleFade()
                    if (tap) {
                        // TAP = mở màn Kết nối. Gọi qua performClick() để giữ nguyên accessibility/onClick đã gắn.
                        v.performClick()
                        return true
                    }
                    // KÉO: chỉ nhớ vị trí, KHÔNG mở màn nào (yêu cầu 3).
                    saveBubblePos()
                    return true
                }

                MotionEvent.ACTION_CANCEL -> {
                    bubbleDragging = false
                    v.animate().cancel()
                    v.animate().alpha(BubbleDrag.ALPHA_IDLE).setDuration(160).start()
                    armBubbleIdleFade()
                    return true
                }
            }
            return false
        }
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
        // (1.7) Bong bóng thuộc màn WebView vừa bị huỷ: bỏ hẹn giờ mờ + quên tham chiếu (listener bố cục còn treo trên
        // view cũ, nhưng nó chỉ gọi applyBubblePos() và hàm đó thoát ngay khi bubbleHost == null).
        mainHandler.removeCallbacks(bubbleIdleRunnable)
        bubbleHost = null
        urlBubble = null
        bubbleDragging = false
        // (27/11/2026) GD15 / (28/11/2026) GD16 — bỏ timeout + hẹn giờ promote còn treo (WebView sắp bị huỷ).
        mainHandler.removeCallbacks(promoteTimeoutRunnable)
        mainHandler.removeCallbacks(promoteAfterPanelRunnable)
        mainHandler.removeCallbacks(promoteStartGuardRunnable)
        promotePending = false
        panelPromoteArmed = false
        DiagState.currentUrl = null
        stopLoginTick()
        loginFlowActive = false
        // (1.5) Bỏ hẹn giờ "xét lại thanh sau ân hạn" — WebView/thanh sắp bị huỷ.
        mainHandler.removeCallbacks(loginBarSettleRunnable)
        pendingLoginBarReason = null
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

    /**
     * (1.5) **CỬA DUY NHẤT** đổi visibility của thanh thông báo đăng nhập — mọi chỗ gọi (kể cả `true`) đều bị chính
     * sách thuần [LoginBar.decide] lọc lại:
     *
     *  1. lý do **không cần** (đang kiểm tra phiên, panel đang nạp, đường tự động mở dashboard…) ⇒ **KHÔNG hiện** —
     *     đây là chỗ giết hiệu ứng nhấp nháy 1–2 s của bản 1.4 (bật thanh vì "chưa biết trạng thái");
     *  2. **đã có phiên** (`session=yes`) ⇒ **KHÔNG BAO GIỜ hiện**, kể cả khung hình đầu (yêu cầu 3) ⇒ WebView không
     *     bị đẩy xuống rồi kéo lên (thanh nằm trong luồng layout);
     *  3. còn **thời gian ân hạn** ([LoginBar.SETTLE_MS]) mà lần mở app này đã có phiên ⇒ **hoãn**, hết ân hạn thì
     *     xét lại ([loginBarSettleRunnable] → [recheckLoginBarAfterSettle]) — chức năng không mất, chỉ không nhấp nháy;
     *  4. ẩn luôn là ẩn **NGAY** (`View.GONE`, không animate) — yêu cầu 5.
     *
     * Mỗi lần trạng thái **ĐỔI** ghi một dòng chẩn đoán `[ui] bar=show|hide reason=…` (xem [LoginBar.line]) vào
     * [Diag] + Logcat, **không** kích hoạt tự lưu tệp chẩn đoán ([DiagFile.shouldAutoSave] không khớp `[ui]`).
     *
     * @return `true` ⇔ thanh **THẬT SỰ** đang hiện sau khi xét chính sách (caller cần biết để mở lối thoát khác).
     */
    private fun showLoginBar(show: Boolean, reason: LoginBar.Reason): Boolean {
        val bar = loginBar ?: return false
        val hasSession = hasPanelSession()
        val settling = loginBarSettling()
        val decision = LoginBar.decide(show, reason, hasSession, settling)
        // Ẩn/hiện TRỰC TIẾP — không animate (yêu cầu 5: đăng nhập xong là thanh biến mất ngay, không "chậm").
        bar.visibility = if (decision.visible) View.VISIBLE else View.GONE
        mainHandler.removeCallbacks(loginBarSettleRunnable)
        // Bị hoãn CHỈ vì ân hạn ⇒ hẹn xét lại đúng lúc hết ân hạn (bị chặn vì `session` thì không bao giờ hiện).
        val recheck = show && reason.needed && decision.settling
        pendingLoginBarReason = if (recheck) reason else null
        if (recheck) {
            val elapsed = System.currentTimeMillis() - launchAtMs
            mainHandler.postDelayed(loginBarSettleRunnable, LoginBar.settleRemainingMs(elapsed) + 50L)
        }
        val line = LoginBar.line(decision, hasSession)
        if (line != lastBarLine) {
            lastBarLine = line
            log(line)
        }
        return decision.visible
    }

    /** Đang trong **thời gian ân hạn** [LoginBar.SETTLE_MS] kể từ lúc dựng màn WebView (chỉ khi đã có phiên). */
    private fun loginBarSettling(): Boolean =
        LoginBar.settling(launchHadSession, System.currentTimeMillis() - launchAtMs)

    /** Hết ân hạn: nếu vẫn còn lý do cần đăng nhập đang chờ thì xét lại (thanh hiện đúng lúc, không nhấp nháy). */
    private fun recheckLoginBarAfterSettle() {
        if (isFinishing || isDestroyed) return
        val reason = pendingLoginBarReason ?: return
        showLoginBar(true, reason)
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
            showLoginBar(false, LoginBar.Reason.LAN_NO_LOGIN)
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
            // (1.5) LÝ DO "CẦN THẬT" DUY NHẤT ở đây: chủ động mở trang đăng nhập HA (`startLoginFlow(openOrigin=true)`)
            // — chưa có phiên nên thanh hiện ngay; đã có phiên thì [LoginBar] ẩn (yêu cầu 3).
            showLoginBar(true, LoginBar.Reason.LOGIN_FLOW)
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
        DiagState.currentUrl = u
        // (28/11/2026) GD16 — panel của add-on BẮT ĐẦU nạp ⇒ đặt hẹn giờ promote 2,5 s (không chờ iframe).
        if (reason == LOAD_PANEL) armPromoteAfterPanel(u)
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
        panelNavCount = 0
        // (1.2) CHỈ tắt nhịp dò khi promote đã thành công. Chưa thành công thì nhịp dò 1 s PHẢI còn chạy: nó là chỗ
        // phát hiện `cookie=yes session=yes` để promote lại (bản 1.1 tắt nhịp ở đây nên sau lần 401 đầu tiên app
        // không bao giờ thấy phiên ingress xuất hiện — đúng log thật 12:58:01 → 12:58:14 đứng im ở panel).
        loginFailed = false
        if (promoteGate.succeeded) {
            stopLoginTick()
            loginFlowActive = false
        } else {
            loginFlowActive = true
            startLoginTick()
        }
        // Sau khi đã vào panel, các lần điều hướng tiếp theo là do NGƯỜI DÙNG (thanh bên của HA, trang con của
        // add-on) — không được coi là "lần nạp nhắm panel" nữa, nếu không app sẽ kéo người dùng về panel.
        loadingReason = LOAD_OTHER
        Prefs.setNeedHaLogin(this, false)
        showRetryButton(false)
        // (1.5) Panel đã nạp xong ⇒ ẨN NGAY (yêu cầu 5). Bản 1.4 gọi `showLoginBar(true)` ở `openDashboardNow`
        // sau đúng bước này ⇒ thanh nhấp nháy 1–2 s.
        showLoginBar(false, LoginBar.Reason.PANEL_OK)
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
        // (1.4) **PANEL VỪA MỞ ⇒ TỰ MỞ DASHBOARD NGAY** nếu đã có phiên (`ingress_session`) — không chờ nhịp dò và
        // không bấm nút. Gọi **đúng hàm của nút "Mở Dashboard"** ([openDashboardNow]) qua [autoOpenIfSessionReady].
        if (autoOpenIfSessionReady(!currentCookieHeader().isNullOrBlank(), hasPanelSession())) return
        // (27/11/2026) GD15 — BƯỚC THÊM: chuyển sang TOP-LEVEL để `getUserMedia` không bị Permissions Policy của
        // iframe HA chặn (xem [IngressPromote]). (1.2) Phiên đã có ⇒ `armPromoteAfterPanel` promote NGAY
        // ([promoteIfSessionReady]); hẹn giờ 2,5 s chỉ là lưới an toàn, và lần thử đó cũng phải có phiên.
        armPromoteAfterPanel(u)
    }

    // ------------------------------------------------ (28/11/2026) GD16 — promote panel → top-level ingress

    /** Quên trạng thái promote (dùng khi người dùng bấm "Kết nối" — một "lần mở app" mới). */
    private fun resetPromoteState() {
        mainHandler.removeCallbacks(promoteTimeoutRunnable)
        mainHandler.removeCallbacks(promoteAfterPanelRunnable)
        mainHandler.removeCallbacks(promoteStartGuardRunnable)
        promoteGate.reset()
        // (1.4) "Lần mở app mới" ⇒ cờ của đường tự động cũng quên hết (được tự mở dashboard lại).
        autoOpenLatch.reset()
        autoGiveUpLogged = false
        promoteAttempt = 0
        promoteLimitLogged = false
        promotePending = false
        promoteUrl = null
        promoteTokenSource = "-"
        promoteOrigin = null
        promoteFallback = false
        panelPromoteArmed = false
        rootFallbackTried = false
    }

    /**
     * (1.2) Đặt hẹn giờ promote [IngressPromote.PANEL_PROMOTE_DELAY_MS] (2,5 s) kể từ khi panel BẮT ĐẦU nạp.
     *
     * **Không còn là đường chính** (bản 1.1 dựa vào nó ⇒ promote bắn lúc chưa có phiên ⇒ 401 rồi bị khoá): promote
     * thật chạy ngay khi nhịp dò thấy `cookie=yes session=yes` ([promoteIfSessionReady]). Hẹn giờ ở đây chỉ để nếu
     * nhịp dò không chạy thì vẫn có một lần thử, và lần thử đó **cũng phải có phiên** (xem [promoteNow]).
     *
     * Bỏ qua khi: đã thành công ([promoteGate] → `skip=already`) hoặc chế độ IP LAN (không có ingress).
     */
    private fun armPromoteAfterPanel(panel: String?, force: Boolean = false) {
        if (isFinishing || isDestroyed) return
        if (promoteGate.succeeded) {
            log(IngressPromote.skipLine(panel, IngressPromote.Decision.ALREADY))
            return
        }
        if (isLanMode()) {
            log(IngressPromote.skipLine(panel, IngressPromote.Decision.NO_URL, "lan=yes"))
            return
        }
        // (1.2) Phiên đã có sẵn ⇒ promote NGAY, không chờ 2,5 s.
        if (promoteIfSessionReady(PROMOTE_REASON_PANEL_READY)) return
        if (panelPromoteArmed && !force) return
        panelPromoteArmed = true
        mainHandler.removeCallbacks(promoteAfterPanelRunnable)
        mainHandler.postDelayed(promoteAfterPanelRunnable, IngressPromote.PANEL_PROMOTE_DELAY_MS)
        log(IngressPromote.armLine(panel))
    }

    /**
     * (1.2) **PROMOTE NGAY KHI PHIÊN ĐÃ SẴN SÀNG** — đúng yêu cầu "promote chạy ngay khi phát hiện
     * `cookie=yes session=yes` (trong `loginTick`/`onPageFinished`), không chờ hẹn giờ 2,5 s".
     *
     * Chưa có phiên thì **không** promote (tránh đúng cái 401 vô ích trong log thật) — nhịp dò 1 s sẽ gọi lại đây
     * khi phiên xuất hiện, và [IngressPromote.Gate] giới hạn 3 lần cách nhau ≥ 1,5 s.
     *
     * @return true nếu đã bắt đầu nạp top-level.
     */
    private fun promoteIfSessionReady(reason: String): Boolean {
        if (isFinishing || isDestroyed) return false
        if (promoteGate.succeeded || promotePending) return false
        if (!hasPanelSession()) return false
        // Có phiên ⇒ promote luôn; chỉ khi promote THẬT SỰ bắt đầu mới huỷ hẹn giờ (nếu không, giữ lưới an toàn).
        if (!promoteNow(reason, sessionTriggered = true)) return false
        panelPromoteArmed = false
        mainHandler.removeCallbacks(promoteAfterPanelRunnable)
        return true
    }

    /**
     * (28/11/2026) GD16 / (1.2) — **PROMOTE** (nạp top-level ingress), có **cổng thử lại**:
     *
     *  1. [promoteGate] — `skip=already` **chỉ** khi đã `ok=top`; tối đa [IngressPromote.MAX_PROMOTE_ATTEMPTS]
     *     (3) lần, cách nhau ≥ [IngressPromote.PROMOTE_RETRY_GAP_MS] (1,5 s);
     *  2. dựng `https://<domain>/api/hassio_ingress/<TOKEN>/launcher-config.html` — TOKEN ưu tiên đọc từ `src` của
     *     iframe (nếu có), không thì [Prefs.ingressToken] (mặc định `KJjH…`);
     *  3. nạp top-level + bật timeout [PROMOTE_TIMEOUT_MS] (4 s);
     *  4. [fallbackFromPanel] = promote vì **panel không nạp được** → thất bại thì còn thử gốc domain
     *     (`https://<domain>/launcher-config.html`, xem [loadRootFallback]).
     *
     * Phiên `ingress_session` là điều kiện của mọi đường thường (đúng log thật: promote lúc `session=no` chỉ tốn một
     * lần 401 rồi bị khoá). Chỉ đường dự phòng "panel hỏng" mới thử khi chưa đọc được cookie.
     *
     * @return true nếu đã bắt đầu nạp top-level.
     */
    private fun promoteNow(
        reason: String,
        fallbackFromPanel: Boolean = false,
        sessionTriggered: Boolean = false,
    ): Boolean {
        if (isFinishing || isDestroyed) return false
        if (!showingWeb || webView == null) {
            log("[promote] skip=no_webview reason=$reason")
            return false
        }
        if (isLanMode()) {
            log(IngressPromote.skipLine(null, IngressPromote.Decision.NO_URL, "lan=yes reason=$reason"))
            return false
        }
        val origin = DashboardTarget.originOf(webView?.url)
            ?: DashboardTarget.originOf(targetUrl)
            ?: haOrigin
            ?: DashboardTarget.originOf(savedWebUrl)
        val preview = IngressPromote.topUrl(origin, Prefs.ingressToken(this))
        val session = hasPanelSession()
        val decision = promoteGate.decide(session, preview, requireSession = !fallbackFromPanel)
        when (decision) {
            IngressPromote.Decision.PROMOTE -> Unit
            // Vừa promote < 1,5 s trước → im lặng (nhịp dò 1 s không được spam log).
            IngressPromote.Decision.WAIT -> return false
            IngressPromote.Decision.LIMIT -> {
                if (!promoteLimitLogged) {
                    promoteLimitLogged = true
                    log(
                        IngressPromote.skipLine(
                            preview, decision,
                            "try=" + promoteGate.attempts + "/" + promoteGate.maxAttempts + " reason=" + reason
                        )
                    )
                }
                return false
            }
            // ALREADY (đã ok=top) / NO_SESSION / NO_URL → giữ panel, ghi rõ lý do.
            else -> {
                log(IngressPromote.skipLine(preview ?: promoteUrl, decision, "reason=$reason"))
                return false
            }
        }
        val attempt = promoteGate.take()
        if (attempt <= 0) return false
        promoteAttempt = attempt
        promoteFallback = fallbackFromPanel
        promoteOrigin = origin
        if (!sessionTriggered) log(IngressPromote.fireLine(reason, session))
        // Lưới an toàn: JS đọc `src` iframe là bất đồng bộ — quá hạn thì promote bằng TOKEN đã lưu.
        mainHandler.removeCallbacks(promoteStartGuardRunnable)
        mainHandler.postDelayed(promoteStartGuardRunnable, IngressPromote.PROMOTE_TOKEN_READ_MS)
        val web = webView
        if (web == null) {
            finishPromoteStart(null)
            return true
        }
        try {
            web.evaluateJavascript(HaIngress.panelFrameSrcScript()) { raw ->
                finishPromoteStart(HaIngress.readFrameSrc(raw))
            }
        } catch (t: Throwable) {
            finishPromoteStart(null)
        }
        return true
    }

    /** Đã có (hoặc không có) `src` iframe → nạp top-level. Chỉ chạy MỘT lần cho mỗi lần promote. */
    private fun finishPromoteStart(frameSrc: String?) {
        mainHandler.removeCallbacks(promoteStartGuardRunnable)
        if (isFinishing || isDestroyed) return
        if (promotePending) return
        val origin = promoteOrigin ?: haOrigin ?: return
        startPromote(origin, frameSrc)
    }

    /**
     * Nạp **TOP-LEVEL** `https://<domain>/api/hassio_ingress/<TOKEN>/launcher-config.html` + bật timeout 4 s.
     * [frameSrc] = `src` của iframe trong panel (nguồn TOKEN chính xác nhất); null = dùng TOKEN đã lưu.
     *
     * (1.2) Ghi `[promote] retry=<n> url=…` — đúng dòng người dùng cần thấy khi promote chạy lại sau khi có phiên.
     */
    private fun startPromote(origin: String?, frameSrc: String?) {
        if (promotePending || isFinishing || isDestroyed) return
        // Người dùng đã rời màn WebView (bấm "URL" / Cài đặt) trong lúc đọc iframe → không promote nữa.
        if (!showingWeb || webView == null) return
        val frameToken = IngressPromote.tokenFromUrl(frameSrc)
        val top = IngressPromote.topUrl(origin, frameToken ?: Prefs.ingressToken(this))
        if (top == null) {
            log(IngressPromote.skipLine(null, IngressPromote.Decision.NO_URL))
            return
        }
        promotePending = true
        promoteUrl = top
        promoteTokenSource = if (frameToken != null) "frame" else "prefs"
        DiagState.lastPromoteUrl = top
        log(
            IngressPromote.retryLine(
                promoteAttempt, top,
                "token=" + promoteTokenSource +
                    " session=" + yn(hasPanelSession()) +
                    " try=" + promoteAttempt + "/" + IngressPromote.MAX_PROMOTE_ATTEMPTS
            )
        )
        mainHandler.removeCallbacks(promoteTimeoutRunnable)
        mainHandler.postDelayed(promoteTimeoutRunnable, PROMOTE_TIMEOUT_MS)
        runCatching { CookieManager.getInstance().flush() }
        loadWeb(top, LOAD_PROMOTE)
    }

    /** Lần nạp hiện tại có phải chính trang top-level đang chờ kết luận không. */
    private fun isPromoteNavigation(url: String?): Boolean =
        promotePending && WebTargetResolver.sameUrl(url, promoteUrl)

    /**
     * (28/11/2026) GD16 — dò **loại trang** top-level bằng JS ([HaIngress.panelProbeScript]) rồi kết luận: add-on
     * (`launcher-config` / `Dashboard OS`) → giữ; SPA HA / `/auth` → quay lại panel.
     */
    private fun probePromotePage(url: String?, title: String?) {
        val web = webView
        if (web == null) {
            onPromoteLoaded(url, null, title)
            return
        }
        try {
            web.evaluateJavascript(HaIngress.panelProbeScript()) { raw ->
                if (isFinishing || isDestroyed) return@evaluateJavascript
                val kind = IngressPromote.pageKind(HaIngress.readProbe(raw))
                log(
                    "[promote] probe url=" + DashboardTarget.shortUrl(url) +
                        " kind=" + kind.label + " title=" + (title ?: "-")
                )
                onPromoteLoaded(url, null, title, kind)
            }
        } catch (t: Throwable) {
            onPromoteLoaded(url, null, title)
        }
    }

    /**
     * Trang top-level đã nạp xong: dùng được ⇒ `[promote] url=… ok=top`, chốt phiên và để API native chạy với base
     * ingress + cookie; là SPA của HA / `/auth` ⇒ coi như thất bại và quay lại panel.
     *
     * (1.2) Thành công ⇒ [IngressPromote.Gate.success] — **đây là điều kiện DUY NHẤT** để sau đó log
     * `skip=already`; thất bại thì vẫn giữ quyền thử lại (xem [onPromoteFailed]).
     */
    private fun onPromoteLoaded(
        url: String?,
        status: Int?,
        title: String?,
        kind: IngressPromote.PageKind = IngressPromote.PageKind.UNKNOWN,
        html: String? = null,
    ) {
        if (!promotePending) return
        mainHandler.removeCallbacks(promoteTimeoutRunnable)
        val top = promoteUrl ?: url
        val landed = url ?: promoteUrl
        // Kết luận SAI (401/403, SPA HA, `/auth`, timeout…, hoặc URL không còn sau ingress) → [onPromoteFailed] xử lý
        // (promotePending còn bật nên nó không return sớm; nó tắt cờ + quay lại panel + GIỮ quyền thử lại).
        if (!IngressPromote.keepTopLevel(status, title, html, kind, landed)) {
            onPromoteFailed(IngressPromote.failReason(status, title, html, kind))
            return
        }
        promotePending = false
        promoteGate.success()
        // (1.4) Top-level đã dùng được ⇒ đường tự động **thôi** (đúng "một lần mỗi lần mở app").
        autoOpenLatch.success()
        DiagState.lastPromoteResult = IngressPromote.OK_TOP
        log(
            IngressPromote.logLine(
                top, IngressPromote.OK_TOP, "title=" + (title ?: "-") + " kind=" + kind.label
            )
        )
        // Đang ở top-level ingress: các lần điều hướng tiếp theo là của người dùng (trang con của add-on) — không
        // còn là "lần nạp nhắm panel" nữa.
        loadingReason = LOAD_OTHER
        loadResult = IngressPromote.OK_TOP
        loginFlowActive = false
        loginFailed = false
        stopLoginTick()
        showLoginBar(false, LoginBar.Reason.TOP_OK)
        // (4) API native dùng đúng base ingress + cookie `ingress_session` đã có ⇒ PhoneService chạy bình thường.
        ensureIngressApiBase(top)
        runCatching { CookieManager.getInstance().flush() }
        registerInBackground()
        if (Prefs.receiveEnabled(this)) PhoneService.start(this)
    }

    /**
     * Promote thất bại (401/403, SPA HA, redirect, timeout, mất mạng): ghi
     * `[promote] url=… ok=401 fail=<lý do> fallback=panel` rồi **quay lại panel (iframe)** để người dùng vẫn dùng được
     * UI.
     *
     * (1.2) **KHÔNG khoá promote nữa**: thất bại chỉ tốn một lượt trong [IngressPromote.Gate]; khi panel mở lại và
     * nhịp dò thấy `session=yes`, app thử lại (tối đa 3 lần, cách nhau ≥ 1,5 s). Đúng lỗi trong log thật: bản 1.1
     * đặt `already` ngay sau lần 401 đầu tiên nên lúc phiên xuất hiện app đứng im ở panel.
     *
     * (28/11/2026) GD16 — nếu promote này chạy vì **panel không nạp được** thì trước khi quay lại panel còn thử
     * dự phòng cuối `https://<domain>/launcher-config.html` (một lần).
     */
    private fun onPromoteFailed(reason: String) {
        if (!promotePending) return
        mainHandler.removeCallbacks(promoteTimeoutRunnable)
        promotePending = false
        val top = promoteUrl
        DiagState.lastPromoteResult = IngressPromote.OK_FAIL
        log(IngressPromote.failLine(top, reason))
        loadResult = IngressPromote.OK_FAIL
        // (1.2) Vẫn còn lượt ⇒ nói rõ để người dùng thấy app sẽ thử lại (không còn `skip=already` sau thất bại).
        if (!promoteGate.succeeded && promoteGate.attemptsLeft > 0) {
            log(IngressPromote.retryLeftLine(promoteGate.attemptsLeft, hasPanelSession()))
        }
        if (promoteFallback && !rootFallbackTried) {
            if (loadRootFallback("promote_$reason")) return
        }
        val panel = panelTarget ?: DashboardTarget.panelUrl(haOrigin)
        if (panel == null) {
            // Không có panel để quay lại (dữ liệu cũ) → hiện thông báo + nhịp dò tiếp tục.
            loginBarText?.text = getString(R.string.ha_panel_banner)
            showLoginBar(true, LoginBar.Reason.GIVE_UP)
            return
        }
        // QUAY LẠI PANEL: nạp lại đúng panel của HA (iframe) — người dùng vẫn vào được UI như trước.
        loginBarText?.text = getString(R.string.ha_panel_banner)
        // (1.5) Quay lại panel = "đang nạp lại", KHÔNG phải "cần đăng nhập" ⇒ lý do [LoginBar.Reason.PANEL_WAIT]
        // KHÔNG bật thanh (bản 1.4 bật ở đây ⇒ nhấp nháy mỗi lần promote thất bại). Panel nạp xong thì
        // `onPanelLoaded` ẩn; panel vẫn hỏng thì `onAuthRequired`/`onLoginFailed` sẽ bật với lý do đúng.
        showLoginBar(true, LoginBar.Reason.PANEL_WAIT)
        loadWeb(panel, LOAD_PANEL)
    }

    /**
     * (28/11/2026) GD16 / (1.2) — **PANEL KHÔNG NẠP ĐƯỢC** (404/không mạng/HA chỉ trả SPA của nó): thử NGAY top-level
     * ingress (nếu còn lượt), rồi tới `https://<domain>/launcher-config.html` ([loadRootFallback]).
     */
    private fun onPanelUnavailable(reason: String) {
        if (isFinishing || isDestroyed) return
        log(IngressPromote.panelFailLine(reason, if (!promoteGate.succeeded) "ingress" else "root"))
        // fallbackFromPanel = true: panel hỏng nên vẫn thử ingress dù chưa đọc được cookie phiên.
        if (promoteNow("panel_fail_$reason", fallbackFromPanel = true)) return
        if (loadRootFallback("panel_fail_$reason")) return
        log("[promote] give_up reason=$reason")
        onLoginFailed(null)
    }

    /**
     * (28/11/2026) GD16 — dự phòng CUỐI: `https://<domain>/launcher-config.html` (add-on phục vụ thẳng ở gốc domain).
     * Chỉ một lần ([rootFallbackTried]) để không lặp vô hạn.
     */
    private fun loadRootFallback(reason: String): Boolean {
        if (rootFallbackTried) return false
        val origin = haOrigin
            ?: DashboardTarget.originOf(webView?.url)
            ?: DashboardTarget.originOf(targetUrl)
            ?: DashboardTarget.originOf(savedWebUrl)
        val root = IngressPromote.rootUrl(origin) ?: return false
        rootFallbackTried = true
        log(IngressPromote.rootLine(root, reason))
        loadWeb(root, LOAD_ROOT_FALLBACK)
        return true
    }

    /**
     * (28/11/2026) GD16 — kết luận trang dự phòng cuối (`https://<domain>/launcher-config.html`): là add-on → giữ;
     * không phải → quay lại panel / báo thất bại (không lặp).
     */
    private fun onRootFallbackLoaded(url: String?, arrival: DashboardTarget.Arrival, title: String?) {
        if (arrival == DashboardTarget.Arrival.ADDON) {
            log("[promote] url=" + DashboardTarget.shortUrl(url) + " ok=root title=" + (title ?: "-"))
            DiagState.lastPromoteResult = "root"
            loadResult = "root"
            loadingReason = LOAD_OTHER
            loginFlowActive = false
            loginFailed = false
            stopLoginTick()
            showLoginBar(false, LoginBar.Reason.ROOT_OK)
            Prefs.setNeedHaLogin(this, false)
            runCatching { CookieManager.getInstance().flush() }
            registerInBackground()
            if (Prefs.receiveEnabled(this)) PhoneService.start(this)
            return
        }
        log("[promote] url=" + DashboardTarget.shortUrl(url) + " ok=401 fail=root-not-addon fallback=panel")
        val panel = panelTarget ?: DashboardTarget.panelUrl(haOrigin)
        if (panel != null) {
            loadWeb(panel, LOAD_PANEL)
            return
        }
        onLoginFailed(null)
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
        // (28/11/2026) GD16 — panel của add-on không dùng được (404 / SPA HA / lỗi): thử NGAY top-level ingress, rồi
        // `https://<domain>/launcher-config.html` (không đi tiếp danh sách biến thể như trước).
        if (url != null && DashboardTarget.isPanel(url)) {
            onPanelUnavailable(reason)
            return
        }
        loginFailed = false
        // (1.5) Trang vừa nạp KHÔNG phải add-on (SPA HA / sai đường dẫn) = **cần thật** (người dùng phải biết),
        // nhưng nếu đã có phiên thì [LoginBar] vẫn ẩn (yêu cầu 3) — khi đó lối thoát là BONG BÓNG ở góc màn hình + màn hình lỗi.
        showLoginBar(true, LoginBar.Reason.WRONG_PAGE)
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

    /**
     * (28/11/2026) GD16 — ghi MỘT dòng chẩn đoán vào [Diag] (ring buffer 300 dòng, có `HH:mm:ss`) **và** Logcat
     * (tag [LOG_TAG_LOGIN] — `adb logcat -s DashboardOS-login`). Nhờ vậy người dùng không cần adb: Cài đặt →
     * Chẩn đoán → Sao chép.
     */
    private fun log(line: String) {
        Diag.log(line)
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
     *  2. **(1.4)** `cookie=yes session=yes` (hoặc chỉ cần **`session=yes`**) → **ĐƯỜNG TỰ ĐỘNG**: gọi
     *     [autoOpenIfSessionReady] → **đúng hàm của nút "Mở Dashboard"** ([openDashboardNow]), một lần mỗi lần mở app
     *     (`[auto] openDashboard reason=session_ready`). Đây là nhịp phát hiện phiên ingress xuất hiện muộn (log thật:
     *     panel 12:57:29 `session=no`, phiên có lúc 12:58:01) — và cũng là đường đã **thiếu** ở 1.2 (người dùng phải
     *     bấm nút mới vào được add-on);
     *  3. URL là **panel** → để `onPageFinished` chốt (`ok=panel`);
     *  4. URL ở `/auth/…` → chờ người dùng đăng nhập (`ok=login`); chỉ điều hướng khi đã có cookie;
     *  5. URL **cùng origin mà không phải `/auth/`** (Lovelace, `/`, `/lovelace/0`…) → `ok=ha-spa` rồi **điều hướng
     *     sang panel ngay** — đúng yêu cầu "không để người dùng kẹt ở Lovelace".
     */
    private fun loginTick() {
        if (isFinishing || isDestroyed) return
        // (27/11/2026) GD15 — đang chờ kết luận của trang TOP-LEVEL (promote): nhịp dò không được kéo WebView về panel.
        if (promotePending) return
        val url = webView?.url
        val cookiePresent = !currentCookieHeader().isNullOrBlank()
        val sessionPresent = hasPanelSession()
        // (1.5) YÊU CẦU 5 — vừa thấy **đã có phiên** ⇒ đăng nhập xong: ẨN THANH NGAY (không chờ panel/promote chốt,
        // không animate). Ngược lại (chưa có phiên) thì không đụng gì: thanh chỉ hiện theo lý do "cần thật".
        if (sessionPresent) showLoginBar(false, LoginBar.Reason.SESSION_READY)
        // (1.4) ƯU TIÊN SỐ 1 — **ĐƯỜNG TỰ ĐỘNG**: có phiên ⇒ gọi **đúng hàm mà nút "Mở Dashboard" gọi**
        // ([openDashboardNow]). KHÔNG gate, KHÔNG `promoteIfSessionReady`, KHÔNG chờ hẹn giờ 2,5 s — đó chính là
        // các điều kiện trung gian đã **không** kích hoạt trên máy thật (1.2) dù log có `cookie=yes session=yes`.
        // Cờ riêng [autoOpenLatch] giữ đúng "một lần mỗi lần mở app" và tối đa 3 lần cách 1,5 s khi phải thử lại.
        if (autoOpenIfSessionReady(cookiePresent, sessionPresent)) return
        // (28/11/2026) GD16 — panel đang nạp và đã có hẹn giờ promote ⇒ KHÔNG điều hướng lại (chỉ cần chờ 2,5 s).
        if (panelPromoteArmed && loadingReason == LOAD_PANEL) return
        val auth = DashboardTarget.isAuthPage(url)
        val sameOrigin = HaLogin.isSameOrigin(url, haOrigin)
        val cookieInfo = "cookie=" + yn(cookiePresent) + " session=" + yn(sessionPresent)

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
                // (1.5) URL là `/auth/…` = **cần thật** (yêu cầu 2) — nhưng nếu đã có phiên thì [LoginBar] vẫn ẩn
                // (yêu cầu 3: không bao giờ nhấp nháy); trang đăng nhập của HA vẫn dùng được bình thường.
                showLoginBar(true, LoginBar.Reason.AUTH_URL)
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
     * (30/11/2026) GD18 / **(1.4) — ĐƯỜNG TỰ ĐỘNG DUY NHẤT**: đã có phiên ⇒ gọi **đúng hàm của nút "Mở Dashboard"**
     * ([openDashboardNow]) — không đi qua `promoteGate`/`promoteIfSessionReady`/hẹn giờ 2,5 s.
     *
     * Vì sao phải viết lại đúng như vậy (sự thật đã kiểm chứng trên máy thật, bản 1.2): đăng nhập HA xong app **vẫn
     * không tự chuyển**, người dùng **phải bấm nút "Mở Dashboard"** thì mới vào được add-on ⇒ thân của nút là code
     * **chạy ĐÚNG**, còn chuỗi điều kiện trung gian của đường tự động cũ thì **không** kích hoạt dù log có
     * `cookie=yes session=yes`. Bản 1.4 vì thế **tái dùng** đúng thân nút, chỉ thêm cờ [autoOpenLatch].
     *
     * Gọi từ nhịp dò 1 s ([loginTick], ưu tiên số 1) và từ [onPanelLoaded] (panel vừa mở ⇒ mở ngay, không chờ nhịp).
     *
     * Điều kiện còn lại — **chỉ những thứ không thể bỏ**:
     *  - đang ở màn WebView, chưa finishing ([openDashboardNow] cần WebView);
     *  - **không** phải chế độ IP LAN (không có ingress/phiên HA → không có gì để mở);
     *  - không đang chờ kết luận một lần promote khác (tránh hai lần nạp chồng nhau);
     *  - [autoOpenLatch]: chưa `ok=top`, còn lượt ([AutoOpen.MAX_ATTEMPTS] = 3), đủ giãn cách
     *    ([AutoOpen.RETRY_GAP_MS] = 1,5 s) ⇒ **không lặp vô hạn** khi top-level trả 401/SPA HA.
     *
     * Mỗi nhịp (chỉ khi `session=yes`, để không spam) ghi **một** dòng chẩn đoán
     * `[auto] tick cookie=… session=… called=yes/no` vào [Diag] + Logcat.
     *
     * @return true nếu nhịp này **đã** gọi [openDashboardNow] (caller phải dừng điều hướng khác).
     */
    private fun autoOpenIfSessionReady(cookiePresent: Boolean, sessionPresent: Boolean): Boolean {
        if (isFinishing || isDestroyed) return false
        if (!sessionPresent) return false
        val callable = showingWeb && webView != null && !isLanMode() && !promotePending &&
            !autoOpenLatch.done && autoOpenLatch.decide()
        // (4) dòng chẩn đoán mỗi nhịp 1 s — CHỈ khi đã có phiên (lúc đang đăng nhập thì im lặng).
        log(AutoOpen.tickLine(cookiePresent, sessionPresent, callable))
        if (!callable) {
            // Hết lượt tự gọi mà vẫn chưa `ok=top` → nói rõ MỘT lần rồi để người dùng bấm nút (không lặp vô hạn).
            if (!autoGiveUpLogged && !autoOpenLatch.done && autoOpenLatch.attemptsLeft == 0) {
                autoGiveUpLogged = true
                log(AutoOpen.giveUpLine(autoOpenLatch.attempts, sessionPresent))
            }
            return false
        }
        val attempt = autoOpenLatch.take()
        if (attempt <= 0) return false
        log(AutoOpen.attemptLine(attempt))
        log(AutoOpen.openLine(AutoOpen.REASON_SESSION_READY))
        openDashboardNow(AutoOpen.REASON_SESSION_READY)
        return true
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
            showRetryButton(true)
            loginBarText?.text = getString(R.string.ha_panel_retry_hint, DashboardTarget.shortUrl(panel))
            // (1.5) Hết lượt điều hướng = **cần thật** (cần lối thoát "Thử lại"), nhưng nếu đã có phiên thì
            // [LoginBar] ẩn thanh (yêu cầu 3) ⇒ mở màn hình lỗi của WebView, vẫn còn liên kết "Thử lại".
            val shown = showLoginBar(true, LoginBar.Reason.GIVE_UP)
            if (!shown) {
                showLoginPanel(
                    getString(R.string.ha_login_failed_title),
                    getString(R.string.ha_panel_retry_hint, DashboardTarget.shortUrl(panel)),
                    withRetry = true
                )
            }
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
     * (28/11/2026) GD16 / (1.2) — panel đang hiện SPA của HA (frontend chưa dựng panel / đường dẫn không tồn tại).
     *
     * KHÔNG dò iframe: phiên đã có thì promote NGAY ([promoteIfSessionReady]), chưa có thì **để nhịp dò 1 s** promote
     * khi phiên xuất hiện (đúng lỗi người dùng: phiên chỉ có sau ~30 s); hẹn giờ 2,5 s chỉ là lưới an toàn.
     */
    private fun onPanelSpa(url: String?) {
        // (1.2) Đã promote thành công rồi (người dùng TỰ quay lại panel) ⇒ tôn trọng, không kéo đi đâu nữa.
        if (promoteGate.succeeded) return
        // (1.2) Phiên đã có ⇒ promote ngay; chưa có thì nhịp dò 1 s sẽ promote khi phiên xuất hiện.
        if (promoteIfSessionReady(PROMOTE_REASON_PANEL_READY)) return
        armPromoteAfterPanel(url ?: panelTarget)
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
        // (1.5) Hết cách = **cần thật** (lối thoát "Thử lại"/"Đăng nhập"). Đã có phiên ⇒ [LoginBar] ẩn thanh
        // (yêu cầu 3); lối thoát vẫn còn nhờ màn hình lỗi của WebView ngay bên dưới ([showLoginPanel]).
        showLoginBar(true, LoginBar.Reason.GIVE_UP)
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
        // (1.5) Người dùng bấm "Thử lại" ⇒ **cần thật** (yêu cầu 2): hiện thanh để thấy tiến trình; có phiên thì
        // [LoginBar] vẫn ẩn (yêu cầu 3).
        showLoginBar(true, LoginBar.Reason.USER_RETRY)
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
     * Nút **"Mở Dashboard"** (LUÔN hiện ở màn đăng nhập): người dùng chủ động, không chờ nhịp dò.
     *
     * (1.4) Thân của nút đã **tách** thành [openDashboardNow] — để **đường tự động** ([autoOpenIfSessionReady], khi
     * nhịp dò thấy đã có phiên) gọi **đúng cùng một hàm**, không có logic thứ hai. Nút chỉ còn: một "lần mở app mới"
     * cho cờ tự động ([autoOpenLatch]) rồi gọi [openDashboardNow] ở chế độ `manual = true`.
     */
    private fun onOpenDashboardClicked() {
        // Bấm nút = người dùng muốn vào lại ⇒ cho đường tự động quyền chạy lại (nếu sau này phiên mất rồi có lại).
        autoOpenLatch.reset()
        autoGiveUpLogged = false
        openDashboardNow(AutoOpen.REASON_MANUAL, manual = true)
    }

    /**
     * (1.4) **MỞ DASHBOARD NGAY** — *toàn bộ* thân của nút "Mở Dashboard" (code **đang chạy ĐÚNG** trên máy thật,
     * bản 1.2 đã kiểm chứng: bấm nút là vào được add-on). Đây là hàm **DUY NHẤT** mở dashboard:
     *
     *  - nút "Mở Dashboard" → `openDashboardNow(AutoOpen.REASON_MANUAL, manual = true)` ([onOpenDashboardClicked]);
     *  - **đường tự động** → `openDashboardNow(AutoOpen.REASON_SESSION_READY)` ([autoOpenIfSessionReady], gọi từ
     *    [loginTick] và [onPanelLoaded] ngay khi `session=yes`).
     *
     * Luật mở (giữ nguyên 1.2): **TOP-LEVEL ingress**
     * (`https://<domain>/api/hassio_ingress/<TOKEN>/launcher-config.html`) — **không** mở gốc domain
     * (`https://<domain>/launcher-config.html` → 404, đúng log thật `fallback=root … 404`), cũng không dừng ở panel:
     *  - đã có phiên (`ingress_session`) ⇒ promote/nạp top-level NGAY;
     *  - chưa có phiên ⇒ mở panel của HA trước (chỉ panel mới tạo được phiên), rồi nhịp dò 1 s mở lại **ngay khi**
     *    phiên xuất hiện ([autoOpenIfSessionReady]).
     *
     * [manual] = `true` khi **người dùng chủ động**: mở lại quyền thử của [promoteGate] (3 lượt) cho lần bấm này.
     * Đường tự động **không** reset gì — số lượt của nó do [autoOpenLatch] quản, nên một lần 401/SPA HA chỉ tốn đúng
     * một lượt và **không lặp vô hạn** (tối đa [AutoOpen.MAX_ATTEMPTS] lần, cách ≥ [AutoOpen.RETRY_GAP_MS]).
     *
     * @param reason lý do (ghi vào log: `manual_open_dashboard` / `session_ready`).
     */
    private fun openDashboardNow(reason: String, manual: Boolean = false) {
        if (loginWatch == null || loginFailed) resetLoginWatch()
        loginFlowActive = true
        loginFailed = false
        // (1.5) **ĐÂY LÀ NGUYÊN NHÂN NHẤP NHÁY CỦA BẢN 1.4**: hàm này được đường TỰ ĐỘNG gọi mỗi lần mở app (khi đã
        // có phiên) và bản 1.4 bật thanh vô điều kiện ⇒ thanh hiện 1–2 s rồi `onPromoteLoaded` ẩn. Nay lý do là
        // [LoginBar.Reason.OPEN_DASHBOARD] — **KHÔNG** phải "cần đăng nhập" ⇒ không bao giờ bật thanh.
        showLoginBar(true, LoginBar.Reason.OPEN_DASHBOARD)
        showRetryButton(false)
        startLoginTick()
        runCatching { CookieManager.getInstance().flush() }
        if (haOrigin == null) {
            haOrigin = DashboardTarget.originOf(webView?.url)
                ?: DashboardTarget.originOf(targetUrl)
                ?: haOrigin
        }
        if (panelTarget == null) panelTarget = DashboardTarget.panelUrl(haOrigin)
        if (manual) {
            // (1.2) Người dùng chủ động ⇒ mở lại quyền thử (3 lượt) cho lần bấm này.
            promoteGate.resetAttempts()
            promoteLimitLogged = false
        }
        if (!isLanMode()) {
            // 1) Đã có phiên (hoặc đã từng `ok=top`) ⇒ nạp TOP-LEVEL ingress NGAY — KHÔNG bao giờ gốc domain.
            if (hasPanelSession() || promoteGate.succeeded) {
                log("[login] " + (if (manual) "manual=open_dashboard" else "auto=open_dashboard") +
                    " reason=" + reason + " → top-level ingress")
                // Bấm lại = một lượt promote mới (kể cả khi lần trước đã thành công — người dùng muốn vào lại).
                if (promoteGate.succeeded) promoteGate.reset()
                if (promoteNow("open_dashboard_$reason", sessionTriggered = true)) return
                // (1.4) Đường tự động: promote chưa bắt đầu được (cổng đang giãn cách / chưa dựng được URL) thì
                // **dừng ở đây** — nhịp dò 1 s sẽ gọi lại. KHÔNG rơi xuống nhánh panel (sẽ nạp lại panel vô ích).
                if (!manual) return
            }
            // 2) Chưa có phiên ⇒ panel của HA là nơi DUY NHẤT tạo được `ingress_session`; nhịp dò 1 s mở lại
            //    NGAY khi phiên xuất hiện ([autoOpenIfSessionReady]).
            val panel = panelTarget
            if (panel != null) {
                log("[login] " + (if (manual) "manual=open_dashboard" else "auto=open_dashboard") +
                    " reason=" + reason + " → panel tạo phiên rồi mở top-level")
                goPanel(if (manual) "manual" else "auto_$reason", force = true)
                return
            }
            // 3) Không có panel (dữ liệu cũ) ⇒ vẫn thử top-level ingress bằng TOKEN đã lưu (không dùng gốc domain).
            if (promoteNow("open_dashboard_$reason", fallbackFromPanel = true)) return
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
        // (1.5) Người dùng bấm "Tôi đã đăng nhập": nếu phiên đã có thì [LoginBar] ẩn **NGAY** (yêu cầu 5); chưa có
        // thì thanh còn hiện tới khi panel/promote chốt.
        showLoginBar(true, LoginBar.Reason.USER_LOGIN_DONE)
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
        }
        // (1.5) YÊU CẦU 2 — 401/403 trên ingress là lý do **cần thật**: hiện thanh (bản 1.4 chỉ hiện khi luồng đăng
        // nhập chưa chạy, nên nhiều ca 401 thật lại không thấy thanh; ngược lại ca nhấp nháy lại do đường khác).
        // Đã có phiên / còn ân hạn thì [LoginBar] vẫn ẩn ⇒ không nhấp nháy (yêu cầu 3).
        showLoginBar(true, LoginBar.Reason.AUTH_HTTP)
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
                            // (1.5) Người dùng chủ động bấm "Đăng nhập lại Home Assistant" trên trang lỗi.
                            showLoginBar(true, LoginBar.Reason.USER_LOGIN_AGAIN)
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
         *  - panel của add-on (URL `https://<domain>/b39feb53_remote_webview_server`) → chốt `[nav] … ok=panel`;
         *  - trang đăng nhập HA (`/auth/…`) → `ok=login`, chờ người dùng đăng nhập;
         *  - SPA HA thuần (Lovelace, `/`, "Page not found") trên URL panel → [onPanelSpa] (đã có hẹn giờ promote);
         *    trên URL khác → thử ứng viên kế tiếp ([onWrongPage]).
         *
         * (28/11/2026) GD16 — trang TOP-LEVEL đang chờ kết luận được dò **loại trang** bằng JS
         * ([probePromotePage] → `addon` / `ha` / `auth`), không dò iframe; trang dự phòng cuối
         * ([LOAD_ROOT_FALLBACK]) kết luận riêng ([onRootFallbackLoaded]).
         */
        override fun onPageFinished(view: WebView?, url: String?) {
            super.onPageFinished(view, url)
            if (isFinishing || isDestroyed) return
            val loaded = url ?: view?.url
            DiagState.currentUrl = loaded
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
                probePromotePage(loaded, title)
                return
            }

            // (28/11/2026) GD16 — đang chờ top-level mà PANEL vừa nạp xong: bỏ qua (không chốt panel, không điều
            // hướng) — nếu không, panel sẽ "giật" lại WebView trong lúc promote.
            if (promotePending && loaded != null && DashboardTarget.isPanel(loaded)) {
                log("[promote] ignore panel_finish url=" + DashboardTarget.shortUrl(loaded))
                return
            }

            // (28/11/2026) GD16 — dự phòng cuối `https://<domain>/launcher-config.html`: kết luận riêng.
            if (loadingReason == LOAD_ROOT_FALLBACK) {
                onRootFallbackLoaded(loaded, arrival, title)
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
                // (1.5) Trang nạp CÓ CHỦ ĐÍCH là trang đăng nhập ⇒ lý do **cần thật** [LoginBar.Reason.AUTH_URL]
                // (chưa có phiên thì thanh hiện; đã có phiên thì ẩn — yêu cầu 3).
                showLoginBar(true, LoginBar.Reason.AUTH_URL)
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
                    // (1.5) HA điều hướng về `/auth/…` ⇒ **cần thật** (yêu cầu 2); có phiên thì [LoginBar] ẩn.
                    showLoginBar(true, LoginBar.Reason.AUTH_URL)
                    if (!loginFlowActive) {
                        loginFlowActive = true
                        startLoginTick()
                    }
                    showLoginDiag(loaded, !currentCookieHeader().isNullOrBlank())
                }

                DashboardTarget.Arrival.HOME_ASSISTANT,
                DashboardTarget.Arrival.OFF_INGRESS -> {
                    // (28/11/2026) GD16 — panel của HA trả SPA của chính nó (frontend chưa dựng panel): KHÔNG dò
                    // iframe nữa, chỉ đảm bảo hẹn giờ promote đã bật → hết 2,5 s app tự nạp top-level ingress.
                    if (loaded != null && DashboardTarget.isPanel(loaded) && isDashboardAttempt()) {
                        navLog(loaded, "ha-spa", "title=" + (title ?: "-") + " → chờ hẹn giờ promote")
                        onPanelSpa(loaded)
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
                onPromoteFailed(IngressPromote.failReason(code, null, IngressPromote.PageKind.UNKNOWN))
                return
            }

            // (28/11/2026) GD16 — PANEL của add-on trả 404 (`Page not found` của HA): thử NGAY top-level ingress
            // (rồi `https://<domain>/launcher-config.html`), không để người dùng nhìn trang lỗi.
            if (code == 404 && DashboardTarget.isPanel(url)) {
                loadResult = code.toString()
                navLog(url, code.toString())
                loginLog()
                view?.stopLoading()
                onPanelUnavailable("404")
                return
            }

            // (28/11/2026) GD16 — dự phòng cuối `https://<domain>/launcher-config.html` trả 404: quay lại panel.
            if (code == 404 && loadingReason == LOAD_ROOT_FALLBACK) {
                loadResult = code.toString()
                navLog(url, code.toString())
                loginLog()
                view?.stopLoading()
                onRootFallbackLoaded(url, DashboardTarget.Arrival.OFF_INGRESS, null)
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
            // (28/11/2026) GD16 — PANEL của add-on không tải được (mất mạng / HA không có panel): thử NGAY top-level
            // ingress rồi `https://<domain>/launcher-config.html`, không toast lỗi thô.
            val failing = request.url?.toString()
            if (failing != null && DashboardTarget.isPanel(failing)) {
                loadResult = "net"
                navLog(failing, "net")
                loginLog()
                onPanelUnavailable("net")
                return
            }
            if (loadingReason == LOAD_ROOT_FALLBACK) {
                loadResult = "net"
                navLog(failing, "net")
                loginLog()
                onRootFallbackLoaded(failing, DashboardTarget.Arrival.OTHER, null)
                return
            }
            loadResult = "net"
            navLog(request.url?.toString(), "net")
            loginLog()
            toast(getString(R.string.err_load))
            // Keep the URL bubble reachable (and above the WebView) so the user can fix a bad address.
            bringBubbleToFront()
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
        mainHandler.removeCallbacks(bubbleIdleRunnable)
        mainHandler.removeCallbacks(promoteTimeoutRunnable)
        mainHandler.removeCallbacks(promoteAfterPanelRunnable)
        mainHandler.removeCallbacks(promoteStartGuardRunnable)
        promotePending = false
        stopLoginTick()
        // (1.5) Không còn hẹn giờ nào được chạy sau khi Activity bị huỷ.
        mainHandler.removeCallbacks(loginBarSettleRunnable)
        pendingLoginBarReason = null
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

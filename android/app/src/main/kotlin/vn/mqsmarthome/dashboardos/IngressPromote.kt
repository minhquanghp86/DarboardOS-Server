package vn.mqsmarthome.dashboardos

/**
 * (27/11/2026) GD15 — **PROMOTE PANEL → TOP-LEVEL INGRESS** (để `getUserMedia` chạy được).
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────────────
 * VẤN ĐỀ ĐÃ KIỂM CHỨNG (bản GD14):
 *  - App mở **panel của add-on trên HA** (`https://<domain>/b39feb53_remote_webview_server`). Panel đó **nhúng
 *    add-on trong `<iframe src="…/api/hassio_ingress/<TOKEN>/…">` của chính HA**.
 *  - Iframe do HA dựng **không có** `allow="microphone; camera"` → trong iframe, `navigator.mediaDevices.getUserMedia`
 *    bị Permissions Policy của KHUNG CHA chặn ⇒ `NotAllowedError` ⇒ **không gọi điện được** (WebView có cấp quyền
 *    RECORD_AUDIO/CAMERA cũng vô ích — quyền bị chặn ở tầng tài liệu, không tới được `WebChromeClient`).
 *
 * CÁCH SỬA (một bước, không đổi phần còn lại): sau khi panel đã load xong **và** đã có cookie phiên ingress
 * (`ingress_session` — xem `MainActivity.hasPanelSession`/`WebTargetResolver.hasSessionCookie`), app **tự chuyển
 * sang TOP-LEVEL** đúng trang của add-on:
 *
 *     https://<domain>/api/hassio_ingress/<TOKEN>/launcher-config.html
 *
 * Ở top-level **không còn khung cha nào** ⇒ Permissions Policy của trang là của chính add-on ⇒ micro/camera được
 * cấp. Phiên ingress đã tồn tại (do panel vừa tạo) nên trang trả 200 thay vì 401.
 *
 * Quy tắc của bước này (đúng yêu cầu):
 *  1. chỉ promote **một lần** cho mỗi lần mở app — cờ trong bộ nhớ ([Decision.ALREADY]);
 *  2. chỉ promote khi **đã có phiên** ([Decision.NO_SESSION] khi chưa có — lúc đó promote sẽ 401 vô ích);
 *  3. top-level trả 401/403, SPA của HA, hoặc quá [TOP_TIMEOUT_MS] → **quay lại panel (iframe)** để người dùng vẫn
 *     dùng được UI ([failLine]: `[promote] url=… ok=401 fail=401 fallback=panel`);
 *  4. người dùng tự quay lại panel → tôn trọng (cờ đã bật nên không promote lại);
 *  5. log chuẩn: `[promote] url=… ok=top|panel|401`.
 *
 * Tệp này THUẦN (chỉ [WebTargetResolver]/[DashboardTarget], không API Android, không mở kết nối) nên unit test
 * được trên JVM — xem `IngressPromoteTest`.
 */
object IngressPromote {

    /** Tiền tố log (cùng tag Logcat `DashboardOS-login` với `[nav]`/`[login]`). */
    const val LOG_PREFIX = "[promote]"

    /** Trang THẬT của add-on (top-level, nằm sau ingress của HA). */
    const val TOP_PAGE = WebTargetResolver.LAUNCHER_PAGE

    /**
     * Quá thời gian này mà trang top-level chưa kết luận được (không `onPageFinished`, không lỗi HTTP) thì coi như
     * thất bại và quay lại panel. Đúng yêu cầu GD16: **4 s**.
     */
    const val TOP_TIMEOUT_MS = 4000L

    /**
     * (28/11/2026) GD16 — **ĐẶT HẸN GIỜ PROMOTE**: 2,5 s kể từ khi panel của add-on BẮT ĐẦU nạp thì promote ngay,
     * **không** chờ phát hiện iframe (bản GD15 dò `iframe[src*="hassio_ingress"]` — dò không thấy nên promote không
     * bao giờ chạy, đúng lỗi người dùng báo "đăng nhập xong không tự vào add-on").
     */
    const val PANEL_PROMOTE_DELAY_MS = 2500L

    /**
     * (28/11/2026) GD16 — thời gian tối đa chờ JS đọc `src` của iframe (chỉ để lấy TOKEN cho **chính xác hơn**).
     * Hết thời gian này vẫn promote bằng TOKEN đã lưu — bước promote KHÔNG phụ thuộc vào việc đọc iframe.
     */
    const val PROMOTE_TOKEN_READ_MS = 600L

    /** Số lần đọc cookie phiên trước khi kết luận "chưa có phiên" (HA vừa đặt cookie, `CookieManager` có thể trễ). */
    const val COOKIE_TRIES = 3

    /** Giãn cách giữa hai lần đọc cookie ở trên. */
    const val COOKIE_RETRY_MS = 700L

    /** `ok=` của log: promote thành công (đang ở top-level ingress). */
    const val OK_TOP = "top"

    /** `ok=` của log: vẫn ở panel (iframe) — do promote bị bỏ qua hoặc thất bại rồi quay lại. */
    const val OK_PANEL = "panel"

    /** `ok=` của log: promote thất bại (401/403, SPA HA, redirect, timeout…). */
    const val OK_FAIL = "401"

    /**
     * Quyết định của bước promote:
     *  - [PROMOTE] — được phép chuyển sang top-level;
     *  - [ALREADY] — đã promote (hoặc đã thử) trong lần mở app này → không lặp;
     *  - [NO_SESSION] — chưa có cookie `ingress_session` ⇒ promote sẽ 401 ⇒ chờ/ở lại panel;
     *  - [NO_URL] — không dựng được URL top-level (không có origin hợp lệ).
     */
    enum class Decision(val label: String) {
        PROMOTE("promote"),
        ALREADY("already"),
        NO_SESSION("no_session"),
        NO_URL("no_url"),
    }

    /** Kết luận về trang top-level: [TOP] = dùng được, [FAIL] = phải quay lại panel. */
    enum class Verdict(val ok: String) {
        TOP(OK_TOP),
        FAIL(OK_FAIL),
    }

    // ────────────────────────────────────────────────────────────── quyết định

    /**
     * Được phép promote chưa? Thứ tự kiểm tra = đúng thứ tự log (cờ trước, rồi URL, rồi phiên) để **không bao giờ**
     * promote lần thứ hai dù phiên còn/ mất.
     *
     * (28/11/2026) GD16 — [requireSession] = `false` cho luồng **đặt hẹn giờ**: promote vẫn chạy dù chưa đọc được
     * cookie `ingress_session` (CookieManager có thể trễ vài trăm ms sau khi panel tạo phiên). Trang top-level tự
     * trả 401 nếu phiên thật sự thiếu → bước promote ghi `fail=401` rồi quay lại panel, không mất gì.
     * Mặc định `true` = hành vi cũ (dùng cho màn Cài đặt / các đường cần chắc chắn có phiên).
     */
    fun decide(
        hasSession: Boolean,
        alreadyPromoted: Boolean,
        topUrl: String?,
        requireSession: Boolean = true,
    ): Decision {
        if (alreadyPromoted) return Decision.ALREADY
        if (topUrl.isNullOrBlank()) return Decision.NO_URL
        if (requireSession && !hasSession) return Decision.NO_SESSION
        return Decision.PROMOTE
    }

    /**
     * (28/11/2026) GD16 — **CỜ "CHỈ MỘT LẦN"** của bước promote, tách riêng để unit test được
     * (`PromoteFlowTest`): [take] trả `true` đúng **một lần** cho tới khi [reset].
     *
     * MainActivity dùng `Once()` làm "mỗi lần mở app chỉ promote một lần"; [reset] chỉ chạy khi người dùng bấm
     * "Kết nối" (một lần mở app mới).
     */
    class Once {
        /** Đã "lấy" chưa — đọc được từ ngoài để ghi log `skip=already`. */
        var done: Boolean = false
            private set

        /** Lấy quyền thử: `true` ở lần gọi ĐẦU TIÊN, `false` ở mọi lần sau. */
        fun take(): Boolean {
            if (done) return false
            done = true
            return true
        }

        fun reset() {
            done = false
        }
    }

    // ────────────────────────────────────────────────────────────── URL

    /**
     * URL TOP-LEVEL của add-on: `https://<domain>/api/hassio_ingress/<TOKEN>/launcher-config.html`.
     *
     * [origin] phải là `http(s)://…`; [token] rỗng/hỏng → TOKEN mặc định ([WebTargetResolver.sanitizeToken]).
     * null = không dựng được (origin rỗng/không http).
     */
    fun topUrl(origin: String?, token: String?, page: String = TOP_PAGE): String? {
        val o = origin?.trim()?.trimEnd('/').orEmpty()
        if (o.isEmpty()) return null
        if (!o.startsWith("http://", ignoreCase = true) && !o.startsWith("https://", ignoreCase = true)) return null
        val p = page.trim().trimStart('/')
        if (p.isEmpty()) return null
        val tok = WebTargetResolver.sanitizeToken(token)
        return "$o${WebTargetResolver.INGRESS_PREFIX}/$tok/$p"
    }

    /**
     * (28/11/2026) GD16 — URL **DỰ PHÒNG CUỐI** khi cả panel của HA và ingress đều không dùng được: add-on phục vụ
     * thẳng ở gốc domain (`https://<domain>/launcher-config.html`). null = origin không dùng được.
     */
    fun rootUrl(origin: String?, page: String = TOP_PAGE): String? {
        val o = origin?.trim()?.trimEnd('/').orEmpty()
        if (o.isEmpty()) return null
        if (!o.startsWith("http://", ignoreCase = true) && !o.startsWith("https://", ignoreCase = true)) return null
        val p = page.trim().trimStart('/')
        if (p.isEmpty()) return null
        return "$o/$p"
    }

    /**
     * TOKEN ingress nằm trong URL (`…/api/hassio_ingress/<TOKEN>/…` hoặc `…/hassio/ingress/<TOKEN>/…`).
     *
     * Dùng để lấy **đúng TOKEN mà HA frontend vừa cấp** cho panel (đọc từ `src` của iframe bằng
     * [HaIngress.panelFrameSrcScript]) — chính xác hơn TOKEN lưu trong `Prefs` khi Supervisor đổi TOKEN.
     * null = không có.
     */
    fun tokenFromUrl(url: String?): String? {
        val u = url?.trim().orEmpty()
        if (u.isEmpty()) return null
        val m = TOKEN_RE.find(u) ?: return null
        val t = m.groupValues.getOrNull(1)?.trim().orEmpty()
        return t.ifEmpty { null }
    }

    /**
     * Gốc API native khi đang ở top-level ingress: `https://<domain>/api/hassio_ingress/<TOKEN>`
     * (đúng base mà `/app/register`, `/app/incoming`… cần — `PhoneService` gắn cookie `ingress_session` vào header).
     * null = URL không phải ingress.
     */
    fun apiBase(topUrl: String?): String? {
        val token = tokenFromUrl(topUrl) ?: return null
        val origin = WebTargetResolver.originUrl(topUrl) ?: return null
        return "$origin${WebTargetResolver.INGRESS_PREFIX}/$token"
    }

    /** URL có phải trang add-on **top-level** (nằm sau ingress + là `launcher-config.html`) không. */
    fun isTopLevelLauncher(url: String?): Boolean =
        WebTargetResolver.isIngressUrl(url) && DashboardTarget.hasLauncherPage(url)

    // ────────────────────────────────────────────────────────────── kết luận trang top-level

    /**
     * (28/11/2026) GD16 — **LOẠI TRANG** mà JS dò được ở top-level (xem [HaIngress.panelProbeScript] /
     * [HaIngress.readProbe]). Dùng để kết luận "đây là add-on" **không** phụ thuộc vào việc dò iframe.
     */
    enum class PageKind(val label: String) {
        /** Trang của add-on: HTML có `launcher-config` / `Dashboard OS`, hoặc có `#app` của Dashboard OS. */
        ADDON("addon"),

        /** SPA của Home Assistant (`<home-assistant>` / tiêu đề `Home Assistant`). */
        HA("ha"),

        /** Trang đăng nhập của HA (`/auth/...`). */
        AUTH("auth"),

        /** Không kết luận được (trang trắng, đang render…). */
        UNKNOWN("unknown"),
    }

    /** Đọc kết quả của [HaIngress.panelProbeScript] (`addon` / `ha` / `auth` / `unknown`). */
    fun pageKind(raw: String?): PageKind {
        val v = raw?.trim()?.trim('"')?.trim()?.lowercase().orEmpty()
        return when {
            v.isEmpty() || v == "null" || v == "undefined" -> PageKind.UNKNOWN
            v.contains("addon") -> PageKind.ADDON
            v.contains("auth") -> PageKind.AUTH
            v == "ha" || v.contains("home_assistant") || v.contains("ha-spa") -> PageKind.HA
            else -> PageKind.UNKNOWN
        }
    }

    /**
     * (28/11/2026) GD16 — HTML của trang top-level có phải **add-on** không: chứa `launcher-config` hoặc
     * `Dashboard OS` (đúng hai dấu hiệu trong yêu cầu). Không phân biệt hoa/thường.
     */
    fun isAddonHtml(html: String?): Boolean {
        val h = html ?: return false
        if (h.isEmpty()) return false
        return h.contains("launcher-config", ignoreCase = true) ||
            h.contains("dashboard os", ignoreCase = true)
    }

    /**
     * Trang top-level vừa nạp xong có dùng được không:
     *  - [status] 401/403 (phiên ingress hết/ chưa có), 404 (sai TOKEN), 3xx (HA điều hướng về `/auth`) → [FAIL];
     *  - HTML là của add-on ([isAddonHtml]) → [TOP];
     *  - tiêu đề là của Home Assistant (`Home Assistant`, `… - Home Assistant`, `Lovelace`) → [FAIL] (SPA HA, không
     *    phải add-on);
     *  - còn lại → [TOP].
     */
    fun verdict(status: Int?, title: String?): Verdict {
        if (status != null) {
            if (status >= 300) return Verdict.FAIL
        }
        if (DashboardTarget.looksLikeHomeAssistant(title)) return Verdict.FAIL
        return Verdict.TOP
    }

    /**
     * (28/11/2026) GD16 — như [verdict] nhưng có thêm dấu hiệu nội dung trang:
     *  - [html] = HTML (hoặc `innerHTML`) của trang top-level; [isAddonHtml] → [TOP] **ngay** (mạnh nhất);
     *  - không có HTML → dùng [kind] từ [pageKind] (`ha` / `auth` → [FAIL], `addon` → [TOP]);
     *  - HTML của HA (`<title>Home Assistant</title>`) → [FAIL] (`ha-spa`);
     *  - còn lại (chưa render xong, tiêu đề riêng) → [TOP].
     */
    fun verdict(status: Int?, title: String?, html: String?, kind: PageKind = PageKind.UNKNOWN): Verdict {
        if (status != null && status >= 300) return Verdict.FAIL
        if (isAddonHtml(html)) return Verdict.TOP
        if (kind == PageKind.ADDON) return Verdict.TOP
        if (DashboardTarget.looksLikeHomeAssistant(title)) return Verdict.FAIL
        if (WebTargetResolver.isHomeAssistantSpa(html)) return Verdict.FAIL
        if (kind == PageKind.HA || kind == PageKind.AUTH) return Verdict.FAIL
        return Verdict.TOP
    }

    /**
     * Lý do thất bại để ghi vào `fail=` của log: `401` (401/403), `404`, `redirect` (3xx), `http<code>`, `ha-spa`
     * (SPA của HA), `unknown`. Thời gian/ mạng do caller truyền (`timeout`, `net`, `auth`).
     */
    fun failReason(status: Int?, title: String?): String = when {
        status == null -> if (DashboardTarget.looksLikeHomeAssistant(title)) "ha-spa" else "unknown"
        status == 401 || status == 403 -> "401"
        status == 404 -> "404"
        status in 300..399 -> "redirect"
        status >= 400 -> "http$status"
        DashboardTarget.looksLikeHomeAssistant(title) -> "ha-spa"
        else -> "unknown"
    }

    /** (28/11/2026) GD16 — như [failReason] nhưng tính cả dấu hiệu nội dung ([kind] từ [pageKind]). */
    fun failReason(status: Int?, title: String?, kind: PageKind): String =
        failReason(status, title, null, kind)

    /**
     * (28/11/2026) GD16 — như trên, tính cả [html]: HTML của SPA Home Assistant (`<title>Home Assistant</title>`)
     * → `ha-spa` dù tiêu đề/JS chưa kịp cập nhật.
     */
    fun failReason(status: Int?, title: String?, html: String?, kind: PageKind): String = when {
        kind == PageKind.AUTH -> "auth"
        kind == PageKind.HA -> "ha-spa"
        isAddonHtml(html) -> "unknown"
        WebTargetResolver.isHomeAssistantSpa(html) -> "ha-spa"
        else -> failReason(status, title)
    }

    // ────────────────────────────────────────────────────────────── log

    /** `[promote] url=…/api/hassio_ingress/KJjH…/launcher-config.html ok=top`. */
    fun logLine(url: String?, ok: String, extra: String? = null): String {
        val sb = StringBuilder(LOG_PREFIX)
            .append(" url=").append(DashboardTarget.shortUrl(url))
            .append(" ok=").append(ok.trim().ifEmpty { "-" })
        val e = extra?.trim().orEmpty()
        if (e.isNotEmpty()) sb.append(' ').append(e)
        return sb.toString()
    }

    /**
     * Dòng log thất bại — đúng định dạng yêu cầu:
     * `[promote] url=… ok=401 fail=401 fallback=panel`.
     */
    fun failLine(url: String?, reason: String): String =
        logLine(url, OK_FAIL, "fail=" + reason.trim().ifEmpty { "unknown" } + " fallback=panel")

    /** Dòng log "bắt đầu promote" (chỉ để chẩn đoán — KHÔNG dùng `ok=`). */
    fun startLine(url: String?, tokenSource: String): String =
        LOG_PREFIX + " start url=" + DashboardTarget.shortUrl(url) +
            " token=" + tokenSource.trim().ifEmpty { "-" } +
            " timeout=" + TOP_TIMEOUT_MS + "ms"

    /**
     * (28/11/2026) GD16 — `[promote] arm in=2500ms panel=…/b39feb53_remote_webview_server` : đã đặt hẹn giờ promote
     * kể từ lúc panel BẮT ĐẦU nạp (không chờ iframe).
     */
    fun armLine(panel: String?, delayMs: Long = PANEL_PROMOTE_DELAY_MS): String =
        LOG_PREFIX + " arm in=" + delayMs + "ms panel=" + DashboardTarget.shortUrl(panel)

    /**
     * (28/11/2026) GD16 — `[promote] fire reason=panel_timer session=no` : hẹn giờ đã nổ, promote ngay.
     */
    fun fireLine(reason: String, session: Boolean): String =
        LOG_PREFIX + " fire reason=" + reason.trim().ifEmpty { "-" } +
            " session=" + (if (session) "yes" else "no")

    /**
     * (28/11/2026) GD16 — `[promote] panel_fail reason=404 fallback=ingress` : panel không nạp được → thử NGAY
     * top-level ingress (rồi mới tới gốc domain).
     */
    fun panelFailLine(reason: String, next: String): String =
        LOG_PREFIX + " panel_fail reason=" + reason.trim().ifEmpty { "unknown" } +
            " fallback=" + next.trim().ifEmpty { "-" }

    /** (28/11/2026) GD16 — `[promote] fallback=root url=https://<domain>/launcher-config.html`. */
    fun rootLine(url: String?, reason: String): String =
        LOG_PREFIX + " fallback=root url=" + DashboardTarget.shortUrl(url) +
            " reason=" + reason.trim().ifEmpty { "-" }

    /** Dòng log "bỏ qua promote" (giữ nguyên panel — người dùng vẫn dùng được UI). */
    fun skipLine(url: String?, decision: Decision, extra: String? = null): String {
        val tail = StringBuilder("skip=").append(decision.label)
        val e = extra?.trim().orEmpty()
        if (e.isNotEmpty()) tail.append(' ').append(e)
        return logLine(url, OK_PANEL, tail.toString())
    }

    /** `/api/hassio_ingress/<TOKEN>` (hoặc `/hassio/ingress/<TOKEN>`). */
    private val TOKEN_RE = Regex(
        "(?:/api/hassio_ingress/|/hassio/ingress/)([A-Za-z0-9._~-]+)",
        RegexOption.IGNORE_CASE
    )
}

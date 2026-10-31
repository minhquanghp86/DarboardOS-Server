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
     * thất bại và quay lại panel. Đúng yêu cầu "lỗi trong 3 s".
     */
    const val TOP_TIMEOUT_MS = 3000L

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
     */
    fun decide(hasSession: Boolean, alreadyPromoted: Boolean, topUrl: String?): Decision {
        if (alreadyPromoted) return Decision.ALREADY
        if (topUrl.isNullOrBlank()) return Decision.NO_URL
        if (!hasSession) return Decision.NO_SESSION
        return Decision.PROMOTE
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
     * Trang top-level vừa nạp xong có dùng được không:
     *  - [status] 401/403 (phiên ingress hết/ chưa có), 404 (sai TOKEN), 3xx (HA điều hướng về `/auth`) → [FAIL];
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

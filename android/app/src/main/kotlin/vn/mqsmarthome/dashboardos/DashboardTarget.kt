package vn.mqsmarthome.dashboardos

/**
 * (19/11/2026) GD11 — "ĐỪNG BAO GIỜ MỞ ORIGIN CỦA HOME ASSISTANT THAY CHO TRANG ADD-ON".
 *
 * LỖI ĐÃ KIỂM CHỨNG BẰNG CODE (người dùng báo + ảnh chụp thực tế):
 *  - nhập `hass.mqsmarthome.io.vn`, đăng nhập HA **thành công**, nhưng app đứng ở dashboard Lovelace của HA;
 *  - bấm "Tôi đã đăng nhập" → trang nạp lại rồi **lại đúng Lovelace** đó, không sang add-on.
 *
 * Nguyên nhân (xem [HaLogin] + MainActivity): mọi đường "mở trang điều khiển" đều nạp **nguyên văn** giá trị
 * `webUrl` đã lưu mà **không kiểm tra** nó có phải trang add-on hay không; và khi `webUrl` là **origin**
 * (`https://<domain>/` — dữ liệu cũ, hoặc một biến thể do bản trước ghi) thì WebView nạp đúng origin, HA đã có
 * phiên nên hiện Lovelace. Tệp này là "hàng rào" cho việc đó:
 *
 *  1. [isValidSaved] — `webUrl` chỉ DÙNG ĐƯỢC khi là URL http(s) của **trang điều khiển**
 *     (`launcher-config.html`); origin (`https://<domain>/`) và URL đăng nhập (`/auth/...`, `/lovelace`) KHÔNG
 *     dùng được (`Prefs.setWebUrl`/`Prefs.saveTargets` cũng từ chối ghi chúng — xem `Prefs`).
 *  2. [candidates] — danh sách ứng viên theo đúng thứ tự yêu cầu: `webUrl` đã lưu (nếu hợp lệ) →
 *     `https://<domain>/api/hassio_ingress/<TOKEN>/launcher-config.html` (dựng lại từ TOKEN) →
 *     `https://<domain>/<slug>/launcher-config.html` → `https://<domain>/launcher-config.html` →
 *     `http://<host>:18080/launcher-config.html`. Nhờ vậy `webUrl` trống/hỏng vẫn có đường vào add-on.
 *  3. [arrival] — kết luận về trang VỪA NẠP (dùng ở `WebViewClient.onPageFinished`): tiêu đề/URL là của
 *     Home Assistant hay là của add-on. Sai → caller thử ứng viên kế tiếp + hiện thông báo (không im lặng
 *     dừng ở Lovelace).
 *  4. [shortUrl] — URL rút gọn để hiện trên thanh thông báo, vd
 *     `…/api/hassio_ingress/KJjH…/launcher-config.html`.
 *
 * Tệp THUẦN (chỉ [WebTargetResolver]/[ServerResolver], không API Android) nên unit test được trên JVM —
 * xem `DashboardTargetTest`.
 */
object DashboardTarget {

    /** Trang điều khiển của add-on (thư mục public). */
    const val LAUNCHER_PAGE = WebTargetResolver.LAUNCHER_PAGE

    /** Tiền tố ingress của Home Assistant. */
    const val INGRESS_PREFIX = WebTargetResolver.INGRESS_PREFIX

    /** Thư mục ingress cũ / proxy giữ tên add-on. */
    const val ADDON_SLUG = ServerResolver.ADDON_SLUG

    /** Cổng add-on mở thẳng (host network). */
    const val ADDON_PORT = ServerResolver.ADDON_PORT

    /**
     * Kết luận về trang vừa nạp xong ([arrival]). [label] là chuỗi ghi vào log `result=…`
     * (`ok` / `ha-spa` / `off-ingress` / `other`) — đúng định dạng yêu cầu chẩn đoán.
     */
    enum class Arrival(val label: String) {
        /** Đúng trang điều khiển của add-on. */
        ADDON("ok"),

        /** Trang (SPA) của Home Assistant — Lovelace / trang chủ / form đăng nhập. */
        HOME_ASSISTANT("ha-spa"),

        /** URL nằm NGOÀI ingress mà cũng không phải trang điều khiển (vd `https://<domain>/lovelace`). */
        OFF_INGRESS("off-ingress"),

        /** `about:blank`, `data:`, trang tạm — không kết luận gì. */
        OTHER("other"),
    }

    // ────────────────────────────────────────────────────────────── nhận dạng URL

    /** URL http(s) (bắt buộc có scheme — `webUrl` luôn được lưu kèm scheme). */
    fun isHttp(url: String?): Boolean {
        val u = url?.trim().orEmpty()
        return u.startsWith("http://", ignoreCase = true) || u.startsWith("https://", ignoreCase = true)
    }

    /** Phần đường dẫn của URL (`https://h/a/b?x=1#y` → `/a/b`); `/` khi URL chỉ có origin; null = không http(s). */
    fun pathOf(url: String?): String? {
        val u = url?.trim().orEmpty()
        if (u.isEmpty()) return null
        val origin = WebTargetResolver.originUrl(u) ?: return null
        val rest = u.substring(origin.length)
        val noQuery = rest.substringBefore('#').substringBefore('?')
        return if (noQuery.isEmpty()) "/" else noQuery
    }

    /** `true` khi URL chỉ là origin: `https://hass.mqsmarthome.io.vn` hoặc `https://hass.mqsmarthome.io.vn/`. */
    fun isOriginOnly(url: String?): Boolean = pathOf(url)?.trim('/')?.isEmpty() == true

    /** URL có trỏ tới **trang điều khiển** của add-on (`…/launcher-config.html`) không. */
    fun hasLauncherPage(url: String?): Boolean =
        pathOf(url)?.contains(LAUNCHER_PAGE, ignoreCase = true) == true

    /** URL có nằm sau ingress của Home Assistant (`/api/hassio_ingress/…`) không. */
    fun isIngress(url: String?): Boolean = WebTargetResolver.isIngressUrl(url)

    /**
     * `webUrl` đã lưu có DÙNG ĐƯỢC không: phải là URL http(s) **có đường dẫn** và phải là trang điều khiển.
     *
     * Origin (`https://<domain>/`) trả `false` — đây chính là giá trị khiến app "refresh rồi lại vào Lovelace".
     * URL đăng nhập của HA (`/auth/login`, `/lovelace`) cũng `false`.
     */
    fun isValidSaved(url: String?): Boolean {
        val u = url?.trim().orEmpty()
        if (u.isEmpty()) return false
        if (!isHttp(u)) return false
        if (isOriginOnly(u)) return false
        return hasLauncherPage(u)
    }

    /** Origin của một URL / chuỗi người dùng gõ (`hass.mqsmarthome.io.vn` → `https://hass.mqsmarthome.io.vn`). */
    fun originOf(input: String?): String? {
        val u = input?.trim().orEmpty()
        if (u.isEmpty()) return null
        WebTargetResolver.originUrl(u)?.let { return it.trimEnd('/') }
        val a = ServerResolver.parse(u) ?: return null
        val netloc = if (a.port > 0) "${a.host}:${a.port}" else a.host
        return "${a.scheme}://$netloc"
    }

    /** `https://<domain>` + `/api/hassio_ingress/<TOKEN>/launcher-config.html` (TOKEN rỗng → TOKEN mặc định). */
    fun ingressUrl(
        origin: String,
        token: String?,
        page: String = LAUNCHER_PAGE,
    ): String = "${origin.trimEnd('/')}$INGRESS_PREFIX/${WebTargetResolver.sanitizeToken(token)}/$page"

    // ────────────────────────────────────────────────────────────── danh sách ứng viên

    /**
     * Ứng viên trang điều khiển, ĐÚNG thứ tự yêu cầu (loại trùng, giữ thứ tự):
     *
     *  1. `webUrl` đã lưu — **chỉ khi** [isValidSaved] (origin/URL đăng nhập bị loại);
     *  2. `https://<domain>/api/hassio_ingress/<TOKEN>/launcher-config.html` (dựng lại từ TOKEN);
     *  3. `https://<domain>/<slug>/launcher-config.html` (reverse proxy giữ tên add-on);
     *  4. `https://<domain>/launcher-config.html` (add-on phục vụ thẳng ở gốc domain);
     *  5. `http://<host>:18080/launcher-config.html` (add-on mở thẳng, không cần ingress).
     *
     * Origin lấy từ [saved] → [loginUrl] (`Prefs.KEY_LOGIN_URL`, origin của HA) → [typed] (chuỗi người dùng đã gõ).
     * Danh sách rỗng = không có domain nào để dựng URL.
     */
    fun candidates(
        saved: String?,
        loginUrl: String? = null,
        typed: String? = null,
        token: String? = null,
        slug: String = ADDON_SLUG,
        port: Int = ADDON_PORT,
        page: String = LAUNCHER_PAGE,
    ): List<String> {
        val origin = originOf(saved) ?: originOf(loginUrl) ?: originOf(typed) ?: return emptyList()
        val out = LinkedHashSet<String>()
        val keep = saved?.trim().orEmpty()
        if (isValidSaved(keep)) out.add(keep)
        out.add(ingressUrl(origin, token, page))
        out.add("$origin/$slug/$page")
        out.add("$origin/$page")
        val host = hostOf(origin)
        if (host.isNotEmpty()) out.add("http://$host:$port/$page")
        return out.toList()
    }

    // ────────────────────────────────────────────────────────────── xác thực trang vừa nạp

    /**
     * Kết luận về trang VỪA NẠP XONG (`onPageFinished(view, url)`, `title = view.title`):
     *
     *  - tiêu đề là của Home Assistant (`Home Assistant`, `… - Home Assistant`, `Lovelace`) → [Arrival.HOME_ASSISTANT];
     *  - URL có `launcher-config.html` → [Arrival.ADDON] (trang add-on có `<title>Dashboard</title>`);
     *  - URL ngoài ingress mà không phải trang điều khiển (vd `/lovelace`, `/auth/login`, `/`) →
     *    [Arrival.OFF_INGRESS] — **chưa vào được add-on**, caller phải thử ứng viên kế tiếp;
     *  - còn lại (trang con bên trong ingress, `about:blank`, …) → [Arrival.OTHER] (không kết luận).
     */
    fun arrival(url: String?, title: String?): Arrival {
        if (!isHttp(url)) return Arrival.OTHER
        if (looksLikeHomeAssistant(title)) return Arrival.HOME_ASSISTANT
        if (hasLauncherPage(url)) return Arrival.ADDON
        if (!isIngress(url)) return Arrival.OFF_INGRESS
        return Arrival.OTHER
    }

    /**
     * Tiêu đề trang có phải của Home Assistant không. Trang add-on dùng tiêu đề riêng
     * (`Dashboard`, `Gọi`, `Báo thức`, …) nên không bao giờ khớp.
     */
    fun looksLikeHomeAssistant(title: String?): Boolean {
        val t = title?.trim().orEmpty()
        if (t.isEmpty()) return false
        if (t.contains("home assistant", ignoreCase = true)) return true
        return t.equals("lovelace", ignoreCase = true)
    }

    // ────────────────────────────────────────────────────────────── chẩn đoán trên máy thật

    /**
     * URL rút gọn để hiện trên thanh thông báo: bỏ origin, giữ đường dẫn, cắt TOKEN ingress còn
     * [tokenKeep] ký tự + `…`, thêm `…` ở đầu.
     *
     * `https://hass.mqsmarthome.io.vn/api/hassio_ingress/KJjH_rSB8Sd…/launcher-config.html`
     * → `…/api/hassio_ingress/KJjH…/launcher-config.html`
     */
    fun shortUrl(url: String?, tokenKeep: Int = 4): String {
        val u = url?.trim().orEmpty()
        if (u.isEmpty()) return "-"
        val origin = WebTargetResolver.originUrl(u)
        var path = if (origin != null) u.substring(origin.length) else u
        if (path.isEmpty()) path = "/"
        path = path.substringBefore('#')
        val marker = "$INGRESS_PREFIX/"
        val at = path.indexOf(marker, ignoreCase = true)
        if (at >= 0) {
            val head = path.substring(0, at + marker.length)
            val rest = path.substring(at + marker.length)
            val token = rest.substringBefore('/')
            val tail = if (rest.contains('/')) rest.substringAfter('/') else ""
            val shown = if (token.length > tokenKeep) token.take(tokenKeep) + "…" else token
            path = head + shown + (if (tail.isEmpty()) "" else "/" + tail)
        }
        return "…" + path
    }

    /** `https://hass:8123` → `hass`; `[fe80::1]:8123` → `[fe80::1]`. */
    private fun hostOf(origin: String): String {
        val netloc = origin.substringAfter("://", origin)
        if (netloc.startsWith("[")) {
            val end = netloc.indexOf(']')
            return if (end > 0) netloc.substring(0, end + 1) else netloc
        }
        return netloc.substringBefore(':')
    }
}

package vn.mqsmarthome.dashboardos

import java.net.HttpURLConnection

/**
 * (18/11/2026) GD10 — DÒ "ĐÃ ĐĂNG NHẬP HOME ASSISTANT" **KHÔNG** dựa vào tên cookie.
 *
 * BỐI CẢNH ĐÃ KIỂM CHỨNG (lỗi người dùng báo, tái hiện được):
 *  1. Lần đầu mở app, nhập `hass.mqsmarthome.io.vn` → app dò ra `webUrl` =
 *     `https://<domain>/api/hassio_ingress/<TOKEN>/launcher-config.html`, lần dò trả **401** → `need_ha_login = true`
 *     → app mở **origin** `https://<domain>/` để người dùng đăng nhập.
 *  2. Người dùng đăng nhập Home Assistant **thành công**; HA điều hướng sang `/lovelace`.
 *  3. NHƯNG: đăng nhập Lovelace **không** sinh ra cookie `ingress_session` / `hassio_ingress` — Home Assistant
 *     KHÔNG dùng cookie cho phiên của nó (token nằm trong `localStorage` → `hassTokens`) và Supervisor chỉ cấp
 *     `ingress_session` khi **mở add-on** (trang HA gọi `POST /api/hassio/ingress/session/<slug>` rồi tự đặt
 *     cookie). Vì vậy `CookieManager.getCookie(origin)` **không bao giờ** có cookie đó lúc này → nhịp dò cũ
 *     ([WebTargetResolver.hasSessionCookie], ràng buộc 2 tên) **không bao giờ** khớp → app đứng ở Lovelace.
 *  4. Người dùng mở add-on bằng tay (lúc đó Supervisor/HA mới đặt `ingress_session`) → thoát hẳn app → mở lại:
 *     lần này `hasHaCookie()` thấy cookie có sẵn nên vào thẳng dashboard. Đúng như báo lỗi.
 *
 * Nên bằng chứng "đã đăng nhập" ở đây là **HÀNH VI**, không phải tên cookie:
 *  - `GET <webUrl>` (kèm cookie hiện có) trả **200** và body **không phải** SPA của HA
 *    (`<title>Home Assistant</title>`) → đã vào được add-on → điều hướng ngay ([isDashboardResponse]);
 *  - URL hiện tại đã **rời khỏi** `/auth/…` của HA ([leftAuthPage]) → người dùng đã đăng nhập xong;
 *  - hoặc **có cookie mới** bất kỳ của origin so với lúc bắt đầu ([newCookieNames] — không ràng buộc tên);
 *  - hoặc đọc được `hassTokens` (access token) trong `localStorage` ([tokenFromJsValue]) → có thể tự tạo phiên
 *    ingress ([HaIngress]).
 *
 * Tệp này THUẦN (chỉ `java.net` + [WebTargetResolver], không API Android, không mở kết nối) nên unit test được
 * trên JVM — xem `HaLoginTest`.
 */
object HaLogin {

    /** Số lần **401/403 LIÊN TIẾP** (khi ĐÃ có cookie) trước khi đổi sang biến thể URL khác ([Watch]). */
    const val AUTH_FAILS_BEFORE_NEXT_VARIANT = 2

    /** Tên cookie phiên ingress thật của Supervisor (app tự ghi sau khi tự tạo phiên — xem [HaIngress]). */
    const val INGRESS_COOKIE = "ingress_session"

    /** Việc MainActivity phải làm sau một lần dò `GET <webUrl>`. */
    enum class Action {
        /** Chưa có kết luận (mạng lỗi, 5xx, hoặc 401 khi CHƯA đăng nhập) — nhịp 1 s dò tiếp. */
        WAIT,

        /** Đã vào được add-on (200 + không phải SPA của HA) — nạp [Step.url] vào WebView. */
        NAVIGATE,

        /** 401/403 hai lần liền (dù có cookie) hoặc 404 — thử biến thể URL kế tiếp ([Step.url]). */
        NEXT_VARIANT,

        /** Hết biến thể mà vẫn 401 → hiện thông báo rõ ràng + nút "Thử lại" (không im lặng). */
        GIVE_UP,
    }

    /** Kết quả một bước: hành động + URL liên quan (null khi không có). */
    data class Step(val action: Action, val url: String?)

    /**
     * (18/11/2026) GD10 — máy trạng thái dò `webUrl` qua các **biến thể** (chống kẹt vòng 401):
     *
     *  1. `webUrl` đã lưu (ingress của HA — dạng chính, cần cookie phiên),
     *  2. `https://<domain>/<slug>/launcher-config.html` (reverse proxy giữ tên add-on),
     *  3. `https://<domain>/launcher-config.html` (add-on phục vụ thẳng ở gốc domain),
     *  4. `http://<host>:18080/launcher-config.html` (add-on mở thẳng cổng nội bộ, KHÔNG cần ingress).
     *
     * Luật:
     *  - 200 + body không phải SPA của HA → [Action.NAVIGATE];
     *  - 401/403 **khi chưa có cookie** → [Action.WAIT] (người dùng còn đang đăng nhập, KHÔNG tính là kẹt);
     *  - 401/403 **khi đã có cookie** → đếm; đủ [AUTH_FAILS_BEFORE_NEXT_VARIANT] lần liên tiếp mới đổi biến thể;
     *  - 404 (sai TOKEN ingress / sai đường dẫn) → đổi biến thể ngay;
     *  - hết biến thể → [Action.GIVE_UP].
     */
    class Watch(
        webUrl: String?,
        slug: String = ServerResolver.ADDON_SLUG,
        port: Int = ServerResolver.ADDON_PORT,
    ) {
        /** Danh sách URL sẽ thử, theo đúng thứ tự ở trên. */
        val variants: List<String> = dashboardVariants(webUrl, slug, port)

        /** Biến thể đang thử. */
        var index: Int = 0
            private set

        /** Số lần 401/403 liên tiếp của biến thể hiện tại (đã có cookie). */
        var failStreak: Int = 0
            private set

        /** Tổng số lần dò (chỉ để log). */
        var probes: Int = 0
            private set

        /** Đã cạn biến thể → phải hiện thông báo + nút "Thử lại". */
        var gaveUp: Boolean = false
            private set

        /** Biến thể đang thử (null = không có URL http(s) hợp lệ). */
        val current: String? get() = variants.getOrNull(index)

        fun reset() {
            index = 0
            failStreak = 0
            probes = 0
            gaveUp = false
        }

        /** Một kết quả dò: [status] = mã HTTP (null = không kết nối được), [dashboard] = [isDashboardResponse]. */
        fun onProbe(status: Int?, dashboard: Boolean, cookiePresent: Boolean): Step {
            probes++
            val url = current
            if (url == null) {
                gaveUp = true
                return Step(Action.GIVE_UP, null)
            }
            if (dashboard) return Step(Action.NAVIGATE, url)

            val code = status ?: 0
            if (WebTargetResolver.needsHaLogin(code)) {
                // 401 mà CHƯA có cookie: người dùng còn ở trang đăng nhập — không phải "kẹt vòng".
                if (!cookiePresent) return Step(Action.WAIT, url)
                failStreak++
                if (failStreak < AUTH_FAILS_BEFORE_NEXT_VARIANT) return Step(Action.WAIT, url)
                return nextVariantOrGiveUp()
            }
            // 404 = sai TOKEN ingress / sai đường dẫn; 200 nhưng đúng là SPA của HA (`<title>Home Assistant</title>`)
            // = sai chỗ; 3xx = HA điều hướng đi đâu đó (vd về trang đăng nhập). Cả ba → biến thể kế tiếp NGAY,
            // nếu không nhịp dò sẽ quay vô hạn ở một biến thể sai mà không bao giờ báo gì (im lặng).
            if (code == HttpURLConnection.HTTP_NOT_FOUND) return nextVariantOrGiveUp()
            if (code in 300..399) return nextVariantOrGiveUp()
            if (code == HttpURLConnection.HTTP_OK) return nextVariantOrGiveUp()
            return Step(Action.WAIT, url)
        }

        private fun nextVariantOrGiveUp(): Step {
            failStreak = 0
            val next = index + 1
            if (next < variants.size) {
                index = next
                return Step(Action.NEXT_VARIANT, variants[next])
            }
            gaveUp = true
            return Step(Action.GIVE_UP, current)
        }
    }

    // ────────────────────────────────────────────────────────────── cookie (KHÔNG ràng buộc tên)

    /** Có cookie bất kỳ hay không (header rỗng / null = chưa có). */
    fun hasAnyCookie(header: String?): Boolean = !header.isNullOrBlank()

    /**
     * Tập TÊN cookie trong header `a=1; b=2` (bỏ giá trị, bỏ phần tử rỗng).
     *
     * Dùng để phát hiện "có cookie mới so với lúc bắt đầu" mà **không** cần biết tên: HA/Supervisor có thể đặt
     * `ingress_session`, `hassio_ingress`, hoặc bất cứ tên nào khác tuỳ phiên bản.
     */
    fun cookieNames(header: String?): Set<String> {
        val h = header ?: return emptySet()
        val out = LinkedHashSet<String>()
        for (part in h.split(';')) {
            val name = part.substringBefore('=').trim()
            if (name.isNotEmpty()) out.add(name)
        }
        return out
    }

    /** Tên cookie MỚI xuất hiện (so với [before]) — dấu hiệu "vừa có phiên". */
    fun newCookieNames(before: Set<String>, after: Set<String>): Set<String> = after - before

    // ────────────────────────────────────────────────────────────── URL: trang đăng nhập / rời /auth

    /** Phần đường dẫn của [url] (`https://h/a/b?x=1#y` → `/a/b`); null = không phải URL http(s). */
    fun pathOf(url: String?): String? {
        val u = url?.trim().orEmpty()
        if (!u.startsWith("http://", ignoreCase = true) && !u.startsWith("https://", ignoreCase = true)) {
            return null
        }
        val rest = u.substringAfter("://", "")
        val slash = rest.indexOf('/')
        val path = if (slash < 0) "/" else rest.substring(slash)
        return path.substringBefore('#').substringBefore('?')
    }

    /** URL có đang ở LUỒNG ĐĂNG NHẬP của HA không (`/auth/login`, `/auth/authorize`, `/auth/token`…). */
    fun isAuthPage(url: String?): Boolean {
        val path = pathOf(url)?.lowercase() ?: return false
        return path == "/auth" || path.startsWith("/auth/")
    }

    /** URL có thuộc CÙNG origin với [origin] không (`https://hass/x` với `https://hass` → true). */
    fun isSameOrigin(url: String?, origin: String?): Boolean {
        val u = url?.trim().orEmpty()
        val o = origin?.trim()?.trimEnd('/').orEmpty()
        if (u.isEmpty() || o.isEmpty()) return false
        return u.equals(o, ignoreCase = true) || u.startsWith("$o/", ignoreCase = true)
    }

    /**
     * Người dùng đã **rời khỏi** luồng đăng nhập: URL thuộc origin của HA mà KHÔNG còn nằm dưới `/auth/`.
     *
     * Đây là dấu hiệu "đăng nhập xong" độc lập hoàn toàn với cookie: HA đăng nhập thành công thì điều hướng sang
     * `/lovelace` (hoặc `/?auth_callback=1`) — đúng lúc nhịp dò cũ không làm gì cả.
     */
    fun leftAuthPage(url: String?, origin: String?): Boolean =
        isSameOrigin(url, origin) && !isAuthPage(url)

    /** `200` + body KHÔNG phải SPA của Home Assistant = đã vào được add-on (đăng nhập xong). */
    fun isDashboardResponse(status: Int, body: String?): Boolean =
        status == HttpURLConnection.HTTP_OK && !WebTargetResolver.isHomeAssistantSpa(body)

    // ────────────────────────────────────────────────────────────── biến thể URL (chống kẹt 401)

    /**
     * Danh sách URL ứng viên cho trang điều khiển, theo đúng thứ tự yêu cầu (loại trùng, giữ thứ tự):
     *
     *  1. `webUrl` đang lưu,
     *  2. `https://<domain>/<slug>/launcher-config.html`,
     *  3. `https://<domain>/launcher-config.html`,
     *  4. `http://<host>:18080/launcher-config.html`.
     *
     * Danh sách rỗng = `webUrl` không phải URL http(s).
     */
    fun dashboardVariants(
        webUrl: String?,
        slug: String = ServerResolver.ADDON_SLUG,
        port: Int = ServerResolver.ADDON_PORT,
        page: String = WebTargetResolver.LAUNCHER_PAGE,
    ): List<String> {
        val u = webUrl?.trim().orEmpty()
        if (!u.startsWith("http://", ignoreCase = true) && !u.startsWith("https://", ignoreCase = true)) {
            return emptyList()
        }
        val origin = WebTargetResolver.originUrl(u) ?: return emptyList()
        val out = LinkedHashSet<String>()
        out.add(u)
        out.add("$origin/$slug/$page")
        out.add("$origin/$page")
        val host = hostOf(origin)
        if (host.isNotEmpty()) out.add("http://$host:$port/$page")
        return out.toList()
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

    // ────────────────────────────────────────────────────────────── token HA (localStorage) + log

    /**
     * Giá trị `evaluateJavascript(...)` của đoạn JS đọc `localStorage.hassTokens` → access token (null nếu chưa
     * đăng nhập). WebView trả về chuỗi JSON: `"eyJ…"` khi có, `""` / `null` khi không.
     */
    fun tokenFromJsValue(raw: String?): String? {
        val v = raw?.trim().orEmpty()
        if (v.isEmpty() || v == "null" || v == "undefined" || v == "\"\"") return null
        val token = v.removeSurrounding("\"").replace("\\/", "/").trim()
        if (token.isEmpty() || token == "null") return null
        // Access token của HA là JWT (chỉ chữ/số/-/_/.). Chuỗi lạ → coi như không có.
        if (token.length < 20) return null
        if (token.any { it.isWhitespace() }) return null
        if (!token.all { it.isLetterOrDigit() || it == '.' || it == '-' || it == '_' }) return null
        return token
    }

    /** Một dòng log chuẩn của nhịp dò: `[login] url=… cookie=yes web=401` (+ phần [extra] tuỳ chọn). */
    fun pollLogLine(url: String?, cookiePresent: Boolean, status: Int?, extra: String? = null): String {
        val u = url?.trim().orEmpty().ifEmpty { "-" }
        val sb = StringBuilder("[login] url=")
            .append(u)
            .append(" cookie=").append(if (cookiePresent) "yes" else "no")
            .append(" web=").append(status?.toString() ?: "-")
        val e = extra?.trim().orEmpty()
        if (e.isNotEmpty()) sb.append(' ').append(e)
        return sb.toString()
    }
}

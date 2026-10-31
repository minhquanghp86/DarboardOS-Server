package vn.mqsmarthome.dashboardos

import java.net.URLEncoder

/**
 * (1.8) **DỰNG URL TRANG GỌI ĐÚNG — KHÔNG BAO GIỜ MỞ ROUTE CỦA HA SPA**.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────────────
 * LỖI NGƯỜI DÙNG VỪA TEST (cả 2 chiều P4 → điện thoại và điện thoại → điện thoại):
 *  - điện thoại **có chuông, có thông báo**, bấm **Nghe** → app mở **trang dashboard của Home Assistant**, KHÔNG có
 *    giao diện cuộc gọi; bên gọi vẫn đổ chuông / đếm thời gian;
 *  - chiều điện thoại → P4 vẫn bình thường (vì trang gọi do P4 tự mở trong WebView của nó).
 *
 * NGUYÊN NHÂN (đọc code, bản 1.7): [IncomingCallActivity.openCallPage] lấy `webUrl` — mà từ GD14 `webUrl` là **panel
 * của add-on trên HA** (`https://<domain>/b39feb53_remote_webview_server`) — rồi gọi
 * [WebTargetResolver.callPageUrl] để "lấy cùng thư mục":
 *
 *     https://<domain>/b39feb53_remote_webview_server/call-web.html?call=…
 *
 * Đường dẫn đó là **route của SPA Home Assistant**, KHÔNG phải của add-on ⇒ HA trả dashboard Lovelace ⇒ không có
 * giao diện gọi, không có `{type:'join'}` ⇒ bên gọi không nhận `accepted` và vẫn "đang đổ chuông".
 *
 * Trang gọi THẬT phải nằm **dưới ingress của add-on** (hoặc ở gốc add-on khi chạy LAN):
 *
 *     https://<domain>/api/hassio_ingress/<TOKEN>/call-web.html?call=<id>&phone=<phoneId>
 *     https://<ip>:18443/call-web.html?call=<id>&phone=<phoneId>          (chế độ IP LAN)
 *
 * THỨ TỰ DỰNG URL ([build]) — đúng yêu cầu:
 *  1. [Prefs.apiBase] (đã là `…/api/hassio_ingress/<TOKEN>` khi đã đăng nhập) + `/call-web.html?call=…&phone=…`;
 *  2. `apiBase` rỗng/hỏng → **dựng lại** từ origin (domain lấy từ `webUrl` / `loginUrl` / ô nhập) + TOKEN ingress
 *     ([IngressPromote.apiBase] = đúng hàm dựng base ingress đã có test);
 *  3. **chỉ khi** không còn cách nào mới dùng `webUrl` — tức chế độ IP LAN (`http(s)://<ip>:<port>`), nơi không có
 *     ingress nào cả.
 *
 * KIỂM TRA TRƯỚC KHI MỞ ([openable]) — chính là hàng rào chặn lỗi trên:
 *  - URL chứa `/api/hassio_ingress/` (hoặc `…/hassio/ingress/`) ⇒ **mở**;
 *  - URL là `http(s)://<ip>:<port>` (LAN / Tailscale / add-on mở cổng riêng) ⇒ **mở**;
 *  - URL là **panel HA thuần** (`/b39feb53_remote_webview_server` mà KHÔNG có `/api/`) ⇒ **KHÔNG mở** — đó là route
 *    của HA SPA, dùng nó là quay lại đúng lỗi "hiện dashboard Hass";
 *  - URL khác (gốc domain `https://<domain>/call-web.html`…) ⇒ **KHÔNG mở** (HA nuốt route thành Lovelace).
 *
 * Tệp THUẦN (chỉ chuỗi + [WebTargetResolver]/[DashboardTarget]/[IngressPromote]/[TlsPolicy], không API Android,
 * không mở kết nối) nên unit test được trên JVM — xem `CallPageTargetTest`.
 */
object CallPageTarget {

    /** Tiền tố log chẩn đoán (KHÔNG chứa `401`/`fail=` nên không kích hoạt tự lưu tệp — xem [DiagFile]). */
    const val LOG_PREFIX = "[answer]"

    /** Trang gọi của add-on (`call-web.html`, cùng thư mục public với `launcher-config.html`). */
    const val PAGE = WebTargetResolver.CALL_PAGE

    /** Nguồn của URL đã dựng — ghi vào `source=` của dòng log `[answer]`. */
    enum class Source(val label: String) {
        /** `Prefs.apiBase` (đã là ingress khi đã đăng nhập). */
        API_BASE("apiBase"),

        /** Dựng lại từ domain + TOKEN ingress ([IngressPromote.apiBase]). */
        REBUILT("rebuilt"),

        /** `webUrl` đã lưu — chỉ dùng được ở chế độ IP LAN. */
        WEB_URL("webUrl"),

        /** Không dựng được URL nào dùng được. */
        NONE("none"),
    }

    /** Kết quả một lần dựng: [url] = `null` ⇔ không có đường nào dùng được ([ok] = false). */
    data class Result(val url: String?, val source: Source) {
        val ok: Boolean get() = url != null

        companion object {
            /** Không dựng được URL (thiếu `callId` / không có địa chỉ nào dùng được). */
            val NONE = Result(null, Source.NONE)
        }
    }

    // ────────────────────────────────────────────────────────────── dựng URL

    /**
     * URL trang gọi cho [callId] (kèm `&phone=` khi biết id máy) — đúng 3 nhánh của yêu cầu.
     *
     * @param callId  id cuộc gọi (server trả ở `GET /app/incoming`). Rỗng ⇒ [Result.NONE] (không có gì để vào).
     * @param phoneId id máy này ([Prefs.phoneId]) — trang gửi `{type:'join', phone:…}` nên server gắn đúng đầu cuối.
     * @param apiBase gốc API đã lưu (thường `https://<domain>/api/hassio_ingress/<TOKEN>`).
     * @param webUrl  trang điều khiển đã lưu (panel của add-on trên HA, hoặc `https://<ip>:18443/…` khi LAN).
     * @param loginUrl origin của HA ([Prefs.loginUrl]) — nguồn domain dự phòng để **dựng lại** URL.
     * @param typed   chuỗi người dùng đã nhập ([Prefs.oneInput]) — nguồn domain cuối.
     * @param token   TOKEN ingress ([Prefs.ingressToken]).
     */
    fun build(
        callId: String,
        phoneId: String?,
        apiBase: String?,
        webUrl: String?,
        loginUrl: String? = null,
        typed: String? = null,
        token: String? = null,
    ): Result {
        val call = callId.trim()
        if (call.isEmpty()) return Result.NONE

        // (1) apiBase — đã là ingress `…/api/hassio_ingress/<TOKEN>` khi đã đăng nhập.
        pageUrl(apiBase, call, phoneId)?.takeIf { openable(it) }?.let { return Result(it, Source.API_BASE) }

        // (2) apiBase rỗng/hỏng (hoặc là panel của HA: `…/b39feb53_remote_webview_server`) → dựng lại từ domain + TOKEN.
        originOf(webUrl, loginUrl, typed, apiBase)?.let { origin ->
            // IP LAN không có ingress: `https://<ip>:18443/api/hassio_ingress/<TOKEN>` là URL bịa ⇒ bỏ qua nhánh này.
            if (!isLanAddress(origin)) {
                ingressBase(origin, token)?.let { base ->
                    pageUrl(base, call, phoneId)?.takeIf { openable(it) }
                        ?.let { return Result(it, Source.REBUILT) }
                }
            }
        }

        // (3) cuối cùng: `webUrl` (chế độ IP LAN — ` https://<ip>:18443/call-web.html?call=…`).
        WebTargetResolver.callPageUrl(webUrl, call, phoneId)?.takeIf { openable(it) }
            ?.let { return Result(it, Source.WEB_URL) }

        return Result.NONE
    }

    /**
     * `<base>/call-web.html?call=<id>&phone=<phoneId>` — [base] là **base** (không có trang), vd
     * `https://<domain>/api/hassio_ingress/<TOKEN>` hoặc `http://192.168.10.2:18080`.
     *
     * null = [base] rỗng / không phải http(s). Phần query được `URLEncoder` (id cuộc gọi, id máy là UUID an toàn,
     * nhưng vẫn mã hoá cho chắc).
     */
    fun pageUrl(base: String?, callId: String, phoneId: String? = null): String? {
        val b = base?.trim()?.trimEnd('/').orEmpty()
        if (!DashboardTarget.isHttp(b)) return null
        val query = StringBuilder()
        val call = callId.trim()
        if (call.isNotEmpty()) query.append("call=").append(enc(call))
        val phone = phoneId?.trim().orEmpty()
        if (phone.isNotEmpty()) {
            if (query.isNotEmpty()) query.append('&')
            query.append("phone=").append(enc(phone))
        }
        val path = b + "/" + PAGE
        return if (query.isEmpty()) path else "$path?$query"
    }

    /**
     * Base ingress dựng lại từ [origin] + [token]: `https://<domain>/api/hassio_ingress/<TOKEN>`.
     *
     * Dùng đúng [IngressPromote.topUrl] / [IngressPromote.apiBase] (đã có test) để không có logic thứ hai:
     * `origin + /api/hassio_ingress/<TOKEN>/launcher-config.html` → bỏ trang → base.
     *
     * null = [origin] không phải http(s).
     */
    fun ingressBase(origin: String?, token: String?): String? =
        IngressPromote.apiBase(IngressPromote.topUrl(origin, token))

    /** Origin dùng để dựng lại URL: `webUrl` → `loginUrl` → chuỗi người dùng đã nhập → `apiBase`. */
    fun originOf(vararg inputs: String?): String? {
        for (raw in inputs) {
            val origin = DashboardTarget.originOf(raw) ?: continue
            return origin
        }
        return null
    }

    // ────────────────────────────────────────────────────────────── kiểm tra trước khi mở

    /**
     * URL này có phải **trang gọi của add-on** (mở được) không — hàng rào chặn route của HA SPA:
     *  1. không phải http(s) → `false`;
     *  2. có `/api/hassio_ingress/` → `true` (trang thật của add-on sau ingress);
     *  3. panel của HA mà không có `/api/` (`/b39feb53_remote_webview_server…`) → `false`;
     *  4. `http(s)://<ip>:<port>` (LAN / Tailscale / cổng riêng của add-on) → `true`;
     *  5. còn lại (gốc domain: `https://<domain>/call-web.html`, Lovelace…) → `false`.
     */
    fun openable(url: String?): Boolean {
        val u = url?.trim().orEmpty()
        if (!DashboardTarget.isHttp(u)) return false
        if (WebTargetResolver.isIngressUrl(u)) return true
        if (isHaPanelOnly(u)) return false
        return isLanAddress(u)
    }

    /**
     * URL có phải **panel của add-on trên HA** nhưng KHÔNG nằm sau ingress
     * (`https://<domain>/b39feb53_remote_webview_server[…/call-web.html]`) — route của SPA HA, không bao giờ mở.
     */
    fun isHaPanelOnly(url: String?): Boolean {
        val u = url?.trim().orEmpty()
        if (u.isEmpty()) return false
        if (u.contains("/api/", ignoreCase = true)) return false
        return WebTargetResolver.isPanelUrl(u)
    }

    /**
     * [url] có trỏ thẳng tới add-on **bằng địa chỉ IP + cổng** không (chế độ IP LAN, không có ingress):
     * `http(s)://192.168.10.2:18443/…`, `http://10.0.0.5:18080/…`, `http://[fd00::1]:18080/…`.
     *
     * Chấp nhận cả IP ngoài dải LAN (Tailscale 100.x, IP tĩnh) khi URL có **cổng tường minh** — đó vẫn là add-on
     * phục vụ trực tiếp, không phải HA SPA.
     */
    fun isLanAddress(url: String?): Boolean {
        val u = url?.trim().orEmpty()
        if (!DashboardTarget.isHttp(u)) return false
        if (TlsPolicy.isLanUrl(u)) return true
        val host = TlsPolicy.hostOf(u) ?: return false
        return isIpLiteral(host) && hasExplicitPort(u)
    }

    /** [url] có phải **trang gọi** của add-on (`call-web.html`) — dùng để nhịp dò KHÔNG kéo WebView về panel. */
    fun isCallPage(url: String?): Boolean {
        val path = WebTargetResolver.pathOf(url) ?: return false
        return path.contains(PAGE, ignoreCase = true)
    }

    /**
     * `?call=<id>` của một URL trang gọi (dùng để **dựng lại** URL khi URL nhận được là route của HA SPA — hàng rào
     * thứ hai ở `MainActivity.openFromIntent`, cho `EXTRA_OPEN_URL` của bản cũ / nguồn khác).
     *
     * null = không có tham số `call` (hoặc URL không dùng được).
     */
    fun callIdOf(url: String?): String? {
        val u = url?.trim().orEmpty()
        if (u.isEmpty()) return null
        val query = u.substringAfter('?', "").substringBefore('#')
        if (query.isEmpty()) return null
        for (part in query.split('&')) {
            if (!part.substringBefore('=').equals("call", ignoreCase = true)) continue
            val raw = part.substringAfter('=', "").trim()
            if (raw.isEmpty()) return null
            val decoded = runCatching { java.net.URLDecoder.decode(raw, "UTF-8") }.getOrDefault(raw)
            return decoded.trim().ifEmpty { null }
        }
        return null
    }

    // ────────────────────────────────────────────────────────────── log

    /**
     * Dòng chẩn đoán chuẩn (yêu cầu 3) — **`[answer] url=… source=apiBase|rebuilt|webUrl|none ok=1|0`**:
     *
     *     [answer] url=…/api/hassio_ingress/KJjH…/call-web.html?call=abc&phone=… source=apiBase ok=1
     *     [answer] url=- source=none ok=0
     *
     * Không chứa `fail=` và (bình thường) không chứa `401` ⇒ KHÔNG kích hoạt [DiagFile.shouldAutoSave]
     * (xem [DiagFile.shouldAutoSave], có chặn tường minh tiền tố [LOG_PREFIX]).
     */
    fun logLine(url: String?, source: Source, ok: Boolean): String =
        StringBuilder(LOG_PREFIX)
            .append(" url=").append(DashboardTarget.shortUrl(url))
            .append(" source=").append(source.label)
            .append(" ok=").append(if (ok) "1" else "0")
            .toString()

    /**
     * Dòng log phụ "đã điều hướng ở đâu": `[answer] nav=webview url=…` (WebView đang sống) hoặc
     * `[answer] nav=activity url=…` (mở MainActivity với `EXTRA_OPEN_URL`). Không có `ok=`/`fail=`.
     */
    fun navLine(url: String?, where: String): String =
        LOG_PREFIX + " nav=" + where.trim().ifEmpty { "-" } + " url=" + DashboardTarget.shortUrl(url)

    // ────────────────────────────────────────────────────────────── nội bộ

    private fun enc(value: String): String = URLEncoder.encode(value, "UTF-8")

    /** Host là IP literal (IPv4 `a.b.c.d`, IPv6 `[…]` / có `:`) hay `localhost`. */
    private fun isIpLiteral(host: String): Boolean {
        val h = host.trim().trimEnd('.').removePrefix("[").removeSuffix("]").lowercase()
        if (h.isEmpty()) return false
        if (h == "localhost") return true
        if (h.contains(':')) return true            // IPv6
        val parts = h.split('.')
        if (parts.size != 4) return false
        return parts.all { p -> p.isNotEmpty() && p.length <= 3 && p.toIntOrNull()?.let { it in 0..255 } == true }
    }

    /** URL có cổng tường minh (`https://host:18443/…`, `http://[fd00::1]:18080/…`). */
    private fun hasExplicitPort(url: String): Boolean {
        val netloc = url.substringAfter("://", "").substringBefore('/').substringBefore('?').substringBefore('#')
        if (netloc.isEmpty()) return false
        return if (netloc.startsWith("[")) netloc.contains("]:") else netloc.count { it == ':' } == 1
    }
}

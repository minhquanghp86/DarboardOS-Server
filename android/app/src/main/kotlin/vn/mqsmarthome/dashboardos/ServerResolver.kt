package vn.mqsmarthome.dashboardos

import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

/**
 * (30/10/2026) GD4 — BỘ DÒ ĐỊA CHỈ: người dùng CHỈ nhập IP hoặc domain của Home Assistant
 * (vd `192.168.10.2`, `hass.mqsmarthome.io.vn`), app tự tìm add-on Dashboard OS.
 *
 * Cách tìm: sinh danh sách base URL ứng viên (theo thứ tự ưu tiên) rồi thử `GET <base>/app/ping`.
 * Máy chủ đúng là máy trả 200 + `{"service":"dashboard-os"}` (src/phones.ts). Nhờ vậy app không cần
 * người dùng biết cổng 18080, biết tiền tố ingress `/b39feb53_remote_webview_server` hoặc http/https.
 *
 * Toàn bộ tệp này KHÔNG dùng API Android (chỉ java.net) nên chạy được trong unit test JVM.
 */
object ServerResolver {

    /** Thư mục ingress của add-on khi Home Assistant phục vụ qua đường dẫn (hoặc proxy giữ tiền tố). */
    const val ADDON_SLUG = "b39feb53_remote_webview_server"

    /** Cổng mặc định của web server add-on (chạy host network). */
    const val ADDON_PORT = 18080

    /** Cổng Home Assistant (add-on đứng sau HA: https://<domain>:8123/<slug>/...). */
    const val HA_PORT = 8123

    /** Đường dẫn nhận diện máy chủ (src/phones.ts — không auth, không cache). */
    const val PING_PATH = "/app/ping"

    /** Trang điều khiển mở trong WebView. */
    const val WEB_PAGE = "call-web.html"

    /** Timeout mỗi lần thử (yêu cầu: 2,5 s) — 1 máy sai không làm người dùng chờ lâu. */
    const val TIMEOUT_MS = 2500

    /** Máy chủ đã tìm thấy: `base` (= `apiBase`) và trang điều khiển. */
    data class Server(val base: String, val apiBase: String, val webUrl: String)

    /** Địa chỉ người dùng nhập, đã tách phần. port = 0 nghĩa là người dùng KHÔNG gõ cổng. */
    data class Address(
        val host: String,
        val port: Int,
        val prefix: String,
        val lan: Boolean,
        val scheme: String,
    )

    // ────────────────────────────────────────────────────────────── sinh ứng viên (THUẦN, testable)

    /**
     * Sinh danh sách base URL theo thứ tự ưu tiên từ chuỗi người dùng nhập.
     *
     *  - Chuẩn hoá: trim, bỏ `/` cuối; thiếu scheme thì `http` cho IP LAN / `localhost`, `https` cho domain.
     *  - Nhập URL đầy đủ có path (vd `.../call-web.html`) thì lấy origin + tiền tố thư mục (bỏ tên tệp).
     *  - IP LAN (10.x, 192.168.x, 172.16-31.x, 127.x, 169.254.x) hoặc `localhost`:
     *      http://host:18080 → http://host:18080/<slug> → https://host → http://host → https://host/<slug>
     *  - Domain:
     *      https://domain → https://domain/<slug> → https://domain:8123/<slug> → http://domain:18080
     *  - `host:port` người dùng gõ được giữ nguyên (đứng trước, cả http và https).
     *  - Loại trùng, giữ thứ tự. Chuỗi rỗng / rác -> danh sách rỗng.
     */
    fun candidates(input: String?): List<String> {
        val a = parse(input) ?: return emptyList()
        val out = LinkedHashSet<String>()

        fun add(scheme: String, port: Int, prefix: String) {
            val netloc = if (port > 0) "${a.host}:$port" else a.host
            out.add("$scheme://$netloc$prefix")
        }

        val p = a.prefix
        val slug = if (p.isEmpty()) "/$ADDON_SLUG" else p
        val userPort = a.port

        if (a.lan) {
            // Cổng add-on là trường hợp phổ biến nhất (cùng LAN, không proxy).
            add("http", if (userPort > 0) userPort else ADDON_PORT, p)
            // Cùng cổng đó nhưng proxy/nginx giữ tiền tố ingress.
            add("http", if (userPort > 0) userPort else ADDON_PORT, slug)
            // Reverse proxy có TLS sẵn trên máy.
            add("https", userPort, p)
            // http mặc định (cổng 80).
            add("http", userPort, p)
            add("https", userPort, slug)
        } else {
            // Người dùng gõ cổng riêng: thử đúng cổng đó trước (cả https rồi http).
            if (userPort > 0) {
                add("https", userPort, p)
                add("http", userPort, p)
            }
            // Domain trỏ thẳng tới HA qua TLS.
            add("https", userPort, p)
            // ... qua đường dẫn ingress của add-on.
            add("https", userPort, slug)
            // ... HA ở cổng 8123 + ingress.
            add("https", if (userPort > 0) userPort else HA_PORT, slug)
            // ... hoặc cổng add-on mở thẳng ra ngoài bằng http.
            add("http", if (userPort > 0) userPort else ADDON_PORT, p)
        }
        return out.toList()
    }

    /** Tách chuỗi người dùng nhập thành host / port / tiền tố đường dẫn. null = không dùng được. */
    fun parse(input: String?): Address? {
        var s = input?.trim().orEmpty()
        if (s.isEmpty()) return null
        // "hass local" / "http:// 1.2.3.4" -> rác.
        if (s.any { it.isWhitespace() }) return null

        var scheme: String? = null
        val m = SCHEME_RE.find(s)
        if (m != null) {
            scheme = m.groupValues[1].lowercase()
            if (scheme != "http" && scheme != "https") return null
            s = s.substring(m.value.length)
        }
        s = s.substringBefore('#').substringBefore('?')
        if (s.isEmpty()) return null

        val slash = s.indexOf('/')
        val authority = if (slash >= 0) s.substring(0, slash) else s
        val path = if (slash >= 0) s.substring(slash) else ""
        // Bỏ user:pass@ (không dùng tới, nhưng đừng để nó thành host).
        val hostPort = authority.substringAfterLast('@')
        if (hostPort.isEmpty()) return null

        var host: String
        var port = 0
        if (hostPort.startsWith("[")) {                       // IPv6: [fe80::1]:8080
            val end = hostPort.indexOf(']')
            if (end < 0) return null
            host = hostPort.substring(0, end + 1)
            if (!IPV6_RE.matches(host)) return null
            val rest = hostPort.substring(end + 1)
            if (rest.isNotEmpty()) {
                if (!rest.startsWith(':')) return null
                port = rest.substring(1).toIntOrNull() ?: return null
            }
        } else {
            val colon = hostPort.lastIndexOf(':')
            if (colon >= 0) {
                host = hostPort.substring(0, colon)
                port = hostPort.substring(colon + 1).toIntOrNull() ?: return null
            } else {
                host = hostPort
            }
        }

        host = host.trimEnd('.')
        if (host.isEmpty()) return null
        if (!host.startsWith('[') && !HOST_RE.matches(host)) return null
        if (port != 0 && port !in 1..65535) return null
        if (colonGiven(hostPort) && port == 0) return null

        val lan = isLanHost(host)
        val finalScheme = scheme ?: if (lan) "http" else "https"
        return Address(host.lowercase(), port, prefixOf(path), lan, finalScheme)
    }

    /** IP LAN (RFC1918 + loopback + link-local) hoặc localhost. */
    fun isLanHost(host: String): Boolean {
        val h = host.lowercase().removePrefix("[").removeSuffix("]").trimEnd('.')
        if (h == "localhost" || h == "::1" || h == "0.0.0.0") return true
        val parts = h.split('.')
        if (parts.size != 4) return false
        val n = IntArray(4)
        for (i in 0..3) {
            val v = parts[i].toIntOrNull() ?: return false
            if (v !in 0..255) return false
            n[i] = v
        }
        return when {
            n[0] == 10 -> true
            n[0] == 127 -> true
            n[0] == 192 && n[1] == 168 -> true
            n[0] == 172 && n[1] in 16..31 -> true
            n[0] == 169 && n[1] == 254 -> true
            else -> false
        }
    }

    /** Thêm http:// hoặc https:// cho tiền tố (dùng khi lưu/đối chiếu). */
    fun normalizeBase(raw: String?): String? {
        val v = raw?.trim()?.trimEnd('/').orEmpty()
        if (v.isEmpty()) return null
        if (!v.startsWith("http://") && !v.startsWith("https://")) return null
        return v
    }

    // ────────────────────────────────────────────────────────────── dò máy chủ

    /**
     * Thử `GET <base>/app/ping` (timeout 2,5 s). Thành công = HTTP 200 + body JSON có `"service":"dashboard-os"`.
     * Trả base đã chuẩn hoá kèm `webUrl = base + "/call-web.html"`, `apiBase = base`; null = không phải máy chủ.
     */
    fun probe(base: String?): Server? {
        val b = normalizeBase(base) ?: return null
        val body = httpGet(b + PING_PATH) ?: return null
        if (!SERVICE_RE.containsMatchIn(body)) return null
        return Server(base = b, apiBase = b, webUrl = "$b/$WEB_PAGE")
    }

    /** GET đơn giản bằng HttpURLConnection; chỉ trả body khi HTTP 200. */
    private fun httpGet(urlStr: String): String? {
        var conn: HttpURLConnection? = null
        try {
            val c = (URL(urlStr).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = TIMEOUT_MS
                readTimeout = TIMEOUT_MS
                instanceFollowRedirects = true
                useCaches = false
                setRequestProperty("accept", "application/json")
                setRequestProperty("cache-control", "no-cache")
                setRequestProperty("user-agent", "DashboardOS-Android")
            }
            conn = c
            if (c.responseCode != HttpURLConnection.HTTP_OK) return null
            val stream = c.inputStream ?: return null
            return BufferedReader(InputStreamReader(stream, Charsets.UTF_8)).use { it.readText() }
        } catch (t: Throwable) {
            return null
        } finally {
            try {
                conn?.disconnect()
            } catch (t: Throwable) {
                // bỏ qua
            }
        }
    }

    // ────────────────────────────────────────────────────────────── nội bộ

    private val SCHEME_RE = Regex("^([A-Za-z][A-Za-z0-9+.\\-]*)://")
    private val HOST_RE = Regex("^[A-Za-z0-9]([A-Za-z0-9._\\-]*)$")
    private val IPV6_RE = Regex("^\\[[0-9A-Fa-f:.]+]$")
    private val SERVICE_RE = Regex("\"service\"\\s*:\\s*\"dashboard-os\"")

    /** Chuỗi host:port có dấu ':' thật sự (không tính IPv6 trong ngoặc) -> người dùng đã gõ cổng. */
    private fun colonGiven(hostPort: String): Boolean {
        if (hostPort.startsWith("[")) {
            val end = hostPort.indexOf(']')
            return end >= 0 && hostPort.substring(end + 1).startsWith(':')
        }
        return hostPort.contains(':')
    }

    /** "/b39feb53_remote_webview_server/call-web.html" -> "/b39feb53_remote_webview_server" (bỏ tên tệp). */
    private fun prefixOf(path: String): String {
        val segments = path.split('/').filter { it.isNotEmpty() }
        if (segments.isEmpty()) return ""
        val keep = if (segments.last().contains('.')) segments.dropLast(1) else segments
        if (keep.isEmpty()) return ""
        return "/" + keep.joinToString("/")
    }
}

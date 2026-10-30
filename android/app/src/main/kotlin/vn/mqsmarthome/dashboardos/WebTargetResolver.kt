package vn.mqsmarthome.dashboardos

import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * (13/11/2026) GD6 — HAI Ô NHẬP: "Trang điều khiển (https)" và "Máy chủ API (LAN)".
 *
 * Vì sao phải tách đôi (bối cảnh đã kiểm chứng):
 *  - WebView chỉ được cấp micro/camera (getUserMedia) trong SECURE CONTEXT → trang điều khiển phải mở bằng
 *    **https**, tức đi qua domain + ingress của Home Assistant:
 *    `https://<domain>/api/hassio_ingress/<TOKEN>/launcher-config.html`.
 *    Trang này (đúng add-on) trả **401** khi WebView chưa có cookie Home Assistant — 401 KHÔNG phải lỗi,
 *    nó chỉ có nghĩa "hãy đăng nhập HA", nên app vẫn phải coi là TÌM THẤY và mở bình thường.
 *  - API riêng của app (`/app/register`, `/app/incoming`, `/app/answer`, `/app/decline`) thì phải gọi **LAN**
 *    (`http://192.168.10.2:18080`): ingress cần cookie HA, HttpURLConnection không có cookie → không dùng được.
 *
 * Nên: ô 1 → [webUrl] (WebView), ô 2 → [apiBase] (PhoneService + PhoneApi). Hai giá trị lưu riêng, KHÔNG suy ra
 * cái này từ cái kia khi đã có cả hai.
 *
 * Phần "nhận biết đúng add-on" (thuần, không mạng) tách khỏi phần gọi mạng để unit test được:
 *  - [webCandidates]  : domain/URL người dùng gõ → danh sách URL ứng viên (thứ tự ưu tiên),
 *  - [isAcceptedWeb]  : (200 | 401) và body KHÔNG phải SPA của Home Assistant,
 *  - [isHomeAssistantSpa] : body có `<title>Home Assistant</title>` → của HA, không phải add-on,
 *  - [apiCandidates]  : ô 2 → các gốc API ứng viên (`http://host:18080`, ...),
 *  - [apiBaseOrNull]  : chọn apiBase (ô 2, hoặc suy ra từ ô 1 khi ô 1 là IP LAN),
 *  - [callPageUrl]    : webUrl → trang gọi (cùng thư mục ingress) khi bấm "Nghe".
 *
 * Cả tệp chỉ dùng java.net (không có API Android) → chạy được trong unit test JVM.
 */
object WebTargetResolver {

    /** Tiền tố ingress của Home Assistant (HA tự thêm token phía sau). */
    const val INGRESS_PREFIX = "/api/hassio_ingress"

    /**
     * TOKEN ingress mặc định của add-on (người dùng sửa được ở Cài đặt → [Prefs.KEY_INGRESS_TOKEN]).
     * Đây là chuỗi nằm sau `/api/hassio_ingress/` trong URL do Home Assistant cấp.
     */
    const val DEFAULT_INGRESS_TOKEN = "KJjH_rSB8SdDeyjszvdZnnH1pRlxySfVG5VmgDMVf38"

    /** Trang điều khiển (thư mục public của add-on). */
    const val LAUNCHER_PAGE = "launcher-config.html"

    /** Trang gọi (video) — cùng thư mục với trang điều khiển. */
    const val CALL_PAGE = "call-web.html"

    /** Thư mục ingress cũ / proxy giữ tên add-on. */
    const val ADDON_SLUG = ServerResolver.ADDON_SLUG

    /** Cổng mặc định của web server add-on (host network). */
    const val ADDON_PORT = ServerResolver.ADDON_PORT

    /** Giá trị điền sẵn cho ô "Máy chủ API (LAN)". */
    const val DEFAULT_API_INPUT = "192.168.10.2:18080"

    /** Timeout mỗi lần GET (đủ cho 1 trang HTML; sai địa chỉ thì thất bại nhanh). */
    const val TIMEOUT_MS = 4000

    /** Chỉ cần đầu trang để thấy `<title>` — không tải cả 180 KB của launcher-config.html. */
    private const val BODY_MAX = 16_384

    /** Kết quả 1 lần GET trang điều khiển: mã HTTP + đầu body. */
    data class WebCheck(val url: String, val status: Int, val body: String?) {
        /** true = đúng add-on (200 hoặc 401) và không phải trang SPA của Home Assistant. */
        val accepted: Boolean get() = isAcceptedWeb(status, body)
    }

    // ────────────────────────────────────────────────────────────── ô 1: trang điều khiển

    /**
     * Sinh danh sách URL trang điều khiển ứng viên từ chuỗi người dùng gõ ở ô 1.
     *
     *  - Người dùng đã gõ tiền tố đường dẫn (URL đầy đủ, vd `https://hass/.../launcher-config.html`) → thử
     *    đúng cái đó trước.
     *  - **Domain** (không phải IP LAN) → đúng thứ tự yêu cầu:
     *      1. `https://<domain>/api/hassio_ingress/<TOKEN>/launcher-config.html`  (ingress HA — cần đăng nhập HA)
     *      2. `https://<domain>/b39feb53_remote_webview_server/launcher-config.html` (proxy giữ tên add-on)
     *      3. `https://<domain>/launcher-config.html` (add-on phục vụ thẳng ở gốc domain)
     *  - **IP LAN** (192.168.x, 10.x, 172.16-31.x, 127.x, localhost) → https trước (secure context cho micro/camera):
     *      `https://<ip>/launcher-config.html`, `https://<ip>/<slug>/launcher-config.html`,
     *      `http://<ip>:18080/launcher-config.html`, `http://<ip>/launcher-config.html`.
     *  - Loại trùng, giữ thứ tự. Chuỗi rỗng / rác → danh sách rỗng.
     */
    fun webCandidates(input: String?, token: String? = null): List<String> {
        val raw = input?.trim().orEmpty()
        if (raw.isEmpty()) return emptyList()
        val a = ServerResolver.parse(raw) ?: return emptyList()
        val tok = sanitizeToken(token)
        val out = LinkedHashSet<String>()
        val prefix = a.prefix

        fun add(scheme: String, port: Int, path: String) {
            val netloc = if (port > 0) "${a.host}:$port" else a.host
            out.add("$scheme://$netloc$path")
        }

        // Đúng thứ người dùng gõ (họ đã dán URL đầy đủ, kể cả URL ingress).
        if (prefix.isNotEmpty()) add(a.scheme, a.port, "$prefix/$LAUNCHER_PAGE")

        if (a.lan) {
            val port = if (a.port > 0) a.port else ADDON_PORT
            // TLS trước: chỉ https mới là secure context (WebView mới cấp micro/camera). Không có TLS thì
            // lần thử này thất bại rất nhanh rồi rơi xuống http.
            add("https", a.port, "/$LAUNCHER_PAGE")
            add("https", a.port, "/$ADDON_SLUG/$LAUNCHER_PAGE")
            // add-on chạy thẳng trên LAN (http, cổng 18080) — trang vẫn mở được nhưng KHÔNG có micro/camera.
            add("http", port, "/$LAUNCHER_PAGE")
            if (prefix.isNotEmpty()) add("http", port, "$prefix/$LAUNCHER_PAGE")
            add("http", a.port, "/$LAUNCHER_PAGE")
        } else {
            // (1) ingress của Home Assistant — dạng CHÍNH, cần đăng nhập HA một lần trong WebView.
            add("https", a.port, "$INGRESS_PREFIX/$tok/$LAUNCHER_PAGE")
            // (2) reverse proxy giữ tên add-on.
            add("https", a.port, "/$ADDON_SLUG/$LAUNCHER_PAGE")
            // (3) add-on phục vụ thẳng ở gốc domain.
            add("https", a.port, "/$LAUNCHER_PAGE")
        }
        return out.toList()
    }

    /**
     * Body này có phải SPA của Home Assistant không?
     *
     * Trang chủ/portal của HA trả `<title>Home Assistant</title>`, còn add-on trả `<title>Dashboard</title>`.
     * Đây là dấu hiệu duy nhất đủ tin cậy để loại `https://<domain>/launcher-config.html` khi domain đó chỉ là
     * HA (không có add-on) — đúng lỗi "trả về HTML của HA nên báo không tìm thấy Dashboard OS".
     */
    fun isHomeAssistantSpa(body: String?): Boolean {
        val b = body ?: return false
        if (b.isBlank()) return false
        return HA_TITLE_RE.containsMatchIn(b)
    }

    /**
     * Chấp nhận URL trang điều khiển khi:
     *  - mã HTTP **200** (add-on trả trang) hoặc **401** (đúng add-on, WebView chưa có cookie HA → cần đăng nhập), VÀ
     *  - body **không** phải SPA của Home Assistant.
     */
    fun isAcceptedWeb(status: Int, body: String?): Boolean {
        if (status != HttpURLConnection.HTTP_OK && status != HttpURLConnection.HTTP_UNAUTHORIZED) return false
        return !isHomeAssistantSpa(body)
    }

    // ────────────────────────────────────────────────────────────── ô 2: máy chủ API (LAN)

    /**
     * Sinh danh sách gốc API ứng viên từ ô 2. API của app chỉ sống ở GỐC add-on (`/app/...`), nên tiền tố
     * đường dẫn (nếu người dùng dán kèm) bị bỏ.
     *
     *  - `192.168.10.2:18080`  -> http://192.168.10.2:18080, https://192.168.10.2:18080
     *  - `192.168.10.2`        -> http://192.168.10.2:18080, http://192.168.10.2, https://192.168.10.2
     *  - `hass.example.com:8123` -> https://hass.example.com:8123, http://hass.example.com:8123
     *  - rỗng / rác -> danh sách rỗng.
     */
    fun apiCandidates(input: String?): List<String> {
        val raw = input?.trim().orEmpty()
        if (raw.isEmpty()) return emptyList()
        val a = ServerResolver.parse(raw) ?: return emptyList()
        val out = LinkedHashSet<String>()

        fun add(scheme: String, port: Int) {
            out.add("$scheme://${a.host}" + if (port > 0) ":$port" else "")
        }

        val other = if (a.scheme == "http") "https" else "http"
        if (a.port > 0) {
            add(a.scheme, a.port)
            add(other, a.port)
        } else {
            if (a.lan) add(a.scheme, ADDON_PORT)   // cổng add-on (trường hợp phổ biến nhất trong LAN)
            add(a.scheme, 0)                       // cổng mặc định của scheme (80 / 443)
            add(other, 0)
        }
        return out.toList()
    }

    /**
     * apiBase dùng cho PhoneService/PhoneApi:
     *  - ô 2 có giá trị → lấy ứng viên đầu của [apiCandidates] (thêm `http://` nếu người dùng gõ thiếu),
     *  - ô 2 TRỐNG → suy ra từ ô 1 **chỉ khi ô 1 là IP LAN**: `http://<ip>:18080` (hoặc đúng cổng đã gõ),
     *  - không suy ra được (ô 1 là domain / rác) → null (màn hình chính báo lỗi rõ ràng).
     */
    fun apiBaseOrNull(webInput: String?, apiInput: String?): String? {
        apiCandidates(apiInput).firstOrNull()?.let { return it }
        val a = ServerResolver.parse(webInput) ?: return null
        if (!a.lan) return null
        val port = if (a.port > 0) a.port else ADDON_PORT
        return "http://${a.host}:$port"
    }

    // ────────────────────────────────────────────────────────────── trang gọi + token

    /**
     * webUrl → trang gọi trong CÙNG thư mục (giữ nguyên tiền tố ingress, nên cookie HA vẫn áp dụng):
     * `https://hass/api/hassio_ingress/<TOKEN>/launcher-config.html` -> `.../call-web.html?call=<id>`.
     * null = webUrl không dùng được.
     */
    fun callPageUrl(webUrl: String?, callId: String): String? {
        val base = webUrl?.trim().orEmpty()
        if (!base.startsWith("http://") && !base.startsWith("https://")) return null
        val cut = base.indexOfAny(charArrayOf('?', '#'))
        val noQuery = if (cut >= 0) base.substring(0, cut) else base
        val slash = noQuery.lastIndexOf('/')
        val last = noQuery.substring(slash + 1)
        val dir = if (last.contains('.')) noQuery.substring(0, slash + 1) else noQuery.trimEnd('/') + "/"
        val query = if (callId.isBlank()) "" else "?call=" + URLEncoder.encode(callId, "UTF-8")
        return "$dir$CALL_PAGE$query"
    }

    /**
     * Gốc của một URL (`https://hass.mqsmarthome.io.vn/api/hassio_ingress/<TOKEN>/launcher-config.html` ->
     * `https://hass.mqsmarthome.io.vn`) — dùng cho nút "Đăng nhập Home Assistant" ở Cài đặt: mở trang chủ HA
     * để đăng nhập (cookie), sau đó ingress mới trả trang thay vì 401. null = URL không dùng được.
     */
    fun originUrl(url: String?): String? {
        val u = url?.trim().orEmpty()
        return ORIGIN_RE.find(u)?.groupValues?.get(1)
    }

    /** Token ingress hợp lệ (bỏ khoảng trắng / `/` thừa); rỗng → [DEFAULT_INGRESS_TOKEN]. */
    fun sanitizeToken(token: String?): String {
        val t = token?.trim()?.trim('/')?.trim().orEmpty()
        return if (t.isEmpty()) DEFAULT_INGRESS_TOKEN else t
    }

    // ────────────────────────────────────────────────────────────── gọi mạng

    /**
     * GET một URL trang điều khiển (KHÔNG theo redirect: cần thấy đúng mã của add-on).
     * Trả [WebCheck] kể cả 401/404 (để [WebCheck.accepted] quyết định); null = không kết nối được.
     */
    fun probeWeb(url: String?): WebCheck? {
        val u = url?.trim().orEmpty()
        if (!u.startsWith("http://") && !u.startsWith("https://")) return null
        var conn: HttpURLConnection? = null
        try {
            val c = (URL(u).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = TIMEOUT_MS
                readTimeout = TIMEOUT_MS
                instanceFollowRedirects = false
                useCaches = false
                setRequestProperty("accept", "text/html,application/xhtml+xml")
                setRequestProperty("cache-control", "no-cache")
                setRequestProperty("user-agent", "DashboardOS-Android")
            }
            conn = c
            val code = c.responseCode
            val stream = if (code in 200..299) c.inputStream else c.errorStream
            val body = if (stream == null) null else readHead(stream)
            return WebCheck(u, code, body)
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

    /** Đọc tối đa [BODY_MAX] ký tự đầu (đủ cho `<title>`). */
    private fun readHead(stream: java.io.InputStream): String {
        BufferedReader(InputStreamReader(stream, Charsets.UTF_8)).use { reader ->
            val sb = StringBuilder()
            val buf = CharArray(2048)
            while (sb.length < BODY_MAX) {
                val n = reader.read(buf)
                if (n <= 0) break
                sb.append(buf, 0, minOf(n, BODY_MAX - sb.length))
            }
            return sb.toString()
        }
    }

    // ────────────────────────────────────────────────────────────── nội bộ

    /** `<title>Home Assistant</title>` — cho phép khoảng trắng/xuống dòng giữa các phần. */
    private val HA_TITLE_RE = Regex(
        "<title>\\s*Home\\s*Assistant\\s*</title>",
        RegexOption.IGNORE_CASE
    )

    /** `https://host:port` ở đầu URL (không gồm đường dẫn / query). */
    private val ORIGIN_RE = Regex("^(https?://[^/?#\\s]+)", RegexOption.IGNORE_CASE)
}

package vn.mqsmarthome.dashboardos

import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

/**
 * (18/11/2026) GD10 — TỰ TẠO PHIÊN INGRESS của Home Assistant (`ingress_session`).
 *
 * VÌ SAO CẦN: đăng nhập Lovelace **không** tạo cookie ingress. Home Assistant giữ phiên của nó trong
 * `localStorage` (`hassTokens`) và **chỉ** cấp `ingress_session` khi có người mở add-on: trang HA gọi
 * `POST /api/hassio/ingress/session/<slug>` (Supervisor, đi qua proxy `/api/hassio/…` của HA core, cần header
 * `Authorization: Bearer <access_token>` của người dùng đã đăng nhập) rồi đặt cookie
 * `ingress_session=<session>; Path=/` cho domain của HA. Đúng vì vậy mà bản cũ đứng ở Lovelace: không ai tạo
 * phiên ingress, nên `GET /api/hassio_ingress/<TOKEN>/launcher-config.html` luôn trả **401** cho tới khi người
 * dùng mở add-on bằng tay.
 *
 * App làm đúng việc đó bằng native code:
 *  1. MainActivity đọc access token từ `localStorage.hassTokens` của chính trang HA (WebView,
 *     [HaLogin.tokenFromJsValue]),
 *  2. [createSession] `POST` tới Supervisor để lấy `{"session": "…"}`,
 *  3. [HaCookie.setIngressSession] ghi cookie `ingress_session` (path `/`) rồi `flush()`,
 *  4. nhịp dò 1 s thấy `webUrl` trả **200** → mở dashboard.
 *
 * Hai dạng đường dẫn đều được thử (Supervisor đổi API theo phiên bản):
 *  - `POST /api/hassio/ingress/session/<slug>`  body `{}`                     (bản mới),
 *  - `POST /api/hassio/ingress/session`         body `{"addon":"<slug>"}`     (bản cũ).
 *
 * [parseSession] / [sessionPaths] / [bodyFor] là phần THUẦN → unit test trên JVM ([HaIngressTest]).
 */
object HaIngress {

    /** Timeout mỗi lần gọi (Supervisor trả lời nhanh; mất mạng thì thôi). */
    const val TIMEOUT_MS = 6000

    /** Đường dẫn tạo phiên ingress, theo thứ tự thử. */
    fun sessionPaths(slug: String): List<String> {
        val s = slug.trim().trim('/')
        val out = ArrayList<String>(2)
        if (s.isNotEmpty()) out.add("/api/hassio/ingress/session/$s")
        out.add("/api/hassio/ingress/session")
        return out
    }

    /** Body JSON cho [path] tương ứng (`/session/<slug>` không cần `addon`). */
    fun bodyFor(path: String, slug: String): String =
        if (path.endsWith("/session")) "{\"addon\":\"" + slug.trim().trim('/') + "\"}" else "{}"

    /**
     * Mọi tổ hợp (đường dẫn, body) sẽ thử, theo thứ tự (loại trùng): `/session/<slug>` với `{}` trước, rồi body
     * có `addon` (một số bản Supervisor cũ nhận body này cho cả hai đường dẫn).
     */
    fun sessionAttempts(slug: String): List<Pair<String, String>> {
        val paths = sessionPaths(slug)
        val addonBody = bodyFor("/api/hassio/ingress/session", slug)
        val out = LinkedHashSet<Pair<String, String>>()
        for (p in paths) out.add(p to bodyFor(p, slug))
        for (p in paths) out.add(p to addonBody)
        return out.toList()
    }

    /** `{"session": "abc"}` → `abc` (null khi body không có trường đó). */
    fun parseSession(body: String?): String? {
        val b = body ?: return null
        val m = SESSION_RE.find(b) ?: return null
        val session = m.groupValues[1].trim()
        return session.ifEmpty { null }
    }

    /**
     * Tạo phiên ingress thật (chạy ở luồng nền). Trả session token hoặc null.
     *
     * [log] nhận các dòng chẩn đoán (`[login] session …`) để MainActivity ghi vào Logcat.
     */
    fun createSession(
        origin: String,
        slug: String = ServerResolver.ADDON_SLUG,
        accessToken: String,
        log: (String) -> Unit = {},
    ): String? {
        val base = origin.trim().trimEnd('/')
        val token = accessToken.trim()
        if (base.isEmpty() || token.isEmpty()) return null
        if (!base.startsWith("http://", true) && !base.startsWith("https://", true)) return null

        for ((path, body) in sessionAttempts(slug)) {
            val (code, text) = post("$base$path", token, body) ?: continue
            val session = parseSession(text)
            log("[login] session POST $path → $code" + if (session == null) "" else " session=yes")
            if (code == HttpURLConnection.HTTP_OK && session != null) return session
        }
        return null
    }

    /** POST JSON kèm `Authorization: Bearer`; trả (mã HTTP, body) — null khi không kết nối được. */
    private fun post(urlStr: String, accessToken: String, body: String): Pair<Int, String?>? {
        var conn: HttpURLConnection? = null
        try {
            val c = (URL(urlStr).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = TIMEOUT_MS
                readTimeout = TIMEOUT_MS
                instanceFollowRedirects = false
                useCaches = false
                doOutput = true
                setRequestProperty("authorization", "Bearer $accessToken")
                setRequestProperty("content-type", "application/json")
                setRequestProperty("accept", "application/json")
                setRequestProperty("user-agent", "DashboardOS-Android")
            }
            conn = c
            c.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val code = c.responseCode
            val stream = if (code in 200..299) c.inputStream else c.errorStream
            val text = if (stream == null) null else readAll(stream)
            return code to text
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

    private fun readAll(stream: java.io.InputStream): String =
        BufferedReader(InputStreamReader(stream, Charsets.UTF_8)).use { it.readText() }

    /** `"session"\s*:\s*"…"` (Supervisor trả `{"session":"…"}`). */
    private val SESSION_RE = Regex("\"session\"\\s*:\\s*\"([^\"]+)\"")
}

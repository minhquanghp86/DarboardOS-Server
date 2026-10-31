package vn.mqsmarthome.dashboardos

import java.net.HttpURLConnection
import java.security.SecureRandom
import java.security.cert.X509Certificate
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

/**
 * (21/11/2026) GD13 — "CHẤP NHẬN CHỨNG CHỈ TỰ KÝ, NHƯNG CHỈ CHO HOST MÌNH ĐÃ CẤU HÌNH".
 *
 * Bối cảnh (đã kiểm chứng): WebView chỉ cấp micro/camera trong SECURE CONTEXT, tức trang phải là **https**. Trước
 * đây app cố lấy https bằng cách đi qua ingress của Home Assistant (`https://<domain>/api/hassio_ingress/<TOKEN>/…`)
 * — nhưng phiên ingress CHỈ được Supervisor cấp khi chính HA frontend mở panel, nên người dùng đăng nhập HA xong vẫn
 * không vào được dashboard (xem `DashboardTarget`, `HaIngress`).
 *
 * Nay add-on tự phục vụ HTTPS ở cổng [TLS_PORT] bằng **chứng chỉ tự ký** (server: `src/tls.ts`, sinh một lần trong
 * `/data/tls/`, SAN = mọi IPv4 của máy + localhost + hostname). Trình duyệt nào cũng coi chứng chỉ đó là "không tin
 * cậy" — nên app phải chủ động chấp nhận. Nguyên tắc an toàn ở đây:
 *
 *  1. **Chỉ host đã cấu hình** (IP/domain người dùng nhập, hoặc host của `webUrl`/`apiBase` đang lưu) mới được
 *     chấp nhận — một trang lạ (quảng cáo, iframe, chuyển hướng ra Internet) vẫn bị CHẶN như mặc định.
 *  2. Chỉ chấp nhận **lỗi liên quan chứng chỉ** (tự ký / không tin cậy / sai tên / hết hạn) — lỗi khác thì chặn.
 *  3. Không đụng tới `SSLContext` mặc định của app: chỉ connection/proceed của đúng host đó.
 *
 * Tệp THUẦN (không API Android) nên unit test được trên JVM — xem `TlsPolicyTest`.
 */
object TlsPolicy {

    /**
     * Cổng HTTPS của add-on (cấu hình add-on: `18443/tcp`, `https_port`; server: `HTTPS_PORT` trong `src/tls.ts`).
     * Đây là CÙNG một giá trị với `ServerResolver.ADDON_TLS_PORT`.
     */
    const val TLS_PORT = 18443

    /**
     * Trang điều khiển ưu tiên khi người dùng nhập IP LAN: **https://<ip>:18443/<trang>** — có secure context nên
     * WebView cấp được micro/camera, và KHÔNG cần đăng nhập Home Assistant.
     */
    fun httpsPage(host: String, page: String = WebTargetResolver.LAUNCHER_PAGE): String =
        "https://${host.trim().trimEnd('/')}:$TLS_PORT/${page.trimStart('/')}"

    // ────────────────────────────────────────────────────────────── host đã cấu hình

    /**
     * Host của một chuỗi người dùng nhập / URL đã lưu (`192.168.10.2`, `https://192.168.10.2:18443/x.html`,
     * `hass.example.com:8123`). Chữ thường; `null` khi chuỗi không dùng được.
     */
    fun hostOf(input: String?): String? = ServerResolver.parse(input)?.host

    /**
     * Tập host được phép chấp nhận chứng chỉ tự ký: gom từ mọi đầu vào đã cấu hình (chuỗi người dùng gõ, `webUrl`,
     * `loginUrl`, `apiBase`). Chuỗi hỏng bị bỏ qua; kết quả luôn chữ thường.
     */
    fun allowedHosts(vararg inputs: String?): Set<String> {
        val out = LinkedHashSet<String>()
        for (raw in inputs) out.addAll(hostsOf(raw))
        return out
    }

    /** Mọi host suy ra được từ [raw] (một chuỗi có thể chứa cả URL đầy đủ). */
    fun hostsOf(raw: String?): List<String> {
        val v = raw?.trim().orEmpty()
        if (v.isEmpty()) return emptyList()
        val out = ArrayList<String>(2)
        ServerResolver.parse(v)?.host?.let { out.add(it) }
        // (21/11/2026) URL đầy đủ có tiền tố đường dẫn vẫn lấy được origin.
        WebTargetResolver.originUrl(v)?.let { origin ->
            ServerResolver.parse(origin)?.host?.let { if (!out.contains(it)) out.add(it) }
        }
        return out
    }

    /** Host có nằm trong danh sách đã cấu hình không (so khớp không phân biệt hoa/thường). */
    fun allowSelfSignedHost(host: String?, allowed: Set<String>): Boolean {
        val h = host?.trim()?.lowercase().orEmpty()
        if (h.isEmpty()) return false
        if (allowed.isEmpty()) return false
        return allowed.any { it.equals(h, ignoreCase = true) }
    }

    /**
     * Chấp nhận (proceed) lỗi SSL của WebView? Điều kiện: host đã cấu hình **và** đây là lỗi về chứng chỉ
     * (`certError = true` khi `SslError.getPrimaryError()` là UNTRUSTED/IDMISMATCH/EXPIRED/…). Lỗi khác (vd mất
     * mạng) không bao giờ "proceed".
     */
    fun allowProceed(host: String?, allowed: Set<String>, certError: Boolean): Boolean =
        certError && allowSelfSignedHost(host, allowed)

    // ────────────────────────────────────────────────────────────── URL theo LAN

    /** URL có trỏ tới host LAN/loopback (IP riêng hoặc `localhost`) không — tức chế độ "không cần đăng nhập HA". */
    fun isLanUrl(url: String?): Boolean {
        val host = hostOf(url) ?: return false
        return ServerResolver.isLanHost(host)
    }

    /** Chuỗi người dùng nhập có phải IP LAN / localhost (chế độ khuyến nghị) không. */
    fun isLanInput(input: String?): Boolean {
        val a = ServerResolver.parse(input) ?: return false
        return a.lan
    }

    /**
     * URL nào đang dùng chứng chỉ tự ký của add-on: `https://<ip-lan>:18443/...` (hoặc một host LAN bất kỳ trên
     * https). Dùng cho cảnh báo ở màn Cài đặt: "chứng chỉ tự ký (chỉ dùng trong LAN/Tailscale)".
     */
    fun isSelfSignedUrl(url: String?): Boolean {
        val v = url?.trim().orEmpty()
        if (!v.startsWith("https://", ignoreCase = true)) return false
        return isLanUrl(v) || v.contains(":$TLS_PORT")
    }

    /** Tập host LAN của một chuỗi (dùng cho các lời gọi native: PhoneApi) — rỗng khi host không phải LAN. */
    fun lanHostsOf(vararg inputs: String?): Set<String> {
        val out = LinkedHashSet<String>()
        for (raw in inputs) {
            for (h in hostsOf(raw)) if (ServerResolver.isLanHost(h)) out.add(h)
        }
        return out
    }

    // ────────────────────────────────────────────────────────────── java.net: HttpURLConnection

    /**
     * Cho phép [conn] chấp nhận chứng chỉ tự ký **khi host của nó nằm trong [allowed]**; ngoài ra không đổi gì
     * (HttpURLConnection thường, hoặc host lạ → vẫn xác thực TLS bình thường).
     *
     * Dùng ở ba chỗ: `ServerResolver.probe`/`probeStatus` (dò `/app/ping`), `WebTargetResolver.probeWeb` (dò trang
     * điều khiển) và `PhoneApi` (register/incoming/answer/decline) — nhờ vậy đổi sang https://<ip>:18443 không làm
     * các lời gọi native hỏng vì "untrusted certificate".
     */
    fun applyTo(conn: HttpURLConnection, allowed: Set<String>) {
        val https = conn as? HttpsURLConnection ?: return
        val host = conn.url?.host?.lowercase().orEmpty()
        if (!allowSelfSignedHost(host, allowed)) return
        try {
            https.sslSocketFactory = trustAllFactory()
            // Chứng chỉ sinh từ danh sách IPv4 hiện tại của máy: nếu IP vừa đổi mà server chưa kịp sinh lại thì tên
            // trên chứng chỉ có thể chưa khớp — vẫn cho qua vì host ĐÚNG là host người dùng đã cấu hình (LAN).
            https.hostnameVerifier = javax.net.ssl.HostnameVerifier { _, _ -> true }
        } catch (t: Throwable) {
            // Không đặt được (hiếm): giữ xác thực mặc định — lời gọi sẽ thất bại và caller thử ứng viên kế tiếp.
        }
    }

    /**
     * `SSLSocketFactory` tin MỌI chứng chỉ. **Không** dùng làm mặc định của app: chỉ gắn cho đúng connection của host
     * đã cấu hình (xem [applyTo]) — và chỉ khi host đó là LAN/loopback (kiểm tra ở caller).
     */
    fun trustAllFactory(): SSLSocketFactory {
        val ctx = SSLContext.getInstance("TLS")
        ctx.init(null, arrayOf<TrustManager>(TRUST_ALL), SecureRandom())
        return ctx.socketFactory
    }

    private val TRUST_ALL: X509TrustManager = object : X509TrustManager {
        override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) = Unit
        override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) = Unit
        override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
    }
}

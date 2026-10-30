package vn.mqsmarthome.dashboardos

import android.util.Log
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * (10/11/2026) GD2 — goi API cua Dashboard OS tu dien thoai (khong dung thu vien mang ngoai: HttpURLConnection).
 *
 * Dia chi nguoi dung nhap la DIA CHI TRANG (vd https://host/b39.../call-web.html). Tu do dan xuat:
 *   origin = scheme://host[:port] + thu muc cua trang  ->  https://host/b39.../
 *   API    = origin + "app/..."                        ->  https://host/b39.../app/incoming?phone=...
 *   trang  = origin + "call-web.html?call=..."         ->  https://host/b39.../call-web.html?call=...
 * Nho vay ca truong hop chay qua ingress Home Assistant (co tien to /b39feb53_...) lan truy cap thang IP:port deu dung.
 */
object PhoneApi {

    private const val TAG = "PhoneApi"
    private const val TIMEOUT_MS = 5000

    data class Incoming(val id: String, val from: String, val fromName: String)

    /** Ket qua moi lan poll: co cuoc goi / khong co / loi mang (khong duoc coi la "het cuoc goi"). */
    sealed class Poll {
        object None : Poll()
        data class Ring(val call: Incoming) : Poll()
        object Error : Poll()
    }

    /** Chuan hoa URL nguoi dung nhap: them https:// neu thieu, chi nhan http(s). */
    fun normalize(raw: String?): String? {
        var v = raw?.trim().orEmpty()
        if (v.isEmpty()) return null
        // Da co scheme khac (ftp://, file://...) thi TU CHOI, khong duoc bien thanh "https://ftp://...".
        if (!SCHEME_RE.containsMatchIn(v)) v = "https://$v"
        val u = try { URL(v) } catch (t: Throwable) { return null }
        val scheme = u.protocol?.lowercase() ?: return null
        if (scheme != "http" && scheme != "https") return null
        if (u.host.isNullOrBlank()) return null
        return u.toString()
    }

    private val SCHEME_RE = Regex("^[A-Za-z][A-Za-z0-9+.-]*://")

    /** "https://host/b39/xxx.html?y=1" -> "https://host/b39/" (giu ca path prefix). */
    fun origin(raw: String?): String? {
        val u = try { URL(normalize(raw) ?: return null) } catch (t: Throwable) { return null }
        val host = u.host ?: return null
        val port = if (u.port > 0) ":${u.port}" else ""
        val path = u.path ?: ""
        val dir = when {
            path.isEmpty() -> "/"
            path.endsWith("/") -> path
            else -> path.substringBeforeLast('/', "") + "/"
        }
        return "${u.protocol}://$host$port$dir"
    }

    /** Goc API: origin bo dau "/" cuoi (de noi "app/register"). */
    fun apiBase(raw: String?): String? = origin(raw)?.trimEnd('/')

    fun apiUrl(raw: String?, path: String): String? {
        val base = apiBase(raw) ?: return null
        return base + (if (path.startsWith("/")) path else "/$path")
    }

    /** URL cua mot trang trong dashboard, vd pageUrl(url, "call-web.html", "call=abc"). */
    fun pageUrl(raw: String?, page: String, query: String = ""): String? {
        val base = origin(raw) ?: return null
        val q = if (query.isBlank()) "" else "?" + query.trimStart('?')
        return base + page.trimStart('/') + q
    }

    /** Dang ky (hoac cap nhat) may nay voi server. true = server da nhan. */
    fun register(raw: String?, id: String, name: String): Boolean {
        val url = apiUrl(raw, "app/register") ?: return false
        val body = JSONObject()
            .put("id", id)
            .put("name", name)
            .put("url", normalize(raw) ?: "")
            .toString()
        val (code, _) = request(url, "POST", body) ?: return false
        return code in 200..299
    }

    fun incoming(raw: String?, id: String): Poll {
        val url = apiUrl(raw, "app/incoming?phone=" + enc(id)) ?: return Poll.Error
        val (code, text) = request(url, "GET", null) ?: return Poll.Error
        if (code !in 200..299) return Poll.Error
        return try {
            val call = JSONObject(text).optJSONObject("call") ?: return Poll.None
            val callId = call.optString("id", "")
            if (callId.isEmpty()) Poll.None
            else Poll.Ring(Incoming(callId, call.optString("from", ""), call.optString("fromName", "")))
        } catch (t: Throwable) {
            Log.w(TAG, "incoming: JSON hong: ${t.message}")
            Poll.Error
        }
    }

    fun answer(raw: String?, phoneId: String, callId: String): Boolean =
        action(raw, "app/answer", phoneId, callId)

    fun decline(raw: String?, phoneId: String, callId: String): Boolean =
        action(raw, "app/decline", phoneId, callId)

    private fun action(raw: String?, path: String, phoneId: String, callId: String): Boolean {
        val url = apiUrl(raw, "$path?phone=${enc(phoneId)}&call=${enc(callId)}") ?: return false
        val (code, _) = request(url, "POST", "{}") ?: return false
        return code in 200..299
    }

    private fun enc(v: String): String = URLEncoder.encode(v, "UTF-8")

    /** Tra (ma HTTP, noi dung) hoac null khi khong ket noi duoc. */
    private fun request(urlStr: String, method: String, body: String?): Pair<Int, String>? {
        var conn: HttpURLConnection? = null
        try {
            val u = URL(urlStr)
            conn = (u.openConnection() as HttpURLConnection).apply {
                requestMethod = method
                connectTimeout = TIMEOUT_MS
                readTimeout = TIMEOUT_MS
                instanceFollowRedirects = true
                setRequestProperty("accept", "application/json")
                setRequestProperty("user-agent", "DashboardOS-Android")
                if (body != null) {
                    doOutput = true
                    setRequestProperty("content-type", "application/json; charset=utf-8")
                }
            }
            if (body != null) {
                conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.let { s ->
                BufferedReader(InputStreamReader(s, Charsets.UTF_8)).use { r -> r.readText() }
            } ?: ""
            return code to text
        } catch (t: Throwable) {
            Log.d(TAG, "$method $urlStr loi: ${t.javaClass.simpleName}: ${t.message}")
            return null
        } finally {
            try { conn?.disconnect() } catch (t: Throwable) { /* bo qua */ }
        }
    }
}

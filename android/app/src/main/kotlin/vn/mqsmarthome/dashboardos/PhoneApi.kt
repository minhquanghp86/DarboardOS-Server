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
 * (30/10/2026) GD4 — DOI CACH LAY DIA CHI: truoc day app suy ra goc API tu URL trang nguoi dung nhap; nay nguoi dung
 * chi nhap IP/domain, [ServerResolver] do ra `apiBase` MOT lan roi luu vao [Prefs]. Moi ham o day nhan THANG `apiBase`
 * (vd `http://192.168.10.2:18080`, hoac `https://hass.example.com/b39feb53_remote_webview_server`) va noi duong dan:
 *   API  = apiBase + "/app/..."              -> http://192.168.10.2:18080/app/incoming?phone=...
 *   trang= apiBase + "/call-web.html?call=..."-> http://192.168.10.2:18080/call-web.html?call=...
 * Khong con buoc "doan" nho vay, nen ca truong hop chay truc tiep IP:port lan sau ingress HA deu dung.
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

        /**
         * (17/11/2026) GD9 — server tra 401/403/404: goc API dung nhung THIEU COOKIE phien HA (ingress), hoac TOKEN
         * ingress sai (404). Phai khac [Error]: goi lai y nguyen se lap vo ich, can DANG NHAP lai hoac thu duong
         * dan khac (xem PhoneService.reprobeApi / WebTargetResolver.apiBasesForInput).
         */
        data class Denied(val code: Int) : Poll()
    }

    /** `apiBase` da luu + duong dan -> URL day du. null khi apiBase rong / khong phai http(s). */
    fun apiUrl(apiBase: String?, path: String): String? {
        val base = clean(apiBase) ?: return null
        return base + (if (path.startsWith("/")) path else "/$path")
    }

    /** URL cua mot trang trong dashboard: pageUrl(base, "call-web.html", "call=abc"). */
    fun webUrl(apiBase: String?, page: String, query: String = ""): String? {
        val base = clean(apiBase) ?: return null
        val q = if (query.isBlank()) "" else "?" + query.trimStart('?')
        return "$base/${page.trimStart('/')}$q"
    }

    /**
     * (GD8) Dang ky (hoac cap nhat) may nay voi server.
     *
     * Gui kem `deviceKey` (= ANDROID_ID, xem [Prefs.deviceKey]) + `model`: server gop cac ban ghi trung cua CUNG
     * MOT MAY (moi lan cai lai app / xoa du lieu app truoc day sinh id moi) va tra ve `id` CHUAN.
     *
     * @return `id` ma server dang giu (co the KHAC `id` gui len khi da gop) — null khi khong goi duoc / server tu choi.
     */
    fun register(
        apiBase: String?,
        webUrl: String?,
        id: String,
        name: String,
        deviceKey: String = "",
        model: String = "",
        cookie: String? = null
    ): String? {
        val url = apiUrl(apiBase, "app/register") ?: return null
        val body = JSONObject()
            .put("id", id)
            .put("name", name)
            .put("url", webUrl ?: "")
            .put("deviceKey", deviceKey)
            .put("model", model)
            .toString()
        val (code, text) = request(url, "POST", body, cookie) ?: return null
        if (code !in 200..299) return null
        // {ok:true, phone:{id,...}} — `phone.id` la id CHUAN sau khi server gop ban ghi trung deviceKey.
        return try {
            val canonical = JSONObject(text).optJSONObject("phone")?.optString("id") ?: ""
            if (canonical.isNotEmpty()) canonical else id
        } catch (t: Throwable) {
            Log.w(TAG, "register: JSON hong: ${t.message}")
            id
        }
    }

    /**
     * (GD8) Khoa nhan dang ON DINH cua may: dung ANDROID_ID khi may co, khong thi roi ve `fallback`
     * (id hien tai trong Prefs) — van hon la khong gui gi. Thuan tuy (khong cham API Android) de test duoc.
     */
    fun deviceKeyOf(androidId: String?, fallback: String): String {
        val a = androidId?.trim().orEmpty()
        return if (a.isNotEmpty()) a else fallback.trim()
    }

    fun incoming(apiBase: String?, id: String, cookie: String? = null): Poll {
        val url = apiUrl(apiBase, "app/incoming?phone=" + enc(id)) ?: return Poll.Error
        val (code, text) = request(url, "GET", null, cookie) ?: return Poll.Error
        if (code == 401 || code == 403 || code == 404) return Poll.Denied(code)
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

    fun answer(apiBase: String?, phoneId: String, callId: String, cookie: String? = null): Boolean =
        action(apiBase, "app/answer", phoneId, callId, cookie)

    fun decline(apiBase: String?, phoneId: String, callId: String, cookie: String? = null): Boolean =
        action(apiBase, "app/decline", phoneId, callId, cookie)

    /** (GD3) Ket thuc cuoc goi tu app (va tu trang call-web.html) — ke ca sau khi trang da `join`. */
    fun hangup(apiBase: String?, phoneId: String, callId: String, cookie: String? = null): Boolean =
        action(apiBase, "app/hangup", phoneId, callId, cookie)

    private fun action(apiBase: String?, path: String, phoneId: String, callId: String, cookie: String? = null): Boolean {
        val url = apiUrl(apiBase, "$path?phone=${enc(phoneId)}&call=${enc(callId)}") ?: return false
        val (code, _) = request(url, "POST", "{}", cookie) ?: return false
        return code in 200..299
    }

    private fun enc(v: String): String = URLEncoder.encode(v, "UTF-8")

    /** Chuan hoa apiBase: trim, bo `/` cuoi, bat buoc co scheme http(s). */
    private fun clean(raw: String?): String? {
        val v = raw?.trim()?.trimEnd('/').orEmpty()
        if (v.isEmpty()) return null
        if (!v.startsWith("http://") && !v.startsWith("https://")) return null
        return v
    }

    /**
     * Tra (ma HTTP, noi dung) hoac null khi khong ket noi duoc.
     *
     * (17/11/2026) GD9 — [cookie] = header `Cookie:` cua phien Home Assistant (xem [HaCookie]). Bat buoc khi
     * [apiBase] nam sau ingress (`https://<domain>/api/hassio_ingress/<TOKEN>`): thieu cookie -> 401.
     */
    private fun request(urlStr: String, method: String, body: String?, cookie: String? = null): Pair<Int, String>? {
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
                if (!cookie.isNullOrBlank()) setRequestProperty("cookie", cookie)
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

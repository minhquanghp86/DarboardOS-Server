package vn.mqsmarthome.dashboardos

import android.util.Log
import android.webkit.CookieManager

/**
 * (17/11/2026) GD9 — COOKIE PHIÊN HOME ASSISTANT cho các lời gọi API **native** (`/app/register`, `/app/incoming`,
 * `/app/answer`, `/app/decline`, `/app/hangup`).
 *
 * Vì sao cần: khi người dùng chỉ nhập MỘT địa chỉ là domain, app dùng ingress của Home Assistant cho cả WebView
 * **và** API: `https://<domain>/api/hassio_ingress/<TOKEN>/app/register`. Ingress trả **401** nếu request không có
 * cookie phiên HA (đã kiểm chứng), mà `HttpURLConnection` **không** dùng chung cookie store với WebView — nên phải
 * đọc `CookieManager.getInstance().getCookie(...)` rồi gắn header `Cookie:` cho từng request.
 *
 * Không có cookie = chưa đăng nhập Home Assistant → app hiện luồng đăng nhập (MainActivity: thanh thông báo + dò
 * cookie 1,5 s) và **chờ** có cookie rồi mới chạy service (PhoneService bỏ qua các nhịp poll khi thiếu cookie).
 *
 * Tệp này chỉ gọi API Android (không mạng) nên không unit-test trên JVM được; phần quyết định "có phải ingress
 * không / có cookie chưa" nằm ở [WebTargetResolver.isIngressBase] + [WebTargetResolver.hasSessionCookie] (đã có test).
 */
object HaCookie {

    private const val TAG = "HaCookie"

    /**
     * Header `Cookie:` cho [url] (null / rỗng = chưa có phiên). Gộp cookie của URL đầy đủ và của ORIGIN vì HA đặt
     * `ingress_session` theo path `/` còn một số bản đặt theo path `/api/hassio_ingress/<TOKEN>/`.
     */
    fun header(url: String?): String? {
        val u = url?.trim().orEmpty()
        if (u.isEmpty()) return null
        val cm = try {
            CookieManager.getInstance()
        } catch (t: Throwable) {
            Log.d(TAG, "CookieManager khong san sang: ${t.javaClass.simpleName}")
            return null
        }
        val pairs = LinkedHashMap<String, String>()
        for (target in listOfNotNull(u, WebTargetResolver.originUrl(u))) {
            val raw = try {
                cm.getCookie(target)
            } catch (t: Throwable) {
                null
            } ?: continue
            for (part in raw.split(';')) {
                val name = part.substringBefore('=').trim()
                if (name.isEmpty()) continue
                val value = part.substringAfter('=', "").trim()
                if (!pairs.containsKey(name)) pairs[name] = value
            }
        }
        if (pairs.isEmpty()) return null
        return pairs.entries.joinToString("; ") { "${it.key}=${it.value}" }
    }

    /** Đã có cookie phiên HA cho [url] chưa (dùng để quyết định "chờ đăng nhập" thay vì poll 401 liên tục). */
    fun hasSession(url: String?): Boolean = WebTargetResolver.hasSessionCookie(header(url))

    /** Có cookie (bất kỳ) cho [url] — ingress chỉ cần đúng phiên, nhưng vẫn hữu ích để log. */
    fun has(url: String?): Boolean = !header(url).isNullOrBlank()
}

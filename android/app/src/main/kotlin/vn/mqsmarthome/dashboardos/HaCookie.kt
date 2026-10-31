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
 * Không có cookie = chưa đăng nhập Home Assistant → app hiện luồng đăng nhập (MainActivity: thanh thông báo +
 * nhịp dò **1 s**, xem [HaLogin]) và **chờ** có cookie rồi mới chạy service (PhoneService bỏ qua các nhịp poll khi
 * thiếu cookie).
 *
 * (18/11/2026) GD10 — [setIngressSession]: ghi cookie `ingress_session` NGAY sau khi app tự tạo phiên ingress
 * ([HaIngress]) — bản thân việc đăng nhập Lovelace không sinh cookie đó.
 *
 * (20/11/2026) GD12 — phiên ingress nay do **JS trong trang HA** tạo và tự đặt cookie (`document.cookie`, xem
 * [HaIngress.sessionScript]) — đó là đường DUY NHẤT hoạt động (WS `supervisor/api` rồi `path=/api/hassio_ingress/`).
 * [setIngressSession] chỉ còn là lưới an toàn: nếu `document.cookie` không đọc lại được thì app ghi hộ bằng
 * [CookieManager] với **cùng** `Path` như frontend.
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

    /**
     * (18/11/2026) GD10 — ghi cookie phiên ingress ([HaIngress.COOKIE_NAME] = `ingress_session`) cho [origin].
     *
     * Dùng ngay sau khi JS trong trang HA tạo được phiên ([HaIngress.sessionScript]): phiên vừa tạo phải nằm trong
     * cookie store của WebView thì `GET /api/hassio_ingress/<TOKEN>/launcher-config.html` mới trả **200** thay vì
     * 401 — đúng việc trang HA vẫn làm khi người dùng mở add-on (đó là lý do "thoát app, mở lại thì được").
     *
     * (20/11/2026) GD12 — `Path=/api/hassio_ingress/` **đúng như HA frontend** (`document.cookie` trong bundle
     * đang chạy: `path=/api/hassio_ingress/;SameSite=Strict[;Secure]`). Bản GD10 ghi `Path=/`: cookie vẫn tới
     * được ingress, nhưng khác hẳn frontend và bị gửi kèm mọi request khác của HA.
     * Trả false khi CookieManager không ghi được (không có WebView / URL không hợp lệ).
     */
    fun setIngressSession(origin: String?, session: String?): Boolean {
        val o = origin?.trim()?.trimEnd('/').orEmpty()
        val s = session?.trim().orEmpty()
        if (o.isEmpty() || s.isEmpty()) return false
        if (!o.startsWith("http://", true) && !o.startsWith("https://", true)) return false
        // Session token của Supervisor phải "an toàn" (chỉ chữ/số/-/_/.) — xem [HaIngress.isSafeSession].
        if (!HaIngress.isSafeSession(s)) return false
        return try {
            val cm = CookieManager.getInstance()
            cm.setAcceptCookie(true)
            cm.setCookie(o, HaIngress.cookieValue(s, secure = o.startsWith("https://", true)))
            cm.flush()
            // Đọc lại ĐÚNG đường dẫn ingress: cookie có `Path=/api/hassio_ingress/` nên `getCookie(origin)`
            // KHÔNG thấy nó (khác `Path=/` của bản GD10).
            WebTargetResolver.hasSessionCookie(header(o + HaIngress.COOKIE_PATH))
        } catch (t: Throwable) {
            Log.d(TAG, "setIngressSession loi: ${t.javaClass.simpleName}")
            false
        }
    }
}

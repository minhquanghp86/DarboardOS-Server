package vn.mqsmarthome.dashboardos

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import java.util.UUID

/**
 * (10/11/2026) GD2 — SharedPreferences dung chung cho ca app (MainActivity, PhoneService, Cai dat).
 *
 * (13/11/2026) GD6 — HAI GIA TRI DOC LAP (khong suy ra cai nay tu cai kia khi da co ca hai):
 *   - [KEY_WEB_URL]  = TRANG DIEU KHIEN (https) — WebView mo THANG gia tri nay, vd
 *     `https://hass.mqsmarthome.io.vn/api/hassio_ingress/<TOKEN>/launcher-config.html`.
 *     Phai la https vi WebView chi cap micro/camera trong secure context.
 *   - [KEY_API_BASE] = GOC API (LAN) — PhoneService / PhoneApi.register / incoming / answer / decline dung THANG
 *     gia tri nay, vd `http://192.168.10.2:18080` (ingress cannot cookie HA nen HttpURLConnection khong dung duoc).
 *   - [KEY_WEB_INPUT] / [KEY_API_INPUT] = chuoi nguoi dung go lan cuoi, chi de dien san o nhap.
 *   - [KEY_INGRESS_TOKEN] = TOKEN ingress cua add-on (sua duoc o Cai dat).
 *
 * `phone_id` duoc sinh MOT lan roi giu mai: server (POST /app/register) coi do la "thiet bi goi duoc thuong tru",
 * nen doi id = thanh mot may khac trong danh ba cua man hinh P4.
 */
object Prefs {

    const val NAME = "dashboard_os"

    /** Chuoi nguoi dung da nhap (IP/domain/URL) — giu lai cho du lieu cua ban cu (GD4). */
    const val KEY_URL = "url"

    /** Trang dieu khien (https) da do duoc — WebView mo gia tri nay. */
    const val KEY_WEB_URL = "web_url"

    /** Goc API da do duoc (`http://192.168.10.2:18080`) — MOI loi goi toi duong dan app/... dung gia tri nay. */
    const val KEY_API_BASE = "api_base"

    /** Chuoi nguoi dung go o o 1 lan cuoi (dien san). */
    const val KEY_WEB_INPUT = "web_input"

    /** Chuoi nguoi dung go o o 2 lan cuoi (dien san). */
    const val KEY_API_INPUT = "api_input"

    /** TOKEN ingress Home Assistant (phan sau `/api/hassio_ingress/`). */
    const val KEY_INGRESS_TOKEN = "ingress_token"

    const val KEY_PHONE_ID = "phone_id"

    /** "Nhan cuoc goi khi app dong" (foreground service + poll). Mac dinh BAT. */
    const val KEY_RECEIVE = "receive_calls"

    fun get(ctx: Context): SharedPreferences = ctx.getSharedPreferences(NAME, Context.MODE_PRIVATE)

    /** Trang dieu khien da luu (https, co the la URL ingress cua HA). */
    fun webUrl(ctx: Context): String? =
        get(ctx).getString(KEY_WEB_URL, null)?.trim()?.takeIf { it.isNotEmpty() }

    /** Goc API da luu (`http://192.168.10.2:18080`), null = chua ket noi lan nao. */
    fun apiBase(ctx: Context): String? =
        get(ctx).getString(KEY_API_BASE, null)?.trim()?.takeIf { it.isNotEmpty() }

    /** Gia tri dien san o o 1: chuoi go lan cuoi, khong thi URL trang da luu. */
    fun webInput(ctx: Context): String? {
        val typed = get(ctx).getString(KEY_WEB_INPUT, null)?.trim()
        if (!typed.isNullOrEmpty()) return typed
        return webUrl(ctx)
    }

    /** Gia tri dien san o o 2: chuoi go lan cuoi, khong thi goc API da luu. */
    fun apiInput(ctx: Context): String? {
        val typed = get(ctx).getString(KEY_API_INPUT, null)?.trim()
        if (!typed.isNullOrEmpty()) return typed
        return apiBase(ctx)
    }

    /** (GD4) giu nguyen ten ham cu: chuoi dien san o o nhap. */
    fun lastInput(ctx: Context): String? = webInput(ctx) ?: apiBase(ctx)

    /** Luu ngay 2 chuoi nguoi dung vua go (truoc khi do) — khong dung toi webUrl/apiBase. */
    fun saveInputs(ctx: Context, webInput: String?, apiInput: String?) {
        get(ctx).edit()
            .putString(KEY_WEB_INPUT, webInput?.trim().orEmpty())
            .putString(KEY_API_INPUT, apiInput?.trim().orEmpty())
            .apply()
    }

    /** Luu ket qua: webUrl (WebView) + apiBase (API) + 2 chuoi nguoi dung go. */
    fun saveTargets(ctx: Context, webUrl: String, apiBase: String, webInput: String?, apiInput: String?) {
        get(ctx).edit()
            .putString(KEY_WEB_URL, webUrl.trim())
            .putString(KEY_API_BASE, apiBase.trim())
            .putString(KEY_WEB_INPUT, webInput?.trim().orEmpty())
            .putString(KEY_API_INPUT, apiInput?.trim().orEmpty())
            .putString(KEY_URL, webInput?.trim()?.takeIf { it.isNotEmpty() } ?: webUrl.trim())
            .apply()
    }

    /** (GD4) giu nguyen ham cu — gio chi luu 2 gia tri + chuoi go. */
    fun saveServer(ctx: Context, apiBase: String, webUrl: String, typed: String?) {
        saveTargets(ctx, webUrl, apiBase, typed, null)
    }

    fun clearServer(ctx: Context) {
        get(ctx).edit().remove(KEY_API_BASE).remove(KEY_WEB_URL).apply()
    }

    /** TOKEN ingress dang dung (mac dinh = [WebTargetResolver.DEFAULT_INGRESS_TOKEN]). */
    fun ingressToken(ctx: Context): String =
        WebTargetResolver.sanitizeToken(get(ctx).getString(KEY_INGRESS_TOKEN, null))

    /** Luu TOKEN ingress nguoi dung sua (rong = quay ve mac dinh). */
    fun setIngressToken(ctx: Context, token: String?) {
        val t = token?.trim().orEmpty()
        get(ctx).edit().putString(KEY_INGRESS_TOKEN, t).apply()
    }

    /** id cua may nay (sinh 1 lan, luu lai). */
    fun phoneId(ctx: Context): String {
        val p = get(ctx)
        val existing = p.getString(KEY_PHONE_ID, null)
        if (!existing.isNullOrBlank()) return existing
        val id = UUID.randomUUID().toString()
        p.edit().putString(KEY_PHONE_ID, id).apply()
        return id
    }

    fun receiveEnabled(ctx: Context): Boolean = get(ctx).getBoolean(KEY_RECEIVE, true)

    fun setReceiveEnabled(ctx: Context, on: Boolean) {
        get(ctx).edit().putBoolean(KEY_RECEIVE, on).apply()
    }

    /** Ten may gui len server ("samsung SM-G991B" -> danh ba P4 hien "samsung SM-G991B · Điện thoại"). */
    fun phoneName(): String {
        val m = (Build.MANUFACTURER ?: "").trim()
        val d = (Build.MODEL ?: "").trim()
        return when {
            d.isEmpty() -> "Điện thoại"
            m.isEmpty() || d.startsWith(m, ignoreCase = true) -> d
            else -> "$m $d"
        }.take(40)
    }
}

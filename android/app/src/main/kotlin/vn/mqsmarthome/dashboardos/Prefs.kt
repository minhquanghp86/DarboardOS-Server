package vn.mqsmarthome.dashboardos

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import java.util.UUID

/**
 * (10/11/2026) GD2 — SharedPreferences dung chung cho ca app (MainActivity, PhoneService, Cai dat).
 * (30/10/2026) GD4 — nguoi dung chi nhap IP/domain Home Assistant; [ServerResolver] do ra 2 dia chi va luu lai:
 *   - [KEY_API_BASE] = goc API (`http://192.168.10.2:18080`) — PhoneService / IncomingCall / CallAction dung THANG
 *     gia tri nay, khong suy ra tu URL trang nua,
 *   - [KEY_WEB_URL]  = trang dieu khien (`<apiBase>/call-web.html`) — WebView mo thang.
 * [KEY_URL] giu lai chuoi nguoi dung da go lan cuoi, chi de dien san vao o nhap.
 *
 * `phone_id` duoc sinh MOT lan roi giu mai: server (POST /app/register) coi do la "thiet bi goi duoc thuong tru",
 * nen doi id = thanh mot may khac trong danh ba cua man hinh P4.
 */
object Prefs {

    const val NAME = "dashboard_os"

    /** Chuoi nguoi dung da nhap (IP/domain/URL) — dien san o man hinh nhap. */
    const val KEY_URL = "url"

    /** Goc API da do duoc — MOI loi goi toi duong dan app/... dung gia tri nay. */
    const val KEY_API_BASE = "api_base"

    /** Trang dieu khien da do duoc (`<apiBase>/call-web.html`). */
    const val KEY_WEB_URL = "web_url"

    const val KEY_PHONE_ID = "phone_id"

    /** "Nhan cuoc goi khi app dong" (foreground service + poll). Mac dinh BAT. */
    const val KEY_RECEIVE = "receive_calls"

    fun get(ctx: Context): SharedPreferences = ctx.getSharedPreferences(NAME, Context.MODE_PRIVATE)

    /** Goc API da luu (`http://192.168.10.2:18080`), null = chua ket noi lan nao. */
    fun apiBase(ctx: Context): String? =
        get(ctx).getString(KEY_API_BASE, null)?.trim()?.takeIf { it.isNotEmpty() }

    /** Trang dieu khien da luu (`<apiBase>/call-web.html`). */
    fun webUrl(ctx: Context): String? =
        get(ctx).getString(KEY_WEB_URL, null)?.trim()?.takeIf { it.isNotEmpty() }

    /** Gia tri dien san o o nhap: apiBase da biet, khong thi chuoi cuoi nguoi dung go. */
    fun lastInput(ctx: Context): String? {
        val p = get(ctx)
        val base = p.getString(KEY_API_BASE, null)?.trim()
        if (!base.isNullOrEmpty()) return base
        val typed = p.getString(KEY_URL, null)?.trim()
        return typed?.takeIf { it.isNotEmpty() }
    }

    /** Luu ket qua do duoc: goc API + trang dieu khien + chuoi nguoi dung go. */
    fun saveServer(ctx: Context, apiBase: String, webUrl: String, typed: String?) {
        get(ctx).edit()
            .putString(KEY_API_BASE, apiBase)
            .putString(KEY_WEB_URL, webUrl)
            .putString(KEY_URL, typed?.trim()?.takeIf { it.isNotEmpty() } ?: apiBase)
            .apply()
    }

    fun clearServer(ctx: Context) {
        get(ctx).edit().remove(KEY_API_BASE).remove(KEY_WEB_URL).apply()
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

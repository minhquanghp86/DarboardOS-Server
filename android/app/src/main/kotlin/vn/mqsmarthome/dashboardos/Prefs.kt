package vn.mqsmarthome.dashboardos

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import java.util.UUID

/**
 * (10/11/2026) GD2 — SharedPreferences dung chung cho ca app (MainActivity, PhoneService, Cai dat).
 *
 * `phone_id` duoc sinh MOT lan roi giu mai: server (POST /app/register) coi do la "thiet bi goi duoc thuong tru",
 * nen doi id = thanh mot may khac trong danh ba cua man hinh P4.
 */
object Prefs {

    const val NAME = "dashboard_os"

    /** Dia chi Dashboard nguoi dung nhap (cung khoa voi phien ban GD1). */
    const val KEY_URL = "url"
    const val KEY_PHONE_ID = "phone_id"

    /** "Nhan cuoc goi khi app dong" (foreground service + poll). Mac dinh BAT. */
    const val KEY_RECEIVE = "receive_calls"

    const val DEFAULT_URL =
        "https://hass.mqsmarthome.io.vn/b39feb53_remote_webview_server/call-web.html"

    fun get(ctx: Context): SharedPreferences = ctx.getSharedPreferences(NAME, Context.MODE_PRIVATE)

    fun url(ctx: Context): String? = get(ctx).getString(KEY_URL, null)?.takeIf { it.isNotBlank() }

    fun setUrl(ctx: Context, url: String) {
        get(ctx).edit().putString(KEY_URL, url).apply()
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

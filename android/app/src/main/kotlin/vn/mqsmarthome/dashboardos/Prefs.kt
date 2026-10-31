package vn.mqsmarthome.dashboardos

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.provider.Settings
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

    /**
     * (14/11/2026) GD7 — `true` = trang dieu khien ([KEY_WEB_URL]) tra 401/403 o lan do gan nhat, tuc la
     * WebView CHUA co cookie phien Home Assistant: lan mo app / bam "Ket noi" ke tiep phai mo ORIGIN cua HA
     * (`https://<domain>/`) de dang nhap TRUOC, khong mo thang webUrl (mo thang chi hien "401: Unauthorized").
     */
    const val KEY_NEED_HA_LOGIN = "need_ha_login"

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

    /**
     * (17/11/2026) GD9 — GIAO DIEN CHI CON **MOT O** dia chi. Gia tri dien san lay theo thu tu:
     * chuoi nguoi dung go lan cuoi -> webUrl da do duoc -> (du lieu 2 o cua ban cu) o API -> apiBase.
     * Nho vay nguoi da cau hinh 2 o truoc day van thay dung dia chi cu, va app tu suy ra phan con lai
     * (WebTargetResolver.webCandidates / apiBasesForInput).
     */
    fun oneInput(ctx: Context): String? = webInput(ctx) ?: apiInput(ctx) ?: apiBase(ctx)

    /**
     * (18/11/2026) GD10 — đổi riêng **trang điều khiển** (`webUrl`) sau khi một BIẾN THỂ URL chạy được
     * ([HaLogin.dashboardVariants]): lần mở app sau vào thẳng đúng biến thể đó, không dò/vòng qua Lovelace nữa.
     * Giữ nguyên `apiBase` và chuỗi người dùng đã gõ.
     */
    fun setWebUrl(ctx: Context, url: String?) {
        val v = url?.trim().orEmpty()
        if (v.isEmpty()) return
        get(ctx).edit().putString(KEY_WEB_URL, v).apply()
    }

    /** (17/11/2026) GD9 — doi rieng goc API (PhoneService tu chuyen khi TOKEN ingress doi / thu duong dan khac). */
    fun setApiBase(ctx: Context, base: String?) {
        val v = base?.trim().orEmpty()
        if (v.isEmpty()) return
        get(ctx).edit().putString(KEY_API_BASE, v).apply()
    }

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
        get(ctx).edit().remove(KEY_API_BASE).remove(KEY_WEB_URL).remove(KEY_NEED_HA_LOGIN).apply()
    }

    /**
     * (14/11/2026) GD7 — lan do gan nhat co phai "can dang nhap Home Assistant" (401/403) khong.
     * Mac dinh `false`: giu nguyen hanh vi cu (mo thang webUrl) voi du lieu cua ban cu.
     */
    fun needHaLogin(ctx: Context): Boolean = get(ctx).getBoolean(KEY_NEED_HA_LOGIN, false)

    /** Dat co "can dang nhap HA": `true` sau khi do thay 401, `false` khi da chuyen duoc sang webUrl. */
    fun setNeedHaLogin(ctx: Context, on: Boolean) {
        get(ctx).edit().putBoolean(KEY_NEED_HA_LOGIN, on).apply()
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

    /**
     * (GD8) Server da GOP ban ghi trung `deviceKey` va tra ve `id` CHUAN -> ghi de id dang luu, de lan poll sau
     * (incoming/answer/decline) dung dung id ma server biet. Bo qua khi id rong hoac khong doi.
     */
    fun setPhoneId(ctx: Context, id: String) {
        val v = id.trim()
        if (v.isEmpty() || v == get(ctx).getString(KEY_PHONE_ID, null)) return
        get(ctx).edit().putString(KEY_PHONE_ID, v).apply()
    }

    /**
     * (GD8) Khoa nhan dang ON DINH cua may: `Settings.Secure.ANDROID_ID` — khong doi khi CAI LAI APP / XOA DU LIEU
     * APP tren cung mot may, nho vay server gop cac ban ghi trung (moi lan cai lai truoc day sinh id moi).
     * May khong tra ANDROID_ID (null/rong) -> dung id hien tai trong Prefs.
     */
    fun deviceKey(ctx: Context): String {
        val androidId = try {
            Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ANDROID_ID)
        } catch (t: Throwable) {
            null
        }
        return PhoneApi.deviceKeyOf(androidId, phoneId(ctx))
    }

    /** (GD8) Build.MODEL gui kem /app/register (server hien trong /app/list). */
    fun phoneModel(): String = (Build.MODEL ?: "").trim().take(40)

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

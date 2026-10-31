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

    /**
     * ĐÍCH của WebView (https) — WebView mở giá trị này.
     *
     * (26/11/2026) GD14 — giá trị ĐÚNG là **panel của add-on trên Home Assistant**
     * (`https://<domain>/b39feb53_remote_webview_server`): chính HA frontend dựng panel, tạo phiên ingress rồi nhúng
     * add-on. Giá trị cũ (`…/api/hassio_ingress/<TOKEN>/launcher-config.html`) vẫn được chấp nhận để nâng cấp.
     */
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

    /**
     * (19/11/2026) GD11 — ORIGIN cua Home Assistant dùng cho việc ĐĂNG NHẬP (`https://<domain>/`), TÁCH HẲN khỏi
     * [KEY_WEB_URL]. Nhờ vậy luồng đăng nhập không bao giờ ghi đè trang điều khiển: `webUrl` chỉ được ghi từ kết
     * quả dò ingress ([DashboardTarget.isValidSaved]), còn `loginUrl` chỉ là chỗ mở form đăng nhập.
     */
    const val KEY_LOGIN_URL = "login_url"

    const val KEY_PHONE_ID = "phone_id"

    // ─────────────────────────────────────────── (1.7) VỊ TRÍ BONG BÓNG “KẾT NỐI”

    /**
     * (1.7) Toạ độ **TỈ LỆ 0..1** của bong bóng nổi trong khung WebView (`webHost`): `bubble_x` theo trục ngang,
     * `bubble_y` theo trục dọc. Lưu tỉ lệ (không lưu px) để **xoay máy / đổi độ phân giải** vẫn đúng chỗ — bong bóng
     * đang ở góc phải trên thì xoay ngang vẫn ở góc phải trên (xem [BubbleDrag.ratioOf] / [BubbleDrag.fromRatio]).
     * Chưa có khoá nào ⇒ góc phải trên, cách mép 12dp, dưới status bar ([BubbleDrag.defaultPos]).
     */
    const val KEY_BUBBLE_X = "bubble_x"

    /** Xem [KEY_BUBBLE_X]. */
    const val KEY_BUBBLE_Y = "bubble_y"

    /** "Nhan cuoc goi khi app dong" (foreground service + poll). Mac dinh BAT. */
    const val KEY_RECEIVE = "receive_calls"

    /**
     * (1.6) Cờ **“đã xem hướng dẫn”** — khoá DUY NHẤT được **GIỮ LẠI** khi đăng xuất ([clearForLogout]): người dùng
     * đã biết cách dùng app rồi thì đăng xuất không phải xem lại hướng dẫn.
     */
    const val KEY_SAW_GUIDE = "saw_guide"

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
     * (19/11/2026) GD11 — đổi riêng **trang điều khiển** (`webUrl`) sau khi một BIẾN THỂ URL chạy được
     * ([HaLogin.dashboardVariants]): lần mở app sau vào thẳng đúng biến thể đó, không dò/vòng qua Lovelace nữa.
     * Giữ nguyên `apiBase` và chuỗi người dùng đã gõ.
     *
     * `webUrl` CHỈ nhận **đích hợp lệ** ([DashboardTarget.isValidSaved]): panel của add-on trên HA
     * (`https://<domain>/b39feb53_remote_webview_server` — (26/11/2026) GD14) hoặc trang điều khiển cũ
     * (`…/launcher-config.html`). Origin của HA (`https://<domain>/`) và URL đăng nhập (`/auth/…`, `/lovelace`) bị
     * **từ chối** — đó chính là giá trị khiến app "refresh rồi lại vào Lovelace" (xem KDoc đầu [DashboardTarget]).
     * Dùng [setLoginUrl] cho origin.
     */
    fun setWebUrl(ctx: Context, url: String?) {
        val v = url?.trim().orEmpty()
        if (v.isEmpty()) return
        if (!DashboardTarget.isValidSaved(v)) return
        get(ctx).edit().putString(KEY_WEB_URL, v).apply()
    }

    /**
     * (19/11/2026) GD11 — lưu ORIGIN của Home Assistant (`https://<domain>/`) để mở form đăng nhập ở lần sau.
     * Tách khỏi [KEY_WEB_URL] nên luồng đăng nhập KHÔNG BAO GIỜ đụng tới trang điều khiển.
     */
    fun loginUrl(ctx: Context): String? =
        get(ctx).getString(KEY_LOGIN_URL, null)?.trim()?.takeIf { it.isNotEmpty() }

    /** Ghi origin đăng nhập của HA (`https://<domain>/`). Rỗng = không ghi. */
    fun setLoginUrl(ctx: Context, url: String?) {
        val v = url?.trim().orEmpty()
        if (v.isEmpty()) return
        get(ctx).edit().putString(KEY_LOGIN_URL, v).apply()
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

    /**
     * Luu ket qua: webUrl (WebView) + apiBase (API) + 2 chuoi nguoi dung go.
     *
     * (19/11/2026) GD11 / (26/11/2026) GD14 — `webUrl` chi duoc ghi khi la **dich hop le** cua app
     * ([DashboardTarget.isValidSaved]: panel cua add-on tren HA, hoac trang dieu khien cu); origin cua HA / URL dang
     * nhap bi bo qua (giu gia tri cu), nho vay "mo dashboard" khong bao gio nap lai origin (Lovelace).
     */
    fun saveTargets(ctx: Context, webUrl: String, apiBase: String, webInput: String?, apiInput: String?) {
        val web = webUrl.trim().takeIf { DashboardTarget.isValidSaved(it) }
        val e = get(ctx).edit()
            .putString(KEY_API_BASE, apiBase.trim())
            .putString(KEY_WEB_INPUT, webInput?.trim().orEmpty())
            .putString(KEY_API_INPUT, apiInput?.trim().orEmpty())
            .putString(KEY_URL, webInput?.trim()?.takeIf { it.isNotEmpty() } ?: webUrl.trim())
        if (web != null) e.putString(KEY_WEB_URL, web)
        e.apply()
    }

    /** (GD4) giu nguyen ham cu — gio chi luu 2 gia tri + chuoi go. */
    fun saveServer(ctx: Context, apiBase: String, webUrl: String, typed: String?) {
        saveTargets(ctx, webUrl, apiBase, typed, null)
    }

    fun clearServer(ctx: Context) {
        get(ctx).edit()
            .remove(KEY_API_BASE)
            .remove(KEY_WEB_URL)
            .remove(KEY_NEED_HA_LOGIN)
            .remove(KEY_LOGIN_URL)
            .apply()
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

    // ─────────────────────────────────────────── (1.7) BONG BÓNG “KẾT NỐI” — NHỚ VỊ TRÍ

    /**
     * (1.7) Vị trí bong bóng **đã lưu** dưới dạng tỉ lệ 0..1 ([KEY_BUBBLE_X] / [KEY_BUBBLE_Y]), `null` = chưa có
     * (hoặc dữ liệu hỏng) ⇒ [MainActivity] dùng vị trí mặc định góc phải trên ([BubbleDrag.defaultPos]).
     *
     * Giá trị ngoài [0, 1] / `NaN` bị coi là **chưa có** (không bao giờ đặt bong bóng ra ngoài màn hình).
     */
    fun bubblePos(ctx: Context): BubbleDrag.Pos? {
        val p = get(ctx)
        if (!p.contains(KEY_BUBBLE_X) || !p.contains(KEY_BUBBLE_Y)) return null
        val x = p.getFloat(KEY_BUBBLE_X, Float.NaN)
        val y = p.getFloat(KEY_BUBBLE_Y, Float.NaN)
        if (!x.isFinite() || !y.isFinite()) return null
        if (x < 0f || x > 1f || y < 0f || y > 1f) return null
        return BubbleDrag.Pos(x, y)
    }

    /** (1.7) Lưu vị trí bong bóng sau một lần KÉO (tỉ lệ 0..1, đã kẹp lại trước khi ghi). */
    fun setBubblePos(ctx: Context, pos: BubbleDrag.Pos) {
        if (!pos.x.isFinite() || !pos.y.isFinite()) return
        get(ctx).edit()
            .putFloat(KEY_BUBBLE_X, pos.x.coerceIn(0f, 1f))
            .putFloat(KEY_BUBBLE_Y, pos.y.coerceIn(0f, 1f))
            .apply()
    }

    // ─────────────────────────────────────────── (1.6) ĐĂNG XUẤT

    /** Đã xem hướng dẫn chưa (cờ này được GIỮ LẠI khi đăng xuất). */
    fun sawGuide(ctx: Context): Boolean = get(ctx).getBoolean(KEY_SAW_GUIDE, false)

    fun setSawGuide(ctx: Context, on: Boolean) {
        get(ctx).edit().putBoolean(KEY_SAW_GUIDE, on).apply()
    }

    /**
     * (1.6) **ĐĂNG XUẤT: xoá TOÀN BỘ dữ liệu của app**, chỉ giữ [KEY_SAW_GUIDE] ([Logout.KEEP_KEYS]).
     *
     * Xoá bằng cách liệt kê các khoá ĐANG CÓ ([android.content.SharedPreferences.getAll]) rồi `remove` từng khoá:
     * nhờ vậy cả những khoá của bản cũ (`url`, `web_input`, `api_input`, …) cũng bị dọn, không chỉ danh sách cứng.
     * Dùng `commit()` (không phải `apply()`) để dữ liệu xuống đĩa NGAY — sau bước này người dùng có thể tắt app.
     *
     * @return số khoá đã xoá (0 = không có gì để xoá) — dùng cho log `[logout] step=clear_prefs ok=yes keys=<n>`.
     */
    fun clearForLogout(ctx: Context): Int {
        val p = get(ctx)
        val drop = Logout.keysToRemove(p.all.keys)
        if (drop.isEmpty()) return 0
        val editor = p.edit()
        for (key in drop) editor.remove(key)
        editor.commit()
        return drop.size
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

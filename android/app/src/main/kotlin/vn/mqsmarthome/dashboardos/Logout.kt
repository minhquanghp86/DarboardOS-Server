package vn.mqsmarthome.dashboardos

/**
 * (1.6) **ĐĂNG XUẤT — PHẦN THUẦN** (quyết định *làm gì*, *theo thứ tự nào*, *xoá những gì*).
 *
 * Yêu cầu nghiệp vụ: nút **“Đăng xuất”** (chỉ hiện khi đã có phiên/cấu hình) → hộp thoại xác nhận → khi đồng ý thì
 * làm sạch **toàn bộ** trạng thái để lần sau có thể đăng nhập một **tài khoản Home Assistant khác**:
 *
 *  1. `POST <apiBase>/app/remove` với `{id: phoneId}` — huỷ đăng ký thiết bị khỏi máy chủ. Lỗi mạng / 401 / 404 thì
 *     **bỏ qua nhưng vẫn đi tiếp** (máy phải sạch dù server không trả lời). Bước này chạy **TRƯỚC** khi xoá cookie
 *     vì ingress của HA cần cookie `ingress_session` cho chính lời gọi này;
 *  2. dừng [PhoneService] và huỷ thông báo cuộc gọi đang có ([CallNotifications]);
 *  3. xoá **toàn bộ cookie** của domain (`CookieManager.removeAllCookies` + `flush`);
 *  4. xoá dữ liệu WebView (`WebStorage.deleteAllData` = localStorage `hassTokens` của HA, `clearCache(true)`,
 *     `clearFormData`, `clearHistory`);
 *  5. xoá Prefs của app (`webUrl`, `apiBase`, `loginUrl`, `phoneId`, `token`, `needLogin`…) — **trừ** cờ
 *     “đã xem hướng dẫn” ([KEEP_KEYS]);
 *  6. đưa UI về trạng thái ban đầu.
 *
 * Vì sao tách riêng: [plan]/[keysToRemove]/[reason]/[line] là **hàm thuần** (không chạm API Android) nên unit test
 * được trên JVM — xem `LogoutTest`. Phần gọi Android (`CookieManager`, `WebStorage`, `PhoneService`…) nằm ở
 * `MainActivity.performLogout` / `MainActivity.finishLogout`.
 *
 * Log: mỗi bước một dòng `[logout] step=… ok=…` vào [Diag] (và Logcat, tag `DashboardOS-login`). Tiền tố `[logout]`
 * **không** kích hoạt tự lưu tệp chẩn đoán ([DiagFile.shouldAutoSave] loại trừ tường minh); lý do lỗi cũng được ghi
 * bằng chữ (`net` / `denied` / `not_found`) để không có chuỗi `401` nào lọt vào log.
 */
object Logout {

    /** Tiền tố log chẩn đoán của luồng đăng xuất (cùng tag Logcat với `[nav]`/`[login]`/`[promote]`/`[ui]`). */
    const val LOG_PREFIX = "[logout]"

    /** `reason=` khi không gọi được máy chủ (mất mạng / sai địa chỉ / timeout). */
    const val REASON_NET = "net"

    /** `reason=` khi server trả 2xx (đã xoá thiết bị). */
    const val REASON_OK = "ok"

    /** `reason=` khi server trả 401/403 (thiếu phiên ingress — vẫn đi tiếp). */
    const val REASON_DENIED = "denied"

    /** `reason=` khi server trả 404 (thiết bị không còn trên server — coi như đã xoá). */
    const val REASON_NOT_FOUND = "not_found"

    /** `reason=` khi server trả mã khác. */
    const val REASON_ERROR = "error"

    /** `reason=` khi bỏ qua bước gọi server (chưa cấu hình `apiBase`). */
    const val REASON_SKIPPED = "skipped"

    /**
     * Các bước của một lần đăng xuất, ĐÚNG thứ tự thực hiện ([ORDER]).
     *
     * [wire] là chuỗi ghi log — chỉ chữ thường + `_`, **không** chứa chữ số (để `DiagFile.shouldAutoSave` không tự
     * lưu tệp chẩn đoán vì một dòng log đăng xuất).
     */
    enum class Step(val wire: String) {
        /** (1) `POST <apiBase>/app/remove` — huỷ đăng ký thiết bị khỏi máy chủ. */
        REMOVE_DEVICE("remove_device"),

        /** (2a) `PhoneService.stop` — không hỏi `/app/incoming` nữa. */
        STOP_SERVICE("stop_service"),

        /** (2b) Huỷ thông báo cuộc gọi + đóng màn gọi đang mở nếu có. */
        CANCEL_CALL_NOTIFICATION("cancel_call_notification"),

        /** (3) Xoá toàn bộ cookie của domain (để đăng nhập tài khoản khác). */
        CLEAR_COOKIES("clear_cookies"),

        /** (4) Xoá dữ liệu WebView (localStorage của HA, cache, form data, history). */
        CLEAR_WEBVIEW_DATA("clear_webview_data"),

        /** (5) Xoá Prefs của app, giữ [KEEP_KEYS]. */
        CLEAR_PREFS("clear_prefs"),

        /** (6) Đưa UI về trạng thái ban đầu (màn nhập địa chỉ trống). */
        RESET_UI("reset_ui"),
    }

    /** Thứ tự THỰC HIỆN cố định — đúng 6 nhóm yêu cầu (bước 2 tách đôi để log rõ). */
    val ORDER: List<Step> = listOf(
        Step.REMOVE_DEVICE,
        Step.STOP_SERVICE,
        Step.CANCEL_CALL_NOTIFICATION,
        Step.CLEAR_COOKIES,
        Step.CLEAR_WEBVIEW_DATA,
        Step.CLEAR_PREFS,
        Step.RESET_UI,
    )

    /**
     * Khoá Prefs **GIỮ LẠI** khi đăng xuất: chỉ cờ “đã xem hướng dẫn” ([Prefs.KEY_SAW_GUIDE]) — mọi khoá khác
     * (`web_url`, `api_base`, `login_url`, `phone_id`, `ingress_token`, `need_ha_login`, `web_input`…) bị xoá.
     */
    val KEEP_KEYS: Set<String> = setOf(Prefs.KEY_SAW_GUIDE)

    /**
     * Dữ liệu đầu vào để quyết định **bước nào chạy**: địa chỉ API đã cấu hình và id thiết bị đang giữ.
     */
    data class State(val apiBase: String?, val phoneId: String?) {
        /** Có gốc API để gọi `/app/remove` không (chưa cấu hình ⇒ bỏ bước 1, vẫn xoá sạch máy). */
        val hasApiBase: Boolean get() = !apiBase.isNullOrBlank()

        /** Có id thiết bị để gửi lên server không. */
        val hasPhoneId: Boolean get() = !phoneId.isNullOrBlank()

        /** Thân request `{id: …}` hợp lệ ⇔ có cả `apiBase` và `phoneId`. */
        val canRemoveDevice: Boolean get() = hasApiBase && hasPhoneId
    }

    /**
     * Danh sách bước sẽ chạy, ĐÚNG thứ tự [ORDER]:
     *  - luôn có 6 bước còn lại (kể cả khi chưa cấu hình gì — máy vẫn phải sạch cookie/WebView/Prefs);
     *  - [Step.REMOVE_DEVICE] **chỉ** có khi đã cấu hình `apiBase` (không có địa chỉ thì không có gì để gọi).
     */
    fun plan(state: State): List<Step> = ORDER.filter { step ->
        step != Step.REMOVE_DEVICE || state.hasApiBase
    }

    /** Đăng xuất có gọi `/app/remove` không (đúng điều kiện của [Step.REMOVE_DEVICE]). */
    fun callsServer(state: State): Boolean = Step.REMOVE_DEVICE in plan(state) && state.hasPhoneId

    /**
     * Khoá Prefs **PHẢI XOÁ**: mọi khoá đang có trừ [KEEP_KEYS]. Sắp xếp + loại trùng để log/kết quả tất định
     * (unit test so sánh được).
     */
    fun keysToRemove(existing: Collection<String>?): List<String> =
        existing.orEmpty()
            .filterNot { keep(it) }
            .distinct()
            .sorted()

    /** Khoá Prefs này có được GIỮ LẠI khi đăng xuất không (hiện chỉ cờ “đã xem hướng dẫn”). */
    fun keep(key: String?): Boolean = !key.isNullOrBlank() && KEEP_KEYS.contains(key)

    /**
     * Nút **“Đăng xuất”** có hiện trên trang đầu không: chỉ hiện khi **đã có phiên/cấu hình**
     * (`hasConfig` = đã lưu webUrl/apiBase/loginUrl, `hasSession` = đã có cookie Home Assistant).
     * Máy mới (chưa cấu hình gì) ⇒ ẩn nút.
     */
    fun showChip(hasConfig: Boolean, hasSession: Boolean): Boolean = hasConfig || hasSession

    /** Mã HTTP của `/app/remove` → lý do ghi log (bằng chữ, **không** chứa `401` để không kích hoạt tự lưu tệp). */
    fun reason(code: Int?): String = when {
        code == null -> REASON_NET
        code in 200..299 -> REASON_OK
        code == 401 || code == 403 -> REASON_DENIED
        code == 404 -> REASON_NOT_FOUND
        else -> REASON_ERROR
    }

    /** `/app/remove` trả mã này là coi như **đã huỷ đăng ký** (2xx, hoặc 404 = server không còn thiết bị). */
    fun removed(code: Int?): Boolean = code != null && (code in 200..299 || code == 404)

    /**
     * Dòng log chẩn đoán của MỘT bước — đúng định dạng yêu cầu `[logout] step=… ok=…`:
     *
     *     [logout] step=remove_device ok=yes reason=ok
     *     [logout] step=stop_service ok=yes
     *     [logout] step=clear_prefs ok=yes keys=9
     *
     * [extra] là phần thêm tuỳ chọn (đã có dạng `khoá=giá_trị`).
     */
    fun line(step: Step, ok: Boolean, extra: String? = null): String {
        val sb = StringBuilder(LOG_PREFIX)
            .append(" step=").append(step.wire)
            .append(" ok=").append(if (ok) "yes" else "no")
        val e = extra?.trim().orEmpty()
        if (e.isNotEmpty()) sb.append(' ').append(e)
        return sb.toString()
    }

    /** `reason=` của bước gọi server (`null` mã = không gọi được ⇒ `net`). */
    fun reasonExtra(code: Int?): String = "reason=" + reason(code)
}

package vn.mqsmarthome.dashboardos

/**
 * (1.5) **CHÍNH SÁCH HIỆN/ẨN THANH THÔNG BÁO ĐĂNG NHẬP** (`@id/haLoginBar`).
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────────────
 * LỖI NGƯỜI DÙNG BÁO (nhấp nháy): "ở các lần mở app SAU (đã đăng nhập, có phiên ingress), khi app khởi động vẫn
 * hiện thanh thông báo trên cùng với 2 nút trong 1–2 giây rồi mới tự ẩn. Chức năng đúng, chỉ là nhấp nháy."
 *
 * NGUYÊN NHÂN (đọc code, bản 1.4): thanh này bị bật bởi **bất kỳ** chỗ nào gọi `showLoginBar(true)` — kể cả những
 * chỗ **không hề cần đăng nhập**:
 *  - `openDashboardNow()` (đường TỰ ĐỘNG mở dashboard, chạy mỗi lần mở app khi đã có phiên) gọi
 *    `showLoginBar(true)` vô điều kiện ⇒ panel vừa nạp xong là thanh hiện ra, rồi `onPromoteLoaded` ẩn đi
 *    (`ok=top`) ⇒ **đúng 1–2 giây nhấp nháy**, và WebView bị **đẩy xuống rồi kéo lên** (thanh nằm trong luồng
 *    layout);
 *  - `onPromoteFailed` (quay lại panel), `onWrongPage`, `onAuthRequired`, nhịp dò `loginTick`… cũng bật thanh dù
 *    trạng thái chỉ là "đang kiểm tra / đang tự phục hồi".
 *
 * CÁCH SỬA (1.5) — **một cửa duy nhất** [decide] cho mọi lần đổi visibility:
 *  1. mặc định `GONE` ngay từ khung hình đầu (`activity_web.xml` + `MainActivity.buildWebScreen`);
 *  2. chỉ **HIỆN** khi lý do thuộc nhóm *cần thật* ([Reason.needed]): 401/403 trên ingress ([Reason.AUTH_HTTP]),
 *     URL `/auth/…` ([Reason.AUTH_URL]), `startLoginFlow()` mở trang đăng nhập ([Reason.LOGIN_FLOW]), trang sai
 *     ([Reason.WRONG_PAGE]), hết cách ([Reason.GIVE_UP]), và các thao tác **người dùng chủ động**
 *     ([Reason.USER_RETRY] / [Reason.USER_LOGIN_DONE] / [Reason.USER_LOGIN_AGAIN]);
 *  3. **KHÔNG** hiện vì "chưa biết trạng thái": đang dựng màn WebView ([Reason.STARTUP]), đang kiểm tra phiên
 *     ([Reason.SESSION_CHECK]), panel đang nạp ([Reason.PANEL_WAIT]), đường tự động mở dashboard
 *     ([Reason.OPEN_DASHBOARD]);
 *  4. **có phiên** (`session=yes`) ⇒ **KHÔNG BAO GIỜ** hiện (kể cả khung hình đầu, kể cả khi vừa gặp `/auth/…`) —
 *     đúng yêu cầu 3, nhờ vậy layout không bị giật;
 *  5. **thời gian ÂN HẠN** ([SETTLE_MS]) sau khi mở app: nếu lần mở app này **đã có phiên** thì lý do *cần thật*
 *     cũng bị hoãn (đang tự phục hồi: panel/promote chỉ mất 1–2 s) — hết ân hạn mà vẫn cần thì thanh mới hiện
 *     (`MainActivity.recheckLoginBarAfterSettle`, xem [settleRemainingMs]).
 *
 * Mọi thay đổi đều ghi **một** dòng chẩn đoán (chỉ khi trạng thái ĐỔI, không spam ring buffer 300 dòng):
 *
 *     [ui] bar=hide reason=startup session=yes
 *     [ui] bar=hide reason=open_dashboard why=not_needed session=yes
 *     [ui] bar=show reason=auth_url session=no
 *
 * Tiền tố `[ui]` **không** chứa `401`/`fail=` nên KHÔNG kích hoạt [DiagFile.shouldAutoSave] (không tự lưu tệp
 * chẩn đoán) — đúng yêu cầu 4. Lý do `401/403` vì thế được ghi là `auth_http`.
 *
 * Tệp này THUẦN (không API Android) nên unit test được trên JVM — xem `LoginBarTest`.
 */
object LoginBar {

    /** Tiền tố log chẩn đoán (cùng tag Logcat `DashboardOS-login` với `[nav]`/`[login]`/`[promote]`/`[auto]`). */
    const val LOG_PREFIX = "[ui]"

    /**
     * Thời gian **ÂN HẠN** (ms) sau khi dựng màn WebView: nếu lần mở app này đã có phiên ingress thì trong khoảng
     * này KHÔNG hiện thanh (panel/promote đang tự phục hồi — đúng 1–2 s nhấp nháy mà người dùng báo). Hết ân hạn
     * mà vẫn cần đăng nhập thật thì thanh mới hiện.
     */
    const val SETTLE_MS = 2500L

    /** `why=` khi lý do là loại "chưa biết trạng thái" (không được hiện thanh). */
    const val WHY_NOT_NEEDED = "not_needed"

    /** `why=` khi đã có phiên (`session=yes`) ⇒ không bao giờ hiện (yêu cầu 3). */
    const val WHY_SESSION = "session"

    /** `why=` khi còn trong thời gian ân hạn ([SETTLE_MS]) — sẽ xét lại sau khi hết ân hạn. */
    const val WHY_SETTLING = "settling"

    /**
     * LÝ DO đổi trạng thái thanh thông báo. [needed] = `true` ⇔ lý do này **thật sự cần** người dùng thấy thanh
     * (chỉ nhóm này mới có thể bật thanh lên; luôn bị [decide] lọc thêm bởi `session`/ân hạn).
     *
     * [wire] là chuỗi ghi vào log — **không** chứa chữ số `401/403` để `DiagFile.shouldAutoSave` không tự lưu tệp.
     */
    enum class Reason(val wire: String, val needed: Boolean) {
        // ── ẩn / "chưa biết trạng thái": KHÔNG được bật thanh (yêu cầu 1 + 2)
        /** Đang dựng màn WebView (mặc định `GONE` từ khung hình đầu). */
        STARTUP("startup", false),

        /** Nút "Kết nối" vừa lưu cấu hình mới — chưa có gì cần đăng nhập. */
        CONNECT("connect", false),

        /** Chỉ đang kiểm tra phiên (`session=no` **không** phải là "cần đăng nhập"). */
        SESSION_CHECK("session_check", false),

        /** Panel của add-on đang nạp — chờ `onPageFinished` kết luận. */
        PANEL_WAIT("panel_wait", false),

        /** Đường TỰ ĐỘNG mở dashboard (nút "Mở Dashboard" / `[auto] openDashboard`) — **nguyên nhân nhấp nháy 1.4**. */
        OPEN_DASHBOARD("open_dashboard", false),

        // ── cần thật: có thể bật thanh (vẫn bị lọc bởi `session` + thời gian ân hạn)
        /** 401/403 trên ingress — thiếu phiên `ingress_session` (yêu cầu 2). */
        AUTH_HTTP("auth_http", true),

        /** URL đang là trang đăng nhập của HA (`/auth/…`) (yêu cầu 2). */
        AUTH_URL("auth_url", true),

        /** `startLoginFlow(openOrigin = true)` — chủ động mở trang đăng nhập HA (yêu cầu 2). */
        LOGIN_FLOW("login_flow", true),

        /** Trang vừa nạp không phải add-on (SPA HA / sai đường dẫn) — cần người dùng biết. */
        WRONG_PAGE("wrong_page", true),

        /** Hết cách (hết biến thể / hết lượt promote / panel không dùng được) — cần lối thoát "Thử lại". */
        GIVE_UP("give_up", true),

        /** Người dùng bấm "Thử lại". */
        USER_RETRY("user_retry", true),

        /** Người dùng bấm "Tôi đã đăng nhập" (ẩn NGAY khi đã có phiên — yêu cầu 5). */
        USER_LOGIN_DONE("user_login_done", true),

        /** Người dùng bấm "Đăng nhập lại Home Assistant" trên trang lỗi. */
        USER_LOGIN_AGAIN("user_login_again", true),

        // ── ẩn có chủ đích (thành công / không áp dụng)
        /** Nhịp dò vừa thấy **đã có phiên** (`session=yes`) ⇒ đăng nhập xong: ẩn NGAY (yêu cầu 5). */
        SESSION_READY("session_ready", false),

        /** Panel của add-on đã nạp xong. */
        PANEL_OK("panel_ok", false),

        /** Top-level ingress đã dùng được (`ok=top`). */
        TOP_OK("top_ok", false),

        /** Dự phòng cuối `…/launcher-config.html` dùng được. */
        ROOT_OK("root_ok", false),

        /** Chế độ IP LAN: không có phiên HA nào để đăng nhập. */
        LAN_NO_LOGIN("lan_no_login", false),
    }

    /**
     * Kết quả một lần xét: [visible] = thanh có được **HIỆN** không; [reason] = [Reason.wire]; [why] = lý do bị
     * chặn (`not_needed` / `session` / `settling`) hoặc `null` khi đúng như yêu cầu.
     */
    data class Decision(val visible: Boolean, val reason: String, val why: String?) {
        /** `true` ⇔ bị chặn vì **còn trong thời gian ân hạn** ⇒ cần xét lại sau [settleRemainingMs]. */
        val settling: Boolean get() = why == WHY_SETTLING
    }

    /**
     * QUYẾT ĐỊNH DUY NHẤT của thanh thông báo (thuần, không tác dụng phụ):
     *
     *  1. `show = false` ⇒ ẩn;
     *  2. lý do **không cần** ([Reason.needed] = `false`) ⇒ ẩn, `why=not_needed` — đây là chỗ giết hiệu ứng nhấp
     *     nháy: "chưa biết trạng thái" **không** phải là "cần đăng nhập";
     *  3. **đã có phiên** ⇒ ẩn, `why=session` (yêu cầu 3 — kể cả khung hình đầu);
     *  4. còn **ân hạn** ([SETTLE_MS]) sau khi mở app mà lúc mở **đã có phiên** ⇒ ẩn, `why=settling`;
     *  5. còn lại ⇒ **hiện**.
     */
    fun decide(show: Boolean, reason: Reason, hasSession: Boolean, settling: Boolean): Decision {
        if (!show) return Decision(false, reason.wire, null)
        if (!reason.needed) return Decision(false, reason.wire, WHY_NOT_NEEDED)
        if (hasSession) return Decision(false, reason.wire, WHY_SESSION)
        if (settling) return Decision(false, reason.wire, WHY_SETTLING)
        return Decision(true, reason.wire, null)
    }

    /**
     * Dòng chẩn đoán (yêu cầu 4) — **ĐÚNG** định dạng `[ui] bar=show|hide reason=…`, thêm `why=` khi bị chặn và
     * `session=yes|no`:
     *
     *     [ui] bar=show reason=auth_url session=no
     *     [ui] bar=hide reason=auth_url why=session session=yes
     *     [ui] bar=hide reason=panel_ok session=yes
     */
    fun line(decision: Decision, hasSession: Boolean): String {
        val sb = StringBuilder(LOG_PREFIX)
            .append(" bar=").append(if (decision.visible) "show" else "hide")
            .append(" reason=").append(decision.reason.trim().ifEmpty { "-" })
        val why = decision.why?.trim().orEmpty()
        if (why.isNotEmpty()) sb.append(" why=").append(why)
        return sb.append(" session=").append(yn(hasSession)).toString()
    }

    /**
     * Còn bao nhiêu ms nữa thì hết ân hạn ([SETTLE_MS]) kể từ lúc dựng màn WebView — dùng cho
     * `Handler.postDelayed` để **xét lại** thanh sau khi hết ân hạn (0 = đã hết).
     */
    fun settleRemainingMs(elapsedMs: Long): Long =
        (SETTLE_MS - elapsedMs.coerceAtLeast(0L)).coerceAtLeast(0L)

    /** Đang trong thời gian ân hạn chưa (chỉ áp dụng khi lần mở app này **đã có phiên**). */
    fun settling(launchHadSession: Boolean, elapsedMs: Long): Boolean =
        launchHadSession && elapsedMs < SETTLE_MS

    private fun yn(value: Boolean): String = if (value) "yes" else "no"
}

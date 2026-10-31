package vn.mqsmarthome.dashboardos

/**
 * (30/11/2026) GD18 — **TỰ ĐỘNG MỞ DASHBOARD** (v1.4): SỰ THẬT đã kiểm chứng trên máy thật với bản 1.2 —
 *
 *  - đăng nhập HA xong app **vẫn không tự chuyển**;
 *  - người dùng **phải bấm nút "Mở Dashboard"** thì mới vào được add-on.
 *
 * ⇒ Nút "Mở Dashboard" ([MainActivity.openDashboardNow] — tách ra từ `onOpenDashboardClicked`) là code **đang chạy
 * ĐÚNG**; cơ chế tự động cũ (`promoteIfSessionReady` / `loginTick` / hẹn giờ 2,5 s) **không kích hoạt** dù log cho
 * thấy `cookie=yes session=yes`. Vì vậy bản 1.4 **không viết lại đường mở dashboard**: nó chỉ **gọi đúng hàm của
 * nút** ngay khi nhịp dò 1 s thấy đã có phiên (`[auto] openDashboard reason=session_ready`), không đi qua bất kỳ
 * điều kiện trung gian nào (gate / `promoteIfSessionReady` / hẹn giờ).
 *
 * Tệp này chỉ chứa phần **THUẦN** (không API Android): cờ "một lần mỗi lần mở app" + định dạng log, nên unit test
 * được trên JVM — xem `AutoOpenTest`.
 */
object AutoOpen {

    /** Tiền tố log (cùng tag Logcat `DashboardOS-login` với `[nav]`/`[login]`/`[promote]`). */
    const val LOG_PREFIX = "[auto]"

    /** Lý do duy nhất của đường tự động: nhịp dò thấy đã có phiên ingress. */
    const val REASON_SESSION_READY = "session_ready"

    /** Lý do của nút "Mở Dashboard" (người dùng chủ động). */
    const val REASON_MANUAL = "manual_open_dashboard"

    /**
     * Số lần **tối đa** đường tự động được gọi [MainActivity.openDashboardNow] trong một lần mở app (yêu cầu: 3) —
     * khớp với [IngressPromote.MAX_PROMOTE_ATTEMPTS] để một lần thất bại (401 / SPA HA) chỉ tốn đúng một lượt.
     */
    const val MAX_ATTEMPTS = IngressPromote.MAX_PROMOTE_ATTEMPTS

    /**
     * Giãn cách tối thiểu giữa hai lần tự gọi (yêu cầu: **1,5 s**) — khớp
     * [IngressPromote.PROMOTE_RETRY_GAP_MS]; không lặp vô hạn khi top-level trả 401/SPA HA.
     */
    const val RETRY_GAP_MS = IngressPromote.PROMOTE_RETRY_GAP_MS

    /**
     * **CỜ RIÊNG của đường tự động** — "đã tự mở dashboard lần nào trong lần mở app này chưa".
     *
     *  - [decide] = được phép gọi `openDashboardNow` ngay bây giờ (chưa thành công, còn lượt, đủ giãn cách);
     *  - [take] = nhận lượt (tăng bộ đếm + ghi thời điểm) và trả số thứ tự 1-based cho log;
     *  - [success] = top-level đã `ok=top` ([MainActivity.onPromoteLoaded]) ⇒ **từ đây không tự gọi nữa** (đúng
     *    "một lần mỗi lần mở app");
     *  - [reset] = lần mở app mới (người dùng bấm "Kết nối"/màn WebView dựng lại).
     *
     * Đồng hồ **tiêm được** ([clock]) nên unit test trên JVM không cần `Thread.sleep`.
     */
    class Latch(
        val maxAttempts: Int = MAX_ATTEMPTS,
        val minGapMs: Long = RETRY_GAP_MS,
        private val clock: () -> Long = { System.currentTimeMillis() },
    ) {
        /** Số lần đã tự gọi `openDashboardNow` (0..[maxAttempts]). */
        var attempts: Int = 0
            private set

        /** Đã `ok=top` trong lần mở app này chưa — **điều kiện duy nhất** để thôi tự gọi. */
        var succeeded: Boolean = false
            private set

        /** Thời điểm (ms) của lần tự gọi gần nhất. */
        var lastAttemptAt: Long = 0L
            private set

        /** Còn lại bao nhiêu lượt tự gọi. */
        val attemptsLeft: Int get() = (maxAttempts - attempts).coerceAtLeast(0)

        /** Đã xong (top-level dùng được) ⇒ không tự gọi nữa. */
        val done: Boolean get() = succeeded

        /** Được phép tự gọi ngay bây giờ? (không có tác dụng phụ — dùng cho `[...] tick … called=yes/no`). */
        fun decide(): Boolean {
            if (succeeded) return false
            if (attempts >= maxAttempts) return false
            if (attempts > 0 && clock() - lastAttemptAt < minGapMs) return false
            return true
        }

        /** Nhận lượt: trả số thứ tự lần tự gọi (1-based); 0 = không được phép. */
        fun take(): Int {
            if (!decide()) return 0
            attempts += 1
            lastAttemptAt = clock()
            return attempts
        }

        /** Top-level đã `ok=top` ⇒ thôi tự gọi. */
        fun success() {
            succeeded = true
        }

        /** Lần mở app mới → quên tất cả (kể cả đã thành công). */
        fun reset() {
            attempts = 0
            lastAttemptAt = 0L
            succeeded = false
        }
    }

    /**
     * Dòng log của lần **tự** mở dashboard — đúng định dạng yêu cầu:
     *
     *     [auto] openDashboard reason=session_ready
     */
    fun openLine(reason: String = REASON_SESSION_READY): String =
        LOG_PREFIX + " openDashboard reason=" +
            reason.trim().ifEmpty { REASON_SESSION_READY }

    /**
     * Dòng log **mỗi nhịp dò 1 s** (chỉ ghi khi `session=yes` để không spam):
     *
     *     [auto] tick cookie=yes session=yes called=no
     *
     * `called=yes` ⇔ nhịp này thật sự gọi `openDashboardNow` (xem [Latch.decide]).
     */
    fun tickLine(cookie: Boolean, session: Boolean, called: Boolean): String =
        LOG_PREFIX + " tick cookie=" + yn(cookie) +
            " session=" + yn(session) +
            " called=" + yn(called)

    /**
     * `[auto] attempt=2/3` — chỉ để chẩn đoán khi phải thử lại (top-level vừa trả 401 / SPA HA).
     */
    fun attemptLine(attempt: Int, maxAttempts: Int = MAX_ATTEMPTS): String =
        LOG_PREFIX + " attempt=" + attempt.coerceAtLeast(1) + "/" + maxAttempts

    /**
     * `[auto] give_up try=3/3 session=yes` — đã dùng hết [MAX_ATTEMPTS] lượt mà top-level vẫn không dùng được:
     * app ở lại panel, **không lặp vô hạn**; người dùng vẫn bấm được nút "Mở Dashboard".
     */
    fun giveUpLine(attempts: Int, session: Boolean, maxAttempts: Int = MAX_ATTEMPTS): String =
        LOG_PREFIX + " give_up try=" + attempts.coerceAtLeast(0) + "/" + maxAttempts +
            " session=" + yn(session)

    private fun yn(value: Boolean): String = if (value) "yes" else "no"
}

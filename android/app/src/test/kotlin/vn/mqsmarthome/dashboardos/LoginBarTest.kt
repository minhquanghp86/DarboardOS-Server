package vn.mqsmarthome.dashboardos

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * (1.5) — kiểm tra phần THUẦN của **chính sách hiện/ẩn thanh thông báo đăng nhập** ([LoginBar]) — đúng 3 yêu cầu:
 *
 *  1. thanh (`haLoginBar`) mặc định **KHÔNG** hiện khi chỉ "chưa biết trạng thái" (lần mở app sau bị nhấp nháy
 *     1–2 s là do `openDashboardNow` bật nó vô điều kiện);
 *  2. chỉ hiện khi **thật sự cần**: 401/403 trên ingress, URL `/auth/…`, `startLoginFlow()`, trang sai, hết cách,
 *     hoặc người dùng chủ động bấm nút;
 *  3. đã có phiên (`session=yes`) ⇒ **không bao giờ** hiện (kể cả khung hình đầu) + ẩn **ngay** khi đăng nhập xong.
 *
 * Chạy: `cd android && ./gradlew testDebugUnitTest --offline --no-daemon`.
 */
class LoginBarTest {

    private val allReasons = LoginBar.Reason.values().toList()

    // ─────────────────────────────────────────── 1) mặc định KHÔNG hiện

    @Test
    fun chua_biet_trang_thai_thi_khong_hien_thanh() {
        // Đây chính là lỗi nhấp nháy của bản 1.4: `openDashboardNow` (đường tự động) bật thanh dù không cần đăng
        // nhập gì. Bản 1.5: các lý do này KHÔNG được bật thanh, kể cả khi CHƯA có phiên.
        val silent = listOf(
            LoginBar.Reason.STARTUP,
            LoginBar.Reason.CONNECT,
            LoginBar.Reason.SESSION_CHECK,
            LoginBar.Reason.PANEL_WAIT,
            LoginBar.Reason.OPEN_DASHBOARD
        )
        for (reason in silent) {
            assertFalse("lý do ${reason.wire} không được hiện thanh", reason.needed)
            val d = LoginBar.decide(show = true, reason = reason, hasSession = false, settling = false)
            assertFalse("lý do ${reason.wire} ⇒ ẩn", d.visible)
            assertEquals(LoginBar.WHY_NOT_NEEDED, d.why)
            assertEquals(reason.wire, d.reason)
        }
    }

    @Test
    fun an_la_an_khong_phu_thuoc_ly_do() {
        // Mọi lý do, khi caller yêu cầu ẩn ⇒ ẩn (không có ngoại lệ, không animate — quyết định thuần).
        for (reason in allReasons) {
            for (session in listOf(true, false)) {
                val d = LoginBar.decide(show = false, reason = reason, hasSession = session, settling = true)
                assertFalse("ẩn với ${reason.wire} session=$session", d.visible)
                assertNull("ẩn bình thường thì không có why=", d.why)
            }
        }
    }

    // ─────────────────────────────────────────── 2) chỉ hiện khi THẬT SỰ cần

    @Test
    fun can_dang_nhap_that_thi_hien_thanh() {
        val needed = listOf(
            LoginBar.Reason.AUTH_HTTP,
            LoginBar.Reason.AUTH_URL,
            LoginBar.Reason.LOGIN_FLOW,
            LoginBar.Reason.WRONG_PAGE,
            LoginBar.Reason.GIVE_UP,
            LoginBar.Reason.USER_RETRY,
            LoginBar.Reason.USER_LOGIN_DONE,
            LoginBar.Reason.USER_LOGIN_AGAIN
        )
        for (reason in needed) {
            assertTrue("${reason.wire} phải thuộc nhóm cần thật", reason.needed)
            val d = LoginBar.decide(show = true, reason = reason, hasSession = false, settling = false)
            assertTrue("chưa có phiên + ${reason.wire} ⇒ hiện", d.visible)
            assertNull(d.why)
        }
    }

    @Test
    fun moi_ly_do_deu_duoc_phan_loai() {
        // Không có lý do nào "quên" phân loại: cần thật hay không đều phải tường minh.
        val needed = allReasons.filter { it.needed }.map { it.wire }
        val silent = allReasons.filterNot { it.needed }.map { it.wire }
        assertTrue(needed.containsAll(listOf("auth_http", "auth_url", "login_flow", "give_up")))
        assertTrue(silent.containsAll(listOf("startup", "panel_wait", "open_dashboard")))
        assertEquals(allReasons.size, needed.size + silent.size)
    }

    // ─────────────────────────────────────────── 3) đã có phiên ⇒ KHÔNG BAO GIỜ hiện

    @Test
    fun co_phien_thi_khong_bao_gio_hien_ke_ca_khung_hinh_dau() {
        for (reason in allReasons) {
            val d = LoginBar.decide(show = true, reason = reason, hasSession = true, settling = false)
            assertFalse("session=yes ⇒ không hiện (${reason.wire})", d.visible)
            // Lý do "chưa biết trạng thái" bị chặn sớm hơn (`why=not_needed`); lý do cần thật bị chặn vì phiên.
            val expected = if (reason.needed) LoginBar.WHY_SESSION else LoginBar.WHY_NOT_NEEDED
            assertEquals("why của ${reason.wire}", expected, d.why)
        }
    }

    @Test
    fun dang_nhap_xong_thi_an_ngay() {
        // `onPanelLoaded` / `onPromoteLoaded` / "Tôi đã đăng nhập" khi đã có phiên ⇒ ẩn NGAY (yêu cầu 5):
        // không có "trạng thái trung gian" nào giữ thanh lại.
        val afterLogin = listOf(
            LoginBar.Reason.SESSION_READY,
            LoginBar.Reason.PANEL_OK,
            LoginBar.Reason.TOP_OK,
            LoginBar.Reason.ROOT_OK,
            LoginBar.Reason.USER_LOGIN_DONE
        )
        for (reason in afterLogin) {
            val hide = LoginBar.decide(show = false, reason = reason, hasSession = true, settling = false)
            assertFalse("${reason.wire} ⇒ ẩn ngay", hide.visible)
            val stillVisible = LoginBar.decide(show = true, reason = reason, hasSession = true, settling = false)
            assertFalse("session=yes vẫn ẩn (${reason.wire})", stillVisible.visible)
        }
    }

    // ─────────────────────────────────────────── 4) thời gian ân hạn

    @Test
    fun an_han_chi_ap_dung_khi_mo_app_da_co_phien() {
        assertTrue(LoginBar.settling(launchHadSession = true, elapsedMs = 0L))
        assertTrue(LoginBar.settling(launchHadSession = true, elapsedMs = LoginBar.SETTLE_MS - 1))
        assertFalse(LoginBar.settling(launchHadSession = true, elapsedMs = LoginBar.SETTLE_MS))
        // Lần mở app CHƯA có phiên: không ân hạn — cần đăng nhập là hiện ngay (người dùng phải thấy nút).
        assertFalse(LoginBar.settling(launchHadSession = false, elapsedMs = 0L))
        assertEquals(2500L, LoginBar.SETTLE_MS)
    }

    @Test
    fun trong_an_han_thi_hoan_lai_sau_khi_het() {
        // 401 ngay sau khi mở app (đã có phiên) ⇒ hoãn, rồi xét lại khi hết ân hạn.
        val during = LoginBar.decide(
            show = true, reason = LoginBar.Reason.AUTH_HTTP, hasSession = false, settling = true
        )
        assertFalse(during.visible)
        assertEquals(LoginBar.WHY_SETTLING, during.why)
        assertTrue("cần xét lại sau ân hạn", during.settling)
        assertEquals(1500L, LoginBar.settleRemainingMs(1000L))
        assertEquals(0L, LoginBar.settleRemainingMs(LoginBar.SETTLE_MS))
        assertEquals(0L, LoginBar.settleRemainingMs(LoginBar.SETTLE_MS + 500L))
        assertEquals(LoginBar.SETTLE_MS, LoginBar.settleRemainingMs(0L))
        // Hết ân hạn mà vẫn chưa có phiên ⇒ hiện (chức năng "Thử lại" không bị mất).
        val after = LoginBar.decide(
            show = true, reason = LoginBar.Reason.AUTH_HTTP, hasSession = false, settling = false
        )
        assertTrue(after.visible)
    }

    // ─────────────────────────────────────────── 5) dòng log chẩn đoán

    @Test
    fun dong_log_dung_dinh_dang_ui_bar() {
        val show = LoginBar.decide(true, LoginBar.Reason.AUTH_URL, hasSession = false, settling = false)
        assertEquals("[ui] bar=show reason=auth_url session=no", LoginBar.line(show, hasSession = false))
        val hide = LoginBar.decide(true, LoginBar.Reason.OPEN_DASHBOARD, hasSession = true, settling = true)
        assertEquals(
            "[ui] bar=hide reason=open_dashboard why=not_needed session=yes",
            LoginBar.line(hide, hasSession = true)
        )
        val session = LoginBar.decide(true, LoginBar.Reason.AUTH_HTTP, hasSession = true, settling = false)
        assertEquals(
            "[ui] bar=hide reason=auth_http why=session session=yes",
            LoginBar.line(session, hasSession = true)
        )
        val plain = LoginBar.decide(false, LoginBar.Reason.PANEL_OK, hasSession = true, settling = false)
        assertEquals("[ui] bar=hide reason=panel_ok session=yes", LoginBar.line(plain, hasSession = true))
        // Tiền tố riêng để dòng log này không lẫn với `[nav]`/`[promote]`/`[auto]`.
        assertEquals("[ui]", LoginBar.LOG_PREFIX)
    }

    @Test
    fun dong_log_khong_kich_hoat_tu_luu_chan_doan() {
        // Yêu cầu 4: log `[ui] …` (để kiểm chứng trên máy thật) KHÔNG được kích hoạt auto-save của Chẩn đoán.
        for (reason in allReasons) {
            for (session in listOf(true, false)) {
                for (settling in listOf(true, false)) {
                    for (show in listOf(true, false)) {
                        val line = LoginBar.line(
                            LoginBar.decide(show, reason, session, settling),
                            hasSession = session
                        )
                        assertFalse("không tự lưu tệp: $line", DiagFile.shouldAutoSave(line))
                        assertFalse("không chứa mã 401: $line", line.contains("401"))
                    }
                }
            }
        }
        // Tên lý do: chỉ chữ thường + `_`, không chữ số (để không bao giờ khớp `ok=401` của DiagAutoSave).
        for (reason in allReasons) {
            assertTrue("wire của ${reason.wire} chỉ gồm a-z/_", Regex("[a-z_]+").matches(reason.wire))
        }
    }
}

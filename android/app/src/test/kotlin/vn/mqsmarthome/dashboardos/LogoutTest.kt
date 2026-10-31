package vn.mqsmarthome.dashboardos

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * (1.6) — kiểm tra phần **THUẦN** của luồng **ĐĂNG XUẤT** ([Logout]): danh sách bước + thứ tự, quyết định bước nào
 * chạy, quyết định **xoá khoá Prefs nào / giữ khoá nào**, nút có hiện không, và định dạng dòng log `[logout] …`.
 *
 * Chạy: `cd android && ./gradlew testDebugUnitTest --offline --no-daemon`.
 */
class LogoutTest {

    private val fullState = Logout.State(apiBase = "http://192.168.10.2:18080", phoneId = "phone-1")

    // ─────────────────────────────────────────── 1) DANH SÁCH BƯỚC + THỨ TỰ

    @Test
    fun thu_tu_buoc_dung_yeu_cau() {
        // Đúng 6 nhóm yêu cầu (bước 2 tách đôi để log rõ):
        //   1 POST /app/remove → 2 dừng service + huỷ thông báo → 3 cookie → 4 dữ liệu WebView → 5 Prefs → 6 UI.
        assertEquals(
            listOf(
                Logout.Step.REMOVE_DEVICE,
                Logout.Step.STOP_SERVICE,
                Logout.Step.CANCEL_CALL_NOTIFICATION,
                Logout.Step.CLEAR_COOKIES,
                Logout.Step.CLEAR_WEBVIEW_DATA,
                Logout.Step.CLEAR_PREFS,
                Logout.Step.RESET_UI
            ),
            Logout.ORDER
        )
        assertEquals(Logout.ORDER, Logout.plan(fullState))
        assertEquals(7, Logout.plan(fullState).size)
    }

    @Test
    fun chua_co_api_base_thi_bo_qua_buoc_goi_server_nhung_van_xoa_sach_may() {
        val plan = Logout.plan(Logout.State(apiBase = null, phoneId = "phone-1"))
        assertFalse("không có địa chỉ API ⇒ không gọi /app/remove", plan.contains(Logout.Step.REMOVE_DEVICE))
        // 6 bước còn lại vẫn phải chạy: máy phải sạch cookie / WebView / Prefs dù server không gọi được.
        assertEquals(Logout.ORDER.filter { it != Logout.Step.REMOVE_DEVICE }, plan)
        assertFalse(Logout.callsServer(Logout.State(apiBase = "  ", phoneId = "phone-1")))
        assertFalse(Logout.callsServer(Logout.State(apiBase = null, phoneId = null)))
    }

    @Test
    fun chi_goi_server_khi_co_ca_dia_chi_lan_id() {
        assertTrue(Logout.callsServer(fullState))
        assertFalse("thiếu id thiết bị thì không có gì để gửi", Logout.callsServer(Logout.State("https://hass", " ")))
        assertFalse(Logout.callsServer(Logout.State(null, "phone-1")))
    }

    // ─────────────────────────────────────────── 2) QUYẾT ĐỊNH XOÁ GÌ (Prefs)

    @Test
    fun giu_lai_chi_co_da_xem_huong_dan() {
        assertEquals(setOf(Prefs.KEY_SAW_GUIDE), Logout.KEEP_KEYS)
        assertTrue(Logout.keep(Prefs.KEY_SAW_GUIDE))
        assertFalse(Logout.keep(null))
        assertFalse(Logout.keep(" "))
    }

    @Test
    fun xoa_toan_bo_khoa_con_lai_ke_ca_du_lieu_ban_cu() {
        // Các khoá đang có trên máy (gồm khoá của bản cũ: "url", "web_input", "api_input"…).
        val existing = listOf(
            Prefs.KEY_WEB_URL,
            Prefs.KEY_API_BASE,
            Prefs.KEY_LOGIN_URL,
            Prefs.KEY_PHONE_ID,
            Prefs.KEY_INGRESS_TOKEN,
            Prefs.KEY_NEED_HA_LOGIN,
            Prefs.KEY_WEB_INPUT,
            Prefs.KEY_API_INPUT,
            Prefs.KEY_URL,
            Prefs.KEY_RECEIVE,
            Prefs.KEY_SAW_GUIDE
        )
        val removed = Logout.keysToRemove(existing)
        assertFalse("giữ cờ đã xem hướng dẫn", removed.contains(Prefs.KEY_SAW_GUIDE))
        for (key in existing.filterNot { it == Prefs.KEY_SAW_GUIDE }) {
            assertTrue("phải xoá $key", removed.contains(key))
        }
        assertEquals("tất cả trừ 1 khoá", existing.size - 1, removed.size)
        // Tất định (đã sắp xếp) để log/kết quả so sánh được.
        assertEquals(removed.sorted(), removed)
    }

    @Test
    fun khong_co_du_lieu_thi_khong_xoa_gi() {
        assertTrue(Logout.keysToRemove(null).isEmpty())
        assertTrue(Logout.keysToRemove(emptyList()).isEmpty())
        assertTrue("chỉ có cờ hướng dẫn ⇒ không xoá gì", Logout.keysToRemove(listOf(Prefs.KEY_SAW_GUIDE)).isEmpty())
        // Khoá trùng chỉ xuất hiện một lần.
        assertEquals(listOf(Prefs.KEY_WEB_URL), Logout.keysToRemove(listOf(Prefs.KEY_WEB_URL, Prefs.KEY_WEB_URL)))
    }

    // ─────────────────────────────────────────── 3) NÚT "ĐĂNG XUẤT" CÓ HIỆN KHÔNG

    @Test
    fun nut_dang_xuat_chi_hien_khi_da_co_phien_hoac_cau_hinh() {
        assertFalse("máy mới ⇒ ẩn", Logout.showChip(hasConfig = false, hasSession = false))
        assertTrue("đã lưu cấu hình ⇒ hiện", Logout.showChip(hasConfig = true, hasSession = false))
        assertTrue("đã có cookie phiên ⇒ hiện", Logout.showChip(hasConfig = false, hasSession = true))
        assertTrue(Logout.showChip(hasConfig = true, hasSession = true))
    }

    // ─────────────────────────────────────────── 4) LÝ DO + DÒNG LOG

    @Test
    fun ma_http_thanh_ly_do_bang_chu() {
        assertEquals(Logout.REASON_NET, Logout.reason(null))
        assertEquals(Logout.REASON_OK, Logout.reason(200))
        assertEquals(Logout.REASON_OK, Logout.reason(204))
        assertEquals(Logout.REASON_DENIED, Logout.reason(401))
        assertEquals(Logout.REASON_DENIED, Logout.reason(403))
        assertEquals(Logout.REASON_NOT_FOUND, Logout.reason(404))
        assertEquals(Logout.REASON_ERROR, Logout.reason(500))
        // "không gọi được" KHÔNG được coi là đã huỷ; 2xx và 404 (server không còn thiết bị) thì coi như xong.
        assertFalse(Logout.removed(null))
        assertFalse(Logout.removed(401))
        assertFalse(Logout.removed(500))
        assertTrue(Logout.removed(200))
        assertTrue(Logout.removed(404))
    }

    @Test
    fun dong_log_dung_dinh_dang_step_ok() {
        assertEquals("[logout] step=remove_device ok=yes reason=ok", Logout.line(Logout.Step.REMOVE_DEVICE, true, Logout.reasonExtra(200)))
        assertEquals("[logout] step=remove_device ok=no reason=net", Logout.line(Logout.Step.REMOVE_DEVICE, false, Logout.reasonExtra(null)))
        assertEquals("[logout] step=stop_service ok=yes", Logout.line(Logout.Step.STOP_SERVICE, true))
        assertEquals("[logout] step=clear_prefs ok=yes keys=9", Logout.line(Logout.Step.CLEAR_PREFS, true, "keys=9"))
        assertEquals("[logout]", Logout.LOG_PREFIX)
        // Chỉ chữ thường + `_` trong tên bước (để không bao giờ khớp `ok=401` của DiagAutoSave).
        for (step in Logout.Step.values()) {
            assertTrue("wire của ${step.wire} chỉ gồm a-z/_", Regex("[a-z_]+").matches(step.wire))
        }
    }

    @Test
    fun log_dang_xuat_khong_kich_hoat_tu_luu_chan_doan() {
        // Yêu cầu: log `[logout] …` KHÔNG được kích hoạt auto-save (đăng xuất không phải sự cố).
        val codes = listOf<Int?>(null, 200, 401, 403, 404, 500)
        for (step in Logout.Step.values()) {
            for (ok in listOf(true, false)) {
                for (code in codes) {
                    val line = Logout.line(step, ok, Logout.reasonExtra(code))
                    assertFalse("không tự lưu tệp: $line", DiagFile.shouldAutoSave(line))
                }
                assertFalse(DiagFile.shouldAutoSave(Logout.line(step, ok, "keys=9")))
                assertFalse(DiagFile.shouldAutoSave(Logout.line(step, ok)))
            }
        }
    }
}

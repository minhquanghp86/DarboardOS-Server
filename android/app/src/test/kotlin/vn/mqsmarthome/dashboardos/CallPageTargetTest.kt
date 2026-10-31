package vn.mqsmarthome.dashboardos

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * (1.8) — khoá lại **hàm dựng URL trang gọi** ([CallPageTarget]) và **hàng rào kiểm tra trước khi mở**.
 *
 * Bối cảnh (lỗi người dùng vừa test, bản 1.7): bấm **Nghe** ở điện thoại → app mở
 * `https://<domain>/b39feb53_remote_webview_server/call-web.html?call=…`, tức **route của SPA Home Assistant** ⇒ hiện
 * dashboard Hass, không có giao diện gọi, bên gọi không nhận `accepted`. Trang gọi THẬT phải nằm dưới ingress:
 * `https://<domain>/api/hassio_ingress/<TOKEN>/call-web.html?call=<id>&phone=<phoneId>`.
 *
 * Ở đây khoá lại đúng 3 nhánh của yêu cầu:
 *  1. `apiBase` (đã là ingress) → dùng ngay;
 *  2. `apiBase` rỗng/hỏng (hoặc là panel của HA) → **dựng lại** từ domain + TOKEN ([IngressPromote.apiBase]);
 *  3. chỉ khi không còn cách nào → `webUrl` (chế độ IP LAN, `http(s)://<ip>:<port>`);
 * cùng với đó là [CallPageTarget.openable] (LOẠI URL panel HA thuần) và định dạng dòng log
 * `[answer] url=… source=… ok=…` (không kích hoạt tự lưu tệp chẩn đoán).
 *
 * Chạy: `cd android && ./gradlew testDebugUnitTest --offline --no-daemon`.
 */
class CallPageTargetTest {

    private val domain = "hass.mqsmarthome.io.vn"
    private val origin = "https://$domain"
    private val token = WebTargetResolver.DEFAULT_INGRESS_TOKEN
    private val ingressBase = "$origin/api/hassio_ingress/$token"
    private val panel = "$origin/${ServerResolver.ADDON_SLUG}"
    private val callId = "abc123"
    private val phoneId = "7f3c9a2e-1b44-4c8d-9f00-2f9c5e0d1a66"

    private val ingressCall = "$ingressBase/call-web.html?call=$callId&phone=$phoneId"

    // ─────────────────────────────────────────── 1) nhánh `apiBase`

    @Test
    fun api_base_da_la_ingress_thi_dung_ngay() {
        val r = CallPageTarget.build(
            callId = callId,
            phoneId = phoneId,
            apiBase = ingressBase,
            webUrl = panel,
            loginUrl = origin,
            token = token
        )
        assertEquals(ingressCall, r.url)
        assertEquals(CallPageTarget.Source.API_BASE, r.source)
        assertTrue(r.ok)
    }

    @Test
    fun api_base_co_gach_cheo_cuoi_van_dung_dung_mot_gach() {
        val r = CallPageTarget.build(
            callId = callId,
            phoneId = phoneId,
            apiBase = "$ingressBase/",
            webUrl = null
        )
        assertEquals(ingressCall, r.url)
        assertEquals(CallPageTarget.Source.API_BASE, r.source)
    }

    @Test
    fun api_base_lan_thi_trang_goi_o_goc_add_on() {
        val lanBase = "http://192.168.10.2:18080"
        val r = CallPageTarget.build(
            callId = callId,
            phoneId = phoneId,
            apiBase = lanBase,
            webUrl = "https://192.168.10.2:18443/launcher-config.html"
        )
        assertEquals("$lanBase/call-web.html?call=$callId&phone=$phoneId", r.url)
        assertEquals(CallPageTarget.Source.API_BASE, r.source)
    }

    // ─────────────────────────────────────────── 2) nhánh `rebuilt` (dựng lại từ domain + TOKEN)

    @Test
    fun api_base_rong_thi_dung_lai_tu_domain_va_token() {
        val r = CallPageTarget.build(
            callId = callId,
            phoneId = phoneId,
            apiBase = null,
            webUrl = panel,
            loginUrl = "$origin/",
            token = token
        )
        assertEquals(ingressCall, r.url)
        assertEquals(CallPageTarget.Source.REBUILT, r.source)
        assertTrue("phải nằm dưới ingress: ${r.url}", r.url!!.contains("/api/hassio_ingress/"))
    }

    @Test
    fun api_base_la_panel_ha_thi_bi_loai_va_dung_lai() {
        // Dữ liệu cũ: apiBase từng được ghi bằng chính panel của add-on trên HA.
        val r = CallPageTarget.build(
            callId = callId,
            phoneId = phoneId,
            apiBase = panel,
            webUrl = panel,
            loginUrl = origin,
            token = token
        )
        assertEquals(ingressCall, r.url)
        assertEquals(CallPageTarget.Source.REBUILT, r.source)
        assertFalse("không bao giờ mở route của SPA HA", r.url!!.contains("${ServerResolver.ADDON_SLUG}/call-web.html"))
    }

    @Test
    fun khong_co_api_base_van_dung_lai_duoc_tu_chuoi_nguoi_dung_da_go() {
        val r = CallPageTarget.build(
            callId = callId,
            phoneId = phoneId,
            apiBase = "",
            webUrl = null,
            loginUrl = null,
            typed = domain,
            token = token
        )
        assertEquals(ingressCall, r.url)
        assertEquals(CallPageTarget.Source.REBUILT, r.source)
    }

    // ─────────────────────────────────────────── 3) nhánh `webUrl` (chỉ chế độ IP LAN)

    @Test
    fun chi_khi_khong_con_cach_nao_moi_dung_web_url_che_do_lan() {
        val r = CallPageTarget.build(
            callId = callId,
            phoneId = phoneId,
            apiBase = null,
            webUrl = "https://192.168.10.2:18443/launcher-config.html",
            loginUrl = null,
            typed = null,
            token = token
        )
        assertEquals("https://192.168.10.2:18443/call-web.html?call=$callId&phone=$phoneId", r.url)
        assertEquals(CallPageTarget.Source.WEB_URL, r.source)
        assertFalse("IP LAN không có ingress nên KHÔNG được dựng URL ingress", r.url!!.contains("/api/"))
    }

    @Test
    fun web_url_la_panel_ha_thi_van_dung_lai_duoc_tu_domain_cua_panel() {
        // Chỉ có panel của HA: domain vẫn lấy được từ chính URL đó ⇒ dựng lại URL ingress (KHÔNG mở dashboard Hass).
        val r = CallPageTarget.build(
            callId = callId,
            phoneId = phoneId,
            apiBase = null,
            webUrl = panel,
            loginUrl = null,
            typed = null,
            token = null
        )
        assertEquals(CallPageTarget.Source.REBUILT, r.source)
        assertEquals(ingressCall, r.url)
        assertFalse("không bao giờ mở route của SPA HA", r.url!!.contains("${ServerResolver.ADDON_SLUG}/call-web.html"))
    }

    @Test
    fun khong_co_dia_chi_nao_thi_ok_bang_0() {
        val r = CallPageTarget.build(callId = callId, phoneId = phoneId, apiBase = null, webUrl = null)
        assertFalse(r.ok)
        assertEquals(CallPageTarget.Source.NONE, r.source)
        assertEquals("[answer] url=- source=none ok=0", CallPageTarget.logLine(r.url, r.source, r.ok))
    }

    @Test
    fun call_id_rong_thi_khong_dung_url() {
        assertEquals(
            CallPageTarget.Result.NONE,
            CallPageTarget.build(callId = "  ", phoneId = phoneId, apiBase = ingressBase, webUrl = panel)
        )
    }

    // ─────────────────────────────────────────── 4) hàng rào: URL nào được mở

    @Test
    fun chi_mo_url_sau_ingress_hoac_ip_co_cong() {
        assertTrue("ingress của HA", CallPageTarget.openable(ingressCall))
        assertTrue("legacy /hassio/ingress/", CallPageTarget.openable("$origin/hassio/ingress/$token/call-web.html?call=x"))
        assertTrue("http IP LAN", CallPageTarget.openable("http://192.168.10.2:18080/call-web.html?call=x"))
        assertTrue("https tự ký của add-on", CallPageTarget.openable("https://192.168.10.2:18443/call-web.html?call=x"))
        assertTrue("Tailscale (IP + cổng)", CallPageTarget.openable("https://100.101.102.103:18443/call-web.html?call=x"))
    }

    @Test
    fun khong_mo_panel_cua_ha_va_goc_domain() {
        assertFalse(
            "panel của add-on trên HA (route SPA)",
            CallPageTarget.openable("$panel/call-web.html?call=x")
        )
        assertFalse("panel trần", CallPageTarget.openable(panel))
        assertFalse("gốc domain = Lovelace của HA", CallPageTarget.openable("$origin/call-web.html?call=x"))
        assertFalse("không phải http(s)", CallPageTarget.openable("about:blank"))
        assertFalse("rỗng", CallPageTarget.openable(null))
        assertTrue(CallPageTarget.isHaPanelOnly("$panel/call-web.html?call=x"))
        assertFalse("ingress thì không phải 'panel thuần'", CallPageTarget.isHaPanelOnly(ingressCall))
    }

    @Test
    fun nhan_dien_trang_goi_de_nhip_do_khong_keo_ve_panel() {
        assertTrue(CallPageTarget.isCallPage(ingressCall))
        assertTrue(CallPageTarget.isCallPage("https://192.168.10.2:18443/call-web.html"))
        assertFalse(CallPageTarget.isCallPage(panel))
        assertFalse(CallPageTarget.isCallPage("$ingressBase/launcher-config.html"))
    }

    @Test
    fun doc_call_id_tu_url_de_dung_lai_khi_url_sai() {
        assertEquals(callId, CallPageTarget.callIdOf("$panel/call-web.html?call=$callId"))
        assertEquals("a/b", CallPageTarget.callIdOf("https://h/call-web.html?call=a%2Fb&phone=p1"))
        assertNull(CallPageTarget.callIdOf("$panel/call-web.html?phone=p1"))
        assertNull(CallPageTarget.callIdOf("$panel/call-web.html"))
        assertNull(CallPageTarget.callIdOf(null))
    }

    // ─────────────────────────────────────────── 5) dòng log `[answer] …` (yêu cầu 3)

    @Test
    fun dong_log_dung_dinh_dang_va_khong_tu_luu_tep_chan_doan() {
        val line = CallPageTarget.logLine(ingressCall, CallPageTarget.Source.API_BASE, true)
        assertEquals(
            "[answer] url=…/api/hassio_ingress/KJjH…/call-web.html?call=$callId&phone=$phoneId source=apiBase ok=1",
            line
        )
        assertFalse("KHÔNG kích hoạt tự lưu tệp chẩn đoán", DiagFile.shouldAutoSave(line))
        // `source` của 3 nhánh đúng như yêu cầu.
        assertEquals("rebuilt", CallPageTarget.Source.REBUILT.label)
        assertEquals("webUrl", CallPageTarget.Source.WEB_URL.label)
        // Dòng "đã điều hướng ở đâu" (không có ok=/fail=).
        assertEquals(
            "[answer] nav=webview url=…/api/hassio_ingress/KJjH…/call-web.html?call=$callId&phone=$phoneId",
            CallPageTarget.navLine(ingressCall, CallLauncher.NAV_WEBVIEW)
        )
        assertFalse(DiagFile.shouldAutoSave(CallPageTarget.navLine(ingressCall, CallLauncher.NAV_WEBVIEW)))
    }

    // ─────────────────────────────────────────── 6) hàm phụ

    @Test
    fun base_ingress_dung_lai_tu_origin_va_token() {
        assertEquals(ingressBase, CallPageTarget.ingressBase(origin, token))
        assertEquals(ingressBase, CallPageTarget.ingressBase("$origin/", token))
        // TOKEN rỗng → TOKEN mặc định (giống mọi chỗ khác của app).
        assertEquals(ingressBase, CallPageTarget.ingressBase(origin, ""))
        assertNull(CallPageTarget.ingressBase("", token))
        assertNull(CallPageTarget.ingressBase("khong-phai-url", token))
    }

    @Test
    fun page_url_ma_hoa_tham_so_va_bo_qua_phone_rong() {
        assertEquals(
            "$ingressBase/call-web.html?call=a%2Fb",
            CallPageTarget.pageUrl(ingressBase, "a/b", "   ")
        )
        assertEquals(
            "$ingressBase/call-web.html?call=a%2Fb&phone=may+1",
            CallPageTarget.pageUrl(ingressBase, "a/b", "may 1")
        )
        assertNull(CallPageTarget.pageUrl("", callId))
        assertNull(CallPageTarget.pageUrl("192.168.10.2:18080", callId))
    }
}

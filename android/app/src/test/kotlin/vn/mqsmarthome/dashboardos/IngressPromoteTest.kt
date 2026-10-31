package vn.mqsmarthome.dashboardos

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * (27/11/2026) GD15 — kiểm tra phần THUẦN của bước **promote panel (iframe) → TOP-LEVEL ingress**.
 *
 * Bối cảnh (xem KDoc của [IngressPromote]): panel của HA nhúng add-on trong `<iframe>` **không có**
 * `allow="microphone; camera"` ⇒ Permissions Policy của khung cha chặn `getUserMedia` ⇒ không gọi điện được. Sau khi
 * panel đã mở và đã có cookie `ingress_session`, app chuyển sang top-level
 * `https://<domain>/api/hassio_ingress/<TOKEN>/launcher-config.html`.
 *
 * Ở đây khoá lại:
 *  1. **điều kiện được phép promote** ([IngressPromote.decide]) — chỉ một lần, chỉ khi đã có phiên;
 *  2. URL top-level dựng đúng + TOKEN lấy từ `src` iframe ([IngressPromote.topUrl], [IngressPromote.tokenFromUrl],
 *     [HaIngress.readFrameSrc]);
 *  3. **kết luận trang top-level** ([IngressPromote.verdict], [IngressPromote.failReason]) — 401/403, SPA HA, 3xx;
 *  4. định dạng log `[promote] url=… ok=top|panel|401` ([IngressPromote.logLine], [IngressPromote.failLine]…);
 *  5. base API native khi ở top-level ([IngressPromote.apiBase]).
 *
 * Chạy: `cd android && ./gradlew testDebugUnitTest --offline --no-daemon`.
 */
class IngressPromoteTest {

    private val origin = "https://hass.mqsmarthome.io.vn"
    private val token = "KJjH_rSB8SdDeyjszvdZnnH1pRlxySfVG5VmgDMVf38"
    private val topUrl = "$origin/api/hassio_ingress/$token/launcher-config.html"
    private val shortTop = "…/api/hassio_ingress/KJjH…/launcher-config.html"

    // ─────────────────────────────────────────── 1) điều kiện "đã có phiên, được phép promote"

    @Test
    fun promote_khi_da_co_phien_va_chua_thu_lan_nao() {
        assertEquals(
            IngressPromote.Decision.PROMOTE,
            IngressPromote.decide(hasSession = true, alreadyPromoted = false, topUrl = topUrl)
        )
    }

    @Test
    fun khong_promote_lan_hai_du_phien_con_hoac_mat() {
        // Cờ trong bộ nhớ thắng mọi thứ: promote tối đa MỘT lần cho mỗi lần mở app.
        assertEquals(
            IngressPromote.Decision.ALREADY,
            IngressPromote.decide(hasSession = true, alreadyPromoted = true, topUrl = topUrl)
        )
        assertEquals(
            IngressPromote.Decision.ALREADY,
            IngressPromote.decide(hasSession = false, alreadyPromoted = true, topUrl = topUrl)
        )
    }

    @Test
    fun chua_co_cookie_ingress_session_thi_khong_promote() {
        // Chưa có phiên ⇒ top-level sẽ 401 ⇒ ở lại panel, chờ thêm (xem MainActivity.maybePromotePanel).
        assertEquals(
            IngressPromote.Decision.NO_SESSION,
            IngressPromote.decide(hasSession = false, alreadyPromoted = false, topUrl = topUrl)
        )
    }

    @Test
    fun khong_dung_duoc_url_top_level_thi_khong_promote() {
        assertEquals(
            IngressPromote.Decision.NO_URL,
            IngressPromote.decide(hasSession = true, alreadyPromoted = false, topUrl = null)
        )
        assertEquals(
            IngressPromote.Decision.NO_URL,
            IngressPromote.decide(hasSession = true, alreadyPromoted = false, topUrl = "   ")
        )
    }

    // ─────────────────────────────────────────── 2) URL top-level + TOKEN

    @Test
    fun dung_url_top_level_dung_ingress_va_trang_launcher() {
        assertEquals(topUrl, IngressPromote.topUrl(origin, token))
        // `/` cuối của origin không tạo `//`.
        assertEquals(topUrl, IngressPromote.topUrl("$origin/", token))
        assertEquals(topUrl, IngressPromote.topUrl("  $origin/  ", "  $token  "))
        // TOKEN rỗng → TOKEN mặc định (đúng như WebTargetResolver.sanitizeToken).
        assertEquals(
            "$origin/api/hassio_ingress/${WebTargetResolver.DEFAULT_INGRESS_TOKEN}/launcher-config.html",
            IngressPromote.topUrl(origin, null)
        )
        // TOKEN có `/` thừa vẫn gọn.
        assertEquals(
            "$origin/api/hassio_ingress/$token/launcher-config.html",
            IngressPromote.topUrl(origin, "/$token/")
        )
    }

    @Test
    fun origin_khong_dung_duoc_thi_khong_dung_duoc_url() {
        assertNull(IngressPromote.topUrl(null, token))
        assertNull(IngressPromote.topUrl("", token))
        assertNull(IngressPromote.topUrl("hass.mqsmarthome.io.vn", token))   // thiếu scheme
        assertNull(IngressPromote.topUrl(origin, token, page = "  "))
    }

    @Test
    fun lay_dung_token_tu_src_iframe_ma_ha_vua_dung() {
        // `src` iframe thật của panel: có thêm đường dẫn con + query.
        assertEquals(
            token,
            IngressPromote.tokenFromUrl("$origin/api/hassio_ingress/$token/panel/dashboard.html?x=1#y")
        )
        // Dạng cũ `/hassio/ingress/`.
        assertEquals("abc123XYZ", IngressPromote.tokenFromUrl("$origin/hassio/ingress/abc123XYZ/index.html"))
        assertNull(IngressPromote.tokenFromUrl(null))
        assertNull(IngressPromote.tokenFromUrl(""))
        assertNull(IngressPromote.tokenFromUrl("$origin/b39feb53_remote_webview_server"))
    }

    @Test
    fun doc_src_iframe_tu_ket_qua_evaluate_javascript() {
        // WebView trả JSON: có thể escape `/`.
        assertEquals(
            "$origin/api/hassio_ingress/$token/launcher-config.html",
            HaIngress.readFrameSrc("\"$origin\\/api\\/hassio_ingress\\/$token\\/launcher-config.html\"")
        )
        assertEquals(
            "$origin/api/hassio_ingress/$token/x",
            HaIngress.readFrameSrc("\"$origin/api/hassio_ingress/$token/x\"")
        )
        // Không có iframe/ giá trị rác → null (caller dùng TOKEN đã lưu).
        assertNull(HaIngress.readFrameSrc(""))
        assertNull(HaIngress.readFrameSrc("\"\""))
        assertNull(HaIngress.readFrameSrc("null"))
        assertNull(HaIngress.readFrameSrc("\"false\""))
        // Trang khác (không phải ingress) → null, dù là http(s).
        assertNull(HaIngress.readFrameSrc("\"$origin/lovelace/0\""))
    }

    @Test
    fun script_doc_src_iframe_do_ca_shadow_dom() {
        val js = HaIngress.panelFrameSrcScript()
        assertTrue(js.contains("iframe[src*=\"hassio_ingress\"]"))
        assertTrue(js.contains("shadowRoot"))
        assertTrue(js.contains("el.src"))
        // Trả chuỗi rỗng (không phải `false`) khi chưa có iframe → readFrameSrc trả null.
        assertTrue(js.contains("|| \"\""))
    }

    @Test
    fun base_api_native_khi_o_top_level_la_ingress() {
        assertEquals("$origin/api/hassio_ingress/$token", IngressPromote.apiBase(topUrl))
        assertEquals(
            "$origin/api/hassio_ingress/$token",
            IngressPromote.apiBase("$origin/api/hassio_ingress/$token/app/incoming")
        )
        // URL không phải ingress → không suy ra base.
        assertNull(IngressPromote.apiBase("$origin/lovelace/0"))
        assertNull(IngressPromote.apiBase(null))
    }

    @Test
    fun nhan_dien_dung_trang_top_level() {
        assertTrue(IngressPromote.isTopLevelLauncher(topUrl))
        assertFalse("panel của HA không phải top-level ingress", IngressPromote.isTopLevelLauncher("$origin/b39feb53_remote_webview_server"))
        assertFalse(IngressPromote.isTopLevelLauncher("$origin/lovelace/0"))
        assertFalse(IngressPromote.isTopLevelLauncher(null))
    }

    // ─────────────────────────────────────────── 3) kết luận trang top-level

    @Test
    fun trang_top_level_hop_le_thi_ok_top() {
        assertEquals(IngressPromote.Verdict.TOP, IngressPromote.verdict(200, "Dashboard OS"))
        assertEquals(IngressPromote.Verdict.TOP, IngressPromote.verdict(null, "Gọi điện"))
        // Trang chưa có tiêu đề (vẫn đang render) — không kết luận là SPA của HA.
        assertEquals(IngressPromote.Verdict.TOP, IngressPromote.verdict(null, null))
    }

    @Test
    fun top_level_tra_401_403_404_hoac_redirect_thi_fail() {
        assertEquals(IngressPromote.Verdict.FAIL, IngressPromote.verdict(401, null))
        assertEquals(IngressPromote.Verdict.FAIL, IngressPromote.verdict(403, "Dashboard OS"))
        assertEquals(IngressPromote.Verdict.FAIL, IngressPromote.verdict(404, null))
        assertEquals(IngressPromote.Verdict.FAIL, IngressPromote.verdict(500, null))
        // HA chuyển hướng (thường về /auth/login) = phiên không dùng được cho top-level.
        assertEquals(IngressPromote.Verdict.FAIL, IngressPromote.verdict(302, null))
        assertEquals("401", IngressPromote.failReason(401, null))
        assertEquals("401", IngressPromote.failReason(403, null))
        assertEquals("404", IngressPromote.failReason(404, null))
        assertEquals("redirect", IngressPromote.failReason(302, null))
        assertEquals("http500", IngressPromote.failReason(500, null))
    }

    @Test
    fun top_level_tra_spa_cua_ha_thi_fail_ha_spa() {
        assertEquals(IngressPromote.Verdict.FAIL, IngressPromote.verdict(200, "Home Assistant"))
        assertEquals(IngressPromote.Verdict.FAIL, IngressPromote.verdict(200, "Lovelace"))
        assertEquals(IngressPromote.Verdict.FAIL, IngressPromote.verdict(200, "Dashboard - Home Assistant"))
        assertEquals("ha-spa", IngressPromote.failReason(200, "Home Assistant"))
        assertEquals("ha-spa", IngressPromote.failReason(null, "Home Assistant"))
        assertEquals("unknown", IngressPromote.failReason(null, null))
    }

    // ─────────────────────────────────────────── 4) log

    @Test
    fun dong_log_thanh_cong_dung_dinh_dang_yeu_cau() {
        assertEquals("[promote] url=$shortTop ok=top", IngressPromote.logLine(topUrl, IngressPromote.OK_TOP))
        assertEquals(
            "[promote] url=$shortTop ok=top title=Dashboard OS",
            IngressPromote.logLine(topUrl, IngressPromote.OK_TOP, "title=Dashboard OS")
        )
    }

    @Test
    fun dong_log_that_bai_dung_dinh_dang_yeu_cau() {
        // Yêu cầu: `[promote] fail=401 fallback=panel` và `[promote] url=… ok=top|panel|401`.
        assertEquals(
            "[promote] url=$shortTop ok=401 fail=401 fallback=panel",
            IngressPromote.failLine(topUrl, IngressPromote.failReason(401, null))
        )
        val line = IngressPromote.failLine(topUrl, "timeout")
        assertTrue(line.startsWith("[promote] url=$shortTop ok=401 "))
        assertTrue(line.contains("fail=timeout fallback=panel"))
    }

    @Test
    fun dong_log_bo_qua_promote_va_giu_panel() {
        assertEquals(
            "[promote] url=$shortTop ok=panel skip=already",
            IngressPromote.skipLine(topUrl, IngressPromote.Decision.ALREADY)
        )
        assertEquals(
            "[promote] url=$shortTop ok=panel skip=no_session try=3",
            IngressPromote.skipLine(topUrl, IngressPromote.Decision.NO_SESSION, "try=3")
        )
        val start = IngressPromote.startLine(topUrl, "frame")
        assertTrue(start.startsWith("[promote] start url=$shortTop token=frame"))
        assertFalse("dòng start không được dùng ok=", start.contains(" ok="))
    }

    @Test
    fun timeout_va_so_lan_doc_cookie_dung_yeu_cau() {
        assertEquals(3000L, IngressPromote.TOP_TIMEOUT_MS)
        assertTrue(IngressPromote.COOKIE_TRIES >= 2)
        assertTrue(IngressPromote.COOKIE_RETRY_MS * IngressPromote.COOKIE_TRIES <= IngressPromote.TOP_TIMEOUT_MS)
    }
}

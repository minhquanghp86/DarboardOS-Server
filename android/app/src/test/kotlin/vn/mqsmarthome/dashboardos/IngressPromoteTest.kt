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
 *  1. **điều kiện được phép promote** ([IngressPromote.decide] / [IngressPromote.Gate]) — khi đã có phiên, thử lại
 *     tối đa 3 lần cách nhau ≥ 1,5 s; `already` chỉ sau khi thành công;
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
        // Chưa có phiên ⇒ top-level sẽ 401 ⇒ ở lại panel (xem MainActivity.promoteNow / IngressPromote.decide).
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
        // (28/11/2026) GD16 — yêu cầu "thử trong 4 s" và "hẹn giờ 2,5 s".
        assertEquals(4000L, IngressPromote.TOP_TIMEOUT_MS)
        assertEquals(2500L, IngressPromote.PANEL_PROMOTE_DELAY_MS)
        assertTrue(IngressPromote.COOKIE_TRIES >= 2)
        assertTrue(IngressPromote.COOKIE_RETRY_MS * IngressPromote.COOKIE_TRIES <= IngressPromote.TOP_TIMEOUT_MS)
        assertTrue(
            "đọc `src` iframe phải ngắn hơn hạn promote",
            IngressPromote.PROMOTE_TOKEN_READ_MS < IngressPromote.PANEL_PROMOTE_DELAY_MS
        )
    }

    // ─────────────────────────────────────────── 5) (28/11/2026) GD16 — nhận diện trang + dự phòng cuối

    @Test
    fun nhan_dien_html_cua_add_on() {
        assertTrue(IngressPromote.isAddonHtml("<script src=\"/launcher-config.js\"></script>"))
        assertTrue(IngressPromote.isAddonHtml("<title>Dashboard OS</title>"))
        assertTrue(IngressPromote.isAddonHtml("<h1>dashboard os</h1>"))
        assertFalse(IngressPromote.isAddonHtml("<title>Home Assistant</title>"))
        assertFalse(IngressPromote.isAddonHtml(null))
        assertFalse(IngressPromote.isAddonHtml(""))
    }

    @Test
    fun doc_loai_trang_tu_ket_qua_js() {
        assertEquals(IngressPromote.PageKind.ADDON, IngressPromote.pageKind("\"addon\""))
        assertEquals(IngressPromote.PageKind.ADDON, IngressPromote.pageKind("addon"))
        assertEquals(IngressPromote.PageKind.HA, IngressPromote.pageKind("\"ha\""))
        assertEquals(IngressPromote.PageKind.AUTH, IngressPromote.pageKind("\"auth\""))
        assertEquals(IngressPromote.PageKind.UNKNOWN, IngressPromote.pageKind("\"unknown\""))
        assertEquals(IngressPromote.PageKind.UNKNOWN, IngressPromote.pageKind(""))
        assertEquals(IngressPromote.PageKind.UNKNOWN, IngressPromote.pageKind(null))
        // Không dò iframe: JS dò nội dung/tiêu đề (`launcher-config`, `Dashboard OS`, `home-assistant`).
        val js = HaIngress.panelProbeScript()
        assertTrue(js.contains("launcher-config"))
        assertTrue(js.contains("dashboard os"))
        assertTrue(js.contains("home-assistant"))
        assertEquals("addon", HaIngress.readProbe("\"addon\""))
        assertEquals("ha", HaIngress.readProbe("\"ha\""))
        assertEquals("", HaIngress.readProbe("null"))
    }

    @Test
    fun ket_luan_top_level_theo_noi_dung_trang() {
        // HTML của add-on → giữ, dù tiêu đề chưa kịp cập nhật.
        assertEquals(
            IngressPromote.Verdict.TOP,
            IngressPromote.verdict(200, null, "<script src=\"launcher-config.js\"></script>")
        )
        // JS nói `addon` → giữ.
        assertEquals(
            IngressPromote.Verdict.TOP,
            IngressPromote.verdict(200, "Dashboard", null, IngressPromote.PageKind.ADDON)
        )
        // SPA của HA (theo tiêu đề / theo HTML / theo JS) → quay lại panel.
        assertEquals(IngressPromote.Verdict.FAIL, IngressPromote.verdict(200, "Home Assistant", null))
        assertEquals(
            IngressPromote.Verdict.FAIL,
            IngressPromote.verdict(200, null, "<title>Home Assistant</title>")
        )
        assertEquals(
            IngressPromote.Verdict.FAIL,
            IngressPromote.verdict(200, "Dashboard OS", "<html></html>", IngressPromote.PageKind.HA)
        )
        // `/auth` → thất bại (`fail=auth`).
        assertEquals(
            IngressPromote.Verdict.FAIL,
            IngressPromote.verdict(null, null, null, IngressPromote.PageKind.AUTH)
        )
        assertEquals(
            "auth",
            IngressPromote.failReason(null, null, IngressPromote.PageKind.AUTH)
        )
        assertEquals(
            "ha-spa",
            IngressPromote.failReason(200, "x", IngressPromote.PageKind.HA)
        )
        assertEquals("401", IngressPromote.failReason(401, null, IngressPromote.PageKind.UNKNOWN))
        // Trang chưa render xong (không có dấu hiệu gì) → giữ (đúng "không phải SPA HA thì giữ").
        assertEquals(IngressPromote.Verdict.TOP, IngressPromote.verdict(null, null, null))
    }

    @Test
    fun dung_url_du_phong_goc_domain() {
        assertEquals("$origin/launcher-config.html", IngressPromote.rootUrl(origin))
        assertEquals("$origin/launcher-config.html", IngressPromote.rootUrl("$origin/"))
        assertNull(IngressPromote.rootUrl(null))
        assertNull(IngressPromote.rootUrl(""))
        assertNull(IngressPromote.rootUrl("hass.mqsmarthome.io.vn"))
    }

    @Test
    fun promote_duoc_phep_du_chua_doc_duoc_cookie() {
        // Luồng ĐẶT HẸN GIỜ: requireSession=false → vẫn promote (trang tự trả 401 nếu phiên thật sự thiếu).
        assertEquals(
            IngressPromote.Decision.PROMOTE,
            IngressPromote.decide(false, false, topUrl, requireSession = false)
        )
        // Cờ "chỉ một lần" vẫn thắng mọi thứ.
        assertEquals(
            IngressPromote.Decision.ALREADY,
            IngressPromote.decide(true, true, topUrl, requireSession = false)
        )
    }

    @Test
    fun co_thu_lai_toi_da_3_lan_cach_nhau_it_nhat_15s() {
        // (1.2) Thay cờ "chỉ một lần": cổng cho thử lại khi đã có phiên, tối đa 3 lần, cách nhau ≥ 1,5 s.
        var now = 1_000L
        val gate = IngressPromote.Gate(clock = { now })

        assertEquals(IngressPromote.Decision.PROMOTE, gate.decide(true, topUrl))
        assertEquals(1, gate.take())

        // Ngay sau đó (nhịp dò 1 s) → chưa đủ 1,5 s ⇒ WAIT (im lặng, không spam log).
        now += 1_000
        assertEquals(IngressPromote.Decision.WAIT, gate.decide(true, topUrl))
        // Đủ 1,5 s ⇒ được thử lần 2 (thất bại trước đó KHÔNG khoá promote — đúng lỗi đã sửa).
        now += 600
        assertEquals(IngressPromote.Decision.PROMOTE, gate.decide(true, topUrl))
        assertEquals(2, gate.take())

        now += 1_500
        assertEquals(IngressPromote.Decision.PROMOTE, gate.decide(true, topUrl))
        assertEquals(3, gate.take())

        // Hết 3 lượt ⇒ LIMIT (không phải `already`).
        now += 5_000
        assertEquals(IngressPromote.Decision.LIMIT, gate.decide(true, topUrl))
        assertEquals(0, gate.take())
        assertEquals(0, gate.attemptsLeft)

        // Người dùng bấm "Mở Dashboard" ⇒ mở lại quyền thử.
        gate.resetAttempts()
        assertEquals(IngressPromote.Decision.PROMOTE, gate.decide(true, topUrl))
    }

    @Test
    fun skip_already_chi_khi_da_ok_top() {
        // (1.2) Yêu cầu 4: `skip=already` CHỈ khi promote đã thành công trong phiên app này.
        var now = 1_000L
        val gate = IngressPromote.Gate(clock = { now })
        gate.take()                                  // đã thử, THẤT BẠI
        assertFalse("thất bại không được khoá promote", gate.done)
        now += 2_000
        assertEquals(IngressPromote.Decision.PROMOTE, gate.decide(true, topUrl))

        gate.take()
        gate.success()                               // ok=top
        assertTrue(gate.done)
        now += 10_000
        assertEquals(IngressPromote.Decision.ALREADY, gate.decide(true, topUrl))
        assertEquals(IngressPromote.Decision.ALREADY, gate.decide(false, topUrl))

        // Phiên app mới ("Kết nối") → quên cả "đã thành công".
        gate.reset()
        assertFalse(gate.done)
        assertEquals(0, gate.attempts)
        assertEquals(IngressPromote.Decision.PROMOTE, gate.decide(true, topUrl))
    }

    @Test
    fun co_gate_khong_promote_khi_chua_co_phien() {
        // Đúng log thật: promote lúc `session=no` chỉ tốn một lần 401 vô ích rồi bị khoá.
        val gate = IngressPromote.Gate(clock = { 0L })
        assertEquals(IngressPromote.Decision.NO_SESSION, gate.decide(false, topUrl))
        assertEquals(0, gate.attempts)
        assertEquals(IngressPromote.Decision.NO_URL, gate.decide(true, null))
        assertEquals(IngressPromote.Decision.NO_URL, gate.decide(true, "  "))
        // Đường dự phòng (panel hỏng) được thử dù chưa có cookie.
        assertEquals(IngressPromote.Decision.PROMOTE, gate.decide(false, topUrl, requireSession = false))
    }

    @Test
    fun giu_trang_top_level_theo_yeu_cau_3() {
        // (1.2) Giữ khi: URL sau ingress + (nội dung `launcher-config` / `Dashboard OS`, hoặc tiêu đề khác
        // "Home Assistant").
        assertTrue(
            IngressPromote.keepTopLevel(
                200, "Dashboard OS", "<script src=\"launcher-config.js\"></script>",
                IngressPromote.PageKind.ADDON, topUrl
            )
        )
        assertTrue(IngressPromote.keepTopLevel(200, "Gọi điện", null, IngressPromote.PageKind.UNKNOWN, topUrl))
        // 401/SPA HA/`/auth` → KHÔNG giữ (quay lại panel, còn quyền thử lại).
        assertFalse(IngressPromote.keepTopLevel(401, null, null, IngressPromote.PageKind.UNKNOWN, topUrl))
        assertFalse(IngressPromote.keepTopLevel(200, "Home Assistant", null, IngressPromote.PageKind.HA, topUrl))
        assertFalse(
            IngressPromote.keepTopLevel(
                200, "Đăng nhập", null, IngressPromote.PageKind.AUTH, topUrl
            )
        )
        // URL không còn nằm sau ingress (gốc domain / panel HA) → không phải top-level add-on ⇒ không giữ.
        assertFalse(
            IngressPromote.keepTopLevel(
                200, "Dashboard OS", null, IngressPromote.PageKind.ADDON, "$origin/launcher-config.html"
            )
        )
        assertFalse(
            IngressPromote.keepTopLevel(
                200, "Dashboard OS", null, IngressPromote.PageKind.ADDON,
                "$origin" + DashboardTarget.PANEL_PATH
            )
        )
    }

    @Test
    fun so_lan_va_giang_cach_dung_yeu_cau() {
        assertEquals(3, IngressPromote.MAX_PROMOTE_ATTEMPTS)
        assertEquals(1500L, IngressPromote.PROMOTE_RETRY_GAP_MS)
        assertTrue(
            "giãn cách 1,5 s phải dài hơn nhịp dò 1 s (tránh bắn dồn)",
            IngressPromote.PROMOTE_RETRY_GAP_MS > 1000L
        )
    }

    @Test
    fun dong_log_hen_gio_va_du_phong() {
        assertEquals(
            "[promote] arm in=2500ms panel=…/b39feb53_remote_webview_server",
            IngressPromote.armLine("$origin" + DashboardTarget.PANEL_PATH)
        )
        assertEquals("[promote] fire reason=panel_timer session=no", IngressPromote.fireLine("panel_timer", false))
        assertEquals("[promote] fire reason=panel_fail_404 session=yes", IngressPromote.fireLine("panel_fail_404", true))
        assertEquals(
            "[promote] panel_fail reason=404 fallback=ingress",
            IngressPromote.panelFailLine("404", "ingress")
        )
        assertEquals(
            "[promote] fallback=root url=…/launcher-config.html reason=promote_401",
            IngressPromote.rootLine("$origin/launcher-config.html", "promote_401")
        )
    }
}

package vn.mqsmarthome.dashboardos

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * (28/11/2026) GD16 — kiểm tra **LUỒNG PROMOTE MỚI** ở mức quyết định (thuần, chạy trên JVM):
 *
 *  1. **chọn URL promote**: origin → `…/api/hassio_ingress/<TOKEN>/launcher-config.html`, TOKEN ưu tiên `src` iframe
 *     → [Prefs] (mặc định `KJjH…`); dự phòng cuối `https://<domain>/launcher-config.html`;
 *  2. **nhận diện "là add-on" vs "SPA HA"** ([IngressPromote.verdict] / [IngressPromote.isAddonHtml] /
 *     [IngressPromote.pageKind]) — bảng quyết định cho từng kiểu trang;
 *  3. **cổng thử lại** ([IngressPromote.Gate], 1.2) — promote lại được khi đã có phiên và **chưa thành công**,
 *     tối đa 3 lần, cách nhau ≥ 1,5 s; `skip=already` **chỉ** sau `ok=top` (bản 1.1 khoá promote ngay sau lần 401
 *     đầu tiên nên khi phiên xuất hiện app đứng im ở panel — đúng lỗi người dùng báo);
 *  4. thời điểm/timeout: hẹn giờ 2,5 s (chỉ còn là lưới an toàn), chờ tối đa 4 s.
 *
 * Chạy: `cd android && ./gradlew testDebugUnitTest --offline --no-daemon`.
 */
class PromoteFlowTest {

    private val domain = "https://hass.mqsmarthome.io.vn"
    private val panel = "$domain" + DashboardTarget.PANEL_PATH
    private val token = "KJjH_rSB8SdDeyjszvdZnnH1pRlxySfVG5VmgDMVf38"
    private val top = "$domain/api/hassio_ingress/$token/launcher-config.html"

    // ─────────────────────────────────────────── 1) chọn URL promote

    @Test
    fun token_uutien_iframe_roi_prefs_roi_mac_dinh() {
        // `src` iframe do HA vừa cấp → dùng đúng TOKEN đó.
        val frameSrc = "$domain/api/hassio_ingress/TOKEN_MOI_123456/dashboard/x.html"
        val frameToken = IngressPromote.tokenFromUrl(frameSrc)
        assertEquals("TOKEN_MOI_123456", frameToken)
        assertEquals(
            "$domain/api/hassio_ingress/TOKEN_MOI_123456/launcher-config.html",
            IngressPromote.topUrl(domain, frameToken)
        )
        // Không có iframe → TOKEN đã lưu trong Prefs.
        assertEquals(top, IngressPromote.topUrl(domain, token))
        // Prefs rỗng → TOKEN mặc định của add-on.
        assertEquals(
            "$domain/api/hassio_ingress/${WebTargetResolver.DEFAULT_INGRESS_TOKEN}/launcher-config.html",
            IngressPromote.topUrl(domain, WebTargetResolver.sanitizeToken(null))
        )
        assertEquals(
            WebTargetResolver.DEFAULT_INGRESS_TOKEN,
            WebTargetResolver.sanitizeToken("")
        )
    }

    @Test
    fun du_phong_cuoi_la_goc_domain() {
        assertEquals("$domain/launcher-config.html", IngressPromote.rootUrl(domain))
        assertEquals("$domain/launcher-config.html", IngressPromote.rootUrl("$domain/"))
        assertNull(IngressPromote.rootUrl("   "))
        assertNull(IngressPromote.rootUrl("khong-phai-url"))
    }

    @Test
    fun panel_va_top_level_cung_origin() {
        // Thứ tự ứng viên của app: panel của HA đứng đầu (đường duy nhất HA frontend tạo phiên ingress).
        val candidates = DashboardTarget.candidates(saved = null, loginUrl = "$domain/", typed = domain, token = token)
        assertEquals(panel, candidates.first())
        assertEquals(domain, DashboardTarget.originOf(candidates.first()))
        assertEquals(domain, DashboardTarget.originOf(top))
        // Base API native sau khi promote = đúng ingress của add-on.
        assertEquals("$domain/api/hassio_ingress/$token", IngressPromote.apiBase(top))
    }

    // ─────────────────────────────────────────── 2) add-on vs SPA HA

    @Test
    fun bang_ket_luan_trang_top_level() {
        data class Case(
            val status: Int?,
            val title: String?,
            val html: String?,
            val kind: IngressPromote.PageKind,
            val verdict: IngressPromote.Verdict,
            val reason: String,
        )

        val cases = listOf(
            // add-on thật (HTML có launcher-config) → giữ
            Case(200, "Dashboard OS", "<script src=\"launcher-config.js\"></script>",
                IngressPromote.PageKind.ADDON, IngressPromote.Verdict.TOP, "unknown"),
            // tiêu đề riêng + JS nói addon → giữ
            Case(200, "Gọi điện", null,
                IngressPromote.PageKind.ADDON, IngressPromote.Verdict.TOP, "unknown"),
            // SPA của HA (tiêu đề) → quay lại panel
            Case(200, "Home Assistant", null,
                IngressPromote.PageKind.HA, IngressPromote.Verdict.FAIL, "ha-spa"),
            Case(200, "Dashboard - Home Assistant", null,
                IngressPromote.PageKind.UNKNOWN, IngressPromote.Verdict.FAIL, "ha-spa"),
            // SPA của HA (HTML) → quay lại panel
            Case(200, null, "<title>Home Assistant</title>",
                IngressPromote.PageKind.UNKNOWN, IngressPromote.Verdict.FAIL, "ha-spa"),
            // /auth → quay lại panel
            Case(null, null, null,
                IngressPromote.PageKind.AUTH, IngressPromote.Verdict.FAIL, "auth"),
            // 401 (chưa có phiên) / 404 (sai TOKEN) / 302 (HA redirect) → quay lại panel
            Case(401, null, null, IngressPromote.PageKind.UNKNOWN, IngressPromote.Verdict.FAIL, "401"),
            Case(403, null, null, IngressPromote.PageKind.UNKNOWN, IngressPromote.Verdict.FAIL, "401"),
            Case(404, null, null, IngressPromote.PageKind.UNKNOWN, IngressPromote.Verdict.FAIL, "404"),
            Case(302, null, null, IngressPromote.PageKind.UNKNOWN, IngressPromote.Verdict.FAIL, "redirect"),
            // chưa render xong → giữ (không phải SPA HA)
            Case(null, null, null, IngressPromote.PageKind.UNKNOWN, IngressPromote.Verdict.TOP, "unknown"),
        )

        for (c in cases) {
            assertEquals(
                "verdict sai cho $c",
                c.verdict,
                IngressPromote.verdict(c.status, c.title, c.html, c.kind)
            )
            assertEquals(
                "failReason sai cho $c",
                c.reason,
                IngressPromote.failReason(c.status, c.title, c.html, c.kind)
            )
        }
    }

    @Test
    fun html_addon_manh_hon_tieu_de() {
        // Tiêu đề chưa kịp đổi vẫn là "Home Assistant" nhưng nội dung đã là add-on → giữ (HTML là bằng chứng mạnh).
        assertEquals(
            IngressPromote.Verdict.TOP,
            IngressPromote.verdict(200, "Home Assistant", "<div>Dashboard OS</div>", IngressPromote.PageKind.UNKNOWN)
        )
    }

    @Test
    fun js_do_trang_khong_dung_iframe() {
        val js = HaIngress.panelProbeScript()
        // Dò nội dung/tiêu đề, KHÔNG phụ thuộc iframe của panel.
        assertTrue(js.contains("launcher-config"))
        assertTrue(js.contains("dashboard os"))
        assertTrue(js.contains("/auth/"))
        assertFalse("probe không được dò iframe ingress", js.contains("iframe[src"))

        assertEquals("addon", HaIngress.readProbe("\"addon\""))
        assertEquals("ha", HaIngress.readProbe("\"ha\""))
        assertEquals("auth", HaIngress.readProbe("\"auth\""))
        assertEquals("", HaIngress.readProbe("null"))
        assertEquals(IngressPromote.PageKind.ADDON, IngressPromote.pageKind(HaIngress.readProbe("\"addon\"")))
        assertEquals(IngressPromote.PageKind.UNKNOWN, IngressPromote.pageKind(HaIngress.readProbe("null")))
    }

    // ─────────────────────────────────────────── 3) cổng thử lại + thời điểm

    @Test
    fun promote_duoc_thu_lai_khi_co_phien_va_chua_thanh_cong() {
        // (1.2) ĐÚNG LỖI ĐÃ SỬA: promote bắn lúc `session=no` (2,5 s) → 401 → KHÔNG được khoá bằng `already`;
        // khi phiên xuất hiện phải thử lại (tối đa 3 lần, cách nhau ≥ 1,5 s). `already` chỉ sau `ok=top`.
        var now = 0L
        val gate = IngressPromote.Gate(clock = { now })

        // 2,5 s: hẹn giờ nổ nhưng CHƯA có phiên ⇒ không promote (không tốn 401).
        assertEquals(IngressPromote.Decision.NO_SESSION, gate.decide(false, top))

        // 12:58:01 — phiên đã có ⇒ promote ngay (lần 1).
        now = 31_000
        assertEquals(IngressPromote.Decision.PROMOTE, gate.decide(true, top))
        assertEquals(1, gate.take())
        assertFalse(gate.done)

        // Thất bại (401) ở lần 1 ⇒ vẫn còn 2 lượt, KHÔNG `already`.
        now += 1_600
        assertEquals(IngressPromote.Decision.PROMOTE, gate.decide(true, top))
        assertEquals(2, gate.take())

        // Thành công ⇒ từ đây mới là `skip=already`.
        gate.success()
        now += 1_600
        assertEquals(IngressPromote.Decision.ALREADY, gate.decide(true, top))
        assertTrue(gate.done)
    }

    @Test
    fun dong_log_retry_dung_dinh_dang_ky_vong() {
        // Đúng dòng người dùng cần thấy khi promote chạy lại sau khi có phiên.
        assertEquals(
            "[promote] retry=1 url=…/api/hassio_ingress/KJjH…/launcher-config.html",
            IngressPromote.retryLine(1, top)
        )
        assertEquals(
            "[promote] retry=3 url=…/api/hassio_ingress/KJjH…/launcher-config.html token=frame",
            IngressPromote.retryLine(3, top, "token=frame")
        )
        assertEquals("[promote] retry_left=2 wait=1500ms session=yes", IngressPromote.retryLeftLine(2, true))
        assertEquals("[promote] retry_left=0 wait=1500ms session=no", IngressPromote.retryLeftLine(0, false))
        // `already` chỉ có nghĩa "đã ok=top" — dòng skip tương ứng.
        assertEquals(
            "[promote] url=…/b39feb53_remote_webview_server ok=panel skip=already",
            IngressPromote.skipLine(panel, IngressPromote.Decision.ALREADY)
        )
    }

    @Test
    fun thoi_diem_va_timeout_dung_yeu_cau() {
        assertEquals(2500L, IngressPromote.PANEL_PROMOTE_DELAY_MS)
        assertEquals(4000L, IngressPromote.TOP_TIMEOUT_MS)
        assertEquals(IngressPromote.TOP_TIMEOUT_MS, 4000L)
        assertTrue(IngressPromote.PROMOTE_TOKEN_READ_MS < IngressPromote.PANEL_PROMOTE_DELAY_MS)
    }

    @Test
    fun dong_log_bat_dau_va_that_bai_doc_duoc_boi_nguoi_dung() {
        // Đúng các dòng người dùng sẽ thấy trong màn Chẩn đoán.
        assertEquals(
            "[promote] start url=…/api/hassio_ingress/KJjH…/launcher-config.html token=prefs timeout=4000ms",
            IngressPromote.startLine(top, "prefs")
        )
        assertEquals(
            "[promote] url=…/api/hassio_ingress/KJjH…/launcher-config.html ok=401 fail=401 fallback=panel",
            IngressPromote.failLine(top, "401")
        )
        assertTrue(IngressPromote.armLine(panel).startsWith("[promote] arm in=2500ms"))
        assertTrue(IngressPromote.fireLine("panel_timer", false).contains("session=no"))
    }
}

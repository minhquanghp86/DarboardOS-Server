package vn.mqsmarthome.dashboardos

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * (18/11/2026) GD10 — kiểm tra phần THUẦN của luồng "đăng nhập Home Assistant xong thì tự sang dashboard":
 *
 *  1. "đã đăng nhập" **không** dựa vào tên cookie: [`HaLogin.cookieNames`]/[`HaLogin.newCookieNames`] (cookie MỚI
 *     bất kỳ tên), [`HaLogin.leftAuthPage`] (URL rời `/auth/…`), [`HaLogin.isDashboardResponse`]
 *     (200 + body không phải `<title>Home Assistant</title>`),
 *  2. chuỗi biến thể URL chống kẹt 401 ([`HaLogin.dashboardVariants`]): webUrl → `…/<slug>/launcher-config.html`
 *     → `https://<domain>/launcher-config.html` → `http://<host>:18080/launcher-config.html`,
 *  3. máy trạng thái [`HaLogin.Watch`]: 401 hai lần liền (đã có cookie) mới đổi biến thể, 404 đổi ngay, hết biến
 *     thể → GIVE_UP (để MainActivity hiện thông báo + nút "Thử lại"), 401 khi CHƯA có cookie thì chỉ chờ,
 *  4. `localStorage.hassTokens` → access token ([`HaLogin.tokenFromJsValue`]) và kết quả bridge của JS tạo phiên
 *     ingress ([`HaIngress.parseResult`] — xem thêm `HaIngressTest`),
 *  5. dòng log `[login] url=… cookie=… web=…` ([`HaLogin.pollLogLine`]).
 *
 * Chạy: `cd android && ./gradlew testDebugUnitTest --offline --no-daemon`.
 */
class HaLoginTest {

    private val domain = "hass.mqsmarthome.io.vn"
    private val token = WebTargetResolver.DEFAULT_INGRESS_TOKEN
    private val slug = WebTargetResolver.ADDON_SLUG
    private val origin = "https://$domain"
    private val webUrl = "$origin/api/hassio_ingress/$token/${WebTargetResolver.LAUNCHER_PAGE}"

    // ─────────────────────────────────────────── 1) "đã đăng nhập" không dựa tên cookie

    @Test
    fun cookie_bat_ky_ten_nao_cung_tinh_la_co_phien() {
        // Bản cũ chỉ nhận `ingress_session` / `hassio_ingress` → đăng nhập Lovelace không bao giờ khớp.
        assertEquals(setOf("_ga"), HaLogin.cookieNames("_ga=GA1.1.123"))
        assertEquals(setOf("a", "b"), HaLogin.cookieNames(" a=1 ; b=2 ;;"))
        assertTrue(HaLogin.hasAnyCookie("x=1"))
        assertFalse(HaLogin.hasAnyCookie(""))
        assertFalse(HaLogin.hasAnyCookie(null))
        assertTrue(HaLogin.cookieNames(null).isEmpty())
        assertTrue(HaLogin.cookieNames("").isEmpty())
    }

    @Test
    fun cookie_moi_so_voi_luc_bat_dau_la_dau_hieu_dang_nhap() {
        val before = HaLogin.cookieNames("_ga=1")
        val after = HaLogin.cookieNames("_ga=1; ingress_session=abc")
        assertEquals(setOf("ingress_session"), HaLogin.newCookieNames(before, after))
        assertTrue(HaLogin.newCookieNames(before, before).isEmpty())
        // Tên lạ hoàn toàn vẫn được nhận (HA đổi tên cookie giữa các phiên bản).
        assertEquals(setOf("hassio_ingress_v2"), HaLogin.newCookieNames(before, HaLogin.cookieNames("_ga=1; hassio_ingress_v2=z")))
    }

    @Test
    fun url_roi_auth_la_dau_hieu_da_dang_nhap() {
        assertTrue(HaLogin.isAuthPage("$origin/auth/login"))
        assertTrue(HaLogin.isAuthPage("$origin/auth/authorize?response_type=code"))
        assertTrue(HaLogin.isAuthPage("$origin/auth/token"))
        assertFalse(HaLogin.isAuthPage("$origin/lovelace"))
        assertFalse(HaLogin.isAuthPage(null))

        assertFalse("còn ở /auth/login", HaLogin.leftAuthPage("$origin/auth/login", origin))
        assertTrue("đã sang Lovelace", HaLogin.leftAuthPage("$origin/lovelace", origin))
        assertTrue("trang chủ HA", HaLogin.leftAuthPage("$origin/", origin))
        assertTrue("dashboard HA", HaLogin.leftAuthPage("$origin/lovelace/0?edit=1", origin))
        // Domain khác / about:blank → không tính.
        assertFalse(HaLogin.leftAuthPage("https://evil.example/auth/login", origin))
        assertFalse(HaLogin.leftAuthPage("about:blank", origin))
        assertFalse(HaLogin.leftAuthPage("$origin/lovelace", null))
    }

    @Test
    fun chi_200_va_khong_phai_spa_ha_moi_la_da_vao_add_on() {
        val dashboard = "<!doctype html><html><head><title>Dashboard</title></head><body>ok</body></html>"
        assertTrue(HaLogin.isDashboardResponse(200, dashboard))
        // 200 nhưng là SPA của Home Assistant → CHƯA vào add-on (đây là bẫy của `https://<domain>/launcher-config.html`).
        assertFalse(HaLogin.isDashboardResponse(200, "<html><head><title>Home Assistant</title></head></html>"))
        assertFalse(HaLogin.isDashboardResponse(401, dashboard))
        assertFalse(HaLogin.isDashboardResponse(403, dashboard))
        // Body rỗng / null: 200 và không có tiêu đề HA → coi là đã vào add-on.
        assertTrue(HaLogin.isDashboardResponse(200, ""))
        assertTrue(HaLogin.isDashboardResponse(200, null))
    }

    // ─────────────────────────────────────────── 2) biến thể URL chống kẹt 401

    // (26/11/2026) GD14 — panel của add-on trên HA đứng ĐẦU; URL ingress đã lưu chỉ là DỰ PHÒNG.
    @Test
    fun bien_the_url_dung_thu_tu_panel_truoc_roi_ingress() {
        val list = HaLogin.dashboardVariants(webUrl)
        assertEquals(
            listOf(
                "$origin/$slug",
                "$origin/$slug/${WebTargetResolver.LAUNCHER_PAGE}",
                webUrl,
                "$origin/${WebTargetResolver.LAUNCHER_PAGE}",
                "http://$domain:18080/${WebTargetResolver.LAUNCHER_PAGE}"
            ),
            list
        )
        assertEquals(list.size, list.toSet().size)
    }

    @Test
    fun bien_the_url_giu_cong_va_host_cua_url_da_luu() {
        val typed = "https://hass.example.com:8123/api/hassio_ingress/$token/${WebTargetResolver.LAUNCHER_PAGE}"
        val list = HaLogin.dashboardVariants(typed)
        // Panel đứng đầu, vẫn giữ cổng người dùng đã cấu hình.
        assertEquals("https://hass.example.com:8123/$slug", list.first())
        assertTrue(list.contains(typed))
        assertTrue(list.contains("https://hass.example.com:8123/$slug/${WebTargetResolver.LAUNCHER_PAGE}"))
        // Cổng add-on luôn là 18080, host KHÔNG kèm cổng của HA.
        assertTrue(list.contains("http://hass.example.com:18080/${WebTargetResolver.LAUNCHER_PAGE}"))
    }

    @Test
    fun bien_the_url_ip_lan_khong_sinh_dong_rac() {
        val lan = "http://192.168.10.2:18080/${WebTargetResolver.LAUNCHER_PAGE}"
        val list = HaLogin.dashboardVariants(lan)
        // (26/11/2026) GD14 — IP LAN KHÔNG khuyến nghị: vẫn thử HTTPS tự ký (18443) trước, rồi tới http 18080.
        assertEquals("https://192.168.10.2:18443/${WebTargetResolver.LAUNCHER_PAGE}", list.first())
        assertTrue(list.contains(lan))   // không bị nhân đôi thành :18080:18080
        assertTrue(list.contains("http://192.168.10.2:18080/$slug/${WebTargetResolver.LAUNCHER_PAGE}"))
        assertFalse(list.any { it.contains(":18080:18080") })
        assertFalse("IP LAN không dùng panel của HA", list.any { it == "http://192.168.10.2:18080/$slug" })
        assertTrue("URL không phải http(s)", HaLogin.dashboardVariants("ftp://x/y").isEmpty())
        assertTrue(HaLogin.dashboardVariants(null).isEmpty())
    }

    // ─────────────────────────────────────────── 3) máy trạng thái Watch

    @Test
    fun watch_200_khong_phai_spa_ha_thi_di_thang_vao_dashboard() {
        val w = HaLogin.Watch(webUrl)
        // Biến thể đầu tiên là PANEL (GD14) — 200 + trang add-on thật ⇒ điều hướng ngay tới đó.
        assertEquals("$origin/$slug", w.current)
        val step = w.onProbe(200, dashboard = true, cookiePresent = true)
        assertEquals(HaLogin.Action.NAVIGATE, step.action)
        assertEquals("$origin/$slug", step.url)
        assertFalse(w.gaveUp)
    }

    // (26/11/2026) GD14 — PANEL của add-on: HA trả SPA của CHÍNH NÓ (200, `<title>Home Assistant</title>`) rồi mới
    // nhúng add-on vào iframe ⇒ 200 là ĐÚNG đích, KHÔNG được coi là "SPA sai chỗ".
    @Test
    fun watch_panel_200_la_dung_dich_du_body_la_spa_ha() {
        val w = HaLogin.Watch(webUrl)
        val step = w.onProbe(200, dashboard = false, cookiePresent = true)
        assertEquals(HaLogin.Action.NAVIGATE, step.action)
        assertEquals("$origin/$slug", step.url)
        // Chuyển hướng của HA (302 → /auth/login) cũng là đúng đích: WebView tự xử lý.
        val w2 = HaLogin.Watch(webUrl)
        assertEquals(HaLogin.Action.NAVIGATE, w2.onProbe(302, dashboard = false, cookiePresent = false).action)
        // Panel không tồn tại (404) → thử ứng viên kế tiếp.
        val w3 = HaLogin.Watch(webUrl)
        val next = w3.onProbe(404, dashboard = false, cookiePresent = true)
        assertEquals(HaLogin.Action.NEXT_VARIANT, next.action)
        assertEquals("$origin/$slug/${WebTargetResolver.LAUNCHER_PAGE}", next.url)
    }

    @Test
    fun watch_401_khi_chua_co_cookie_thi_chi_cho_khong_dem_loi() {
        val w = HaLogin.Watch(webUrl)
        repeat(5) {
            val step = w.onProbe(401, dashboard = false, cookiePresent = false)
            assertEquals(HaLogin.Action.WAIT, step.action)
        }
        assertEquals("vẫn ở biến thể đầu (panel)", "$origin/$slug", w.current)
        assertEquals(0, w.failStreak)
        assertFalse(w.gaveUp)
        // Panel: đã có cookie mà vẫn 401 → mở panel (HA sẽ hiện form đăng nhập nếu phiên hỏng).
        assertEquals(HaLogin.Action.NAVIGATE, w.onProbe(401, false, cookiePresent = true).action)
    }

    @Test
    fun watch_401_hai_lan_lien_tiep_du_co_cookie_moi_doi_bien_the() {
        // Bỏ qua 2 biến thể panel (đã có luật riêng ở trên) để kiểm tra luật 401 của các biến thể DỰ PHÒNG.
        val w = HaLogin.Watch(webUrl)
        w.skip()
        w.skip()
        assertEquals(webUrl, w.current)
        assertEquals(HaLogin.Action.WAIT, w.onProbe(401, false, cookiePresent = true).action)
        val step = w.onProbe(401, false, cookiePresent = true)
        assertEquals(HaLogin.Action.NEXT_VARIANT, step.action)
        assertEquals("$origin/${WebTargetResolver.LAUNCHER_PAGE}", step.url)
        assertEquals(0, w.failStreak)
    }

    @Test
    fun watch_200_nhung_la_spa_cua_ha_thi_khong_dieu_huong() {
        // Với biến thể KHÔNG phải panel (vd `https://<domain>/launcher-config.html`), 200 + `<title>Home Assistant</title>`
        // = SAI chỗ → biến thể kế tiếp (không bao giờ nạp Lovelace vào WebView).
        val w = HaLogin.Watch(webUrl)
        repeat(3) { w.skip() }                    // panel → panel/launcher → ingresURL → gốc domain
        assertEquals("$origin/${WebTargetResolver.LAUNCHER_PAGE}", w.current)
        val step = w.onProbe(200, dashboard = false, cookiePresent = true)
        assertNotEquals(HaLogin.Action.NAVIGATE, step.action)
        assertEquals(HaLogin.Action.NEXT_VARIANT, step.action)
        assertEquals("http://$domain:18080/${WebTargetResolver.LAUNCHER_PAGE}", step.url)
        assertEquals(1, w.probes)
        assertFalse(w.gaveUp)
    }

    @Test
    fun watch_3xx_doi_bien_the_ngay() {
        // Panel: 3xx = HA chuyển sang /auth/login ⇒ ĐÚNG đích (WebView tự xử), đã kiểm ở test panel.
        // Biến thể dự phòng: 3xx = đi đâu đó khác ⇒ biến thể kế tiếp ngay.
        val w = HaLogin.Watch(webUrl)
        repeat(3) { w.skip() }
        val step = w.onProbe(302, dashboard = false, cookiePresent = true)
        assertEquals(HaLogin.Action.NEXT_VARIANT, step.action)
        assertEquals("http://$domain:18080/${WebTargetResolver.LAUNCHER_PAGE}", step.url)
    }

    @Test
    fun cung_origin_dung_de_bi_et_co_doc_duoc_localstorage_hay_khong() {
        assertTrue(HaLogin.isSameOrigin("$origin/lovelace", origin))
        assertTrue(HaLogin.isSameOrigin("$origin", origin))
        assertTrue(HaLogin.isSameOrigin("$origin/manifest.json", "$origin/"))
        assertFalse(HaLogin.isSameOrigin("https://other.example/x", origin))
        assertFalse(HaLogin.isSameOrigin("about:blank", origin))
        assertFalse(HaLogin.isSameOrigin(null, origin))
        assertFalse("không được coi hass.example.evil là cùng origin",
            HaLogin.isSameOrigin("https://hass.example.evil/x", origin))
    }

    @Test
    fun watch_404_doi_bien_the_ngay() {
        val w = HaLogin.Watch(webUrl)
        repeat(3) { w.skip() }
        val step = w.onProbe(404, dashboard = false, cookiePresent = true)
        assertEquals(HaLogin.Action.NEXT_VARIANT, step.action)
        assertEquals("http://$domain:18080/${WebTargetResolver.LAUNCHER_PAGE}", step.url)
    }

    @Test
    fun watch_het_bien_the_thi_give_up_roi_reset_duoc() {
        val w = HaLogin.Watch(webUrl)
        // 404 ở MỌI biến thể (panel không tồn tại, ingress sai TOKEN, không có trang nào) → đi hết danh sách rồi GIVE_UP.
        var last = HaLogin.Step(HaLogin.Action.WAIT, null)
        repeat(6) { last = w.onProbe(404, false, cookiePresent = true) }
        assertEquals(HaLogin.Action.GIVE_UP, last.action)
        assertTrue(w.gaveUp)

        w.reset()
        assertFalse(w.gaveUp)
        assertEquals("$origin/$slug", w.current)
        assertEquals(0, w.failStreak)
        assertEquals(HaLogin.Action.NAVIGATE, w.onProbe(200, true, true).action)
    }

    @Test
    fun watch_khong_co_url_nao_dung_duoc_thi_give_up_ngay() {
        val w = HaLogin.Watch(null)
        assertTrue(w.variants.isEmpty())
        assertEquals(HaLogin.Action.GIVE_UP, w.onProbe(200, true, true).action)
        assertTrue(w.gaveUp)
    }

    @Test
    fun watch_loi_mang_va_5xx_chi_cho() {
        val w = HaLogin.Watch(webUrl)
        assertEquals(HaLogin.Action.WAIT, w.onProbe(null, false, true).action)
        assertEquals(HaLogin.Action.WAIT, w.onProbe(502, false, true).action)
        assertEquals("$origin/$slug", w.current)
    }

    // ─────────────────────────────────────────── 4) token HA + phiên ingress

    @Test
    fun doc_access_token_tu_gia_tri_evaluate_javascript() {
        val jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc-_123"
        assertEquals(jwt, HaLogin.tokenFromJsValue("\"$jwt\""))
        assertNull(HaLogin.tokenFromJsValue(""))
        assertNull(HaLogin.tokenFromJsValue("\"\""))
        assertNull(HaLogin.tokenFromJsValue("null"))
        assertNull(HaLogin.tokenFromJsValue("undefined"))
        assertNull("chuỗi rác có khoảng trắng", HaLogin.tokenFromJsValue("\"khong phai token\""))
        assertNull("quá ngắn", HaLogin.tokenFromJsValue("\"abc\""))
    }

    @Test
    fun parse_session_va_duong_dan_tao_phien_ingress() {
        // (20/11/2026) GD12 — kết quả bridge giờ là JSON nhiều trường do JS phát ra; `session` vẫn phải đọc được.
        val r = HaIngress.parseResult(
            "{\"step\":\"session\",\"ok\":true,\"session\":\"s3cr3t-token_1\",\"how\":\"hass\",\"cookie\":true}"
        )
        assertEquals("s3cr3t-token_1", r?.session)
        assertTrue(r!!.sessionReady)
        assertNull(HaIngress.parseResult("{\"step\":\"session\",\"ok\":false,\"detail\":\"auth_invalid\"}")?.session)
        assertNull(HaIngress.parseResult(null))
        assertNull(HaIngress.parseResult("khong-phai-json"))
    }

    // ─────────────────────────────────────────── 5) log chẩn đoán

    @Test
    fun dong_log_dung_dinh_dang_yeu_cau() {
        assertEquals(
            "[login] url=$origin/ cookie=yes web=401",
            HaLogin.pollLogLine("$origin/", cookiePresent = true, status = 401)
        )
        assertEquals(
            "[login] url=$origin/auth/login cookie=no web=-",
            HaLogin.pollLogLine("$origin/auth/login", cookiePresent = false, status = null)
        )
        assertEquals(
            "[login] url=- cookie=no web=200 left_auth=true",
            HaLogin.pollLogLine(null, cookiePresent = false, status = 200, extra = "left_auth=true")
        )
    }
}

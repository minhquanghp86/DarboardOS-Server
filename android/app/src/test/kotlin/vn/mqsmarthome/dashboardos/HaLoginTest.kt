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

    @Test
    fun bien_the_url_dung_thu_tu_va_khong_trung() {
        val list = HaLogin.dashboardVariants(webUrl)
        assertEquals(
            listOf(
                webUrl,
                "$origin/$slug/${WebTargetResolver.LAUNCHER_PAGE}",
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
        assertEquals(typed, list.first())
        assertTrue(list.contains("https://hass.example.com:8123/$slug/${WebTargetResolver.LAUNCHER_PAGE}"))
        // Cổng add-on luôn là 18080, host KHÔNG kèm cổng của HA.
        assertTrue(list.contains("http://hass.example.com:18080/${WebTargetResolver.LAUNCHER_PAGE}"))
    }

    @Test
    fun bien_the_url_ip_lan_khong_sinh_dong_rac() {
        val lan = "http://192.168.10.2:18080/${WebTargetResolver.LAUNCHER_PAGE}"
        val list = HaLogin.dashboardVariants(lan)
        assertEquals(lan, list.first())
        assertTrue(list.contains("http://192.168.10.2:18080/$slug/${WebTargetResolver.LAUNCHER_PAGE}"))
        assertTrue(list.contains(lan))   // không bị nhân đôi thành :18080:18080
        assertFalse(list.any { it.contains(":18080:18080") })
        assertTrue("URL không phải http(s)", HaLogin.dashboardVariants("ftp://x/y").isEmpty())
        assertTrue(HaLogin.dashboardVariants(null).isEmpty())
    }

    // ─────────────────────────────────────────── 3) máy trạng thái Watch

    @Test
    fun watch_200_khong_phai_spa_ha_thi_di_thang_vao_dashboard() {
        val w = HaLogin.Watch(webUrl)
        val step = w.onProbe(200, dashboard = true, cookiePresent = true)
        assertEquals(HaLogin.Action.NAVIGATE, step.action)
        assertEquals(webUrl, step.url)
        assertFalse(w.gaveUp)
    }

    @Test
    fun watch_401_khi_chua_co_cookie_thi_chi_cho_khong_dem_loi() {
        val w = HaLogin.Watch(webUrl)
        repeat(5) {
            val step = w.onProbe(401, dashboard = false, cookiePresent = false)
            assertEquals(HaLogin.Action.WAIT, step.action)
        }
        assertEquals("vẫn ở biến thể đầu", webUrl, w.current)
        assertEquals(0, w.failStreak)
        assertFalse(w.gaveUp)
    }

    @Test
    fun watch_401_hai_lan_lien_tiep_du_co_cookie_moi_doi_bien_the() {
        val w = HaLogin.Watch(webUrl)
        assertEquals(HaLogin.Action.WAIT, w.onProbe(401, false, cookiePresent = true).action)
        val step = w.onProbe(401, false, cookiePresent = true)
        assertEquals(HaLogin.Action.NEXT_VARIANT, step.action)
        assertEquals("$origin/$slug/${WebTargetResolver.LAUNCHER_PAGE}", step.url)
        assertEquals(0, w.failStreak)
        // Biến thể mới trả 200 → điều hướng tới CHÍNH biến thể đó.
        val ok = w.onProbe(200, dashboard = true, cookiePresent = true)
        assertEquals(HaLogin.Action.NAVIGATE, ok.action)
        assertEquals("$origin/$slug/${WebTargetResolver.LAUNCHER_PAGE}", ok.url)
    }

    @Test
    fun watch_200_nhung_la_spa_cua_ha_thi_khong_dieu_huong() {
        val w = HaLogin.Watch(webUrl)
        // probeWeb trả 200 + body `<title>Home Assistant</title>` → MainActivity truyền dashboard = false.
        val step = w.onProbe(200, dashboard = false, cookiePresent = true)
        assertNotEquals(HaLogin.Action.NAVIGATE, step.action)
        // 200 mà là SPA của HA = SAI chỗ → biến thể kế tiếp (không bao giờ nạp Lovelace vào WebView).
        assertEquals(HaLogin.Action.NEXT_VARIANT, step.action)
        assertEquals("$origin/$slug/${WebTargetResolver.LAUNCHER_PAGE}", step.url)
        assertEquals(1, w.probes)
        assertFalse(w.gaveUp)
    }

    @Test
    fun watch_3xx_doi_bien_the_ngay() {
        val w = HaLogin.Watch(webUrl)
        val step = w.onProbe(302, dashboard = false, cookiePresent = true)
        assertEquals(HaLogin.Action.NEXT_VARIANT, step.action)
        assertEquals("$origin/$slug/${WebTargetResolver.LAUNCHER_PAGE}", step.url)
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
        val step = w.onProbe(404, dashboard = false, cookiePresent = true)
        assertEquals(HaLogin.Action.NEXT_VARIANT, step.action)
        assertEquals("$origin/$slug/${WebTargetResolver.LAUNCHER_PAGE}", step.url)
    }

    @Test
    fun watch_het_bien_the_thi_give_up_roi_reset_duoc() {
        val w = HaLogin.Watch(webUrl)
        var last = HaLogin.Step(HaLogin.Action.WAIT, null)
        // 4 biến thể × 2 lần 401 liên tiếp.
        repeat(8) { last = w.onProbe(401, false, cookiePresent = true) }
        assertEquals(HaLogin.Action.GIVE_UP, last.action)
        assertTrue(w.gaveUp)

        w.reset()
        assertFalse(w.gaveUp)
        assertEquals(webUrl, w.current)
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
        assertEquals(webUrl, w.current)
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

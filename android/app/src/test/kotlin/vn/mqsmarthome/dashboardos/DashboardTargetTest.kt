package vn.mqsmarthome.dashboardos

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * (19/11/2026) GD11 — kiểm tra phần THUẦN của luồng "luôn nhắm trang add-on, không bao giờ nạp origin của HA":
 *
 *  1. nhận dạng URL: [DashboardTarget.isOriginOnly] / [DashboardTarget.hasLauncherPage] /
 *     [DashboardTarget.isValidSaved] — `https://<domain>/` KHÔNG dùng được, `…/launcher-config.html` thì được;
 *  2. dựng lại ứng viên từ TOKEN khi `webUrl` trống/hỏng ([DashboardTarget.candidates]): ingress → `<slug>` →
 *     gốc domain → cổng 18080, và **không có origin** trong danh sách;
 *  3. `HaLogin.dashboardVariants` / `HaLogin.Watch` không bao giờ chứa origin (chống "refresh rồi lại Lovelace");
 *  4. xác thực trang vừa nạp ([DashboardTarget.arrival]) + bỏ biến thể sai ([HaLogin.Watch.skip]);
 *  5. URL rút gọn cho thanh thông báo ([DashboardTarget.shortUrl]) và dòng log
 *     `[login] saved=… loading=… result=…` ([HaLogin.progressLine]).
 *
 * Chạy: `cd android && ./gradlew testDebugUnitTest --offline --no-daemon`.
 */
class DashboardTargetTest {

    private val domain = "hass.mqsmarthome.io.vn"
    private val token = WebTargetResolver.DEFAULT_INGRESS_TOKEN
    private val slug = WebTargetResolver.ADDON_SLUG
    private val origin = "https://$domain"
    private val launcher = WebTargetResolver.LAUNCHER_PAGE
    private val webUrl = "$origin/api/hassio_ingress/$token/$launcher"

    // ─────────────────────────────────────────── 1) nhận dạng URL

    @Test
    fun origin_khong_bao_gio_la_web_url_dung_duoc() {
        // Đây là giá trị gây lỗi "refresh rồi lại vào Lovelace": nạp origin = Lovelace của HA đã đăng nhập.
        assertTrue(DashboardTarget.isOriginOnly("$origin/"))
        assertTrue(DashboardTarget.isOriginOnly(origin))
        assertFalse(DashboardTarget.isValidSaved("$origin/"))
        assertFalse(DashboardTarget.isValidSaved(origin))
        assertFalse("URL đăng nhập của HA", DashboardTarget.isValidSaved("$origin/auth/login"))
        assertFalse("Lovelace", DashboardTarget.isValidSaved("$origin/lovelace/0"))
        assertFalse("about:blank", DashboardTarget.isValidSaved("about:blank"))
        assertFalse(DashboardTarget.isValidSaved(null))
        assertFalse(DashboardTarget.isValidSaved(""))
    }

    @Test
    fun trang_dieu_khien_add_on_la_web_url_dung_duoc() {
        assertTrue(DashboardTarget.isValidSaved(webUrl))
        assertTrue(DashboardTarget.isValidSaved("$origin/$slug/$launcher"))
        assertTrue(DashboardTarget.isValidSaved("$origin/$launcher"))
        assertTrue(DashboardTarget.isValidSaved("http://192.168.10.2:18080/$launcher"))
        assertTrue(DashboardTarget.hasLauncherPage(webUrl))
        assertFalse(DashboardTarget.isOriginOnly(webUrl))
    }

    @Test
    fun origin_lay_duoc_tu_url_day_du_hoac_tu_chuoi_nguoi_dung_go() {
        assertEquals(origin, DashboardTarget.originOf(webUrl))
        assertEquals(origin, DashboardTarget.originOf("$origin/"))
        assertEquals(origin, DashboardTarget.originOf(domain))
        assertEquals("https://hass.example.com:8123", DashboardTarget.originOf("hass.example.com:8123"))
        assertEquals("http://192.168.10.2:18080", DashboardTarget.originOf("192.168.10.2:18080"))
        assertEquals(null, DashboardTarget.originOf("ftp://x/y"))
        assertEquals(null, DashboardTarget.originOf(null))
    }

    // ─────────────────────────────────────────── 2) dựng lại ứng viên từ TOKEN

    @Test
    fun web_url_hong_duoc_dung_lai_tu_token_va_khong_co_origin() {
        val list = DashboardTarget.candidates(saved = "$origin/", token = token)
        assertEquals(
            listOf(
                "$origin/api/hassio_ingress/$token/$launcher",
                "$origin/$slug/$launcher",
                "$origin/$launcher",
                "http://$domain:18080/$launcher"
            ),
            list
        )
        assertFalse("không bao giờ có origin trong danh sách", list.contains("$origin/"))
    }

    @Test
    fun web_url_trong_thi_dung_lai_tu_domain_nguoi_dung_go() {
        // Nút "Tôi đã đăng nhập" khi chưa có webUrl: vẫn phải nhắm add-on, dựa vào chuỗi người dùng đã gõ.
        val list = DashboardTarget.candidates(saved = null, typed = domain, token = token)
        assertEquals("$origin/api/hassio_ingress/$token/$launcher", list.first())
        assertTrue(list.contains("$origin/$slug/$launcher"))
        assertTrue(list.contains("$origin/$launcher"))
        assertTrue(DashboardTarget.candidates(saved = null, typed = null, token = token).isEmpty())
    }

    @Test
    fun web_url_hop_le_thi_duoc_uu_tien_dau_tien() {
        val list = DashboardTarget.candidates(saved = webUrl, typed = domain, token = token)
        assertEquals(webUrl, list.first())
        assertEquals("không nhân đôi biến thể ingress", 4, list.size)
        // Origin của HA (loginUrl) chỉ dùng khi webUrl KHÔNG có.
        val fromLogin = DashboardTarget.candidates(
            saved = null,
            loginUrl = "$origin/",
            token = token
        )
        assertEquals("$origin/api/hassio_ingress/$token/$launcher", fromLogin.first())
    }

    // ─────────────────────────────────────────── 3) Watch không bao giờ chứa origin

    @Test
    fun watch_dung_lai_tu_token_khi_web_url_la_origin() {
        val w = HaLogin.Watch("$origin/", token = token)
        assertEquals("$origin/api/hassio_ingress/$token/$launcher", w.current)
        assertFalse("origin KHÔNG được là biến thể", w.variants.contains("$origin/"))
        assertFalse(w.variants.contains(origin))
        assertEquals(
            listOf(
                "$origin/api/hassio_ingress/$token/$launcher",
                "$origin/$slug/$launcher",
                "$origin/$launcher",
                "http://$domain:18080/$launcher"
            ),
            w.variants
        )
    }

    @Test
    fun watch_dung_lai_tu_chuoi_nguoi_dung_go_khi_chua_co_web_url() {
        val w = HaLogin.Watch(null, token = token, fallbackInput = domain)
        assertEquals("$origin/api/hassio_ingress/$token/$launcher", w.current)
        // Không có gì để dựng (webUrl + chuỗi gõ đều rỗng) → không biến thể, GIVE_UP ngay.
        assertTrue(HaLogin.Watch(null, token = token).variants.isEmpty())
    }

    @Test
    fun dashboard_variants_van_giu_web_url_hop_le_dau_tien() {
        val list = HaLogin.dashboardVariants(webUrl, token = token)
        assertEquals(webUrl, list.first())
        assertEquals(4, list.size)
        assertEquals(list.size, list.toSet().size)
    }

    // ─────────────────────────────────────────── 4) xác thực trang vừa nạp

    @Test
    fun trang_add_on_la_ok_trang_ha_thi_khong() {
        // Trang điều khiển của add-on (title "Dashboard").
        assertEquals(DashboardTarget.Arrival.ADDON, DashboardTarget.arrival(webUrl, "Dashboard"))
        assertEquals(DashboardTarget.Arrival.ADDON, DashboardTarget.arrival(webUrl, null))
        assertEquals(DashboardTarget.Arrival.ADDON, DashboardTarget.arrival("http://192.168.10.2:18080/$launcher", "Dashboard"))

        // SPA của Home Assistant: tiêu đề "Home Assistant" / Lovelace, hoặc URL ngoài ingress.
        assertEquals(
            DashboardTarget.Arrival.HOME_ASSISTANT,
            DashboardTarget.arrival("$origin/lovelace/0", "Home Assistant")
        )
        assertEquals(
            "tiêu đề HA trên URL lạ",
            DashboardTarget.Arrival.HOME_ASSISTANT,
            DashboardTarget.arrival("$origin/$launcher", "Home Assistant")
        )
        assertEquals(
            DashboardTarget.Arrival.HOME_ASSISTANT,
            DashboardTarget.arrival("$origin/", "Bambu - Home Assistant")
        )
        assertEquals(
            "Lovelace không có tiêu đề HA nhưng nằm ngoài ingress",
            DashboardTarget.Arrival.OFF_INGRESS,
            DashboardTarget.arrival("$origin/lovelace/bambu", "Bambu")
        )
        assertEquals(
            DashboardTarget.Arrival.OFF_INGRESS,
            DashboardTarget.arrival("$origin/manifest.json", null)
        )
        assertEquals(DashboardTarget.Arrival.OTHER, DashboardTarget.arrival("about:blank", null))
        assertEquals(DashboardTarget.Arrival.OTHER, DashboardTarget.arrival(null, null))
        // Trang con bên trong ingress (panel của add-on) — không kết luận.
        assertEquals(
            DashboardTarget.Arrival.OTHER,
            DashboardTarget.arrival("$origin/api/hassio_ingress/$token/photos.html", "Ảnh")
        )
    }

    @Test
    fun tieu_de_trang_ha_duoc_nhan_dien() {
        assertTrue(DashboardTarget.looksLikeHomeAssistant("Home Assistant"))
        assertTrue(DashboardTarget.looksLikeHomeAssistant("  home assistant "))
        assertTrue(DashboardTarget.looksLikeHomeAssistant("Bambu - Home Assistant"))
        assertTrue(DashboardTarget.looksLikeHomeAssistant("Lovelace"))
        assertFalse(DashboardTarget.looksLikeHomeAssistant("Dashboard"))
        assertFalse(DashboardTarget.looksLikeHomeAssistant("Gọi"))
        assertFalse(DashboardTarget.looksLikeHomeAssistant(null))
        assertFalse(DashboardTarget.looksLikeHomeAssistant(""))
    }

    @Test
    fun watch_bo_bien_the_ngay_khi_trang_khong_phai_add_on() {
        val w = HaLogin.Watch(webUrl, token = token)
        val step = w.skip()
        assertEquals(HaLogin.Action.NEXT_VARIANT, step.action)
        assertEquals("$origin/$slug/$launcher", step.url)
        assertEquals(1, w.index)
        // Bỏ hết biến thể → GIVE_UP (MainActivity hiện thông báo + nút "Thử lại").
        repeat(3) { w.skip() }
        assertTrue(w.gaveUp)
        assertEquals(HaLogin.Action.GIVE_UP, w.skip().action)
    }

    // ─────────────────────────────────────────── 5) chẩn đoán: URL rút gọn + dòng log

    @Test
    fun url_rut_gon_cho_thanh_thong_bao() {
        assertEquals(
            "…/api/hassio_ingress/KJjH…/$launcher",
            DashboardTarget.shortUrl(webUrl)
        )
        assertEquals("…/$slug/$launcher", DashboardTarget.shortUrl("$origin/$slug/$launcher"))
        assertEquals("…/", DashboardTarget.shortUrl("$origin/"))
        assertEquals("-", DashboardTarget.shortUrl(null))
        assertEquals("-", DashboardTarget.shortUrl(""))
        // URL LAN (không có ingress) vẫn rút gọn được.
        assertEquals(
            "…/$launcher",
            DashboardTarget.shortUrl("http://192.168.10.2:18080/$launcher")
        )
    }

    @Test
    fun dong_log_saved_loading_result() {
        assertEquals(
            "[login] saved=…/api/hassio_ingress/KJjH…/$launcher " +
                "loading=…/api/hassio_ingress/KJjH…/$launcher result=ok",
            HaLogin.progressLine(webUrl, webUrl, "ok")
        )
        assertEquals(
            "[login] saved=- loading=…/ result=pending (confirmed)",
            HaLogin.progressLine(null, "$origin/", "pending", "(confirmed)")
        )
        assertEquals("[login] saved=- loading=- result=-", HaLogin.progressLine(null, null, " "))
    }
}

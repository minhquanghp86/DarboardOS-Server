package vn.mqsmarthome.dashboardos

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * (19/11/2026) GD11 — kiểm tra phần THUẦN của luồng "luôn nhắm đúng đích, không bao giờ nạp origin của HA".
 * (26/11/2026) GD14 — ĐÍCH nay là **panel của add-on trên Home Assistant**
 * (`https://<domain>/b39feb53_remote_webview_server`): chính HA frontend dựng panel, tạo phiên ingress rồi nhúng
 * add-on vào iframe. Vì vậy:
 *
 *  1. nhận dạng URL: [DashboardTarget.isOriginOnly] / [DashboardTarget.hasLauncherPage] /
 *     [DashboardTarget.isPanel] / [DashboardTarget.isValidSaved];
 *  2. thứ tự ứng viên: panel → panel/launcher-config.html → (webUrl hợp lệ) → ingress (dự phòng) → gốc domain →
 *     cổng 18080 ([DashboardTarget.candidates], [HaLogin.dashboardVariants]);
 *  3. xác thực "đã vào đúng": [DashboardTarget.arrival] — URL panel, hoặc trang có `<iframe … hassio_ingress>`;
 *     **SPA HA thuần KHÔNG phải thành công** (kể cả khi URL là panel nhưng tiêu đề là `<title>Home Assistant</title>`
 *     trần);
 *  4. log chuẩn `[nav] url=… ok=panel|ha-spa|login|401` ([DashboardTarget.navLine]) + URL rút gọn ([shortUrl]).
 *
 * Chạy: `cd android && ./gradlew testDebugUnitTest --offline --no-daemon`.
 */
class DashboardTargetTest {

    private val domain = "hass.mqsmarthome.io.vn"
    private val token = WebTargetResolver.DEFAULT_INGRESS_TOKEN
    private val slug = WebTargetResolver.ADDON_SLUG
    private val origin = "https://$domain"
    private val panel = "$origin/$slug"
    private val launcher = WebTargetResolver.LAUNCHER_PAGE
    private val ingressUrl = "$origin/api/hassio_ingress/$token/$launcher"

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
    fun panel_va_trang_dieu_khien_deu_la_dich_dung_duoc() {
        // (26/11/2026) GD14 — panel của add-on trên HA là đích CHÍNH.
        assertTrue(DashboardTarget.isPanel(panel))
        assertTrue(DashboardTarget.isValidSaved(panel))
        assertTrue(DashboardTarget.isPanel("$panel/$launcher"))
        assertFalse("không phải panel", DashboardTarget.isPanel("$origin/lovelace/0"))
        assertEquals(panel, DashboardTarget.panelUrl(origin))
        assertEquals(panel, DashboardTarget.panelUrl("$origin/"))
        assertEquals(null, DashboardTarget.panelUrl(null))

        assertTrue(DashboardTarget.isValidSaved(ingressUrl))
        assertTrue(DashboardTarget.isValidSaved("$origin/$launcher"))
        assertTrue(DashboardTarget.isValidSaved("http://192.168.10.2:18080/$launcher"))
        assertTrue(DashboardTarget.hasLauncherPage(ingressUrl))
        assertFalse(DashboardTarget.isOriginOnly(ingressUrl))
    }

    @Test
    fun origin_lay_duoc_tu_url_day_du_hoac_tu_chuoi_nguoi_dung_go() {
        assertEquals(origin, DashboardTarget.originOf(panel))
        assertEquals(origin, DashboardTarget.originOf(ingressUrl))
        assertEquals(origin, DashboardTarget.originOf("$origin/"))
        assertEquals(origin, DashboardTarget.originOf(domain))
        assertEquals("https://hass.example.com:8123", DashboardTarget.originOf("hass.example.com:8123"))
        assertEquals("http://192.168.10.2:18080", DashboardTarget.originOf("192.168.10.2:18080"))
        assertEquals(null, DashboardTarget.originOf("ftp://x/y"))
        assertEquals(null, DashboardTarget.originOf(null))
    }

    // ─────────────────────────────────────────── 2) thứ tự ứng viên: panel trước

    @Test
    fun ung_vien_dau_tien_la_panel_roi_moi_toi_ingress_du_phong() {
        val list = DashboardTarget.candidates(saved = null, typed = domain, token = token)
        assertEquals(
            listOf(
                panel,                                    // (1) panel của add-on trên HA
                "$panel/$launcher",                       // (2) cùng panel, trỏ trang điều khiển
                ingressUrl,                               // (3) ingress — DỰ PHÒNG
                "$origin/$launcher",                      // (4) add-on ở gốc domain
                "http://$domain:18080/$launcher"          // (5) add-on mở thẳng cổng 18080
            ),
            list
        )
        assertFalse("không bao giờ có origin trong danh sách", list.contains("$origin/"))
    }

    @Test
    fun web_url_hong_duoc_dung_lai_tu_token_va_khong_co_origin() {
        val list = DashboardTarget.candidates(saved = "$origin/", token = token)
        assertEquals(panel, list.first())
        assertEquals(ingressUrl, list[2])
        assertEquals(5, list.size)
        assertFalse("không bao giờ có origin trong danh sách", list.contains("$origin/"))
        assertEquals("không được trùng: $list", list.size, list.toSet().size)
    }

    @Test
    fun web_url_hop_le_van_duoc_giu_sau_panel() {
        // Dữ liệu cũ đã xác thực (URL ingress) vẫn được thử, nhưng SAU panel — panel là đường hoạt động được.
        val list = DashboardTarget.candidates(saved = ingressUrl, typed = domain, token = token)
        assertEquals(panel, list.first())
        assertEquals(ingressUrl, list[2])
        assertEquals("không nhân đôi biến thể ingress", 5, list.size)
        // Origin của HA (loginUrl) chỉ dùng khi không có nguồn nào khác.
        val fromLogin = DashboardTarget.candidates(saved = null, loginUrl = "$origin/", token = token)
        assertEquals(panel, fromLogin.first())
    }

    @Test
    fun khong_co_gi_de_dung_thi_danh_sach_rong() {
        assertTrue(DashboardTarget.candidates(saved = null, typed = null, token = token).isEmpty())
    }

    // ─────────────────────────────────────────── 3) Watch không bao giờ chứa origin

    @Test
    fun watch_dung_lai_tu_token_khi_web_url_la_origin() {
        val w = HaLogin.Watch("$origin/", token = token)
        assertEquals(panel, w.current)
        assertFalse("origin KHÔNG được là biến thể", w.variants.contains("$origin/"))
        assertFalse(w.variants.contains(origin))
        assertEquals(
            listOf(
                panel,
                "$panel/$launcher",
                ingressUrl,
                "$origin/$launcher",
                "http://$domain:18080/$launcher"
            ),
            w.variants
        )
    }

    @Test
    fun watch_dung_lai_tu_chuoi_nguoi_dung_go_khi_chua_co_web_url() {
        val w = HaLogin.Watch(null, token = token, fallbackInput = domain)
        assertEquals(panel, w.current)
        // Không có gì để dựng (webUrl + chuỗi gõ đều rỗng) → không biến thể, GIVE_UP ngay.
        assertTrue(HaLogin.Watch(null, token = token).variants.isEmpty())
    }

    @Test
    fun dashboard_variants_uu_tien_panel_roi_moi_toi_web_url_da_luu() {
        val list = HaLogin.dashboardVariants(ingressUrl, token = token)
        assertEquals(panel, list.first())
        assertEquals(ingressUrl, list[2])
        assertEquals(5, list.size)
        assertEquals(list.size, list.toSet().size)
    }

    // ─────────────────────────────────────────── 4) xác thực trang vừa nạp

    @Test
    fun panel_la_thanh_cong_con_spa_ha_thuan_thi_khong() {
        // Panel của add-on: tiêu đề riêng của panel (HA thêm hậu tố " - Home Assistant").
        assertEquals(DashboardTarget.Arrival.ADDON, DashboardTarget.arrival(panel, "Dashboard OS - Home Assistant"))
        assertEquals(DashboardTarget.Arrival.ADDON, DashboardTarget.arrival(panel, "Dashboard"))
        // Chưa có tiêu đề (trang còn đang dựng) → vẫn coi là panel (URL đúng).
        assertEquals(DashboardTarget.Arrival.ADDON, DashboardTarget.arrival(panel, null))
        // Tiêu đề `<title>Home Assistant</title>` TRẦN ngay trên URL panel → KHÔNG tính là thành công.
        assertEquals(
            DashboardTarget.Arrival.HOME_ASSISTANT,
            DashboardTarget.arrival(panel, "Home Assistant")
        )
        // Có `<iframe … hassio_ingress>` → chắc chắn panel đã nhúng add-on, kể cả tiêu đề trần.
        assertEquals(
            DashboardTarget.Arrival.ADDON,
            DashboardTarget.arrival(panel, "Home Assistant", "<iframe src=\"/api/hassio_ingress/t/x.html\"></iframe>")
        )
    }

    @Test
    fun trang_add_on_la_ok_trang_ha_thi_khong() {
        assertEquals(DashboardTarget.Arrival.ADDON, DashboardTarget.arrival(ingressUrl, "Dashboard"))
        assertEquals(DashboardTarget.Arrival.ADDON, DashboardTarget.arrival(ingressUrl, null))
        assertEquals(
            DashboardTarget.Arrival.ADDON,
            DashboardTarget.arrival("http://192.168.10.2:18080/$launcher", "Dashboard")
        )
        // SPA của Home Assistant: Lovelace / trang chủ.
        assertEquals(
            DashboardTarget.Arrival.HOME_ASSISTANT,
            DashboardTarget.arrival("$origin/lovelace/0", "Home Assistant")
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
    fun trang_dang_nhap_ha_duoc_nhan_dien_rieng() {
        assertEquals(DashboardTarget.Arrival.LOGIN, DashboardTarget.arrival("$origin/auth/login", "Home Assistant"))
        assertEquals(DashboardTarget.Arrival.LOGIN, DashboardTarget.arrival("$origin/auth/authorize?x=1", null))
        assertEquals("login", DashboardTarget.Arrival.LOGIN.label)
        assertTrue(DashboardTarget.isAuthPage("$origin/auth/login"))
        assertFalse(DashboardTarget.isAuthPage(panel))
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
        val w = HaLogin.Watch(panel, token = token)
        val step = w.skip()
        assertEquals(HaLogin.Action.NEXT_VARIANT, step.action)
        assertEquals("$panel/$launcher", step.url)
        assertEquals(1, w.index)
        // Bỏ hết biến thể → GIVE_UP (MainActivity hiện thông báo + nút "Thử lại").
        repeat(4) { w.skip() }
        assertTrue(w.gaveUp)
        assertEquals(HaLogin.Action.GIVE_UP, w.skip().action)
    }

    // ─────────────────────────────────────────── 5) chẩn đoán: log [nav] + URL rút gọn

    @Test
    fun nhat_ky_nav_dung_dinh_dang_yeu_cau() {
        assertEquals("[nav] url=…/$slug ok=panel", DashboardTarget.navLine(panel, "panel"))
        assertEquals("[nav] url=…/lovelace/0 ok=ha-spa", DashboardTarget.navLine("$origin/lovelace/0", "ha-spa"))
        assertEquals("[nav] url=…/auth/login ok=login", DashboardTarget.navLine("$origin/auth/login", "login"))
        assertEquals(
            "[nav] url=…/api/hassio_ingress/KJjH…/$launcher ok=401",
            DashboardTarget.navLine(ingressUrl, "401")
        )
        assertEquals(
            "[nav] url=…/$slug ok=panel frame=yes",
            DashboardTarget.navLine(panel, "panel", "frame=yes")
        )
    }

    @Test
    fun url_rut_gon_cho_thanh_thong_bao() {
        assertEquals("…/api/hassio_ingress/KJjH…/$launcher", DashboardTarget.shortUrl(ingressUrl))
        assertEquals("…/$slug", DashboardTarget.shortUrl(panel))
        assertEquals("…/$slug/$launcher", DashboardTarget.shortUrl("$origin/$slug/$launcher"))
        assertEquals("…/", DashboardTarget.shortUrl("$origin/"))
        assertEquals("-", DashboardTarget.shortUrl(null))
        assertEquals("-", DashboardTarget.shortUrl(""))
        // URL LAN (không có ingress) vẫn rút gọn được.
        assertEquals("…/$launcher", DashboardTarget.shortUrl("http://192.168.10.2:18080/$launcher"))
    }

    @Test
    fun dong_log_saved_loading_result() {
        assertEquals(
            "[login] saved=- loading=…/$slug result=pending (panel)",
            HaLogin.progressLine(null, panel, "pending", "(panel)")
        )
        assertEquals(
            "[login] saved=- loading=…/ result=pending (confirmed)",
            HaLogin.progressLine(null, "$origin/", "pending", "(confirmed)")
        )
        assertEquals("[login] saved=- loading=- result=-", HaLogin.progressLine(null, null, " "))
    }
}

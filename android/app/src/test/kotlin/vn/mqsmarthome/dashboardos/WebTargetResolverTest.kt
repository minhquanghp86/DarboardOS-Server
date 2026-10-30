package vn.mqsmarthome.dashboardos

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * (13/11/2026) GD6 — kiểm tra phần PHÂN TÍCH URL mới (không gọi mạng, không đụng API Android):
 *
 *  1. ô 1 "Trang điều khiển (https)": domain → danh sách ứng viên (ingress HA → slug add-on → gốc domain),
 *  2. nhận diện body SPA của Home Assistant (`<title>Home Assistant</title>`) để LOẠI,
 *  3. nhận diện 401 là HỢP LỆ (đúng add-on nhưng cần đăng nhập HA),
 *  4. ô 2 "Máy chủ API (LAN)": ứng viên + suy ra `http://<ip>:18080` khi ô 2 trống,
 *  5. webUrl và apiBase là 2 giá trị RIÊNG (không suy ra cái này từ cái kia khi đã có cả hai) + URL trang gọi.
 *
 * Chạy: `cd android && ./gradlew testDebugUnitTest --offline --no-daemon`.
 */
class WebTargetResolverTest {

    private val token = WebTargetResolver.DEFAULT_INGRESS_TOKEN
    private val slug = WebTargetResolver.ADDON_SLUG
    private val domain = "hass.mqsmarthome.io.vn"

    // ─────────────────────────────────────────── 1) ô 1: domain → ứng viên

    @Test
    fun domain_ba_ung_vien_dung_thu_tu_ingress_slug_goc() {
        assertEquals(
            listOf(
                "https://$domain/api/hassio_ingress/$token/launcher-config.html",
                "https://$domain/$slug/launcher-config.html",
                "https://$domain/launcher-config.html"
            ),
            WebTargetResolver.webCandidates(domain, token)
        )
    }

    @Test
    fun domain_dung_token_mac_dinh_khi_khong_truyen_token() {
        val first = WebTargetResolver.webCandidates(domain).first()
        assertEquals("https://$domain/api/hassio_ingress/$token/launcher-config.html", first)
        // token rỗng / toàn khoảng trắng -> quay về token mặc định
        assertEquals(first, WebTargetResolver.webCandidates(domain, "   ").first())
        assertEquals(first, WebTargetResolver.webCandidates(domain, "").first())
    }

    @Test
    fun token_nguoi_dung_sua_duoc_va_bo_khoang_trang_gach_cheo() {
        val custom = "AbC_123-xyz"
        assertEquals(
            "https://$domain/api/hassio_ingress/$custom/launcher-config.html",
            WebTargetResolver.webCandidates(domain, "  /$custom/  ").first()
        )
    }

    @Test
    fun domain_co_scheme_hay_khong_deu_ra_https() {
        val expected = WebTargetResolver.webCandidates(domain, token)
        assertEquals(expected, WebTargetResolver.webCandidates("https://$domain", token))
        assertEquals(expected, WebTargetResolver.webCandidates("  $domain/  ", token))
        // Người dùng gõ http:// vẫn ưu tiên https (ingress HA luôn TLS).
        assertEquals(expected, WebTargetResolver.webCandidates("http://$domain", token))
    }

    @Test
    fun url_day_du_nguoi_dung_dan_thi_thu_dung_no_truoc() {
        val typed = "https://$domain/api/hassio_ingress/$token/launcher-config.html"
        val list = WebTargetResolver.webCandidates(typed, token)
        assertEquals(typed, list.first())
        // Vẫn còn ứng viên dự phòng phía sau (token cũ/hết hạn).
        assertTrue(list.contains("https://$domain/$slug/launcher-config.html"))
        assertEquals("không được trùng: $list", list.size, list.toSet().size)
    }

    @Test
    fun domain_co_cong_rieng_thi_giu_cong_do() {
        val list = WebTargetResolver.webCandidates("hass.example.com:8123", token)
        assertEquals("https://hass.example.com:8123/api/hassio_ingress/$token/launcher-config.html", list.first())
        assertTrue(list.contains("https://hass.example.com:8123/launcher-config.html"))
        assertFalse(list.contains("https://hass.example.com:8123:8123/$slug/launcher-config.html"))
    }

    @Test
    fun ip_lan_co_ung_vien_cong_18080_va_https() {
        val list = WebTargetResolver.webCandidates("192.168.10.2", token)
        assertTrue(list.contains("http://192.168.10.2:18080/launcher-config.html"))
        assertTrue(list.contains("https://192.168.10.2/launcher-config.html"))
        assertTrue(list.contains("http://192.168.10.2/launcher-config.html"))
        // IP LAN không dùng ingress của HA.
        assertFalse(list.any { it.contains("/api/hassio_ingress/") })
        assertEquals("không được trùng: $list", list.size, list.toSet().size)
    }

    @Test
    fun chuoi_rong_hoac_rac_tra_danh_sach_rong() {
        assertEquals(emptyList<String>(), WebTargetResolver.webCandidates(null))
        assertEquals(emptyList<String>(), WebTargetResolver.webCandidates(""))
        assertEquals(emptyList<String>(), WebTargetResolver.webCandidates("   "))
        assertEquals(emptyList<String>(), WebTargetResolver.webCandidates("hass local"))
        assertEquals(emptyList<String>(), WebTargetResolver.webCandidates("ftp://hass.example.com"))
        assertEquals(emptyList<String>(), WebTargetResolver.webCandidates("!!!"))
    }

    // ─────────────────────────────────────────── 2) body SPA của Home Assistant

    @Test
    fun nhan_dien_trang_spa_cua_home_assistant() {
        assertTrue(
            WebTargetResolver.isHomeAssistantSpa(
                "<!doctype html><html><head><title>Home Assistant</title></head><body><div id=\"root\"></div></body></html>"
            )
        )
        // Không phân biệt hoa/thường, có xuống dòng/khoảng trắng trong thẻ.
        assertTrue(WebTargetResolver.isHomeAssistantSpa("<TITLE>Home  Assistant</TITLE>"))
        assertTrue(WebTargetResolver.isHomeAssistantSpa("<title>\n  Home Assistant\n</title>"))
        // Tiền tố HTML của HA (frontend_latest) cũng bị loại.
        assertTrue(
            WebTargetResolver.isHomeAssistantSpa(
                "<html><head><title>Home Assistant</title><script src=\"/frontend_latest/core.js\"></script></head></html>"
            )
        )
    }

    @Test
    fun trang_cua_add_on_khong_bi_coi_la_spa_ha() {
        // launcher-config.html thật của add-on: <title>Dashboard</title>.
        assertFalse(WebTargetResolver.isHomeAssistantSpa("<html><head><title>Dashboard</title></head></html>"))
        assertFalse(WebTargetResolver.isHomeAssistantSpa("{\"service\":\"dashboard-os\"}"))
        assertFalse(WebTargetResolver.isHomeAssistantSpa(""))
        assertFalse(WebTargetResolver.isHomeAssistantSpa("   "))
        assertFalse(WebTargetResolver.isHomeAssistantSpa("401: Unauthorized"))
        assertFalse(WebTargetResolver.isHomeAssistantSpa(null))
    }

    // ─────────────────────────────────────────── 3) 200 / 401 là hợp lệ

    @Test
    fun ma_401_la_hop_le_neu_khong_phai_spa_ha() {
        // 401 = đúng add-on nhưng WebView chưa có cookie HA -> phải coi là TÌM THẤY để người dùng đăng nhập.
        assertTrue(WebTargetResolver.isAcceptedWeb(401, "401: Unauthorized"))
        assertTrue(WebTargetResolver.isAcceptedWeb(401, ""))
        assertTrue(WebTargetResolver.isAcceptedWeb(401, null))
        assertTrue(WebTargetResolver.isAcceptedWeb(200, "<html><head><title>Dashboard</title></head></html>"))
        assertTrue(WebTargetResolver.isAcceptedWeb(200, null))   // body rỗng: không đủ căn cứ để loại
    }

    @Test
    fun ma_401_nhung_body_la_spa_ha_thi_van_bi_loai() {
        // Trang SPA của HA (kể cả khi trả 401) KHÔNG phải add-on.
        assertFalse(WebTargetResolver.isAcceptedWeb(401, "<html><title>Home Assistant</title></html>"))
        assertFalse(WebTargetResolver.isAcceptedWeb(200, "<html><title>Home Assistant</title></html>"))
    }

    @Test
    fun ma_khac_khong_duoc_chap_nhan() {
        assertFalse(WebTargetResolver.isAcceptedWeb(301, null))
        assertFalse(WebTargetResolver.isAcceptedWeb(302, "<html></html>"))
        assertFalse(WebTargetResolver.isAcceptedWeb(403, "403: Forbidden"))
        assertFalse(WebTargetResolver.isAcceptedWeb(404, "Not Found"))
        assertFalse(WebTargetResolver.isAcceptedWeb(500, "loi"))
    }

    @Test
    fun web_check_accepted_theo_cung_quy_tac() {
        assertEquals(
            true,
            WebTargetResolver.WebCheck("https://$domain/launcher-config.html", 200, "<title>Dashboard</title>").accepted
        )
        assertEquals(
            true,
            WebTargetResolver.WebCheck("https://$domain/launcher-config.html", 401, "401: Unauthorized").accepted
        )
        assertEquals(
            false,
            WebTargetResolver.WebCheck("https://$domain/launcher-config.html", 200, "<title>Home Assistant</title>").accepted
        )
    }

    @Test
    fun probe_web_tu_choi_url_khong_hop_le_ma_khong_goi_mang() {
        assertNull(WebTargetResolver.probeWeb(null))
        assertNull(WebTargetResolver.probeWeb(""))
        assertNull(WebTargetResolver.probeWeb("$domain/launcher-config.html"))
        assertNull(WebTargetResolver.probeWeb("ftp://$domain/x.html"))
    }

    // ─────────────────────────────────────────── 4) ô 2: máy chủ API (LAN)

    @Test
    fun api_giu_cong_nguoi_dung_go_va_them_http_khi_thieu_scheme() {
        assertEquals(
            listOf("http://192.168.10.2:18080", "https://192.168.10.2:18080"),
            WebTargetResolver.apiCandidates("192.168.10.2:18080")
        )
        assertEquals(
            listOf("http://192.168.10.2:18080", "https://192.168.10.2:18080"),
            WebTargetResolver.apiCandidates("http://192.168.10.2:18080/").let { listOf(it.first(), it.last()) }
        )
        assertEquals("http://192.168.10.2:18080", WebTargetResolver.apiCandidates("http://192.168.10.2:18080/").first())
    }

    @Test
    fun api_ip_khong_co_cong_thi_them_cong_18080_truoc() {
        val list = WebTargetResolver.apiCandidates("192.168.10.2")
        assertEquals("http://192.168.10.2:18080", list.first())
        assertTrue(list.contains("http://192.168.10.2"))
        assertTrue(list.contains("https://192.168.10.2"))
        assertEquals("không được trùng: $list", list.size, list.toSet().size)
    }

    @Test
    fun api_bo_tien_to_duong_dan_vi_api_nam_o_goc_add_on() {
        assertEquals(
            listOf("http://192.168.10.2:18080", "https://192.168.10.2:18080"),
            WebTargetResolver.apiCandidates("http://192.168.10.2:18080/$slug/launcher-config.html")
        )
    }

    @Test
    fun api_domain_thi_https_truoc() {
        val list = WebTargetResolver.apiCandidates("hass.example.com")
        assertEquals("https://hass.example.com", list.first())
        assertTrue(list.contains("http://hass.example.com"))
        assertFalse(list.contains("https://hass.example.com:18080"))
    }

    @Test
    fun api_rong_hoac_rac_tra_danh_sach_rong() {
        assertEquals(emptyList<String>(), WebTargetResolver.apiCandidates(null))
        assertEquals(emptyList<String>(), WebTargetResolver.apiCandidates(""))
        assertEquals(emptyList<String>(), WebTargetResolver.apiCandidates("  "))
        assertEquals(emptyList<String>(), WebTargetResolver.apiCandidates("hass local"))
        assertEquals(emptyList<String>(), WebTargetResolver.apiCandidates("192.168.10.2:abc"))
        assertEquals(emptyList<String>(), WebTargetResolver.apiCandidates("!!!"))
    }

    // ─────────────────────────────────────────── 5) tách webUrl / apiBase

    @Test
    fun api_co_gia_tri_thi_dung_o_2_khong_suy_tu_o_1() {
        // Ô 1 là domain (https ingress) nhưng ô 2 là LAN: hai giá trị ĐỘC LẬP.
        assertEquals(
            "http://192.168.10.2:18080",
            WebTargetResolver.apiBaseOrNull(domain, "192.168.10.2:18080")
        )
        assertEquals(
            "http://192.168.10.2:18080",
            WebTargetResolver.apiBaseOrNull(domain, "http://192.168.10.2:18080/")
        )
        // Ô 1 là IP LAN nhưng ô 2 chỉ định máy khác -> vẫn theo ô 2.
        assertEquals("http://10.0.0.9:18080", WebTargetResolver.apiBaseOrNull("192.168.10.2", "10.0.0.9:18080"))
    }

    @Test
    fun api_trong_thi_suy_ra_http_ip_18080_tu_o_1_khi_o_1_la_ip_lan() {
        assertEquals("http://192.168.10.2:18080", WebTargetResolver.apiBaseOrNull("192.168.10.2", ""))
        assertEquals("http://192.168.10.2:18080", WebTargetResolver.apiBaseOrNull("192.168.10.2", null))
        assertEquals("http://192.168.10.2:18080", WebTargetResolver.apiBaseOrNull("192.168.10.2", "   "))
        assertEquals("http://192.168.10.2:18080", WebTargetResolver.apiBaseOrNull("https://192.168.10.2/launcher-config.html", ""))
        assertEquals("http://192.168.10.7:18080", WebTargetResolver.apiBaseOrNull("192.168.10.7", ""))
        // Cổng người dùng gõ ở ô 1 được giữ.
        assertEquals("http://192.168.10.2:18080", WebTargetResolver.apiBaseOrNull("192.168.10.2:18080", ""))
    }

    @Test
    fun api_trong_va_o_1_khong_phai_ip_lan_thi_khong_suy_ra_duoc() {
        assertNull(WebTargetResolver.apiBaseOrNull(domain, ""))
        assertNull(WebTargetResolver.apiBaseOrNull("https://$domain/api/hassio_ingress/$token/launcher-config.html", ""))
        assertNull(WebTargetResolver.apiBaseOrNull("", ""))
        assertNull(WebTargetResolver.apiBaseOrNull("!!!", "!!!"))
        assertNull(WebTargetResolver.apiBaseOrNull(null, null))
    }

    @Test
    fun web_url_va_api_la_hai_gia_tri_khac_nhau() {
        val web = WebTargetResolver.webCandidates(domain, token).first()
        val api = WebTargetResolver.apiBaseOrNull(domain, "192.168.10.2:18080")!!
        assertTrue(web.startsWith("https://$domain/api/hassio_ingress/"))
        assertTrue(api.startsWith("http://192.168.10.2:18080"))
        assertFalse(api.contains("/api/hassio_ingress/"))
        assertFalse(web.contains("192.168.10.2"))
    }

    // ─────────────────────────────────────────── trang gọi + gốc HA

    @Test
    fun call_page_cung_thu_muc_voi_trang_dieu_khien() {
        val web = "https://$domain/api/hassio_ingress/$token/launcher-config.html"
        assertEquals(
            "https://$domain/api/hassio_ingress/$token/call-web.html?call=abc-1",
            WebTargetResolver.callPageUrl(web, "abc-1")
        )
        assertEquals(
            "https://$domain/$slug/call-web.html?call=x+y",
            WebTargetResolver.callPageUrl("https://$domain/$slug/launcher-config.html", "x y")
        )
        // Không có tên tệp (URL kết thúc bằng /) -> thêm call-web.html vào thư mục đó.
        assertEquals(
            "https://$domain/$slug/call-web.html",
            WebTargetResolver.callPageUrl("https://$domain/$slug/", "")
        )
        assertNull(WebTargetResolver.callPageUrl(null, "abc"))
        assertNull(WebTargetResolver.callPageUrl("", "abc"))
        assertNull(WebTargetResolver.callPageUrl("$domain/x.html", "abc"))
    }

    @Test
    fun origin_url_lay_goc_de_mo_trang_chu_ha() {
        assertEquals(
            "https://$domain",
            WebTargetResolver.originUrl("https://$domain/api/hassio_ingress/$token/launcher-config.html")
        )
        assertEquals("http://192.168.10.2:18080", WebTargetResolver.originUrl("http://192.168.10.2:18080/app/ping"))
        assertNull(WebTargetResolver.originUrl(null))
        assertNull(WebTargetResolver.originUrl(""))
        assertNull(WebTargetResolver.originUrl("$domain/x.html"))
    }

    // ─────────────────────────────────────────── 6) đăng nhập Home Assistant (GD7)

    @Test
    fun ma_401_403_la_can_dang_nhap_ha() {
        assertTrue(WebTargetResolver.needsHaLogin(401))
        assertTrue(WebTargetResolver.needsHaLogin(403))
        assertFalse(WebTargetResolver.needsHaLogin(200))
        assertFalse(WebTargetResolver.needsHaLogin(301))
        assertFalse(WebTargetResolver.needsHaLogin(404))
        assertFalse(WebTargetResolver.needsHaLogin(500))
        assertFalse(WebTargetResolver.needsHaLogin(0))
    }

    @Test
    fun nhan_dien_url_ingress_de_chan_hien_loi_tho() {
        assertTrue(
            WebTargetResolver.isIngressUrl("https://$domain/api/hassio_ingress/$token/launcher-config.html")
        )
        assertTrue(WebTargetResolver.isIngressUrl("https://$domain/api/hassio_ingress/$token/call-web.html?call=x"))
        assertTrue(WebTargetResolver.isIngressUrl("https://hass/api/hassio_ingress/t/launcher-config.html"))
        assertFalse(WebTargetResolver.isIngressUrl("https://$domain/$slug/launcher-config.html"))
        assertFalse(WebTargetResolver.isIngressUrl("https://$domain/launcher-config.html"))
        assertFalse(WebTargetResolver.isIngressUrl("https://$domain/"))
        assertFalse(WebTargetResolver.isIngressUrl(null))
        assertFalse(WebTargetResolver.isIngressUrl(""))
    }

    @Test
    fun doc_cookie_phien_ha_theo_ten() {
        // Có phiên: một trong hai tên xuất hiện trong header.
        assertTrue(WebTargetResolver.hasSessionCookie("ingress_session=abc123"))
        assertTrue(WebTargetResolver.hasSessionCookie("hassio_ingress=xyz"))
        assertTrue(WebTargetResolver.hasSessionCookie("a=1; ingress_session=abc; b=2"))
        assertTrue(WebTargetResolver.hasSessionCookie("a=1;hassio_ingress=xyz;b=2"))
        assertTrue(WebTargetResolver.hasSessionCookie("  INGRESS_SESSION=abc  "))
        // Chưa có phiên / header rỗng / chỉ cookie khác.
        assertFalse(WebTargetResolver.hasSessionCookie(null))
        assertFalse(WebTargetResolver.hasSessionCookie(""))
        assertFalse(WebTargetResolver.hasSessionCookie("   "))
        assertFalse(WebTargetResolver.hasSessionCookie("refresh_token=abc; session=def"))
        // Không được khớp "gần giống".
        assertFalse(WebTargetResolver.hasSessionCookie("ingress_session_old=abc"))
        assertFalse(WebTargetResolver.hasSessionCookie("xingress_session=abc"))
    }

    @Test
    fun login_url_la_goc_ha_co_gach_cheo_cuoi() {
        assertEquals(
            "https://$domain/",
            WebTargetResolver.loginUrl("https://$domain/api/hassio_ingress/$token/launcher-config.html")
        )
        assertEquals("https://$domain/", WebTargetResolver.loginUrl("https://$domain/$slug/launcher-config.html"))
        assertEquals("http://192.168.10.2:18080/", WebTargetResolver.loginUrl("http://192.168.10.2:18080/app/ping"))
        assertNull(WebTargetResolver.loginUrl(null))
        assertNull(WebTargetResolver.loginUrl(""))
        assertNull(WebTargetResolver.loginUrl("$domain/x.html"))
    }

    @Test
    fun same_url_bo_qua_query_va_gach_cheo_cuoi() {
        val web = "https://$domain/api/hassio_ingress/$token/launcher-config.html"
        assertTrue(WebTargetResolver.sameUrl(web, web))
        assertTrue(WebTargetResolver.sameUrl("$web?x=1", web))
        assertTrue(WebTargetResolver.sameUrl("$web#top", web))
        assertTrue(WebTargetResolver.sameUrl("https://$domain/", "https://$domain"))
        assertFalse(
            WebTargetResolver.sameUrl(
                "https://$domain/api/hassio_ingress/$token/call-web.html?call=1",
                web
            )
        )
        assertFalse(WebTargetResolver.sameUrl(null, web))
        assertFalse(WebTargetResolver.sameUrl(web, null))
    }

    // ─────────────────────────────────────────── 7) (GD9) MỘT Ô ĐỊA CHỈ

    @Test
    fun mot_o_domain_dung_ingress_cho_ca_trang_lan_api() {
        val web = WebTargetResolver.webCandidates(domain, token).first()
        val api = WebTargetResolver.apiBaseForInput(domain, token)
        // Trang điều khiển: đúng URL ingress + launcher-config.html.
        assertEquals("https://$domain/api/hassio_ingress/$token/launcher-config.html", web)
        // API: CÙNG ingress (không có /launcher-config.html), để /app/* nằm sau ingress.
        assertEquals("https://$domain/api/hassio_ingress/$token", api)
        assertTrue("API phải nằm sau ingress: $api", WebTargetResolver.isIngressBase(api))
        // Cùng origin → cookie phiên HA đọc từ CookieManager dùng được cho cả hai.
        assertEquals(WebTargetResolver.originUrl(web), WebTargetResolver.originUrl(api))
    }

    @Test
    fun mot_o_domain_thu_tu_ung_vien_api_ingress_slug_goc_cong_18080() {
        assertEquals(
            listOf(
                "https://$domain/api/hassio_ingress/$token",
                "https://$domain/$slug",
                "https://$domain",
                "http://$domain:18080"
            ),
            WebTargetResolver.apiBasesForInput(domain, token)
        )
    }

    @Test
    fun mot_o_token_nguoi_dung_sua_thi_doi_ca_trang_lan_api() {
        val custom = "TokenKhac_9"
        assertEquals(
            "https://$domain/api/hassio_ingress/$custom/launcher-config.html",
            WebTargetResolver.webCandidates(domain, custom).first()
        )
        assertEquals(
            "https://$domain/api/hassio_ingress/$custom",
            WebTargetResolver.apiBaseForInput(domain, custom)
        )
    }

    @Test
    fun mot_o_ip_lan_dung_http_cong_18080_cho_ca_hai_va_canh_bao_khong_https() {
        val webLan = "http://192.168.10.2:18080/launcher-config.html"
        // IP LAN: KHÔNG dùng ingress; vẫn có ứng viên http://<ip>:18080 cho trang điều khiển.
        assertTrue(WebTargetResolver.webCandidates("192.168.10.2", token).contains(webLan))
        // API: http://<ip>:18080 là ứng viên ĐẦU TIÊN.
        assertEquals("http://192.168.10.2:18080", WebTargetResolver.apiBaseForInput("192.168.10.2", token))
        // Giữ cổng người dùng gõ.
        assertEquals("http://192.168.10.2:9090", WebTargetResolver.apiBaseForInput("192.168.10.2:9090", token))
        // http = KHÔNG có secure context → MainActivity cảnh báo mất micro/camera; https thì không.
        assertTrue(WebTargetResolver.lacksSecureContext(webLan))
        assertFalse(WebTargetResolver.lacksSecureContext("https://$domain/api/hassio_ingress/$token/launcher-config.html"))
        assertFalse(WebTargetResolver.lacksSecureContext(null))
        assertFalse(WebTargetResolver.lacksSecureContext(""))
        // Gốc API LAN không phải ingress → PhoneService không cần cookie, poll ngay.
        assertFalse(WebTargetResolver.isIngressBase("http://192.168.10.2:18080"))
        assertFalse(WebTargetResolver.isIngressBase(null))
    }

    @Test
    fun mot_o_dan_url_day_du_thi_giu_tien_to_nguoi_dung_dang_co() {
        // Người dùng dán nguyên URL trang gọi: tiền tố ingress của họ được giữ, app ghép đúng trang điều khiển.
        val typed = "https://$domain/api/hassio_ingress/$token/call-web.html"
        assertEquals(
            "https://$domain/api/hassio_ingress/$token",
            WebTargetResolver.apiBaseForInput(typed, token)
        )
        assertEquals(
            "https://$domain/api/hassio_ingress/$token/launcher-config.html",
            WebTargetResolver.webCandidates(typed, token).first()
        )
    }

    @Test
    fun mot_o_chuoi_khong_dung_duoc_tra_rong() {
        assertEquals(emptyList<String>(), WebTargetResolver.apiBasesForInput(null, token))
        assertEquals(emptyList<String>(), WebTargetResolver.apiBasesForInput("", token))
        assertEquals(emptyList<String>(), WebTargetResolver.apiBasesForInput("hass local", token))
        assertEquals(emptyList<String>(), WebTargetResolver.apiBasesForInput("!!!", token))
        assertNull(WebTargetResolver.apiBaseForInput(null, token))
        assertNull(WebTargetResolver.apiBaseForInput("!!!", token))
    }

    @Test
    fun call_page_gan_them_phone_de_trang_biet_may_nao_dang_goi() {
        val web = "https://$domain/api/hassio_ingress/$token/launcher-config.html"
        assertEquals(
            "https://$domain/api/hassio_ingress/$token/call-web.html?call=abc-1&phone=p-1",
            WebTargetResolver.callPageUrl(web, "abc-1", "p-1")
        )
        // Không có callId nhưng có phoneId -> chỉ có ?phone=.
        assertEquals(
            "https://$domain/api/hassio_ingress/$token/call-web.html?phone=p-1",
            WebTargetResolver.callPageUrl(web, "", "p-1")
        )
        // phoneId rỗng -> y như cũ (không thêm tham số).
        assertEquals(
            "https://$domain/api/hassio_ingress/$token/call-web.html?call=abc-1",
            WebTargetResolver.callPageUrl(web, "abc-1", "  ")
        )
    }
}

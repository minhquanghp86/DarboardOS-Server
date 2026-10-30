package vn.mqsmarthome.dashboardos

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * (10/11/2026) GD2 — dẫn xuất địa chỉ máy chủ từ URL người dùng nhập (yêu cầu 11).
 *
 * Chỉ kiểm tra phần THUẦN (java.net.URL), không chạm API Android: chạy bằng `./gradlew testDebugUnitTest`.
 */
class PhoneApiTest {

    private val ingress = "https://hass.mqsmarthome.io.vn/b39feb53_remote_webview_server/call-web.html"
    private val lan = "http://192.168.1.10:18080/call-web.html"

    @Test
    fun origin_giu_path_prefix_cua_ingress() {
        assertEquals("https://hass.mqsmarthome.io.vn/b39feb53_remote_webview_server/", PhoneApi.origin(ingress))
    }

    @Test
    fun origin_giu_cong_cua_lan() {
        assertEquals("http://192.168.1.10:18080/", PhoneApi.origin(lan))
    }

    @Test
    fun origin_them_https_khi_thieu_scheme() {
        assertEquals("https://hass.local/b39/", PhoneApi.origin("hass.local/b39/call-web.html"))
    }

    @Test
    fun origin_khi_url_chi_la_host() {
        assertEquals("https://hass.local/", PhoneApi.origin("https://hass.local"))
        assertEquals("https://hass.local/", PhoneApi.origin("https://hass.local/"))
    }

    @Test
    fun origin_khi_url_da_la_thu_muc() {
        assertEquals("https://hass.local/b39/", PhoneApi.origin("https://hass.local/b39/"))
    }

    @Test
    fun origin_tu_choi_rach_hoac_scheme_la() {
        assertNull(PhoneApi.origin(null))
        assertNull(PhoneApi.origin(""))
        assertNull(PhoneApi.origin("   "))
        assertNull(PhoneApi.origin("ftp://hass.local/x.html"))
        assertNull(PhoneApi.origin("https://"))
    }

    @Test
    fun apiBase_bo_dau_gach_cuoi() {
        assertEquals("https://hass.mqsmarthome.io.vn/b39feb53_remote_webview_server", PhoneApi.apiBase(ingress))
        assertEquals("http://192.168.1.10:18080", PhoneApi.apiBase(lan))
    }

    @Test
    fun apiUrl_dung_duong_dan_app() {
        assertEquals(
            "https://hass.mqsmarthome.io.vn/b39feb53_remote_webview_server/app/incoming?phone=abc",
            PhoneApi.apiUrl(ingress, "app/incoming?phone=abc")
        )
        assertEquals(
            "http://192.168.1.10:18080/app/register",
            PhoneApi.apiUrl(lan, "/app/register")
        )
    }

    @Test
    fun pageUrl_mo_trang_goi_trong_cung_thu_muc() {
        assertEquals(
            "https://hass.mqsmarthome.io.vn/b39feb53_remote_webview_server/call-web.html?call=abc",
            PhoneApi.pageUrl(ingress, "call-web.html", "call=abc")
        )
        assertEquals(
            "http://192.168.1.10:18080/call-web.html?call=abc",
            PhoneApi.pageUrl(lan, "call-web.html", "?call=abc")
        )
        assertEquals(
            "http://192.168.1.10:18080/call-web.html",
            PhoneApi.pageUrl(lan, "call-web.html")
        )
        assertNull(PhoneApi.pageUrl(null, "call-web.html", "call=abc"))
    }

    @Test
    fun normalize_giu_nguyen_url_hop_le() {
        assertEquals(ingress, PhoneApi.normalize(ingress))
        assertEquals(lan, PhoneApi.normalize("  $lan  "))
        assertNull(PhoneApi.normalize("   "))
        assertNull(PhoneApi.normalize(null))
    }
}

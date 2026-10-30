package vn.mqsmarthome.dashboardos

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * (30/10/2026) GD4 — người dùng CHỈ nhập IP/domain của Home Assistant; [ServerResolver] sinh danh sách ứng viên
 * (thứ tự ưu tiên) và dò `/app/ping` để tìm add-on Dashboard OS.
 *
 * Thuần Kotlin/java.net -> chạy bằng `./gradlew testDebugUnitTest`.
 */
class ServerResolverTest {

    private val slug = ServerResolver.ADDON_SLUG

    // ─────────────────────────────────────── IP LAN

    @Test
    fun ip_lan_uu_tien_cong_18080_roi_https() {
        assertEquals(
            listOf(
                "http://192.168.10.2:18080",
                "http://192.168.10.2:18080/$slug",
                "https://192.168.10.2",
                "http://192.168.10.2",
                "https://192.168.10.2/$slug"
            ),
            ServerResolver.candidates("192.168.10.2")
        )
    }

    @Test
    fun ip_lan_giu_cong_nguoi_dung_go_va_loai_trung() {
        val list = ServerResolver.candidates("192.168.10.2:18080")
        assertEquals("http://192.168.10.2:18080", list[0])
        assertEquals(
            listOf(
                "http://192.168.10.2:18080",
                "http://192.168.10.2:18080/$slug",
                "https://192.168.10.2:18080",
                "https://192.168.10.2:18080/$slug"
            ),
            list
        )
    }

    @Test
    fun ip_lan_cac_dai_172_va_10_va_127() {
        assertEquals("http://10.1.2.3:18080", ServerResolver.candidates("10.1.2.3").first())
        assertEquals("http://172.16.0.9:18080", ServerResolver.candidates("172.16.0.9").first())
        assertEquals("http://172.31.5.5:18080", ServerResolver.candidates("172.31.5.5").first())
        assertEquals("http://127.0.0.1:18080", ServerResolver.candidates("127.0.0.1").first())
        // 172.32.x KHÔNG phải dải LAN (172.16-31) -> xử lý như domain.
        assertEquals("https://172.32.5.5", ServerResolver.candidates("172.32.5.5").first())
    }

    @Test
    fun localhost_la_lan_mac_dinh_http() {
        assertEquals("http://localhost:18080", ServerResolver.candidates("localhost").first())
        assertEquals("http", ServerResolver.parse("localhost")?.scheme)
    }

    @Test
    fun ip_lan_kem_duong_dan_day_du_bo_ten_tep() {
        val list = ServerResolver.candidates("http://192.168.1.10:18080/call-web.html")
        assertEquals(
            listOf(
                "http://192.168.1.10:18080",
                "http://192.168.1.10:18080/$slug",
                "https://192.168.1.10:18080",
                "https://192.168.1.10:18080/$slug"
            ),
            list
        )
    }

    // ─────────────────────────────────────── DOMAIN

    @Test
    fun domain_uu_tien_https_roi_ingress_roi_8123() {
        assertEquals(
            listOf(
                "https://hass.mqsmarthome.io.vn",
                "https://hass.mqsmarthome.io.vn/$slug",
                "https://hass.mqsmarthome.io.vn:8123/$slug",
                "http://hass.mqsmarthome.io.vn:18080"
            ),
            ServerResolver.candidates("hass.mqsmarthome.io.vn")
        )
    }

    @Test
    fun domain_kem_path_day_du_lay_origin_va_tien_to() {
        assertEquals(
            listOf(
                "https://hass.mqsmarthome.io.vn/$slug",
                "https://hass.mqsmarthome.io.vn:8123/$slug",
                "http://hass.mqsmarthome.io.vn:18080/$slug"
            ),
            ServerResolver.candidates("https://hass.mqsmarthome.io.vn/$slug/call-web.html")
        )
    }

    @Test
    fun domain_giu_cong_nguoi_dung_go() {
        val list = ServerResolver.candidates("hass.example.com:8123")
        assertEquals("https://hass.example.com:8123", list.first())
        assertTrue(list.contains("http://hass.example.com:8123"))
        assertFalse(list.contains("http://hass.example.com:18080"))
    }

    @Test
    fun domain_mac_dinh_https() {
        assertEquals("https", ServerResolver.parse("hass.example.com")?.scheme)
        // Người dùng gõ http:// thì vẫn dò https trước (server có thể có cả hai).
        assertEquals("http", ServerResolver.parse("http://hass.example.com")?.scheme)
        assertEquals("https://hass.example.com", ServerResolver.candidates("http://hass.example.com").first())
    }

    // ─────────────────────────────────────── CHUẨN HOÁ / RÁC

    @Test
    fun chuan_hoa_trim_va_bo_gach_cuoi() {
        assertEquals(
            ServerResolver.candidates("192.168.10.2"),
            ServerResolver.candidates("  192.168.10.2/  ")
        )
        assertEquals(
            ServerResolver.candidates("hass.example.com"),
            ServerResolver.candidates("hass.example.com////")
        )
    }

    @Test
    fun chuoi_rong_hoac_rac_tra_danh_sach_rong() {
        assertEquals(emptyList<String>(), ServerResolver.candidates(null))
        assertEquals(emptyList<String>(), ServerResolver.candidates(""))
        assertEquals(emptyList<String>(), ServerResolver.candidates("   "))
        assertEquals(emptyList<String>(), ServerResolver.candidates("hass local"))
        assertEquals(emptyList<String>(), ServerResolver.candidates("ftp://hass.example.com"))
        assertEquals(emptyList<String>(), ServerResolver.candidates("https://"))
        assertEquals(emptyList<String>(), ServerResolver.candidates("http://"))
        assertEquals(emptyList<String>(), ServerResolver.candidates("192.168.10.2:abc"))
        assertEquals(emptyList<String>(), ServerResolver.candidates("192.168.10.2:0"))
        assertEquals(emptyList<String>(), ServerResolver.candidates("!!!"))
        assertEquals(emptyList<String>(), ServerResolver.candidates("http:///x.html"))
        assertNull(ServerResolver.parse("   "))
        assertNull(ServerResolver.parse("hass local"))
    }

    @Test
    fun khong_co_ung_vien_nao_trung_nhau() {
        for (input in listOf("192.168.10.2", "192.168.10.2:18080", "hass.example.com", "http://hass.example.com/$slug/call-web.html")) {
            val list = ServerResolver.candidates(input)
            assertEquals("trùng ứng viên với '$input': $list", list.size, list.toSet().size)
        }
    }

    // ─────────────────────────────────────── PROBE (phần không đụng mạng)

    @Test
    fun probe_tu_choi_base_khong_hop_le_ma_khong_goi_mang() {
        assertNull(ServerResolver.probe(null))
        assertNull(ServerResolver.probe(""))
        assertNull(ServerResolver.probe("192.168.10.2:18080"))
    }

    @Test
    fun normalizeBase_them_khong_va_cat_gach_cuoi() {
        assertEquals("http://192.168.10.2:18080", ServerResolver.normalizeBase("  http://192.168.10.2:18080/ "))
        assertEquals("https://hass.example.com/$slug", ServerResolver.normalizeBase("https://hass.example.com/$slug"))
        assertNull(ServerResolver.normalizeBase("192.168.10.2:18080"))
        assertNull(ServerResolver.normalizeBase("   "))
    }

    @Test
    fun parse_tach_host_port_va_tien_to() {
        val a = ServerResolver.parse("https://hass.example.com:8123/$slug/call-web.html")
        assertEquals("hass.example.com", a?.host)
        assertEquals(8123, a?.port)
        assertEquals("/$slug", a?.prefix)
        assertFalse(a!!.lan)

        val b = ServerResolver.parse("192.168.10.2")
        assertEquals("192.168.10.2", b?.host)
        assertEquals(0, b?.port)
        assertEquals("", b?.prefix)
        assertTrue(b!!.lan)
    }

    @Test
    fun parse_giu_thu_muc_lam_tien_to_va_bo_query() {
        assertEquals("/$slug", ServerResolver.parse("hass.example.com/$slug/?x=1")?.prefix)
        assertEquals("", ServerResolver.parse("hass.example.com/call-web.html?call=abc")?.prefix)
    }
}

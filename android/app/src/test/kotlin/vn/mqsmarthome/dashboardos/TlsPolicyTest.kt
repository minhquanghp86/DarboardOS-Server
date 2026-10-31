package vn.mqsmarthome.dashboardos

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.HttpURLConnection
import java.net.URL
import javax.net.ssl.HttpsURLConnection

/**
 * (21/11/2026) GD13 — kiểm tra phần THUẦN của "bỏ phụ thuộc ingress: add-on tự phục vụ HTTPS tự ký ở cổng 18443".
 *
 *  1. [TlsPolicy] — chọn host được chấp nhận chứng chỉ tự ký, nhận diện chế độ LAN, nhận diện URL tự ký;
 *  2. [WebTargetResolver.webCandidates] — nhập IP LAN thì `https://<ip>:18443/launcher-config.html` là ứng viên
 *     ĐẦU TIÊN (trước cả `http://<ip>:18080`); nhập tên miền thì danh sách ingress KHÔNG đổi (phương án phụ giữ nguyên);
 *  3. [WebTargetResolver.apiBasesForInput] — API native vẫn đi `http://<ip>:18080` trước, `https://<ip>:18443` là
 *     phương án hai;
 *  4. [DashboardTarget.candidates] — chưa có `webUrl` hợp lệ + địa chỉ LAN → dựng URL HTTPS 18443 trước; `webUrl`
 *     đã xác thực thì vẫn đứng đầu (không phá cấu hình đang chạy tốt);
 *  5. `TlsPolicy.applyTo` chỉ gắn "tin mọi chứng chỉ" cho ĐÚNG host đã cấu hình.
 *
 * Chạy: `cd android && ./gradlew testDebugUnitTest --offline --no-daemon`.
 */
class TlsPolicyTest {

    private val ip = "192.168.10.2"

    // ─────────────────────────────────────────── 1) host nào được chấp nhận chứng chỉ tự ký

    @Test
    fun host_lay_tu_chuoi_nguoi_dung_go_hoac_url_day_du() {
        assertEquals(ip, TlsPolicy.hostOf(ip))
        assertEquals(ip, TlsPolicy.hostOf("  $ip  "))
        assertEquals(ip, TlsPolicy.hostOf("$ip:18443"))
        assertEquals(ip, TlsPolicy.hostOf("https://$ip:18443/launcher-config.html"))
        assertEquals("hass.example.com", TlsPolicy.hostOf("hass.example.com"))
        assertNull(TlsPolicy.hostOf(null))
        assertNull(TlsPolicy.hostOf(""))
        assertNull(TlsPolicy.hostOf("!!!"))
    }

    @Test
    fun chi_host_da_cau_hinh_moi_duoc_chap_nhan() {
        val allowed = TlsPolicy.allowedHosts("$ip:18443", "https://hass.example.com/launcher-config.html", null, "")
        assertEquals(setOf(ip, "hass.example.com"), allowed)
        assertTrue(TlsPolicy.allowSelfSignedHost(ip, allowed))
        assertTrue("so khop khong phan biet hoa/thuong", TlsPolicy.allowSelfSignedHost("HASS.example.COM", allowed))
        assertFalse("host la (quang cao / chuyen huong) bi chan", TlsPolicy.allowSelfSignedHost("evil.example", allowed))
        assertFalse(TlsPolicy.allowSelfSignedHost("192.168.10.99", allowed))
        assertFalse("khong co host", TlsPolicy.allowSelfSignedHost(null, allowed))
        assertFalse("danh sach rong", TlsPolicy.allowSelfSignedHost(ip, emptySet()))
    }

    @Test
    fun chi_loi_chung_chi_moi_duoc_proceed() {
        val allowed = setOf(ip)
        assertTrue(TlsPolicy.allowProceed(ip, allowed, certError = true))
        // Lỗi KHÔNG phải chứng chỉ (mất mạng, DNS…) thì không bao giờ "proceed".
        assertFalse(TlsPolicy.allowProceed(ip, allowed, certError = false))
        assertFalse(TlsPolicy.allowProceed("khac.example", allowed, certError = true))
    }

    @Test
    fun nhan_dien_che_do_lan_va_url_tu_ky() {
        assertTrue(TlsPolicy.isLanUrl("https://$ip:18443/launcher-config.html"))
        assertTrue(TlsPolicy.isLanUrl("http://$ip:18080/launcher-config.html"))
        assertTrue(TlsPolicy.isLanUrl("https://localhost:18443/app/ping"))
        assertTrue(TlsPolicy.isLanInput(ip))
        assertTrue(TlsPolicy.isLanInput("$ip:18443"))
        assertFalse("ten mien khong phai che do LAN", TlsPolicy.isLanUrl("https://hass.example.com/x"))
        assertFalse(TlsPolicy.isLanInput("hass.example.com"))

        // Cảnh báo "chứng chỉ tự ký" ở màn Cài đặt.
        assertTrue(TlsPolicy.isSelfSignedUrl("https://$ip:18443/launcher-config.html"))
        assertTrue(TlsPolicy.isSelfSignedUrl("https://$ip/launcher-config.html"))
        assertTrue(TlsPolicy.isSelfSignedUrl("https://hass.local:18443/x"))
        assertFalse(TlsPolicy.isSelfSignedUrl("http://$ip:18080/launcher-config.html"))
        assertFalse(TlsPolicy.isSelfSignedUrl("https://hass.example.com/launcher-config.html"))
        assertFalse(TlsPolicy.isSelfSignedUrl(null))
    }

    @Test
    fun https_page_dung_cong_18443() {
        assertEquals("https://$ip:18443/launcher-config.html", TlsPolicy.httpsPage(ip))
        assertEquals("https://$ip:18443/call-web.html", TlsPolicy.httpsPage(ip, "call-web.html"))
        assertEquals(18443, ServerResolver.ADDON_TLS_PORT)
        assertEquals(ServerResolver.ADDON_TLS_PORT, TlsPolicy.TLS_PORT)
    }

    // ─────────────────────────────────────────── 2) thứ tự ứng viên TRANG ĐIỀU KHIỂN

    @Test
    fun nhap_ip_lan_thi_https_18443_la_ung_vien_dau_tien() {
        val list = WebTargetResolver.webCandidates(ip, WebTargetResolver.DEFAULT_INGRESS_TOKEN)
        assertEquals("https://$ip:18443/launcher-config.html", list.first())
        // Sau đó mới tới http://<ip>:18080 (KHÔNG có micro/camera) và các dạng cũ.
        assertTrue(list.contains("http://$ip:18080/launcher-config.html"))
        assertTrue(list.contains("https://$ip/launcher-config.html"))
        assertFalse("IP LAN không dùng ingress của HA", list.any { it.contains("/api/hassio_ingress/") })
        assertEquals("không được trùng: $list", list.size, list.toSet().size)
        // Https tự ký phải đứng trước http 18080.
        assertTrue(list.indexOf("https://$ip:18443/launcher-config.html") <
            list.indexOf("http://$ip:18080/launcher-config.html"))
    }

    @Test
    fun nhap_ten_mien_thi_panel_cua_ha_la_ung_vien_dau_tien() {
        // (26/11/2026) GD14 — chế độ domain: panel của add-on trên HA đứng đầu; ingress chỉ là dự phòng.
        val domain = "hass.mqsmarthome.io.vn"
        val token = WebTargetResolver.DEFAULT_INGRESS_TOKEN
        val list = WebTargetResolver.webCandidates(domain, token)
        assertEquals("https://$domain/${WebTargetResolver.ADDON_SLUG}", list.first())
        assertTrue(list.contains("https://$domain/api/hassio_ingress/$token/launcher-config.html"))
        assertFalse("tên miền không tự thêm cổng 18443", list.any { it.contains(":18443") })
    }

    @Test
    fun localhost_cung_duoc_coi_la_lan() {
        val list = WebTargetResolver.webCandidates("localhost")
        assertEquals("https://localhost:18443/launcher-config.html", list.first())
    }

    // ─────────────────────────────────────────── 3) gốc API

    @Test
    fun api_van_http_18080_truoc_va_https_18443_la_phuong_an_hai() {
        val list = WebTargetResolver.apiBasesForInput(ip, WebTargetResolver.DEFAULT_INGRESS_TOKEN)
        assertEquals("http://$ip:18080", list.first())
        assertEquals("https://$ip:18443", list[1])
        assertEquals("không được trùng: $list", list.size, list.toSet().size)
        // Giữ cổng người dùng gõ.
        assertEquals("http://$ip:9090", WebTargetResolver.apiBaseForInput("$ip:9090"))
    }

    // ─────────────────────────────────────────── 4) DashboardTarget.candidates

    @Test
    fun chua_co_web_url_hop_le_thi_dung_https_18443_truoc_cho_dia_chi_lan() {
        val list = DashboardTarget.candidates(saved = null, typed = ip)
        assertEquals("https://$ip:18443/launcher-config.html", list.first())
        assertEquals("http://$ip:18080/launcher-config.html", list[1])
    }

    @Test
    fun web_url_lan_da_xac_thuc_van_nam_trong_danh_sach() {
        // Máy đang chạy tốt bằng http 18080 (bản add-on cũ) vẫn có trong danh sách;
        // (21/11/2026) GD13 — ứng viên https://<ip>:18443 vẫn đứng trước để có secure context (micro/camera),
        // nhưng chế độ IP LAN nói chung KHÔNG còn được khuyến nghị ((26/11/2026) GD14 — panel của HA là đường chính).
        val saved = "http://$ip:18080/launcher-config.html"
        val list = DashboardTarget.candidates(saved = saved, typed = ip)
        assertEquals("https://$ip:18443/launcher-config.html", list.first())
        assertTrue(list.contains(saved))
        assertTrue(list.indexOf(saved) > 0)
    }

    @Test
    fun web_url_la_https_tu_ky_thi_giu_nguyen() {
        val saved = "https://$ip:18443/launcher-config.html"
        assertEquals(listOf(saved), DashboardTarget.candidates(saved = saved).take(1))
        assertTrue("https != origin nên dùng được", DashboardTarget.isValidSaved(saved))
    }

    // ─────────────────────────────────────────── 5) java.net: chỉ gắn trust cho đúng host

    @Test
    fun apply_to_chi_tac_dong_len_https_cua_host_da_cau_hinh() {
        val plain = URL("http://$ip:18080/app/ping").openConnection() as HttpURLConnection
        // Không ném ra ngoài với connection http thường.
        TlsPolicy.applyTo(plain, setOf(ip))
        plain.disconnect()

        val lan = URL("https://$ip:18443/app/ping").openConnection() as HttpsURLConnection
        val lanFactoryBefore = lan.sslSocketFactory
        val lanVerifierBefore = lan.hostnameVerifier
        TlsPolicy.applyTo(lan, setOf(ip))
        assertNotNull("host đã cấu hình: có trust cho chứng chỉ tự ký", lan.sslSocketFactory)
        assertNotSame("phải THAY factory mặc định bằng factory tin chứng chỉ tự ký", lanFactoryBefore, lan.sslSocketFactory)
        assertNotSame("hostname verifier cũng phải được thay (SAN có thể chưa kịp cập nhật IP mới)", lanVerifierBefore, lan.hostnameVerifier)
        assertEquals(ip, lan.url.host)
        lan.disconnect()

        val foreign = URL("https://evil.example/app/ping").openConnection() as HttpsURLConnection
        // Host lạ: KHÔNG được đổi gì — giữ nguyên xác thực TLS mặc định của JVM/Android.
        val foreignFactoryBefore = foreign.sslSocketFactory
        val foreignVerifierBefore = foreign.hostnameVerifier
        TlsPolicy.applyTo(foreign, setOf(ip))
        assertSame("host lạ: giữ nguyên SSL socket factory", foreignFactoryBefore, foreign.sslSocketFactory)
        assertSame("host lạ: giữ nguyên hostname verifier", foreignVerifierBefore, foreign.hostnameVerifier)
        foreign.disconnect()
    }

    @Test
    fun lan_hosts_of_chi_lay_host_lan() {
        assertEquals(setOf(ip), TlsPolicy.lanHostsOf("https://$ip:18443/app/ping"))
        assertEquals(emptySet<String>(), TlsPolicy.lanHostsOf("https://hass.example.com/app/ping"))
        assertEquals(setOf("localhost"), TlsPolicy.lanHostsOf("https://localhost:18443/app/ping"))
    }
}

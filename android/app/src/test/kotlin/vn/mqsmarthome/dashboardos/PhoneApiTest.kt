package vn.mqsmarthome.dashboardos

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * (10/11/2026) GD2 — dựng URL API từ địa chỉ máy chủ.
 * (30/10/2026) GD4 — app KHÔNG còn suy ra gốc API từ URL trang: [ServerResolver] dò ra `apiBase`
 * (`http://192.168.10.2:18080` hoặc `https://hass.example.com/b39feb53_remote_webview_server`) và lưu vào [Prefs];
 * các hàm dưới đây nhận THẲNG `apiBase` đó.
 *
 * Chỉ kiểm tra phần THUẦN (java.net), không chạm API Android: chạy bằng `./gradlew testDebugUnitTest`.
 */
class PhoneApiTest {

    private val lan = "http://192.168.1.10:18080"
    private val ingress = "https://hass.mqsmarthome.io.vn/b39feb53_remote_webview_server"

    @Test
    fun apiUrl_noi_duong_dan_vao_goc_api() {
        assertEquals("$ingress/app/incoming?phone=abc", PhoneApi.apiUrl(ingress, "app/incoming?phone=abc"))
        assertEquals("$lan/app/register", PhoneApi.apiUrl(lan, "/app/register"))
    }

    @Test
    fun apiUrl_giu_tien_to_ingress_cua_apiBase() {
        // apiBase đã có tiền tố /b39... — KHÔNG được cắt mất (đây là lỗi của cách suy ra cũ).
        assertEquals("$ingress/app/list", PhoneApi.apiUrl(ingress, "app/list"))
    }

    @Test
    fun apiUrl_bo_dau_gach_cuoi_va_tu_choi_base_rong() {
        assertEquals("$lan/app/list", PhoneApi.apiUrl("$lan/", "app/list"))
        assertNull(PhoneApi.apiUrl(null, "app/list"))
        assertNull(PhoneApi.apiUrl("", "app/list"))
        assertNull(PhoneApi.apiUrl("   ", "app/list"))
        assertNull(PhoneApi.apiUrl("192.168.1.10:18080", "app/list"))
        assertNull(PhoneApi.apiUrl("ftp://hass.local", "app/list"))
    }

    @Test
    fun webUrl_mo_trang_goi_trong_cung_thu_muc() {
        assertEquals("$ingress/call-web.html?call=abc", PhoneApi.webUrl(ingress, "call-web.html", "call=abc"))
        assertEquals("$lan/call-web.html?call=abc", PhoneApi.webUrl(lan, "call-web.html", "?call=abc"))
        assertEquals("$lan/call-web.html", PhoneApi.webUrl(lan, "call-web.html"))
        assertNull(PhoneApi.webUrl(null, "call-web.html", "call=abc"))
    }

    @Test
    fun deviceKeyOf_dung_ANDROID_ID_khi_co() {
        // (GD8) ANDROID_ID on dinh qua cac lan cai lai app -> server gop ban ghi trung theo khoa nay.
        assertEquals("9774d56d682e549c", PhoneApi.deviceKeyOf("9774d56d682e549c", "id-trong-prefs"))
        assertEquals("9774d56d682e549c", PhoneApi.deviceKeyOf("  9774d56d682e549c  ", "id-trong-prefs"))
    }

    @Test
    fun deviceKeyOf_roi_ve_id_hien_tai_khi_may_khong_tra_ANDROID_ID() {
        assertEquals("id-trong-prefs", PhoneApi.deviceKeyOf(null, "id-trong-prefs"))
        assertEquals("id-trong-prefs", PhoneApi.deviceKeyOf("", "id-trong-prefs"))
        assertEquals("id-trong-prefs", PhoneApi.deviceKeyOf("   ", "id-trong-prefs"))
        assertEquals("", PhoneApi.deviceKeyOf(null, ""))
    }
}

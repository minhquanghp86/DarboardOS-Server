package vn.mqsmarthome.dashboardos

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * (20/11/2026) GD12 — kiểm tra phần THUẦN của luồng "tự tạo phiên ingress BÊN TRONG WebView".
 *
 * Bối cảnh đã kiểm chứng (xem KDoc của [HaIngress]): bản GD10 gọi `POST /api/hassio/ingress/session[/<slug>]` bằng
 * `HttpURLConnection` — endpoint đó không phải API của HA core nên luôn 401. HA frontend dùng WebSocket
 * `supervisor/api` `endpoint=/ingress/session` rồi tự đặt `document.cookie` với `path=/api/hassio_ingress/`.
 *
 * Ở đây khoá lại:
 *  1. đoạn JS phát ra **đúng** command/endpoint/cookie như bundle frontend đang chạy, và có slug đã escape,
 *  2. đọc JSON bridge ([`HaIngress.parseResult`]) — kể cả trường hợp lỗi/không hợp lệ,
 *  3. session token phải "an toàn" (không thể phá cookie) — [`HaIngress.isSafeSession`],
 *  4. giá trị cookie + dòng log `[login] step=… result=…` ([`HaIngress.cookieValue`], [`HaIngress.logLine`]).
 *
 * Chạy: `cd android && ./gradlew testDebugUnitTest --offline --no-daemon`.
 */
class HaIngressTest {

    // ─────────────────────────────────────────── 1) đoạn JS chạy trong trang HA

    @Test
    fun script_dung_command_websocket_va_endpoint_cua_frontend() {
        val js = HaIngress.sessionScript("b39feb53_remote_webview_server")
        // Command tổng hợp của core (đang dùng trên hass.mqsmarthome.io.vn) + endpoint Supervisor.
        assertTrue(js.contains("type: \"${HaIngress.WS_TYPE_PROXY}\""))
        assertTrue(js.contains("endpoint: \"${HaIngress.ENDPOINT_SESSION}\""))
        assertTrue(js.contains("method: \"post\""))
        // Dự phòng cho bản frontend mới (command riêng, cần slug).
        assertTrue(js.contains("\"${HaIngress.WS_TYPE_SESSION}\""))
        // WebSocket của HA + làm mới token bằng REST.
        assertTrue(js.contains("/api/websocket"))
        assertTrue(js.contains("/auth/token"))
        assertTrue(js.contains("hassTokens"))
        // Nhanh nhất: dùng chính đối tượng hass của frontend.
        assertTrue(js.contains("home-assistant"))
        assertTrue(js.contains("callWS"))
    }

    @Test
    fun script_dat_cookie_dung_path_nhu_frontend() {
        val js = HaIngress.sessionScript()
        assertEquals("/api/hassio_ingress/", HaIngress.COOKIE_PATH)
        assertTrue(js.contains("ingress_session="))
        assertTrue(js.contains(";path=/api/hassio_ingress/;SameSite=Strict"))
        assertTrue(js.contains(";Secure"))
        // Cookie phải do JS trong trang đặt (để vào cookie store của WebView) — KHÔNG dùng fetch tới một endpoint
        // HTTP "tạo phiên" (đường đó đã chứng minh luôn 401).
        assertTrue(js.contains("document.cookie ="))
        assertFalse(js.contains("/api/hassio/ingress/session"))
    }

    @Test
    fun script_bao_ket_qua_qua_bridge_va_da_thay_slug() {
        val slug = "b39feb53_remote_webview_server"
        val js = HaIngress.sessionScript(slug)
        assertTrue(js.contains(HaIngress.BRIDGE))
        assertTrue(js.contains("postResult"))
        assertTrue(js.contains("var SLUG = \"$slug\";"))
        assertFalse("placeholder phải được thay hết", js.contains("__DASHBOARDOS_SLUG__"))
        // Slug do người dùng cấu hình: phải escape để không phá literal JS.
        val evil = HaIngress.sessionScript("a\"b\\c")
        assertTrue(evil.contains("var SLUG = \"a\\\"b\\\\c\";"))
        assertFalse(evil.contains("var SLUG = \"a\"b"))
    }

    // ─────────────────────────────────────────── 2) đọc JSON bridge

    @Test
    fun doc_ket_qua_buoc_tao_phien_thanh_cong() {
        val r = HaIngress.parseResult(
            "{\"step\":\"session\",\"ok\":true,\"session\":\"fhdsu73rh3io4h8f3irhjel8ousafehf8f3yh\",\"how\":\"socket\",\"cookie\":true}"
        )
        assertNotNull(r)
        assertEquals(HaIngress.STEP_SESSION, r!!.step)
        assertTrue(r.ok)
        assertTrue(r.cookie)
        assertEquals("socket", r.how)
        assertTrue(r.sessionReady)
    }

    @Test
    fun doc_ket_qua_that_bai_va_buoc_token() {
        val fail = HaIngress.parseResult("{\"step\":\"session\",\"ok\":false,\"detail\":\"auth_invalid\"}")
        assertEquals(HaIngress.STEP_SESSION, fail!!.step)
        assertFalse(fail.ok)
        assertEquals("auth_invalid", fail.detail)
        assertNull(fail.session)
        assertFalse(fail.sessionReady)

        val token = HaIngress.parseResult("{\"step\":\"token\",\"ok\":true,\"detail\":\"hass\"}")
        assertEquals(HaIngress.STEP_TOKEN, token!!.step)
        assertTrue(token.ok)
        assertEquals("hass", token.detail)
        // Bước `token` KHÔNG BAO GIỜ được coi là "đã có phiên".
        assertFalse(token.sessionReady)
    }

    @Test
    fun json_la_khong_doc_duoc_thi_tra_null() {
        assertNull(HaIngress.parseResult(null))
        assertNull(HaIngress.parseResult(""))
        assertNull(HaIngress.parseResult("null"))
        assertNull(HaIngress.parseResult("<html>loi</html>"))
        // Thiếu `step` → không phải kết quả của script.
        assertNull(HaIngress.parseResult("{\"ok\":true,\"session\":\"abc\"}"))
    }

    @Test
    fun chuoi_dai_va_escape_trong_json_van_doc_dung() {
        val r = HaIngress.parseResult(
            "{ \"step\" : \"session\" , \"ok\" : true , \"session\" : \"abc-123_xyz\" , \"detail\" : \"a\\\"b\" }"
        )
        assertEquals("abc-123_xyz", r!!.session)
        assertEquals("a\"b", r.detail)
    }

    // ─────────────────────────────────────────── 3) session token an toàn

    @Test
    fun session_phai_la_chuoi_an_toan() {
        assertTrue(HaIngress.isSafeSession("fhdsu73rh3io4h8f3irhjel8ousafehf8f3yh"))
        assertTrue(HaIngress.isSafeSession("a1b2-c3d4_e5f6.g7h8"))
        assertFalse("quá ngắn", HaIngress.isSafeSession("abc"))
        assertFalse("rỗng", HaIngress.isSafeSession(""))
        assertFalse("null", HaIngress.isSafeSession(null))
        assertFalse("có khoảng trắng", HaIngress.isSafeSession("abc def ghi"))
        assertFalse("có ';' (phá cookie)", HaIngress.isSafeSession("abcdefgh;path=/"))
        assertFalse("có xuống dòng", HaIngress.isSafeSession("abcdefgh\nSet-Cookie: x=y"))
    }

    // ─────────────────────────────────────────── 4) cookie + log

    @Test
    fun gia_tri_cookie_dung_nhu_frontend() {
        assertEquals(
            "ingress_session=abc123; Path=/api/hassio_ingress/; Secure",
            HaIngress.cookieValue("abc123", secure = true)
        )
        assertEquals(
            "ingress_session=abc123; Path=/api/hassio_ingress/",
            HaIngress.cookieValue("  abc123  ", secure = false)
        )
    }

    @Test
    fun dong_log_tung_buoc_dung_dinh_dang_yeu_cau() {
        assertEquals("[login] step=token result=ok how=hass", HaIngress.logLine("token", "ok", "how=hass"))
        assertEquals("[login] step=session result=fail", HaIngress.logLine("session", "fail"))
        assertEquals(
            "[login] step=nav result=pending url=…/api/hassio_ingress/KJjH…/launcher-config.html",
            HaIngress.logLine(
                HaIngress.STEP_NAV,
                "pending",
                "url=" + DashboardTarget.shortUrl(
                    "https://hass.mqsmarthome.io.vn/api/hassio_ingress/KJjH_rSB8SdDeyjszvdZnnH1pRlxySfVG5VmgDMVf38/launcher-config.html"
                )
            )
        )
        // Rỗng vẫn phải ra dòng hợp lệ (không ném lỗi).
        assertEquals("[login] step=- result=-", HaIngress.logLine("  ", " "))
    }
}

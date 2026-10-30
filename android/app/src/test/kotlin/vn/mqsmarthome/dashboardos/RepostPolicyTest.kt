package vn.mqsmarthome.dashboardos

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * (23/11/2026) GD10 — "NHẠC CHUÔNG PHÁT LẠI MỖI 5 GIÂY" (bản nhạc dài nghe như bị cắt/lặp).
 *
 * Nguyên nhân: thông báo cuộc gọi được ĐĂNG LẠI mỗi 4 s ([RepostPolicy.LEGACY_REPOST_MS]); mỗi lần đăng lại là kênh
 * phát nhạc chuông LẠI TỪ ĐẦU. Nay nhịp là [RepostPolicy.DEFAULT_MS] = 30 s (yêu cầu ≥ 25 s): chỉ đăng lại khi bản
 * nhạc đã phát xong, bản nhạc dài hơn 30 s thì thực tế chỉ đăng MỘT lần.
 *
 * Chỉ kiểm tra phần THUẦN (`./gradlew testDebugUnitTest`), không chạm API Android.
 */
class RepostPolicyTest {

    private val post = 1_000_000L

    @Test
    fun nhip_moi_toi_thieu_25_giay() {
        // Yêu cầu người dùng: khoảng cách giữa 2 lần re-post phải ≥ 25 s.
        assertTrue(RepostPolicy.DEFAULT_MS >= 25_000L)
        assertTrue(RepostPolicy.repostMs() >= 25_000L)
        // Bản cũ (4 s) là nguyên nhân cắt nhạc chuông -> không được dùng lại.
        assertTrue(RepostPolicy.DEFAULT_MS > RepostPolicy.LEGACY_REPOST_MS)
    }

    @Test
    fun khong_dang_lai_truoc_25_giay() {
        for (dt in longArrayOf(0L, 1L, 1_000L, 4_000L, 5_000L, 10_000L, 24_999L)) {
            assertFalse("không được re-post sau ${dt}ms", RepostPolicy.due(post, post + dt))
        }
    }

    @Test
    fun dang_lai_khi_da_qua_nhip_30_giay() {
        assertTrue(RepostPolicy.due(post, post + 30_000L))
        assertTrue(RepostPolicy.due(post, post + 45_000L))
    }

    @Test
    fun chua_dang_lan_nao_thi_khong_tinh_la_den_nhip() {
        // Lần đăng ĐẦU TIÊN do notifyIncoming() lo; `due` chỉ quyết định lần ĐĂNG LẠI.
        assertFalse(RepostPolicy.due(0L, 9_999_999L))
        assertFalse(RepostPolicy.due(-1L, 9_999_999L))
    }

    @Test
    fun nhip_duoc_truyen_vao_de_test_va_chinh_sach_rieng() {
        // Tham số `repostMs` cho phép kiểm tra chính sách mà không phụ thuộc hằng số hiện hành.
        assertFalse(RepostPolicy.due(post, post + 999L, 1_000L))
        assertTrue(RepostPolicy.due(post, post + 1_000L, 1_000L))
        // Nhịp ≤ 0 = luôn đăng lại (chỉ dùng khi test/khẩn cấp).
        assertTrue(RepostPolicy.due(post, post, 0L))
    }

    @Test
    fun ban_nhac_dai_hon_nhip_thi_that_te_chi_dang_mot_lan() {
        // Cuộc gọi đổ chuông tối đa 30 s (RING_S bên server) -> chuông kêu trọn bản nhạc rồi cuộc gọi hết:
        // trong suốt 30 s đó không có lần đăng lại nào.
        val ringMs = 30_000L
        var reposts = 0
        var lastPost = post
        var now = post
        while (now - post < ringMs) {
            now += 2_000L                                   // poll 2 s như PhoneService.POLL_MS
            if (RepostPolicy.due(lastPost, now)) { reposts++; lastPost = now }
        }
        assertTrue("re-post quá nhiều lần trong 30 s: $reposts", reposts <= 1)
    }
}

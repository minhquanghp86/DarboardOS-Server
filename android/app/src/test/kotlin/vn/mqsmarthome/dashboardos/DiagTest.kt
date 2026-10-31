package vn.mqsmarthome.dashboardos

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * (28/11/2026) GD16 — khoá lại **BỘ GHI LOG VÒNG [Diag]** (yêu cầu: 300 dòng, mỗi dòng có `HH:mm:ss`, đồng thời ra
 * Logcat). Đây là thứ người dùng gửi cho hỗ trợ (Cài đặt → Chẩn đoán → Sao chép), nên phải đúng.
 *
 * Chạy: `cd android && ./gradlew testDebugUnitTest --offline --no-daemon`.
 */
class DiagTest {

    private val savedSink = Diag.sink
    private val savedTime = Diag.timeSource
    private var now: Long = 1_700_000_000_000L

    @Before
    fun setUp() {
        Diag.clear()
        now = 1_700_000_000_000L
        Diag.timeSource = { now }
        // Logcat không tồn tại trên JVM — chỉ giữ trong bộ nhớ.
        Diag.sink = null
    }

    @After
    fun tearDown() {
        Diag.clear()
        Diag.sink = savedSink
        Diag.timeSource = savedTime
    }

    @Test
    fun giu_toi_da_300_dong_va_bo_dong_cu_nhat() {
        for (i in 1..350) Diag.log("dòng $i")
        assertEquals(Diag.CAPACITY, Diag.count())
        assertEquals(300, Diag.snapshot().size)
        // Dòng cũ nhất còn lại là dòng 51 (1..50 đã bị bỏ), dòng mới nhất là 350.
        assertTrue(Diag.snapshot().first().endsWith("dòng 51"))
        assertTrue(Diag.snapshot().last().endsWith("dòng 350"))
    }

    @Test
    fun moi_dong_co_tien_to_thoi_gian_hh_mm_ss() {
        Diag.log("[nav] url=…/b39feb53_remote_webview_server ok=panel")
        val line = Diag.snapshot().single()
        val time = line.substringBefore(' ')
        assertEquals(8, time.length)
        assertTrue(
            "phải là HH:mm:ss nhưng là <$time>",
            Regex("^\\d{2}:\\d{2}:\\d{2}$").matches(time)
        )
        assertEquals("$time [nav] url=…/b39feb53_remote_webview_server ok=panel", line)
    }

    @Test
    fun thoi_gian_thay_doi_theo_dong_ho() {
        Diag.log("a")
        now += 65_000   // +1 phút 5 giây
        Diag.log("b")
        val first = Diag.snapshot()[0].substringBefore(' ')
        val second = Diag.snapshot()[1].substringBefore(' ')
        assertEquals("cùng định dạng", 8, second.length)
        assertTrue("phải khác nhau sau 65 s: $first vs $second", first != second)
    }

    @Test
    fun format_time_dung_hh_mm_ss() {
        val t = Diag.formatTime(1_700_000_000_000L)
        assertEquals(8, t.length)
        assertTrue(Regex("^\\d{2}:\\d{2}:\\d{2}$").matches(t))
    }

    @Test
    fun bo_qua_dong_rong_va_cat_khoang_trang() {
        Diag.log("")
        Diag.log("   ")
        Diag.log(null)
        assertEquals(0, Diag.count())
        Diag.log("  [login] step=nav result=pending  ")
        assertTrue(Diag.snapshot().single().endsWith("[login] step=nav result=pending"))
    }

    @Test
    fun sink_nhan_dong_tho_khong_kem_thoi_gian() {
        val got = ArrayList<String>()
        Diag.sink = { got.add(it) }
        Diag.log("[promote] fire reason=panel_timer session=no")
        assertEquals(listOf("[promote] fire reason=panel_timer session=no"), got)
        // Buffer vẫn có tiền tố thời gian.
        assertTrue(Diag.snapshot().single().endsWith("[promote] fire reason=panel_timer session=no"))
    }

    @Test
    fun sink_nem_loi_khong_lam_hong_log() {
        Diag.sink = { throw IllegalStateException("logcat chết") }
        Diag.log("[api] base=… code=401")
        assertEquals(1, Diag.count())
    }

    @Test
    fun xoa_log_va_text_noi_bang_xuong_dong() {
        Diag.log("[nav] a")
        Diag.log("[nav] b")
        val text = Diag.text()
        assertEquals(2, text.lines().size)
        assertTrue(text.lines()[0].endsWith("[nav] a"))
        assertTrue(text.lines()[1].endsWith("[nav] b"))
        Diag.clear()
        assertEquals(0, Diag.count())
        assertEquals("", Diag.text())
    }
}

package vn.mqsmarthome.dashboardos

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * (1.7) Kiểm tra phần THUẦN của **BONG BÓNG “KẾT NỐI” KÉO ĐƯỢC** ([BubbleDrag]) — đúng 4 yêu cầu của người dùng:
 *
 *  1. **tap vs kéo**: tap ⇔ dịch chuyển < 8dp **và** < 200 ms (yêu cầu 2 + 3); 199 ms vẫn là tap, 200 ms là kéo;
 *  2. **kéo tự do trong màn hình**: mọi vị trí sau khi kéo đều nằm trong khung, không âm, không ra ngoài
 *     (kể cả khi khung chưa bố cục — `width`/`height` = 0);
 *  3. **nhớ vị trí theo TỈ LỆ** (yêu cầu 4): px → tỉ lệ → px trên khung MỚI (xoay ngang / đổi độ phân giải) vẫn ở đúng
 *     góc tương ứng, và tỉ lệ luôn ∈ [0, 1] để lưu vào `Prefs` an toàn;
 *  4. **mặc định góc phải trên** cách mép 12dp và nằm DƯỚI status bar khi cửa sổ vẽ tràn (`topInsetPx` > 0).
 *
 * Chạy: `cd android && ./gradlew testDebugUnitTest --offline --no-daemon`.
 */
class BubbleDragTest {

    // ─────────────────────────────────────────── 1) tap / kéo

    @Test
    fun bam_nhanh_khong_di_chuyen_la_tap() {
        assertTrue(BubbleDrag.isTap(0f, 0f, 0L, 8f))
        assertTrue("rung tay 3dp, 150 ms ⇒ vẫn là bấm", BubbleDrag.isTap(3f, 0f, 150L, 8f))
        assertTrue("199 ms vẫn tính là bấm", BubbleDrag.isTap(1f, 1f, 199L, 8f))
    }

    @Test
    fun giu_lau_hon_200ms_la_keo() {
        assertFalse("đúng 200 ms ⇒ KÉO (không mở màn Kết nối)", BubbleDrag.isTap(0f, 0f, 200L, 8f))
        assertFalse(BubbleDrag.isTap(0f, 0f, 2000L, 8f))
    }

    @Test
    fun di_chuyen_tu_8dp_tro_len_la_keo() {
        assertFalse("đúng 8dp ⇒ KÉO", BubbleDrag.isTap(8f, 0f, 50L, 8f))
        assertFalse(BubbleDrag.isTap(0f, -8f, 50L, 8f))
        // Chéo: 5,5dp ≈ 7,07dp < 8dp ⇒ vẫn là bấm.
        assertTrue(BubbleDrag.isTap(5f, 5f, 50L, 8f))
        // Chéo: 6,6dp ≈ 9,3dp > 8dp ⇒ kéo.
        assertFalse(BubbleDrag.isTap(6f, 6f, 50L, 8f))
    }

    @Test
    fun gia_tri_khong_hop_le_khong_bao_gio_la_tap() {
        assertFalse(BubbleDrag.isTap(Float.NaN, 0f, 10L, 8f))
        assertFalse(BubbleDrag.isTap(0f, Float.POSITIVE_INFINITY, 10L, 8f))
        assertFalse("thời lượng âm (không xảy ra) ⇒ không phải bấm", BubbleDrag.isTap(0f, 0f, -1L, 8f))
    }

    // ─────────────────────────────────────────── 2) kép trong khung

    @Test
    fun keo_ra_ngoai_bi_kep_vao_trong_khung() {
        val size = 132   // 44dp @ 3x
        val w = 1080
        val h = 1920
        // Kéo quá mép phải/đáy.
        val far = BubbleDrag.clamp(BubbleDrag.Pos(5000f, 5000f), w, h, size)
        assertEquals((w - size).toFloat(), far.x, 0.001f)
        assertEquals((h - size).toFloat(), far.y, 0.001f)
        // Kéo quá mép trái/trên.
        val neg = BubbleDrag.clamp(BubbleDrag.Pos(-50f, -50f), w, h, size)
        assertEquals(0f, neg.x, 0.001f)
        assertEquals(0f, neg.y, 0.001f)
    }

    @Test
    fun khong_chui_len_tren_status_bar() {
        val size = 132
        val inset = 72
        val p = BubbleDrag.clamp(BubbleDrag.Pos(10f, 0f), 1080, 1920, size, inset)
        assertEquals("y nhỏ nhất = status bar", 72f, p.y, 0.001f)
    }

    @Test
    fun khung_chua_bo_cuc_khong_lam_no_ham() {
        // Ngay sau setContentView, FrameLayout có thể còn 0x0.
        val p = BubbleDrag.clamp(BubbleDrag.Pos(10f, 10f), 0, 0, 132)
        assertEquals(0f, p.x, 0.001f)
        assertEquals(0f, p.y, 0.001f)
        val r = BubbleDrag.ratioOf(BubbleDrag.Pos(10f, 10f), 0, 0, 132)
        assertTrue(r.x in 0f..1f && r.y in 0f..1f)
    }

    // ─────────────────────────────────────────── 3) nhớ vị trí theo tỉ lệ

    @Test
    fun ti_le_luon_trong_khoang_0_1() {
        val size = 132
        val r = BubbleDrag.ratioOf(BubbleDrag.Pos(100f, 300f), 1080, 1920, size)
        assertTrue(r.x in 0f..1f)
        assertTrue(r.y in 0f..1f)
    }

    @Test
    fun goc_phai_tren_giu_nguyen_khi_xoay_ngang() {
        val size = 132
        // Đang ở góc phải TRÊN của màn dọc.
        val portrait = BubbleDrag.defaultPos(1080, 1920, size, 36)
        val ratio = BubbleDrag.ratioOf(portrait, 1080, 1920, size)
        // Sát mép phải / sát mép trên: 12dp trên quãng đi được nên tỉ lệ KHÔNG phải 1 và 0 tuyệt đối.
        assertTrue("ở sát mép phải", ratio.x > 0.95f)
        assertTrue("ở sát mép trên", ratio.y < 0.05f)
        // Xoay ngang (đổi cả kích thước): vẫn ở góc phải TRÊN — tỉ lệ được bảo toàn nên khoảng cách 12dp cũng
        // co giãn theo quãng đi được của màn mới (đúng ý "lưu theo tỉ lệ").
        val rotated = BubbleDrag.fromRatio(ratio, 1920, 1080, size)
        assertTrue("vẫn ở 10% phải của màn", rotated.x >= (1920 - size) * 0.9f)
        assertTrue("vẫn ở 10% trên của màn", rotated.y <= 1080 * 0.1f)
    }

    @Test
    fun vi_tri_giua_man_giu_ty_le_khi_doi_do_phan_giai() {
        val size = 96
        val ratio = BubbleDrag.Pos(0.5f, 0.5f)
        val a = BubbleDrag.fromRatio(ratio, 1080, 1920, size)
        val b = BubbleDrag.fromRatio(ratio, 1440, 2560, size)
        assertEquals(0.5f, (a.x) / (1080 - size), 0.01f)
        assertEquals(0.5f, (b.x) / (1440 - size), 0.01f)
    }

    @Test
    fun px_sang_ti_le_roi_nguoc_lai_khong_doi_vi_tri() {
        val size = 132
        val w = 1080
        val h = 1920
        val start = BubbleDrag.Pos(400f, 700f)
        val back = BubbleDrag.fromRatio(BubbleDrag.ratioOf(start, w, h, size), w, h, size)
        assertEquals(start.x, back.x, 0.5f)
        assertEquals(start.y, back.y, 0.5f)
    }

    // ─────────────────────────────────────────── 4) mặc định góc phải trên

    @Test
    fun mac_dinh_goc_phai_tren_cach_mep_12dp() {
        val size = 132
        val gap = 36
        val p = BubbleDrag.defaultPos(1080, 1920, size, gap)
        assertEquals((1080 - size - gap).toFloat(), p.x, 0.001f)
        assertEquals(gap.toFloat(), p.y, 0.001f)
    }

    @Test
    fun mac_dinh_nam_duoi_status_bar() {
        val size = 132
        val gap = 36
        val inset = 72
        val p = BubbleDrag.defaultPos(1080, 1920, size, gap, inset)
        assertEquals("12dp dưới status bar", (inset + gap).toFloat(), p.y, 0.001f)
    }

    @Test
    fun hang_so_theo_yeu_cau() {
        assertEquals(44, BubbleDrag.SIZE_DP)
        assertEquals(8, BubbleDrag.TAP_SLOP_DP)
        assertEquals(200L, BubbleDrag.TAP_TIMEOUT_MS)
        assertEquals(12, BubbleDrag.EDGE_GAP_DP)
        assertEquals(0.55f, BubbleDrag.ALPHA_IDLE, 0.0001f)
        assertEquals(0.85f, BubbleDrag.ALPHA_DRAG, 0.0001f)
        assertEquals(0.4f, BubbleDrag.ALPHA_FADED, 0.0001f)
        assertEquals(5000L, BubbleDrag.FADE_AFTER_MS)
    }
}

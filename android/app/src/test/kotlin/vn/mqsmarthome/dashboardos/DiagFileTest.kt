package vn.mqsmarthome.dashboardos

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.TimeZone

/**
 * (29/11/2026) GD17 — khoá lại **quy tắc đặt tên tệp chẩn đoán** (`diag-YYYYMMDD-HHmmss.txt` /
 * `diag-auto-…txt`), **lọc giữ 5 tệp mới nhất**, **kích hoạt tự lưu khi lỗi** và các hàm hiển thị
 * (thời gian · dung lượng). Đây là phần "thuần" của tính năng Lưu ra tệp / tự lưu khi lỗi (xem [DiagFile]).
 *
 * Chạy: `cd android && ./gradlew testDebugUnitTest --offline --no-daemon`.
 */
class DiagFileTest {

    /** 1 700 000 000 000 ms = 2023-11-14 22:13:20 UTC — mốc cố định để test tất định. */
    private val t0 = 1_700_000_000_000L
    private val utc: TimeZone = TimeZone.getTimeZone("UTC")

    private fun entry(name: String, modified: Long, size: Long = 100L) =
        DiagFile.Entry(name, modified, size)

    // ── 1. đặt tên tệp ───────────────────────────────────────────────────────────────────────────────────────────

    @Test
    fun ten_tep_nguoi_dung_luu_dung_mau_va_dung_gio() {
        assertEquals("diag-20231114-221320.txt", DiagFile.manualName(t0, utc))
        assertTrue(DiagFile.isDiagFile(DiagFile.manualName(t0, utc)))
    }

    @Test
    fun ten_tep_tu_luu_co_tien_to_diag_auto() {
        assertEquals("diag-auto-20231114-221320.txt", DiagFile.autoName(t0, utc))
        assertTrue(DiagFile.isDiagFile(DiagFile.autoName(t0, utc)))
        assertTrue(entry("diag-auto-20231114-221320.txt", 0L).isAuto)
        assertFalse(entry("diag-20231114-221320.txt", 0L).isAuto)
    }

    @Test
    fun moi_giay_mot_ten_khac_nhau() {
        val names = (0 until 5).map { DiagFile.manualName(t0 + it * 1000L, utc) }
        assertEquals(5, names.toSet().size)
        assertEquals("diag-20231114-221321.txt", names[1])
        assertEquals("diag-20231114-221324.txt", names[4])
        // Tên tăng dần theo thời gian ⇒ sắp xếp theo tên cũng là sắp xếp theo thời gian.
        assertEquals(names.sorted(), names)
    }

    @Test
    fun chi_nhan_dung_mau_tep_chan_doan() {
        assertTrue(DiagFile.isDiagFile("diag-20231114-221320.txt"))
        assertTrue(DiagFile.isDiagFile("diag-auto-20231114-221320.txt"))
        assertFalse(DiagFile.isDiagFile("diag-2023-11-14.txt"))
        assertFalse(DiagFile.isDiagFile("diag-20231114-221320.txt.bak"))
        assertFalse(DiagFile.isDiagFile("notes.txt"))
        assertFalse(DiagFile.isDiagFile("diag-auto-20231114-221320"))
        assertFalse(DiagFile.isDiagFile(null))
    }

    @Test
    fun ten_tep_an_toan_cho_content_uri() {
        assertTrue(DiagFile.isSafeName("diag-20231114-221320.txt"))
        assertFalse(DiagFile.isSafeName("../diag-20231114-221320.txt"))
        assertFalse(DiagFile.isSafeName("diag-..-20231114.txt"))
        assertFalse(DiagFile.isSafeName("a/b.txt"))
        assertFalse(DiagFile.isSafeName(null))
    }

    // ── 2. giữ 5 tệp mới nhất ───────────────────────────────────────────────────────────────────────────────────

    @Test
    fun giu_dung_5_tep_moi_nhat_va_xep_moi_truoc() {
        // 7 tệp, mỗi tệp cách nhau 1 phút; tệp 1 là cũ nhất.
        val entries = (1..7).map { entry(DiagFile.manualName(t0 + it * 60_000L, utc), t0 + it * 60_000L) }
        val kept = DiagFile.newest(entries, DiagFile.MAX_FILES)
        assertEquals(5, kept.size)
        assertEquals(DiagFile.MAX_FILES, DiagFile.MAX_FILES)
        assertTrue("mới nhất đứng đầu", kept.first().modifiedMs > kept.last().modifiedMs)
        assertEquals(entries[6].name, kept.first().name)   // tệp 7
        assertEquals(entries[2].name, kept.last().name)    // tệp 3
    }

    @Test
    fun chi_xoa_tep_cu_vuot_qua_5_va_bo_qua_tep_la() {
        val entries = (1..7).map { entry(DiagFile.autoName(t0 + it * 60_000L, utc), t0 + it * 60_000L) } +
            entry("khong-phai-chan-doan.txt", t0 + 999_000L)
        val delete = DiagFile.deleteCandidates(entries, DiagFile.MAX_FILES)
        assertEquals(2, delete.size)
        // Cũ nhất bị xoá trước; tệp lạ (không đúng mẫu) KHÔNG bị chạm tới.
        assertEquals(entries[0].name, delete[0].name)
        assertEquals(entries[1].name, delete[1].name)
    }

    @Test
    fun duoi_5_tep_thi_khong_xoa_gi() {
        val entries = (1..3).map { entry(DiagFile.manualName(t0 + it * 1000L, utc), t0 + it * 1000L) }
        assertTrue(DiagFile.deleteCandidates(entries, DiagFile.MAX_FILES).isEmpty())
        assertEquals(3, DiagFile.newest(entries, DiagFile.MAX_FILES).size)
    }

    @Test
    fun cung_thoi_diem_thi_sap_xep_tat_dinh_theo_ten() {
        val a = entry("diag-20231114-221320.txt", t0)
        val b = entry("diag-auto-20231114-221320.txt", t0)
        val kept = DiagFile.newest(listOf(a, b), 1)
        assertEquals(1, kept.size)
        assertEquals(b.name, kept.first().name)   // tên lớn hơn ("diag-auto…") đứng trước
    }

    // ── 3. tự lưu khi lỗi ───────────────────────────────────────────────────────────────────────────────────────

    @Test
    fun tu_luu_khi_promote_fail() {
        assertTrue(DiagFile.shouldAutoSave("[promote] url=…/b39feb53 ok=fail fail=401 fallback=panel"))
        assertTrue(DiagFile.shouldAutoSave("[promote] url=…/launcher-config.html ok=401 fail=root-not-addon fallback=panel"))
        assertTrue(DiagFile.shouldAutoSave("[promote] url=… ok=fail fail=timeout fallback=panel"))
    }

    @Test
    fun tu_luu_khi_gap_401_o_bat_ky_dong_nao() {
        assertTrue(DiagFile.shouldAutoSave("[nav] url=…/b39feb53_remote_webview_server ok=401 cookie=no"))
        assertTrue(DiagFile.shouldAutoSave("[api] base=…/api/hassio_ingress/TOK code=401"))
        assertTrue(DiagFile.shouldAutoSave("HTTP 401 Unauthorized"))
    }

    @Test
    fun khong_tu_luu_khi_binh_thuong() {
        assertFalse(DiagFile.shouldAutoSave("[promote] url=… ok=top title=Dashboard OS"))
        assertFalse(DiagFile.shouldAutoSave("[nav] url=… ok=panel"))
        assertFalse(DiagFile.shouldAutoSave("[login] step=nav result=ok"))
        assertFalse(DiagFile.shouldAutoSave("[api] register ok id=abc"))
        // 1401 / 4010 không phải mã 401.
        assertFalse(DiagFile.shouldAutoSave("[api] bytes=1401"))
        assertFalse(DiagFile.shouldAutoSave("[api] bytes=4010"))
        assertFalse(DiagFile.shouldAutoSave(""))
        assertFalse(DiagFile.shouldAutoSave("   "))
        assertFalse(DiagFile.shouldAutoSave(null))
    }

    @Test
    fun gian_cach_toi_thieu_30_giay_giua_hai_lan_tu_luu() {
        assertTrue("lần đầu luôn được", DiagFile.autoSaveAllowed(1_000_000L, 0L))
        assertFalse("trong 30 s thì bỏ", DiagFile.autoSaveAllowed(1_010_000L, 1_000_000L))
        assertFalse("29,9 s vẫn bỏ", DiagFile.autoSaveAllowed(1_029_999L, 1_000_000L))
        assertTrue("đủ 30 s thì được", DiagFile.autoSaveAllowed(1_030_000L, 1_000_000L))
        assertTrue("đồng hồ lùi thì vẫn cho", DiagFile.autoSaveAllowed(500_000L, 1_000_000L))
    }

    // ── 4. hiển thị ─────────────────────────────────────────────────────────────────────────────────────────────

    @Test
    fun thoi_gian_hien_thi_dung_dinh_dang() {
        assertEquals("14/11/2023 22:13:20", DiagFile.displayTime(t0, utc))
    }

    @Test
    fun dung_luong_than_thien() {
        assertEquals("0 B", DiagFile.formatSize(0))
        assertEquals("812 B", DiagFile.formatSize(812))
        assertEquals("1.0 kB", DiagFile.formatSize(1024))
        assertEquals("12.3 kB", DiagFile.formatSize(12_646))
        assertEquals("2.0 MB", DiagFile.formatSize(2L * 1024 * 1024))
        assertEquals("0 B", DiagFile.formatSize(-5))
    }

    @Test
    fun dong_danh_sach_co_ten_thoi_gian_va_dung_luong() {
        val line = DiagFile.listLine(entry("diag-20231114-221320.txt", t0, 12_646), utc)
        assertEquals("diag-20231114-221320.txt · 14/11/2023 22:13:20 · 12.3 kB", line)
    }
}

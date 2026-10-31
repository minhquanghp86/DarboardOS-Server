package vn.mqsmarthome.dashboardos

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * (2.0) — khoá lại phần **THUẦN** của tính năng **đính kèm tệp/ảnh trong WebView** ([FileChooser]):
 * `accept` của trang → MIME cho SAF, `mode` → `EXTRA_ALLOW_MULTIPLE`, action theo API, và **chuỗi log**
 * `[file] chooser …` (đọc ở Cài đặt → Chẩn đoán, không kích hoạt tự lưu).
 *
 * Chạy: `cd android && ./gradlew testDebugUnitTest --offline --no-daemon`.
 *
 * Phần còn lại (`Intent`, `startActivityForResult`, `onActivityResult`) là API của Android nên chỉ kiểm được trên
 * máy thật — quy trình ở `android/README.md` §4l.
 */
class FileChooserTest {

    // ── 1. `accept` → MIME ────────────────────────────────────────────────────────────────────────────────────────

    @Test
    fun accept_hai_mime_nhu_trang_tin_nhan() {
        // `<input type="file" id="files" accept="image/*,video/*" multiple>` của launcher-config.html.
        val mimes = FileChooser.mimeTypes(arrayOf("image/*", "video/*"))
        assertEquals(listOf("image/*", "video/*"), mimes)
        assertEquals("*/*", FileChooser.intentType(mimes))
        assertTrue("nhiều MIME phải kèm EXTRA_MIME_TYPES", FileChooser.needsMimeExtra(mimes))
    }

    @Test
    fun accept_mot_mime_dung_luon_lam_type() {
        val mimes = FileChooser.mimeTypes(arrayOf("image/*"))
        assertEquals(listOf("image/*"), mimes)
        assertEquals("image/*", FileChooser.intentType(mimes))
        assertFalse(FileChooser.needsMimeExtra(mimes))
    }

    @Test
    fun accept_gop_nhieu_gia_tri_trong_mot_chuoi() {
        assertEquals(listOf("image/*", "video/mp4"), FileChooser.mimeTypes(arrayOf("image/*, video/mp4")))
    }

    @Test
    fun accept_khong_co_thi_moi_tep() {
        // `#fmFile` (màn Tệp) không có `accept` → Chrome trả mảng rỗng/null.
        assertTrue(FileChooser.mimeTypes(null).isEmpty())
        assertTrue(FileChooser.mimeTypes(arrayOf()).isEmpty())
        assertTrue(FileChooser.mimeTypes(arrayOf("", "   ")).isEmpty())
        assertEquals("*/*", FileChooser.intentType(emptyList()))
        assertFalse(FileChooser.needsMimeExtra(emptyList()))
    }

    @Test
    fun accept_duoi_tep_bi_bo_vi_saf_chi_loc_theo_mime() {
        // `.jpg` / `jpeg` không phải MIME → bỏ; còn `image/*` thì giữ.
        assertEquals(listOf("image/*"), FileChooser.mimeTypes(arrayOf(".jpg", "jpeg", "image/*")))
        assertTrue(FileChooser.mimeTypes(arrayOf(".pdf", "*.zip", "image")).isEmpty())
    }

    @Test
    fun mime_trung_lap_duoc_khu() {
        assertEquals(listOf("image/*", "video/*"), FileChooser.mimeTypes(arrayOf("image/*", "image/*", "video/*")))
        assertEquals(listOf("image/*"), FileChooser.mimeTypes(arrayOf(" image/* ", "image/*")))
    }

    // ── 2. `mode` → chọn nhiều ───────────────────────────────────────────────────────────────────────────────────

    @Test
    fun che_do_chon_nhieu_dung_theo_mode() {
        assertTrue(FileChooser.isMultiple(FileChooser.MODE_OPEN_MULTIPLE))
        assertFalse(FileChooser.isMultiple(FileChooser.MODE_OPEN))
        assertFalse("MODE_SAVE không phải chọn nhiều", FileChooser.isMultiple(FileChooser.MODE_SAVE))
        // Giá trị phải TRÙNG hằng số của WebChromeClient.FileChooserParams (android.jar API 35).
        assertEquals(0, FileChooser.MODE_OPEN)
        assertEquals(1, FileChooser.MODE_OPEN_MULTIPLE)
        assertEquals(3, FileChooser.MODE_SAVE)
    }

    // ── 3. action theo API ───────────────────────────────────────────────────────────────────────────────────────

    @Test
    fun action_la_open_document_tu_api_19() {
        assertEquals("android.intent.action.OPEN_DOCUMENT", FileChooser.actionFor(19))
        assertEquals("android.intent.action.OPEN_DOCUMENT", FileChooser.actionFor(29))
        assertEquals("android.intent.action.OPEN_DOCUMENT", FileChooser.actionFor(35))
        assertEquals("android.intent.action.GET_CONTENT", FileChooser.actionFor(18))
    }

    @Test
    fun hang_so_framework_dung_chuoi() {
        assertEquals("android.intent.action.GET_CONTENT", FileChooser.ACTION_GET_CONTENT)
        assertEquals("android.intent.category.OPENABLE", FileChooser.CATEGORY_OPENABLE)
        assertEquals(1002, FileChooser.REQ_FILE_CHOOSER)
        assertEquals("[file]", FileChooser.LOG_PREFIX)
    }

    // ── 4. log (đọc ở Cài đặt → Chẩn đoán) ──────────────────────────────────────────────────────────────────────

    @Test
    fun dong_log_mo_hop_chon_tep() {
        assertEquals(
            "[file] chooser open mode=open_multiple mime=image/*,video/* multi=yes action=open_document",
            FileChooser.openLine(
                FileChooser.ACTION_OPEN_DOCUMENT,
                listOf("image/*", "video/*"),
                multiple = true,
                mode = FileChooser.MODE_OPEN_MULTIPLE
            )
        )
        assertEquals(
            "[file] chooser open mode=open mime=*/* multi=no action=get_content",
            FileChooser.openLine(FileChooser.ACTION_GET_CONTENT, emptyList(), multiple = false, mode = FileChooser.MODE_OPEN)
        )
    }

    @Test
    fun dong_log_chon_xong_huy_va_khong_co_app() {
        assertEquals("[file] chooser picked n=2", FileChooser.pickedLine(2))
        assertEquals("[file] chooser picked n=0", FileChooser.pickedLine(-1))
        assertEquals("[file] chooser cancel", FileChooser.cancelLine())
        assertEquals("[file] chooser noapp action=open_document", FileChooser.noAppLine(FileChooser.ACTION_OPEN_DOCUMENT))
    }

    @Test
    fun ten_mode_va_action_de_doc() {
        assertEquals("open", FileChooser.modeName(FileChooser.MODE_OPEN))
        assertEquals("open_multiple", FileChooser.modeName(FileChooser.MODE_OPEN_MULTIPLE))
        assertEquals("save", FileChooser.modeName(FileChooser.MODE_SAVE))
        assertEquals("mode(7)", FileChooser.modeName(7))
        assertEquals("open_document", FileChooser.actionName(FileChooser.ACTION_OPEN_DOCUMENT))
        assertEquals("get_content", FileChooser.actionName(FileChooser.ACTION_GET_CONTENT))
        assertEquals("-", FileChooser.actionName(null))
    }

    // ── 5. không kích hoạt tự lưu tệp chẩn đoán ──────────────────────────────────────────────────────────────────

    @Test
    fun dong_file_khong_bao_gio_tu_luu_chan_doan() {
        assertFalse(DiagFile.shouldAutoSave(FileChooser.cancelLine()))
        assertFalse(DiagFile.shouldAutoSave(FileChooser.pickedLine(3)))
        assertFalse(DiagFile.shouldAutoSave(FileChooser.noAppLine(FileChooser.ACTION_OPEN_DOCUMENT)))
        // Kể cả khi đuôi/tên tệp chứa "401" (mã lỗi ingress) — vẫn KHÔNG tự lưu.
        assertFalse(DiagFile.shouldAutoSave("[file] chooser picked n=1 name=IMG_401.jpg"))
        assertFalse(DiagFile.shouldAutoSave("[file] chooser open mime=*/* multi=no action=open_document 401"))
    }
}

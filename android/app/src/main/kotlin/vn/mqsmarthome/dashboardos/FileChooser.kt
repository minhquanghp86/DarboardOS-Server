package vn.mqsmarthome.dashboardos

/**
 * (2.0) — **ĐÍNH KÈM TỆP/ẢNH TRONG WEBVIEW (`<input type="file">`)**: phần **THUẦN** (chỉ chuỗi + số, unit test
 * được trên JVM) của `WebChromeClient.onShowFileChooser` trong [MainActivity].
 *
 * Vì sao cần: `WebView` **không tự** mở hộp chọn tệp — mọi trang có `<input type="file">` (nút **đính kèm** ở trang
 * *Tin nhắn* `#files`, nút **Tải lên** ở màn *Tệp* `#fmFile` của `launcher-config.html`) bấm vào là **im lặng**
 * (Chrome thì mở bình thường). Dự án KHÔNG dùng AndroidX nên không có `ActivityResultContracts`/`FileChooser`
 * của AndroidX: tự dựng `Intent` SAF + `startActivityForResult` là đủ và không cần thêm phụ thuộc.
 *
 * Nguyên tắc ở đây:
 *  - **SAF (`ACTION_OPEN_DOCUMENT` / `ACTION_GET_CONTENT`) — KHÔNG cần quyền bộ nhớ**: hệ thống cấp cho app quyền
 *    ĐỌC **tạm thời** đúng những tệp người dùng chọn (grant gắn với `Uri` trả về), nên **không** phải
 *    `READ_EXTERNAL_STORAGE` / `READ_MEDIA_IMAGES` và cũng **không** phải xin quyền runtime nào. Manifest vì thế
 *    không đổi (xem `android/README.md` §4l).
 *  - `accept` của trang (`FileChooserParams.acceptTypes`) được lọc lại thành MIME hợp lệ: `image/<star>,video/<star>` →
 *    2 MIME; `image/<star>` → 1 MIME (đặt luôn làm `type`); `.jpg` (đuôi tệp) → **bỏ** (SAF không lọc theo đuôi);
 *    không còn gì → `ANY_MIME`.
 *  - Log chuẩn `[file] chooser open|picked n=<số tệp>|cancel|noapp` — đọc được ở Cài đặt → **Chẩn đoán**.
 *    Tiền tố `[file]` **KHÔNG BAO GIỜ** kích hoạt tự lưu tệp chẩn đoán ([DiagFile.shouldAutoSave]).
 *
 * Tên action/category để dạng CHUỖI (không dùng `android.content.Intent`) là cố ý: file này phải chạy được trên
 * JVM trong `FileChooserTest` mà không cần `android.jar` thật. Giá trị chuỗi trùng đúng hằng số của framework.
 */
object FileChooser {

    /** Tiền tố mọi dòng log của tính năng đính kèm (không kích hoạt tự lưu — xem [DiagFile.shouldAutoSave]). */
    const val LOG_PREFIX = "[file]"

    /** Mã yêu cầu cho `startActivityForResult` / `onActivityResult` (khác [MainActivity] `REQ_WEB_MEDIA` = 1001). */
    const val REQ_FILE_CHOOSER = 1002

    // ── `WebChromeClient.FileChooserParams.MODE_*` (giá trị lấy đúng từ android.jar API 35) ───────────────────────
    const val MODE_OPEN = 0
    const val MODE_OPEN_MULTIPLE = 1
    const val MODE_SAVE = 3

    /** MIME dùng khi trang không nêu `accept` (hoặc `accept` chỉ có đuôi tệp) — "mọi tệp". */
    const val ANY_MIME = "*/*"

    // ── Hằng số framework (dạng chuỗi để file này THUẦN, xem ghi chú đầu file) ─────────────────────────────────────
    const val ACTION_OPEN_DOCUMENT = "android.intent.action.OPEN_DOCUMENT"
    const val ACTION_GET_CONTENT = "android.intent.action.GET_CONTENT"
    const val CATEGORY_OPENABLE = "android.intent.category.OPENABLE"

    /** `ACTION_OPEN_DOCUMENT` có từ API 19; dưới mức đó chỉ còn `ACTION_GET_CONTENT`. */
    const val MIN_SDK_OPEN_DOCUMENT = 19

    /**
     * Chọn action theo API: **API ≥ 19 → `ACTION_OPEN_DOCUMENT`** (trình chọn tài liệu của hệ thống, lọc MIME tốt
     * hơn, `Uri` là `content://` ổn định), ngược lại `ACTION_GET_CONTENT`. App có `minSdk = 29` nên thực tế luôn
     * dùng `ACTION_OPEN_DOCUMENT`; `ACTION_GET_CONTENT` là **dự phòng** khi máy không có DocumentsUI.
     */
    fun actionFor(sdkInt: Int): String =
        if (sdkInt >= MIN_SDK_OPEN_DOCUMENT) ACTION_OPEN_DOCUMENT else ACTION_GET_CONTENT

    /** `MODE_OPEN_MULTIPLE` ⇒ `EXTRA_ALLOW_MULTIPLE` = `true` (trang `#files` và `#fmFile` đều có `multiple`). */
    fun isMultiple(mode: Int): Boolean = mode == MODE_OPEN_MULTIPLE

    /** `mode` → tên đọc được trong log: `open` / `open_multiple` / `save` / `mode(<n>)`. */
    fun modeName(mode: Int): String = when (mode) {
        MODE_OPEN -> "open"
        MODE_OPEN_MULTIPLE -> "open_multiple"
        MODE_SAVE -> "save"
        else -> "mode(" + mode + ")"
    }

    /** Action → tên ngắn trong log: `open_document` / `get_content` / tên khác giữ nguyên. */
    fun actionName(action: String?): String = when (action?.trim()) {
        ACTION_OPEN_DOCUMENT -> "open_document"
        ACTION_GET_CONTENT -> "get_content"
        null -> "-"
        else -> action.trim()
    }

    /** MIME `type/subtype` hợp lệ để đưa cho SAF (`image/<star>`, `video/mp4`, `ANY_MIME`…). */
    private val MIME = Regex("^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*/[A-Za-z0-9*][A-Za-z0-9!#$&^_.+*-]*$")

    /**
     * `accept` của trang (`FileChooserParams.acceptTypes`) → danh sách MIME **hợp lệ, không trùng, giữ thứ tự**.
     *
     * Chấp nhận cả trường hợp Chrome gộp nhiều giá trị vào một chuỗi (`"image/<star>,video/<star>"`). Đuôi tệp (`.jpg`) và
     * chuỗi rỗng bị bỏ vì `ACTION_OPEN_DOCUMENT` chỉ lọc theo MIME.
     */
    fun mimeTypes(acceptTypes: Array<String>?): List<String> {
        if (acceptTypes == null || acceptTypes.isEmpty()) return emptyList()
        val out = LinkedHashSet<String>()
        for (raw in acceptTypes) {
            val text = raw?.trim().orEmpty()
            if (text.isEmpty()) continue
            for (part in text.split(',')) {
                val candidate = part.trim()
                if (MIME.matches(candidate)) out.add(candidate)
            }
        }
        return out.toList()
    }

    /**
     * `type` của Intent: **một** MIME thì dùng luôn MIME đó (hộp chọn tệp lọc sẵn theo `accept`), nhiều MIME hoặc
     * không có MIME nào thì `ANY_MIME` (kèm [needsMimeExtra] để vẫn lọc đúng).
     */
    fun intentType(mimeTypes: List<String>): String =
        if (mimeTypes.size == 1) mimeTypes[0] else ANY_MIME

    /** Nhiều MIME ⇒ phải kèm `Intent.EXTRA_MIME_TYPES` (SAF chỉ nhận **một** `type`). */
    fun needsMimeExtra(mimeTypes: List<String>): Boolean = mimeTypes.size > 1

    // ── Log (đọc ở Cài đặt → Chẩn đoán; KHÔNG kích hoạt tự lưu) ─────────────────────────────────────────────────────

    /** `[file] chooser open mode=open_multiple mime=image/<star>,video/<star> multi=yes action=open_document`. */
    fun openLine(action: String?, mimeTypes: List<String>, multiple: Boolean, mode: Int): String =
        LOG_PREFIX + " chooser open mode=" + modeName(mode) +
            " mime=" + (if (mimeTypes.isEmpty()) ANY_MIME else mimeTypes.joinToString(",")) +
            " multi=" + (if (multiple) "yes" else "no") +
            " action=" + actionName(action)

    /** `[file] chooser picked n=2` — số tệp THẬT SỰ nhận được từ trình chọn. */
    fun pickedLine(count: Int): String = LOG_PREFIX + " chooser picked n=" + count.coerceAtLeast(0)

    /** `[file] chooser cancel` — người dùng bấm Back / huỷ hộp chọn (đã trả `null` cho trang). */
    fun cancelLine(): String = LOG_PREFIX + " chooser cancel"

    /** `[file] chooser noapp action=open_document` — máy không có ứng dụng nào nhận Intent. */
    fun noAppLine(action: String?): String =
        LOG_PREFIX + " chooser noapp action=" + actionName(action)
}

package vn.mqsmarthome.dashboardos

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * (29/11/2026) GD17 — **QUY TẮC ĐẶT TÊN + GIỮ TỆP CHẨN ĐOÁN** (thuần, không chạm Android ⇒ unit test được trên JVM).
 *
 * Vì sao cần tệp: người dùng không có adb, và log vòng [Diag] chỉ sống trong tiến trình — chết app là mất. Tệp
 * chẩn đoán lưu ra bộ nhớ ngoài riêng của app (`Android/data/<package>/files`) để người dùng **gửi kèm** cho hỗ trợ
 * (Zalo/Telegram/Gmail…), kể cả sau khi đã tắt app.
 *
 * Hai loại tệp (cùng một thư mục, tổng cộng giữ tối đa [MAX_FILES] tệp MỚI NHẤT):
 *  - `diag-YYYYMMDD-HHmmss.txt`      — người dùng bấm **“Lưu ra tệp”** ở màn Chẩn đoán;
 *  - `diag-auto-YYYYMMDD-HHmmss.txt` — app **tự lưu** khi gặp lỗi promote (`[promote] … fail=`) hoặc 401
 *    ([shouldAutoSave]), để người dùng không phải canh đúng lúc bấm nút.
 *
 * Tệp cũ hơn bị xoá ([deleteCandidates]) — 5 tệp là đủ cho một lần hỗ trợ và không để log phình bộ nhớ máy.
 */
object DiagFile {

    /** Số tệp chẩn đoán giữ lại (tệp cũ hơn bị xoá). */
    const val MAX_FILES = 5

    /** Tiền tố tệp người dùng lưu tay. */
    const val PREFIX_MANUAL = "diag-"

    /** Tiền tố tệp app tự lưu khi lỗi. */
    const val PREFIX_AUTO = "diag-auto-"

    /** Đuôi tệp (mở được bằng mọi ứng dụng đọc văn bản). */
    const val EXTENSION = ".txt"

    /** Mẫu thời gian trong TÊN tệp. */
    const val NAME_PATTERN = "yyyyMMdd-HHmmss"

    /** Mẫu thời gian hiển thị trong danh sách tệp ở màn Chẩn đoán. */
    const val DISPLAY_PATTERN = "dd/MM/yyyy HH:mm:ss"

    /** `diag-20261129-101500.txt` / `diag-auto-20261129-101500.txt`. */
    private val NAME_REGEX = Regex("^(diag-auto|diag)-\\d{8}-\\d{6}\\.txt$")

    /** Tên tệp chỉ gồm ký tự an toàn (dùng cho `content://` — chặn `..`/`/`). */
    private val SAFE_NAME = Regex("^[A-Za-z0-9._-]+$")

    /**
     * Một tệp chẩn đoán đã có trên đĩa: `name` = tên tệp, `modifiedMs` = `File.lastModified()`,
     * `sizeBytes` = `File.length()`.
     */
    data class Entry(val name: String, val modifiedMs: Long, val sizeBytes: Long) {
        /** Tệp do app tự lưu (không phải người dùng bấm “Lưu ra tệp”). */
        val isAuto: Boolean get() = name.startsWith(PREFIX_AUTO)
    }

    /**
     * Tên tệp cho thời điểm [at]: `diag-YYYYMMDD-HHmmss.txt` (hoặc `diag-auto-…` khi [auto]).
     * [zone] chỉ để unit test tất định; mặc định = múi giờ máy.
     */
    fun fileName(auto: Boolean, at: Long, zone: TimeZone = TimeZone.getDefault()): String =
        (if (auto) PREFIX_AUTO else PREFIX_MANUAL) + stamp(at, zone) + EXTENSION

    /** Tên tệp người dùng lưu tay (nút “Lưu ra tệp”). */
    fun manualName(at: Long, zone: TimeZone = TimeZone.getDefault()): String = fileName(false, at, zone)

    /** Tên tệp app tự lưu khi lỗi. */
    fun autoName(at: Long, zone: TimeZone = TimeZone.getDefault()): String = fileName(true, at, zone)

    /** `YYYYMMDD-HHmmss` của [at]. */
    fun stamp(at: Long, zone: TimeZone = TimeZone.getDefault()): String =
        SimpleDateFormat(NAME_PATTERN, Locale.US).apply { timeZone = zone }.format(Date(at))

    /** `dd/MM/yyyy HH:mm:ss` của [at] — chuỗi hiển thị trong danh sách tệp. */
    fun displayTime(at: Long, zone: TimeZone = TimeZone.getDefault()): String =
        SimpleDateFormat(DISPLAY_PATTERN, Locale.US).apply { timeZone = zone }.format(Date(at))

    /** Tên có phải tệp chẩn đoán do app tạo (`diag-…` / `diag-auto-…` + `.txt`) không. */
    fun isDiagFile(name: String?): Boolean = name != null && NAME_REGEX.matches(name)

    /** Tên có an toàn để dựng `content://…/<name>` không (không `..`, không `/`). */
    fun isSafeName(name: String?): Boolean = name != null && SAFE_NAME.matches(name) && !name.contains("..")

    /**
     * [entries] đã sắp **mới → cũ**, chỉ giữ tệp chẩn đoán, tối đa [max] phần tử.
     * Sắp theo `modifiedMs` giảm dần; cùng thời điểm thì theo tên giảm dần (tất định).
     */
    fun newest(entries: List<Entry>, max: Int = MAX_FILES): List<Entry> {
        if (max <= 0) return emptyList()
        return entries.filter { isDiagFile(it.name) }
            .sortedWith(compareByDescending<Entry> { it.modifiedMs }.thenByDescending { it.name })
            .take(max)
    }

    /**
     * Các tệp **phải xoá** để chỉ còn [max] tệp mới nhất (cũ nhất đứng đầu).
     * Chỉ xét tệp chẩn đoán — tệp khác trong thư mục của app không bị chạm tới.
     */
    fun deleteCandidates(entries: List<Entry>, max: Int = MAX_FILES): List<Entry> {
        val keep = newest(entries, max).mapTo(HashSet()) { it.name }
        return entries.filter { isDiagFile(it.name) && it.name !in keep }
            .sortedWith(compareBy<Entry> { it.modifiedMs }.thenBy { it.name })
    }

    /** Dung lượng thân thiện: `812 B`, `12.3 kB`, `1.4 MB`. */
    fun formatSize(bytes: Long): String = when {
        bytes < 0L -> "0 B"
        bytes < 1024L -> "$bytes B"
        bytes < 1024L * 1024L -> String.format(Locale.US, "%.1f kB", bytes / 1024.0)
        else -> String.format(Locale.US, "%.1f MB", bytes / (1024.0 * 1024.0))
    }

    /** Dòng hiển thị trong danh sách: `diag-…txt · 29/11/2026 10:15:00 · 12.3 kB`. */
    fun listLine(entry: Entry, zone: TimeZone = TimeZone.getDefault()): String =
        entry.name + " · " + displayTime(entry.modifiedMs, zone) + " · " + formatSize(entry.sizeBytes)

    /**
     * (Yêu cầu 2) Dòng log này có phải **lỗi cần tự lưu tệp** không:
     *  - `[promote] … fail=<lý do>` (promote top-level thất bại), hoặc
     *  - bất kỳ dòng nào nhắc tới **401** (`ok=401`, `code=401`, `fail=401`…) — ingress thiếu phiên.
     *
     * (1.6) Dòng `[logout] …` **KHÔNG BAO GIỜ** kích hoạt tự lưu (đăng xuất là thao tác có chủ đích, và lỗi mạng
     * của bước `/app/remove` không phải sự cố cần gửi chẩn đoán) — chặn tường minh ở đây để một dòng log đăng xuất
     * không bao giờ đẻ ra tệp `diag-auto-…txt`.
     *
     * Tách riêng để unit test được ([DiagFileTest]).
     */
    fun shouldAutoSave(line: String?): Boolean {
        val text = line?.trim().orEmpty()
        if (text.isEmpty()) return false
        if (text.startsWith(Logout.LOG_PREFIX)) return false
        // (1.8) Dòng `[answer] …` (dựng/mở URL trang gọi khi bấm "Nghe") là chẩn đoán BÌNH THƯỜNG: không bao giờ tự
        // lưu tệp, kể cả khi chuỗi UUID của máy hay TOKEN ingress tình cờ chứa "401".
        if (text.startsWith(CallPageTarget.LOG_PREFIX)) return false
        if (text.startsWith(IngressPromote.LOG_PREFIX) && text.contains("fail=")) return true
        return HTTP_401.containsMatchIn(text)
    }

    /** `401` đứng riêng (không dính chữ số khác) — bắt `ok=401`, `fail=401`, `HTTP 401`, `401:`… */
    private val HTTP_401 = Regex("(?<!\\d)401(?!\\d)")

    /**
     * (Yêu cầu 2) Có được phép tự lưu **bây giờ** không: giãn cách tối thiểu [minIntervalMs] giữa hai lần tự lưu để
     * một chuỗi lỗi (promote thử 3 lần liền) không đẻ ra 3 tệp trùng nội dung.
     */
    fun autoSaveAllowed(
        nowMs: Long,
        lastSaveMs: Long,
        minIntervalMs: Long = MIN_AUTO_INTERVAL_MS
    ): Boolean = lastSaveMs <= 0L || nowMs < lastSaveMs || nowMs - lastSaveMs >= minIntervalMs

    /** Giãn cách tối thiểu giữa hai lần **tự** lưu (ms). */
    const val MIN_AUTO_INTERVAL_MS = 30_000L
}

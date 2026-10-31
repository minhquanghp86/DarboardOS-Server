package vn.mqsmarthome.dashboardos

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import java.io.File
import java.util.concurrent.Executors

/**
 * (29/11/2026) GD17 — **GHI/ĐỌC TỆP CHẨN ĐOÁN TRÊN ĐĨA** (phần chạm Android của [DiagFile]).
 *
 * Vị trí lưu (ưu tiên trên xuống):
 *  1. `context.getExternalFilesDir(null)` → `/sdcard/Android/data/<package>/files` — người dùng **mở/sao chép được**
 *     bằng ứng dụng quản lý tệp, app gỡ đi thì thư mục cũng bị xoá theo;
 *  2. dự phòng `context.filesDir` (`/data/data/<package>/files`) — khi bộ nhớ ngoài không gắn/không ghi được.
 *
 *  - Luôn giữ tối đa [DiagFile.MAX_FILES] tệp mới nhất ([DiagFile.deleteCandidates]) sau mỗi lần ghi;
 *  - ghi trong luồng nền ([writeAsync]) — MainActivity gọi từ `log()` nên không được chặn UI;
 *  - chia sẻ qua `content://<package>.diagfiles/<tên tệp>` ([uriFor] + [DiagFileProvider]).
 */
object DiagStore {

    /** Hậu tố authority của [DiagFileProvider] — manifest khai `${applicationId}.diagfiles`. */
    const val AUTHORITY_SUFFIX = ".diagfiles"

    /** Tên tệp tối đa thử khi trùng dấu giây (mỗi lần +1 s). */
    private const val MAX_COLLISION_TRIES = 120

    private val io = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "diag-file").also { it.isDaemon = true }
    }
    private val main = Handler(Looper.getMainLooper())

    /** `content://` authority đang dùng (khớp `${applicationId}` trong manifest). */
    fun authority(context: Context): String = context.applicationContext.packageName + AUTHORITY_SUFFIX

    /** Thư mục lưu tệp: bộ nhớ ngoài riêng của app, dự phòng `filesDir`. */
    fun root(context: Context): File {
        val external = runCatching { context.getExternalFilesDir(null) }.getOrNull()
        val dir = external ?: context.filesDir
        runCatching { dir.mkdirs() }
        return dir
    }

    /** Tệp có `name` nằm trong thư mục chẩn đoán (chỉ nhận tên an toàn + đúng mẫu `diag-*.txt`). */
    fun resolve(context: Context, name: String?): File? {
        if (!DiagFile.isSafeName(name) || !DiagFile.isDiagFile(name)) return null
        val dir = root(context)
        val file = File(dir, name as String)
        return if (file.isFile) file else null
    }

    /** Toàn bộ tệp chẩn đoán trong [dir] (chưa sắp xếp). */
    private fun scan(dir: File): List<DiagFile.Entry> =
        (runCatching { dir.listFiles() }.getOrNull() ?: emptyArray())
            .filter { it.isFile && DiagFile.isDiagFile(it.name) }
            .map { DiagFile.Entry(it.name, it.lastModified(), it.length()) }

    /** Tệp chẩn đoán, **mới nhất trước**, tối đa [max]. */
    fun entries(context: Context, max: Int = DiagFile.MAX_FILES): List<DiagFile.Entry> =
        DiagFile.newest(scan(root(context)), max)

    /** Đường dẫn hiển thị cho người dùng (`/sdcard/Android/data/<package>/files`). */
    fun displayDir(context: Context): String = root(context).absolutePath

    /**
     * Ghi [text] thành tệp `diag[-auto]-YYYYMMDD-HHmmss.txt` rồi xoá các tệp cũ vượt quá [DiagFile.MAX_FILES].
     * Trả `null` nếu không ghi được (hết chỗ/khoá quyền) — người gọi chỉ cần báo lỗi cho người dùng.
     */
    fun write(
        context: Context,
        text: String,
        auto: Boolean,
        at: Long = System.currentTimeMillis()
    ): File? {
        val dir = root(context)
        val file = uniqueFile(dir, auto, at) ?: return null
        return try {
            file.writeText(text, Charsets.UTF_8)
            pruneDirectory(dir)
            file
        } catch (t: Throwable) {
            null
        }
    }

    /** Ghi trong luồng nền; [onDone] được gọi trên luồng UI với tệp đã ghi (hoặc `null`). */
    fun writeAsync(
        context: Context,
        auto: Boolean,
        textProvider: () -> String,
        onDone: ((File?) -> Unit)? = null
    ) {
        val app = context.applicationContext ?: context
        io.execute {
            val file = runCatching { write(app, textProvider(), auto) }.getOrNull()
            if (onDone != null) runCatching { main.post { onDone(file) } }
        }
    }

    /** Xoá **tất cả** tệp chẩn đoán; trả số tệp đã xoá. */
    fun deleteAll(context: Context): Int {
        val dir = root(context)
        return scan(dir).count { entry -> runCatching { File(dir, entry.name).delete() }.getOrDefault(false) }
    }

    /** Xoá tệp cũ, chỉ giữ [max] tệp mới nhất. Trả số tệp đã xoá. */
    fun prune(context: Context, max: Int = DiagFile.MAX_FILES): Int = pruneDirectory(root(context), max)

    /** [prune] trên một thư mục đã biết (không cần `Context`). */
    private fun pruneDirectory(dir: File, max: Int = DiagFile.MAX_FILES): Int =
        DiagFile.deleteCandidates(scan(dir), max).count { entry ->
            runCatching { File(dir, entry.name).delete() }.getOrDefault(false)
        }

    /** `content://<package>.diagfiles/<tên tệp>` — URI chia sẻ qua [DiagFileProvider]. */
    fun uriFor(context: Context, file: File): Uri = Uri.Builder()
        .scheme("content")
        .authority(authority(context))
        .appendPath(file.name)
        .build()

    /** Tên tệp chưa tồn tại; nếu trùng dấu giây thì lùi +1 s (vẫn đúng mẫu `diag-…txt`). */
    private fun uniqueFile(dir: File, auto: Boolean, at: Long): File? {
        var ts = at
        repeat(MAX_COLLISION_TRIES) {
            val candidate = File(dir, DiagFile.fileName(auto, ts))
            if (!candidate.exists()) return candidate
            ts += 1000L
        }
        return null
    }
}

/**
 * (29/11/2026) GD17 / yêu cầu 2 — **TỰ LƯU CHẨN ĐOÁN KHI LỖI**.
 *
 * Người dùng không biết lúc nào app gặp lỗi, nên không thể bắt họ bấm “Lưu ra tệp” đúng lúc. Hook: [MainActivity]
 * gắn [maybeSave] vào [Diag.onLine] một lần trong `onCreate` — mọi dòng log (kể cả của [PhoneService]) đi qua
 * [Diag.log] đều được xét: gặp `[promote] … fail=` hoặc **401** thì ghi ngay một tệp `diag-auto-<timestamp>.txt`, rồi
 * giãn cách [DiagFile.MIN_AUTO_INTERVAL_MS] để một chuỗi lỗi không đẻ ra 5 tệp trùng nhau (vẫn giữ tối đa
 * [DiagFile.MAX_FILES] tệp trên đĩa — [DiagStore.write] tự xoá tệp cũ nhất).
 */
object DiagAutoSave {

    private val lock = Any()

    @Volatile
    private var lastSaveMs: Long = 0L

    /** Dòng log này có kích hoạt tự lưu không ([DiagFile.shouldAutoSave]). */
    fun shouldPersist(line: String?): Boolean = DiagFile.shouldAutoSave(line)

    /** Có được tự lưu ở thời điểm [nowMs] không (giãn cách [DiagFile.MIN_AUTO_INTERVAL_MS]). */
    fun allowed(nowMs: Long, lastMs: Long = lastSaveMs): Boolean =
        DiagFile.autoSaveAllowed(nowMs, lastMs)

    /**
     * Nếu [line] là lỗi cần lưu thì ghi một tệp tự động (luồng nền). Trả `true` = **đã nhận** lưu tệp.
     * Không bao giờ ném ra ngoài — chẩn đoán không được làm hỏng luồng điều hướng.
     */
    fun maybeSave(context: Context, line: String?, at: Long = System.currentTimeMillis()): Boolean {
        if (!DiagFile.shouldAutoSave(line)) return false
        synchronized(lock) {
            if (!DiagFile.autoSaveAllowed(at, lastSaveMs)) return false
            lastSaveMs = at
        }
        val reason = line?.trim().orEmpty()
        val app = context.applicationContext ?: context
        DiagStore.writeAsync(app, auto = true, textProvider = { DiagReport.build(app, reason) })
        // Ghi chú lại vào chính log (đọc trên màn Chẩn đoán). KHÔNG kèm "lý do" để dòng ghi chú này không tự kích
        // hoạt lần lưu tiếp theo (nó không chứa `fail=`/401).
        Diag.log("[diag] tự lưu tệp chẩn đoán mới (xem Cài đặt → Chẩn đoán)")
        return true
    }

    /** Chỉ để unit test: quên mốc giãn cách. */
    fun resetForTest() {
        synchronized(lock) { lastSaveMs = 0L }
    }
}

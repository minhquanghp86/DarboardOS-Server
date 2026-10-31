package vn.mqsmarthome.dashboardos

import android.util.Log
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * (28/11/2026) GD16 — **BỘ GHI LOG VÒNG (ring buffer) ĐỂ CHẨN ĐOÁN NGAY TRONG APP**.
 *
 * Vì sao cần: người dùng không có adb, nên mọi dòng chẩn đoán `[nav]` / `[promote]` / `[login]` / `[api]` phải
 * đọc được **trên máy** — bấm Cài đặt → **Chẩn đoán** → **Sao chép** → gửi nội dung cho người hỗ trợ.
 *
 * Quy tắc:
 *  - giữ tối đa [CAPACITY] = **300 dòng** gần nhất (dòng cũ nhất bị bỏ khi vượt);
 *  - mỗi dòng có tiền tố thời gian `HH:mm:ss ` ([TIME_PATTERN]);
 *  - **đồng thời** vẫn ghi ra Logcat (tag [TAG], `adb logcat -s DashboardOS-login`) qua [sink];
 *  - an toàn đa luồng ([lock]): MainActivity (UI thread), PhoneService (luồng poll) và WebView callback đều gọi.
 *
 * Tệp này THUẦN về mặt logic (chỉ `java.text` + một lời gọi `android.util.Log` được bọc `runCatching`) nên unit
 * test được trên JVM bằng cách thay [timeSource] / [sink] — xem `DiagTest`.
 */
object Diag {

    /** Tag Logcat — giữ ĐÚNG như bản cũ để `adb logcat -s DashboardOS-login` vẫn dùng được. */
    const val TAG = "DashboardOS-login"

    /** Số dòng tối đa giữ trong bộ nhớ (yêu cầu: 300). */
    const val CAPACITY = 300

    /** Định dạng thời gian của mỗi dòng log. */
    const val TIME_PATTERN = "HH:mm:ss"

    /** Nguồn thời gian (thay được trong unit test). */
    @Volatile
    var timeSource: () -> Long = { System.currentTimeMillis() }

    /**
     * Nơi nhận thêm mỗi dòng (mặc định = Logcat). `null` = chỉ giữ trong bộ nhớ (unit test).
     * Không bao giờ ném ra ngoài: log KHÔNG được làm hỏng luồng điều hướng.
     */
    @Volatile
    var sink: ((String) -> Unit)? = { line ->
        runCatching { Log.i(TAG, line) }
        Unit
    }

    private val lock = Any()
    private val buffer = ArrayList<String>(CAPACITY)
    private val timeFormat = SimpleDateFormat(TIME_PATTERN, Locale.US)

    /**
     * Ghi MỘT dòng: `HH:mm:ss <line>` vào ring buffer + Logcat. Dòng rỗng sau khi cắt khoảng trắng bị bỏ qua.
     * Không bao giờ ném ra ngoài.
     */
    fun log(line: String?) {
        val text = line?.trim().orEmpty()
        if (text.isEmpty()) return
        val entry = formatTime(timeSource()) + " " + text
        synchronized(lock) {
            buffer.add(entry)
            while (buffer.size > CAPACITY) buffer.removeAt(0)
        }
        runCatching { sink?.invoke(text) }
    }

    /** Bản sao các dòng đang giữ (cũ → mới). */
    fun snapshot(): List<String> = synchronized(lock) { ArrayList(buffer) }

    /** Toàn bộ buffer thành một chuỗi (mỗi dòng một dòng chữ). */
    fun text(): String = snapshot().joinToString("\n")

    /** Số dòng đang giữ. */
    fun count(): Int = synchronized(lock) { buffer.size }

    /** Xoá sạch buffer (nút "Xoá log"). */
    fun clear() {
        synchronized(lock) { buffer.clear() }
    }

    /** `HH:mm:ss` của [at] — tách riêng để unit test được. */
    fun formatTime(at: Long): String = synchronized(lock) { timeFormat.format(Date(at)) }
}

/**
 * (28/11/2026) GD16 — **ẢNH CHỤP TRẠNG THÁI ĐIỀU HƯỚNG** để màn Chẩn đoán hiện được cả khi WebView của
 * [MainActivity] đang ở nền / đã bị huỷ.
 *
 * MainActivity cập nhật các trường này mỗi lần nạp trang / mỗi lần `onPageFinished`; [DiagActivity] chỉ đọc.
 */
object DiagState {

    /** `https://<domain>` đang dùng (origin của Home Assistant / add-on). */
    @Volatile
    var domain: String? = null

    /** `webUrl` ĐANG DÙNG cho WebView (đã dựng lại từ TOKEN nếu giá trị lưu bị hỏng). */
    @Volatile
    var webUrlInUse: String? = null

    /** URL hiện tại của WebView (cập nhật ở mỗi lần nạp + `onPageFinished`). */
    @Volatile
    var currentUrl: String? = null

    /** WebView đã được mở lần nào trong tiến trình này chưa (để phân biệt "chưa mở" với "mở nhưng rỗng"). */
    @Volatile
    var webViewOpened: Boolean = false

    /** Lần promote gần nhất: URL top-level đã thử. */
    @Volatile
    var lastPromoteUrl: String? = null

    /** Kết quả lần promote gần nhất: `top` / `panel` / `401` … */
    @Volatile
    var lastPromoteResult: String? = null

    /** Quên các giá trị của phiên trước (dùng khi bấm "Kết nối" — một lần mở mới). */
    fun reset() {
        webUrlInUse = null
        currentUrl = null
        webViewOpened = false
        lastPromoteUrl = null
        lastPromoteResult = null
    }
}

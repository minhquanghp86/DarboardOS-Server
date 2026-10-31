package vn.mqsmarthome.dashboardos

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import java.io.File

/**
 * (28/11/2026) GD16 — **MÀN CHẨN ĐOÁN** (Cài đặt → "Chẩn đoán").
 *
 * Mục đích: người dùng **không cần adb** — chỉ bấm *Chẩn đoán* → *Sao chép* (hoặc *Lưu ra tệp* → *Chia sẻ tệp*) →
 * gửi nội dung/tệp cho người hỗ trợ.
 *
 * Hiển thị:
 *  1. `domain` — origin của Home Assistant / add-on đang cấu hình,
 *  2. `webUrl đang dùng` — URL app thật sự nạp vào WebView (đã dựng lại từ TOKEN nếu giá trị lưu bị hỏng),
 *  3. `URL hiện tại của WebView` — cập nhật ở mỗi lần nạp + `onPageFinished` ([DiagState.currentUrl]),
 *  4. `cookie ingress_session` — **dò thật** trên `CookieManager` (cả `Path=/api/hassio_ingress/`),
 *  5. `token ingress` — [Prefs.ingressToken] (mặc định `KJjH…`),
 *  6. toàn bộ ring buffer [Diag] (300 dòng gần nhất, mỗi dòng có `HH:mm:ss`, gồm `[nav]` / `[promote]` / `[login]` /
 *     `[api]`), tự cuộn xuống dòng mới nhất.
 *
 * Nút: **Sao chép** (clipboard + toast) · **Chia sẻ** (`ACTION_SEND` `text/plain` văn bản) · **Xoá log** ([Diag.clear]).
 *
 * (29/11/2026) GD17 — thêm **tệp**:
 *  - **“Lưu ra tệp”** → ghi header + 5 giá trị + 300 dòng log ra `getExternalFilesDir(null)/diag-YYYYMMDD-HHmmss.txt`
 *    (dự phòng `filesDir` — [DiagStore]), hiện **đường dẫn** + bật **“Chia sẻ tệp”** (`ACTION_SEND` + `content://`
 *    qua [DiagFileProvider], type `text/plain`);
 *  - **danh sách tối đa 5 tệp gần nhất** (tên · thời gian · dung lượng) — bấm một dòng để chia sẻ tệp đó;
 *  - **“Xoá tất cả”** — xoá mọi tệp chẩn đoán trong thư mục của app;
 *  - tệp `diag-auto-…txt` do app **tự** lưu khi gặp `[promote] … fail=` hoặc 401 ([DiagAutoSave]) cũng nằm trong danh sách.
 */
class DiagActivity : Activity() {

    private lateinit var valuesView: TextView
    private lateinit var logView: TextView
    private lateinit var scroll: ScrollView
    private lateinit var filesList: LinearLayout
    private lateinit var filesEmpty: TextView
    private lateinit var filesDirView: TextView
    private lateinit var savedPathView: TextView
    private lateinit var shareFileButton: Button

    /** Tệp vừa ghi trong phiên này (nút "Chia sẻ tệp" chia sẻ tệp này). */
    private var lastSavedFile: File? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_diag)

        valuesView = findViewById(R.id.diagValues)
        logView = findViewById(R.id.diagLog)
        scroll = findViewById(R.id.diagScroll)
        filesList = findViewById(R.id.diagFilesList)
        filesEmpty = findViewById(R.id.diagFilesEmpty)
        filesDirView = findViewById(R.id.diagFilesDir)
        savedPathView = findViewById(R.id.diagSavedPath)
        shareFileButton = findViewById(R.id.diagShareFileButton)
        shareFileButton.isEnabled = false

        logView.setTextIsSelectable(true)
        valuesView.setTextIsSelectable(true)

        findViewById<Button>(R.id.diagCopyButton).setOnClickListener { copyAll() }
        findViewById<Button>(R.id.diagShareButton).setOnClickListener { shareAll() }
        findViewById<Button>(R.id.diagClearButton).setOnClickListener {
            Diag.clear()
            Diag.log("[diag] người dùng đã xoá log")
            toast(getString(R.string.diag_cleared))
            render()
        }
        findViewById<Button>(R.id.diagSaveFileButton).setOnClickListener { saveToFile() }
        shareFileButton.setOnClickListener {
            val file = lastSavedFile
            if (file == null) toast(getString(R.string.diag_file_missing)) else shareFile(file)
        }
        findViewById<Button>(R.id.diagFilesClearButton).setOnClickListener { deleteAllFiles() }
        findViewById<Button>(R.id.diagCloseButton).setOnClickListener { finish() }

        render()
    }

    override fun onResume() {
        super.onResume()
        render()
    }

    /** Vẽ lại 5 giá trị + danh sách tệp + toàn bộ log (tự cuộn xuống cuối). */
    private fun render() {
        valuesView.text = DiagReport.values(this)
        val log = Diag.text()
        logView.text = log.ifEmpty { getString(R.string.diag_empty_log) }
        renderFiles()
        scroll.post { runCatching { scroll.fullScroll(View.FOCUS_DOWN) } }
    }

    // ── tệp chẩn đoán (GD17) ─────────────────────────────────────────────────────────────────────────────────────

    /** Danh sách tối đa 5 tệp gần nhất; mỗi dòng bấm được để chia sẻ. */
    private fun renderFiles() {
        filesDirView.text = getString(R.string.diag_files_dir, DiagStore.displayDir(this))
        val entries = DiagStore.entries(this)
        filesList.removeAllViews()
        filesEmpty.visibility = if (entries.isEmpty()) View.VISIBLE else View.GONE
        for (entry in entries) {
            filesList.addView(fileRow(entry))
        }
    }

    /** Một dòng tệp: `tên · thời gian · dung lượng` — chạm để chia sẻ. */
    private fun fileRow(entry: DiagFile.Entry): TextView {
        val row = TextView(this)
        row.text = DiagFile.listLine(entry) + if (entry.isAuto) "  (tự lưu)" else ""
        row.setTextColor(Color.parseColor("#FFC7D2E2"))
        row.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
        row.typeface = android.graphics.Typeface.MONOSPACE
        row.setBackgroundColor(Color.parseColor("#FF16202F"))
        row.setPadding(dp(10), dp(8), dp(10), dp(8))
        row.gravity = Gravity.CENTER_VERTICAL
        row.isClickable = true
        row.setOnClickListener {
            DiagStore.resolve(this, entry.name)?.let { shareFile(it) }
                ?: run {
                    toast(getString(R.string.diag_file_missing))
                    renderFiles()
                }
        }
        val params = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        )
        params.bottomMargin = dp(4)
        row.layoutParams = params
        return row
    }

    /** “Lưu ra tệp”: ghi chẩn đoán hiện tại ra `diag-YYYYMMDD-HHmmss.txt` rồi hiện đường dẫn. */
    private fun saveToFile() {
        val text = DiagReport.build(this)
        DiagStore.writeAsync(this, auto = false, textProvider = { text }) { file ->
            if (file == null) {
                toast(getString(R.string.diag_file_failed))
            } else {
                lastSavedFile = file
                savedPathView.text = getString(R.string.diag_file_saved, file.absolutePath)
                savedPathView.visibility = View.VISIBLE
                shareFileButton.isEnabled = true
                toast(getString(R.string.diag_file_saved_toast))
                Diag.log("[diag] đã lưu tệp chẩn đoán: " + file.name)
                renderFiles()
            }
        }
    }

    /** Chia sẻ MỘT tệp qua `content://` ([DiagFileProvider], type `text/plain`). */
    private fun shareFile(file: File) {
        if (!file.isFile) {
            toast(getString(R.string.diag_file_missing))
            renderFiles()
            return
        }
        lastSavedFile = file
        savedPathView.text = getString(R.string.diag_file_saved, file.absolutePath)
        savedPathView.visibility = View.VISIBLE
        shareFileButton.isEnabled = true
        val uri = DiagStore.uriFor(this, file)
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_SUBJECT, getString(R.string.diag_share_subject))
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_TEXT, getString(R.string.diag_share_subject) + " — " + file.name)
            clipData = ClipData.newRawUri(file.name, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        try {
            startActivity(Intent.createChooser(send, getString(R.string.diag_file_chooser)))
        } catch (t: Throwable) {
            toast(getString(R.string.diag_share_failed))
        }
    }

    /** “Xoá tất cả”: xoá mọi tệp chẩn đoán (log trong bộ nhớ giữ nguyên). */
    private fun deleteAllFiles() {
        val removed = DiagStore.deleteAll(this)
        lastSavedFile = null
        savedPathView.visibility = View.GONE
        shareFileButton.isEnabled = false
        toast(
            if (removed > 0) getString(R.string.diag_files_cleared, removed)
            else getString(R.string.diag_files_none)
        )
        Diag.log("[diag] đã xoá $removed tệp chẩn đoán")
        renderFiles()
    }

    private fun dp(value: Int): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics).toInt()

    // ── văn bản (GD16) ───────────────────────────────────────────────────────────────────────────────────────────

    /** Nội dung đầy đủ để gửi: 5 giá trị + toàn bộ log. */
    private fun fullText(): String = DiagReport.build(this)

    private fun copyAll() {
        val text = fullText()
        try {
            val cm = getSystemService(ClipboardManager::class.java)
            cm?.setPrimaryClip(ClipData.newPlainText(getString(R.string.diag_share_subject), text))
            toast(getString(R.string.diag_copied))
        } catch (t: Throwable) {
            toast(getString(R.string.diag_copy_failed))
        }
    }

    private fun shareAll() {
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_SUBJECT, getString(R.string.diag_share_subject))
            putExtra(Intent.EXTRA_TEXT, fullText())
        }
        try {
            startActivity(Intent.createChooser(send, getString(R.string.diag_share_chooser)))
        } catch (t: Throwable) {
            toast(getString(R.string.diag_share_failed))
        }
    }

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }
}

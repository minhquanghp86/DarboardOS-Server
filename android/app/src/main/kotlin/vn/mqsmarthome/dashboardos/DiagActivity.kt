package vn.mqsmarthome.dashboardos

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.webkit.CookieManager
import android.widget.Button
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

/**
 * (28/11/2026) GD16 — **MÀN CHẨN ĐOÁN** (Cài đặt → "Chẩn đoán").
 *
 * Mục đích: người dùng **không cần adb** — chỉ bấm *Chẩn đoán* → *Sao chép* → gửi nội dung cho người hỗ trợ.
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
 * Nút: **Sao chép** (clipboard + toast) · **Chia sẻ** (`ACTION_SEND` `text/plain`) · **Xoá log** ([Diag.clear]).
 */
class DiagActivity : Activity() {

    private lateinit var valuesView: TextView
    private lateinit var logView: TextView
    private lateinit var scroll: ScrollView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_diag)

        valuesView = findViewById(R.id.diagValues)
        logView = findViewById(R.id.diagLog)
        scroll = findViewById(R.id.diagScroll)

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
        findViewById<Button>(R.id.diagCloseButton).setOnClickListener { finish() }

        render()
    }

    override fun onResume() {
        super.onResume()
        render()
    }

    /** Vẽ lại 5 giá trị + toàn bộ log (tự cuộn xuống cuối). */
    private fun render() {
        valuesView.text = values()
        val log = Diag.text()
        logView.text = log.ifEmpty { getString(R.string.diag_empty_log) }
        scroll.post { runCatching { scroll.fullScroll(View.FOCUS_DOWN) } }
    }

    /** 5 giá trị chẩn đoán (mỗi dòng một giá trị). */
    private fun values(): String {
        val none = getString(R.string.diag_none)
        val domain = DiagState.domain
            ?: DashboardTarget.originOf(Prefs.webUrl(this))
            ?: DashboardTarget.originOf(Prefs.loginUrl(this))
            ?: DashboardTarget.originOf(Prefs.oneInput(this))
        val webInUse = DiagState.webUrlInUse
            ?: Prefs.webUrl(this)?.takeIf { DashboardTarget.isValidSaved(it) }
            ?: DashboardTarget.candidates(
                saved = Prefs.webUrl(this),
                loginUrl = Prefs.loginUrl(this),
                typed = Prefs.oneInput(this),
                token = Prefs.ingressToken(this)
            ).firstOrNull()
        val current = DiagState.currentUrl
            ?: if (DiagState.webViewOpened) getString(R.string.diag_current_no_url)
            else getString(R.string.diag_current_no_webview)
        return buildString {
            append(getString(R.string.diag_v_domain, domain ?: none)).append('\n')
            append(getString(R.string.diag_v_web_in_use, webInUse ?: none)).append('\n')
            append(getString(R.string.diag_v_current, current)).append('\n')
            append(
                getString(
                    R.string.diag_v_cookie,
                    getString(if (hasIngressCookie(domain)) R.string.diag_yes else R.string.diag_no)
                )
            ).append('\n')
            append(getString(R.string.diag_v_token, Prefs.ingressToken(this@DiagActivity)))
            if (DiagState.lastPromoteUrl != null || DiagState.lastPromoteResult != null) {
                append('\n').append(
                    getString(
                        R.string.diag_v_promote,
                        DiagState.lastPromoteResult ?: "-",
                        DiagState.lastPromoteUrl ?: none
                    )
                )
            }
        }
    }

    /**
     * `CookieManager` có `ingress_session` (hoặc `hassio_ingress`) cho [domain] không — dò cả cookie đặt ở
     * `Path=/api/hassio_ingress/` (đúng path mà HA frontend dùng).
     */
    private fun hasIngressCookie(domain: String?): Boolean {
        val d = domain?.trim()?.trimEnd('/').orEmpty()
        if (d.isEmpty()) return false
        for (target in listOf(d + HaIngress.COOKIE_PATH, d)) {
            val raw = try {
                CookieManager.getInstance().getCookie(target)
            } catch (t: Throwable) {
                null
            }
            if (WebTargetResolver.hasSessionCookie(raw)) return true
        }
        return false
    }

    /** Nội dung đầy đủ để gửi: 5 giá trị + toàn bộ log. */
    private fun fullText(): String = buildString {
        append(getString(R.string.diag_share_header)).append('\n')
        append(values()).append("\n\n")
        append(getString(R.string.diag_log_section)).append('\n')
        append(Diag.text())
    }

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

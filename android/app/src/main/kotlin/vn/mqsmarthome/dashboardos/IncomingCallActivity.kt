package vn.mqsmarthome.dashboardos

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.WindowManager
import android.widget.Button
import android.widget.TextView
import android.widget.Toast

/**
 * (11/11/2026) GD3 — màn hình cuộc gọi đến TOÀN MÀN HÌNH (kể cả khi máy khoá).
 * (12/11/2026) GD5 — KHÔNG phát âm thanh, KHÔNG rung: chuông + rung do KÊNH THÔNG BÁO `incoming_call_v3`
 * phát (xem [CallNotifications]). Màn hình này chỉ hiện giao diện và giữ NHỊP ĐĂNG LẠI thông báo (~4 s) —
 * tức vẫn kêu cho tới khi người dùng Nghe / Từ chối hoặc server báo cuộc gọi đã hết.
 *
 * Service gửi thông báo full-screen intent trỏ vào đây, nên activity tự bật lên trên màn khoá
 * (setShowWhenLocked + setTurnScreenOn + xin bỏ khoá tạm thời). Khi:
 *   - "Nghe"     -> POST /app/answer  rồi mở WebView tới <origin>call-web.html?call=<id>
 *   - "Từ chối"  -> POST /app/decline rồi đóng
 * Cuộc gọi hết (người gọi cúp, quá 30 s) -> PhoneService gọi dismissFor() để huỷ thông báo và đóng.
 *
 * Vì sao màn hình cũng đăng lại thông báo: nếu PhoneService bị hệ thống kill trong lúc màn hình gọi còn mở thì
 * chuông không được "câm" — activity tự giữ nhịp (dùng chung [CallNotifications.notifyAgainIfDue] nên không bị
 * đăng lại dày hơn [CallNotifications.REPOST_MS], tránh kêu/rung đôi).
 */
class IncomingCallActivity : Activity() {

    companion object {
        private const val TAG = "IncomingCall"
        const val EXTRA_CALL = "call_id"
        const val EXTRA_FROM = "from_id"
        const val EXTRA_FROM_NAME = "from_name"

        /** true = mở máy và trả lời luôn (nút "Nghe" trên thông báo). */
        const val EXTRA_AUTO_ANSWER = "auto_answer"

        /** Nhịp kiểm tra lại nhịp đăng lại (nhịp KÊU thật vẫn là [CallNotifications.REPOST_MS]). */
        private const val TICK_MS = 1_000L

        @Volatile
        private var current: IncomingCallActivity? = null

        fun intentFor(ctx: Context, call: PhoneApi.Incoming, autoAnswer: Boolean = false): Intent =
            Intent(ctx, IncomingCallActivity::class.java)
                .addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_CLEAR_TOP or
                        Intent.FLAG_ACTIVITY_SINGLE_TOP
                )
                .putExtra(EXTRA_CALL, call.id)
                .putExtra(EXTRA_FROM, call.from)
                .putExtra(EXTRA_FROM_NAME, call.fromName)
                .putExtra(EXTRA_AUTO_ANSWER, autoAnswer)

        /** Huỷ thông báo + đóng (callId = null: đóng bất kể đang hiện cuộc gọi nào). */
        fun dismissFor(callId: String?) {
            val a = current ?: return
            a.runOnUiThread {
                if (callId == null || a.callId == callId) a.dismissQuietly()
            }
        }
    }

    private var callId = ""
    private var fromName = ""
    private var fromId = ""
    private var handled = false
    private var autoAnswer = false

    private val uiHandler = Handler(Looper.getMainLooper())

    /**
     * Nhịp đăng lại thông báo (chuông kêu lặp). Kiểm tra mỗi giây; [CallNotifications.notifyAgainIfDue] tự giãn
     * cách ít nhất [CallNotifications.REPOST_MS] nên không bao giờ kêu dày hơn nhịp đó.
     */
    private val repostRunnable = object : Runnable {
        override fun run() {
            if (isFinishing || isDestroyed) return
            val id = callId
            if (id.isNotBlank() && PhoneStatus.handledCallId != id) {
                CallNotifications.notifyAgainIfDue(this@IncomingCallActivity, incoming())
                PhoneStatus.ringing = RingState.isRinging()
                uiHandler.postDelayed(this, TICK_MS)
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Hiện trên màn khoá + tự bật màn hình.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            )
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        try {
            (getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager)?.requestDismissKeyguard(this, null)
        } catch (t: Throwable) {
            // Không bỏ khoá được (máy có mã PIN riêng tư): vẫn hiện trên màn khoá.
        }

        setContentView(R.layout.activity_call)
        readExtras(intent)

        findViewById<Button>(R.id.answerButton).setOnClickListener { answer() }
        findViewById<Button>(R.id.declineButton).setOnClickListener { decline() }

        // Không phát âm thanh/rung ở đây: chỉ đánh dấu trạng thái + giữ nhịp đăng lại thông báo (chuông của kênh).
        RingState.start()
        PhoneStatus.ringing = true
        startRepost()

        if (autoAnswer && callId.isNotBlank()) {
            // Nút "Nghe" trên thông báo: trả lời luôn, không cần chạm lần 2.
            answer()
        }
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        handled = false
        readExtras(intent)
        RingState.start()
        PhoneStatus.ringing = true
        startRepost()
        if (autoAnswer && callId.isNotBlank()) answer()
    }

    override fun onResume() {
        super.onResume()
        current = this
        PhoneStatus.ringing = RingState.isRinging()
    }

    override fun onDestroy() {
        if (current === this) current = null
        // Đóng màn hình = hết chuông (không để thông báo kêu mãi khi không còn giao diện).
        stopRepost()
        RingState.stop()
        CallNotifications.cancel(this)
        PhoneStatus.ringing = false
        PhoneStatus.publish(applicationContext)
        super.onDestroy()
    }

    @Deprecated("Deprecated in Java")
    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        decline()   // bấm Back = từ chối, không để chuông kêu mãi
    }

    private fun readExtras(intent: Intent?) {
        callId = intent?.getStringExtra(EXTRA_CALL).orEmpty()
        fromName = intent?.getStringExtra(EXTRA_FROM_NAME).orEmpty()
        fromId = intent?.getStringExtra(EXTRA_FROM).orEmpty()
        autoAnswer = intent?.getBooleanExtra(EXTRA_AUTO_ANSWER, false) == true
        findViewById<TextView>(R.id.callerName).text =
            fromName.ifBlank { getString(R.string.call_unknown_caller) }
        findViewById<TextView>(R.id.callerFrom).text =
            if (fromId.isBlank()) getString(R.string.call_incoming) else getString(R.string.call_from, fromId)
        if (callId.isNotBlank()) PhoneStatus.callId = callId
    }

    /** Cuộc gọi đang hiện (đủ thông tin để dựng lại thông báo khi đăng lại). */
    private fun incoming(): PhoneApi.Incoming = PhoneApi.Incoming(callId, fromId, fromName)

    /** Bắt đầu (hoặc nối lại) nhịp đăng lại thông báo — chuông kêu tới khi Nghe / Từ chối. */
    private fun startRepost() {
        uiHandler.removeCallbacks(repostRunnable)
        if (callId.isNotBlank()) uiHandler.postDelayed(repostRunnable, CallNotifications.REPOST_MS)
    }

    private fun stopRepost() {
        uiHandler.removeCallbacks(repostRunnable)
    }

    private fun answer() {
        if (handled) return
        handled = true
        val call = callId
        // Báo cho PhoneService: cuộc gọi này đã xử lý -> không đổ chuông lại dù server còn trả về.
        if (call.isNotBlank()) PhoneStatus.handledCallId = call
        stopRinging()

        // (30/10/2026) GD4: gọi API bằng goc API da luu (không suy ra từ URL trang).
        val base = Prefs.apiBase(this)
        // Đánh dấu đã nghe trên server rồi mới mở trang gọi (trang cần cuộc gọi ở trạng thái active).
        thread {
            val ok = PhoneApi.answer(base, Prefs.phoneId(this), call)
            runOnUiThread {
                if (!ok) Toast.makeText(this, R.string.call_answer_failed, Toast.LENGTH_SHORT).show()
                openCallPage()
                finish()
            }
        }
    }

    private fun decline() {
        if (handled) return
        handled = true
        val call = callId
        if (call.isNotBlank()) PhoneStatus.handledCallId = call
        stopRinging()
        val base = Prefs.apiBase(this)
        thread { PhoneApi.decline(base, Prefs.phoneId(this), call) }
        finish()
    }

    /** Huỷ thông báo và đóng mà không gọi API (cuộc gọi đã hết ở phía server). */
    private fun dismissQuietly() {
        handled = true
        stopRinging()
        finish()
    }

    /** Dừng nhịp đăng lại + huỷ thông báo (giữ nguyên trạng thái của service: cuộc gọi vẫn đang chờ). */
    private fun stopRinging() {
        stopRepost()
        RingState.stop()
        CallNotifications.cancel(this)
        PhoneStatus.ringing = false
        PhoneStatus.publish(applicationContext)
    }

    /**
     * Mở đúng trang gọi trong WebView của app (call-web.html?call=<id>).
     *
     * (13/11/2026) GD6 — trang gọi nằm CÙNG thư mục với trang điều khiển ([Prefs.KEY_WEB_URL]), nên lấy theo webUrl
     * để giữ nguyên tiền tố ingress của Home Assistant (cookie HA vẫn áp dụng); nếu chưa có webUrl thì lùi về apiBase.
     */
    private fun openCallPage() {
        val url = WebTargetResolver.callPageUrl(Prefs.webUrl(this), callId)
            ?: PhoneApi.webUrl(Prefs.apiBase(this), WebTargetResolver.CALL_PAGE, "call=$callId")
            ?: return
        val i = Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(MainActivity.EXTRA_OPEN_URL, url)
        try {
            startActivity(i)
        } catch (t: Throwable) {
            Toast.makeText(this, t.message ?: "?", Toast.LENGTH_SHORT).show()
        }
    }

    private fun thread(body: () -> Unit) {
        Thread {
            try {
                body()
            } catch (t: Throwable) {
                // Mất mạng: không được treo UI, chỉ bỏ qua.
            }
        }.also { it.isDaemon = true }.start()
    }
}

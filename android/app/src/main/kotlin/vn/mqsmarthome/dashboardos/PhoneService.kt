package vn.mqsmarthome.dashboardos

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.PowerManager
import android.util.Log

/**
 * (10/11/2026) GD2 — chuông báo cuộc gọi đến khi app ĐÓNG / ở nền.
 * (12/11/2026) GD5 — chuông/rung do KÊNH THÔNG BÁO `incoming_call_v3` phát (app không tự phát âm thanh nữa,
 * xem CallNotifications): kênh HIGH + nhạc chuông mặc định của máy + rung + bypassDnd. Vòng poll 2 s vừa phát
 * hiện cuộc gọi mới vừa ĐĂNG LẠI thông báo mỗi ~4 s (CallNotifications.REPOST_MS) để chuông kêu lặp.
 *
 * Chạy như foreground service (kiểu `specialUse` từ Android 14, `dataSync` cho Android 10-13) và tự bơm 2 giây/lần:
 *   - POST /app/register (khi bắt đầu, khi đổi URL, và 60 giây/lần) — id lấy từ SharedPreferences,
 *   - GET  /app/incoming?phone=<id> — có cuộc gọi thì: đăng thông báo cuộc gọi (kênh tự kêu chuông + rung),
 *     đăng lại mỗi ~4 s, thử mở IncomingCallActivity ngay.
 * Không dùng WebSocket / Firebase: Polling 2 s là đủ nhanh cho chuông và chịu được mất mạng, vào lại Wi-Fi, màn khoá.
 */
class PhoneService : Service() {

    companion object {
        private const val TAG = "PhoneService"

        const val CH_SERVICE = "phone_service"

        /** Giữ tên cũ cho code cũ / log; kênh cuộc gọi thật nằm ở CallNotifications.CHANNEL_ID. */
        const val CH_CALL = CallNotifications.CHANNEL_ID
        const val NOTIF_SERVICE = 1001
        const val NOTIF_CALL = CallNotifications.NOTIF_ID

        /** Chu kỳ hỏi server (yêu cầu GD2: 2 giây). */
        const val POLL_MS = 2_000L

        /** Dang ky lai dinh ky: so dang ky cua server co the mat (addon cap nhat lai, /data bi xoa) -> tu chua lanh. */
        private const val RE_REGISTER_MS = 60_000L

        @Volatile
        private var running = false

        fun isRunning(): Boolean = running

        /** Khoi dong (khong nem loi neu he thong tu choi — vd Android 15 chan tu BOOT_COMPLETED). */
        fun start(ctx: android.content.Context) {
            val i = Intent(ctx, PhoneService::class.java)
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i)
                else ctx.startService(i)
            } catch (t: Throwable) {
                Log.w(TAG, "khong khoi dong duoc: ${t.javaClass.simpleName}: ${t.message}")
            }
        }

        fun stop(ctx: android.content.Context) {
            try {
                ctx.stopService(Intent(ctx, PhoneService::class.java))
            } catch (t: Throwable) {
                Log.w(TAG, "khong dung duoc: ${t.message}")
            }
        }
    }

    private var loop: Thread? = null

    /** Giu CPU thuc day khi man hinh tat de vong poll 2 s khong bi Doze treo. */
    private var wakeLock: PowerManager.WakeLock? = null

    @Volatile
    private var stopping = false

    /** Cuoc goi dang do chuong (tranh dung lai activity / thong bao moi 2 giay). */
    @Volatile
    private var ringing: String? = null

    // (12/11/2026) GD5: KHÔNG còn đối tượng phát chuông — âm thanh + rung do kênh thông báo lo.
    // RingState chỉ là cờ trạng thái dùng chung với IncomingCallActivity (một tiến trình, một trạng thái).

    override fun onCreate() {
        super.onCreate()
        ensureChannels()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Bat buoc phai goi startForeground trong ~10 s (ke ca khi nguoi dung da tat nhan cuoc goi).
        promoteToForeground()
        if (!Prefs.receiveEnabled(this)) {
            Log.i(TAG, "nguoi dung da tat 'nhan cuoc goi khi app dong' -> dung")
            stopSelf()
            return START_NOT_STICKY
        }
        acquireWakeLock()
        startLoop()
        // START_STICKY: he thong bi kill (thieu RAM) thi tu dung lai.
        return START_STICKY
    }

    override fun onDestroy() {
        stopping = true
        loop?.interrupt()
        loop = null
        running = false
        // Service chết thì phải bỏ thông báo cuộc gọi, nếu không chuông kêu mãi không có gì dừng.
        RingState.stop()
        ringing = null
        PhoneStatus.callId = null
        PhoneStatus.ringing = false
        PhoneStatus.publish(this)
        cancelCallNotification()
        releaseWakeLock()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?) = null

    // ────────────────────────────────────────────────────────────── giu CPU (PARTIAL_WAKE_LOCK)

    @Suppress("WakelockTimeout")
    private fun acquireWakeLock() {
        if (wakeLock != null) return
        try {
            val pm = getSystemService(PowerManager::class.java) ?: return
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "DashboardOS:phone-poll").apply {
                setReferenceCounted(false)
                acquire()
            }
        } catch (t: Throwable) {
            Log.w(TAG, "khong giu duoc wake lock: ${t.message}")
        }
    }

    private fun releaseWakeLock() {
        try {
            wakeLock?.takeIf { it.isHeld }?.release()
        } catch (t: Throwable) {
            Log.d(TAG, "release wake lock: ${t.message}")
        }
        wakeLock = null
    }

    // ────────────────────────────────────────────────────────────── foreground + kênh thông báo

    private fun promoteToForeground() {
        val n = serviceNotification()
        try {
            when {
                Build.VERSION.SDK_INT >= 34 ->
                    startForeground(NOTIF_SERVICE, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
                Build.VERSION.SDK_INT >= 29 ->
                    startForeground(NOTIF_SERVICE, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
                else -> startForeground(NOTIF_SERVICE, n)
            }
        } catch (t: Throwable) {
            Log.w(TAG, "startForeground loi: ${t.javaClass.simpleName}: ${t.message}")
        }
    }

    private fun serviceNotification(): Notification {
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return Notification.Builder(this, CH_SERVICE)
            .setSmallIcon(R.drawable.ic_call_notif)
            .setContentTitle(getString(R.string.svc_title))
            .setContentText(getString(R.string.svc_text))
            .setOngoing(true)
            .setShowWhen(false)
            .setContentIntent(open)
            .build()
    }

    private fun ensureChannels() {
        // Kênh "đang nhận cuộc gọi" (im lặng, độ ưu tiên thấp) của foreground service.
        val nm = getSystemService(NotificationManager::class.java)
        if (nm != null && nm.getNotificationChannel(CH_SERVICE) == null) {
            try {
                nm.createNotificationChannel(
                    NotificationChannel(
                        CH_SERVICE,
                        getString(R.string.svc_channel),
                        NotificationManager.IMPORTANCE_LOW
                    ).apply {
                        description = getString(R.string.svc_channel_desc)
                        setShowBadge(false)
                    }
                )
            } catch (t: Throwable) {
                Log.w(TAG, "tao kenh service loi: ${t.message}")
            }
        }
        // Kênh cuộc gọi: HIGH + nhạc chuông mặc định của máy + rung + bypass DND + hiện trên màn khoá
        // (xem CallNotifications: kênh `incoming_call_v3`).
        CallNotifications.ensureChannel(this)
    }

    // ────────────────────────────────────────────────────────────── vòng poll

    private fun startLoop() {
        if (loop?.isAlive == true) return
        stopping = false
        running = true
        loop = Thread {
            var lastRegister = 0L
            var registeredBase: String? = null
            while (!stopping && Prefs.receiveEnabled(this)) {
                // (30/10/2026) GD4: dung THANG goc API da do duoc (khong suy ra tu URL trang nua).
                val base = Prefs.apiBase(this)
                if (base.isNullOrBlank()) {
                    if (!sleep()) break
                    continue
                }
                val id = Prefs.phoneId(this)
                val now = System.currentTimeMillis()
                if (registeredBase != base || now - lastRegister >= RE_REGISTER_MS) {
                    if (PhoneApi.register(base, Prefs.webUrl(this), id, Prefs.phoneName())) {
                        lastRegister = now
                        registeredBase = base
                        Log.i(TAG, "da dang ky $id voi server")
                    }
                }
                when (val r = PhoneApi.incoming(base, id)) {
                    is PhoneApi.Poll.Ring -> {
                        PhoneStatus.lastPollAt = System.currentTimeMillis()
                        onIncoming(r.call)
                        PhoneStatus.publish(this)
                    }
                    PhoneApi.Poll.None -> {
                        PhoneStatus.lastPollAt = System.currentTimeMillis()
                        onNoCall()
                        PhoneStatus.publish(this)
                    }
                    PhoneApi.Poll.Error -> {
                        // mat mang: giu nguyen trang thai (chuông vẫn kêu), thu lai sau 2 s.
                        // Vẫn cập nhật giờ poll để màn Cài đặt thấy vòng poll còn sống.
                        PhoneStatus.lastPollAt = System.currentTimeMillis()
                        PhoneStatus.publish(this)
                    }
                }
                if (!sleep()) break
            }
            running = false
            Log.i(TAG, "vong poll ket thuc")
        }.also { it.isDaemon = true; it.name = "phone-poll"; it.start() }
    }

    /** Ngu 2 s (ngat duoc khi service bi dung). false = phai thoat vong lap. */
    private fun sleep(): Boolean = try {
        Thread.sleep(POLL_MS)
        true
    } catch (e: InterruptedException) {
        false
    }

    private fun onIncoming(call: PhoneApi.Incoming) {
        // (12/11/2026) GD5: người dùng đã Nghe/Từ chối cuộc gọi này (server còn trả về vài giây) -> im lặng tuyệt đối:
        // không đăng lại thông báo (đăng lại = chuông kêu lại).
        if (PhoneStatus.handledCallId == call.id) return

        val same = ringing == call.id
        if (!same) {
            // Cuộc gọi mới: bỏ dấu "đã xử lý" của cuộc gọi trước.
            PhoneStatus.handledCallId = null
            ringing = call.id
            Log.i(TAG, "cuoc goi den ${call.id} tu ${call.fromName}")
        }
        RingState.start()
        PhoneStatus.callId = call.id
        PhoneStatus.ringing = true

        if (same) {
            // 1) Đang đổ chuông: ĐĂNG LẠI thông báo mỗi ~4 s -> kênh phát âm thanh + rung lại (chuông kêu lặp).
            //    Chưa tới nhịp thì thôi (poll 2 s nên lần nào cũng gọi vào đây).
            if (CallNotifications.notifyAgainIfDue(this, call)) Log.d(TAG, "dang lai thong bao cuoc goi ${call.id}")
            return
        }

        // 2) Cuộc gọi MỚI: đăng thông báo full-screen (kênh tự kêu chuông + rung) + 2 nút Nghe/Từ chối.
        postCallNotification(call)

        // 3) Màn khoá / màn tắt: hệ thống tự mở activity từ full-screen intent. Đang mở máy: thử mở thẳng;
        //    Android 10+ có thể chặn startActivity từ nền (khi đó người dùng bấm thông báo / bật "hiện cửa sổ nổi").
        try {
            startActivity(IncomingCallActivity.intentFor(this, call))
        } catch (t: Throwable) {
            Log.d(TAG, "khong mo thang duoc IncomingCallActivity: ${t.javaClass.simpleName}: ${t.message}")
        }
    }

    private fun onNoCall() {
        if (ringing == null) return
        ringing = null
        PhoneStatus.handledCallId = null
        RingState.stop()
        PhoneStatus.callId = null
        PhoneStatus.ringing = false
        cancelCallNotification()
        IncomingCallActivity.dismissFor(null)   // hết chuông (người kia cúp / quá 30 s / đã nghe)
    }

    private fun postCallNotification(call: PhoneApi.Incoming) {
        CallNotifications.notifyIncoming(this, call)
    }

    private fun cancelCallNotification() {
        CallNotifications.cancel(this)
    }
}

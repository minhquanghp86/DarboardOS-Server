package vn.mqsmarthome.dashboardos

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.util.Log

/**
 * (10/11/2026) GD2 — chuông báo cuộc gọi đến khi app ĐÓNG / ở nền.
 *
 * Chạy như foreground service (kiểu `specialUse` từ Android 14, `dataSync` cho Android 10-13) và tự bơm 2 giây/lần:
 *   - POST /app/register (khi bắt đầu, khi đổi URL, và 5 phút/lần) — id lấy từ SharedPreferences,
 *   - GET  /app/incoming?phone=<id> — có cuộc gọi thì dựng thông báo full-screen + mở IncomingCallActivity.
 * Không dùng WebSocket / Firebase: Polling 2 s là đủ nhanh cho chuông và chịu được mất mạng, vào lại Wi-Fi, màn khoá.
 */
class PhoneService : Service() {

    companion object {
        private const val TAG = "PhoneService"

        const val CH_SERVICE = "phone_service"
        const val CH_CALL = "incoming_call"
        const val NOTIF_SERVICE = 1001
        const val NOTIF_CALL = 1002

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
    private var wakeLock: android.os.PowerManager.WakeLock? = null

    @Volatile
    private var stopping = false

    /** Cuoc goi dang do chuong (tranh dung lai activity / thong bao moi 2 giay). */
    @Volatile
    private var ringing: String? = null

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
            val pm = getSystemService(android.os.PowerManager::class.java) ?: return
            wakeLock = pm.newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK, "DashboardOS:phone-poll").apply {
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

    private fun serviceNotification(): android.app.Notification {
        val open = android.app.PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE
        )
        return android.app.Notification.Builder(this, CH_SERVICE)
            .setSmallIcon(android.R.drawable.sym_action_call)
            .setContentTitle(getString(R.string.svc_title))
            .setContentText(getString(R.string.svc_text))
            .setOngoing(true)
            .setShowWhen(false)
            .setContentIntent(open)
            .build()
    }

    private fun ensureChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(android.app.NotificationManager::class.java) ?: return

        if (nm.getNotificationChannel(CH_SERVICE) == null) {
            nm.createNotificationChannel(
                android.app.NotificationChannel(
                    CH_SERVICE, getString(R.string.svc_channel), android.app.NotificationManager.IMPORTANCE_LOW
                ).apply {
                    description = getString(R.string.svc_channel_desc)
                    setShowBadge(false)
                }
            )
        }
        if (nm.getNotificationChannel(CH_CALL) == null) {
            nm.createNotificationChannel(
                android.app.NotificationChannel(
                    CH_CALL, getString(R.string.call_channel), android.app.NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    description = getString(R.string.call_channel_desc)
                    // Tu phat chuong + rung trong IncomingCallActivity (Ringtone/Vibrator), khong de he thong lam 2 lan.
                    setSound(null, null)
                    enableVibration(false)
                    lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
                }
            )
        }
    }

    // ────────────────────────────────────────────────────────────── vòng poll

    private fun startLoop() {
        if (loop?.isAlive == true) return
        stopping = false
        running = true
        loop = Thread {
            var lastRegister = 0L
            var registeredUrl: String? = null
            while (!stopping && Prefs.receiveEnabled(this)) {
                val url = Prefs.url(this)
                if (url.isNullOrBlank()) {
                    if (!sleep()) break
                    continue
                }
                val id = Prefs.phoneId(this)
                val now = System.currentTimeMillis()
                if (registeredUrl != url || now - lastRegister >= RE_REGISTER_MS) {
                    if (PhoneApi.register(url, id, Prefs.phoneName())) {
                        lastRegister = now
                        registeredUrl = url
                        Log.i(TAG, "da dang ky $id voi server")
                    }
                }
                when (val r = PhoneApi.incoming(url, id)) {
                    is PhoneApi.Poll.Ring -> onIncoming(url, r.call)
                    PhoneApi.Poll.None -> onNoCall()
                    PhoneApi.Poll.Error -> Unit   // mat mang: giu nguyen trang thai, thu lai sau 2 s
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

    private fun onIncoming(url: String, call: PhoneApi.Incoming) {
        val current = ringing
        if (current == call.id) return          // da bao roi, cho nguoi dung bam
        ringing = call.id
        Log.i(TAG, "cuoc goi den ${call.id} tu ${call.fromName}")
        postCallNotification(call)
        // Man khoa / man tat: he thong tu mo activity tu full-screen intent. Dang mo may: mo thang (co the bi
        // Android 10+ chan neu app o nen — khi do nguoi dung bam thong bao).
        try {
            startActivity(IncomingCallActivity.intentFor(this, call))
        } catch (t: Throwable) {
            Log.d(TAG, "khong mo thang duoc IncomingCallActivity: ${t.javaClass.simpleName}")
        }
    }

    private fun onNoCall() {
        if (ringing == null) return
        ringing = null
        cancelCallNotification()
        IncomingCallActivity.dismissFor(null)   // het chuong (nguoi kia cup / qua 30 s / da nghe)
    }

    private fun postCallNotification(call: PhoneApi.Incoming) {
        ensureChannels()
        val pi = android.app.PendingIntent.getActivity(
            this, 1, IncomingCallActivity.intentFor(this, call),
            android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE
        )
        val n = android.app.Notification.Builder(this, CH_CALL)
            .setSmallIcon(android.R.drawable.sym_action_call)
            .setContentTitle(getString(R.string.call_notif_title))
            .setContentText(call.fromName.ifBlank { call.from })
            .setCategory(android.app.Notification.CATEGORY_CALL)
            .setOngoing(true)
            .setAutoCancel(false)
            .setVisibility(android.app.Notification.VISIBILITY_PUBLIC)
            .setContentIntent(pi)
            .setFullScreenIntent(pi, true)
            .build()
        try {
            getSystemService(android.app.NotificationManager::class.java)?.notify(NOTIF_CALL, n)
        } catch (t: Throwable) {
            Log.w(TAG, "khong hien duoc thong bao cuoc goi: ${t.message}")
        }
    }

    private fun cancelCallNotification() {
        try {
            getSystemService(android.app.NotificationManager::class.java)?.cancel(NOTIF_CALL)
        } catch (t: Throwable) {
            Log.d(TAG, "cancel: ${t.message}")
        }
    }
}

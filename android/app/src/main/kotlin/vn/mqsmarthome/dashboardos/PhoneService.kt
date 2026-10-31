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
 * hiện cuộc gọi mới, vừa ĐĂNG LẠI thông báo khi đã quá CallNotifications.REPOST_MS.
 * (23/11/2026) GD10 — REPOST_MS nay là 30 s (trước 4 s): đăng lại thông báo là kênh phát nhạc chuông LẠI TỪ ĐẦU,
 * nên nhịp 4 s làm bản nhạc dài bị cắt/nghe như lặp mỗi 4-5 s. Nay chỉ đăng lại khi bản nhạc đã phát xong.
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

        /**
         * (26/11/2026) GD14 — nhịp CHỜ khi gốc API nằm sau ingress mà CHƯA có cookie `ingress_session`.
         *
         * Cookie đó chỉ xuất hiện SAU KHI panel của add-on được mở trong WebView (chính HA frontend tạo phiên — xem
         * `MainActivity`/`DashboardTarget`). Nên thay vì bắn `/app/incoming` mỗi 2 s để ăn 401 liên tục, service
         * **chờ** và thử lại mỗi 5 s.
         */
        const val WAIT_MS = 5_000L

        /**
         * (23/11/2026) GD10 — nhịp ĐĂNG LẠI thông báo cuộc gọi = [CallNotifications.REPOST_MS] (30 s, ≥ 25 s).
         * Trước đây 4 s -> cắt nhạc chuông dài. Xem [RepostPolicy].
         */
        const val REPOST_MS = CallNotifications.REPOST_MS

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
            var needLoginLogged = false
            var deniedBase: String? = null
            while (!stopping && Prefs.receiveEnabled(this)) {
                // (30/10/2026) GD4: dung THANG goc API da do duoc (khong suy ra tu URL trang nua).
                val base = Prefs.apiBase(this)
                if (base.isNullOrBlank()) {
                    if (!sleep()) break
                    continue
                }
                // (17/11/2026) GD9 — goc API co the nam sau ingress cua Home Assistant (khi nguoi dung chi nhap domain):
                // MOI loi goi /app/* phai kem COOKIE phien HA, khong thi ingress tra 401.
                // (26/11/2026) GD14 — phải là cookie `ingress_session` (do CHÍNH PANEL của add-on tạo khi mở trong
                // WebView), không phải "cookie bất kỳ": trước khi panel mở thì KHÔNG gọi gì cả, CHỜ và thử lại mỗi
                // [WAIT_MS] (5 s) — không bắn 401 liên tục mỗi 2 s.
                val ingress = WebTargetResolver.isIngressBase(base)
                val cookie = if (ingress) HaCookie.header(base) else null
                if (ingress && !WebTargetResolver.hasSessionCookie(cookie)) {
                    if (!needLoginLogged) {
                        needLoginLogged = true
                        Log.i(TAG, "gốc API qua ingress nhưng CHƯA có cookie ingress_session (panel chưa mở) → chờ 5 s/nhịp")
                        // (28/11/2026) GD16 — dòng `[api]` cũng vào ring buffer [Diag] (màn Chẩn đoán).
                        Diag.log(
                            "[api] base=" + DashboardTarget.shortUrl(base) +
                                " cookie=no → chờ panel tạo ingress_session (5 s/nhịp)"
                        )
                    }
                    PhoneStatus.needLogin = true
                    PhoneStatus.publish(this)
                    if (!sleep(WAIT_MS)) break
                    continue
                }
                if (needLoginLogged) { needLoginLogged = false; PhoneStatus.needLogin = false }
                var id = Prefs.phoneId(this)
                val now = System.currentTimeMillis()
                if (registeredBase != base || now - lastRegister >= RE_REGISTER_MS) {
                    // (GD8) gui kem deviceKey (ANDROID_ID) + model: server GOP ban ghi trung cua cung may va tra id CHUAN.
                    val sent = id
                    val canonical = PhoneApi.register(
                        base, Prefs.webUrl(this), sent, Prefs.phoneName(), Prefs.deviceKey(this), Prefs.phoneModel(), cookie
                    )
                    if (canonical != null) {
                        lastRegister = now
                        registeredBase = base
                        if (canonical != sent) {
                            // Server da gop (cai lai app -> id moi, cung deviceKey): dung id CHUAN tu day.
                            Prefs.setPhoneId(this, canonical)
                            id = canonical
                            Log.i(TAG, "server gop thiet bi: $sent -> $canonical")
                        }
                        Log.i(TAG, "da dang ky $id voi server")
                        Diag.log("[api] register ok id=$id base=" + DashboardTarget.shortUrl(base))
                    }
                }
                when (val r = PhoneApi.incoming(base, id, cookie)) {
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
                    is PhoneApi.Poll.Denied -> {
                        // (17/11/2026) GD9 — 401/403 = thieu cookie / can dang nhap HA; 404 = sai TOKEN ingress.
                        // Thu MOT lan cac ung viên khác (ingress -> slug add-on -> goc domain) roi ghi lai goc API.
                        // (26/11/2026) GD14 — ingress mà 401 thường là phiên `ingress_session` đã hết hạn/ chưa có:
                        // đánh dấu "cần đăng nhập", chờ 5 s mới thử lại (không spam 401 mỗi 2 s).
                        PhoneStatus.lastPollAt = System.currentTimeMillis()
                        if (ingress) {
                            PhoneStatus.needLogin = true
                            needLoginLogged = true
                        }
                        if (deniedBase != base) {
                            deniedBase = base
                            Log.w(TAG, "API $base tra ${r.code} (thiếu cookie ingress_session hoặc sai TOKEN ingress)")
                            Diag.log(
                                "[api] base=" + DashboardTarget.shortUrl(base) + " code=" + r.code +
                                    " (thiếu cookie ingress_session / sai TOKEN)"
                            )
                            reprobeApi(base)
                        }
                        PhoneStatus.publish(this)
                        if (ingress && !sleep(WAIT_MS)) break
                    }
                    PhoneApi.Poll.Error -> {
                        // mat mang: giu nguyen trang thai (chuong vẫn kêu), thu lai sau 2 s.
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

    /**
     * (17/11/2026) GD9 — goc API hien tai tra 401/404 (TOKEN ingress doi, doi domain, doi mang...): thu lai cac ung
     * vien suy ra tu dung dia chi nguoi dung da nhap (Prefs.oneInput) va ghi lai goc API dang chay duoc.
     * Khong bao gio nem loi; khong lam gi neu khong tim duoc ung vien tot hon.
     */
    private fun reprobeApi(current: String) {
        try {
            val list = WebTargetResolver.apiBasesForInput(Prefs.oneInput(this), Prefs.ingressToken(this))
            for (base in list) {
                if (base == current) continue
                val cookie = if (WebTargetResolver.isIngressBase(base)) HaCookie.header(base) else null
                if (WebTargetResolver.isIngressBase(base) && cookie.isNullOrBlank()) continue
                if (ServerResolver.probe(base, cookie) == null) continue
                Prefs.setApiBase(this, base)
                Prefs.setNeedHaLogin(this, false)
                Log.i(TAG, "chuyen goc API: $current -> $base")
                Diag.log(
                    "[api] base " + DashboardTarget.shortUrl(current) + " → " + DashboardTarget.shortUrl(base)
                )
                return
            }
        } catch (t: Throwable) {
            Log.d(TAG, "reprobe loi: ${t.javaClass.simpleName}: ${t.message}")
        }
    }

    /** Ngu [POLL_MS] (ngat duoc khi service bi dung). false = phai thoat vong lap. */
    private fun sleep(): Boolean = sleep(POLL_MS)

    /** Ngu [ms] (dùng [WAIT_MS] khi còn chờ cookie `ingress_session`). false = phải thoát vòng lặp. */
    private fun sleep(ms: Long): Boolean = try {
        Thread.sleep(ms)
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
            // 1) Đang đổ chuông: ĐĂNG LẠI thông báo khi đã quá CallNotifications.REPOST_MS (30 s) -> kênh phát âm
            //    thanh + rung lại. Chưa tới nhịp thì thôi (poll 2 s nên lần nào cũng gọi vào đây).
            //    (23/11/2026) GD10 — CHỈ re-post khi cuộc gọi CÒN đổ chuông và người dùng CHƯA Nghe/Từ chối: nhịp cũ
            //    4 s cắt nhạc chuông dài; nhịp mới 30 s nên với bản nhạc dài hơn 30 s thực tế chỉ đăng MỘT lần.
            if (PhoneStatus.ringing && PhoneStatus.handledCallId != call.id && CallNotifications.notifyAgainIfDue(this, call)) {
                Log.d(TAG, "dang lai thong bao cuoc goi ${call.id} (nhip ${REPOST_MS} ms)")
            }
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

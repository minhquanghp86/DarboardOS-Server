package vn.mqsmarthome.dashboardos

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.graphics.drawable.Icon
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.util.Log

/**
 * (12/11/2026) GD5 — KÊNH + THÔNG BÁO cuộc gọi đến (một chỗ duy nhất, dùng cho cả service và activity).
 *
 * ĐỔI CHIẾN LƯỢC CHUÔNG: app **KHÔNG tự phát nhạc chuông nữa** (CallRinger đã bỏ hẳn phần âm thanh/rung).
 * Âm thanh + rung do KÊNH THÔNG BÁO `incoming_call_v3` lo, nên:
 *   - người dùng tự chọn được nhạc chuông trong Cài đặt hệ thống (Cài đặt → Thông báo → Dashboard OS →
 *     kênh "Cuộc gọi đến" → Âm thanh), không còn bị nhạc chuông cứng của app,
 *   - máy ở chế độ Im lặng / Không làm phiền vẫn kêu: kênh IMPORTANCE_HIGH + setBypassDnd(true) (khi app có
 *     quyền "Do Not Disturb access") thì thông báo vẫn phát âm thanh/rung dù máy đang Im lặng hoặc DND.
 *
 * Kênh `incoming_call_v3`:
 *   - IMPORTANCE_HIGH  -> được phép bật full-screen intent / heads-up,
 *   - sound = RingtoneManager.getDefaultUri(TYPE_RINGTONE) + audioAttributes USAGE_NOTIFICATION_RINGTONE
 *     -> âm thanh chuông chuẩn "cuộc gọi", tôn trọng âm lượng chuông của máy,
 *   - enableVibration(true) + pattern rung dài -> rung do kênh lo (CallRinger không rung nữa, tránh rung đôi),
 *   - lockscreenVisibility PUBLIC -> hiện đầy đủ trên màn khoá.
 *
 * CHUÔNG KÊU LẶP: Android chỉ phát âm thanh của kênh khi thông báo được ĐĂNG (lại) và `setOnlyAlertOnce(false)`.
 * Vì vậy PhoneService / IncomingCallActivity đăng lại CÙNG một thông báo (cùng NOTIF_ID) khi đã quá [REPOST_MS]
 * kể từ lần đăng trước, chừng nào server còn trả về cuộc gọi đó — KHÔNG dùng FLAG_INSISTENT.
 *
 * (23/11/2026) GD10 — NHẠC CHUÔNG KHÔNG BỊ CẮT NỮA: mỗi lần đăng lại là kênh phát âm thanh LẠI TỪ ĐẦU, nên nhịp cũ
 * [RepostPolicy.LEGACY_REPOST_MS] = 4 s làm bản nhạc dài bị cắt mỗi 4 s (người dùng báo "phát lại mỗi 5 giây"). Nay
 * nhịp là [REPOST_MS] = [RepostPolicy.DEFAULT_MS] = 30 s (yêu cầu ≥ 25 s): chỉ đăng lại khi bản nhạc đã phát xong, và
 * với bản nhạc dài hơn 30 s thì thực tế chỉ đăng MỘT lần (cuộc gọi đổ chuông tối đa 30 s). Phép tính nhịp nằm ở
 * [RepostPolicy.due] (thuần Kotlin, có unit test JVM).
 *
 * Vì sao đổi id kênh (_v2 -> _v3): thông số kênh chỉ áp dụng LÚC TẠO. Máy đã cài bản trước giữ nguyên thiết lập
 * cũ (im lặng, không rung), nên phải tạo kênh mới và xoá các kênh cũ (`incoming_call`, `incoming_call_v2`).
 */
object CallNotifications {

    const val CHANNEL_ID = "incoming_call_v3"

    /** Kênh của các bản trước — Android không cho đổi thông số kênh đã tạo nên phải xoá hẳn. */
    private val LEGACY_CHANNEL_IDS = listOf("incoming_call", "incoming_call_v2")

    const val NOTIF_ID = 1002

    /**
     * Giãn cách TỐI THIỂU giữa 2 lần đăng lại thông báo khi còn đổ chuông: **30 s** ([RepostPolicy.DEFAULT_MS]).
     *
     * (23/11/2026) GD10 — Trước đây là 4 s: mỗi lần đăng lại kênh phát nhạc chuông LẠI TỪ ĐẦU, nên nhạc chuông dài bị
     * cắt/nghe như lặp mỗi 4-5 s. Nay 30 s (≥ 25 s theo yêu cầu): chỉ đăng lại khi bản nhạc đã phát xong; bản nhạc dài
     * hơn 30 s thì coi như chỉ đăng MỘT lần (người dùng nghe trọn bản nhạc).
     */
    const val REPOST_MS = RepostPolicy.DEFAULT_MS

    /** 0 ms chờ, rung 1 s, nghỉ 0,8 s, rung 1 s, nghỉ 0,8 s — "pattern rung dài" cho cuộc gọi đến. */
    private val VIBRATION_PATTERN = longArrayOf(0, 1_000, 800, 1_000, 800)

    private const val REQ_FULL_SCREEN = 1
    private const val REQ_ANSWER = 2
    private const val REQ_DECLINE = 3

    /** Lần đăng thông báo gần nhất + cuộc gọi của lần đó (dùng cho nhịp đăng lại). */
    @Volatile
    private var lastPostAt = 0L

    @Volatile
    private var postedCallId: String? = null

    // ────────────────────────────────────────────────────────────── kênh

    fun ensureChannel(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        for (id in LEGACY_CHANNEL_IDS) {
            try {
                if (nm.getNotificationChannel(id) != null) {
                    // Kênh của bản trước (im lặng / không rung / thiếu bypassDnd) -> bỏ đi.
                    nm.cancel(NOTIF_ID)
                    nm.deleteNotificationChannel(id)
                    Log.i(TAG, "da xoa kenh cu $id")
                }
            } catch (t: Throwable) {
                Log.d(TAG, "xoa kenh cu $id: ${t.javaClass.simpleName}: ${t.message}")
            }
        }

        if (nm.getNotificationChannel(CHANNEL_ID) != null) return

        // Ưu tiên kênh có bypassDnd; nếu hệ thống từ chối (thiếu quyền DND access) thì tạo lại KHÔNG có
        // bypassDnd — thà thiếu bypass còn hơn không có kênh cuộc gọi nào.
        val bypass = canBypassDnd(nm)
        try {
            nm.createNotificationChannel(newChannel(ctx, bypass))
            Log.i(TAG, "da tao kenh $CHANNEL_ID (HIGH, chuong he thong, rung, bypassDnd=$bypass)")
        } catch (t: Throwable) {
            Log.w(TAG, "tao kenh (bypassDnd=$bypass) loi: ${t.javaClass.simpleName}: ${t.message}")
            if (bypass) {
                try {
                    nm.createNotificationChannel(newChannel(ctx, false))
                    Log.i(TAG, "da tao kenh $CHANNEL_ID (khong bypassDnd)")
                } catch (t2: Throwable) {
                    Log.w(TAG, "tao kenh loi: ${t2.javaClass.simpleName}: ${t2.message}")
                }
            }
        }
    }

    private fun newChannel(ctx: Context, bypassDnd: Boolean): NotificationChannel =
        NotificationChannel(
            CHANNEL_ID,
            ctx.getString(R.string.call_channel),
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = ctx.getString(R.string.call_channel_desc)
            // Nhạc chuông mặc định của MÁY (người dùng đổi được trong cài đặt kênh), kiểu âm thanh "cuộc gọi".
            val attrs = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
            val sound: Uri? = try {
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            } catch (t: Throwable) {
                Log.w(TAG, "khong doc duoc nhac chuong mac dinh: ${t.javaClass.simpleName}")
                null
            }
            // setSound(uri, attrs) vừa đặt nhạc chuông vừa đặt audioAttributes (USAGE_NOTIFICATION_RINGTONE).
            if (sound != null) setSound(sound, attrs)
            // Rung do KÊNH lo (CallRinger không rung nữa) -> không bao giờ rung đôi.
            enableVibration(true)
            vibrationPattern = VIBRATION_PATTERN
            enableLights(true)
            setShowBadge(true)
            // Hiện đầy đủ trên màn khoá.
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            if (bypassDnd) {
                // Chỉ đặt được khi app có quyền "Do Not Disturb access" -> chuông kêu cả khi máy ở DND.
                try {
                    setBypassDnd(true)
                } catch (t: Throwable) {
                    Log.d(TAG, "setBypassDnd: ${t.javaClass.simpleName}: ${t.message}")
                }
            }
        }

    /** App có quyền bỏ qua chế độ Không làm phiền (Settings > DND access) hay không. */
    fun canBypassDnd(nm: NotificationManager): Boolean = try {
        nm.isNotificationPolicyAccessGranted
    } catch (t: Throwable) {
        false
    }

    /** Android 14+: app có được dùng full-screen intent không (nếu không, hệ thống chỉ hiện heads-up). */
    fun canUseFullScreen(ctx: Context): Boolean {
        if (Build.VERSION.SDK_INT < 34) return true
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return false
        return try {
            nm.canUseFullScreenIntent()
        } catch (t: Throwable) {
            false
        }
    }

    // ────────────────────────────────────────────────────────────── thông báo

    /**
     * Dựng + đăng thông báo cuộc gọi (full-screen intent + 2 nút Nghe / Từ chối).
     * KHÔNG đặt âm thanh / rung riêng cho thông báo: âm thanh + rung là của KÊNH [CHANNEL_ID].
     */
    fun notifyIncoming(ctx: Context, call: PhoneApi.Incoming) {
        ensureChannel(ctx)
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return

        val openPi = PendingIntent.getActivity(
            ctx, REQ_FULL_SCREEN, IncomingCallActivity.intentFor(ctx, call), piFlags()
        )
        val answerPi = PendingIntent.getActivity(
            ctx, REQ_ANSWER, IncomingCallActivity.intentFor(ctx, call, autoAnswer = true), piFlags()
        )
        val declinePi = PendingIntent.getBroadcast(
            ctx, REQ_DECLINE, CallActionReceiver.declineIntent(ctx, call.id), piFlags()
        )

        val title = ctx.getString(R.string.call_notif_title)
        val text = call.fromName.ifBlank { call.from }.ifBlank { ctx.getString(R.string.call_unknown_caller) }

        val n = Notification.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_call_notif)
            .setContentTitle(title)
            .setContentText(text)
            .setCategory(Notification.CATEGORY_CALL)
            .setPriority(Notification.PRIORITY_MAX)
            .setOngoing(true)
            .setAutoCancel(false)
            .setShowWhen(true)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            // (12/11/2026) Âm thanh + rung lấy từ KÊNH thông báo — KHÔNG setSound(null) / setDefaults(0) nữa.
            // setOnlyAlertOnce(false): mỗi lần ĐĂNG LẠI (cùng NOTIF_ID) là một lần kêu -> chuông lặp tới khi
            // Nghe / Từ chối. Không dùng FLAG_INSISTENT (thông báo không nhận cờ này).
            .setOnlyAlertOnce(false)
            .setContentIntent(openPi)
            // Khoá máy / màn hình tắt: hệ thống tự mở IncomingCallActivity từ đây (khi được cấp quyền).
            .setFullScreenIntent(openPi, true)
            .addAction(
                Notification.Action.Builder(
                    Icon.createWithResource(ctx, R.drawable.ic_call_answer),
                    ctx.getString(R.string.call_answer),
                    answerPi
                ).build()
            )
            .addAction(
                Notification.Action.Builder(
                    Icon.createWithResource(ctx, R.drawable.ic_call_decline),
                    ctx.getString(R.string.call_decline),
                    declinePi
                ).build()
            )
            .build()
        try {
            nm.notify(NOTIF_ID, n)
            synchronized(this) {
                lastPostAt = System.currentTimeMillis()
                postedCallId = call.id
            }
            Log.i(TAG, "da hien thong bao cuoc goi ${call.id} (fullScreen=${canUseFullScreen(ctx)})")
        } catch (t: Throwable) {
            Log.w(TAG, "khong hien duoc thong bao: ${t.javaClass.simpleName}: ${t.message}")
        }
    }

    /**
     * Đăng LẠI thông báo khi đã đủ [REPOST_MS] — đây chính là thứ làm chuông kêu lặp (Android chỉ phát âm thanh
     * của kênh khi thông báo được đăng lại với `setOnlyAlertOnce(false)` + cùng id).
     *
     * (23/11/2026) GD10 — nhịp do [RepostPolicy.due] quyết (30 s): KHÔNG còn cắt nhạc chuông mỗi 4 s. Nơi gọi chỉ
     * gọi hàm này khi cuộc gọi CÒN đổ chuông và người dùng CHƯA bấm Nghe/Từ chối.
     * true = vừa đăng (đã kêu thêm một nhịp).
     */
    fun notifyAgainIfDue(
        ctx: Context,
        call: PhoneApi.Incoming,
        now: Long = System.currentTimeMillis()
    ): Boolean {
        val last = synchronized(this) {
            if (postedCallId == call.id) lastPostAt else 0L
        }
        // Chưa có thông báo của cuộc gọi này (lần đầu / tiến trình vừa khởi động lại) -> đăng ngay.
        if (last <= 0L) {
            notifyIncoming(ctx, call)
            return true
        }
        if (!RepostPolicy.due(last, now, REPOST_MS)) return false
        notifyIncoming(ctx, call)
        return true
    }

    /** Bỏ thông báo + quên nhịp đăng lại (Nghe / Từ chối / cuộc gọi hết). */
    fun cancel(ctx: Context) {
        synchronized(this) {
            postedCallId = null
            lastPostAt = 0L
        }
        try {
            ctx.getSystemService(NotificationManager::class.java)?.cancel(NOTIF_ID)
        } catch (t: Throwable) {
            Log.d(TAG, "cancel: ${t.message}")
        }
    }

    private fun piFlags(): Int = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

    private const val TAG = "CallNotifications"
}

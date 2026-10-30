package vn.mqsmarthome.dashboardos

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.os.Build
import android.util.Log

/**
 * (11/11/2026) GD3 — KÊNH + THÔNG BÁO cuộc gọi đến (một chỗ duy nhất, dùng cho cả service và activity).
 *
 * Kênh `incoming_call_v2`:
 *   - IMPORTANCE_HIGH  -> được phép bật full-screen intent / heads-up,
 *   - setSound(null)   -> KHÔNG để hệ thống phát chuông (chuông do CallRinger phát để LẶP được),
 *   - enableVibration(false) -> KHÔNG rung hệ thống (rung do CallRinger),
 *   - setBypassDnd(true) khi app có quyền "Do Not Disturb access",
 *   - lockscreenVisibility PUBLIC -> hiện cả nội dung trên màn khoá.
 *
 * Vì sao là `_v2`: thông số kênh chỉ được áp dụng LÚC TẠO. Máy đã cài bản trước (kênh `incoming_call`)
 * sẽ giữ nguyên thiết lập cũ, nên đổi id + xoá kênh cũ là cách duy nhất để bản mới có hiệu lực.
 */
object CallNotifications {

    const val CHANNEL_ID = "incoming_call_v2"
    private const val LEGACY_CHANNEL_ID = "incoming_call"
    const val NOTIF_ID = 1002

    private const val REQ_FULL_SCREEN = 1
    private const val REQ_ANSWER = 2
    private const val REQ_DECLINE = 3

    // ────────────────────────────────────────────────────────────── kênh

    fun ensureChannel(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        try {
            if (nm.getNotificationChannel(LEGACY_CHANNEL_ID) != null) {
                // Kênh của bản trước (không có bypassDnd, có thể đã bị người dùng hạ mức) -> bỏ đi.
                nm.cancel(NOTIF_ID)
                nm.deleteNotificationChannel(LEGACY_CHANNEL_ID)
            }
        } catch (t: Throwable) {
            Log.d(TAG, "xoa kenh cu: ${t.javaClass.simpleName}: ${t.message}")
        }

        if (nm.getNotificationChannel(CHANNEL_ID) != null) return

        // Ưu tiên kênh có bypassDnd; nếu hệ thống từ chối (thiếu quyền DND access) thì tạo lại KHÔNG có
        // bypassDnd — thà thiếu bypass còn hơn không có kênh cuộc gọi nào.
        val bypass = canBypassDnd(nm)
        try {
            nm.createNotificationChannel(newChannel(ctx, bypass))
            Log.i(TAG, "da tao kenh $CHANNEL_ID (HIGH, im lang, bypassDnd=$bypass)")
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
            // Chuông + rung do CallRinger phát (để lặp được tới khi người dùng chọn) -> kênh im lặng.
            setSound(null, null)
            enableVibration(false)
            enableLights(true)
            setShowBadge(true)
            // Hiện đầy đủ trên màn khoá.
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            if (bypassDnd) {
                // Chỉ đặt được khi app có quyền "Do Not Disturb access".
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

    /** Dựng + hiện thông báo cuộc gọi (full-screen intent + 2 nút Nghe / Từ chối). */
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
            // (30/10/2026) Chi mot nguon am thanh: chuong do CallRinger phat. Thong bao phai CAM
            // hoan toan de khong keu chong (truoc day nghe 2 tieng chuong cung luc).
            .setOnlyAlertOnce(true)
            .setDefaults(0)
            .setSound(null)
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
            Log.i(TAG, "da hien thong bao cuoc goi ${call.id} (fullScreen=${canUseFullScreen(ctx)})")
        } catch (t: Throwable) {
            Log.w(TAG, "khong hien duoc thong bao: ${t.javaClass.simpleName}: ${t.message}")
        }
    }

    fun cancel(ctx: Context) {
        try {
            ctx.getSystemService(NotificationManager::class.java)?.cancel(NOTIF_ID)
        } catch (t: Throwable) {
            Log.d(TAG, "cancel: ${t.message}")
        }
    }

    private fun piFlags(): Int = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

    private const val TAG = "CallNotifications"
}

package vn.mqsmarthome.dashboardos

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * (11/11/2026) GD3 — nút "Từ chối" trên thông báo cuộc gọi (bấm được cả khi máy khoá).
 * (12/11/2026) GD5 — chuông/rung của KÊNH thông báo (không còn CallRinger): "tắt chuông" = huỷ thông báo.
 *
 * Dùng BroadcastReceiver thay vì mở activity: từ chối không cần giao diện, chỉ cần
 *   1. đánh dấu đã xử lý + tắt cờ đổ chuông (RingState),
 *   2. huỷ thông báo (hết âm thanh/rung của kênh) + đóng IncomingCallActivity,
 *   3. báo server POST /app/decline (chạy nền, lỗi mạng thì bỏ qua — lần poll sau server tự hết cuộc gọi).
 * Việc gọi mạng dùng goAsync() để tiến trình không bị kill giữa đường.
 */
class CallActionReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "CallAction"

        const val ACTION_DECLINE = "vn.mqsmarthome.dashboardos.DECLINE_CALL"
        const val EXTRA_CALL = "call_id"

        fun declineIntent(ctx: Context, callId: String): Intent =
            Intent(ctx, CallActionReceiver::class.java)
                .setAction(ACTION_DECLINE)
                .putExtra(EXTRA_CALL, callId)
    }

    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != ACTION_DECLINE) return
        val callId = intent.getStringExtra(EXTRA_CALL).orEmpty()
        Log.i(TAG, "nguoi dung tu choi cuoc goi $callId tu thong bao")

        // 1) Tắt chuông/rung + đóng màn hình gọi + bỏ thông báo (làm ngay, không chờ mạng).
        if (callId.isNotBlank()) PhoneStatus.handledCallId = callId
        RingState.stop()
        CallNotifications.cancel(context)
        IncomingCallActivity.dismissFor(callId.ifBlank { null })
        PhoneStatus.callId = null
        PhoneStatus.ringing = false
        PhoneStatus.publish(context)

        if (callId.isBlank()) return

        // 2) Báo server ở nền. (17/11/2026) GD9 — kèm cookie phiên HA khi gốc API là ingress của HA.
        val pending = goAsync()
        val appCtx = context.applicationContext
        Thread {
            try {
                val base = Prefs.apiBase(appCtx)
                val ok = PhoneApi.decline(base, Prefs.phoneId(appCtx), callId, HaCookie.header(base))
                Log.i(TAG, "POST /app/decline $callId -> $ok")
            } catch (t: Throwable) {
                Log.w(TAG, "decline loi: ${t.javaClass.simpleName}: ${t.message}")
            } finally {
                try {
                    pending.finish()
                } catch (t: Throwable) {
                    // bỏ qua
                }
            }
        }.also { it.isDaemon = true }.start()
    }
}

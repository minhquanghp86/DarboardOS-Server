package vn.mqsmarthome.dashboardos

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * (11/11/2026) GD3 — nút "Từ chối" trên thông báo cuộc gọi (bấm được cả khi máy khoá).
 * (12/11/2026) GD5 — chuông/rung của KÊNH thông báo (không còn CallRinger): "tắt chuông" = huỷ thông báo.
 * (1.8) — thêm [ACTION_ANSWER]: nút **"Nghe"** cũng có thể đi qua receiver này, và khi đó **việc mở trang gọi dùng
 * ĐÚNG một đoạn code với màn hình gọi** ([CallLauncher] → [CallPageTarget]) — bản 1.7 dựng URL từ `webUrl` (panel của
 * add-on trên HA) nên rơi vào route của SPA Home Assistant ⇒ app hiện dashboard Hass, không có giao diện gọi, bên gọi
 * không nhận `accepted` và vẫn "đang đổ chuông".
 *
 * Dùng BroadcastReceiver thay vì mở activity: từ chối không cần giao diện, chỉ cần
 *   1. đánh dấu đã xử lý + tắt cờ đổ chuông (RingState),
 *   2. huỷ thông báo (hết âm thanh/rung của kênh) + đóng IncomingCallActivity,
 *   3. báo server POST /app/decline (chạy nền, lỗi mạng thì bỏ qua — lần poll sau server tự hết cuộc gọi).
 * Việc gọi mạng dùng goAsync() để tiến trình không bị kill giữa đường.
 *
 * "Nghe" thì ngược lại: báo server `POST /app/answer` RỒI mở trang gọi (trang gửi `{type:'join'}` nên server gắn
 * phiên web làm đầu cuối tiếng/hình của máy này).
 */
class CallActionReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "CallAction"

        const val ACTION_DECLINE = "vn.mqsmarthome.dashboardos.DECLINE_CALL"

        /**
         * (1.8) Nút **"Nghe"** trên thông báo (nếu thông báo được cấu hình trỏ vào receiver này). Cùng một PendingIntent
         * key với [IncomingCallActivity.EXTRA_AUTO_ANSWER] ở bản hiện tại, nhưng đường dựng URL thì DÙNG CHUNG
         * ([CallLauncher]) nên không bao giờ lệch nhau.
         */
        const val ACTION_ANSWER = "vn.mqsmarthome.dashboardos.ANSWER_CALL"

        const val EXTRA_CALL = "call_id"

        fun declineIntent(ctx: Context, callId: String): Intent =
            Intent(ctx, CallActionReceiver::class.java)
                .setAction(ACTION_DECLINE)
                .putExtra(EXTRA_CALL, callId)

        /** (1.8) Intent "Nghe" cho thông báo (nếu dùng đường receiver). */
        fun answerIntent(ctx: Context, callId: String): Intent =
            Intent(ctx, CallActionReceiver::class.java)
                .setAction(ACTION_ANSWER)
                .putExtra(EXTRA_CALL, callId)
    }

    override fun onReceive(context: Context, intent: Intent?) {
        when (intent?.action) {
            ACTION_DECLINE -> onDecline(context, intent.getStringExtra(EXTRA_CALL).orEmpty())
            ACTION_ANSWER -> onAnswer(context, intent.getStringExtra(EXTRA_CALL).orEmpty())
            else -> Unit
        }
    }

    private fun onDecline(context: Context, callId: String) {
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

    /**
     * (1.8) **NGHE từ thông báo**: tắt chuông NGAY (người dùng đã quyết định), báo server `POST /app/answer`, rồi mở
     * trang gọi bằng [CallLauncher] — `apiBase` (ingress `…/api/hassio_ingress/<TOKEN>`), nếu không có thì dựng lại từ
     * domain + TOKEN, cuối cùng mới tới `webUrl` (chế độ IP LAN). Panel của HA **không bao giờ** được mở.
     */
    private fun onAnswer(context: Context, callId: String) {
        if (callId.isBlank()) return
        Log.i(TAG, "nguoi dung nghe cuoc goi $callId tu thong bao")

        if (callId.isNotBlank()) PhoneStatus.handledCallId = callId
        RingState.stop()
        CallNotifications.cancel(context)
        IncomingCallActivity.dismissFor(callId)
        PhoneStatus.ringing = false
        PhoneStatus.publish(context)

        val pending = goAsync()
        val appCtx = context.applicationContext
        Thread {
            try {
                // (17/11/2026) GD9 — kèm cookie phiên HA khi gốc API là ingress của HA; trang cần cuộc gọi "active".
                val base = Prefs.apiBase(appCtx)
                val ok = PhoneApi.answer(base, Prefs.phoneId(appCtx), callId, HaCookie.header(base))
                Log.i(TAG, "POST /app/answer $callId -> $ok")
            } catch (t: Throwable) {
                Log.w(TAG, "answer loi: ${t.javaClass.simpleName}: ${t.message}")
            } finally {
                try {
                    // (1.8) Mở trang gọi bằng ĐÚNG code của màn hình gọi (kiểm tra URL + điều hướng WebView đang sống).
                    CallLauncher.open(appCtx, callId, from = "notification")
                } catch (t: Throwable) {
                    Log.w(TAG, "mo trang goi loi: ${t.javaClass.simpleName}: ${t.message}")
                } finally {
                    try {
                        pending.finish()
                    } catch (t: Throwable) {
                        // bỏ qua
                    }
                }
            }
        }.also { it.isDaemon = true }.start()
    }
}

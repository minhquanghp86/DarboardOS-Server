package vn.mqsmarthome.dashboardos

import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * (11/11/2026) GD3 — trạng thái "sống" của PhoneService để màn Cài đặt hiển thị khi debug.
 *
 * Service ghi vào đây (poll cuối lúc nào, đang có cuộc gọi nào, chuông đang phát hay không) rồi
 * phát một broadcast NỘI BỘ (setPackage = chính app) để SettingsActivity cập nhật ngay, không phải
 * hỏi liên tục. SettingsActivity cũng đọc trực tiếp các biến này lúc mở màn (service có thể đã chạy từ trước).
 */
object PhoneStatus {

    /** Action broadcast nội bộ (gói theo package nên không lộ ra app khác). */
    const val ACTION_STATUS = "vn.mqsmarthome.dashboardos.PHONE_STATUS"
    const val EXTRA_LAST_POLL = "last_poll"
    const val EXTRA_CALL_ID = "call_id"
    const val EXTRA_RINGING = "ringing"

    /** Thời điểm (epoch ms) của lần poll /app/incoming thành công gần nhất; 0 = chưa poll lần nào. */
    @Volatile
    var lastPollAt: Long = 0L

    /** id cuộc gọi đang đổ chuông; null = không có cuộc gọi nào. */
    @Volatile
    var callId: String? = null

    /**
     * id cuộc gọi người dùng ĐÃ xử lý (Nghe / Từ chối). Service không được đổ chuông lại cuộc gọi này
     * dù server còn trả về nó trong vài giây (thời gian server xử lý lệnh answer/decline).
     */
    @Volatile
    var handledCallId: String? = null

    /** Chuông/rung đang phát (CallRinger.isRinging()). */
    @Volatile
    var ringing: Boolean = false

    /** Ghi trạng thái + báo cho SettingsActivity. Gọi được từ luồng nền. */
    fun publish(ctx: Context) {
        val i = Intent(ACTION_STATUS)
            .setPackage(ctx.packageName)
            .putExtra(EXTRA_LAST_POLL, lastPollAt)
            .putExtra(EXTRA_CALL_ID, callId)
            .putExtra(EXTRA_RINGING, ringing)
        try {
            ctx.sendBroadcast(i)
        } catch (t: Throwable) {
            Log.d(TAG, "sendBroadcast loi: ${t.javaClass.simpleName}: ${t.message}")
        }
    }

    private const val TAG = "PhoneStatus"
}

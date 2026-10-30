package vn.mqsmarthome.dashboardos

/**
 * (12/11/2026) GD5 — CỜ TRẠNG THÁI "đang đổ chuông" (thay cho CallRinger cũ).
 *
 * Trước đây CallRinger tự phát nhạc chuông (Ringtone/MediaPlayer lặp), tự nâng âm lượng và tự rung.
 * Nay app **KHÔNG tự phát âm thanh và không tự rung nữa**: âm thanh + rung do KÊNH THÔNG BÁO
 * `incoming_call_v3` lo (xem CallNotifications) — người dùng chọn được nhạc chuông trong cài đặt hệ thống
 * và chuông vẫn kêu khi máy ở Im lặng / Không làm phiền.
 *
 * Vì vậy lớp này chỉ còn MỘT cờ trạng thái dùng cho hiển thị (màn Cài đặt qua PhoneStatus.ringing) và cho
 * IncomingCallActivity biết có đang trong cuộc gọi đổ chuông hay không.
 */
object RingState {

    @Volatile
    private var ringing = false

    /** true = đang trong cuộc gọi đổ chuông (thông báo cuộc gọi đang được đăng / đăng lại). */
    fun isRinging(): Boolean = ringing

    /** Bắt đầu đổ chuông (gọi nhiều lần cũng không sao). */
    fun start() {
        ringing = true
    }

    /** Nghe / Từ chối / cuộc gọi hết. */
    fun stop() {
        ringing = false
    }
}

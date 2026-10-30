package vn.mqsmarthome.dashboardos

/**
 * (23/11/2026) GD10 — NHỊP ĐĂNG LẠI THÔNG BÁO CUỘC GỌI (thuần Kotlin, không chạm API Android -> test JVM được).
 *
 * Vì sao có lớp này: âm thanh chuông do KÊNH THÔNG BÁO phát, và Android chỉ phát lại âm thanh của kênh khi thông báo
 * được ĐĂNG LẠI. Bản trước đăng lại mỗi [LEGACY_REPOST_MS] = 4 s, nên với nhạc chuông DÀI (bản nhạc > 4 s) mỗi lần
 * đăng lại là một lần **cắt ngang và phát lại từ đầu** — nghe như bài bị giật/lặp liên tục (lỗi người dùng báo:
 * "nhạc chuông phát lại mỗi 5 giây").
 *
 * Nay: giãn cách tối thiểu [DEFAULT_MS] = 30 s (yêu cầu ≥ 25 s) — chỉ re-post khi bản nhạc đã phát xong; và với bản
 * nhạc dài hơn 30 s thì gần như chỉ đăng MỘT lần (người dùng nghe trọn bản nhạc). Cuộc gọi đổ chuông tối đa 30 s
 * (xem RING_S trong src/calls.ts) nên thực tế phần lớn cuộc gọi KHÔNG re-post lần nào.
 *
 * Điều kiện đi kèm (áp dụng ở nơi gọi — PhoneService.onIncoming / IncomingCallActivity.repostRunnable): chỉ re-post
 * khi cuộc gọi CÒN đổ chuông và người dùng CHƯA bấm Nghe/Từ chối.
 */
object RepostPolicy {

    /** Bản cũ: 4 s — quá ngắn, cắt nhạc chuông dài (giữ lại để test/so sánh, KHÔNG dùng nữa). */
    const val LEGACY_REPOST_MS = 4_000L

    /**
     * Giãn cách tối thiểu giữa 2 lần đăng lại thông báo cuộc gọi: 30 s.
     * ≥ 25 s theo yêu cầu; dài hơn độ dài nhạc chuông thông thường nên chỉ re-post khi bản nhạc đã phát xong.
     */
    const val DEFAULT_MS = 30_000L

    /**
     * Có đến nhịp đăng lại chưa?
     *
     * @param lastPostAt thời điểm đăng thông báo cuộc gọi gần nhất (epoch ms); 0 / ≤ 0 = chưa đăng lần nào.
     * @param now thời điểm hiện tại (epoch ms) — tham số để test được.
     * @return true = đã đủ [repostMs] kể từ lần đăng trước. Chưa đăng lần nào -> false (lần đầu do notifyIncoming lo).
     */
    fun due(lastPostAt: Long, now: Long, repostMs: Long = DEFAULT_MS): Boolean {
        if (lastPostAt <= 0L) return false
        if (repostMs <= 0L) return true
        return now - lastPostAt >= repostMs
    }

    /** Nhịp hiện hành (ms) — một chỗ duy nhất để đổi, mọi nơi khác đọc từ đây. */
    fun repostMs(): Long = DEFAULT_MS
}

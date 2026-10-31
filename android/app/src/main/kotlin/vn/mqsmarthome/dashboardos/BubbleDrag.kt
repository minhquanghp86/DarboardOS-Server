package vn.mqsmarthome.dashboardos

import kotlin.math.hypot
import kotlin.math.roundToInt

/**
 * (1.7) **BONG BÓNG “KẾT NỐI” KÉO ĐƯỢC** — phần THUẦN (không `android.*`) của cơ chế kéo/thả/nhớ vị trí, có test
 * riêng ([BubbleDragTest]) chạy bằng `./gradlew testDebugUnitTest --offline`.
 *
 * Vì sao tách khỏi [MainActivity]: toàn bộ phần “khó” của yêu cầu (phân biệt **tap** với **kéo**, kẹp trong màn hình,
 * đổi vị trí pixel ↔ tỉ lệ 0..1 để xoay máy / đổi độ phân giải vẫn đúng) là số học thuần — kiểm chứng được trên JVM,
 * không cần máy thật. `MainActivity` chỉ còn: đọc `MotionEvent`, gọi các hàm dưới đây, ghi `margin` và lưu [Prefs].
 *
 * Quy ước toạ độ: `x`,`y` là **góc trên-trái** của bong bóng (px) trong khung chứa (`FrameLayout` `webHost` ở
 * `activity_web.xml`); khung có kích thước `width` x `height`, bong bóng vuông `sizePx`, và phần trên dành cho
 * status bar là `topInsetPx` (bong bóng KHÔNG được chui lên trên mốc này).
 */
object BubbleDrag {

    /** Đường kính bong bóng (yêu cầu: 44dp). */
    const val SIZE_DP = 44

    /** Khoảng cách mặc định tới mép phải / mép trên khi chưa có vị trí đã lưu (12dp). */
    const val EDGE_GAP_DP = 12

    /** Ngưỡng **tap**: di chuyển < 8dp … */
    const val TAP_SLOP_DP = 8

    /** … và thời gian chạm < 200 ms. Quá một trong hai ⇒ là KÉO (không mở màn Kết nối). */
    const val TAP_TIMEOUT_MS = 200L

    /** Độ đậm lúc rảnh (yêu cầu 5). */
    const val ALPHA_IDLE = 0.55f

    /** Độ đậm khi đang kéo (yêu cầu 5) — sáng hơn để thấy rõ đang cầm bong bóng. */
    const val ALPHA_DRAG = 0.85f

    /** Độ đậm sau [FADE_AFTER_MS] không chạm — **mờ hơn nhưng VẪN bấm/kéo được**, không bao giờ ẩn hẳn. */
    const val ALPHA_FADED = 0.4f

    /** Không chạm 5 s ⇒ mờ về [ALPHA_FADED]. */
    const val FADE_AFTER_MS = 5000L

    /** Một vị trí (px trong khung chứa, hoặc tỉ lệ 0..1 khi mang nghĩa “đã chuẩn hoá”). */
    data class Pos(val x: Float, val y: Float)

    /**
     * **TAP hay KÉO?** (yêu cầu 2 + 3 của người dùng)
     *
     * `true` ⇔ tổng dịch chuyển `< slopPx` **và** thời gian chạm `< TAP_TIMEOUT_MS`:
     *  - đúng nghĩa “bấm”: ngón tay rung nhẹ vài px, nhấc lên nhanh ⇒ mở màn Kết nối (hành vi cũ);
     *  - giữ lâu hơn 200 ms dù không dời ⇒ **kéo** (người dùng đang “cầm” bong bóng), không mở gì cả.
     */
    fun isTap(dx: Float, dy: Float, durationMs: Long, slopPx: Float): Boolean {
        if (!dx.isFinite() || !dy.isFinite()) return false
        if (durationMs < 0L || durationMs >= TAP_TIMEOUT_MS) return false
        return hypot(dx.toDouble(), dy.toDouble()) < slopPx.toDouble()
    }

    /** Mốc dưới của trục Y: trên `topInsetPx` (status bar) và không vượt khung. */
    private fun minY(height: Int, sizePx: Int, topInsetPx: Int): Int =
        topInsetPx.coerceIn(0, (height - sizePx).coerceAtLeast(0))

    /** Độ dài quãng đường đi được trên trục X (>= 1 để chia an toàn khi khung chưa bố cục). */
    private fun spanX(width: Int, sizePx: Int): Int = (width - sizePx).coerceAtLeast(1)

    /** Độ dài quãng đường đi được trên trục Y (từ `minY` xuống đáy khung), >= 1. */
    private fun spanY(height: Int, sizePx: Int, topInsetPx: Int): Int =
        (height - sizePx - minY(height, sizePx, topInsetPx)).coerceAtLeast(1)

    /**
     * Kẹp một vị trí vào trong khung: `x` ∈ `[0, width-size]`, `y` ∈ `[minY, height-size]`.
     * Nhờ vậy kéo mạnh tay cũng không làm bong bóng “biến mất” ngoài màn hình (yêu cầu 2: kéo tự do **trong** màn hình).
     */
    fun clamp(pos: Pos, width: Int, height: Int, sizePx: Int, topInsetPx: Int = 0): Pos {
        val maxX = (width - sizePx).coerceAtLeast(0)
        val lo = minY(height, sizePx, topInsetPx).toFloat()
        val hi = (height - sizePx).coerceAtLeast(lo.toInt()).toFloat()
        return Pos(
            (if (pos.x.isFinite()) pos.x else 0f).coerceIn(0f, maxX.toFloat()),
            (if (pos.y.isFinite()) pos.y else lo).coerceIn(lo, hi)
        )
    }

    /**
     * Vị trí px → **tỉ lệ 0..1 theo quãng đường đi được** (yêu cầu 4: lưu theo tỉ lệ để xoay máy / đổi độ phân giải
     * vẫn đúng). `0` = sát mép trái/trên, `1` = sát mép phải/dưới — nên bong bóng ở góc phải trên vẫn ở góc phải trên
     * sau khi xoay ngang.
     */
    fun ratioOf(pos: Pos, width: Int, height: Int, sizePx: Int, topInsetPx: Int = 0): Pos {
        val c = clamp(pos, width, height, sizePx, topInsetPx)
        val sx = spanX(width, sizePx).toFloat()
        val sy = spanY(height, sizePx, topInsetPx).toFloat()
        val lo = minY(height, sizePx, topInsetPx).toFloat()
        return Pos((c.x / sx).coerceIn(0f, 1f), ((c.y - lo) / sy).coerceIn(0f, 1f))
    }

    /** Tỉ lệ 0..1 → vị trí px trong khung hiện tại (nghịch đảo của [ratioOf], có kẹp lại). */
    fun fromRatio(ratio: Pos, width: Int, height: Int, sizePx: Int, topInsetPx: Int = 0): Pos {
        val rx = if (ratio.x.isFinite()) ratio.x.coerceIn(0f, 1f) else 1f
        val ry = if (ratio.y.isFinite()) ratio.y.coerceIn(0f, 1f) else 0f
        val lo = minY(height, sizePx, topInsetPx).toFloat()
        val x = rx * spanX(width, sizePx)
        val y = lo + ry * spanY(height, sizePx, topInsetPx)
        return clamp(Pos(x, y), width, height, sizePx, topInsetPx)
    }

    /**
     * Vị trí **mặc định** khi chưa lưu gì (yêu cầu 4): góc **PHẢI TRÊN**, cách mép phải 12dp và cách mép trên
     * `topInsetPx + 12dp` (tức dưới status bar). Khung còn quá nhỏ ⇒ lùi về góc trái trên, không âm.
     */
    fun defaultPos(width: Int, height: Int, sizePx: Int, gapPx: Int, topInsetPx: Int = 0): Pos {
        val gap = gapPx.coerceAtLeast(0)
        val x = (width - sizePx - gap).toFloat()
        val y = (minY(height, sizePx, topInsetPx) + gap).toFloat()
        return clamp(Pos(x, y), width, height, sizePx, topInsetPx)
    }

    /** Làm tròn px cho `LayoutParams` (margin là số nguyên). */
    fun px(value: Float): Int = if (value.isFinite()) value.roundToInt() else 0
}

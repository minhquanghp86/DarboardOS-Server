package vn.mqsmarthome.dashboardos

import android.content.Context
import android.media.AudioAttributes
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log

/**
 * (10/11/2026) GD2 — chuông + rung LẶP cho cuộc gọi đến, cho tới khi người dùng bấm Nghe / Từ chối.
 *
 * - Chuông: Ringtone của máy (loa chuông), AudioAttributes USAGE_NOTIFICATION_RINGTONE + isLooping (Android 9+).
 * - Rung: Vibrator với waveform lặp lại (repeat = 0).
 * Không xin quyền micro: cuộc gọi GD2 mới chỉ báo + mở trang gọi, chưa truyền tiếng.
 */
class CallRinger(private val ctx: Context) {

    private var ringtone: Ringtone? = null
    private var vibrator: Vibrator? = null
    private var started = false

    fun start() {
        if (started) return
        started = true
        playRingtone()
        startVibration()
    }

    fun stop() {
        started = false
        try {
            ringtone?.stop()
        } catch (t: Throwable) {
            Log.d(TAG, "ringtone.stop: ${t.message}")
        }
        ringtone = null
        try {
            vibrator?.cancel()
        } catch (t: Throwable) {
            Log.d(TAG, "vibrator.cancel: ${t.message}")
        }
        vibrator = null
    }

    private fun playRingtone() {
        val attrs = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        // Chuong mac dinh cua may; khong co chuong -> am bao; van khong co -> chi rung.
        val candidates = listOf(
            RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
            RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
            RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
        )
        for (uri in candidates) {
            if (uri == null) continue
            try {
                val rt = RingtoneManager.getRingtone(ctx, uri) ?: continue
                rt.audioAttributes = attrs
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) rt.isLooping = true
                rt.play()
                ringtone = rt
                return
            } catch (t: Throwable) {
                Log.w(TAG, "khong phat duoc chuong $uri: ${t.javaClass.simpleName}: ${t.message}")
            }
        }
        Log.w(TAG, "may khong co chuong dung duoc — chi rung")
    }

    private fun startVibration() {
        val v = vibratorOrNull() ?: return
        // 0 ms cho, rung 600 ms, nghi 900 ms — lap lai tu dau (repeat = 0) cho den khi stop().
        val pattern = longArrayOf(0, 600, 900)
        try {
            v.vibrate(VibrationEffect.createWaveform(pattern, 0))
            vibrator = v
        } catch (t: Throwable) {
            Log.w(TAG, "khong rung duoc: ${t.javaClass.simpleName}: ${t.message}")
        }
    }

    @Suppress("DEPRECATION")
    private fun vibratorOrNull(): Vibrator? = try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
        } else {
            ctx.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        }
    } catch (t: Throwable) {
        null
    }

    private companion object {
        const val TAG = "CallRinger"
    }
}

package vn.mqsmarthome.dashboardos

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.Ringtone
import android.media.RingtoneManager
import android.net.Uri
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log

/**
 * (11/11/2026) GD3 — chuông + rung LẶP cho cuộc gọi đến, tới khi người dùng bấm Nghe / Từ chối.
 *
 * Vì sao là SINGLETON: PhoneService (báo cuộc gọi khi app đóng) và IncomingCallActivity (màn hình gọi)
 * sống trong CÙNG một tiến trình. Dùng chung một đối tượng thì:
 *   - không bao giờ có 2 chuông chồng nhau (service phát rồi activity không phát lại),
 *   - activity mở trước (người dùng bấm thông báo) thì service thấy isRinging() = true và không phát nữa,
 *   - service dừng (cuộc gọi hết) là activity cũng biết mà tắt.
 *
 * Chuông (theo thứ tự, dừng ở cách đầu tiên chạy được):
 *   1. Ringtone hệ thống của máy, AudioAttributes USAGE_NOTIFICATION_RINGTONE, isLooping = true
 *      (đúng đường chuẩn của Android, tôn trọng âm lượng chuông).
 *   2. MediaPlayer cùng file chuông đó nếu máy đang ở chế độ IM LẶNG / RUNG — chế độ đó làm Ringtone
 *      (và mọi thứ dùng USAGE_NOTIFICATION_RINGTONE) bị mute, nên phát qua USAGE_ALARM/STREAM_ALARM
 *      để chuông vẫn kêu; đây chính là kiểu "không có chuông" hay gặp trên MIUI.
 *   3. Ringtone dự phòng bằng âm báo/chuông báo động nếu máy không có file chuông nào đọc được.
 * Trước khi phát, âm lượng của luồng tương ứng được nâng lên mức cao (và khôi phục lại khi stop()).
 *
 * Rung: VibrationEffect.createWaveform(pattern, repeat = 0) — lặp vô hạn.
 */
class CallRinger private constructor(private val appCtx: Context) {

    private var ringtone: Ringtone? = null
    private var player: MediaPlayer? = null
    private var vibrator: Vibrator? = null

    /** Âm lượng đã đổi (stream -> mức cũ) để trả lại như cũ khi hết chuông. */
    private val savedVolumes = HashMap<Int, Int>()

    @Volatile
    private var ringing = false

    /** true khi chuông hoặc rung đang chạy — dùng để biết có phải phát dự phòng hay không. */
    fun isRinging(): Boolean = ringing

    /** Bắt đầu chuông + rung (gọi nhiều lần cũng chỉ chạy một lần). */
    fun start() {
        synchronized(this) {
            if (ringing) return
            ringing = true
        }
        Log.i(TAG, "bat dau chuong + rung")
        playSound()
        startVibration()
    }

    /** Tắt chuông + rung và trả âm lượng về như cũ. */
    fun stop() {
        synchronized(this) {
            if (!ringing) return
            ringing = false
        }
        Log.i(TAG, "dung chuong + rung")
        try {
            ringtone?.stop()
        } catch (t: Throwable) {
            Log.d(TAG, "ringtone.stop: ${t.message}")
        }
        ringtone = null
        try {
            player?.let {
                if (it.isPlaying) it.stop()
                it.release()
            }
        } catch (t: Throwable) {
            Log.d(TAG, "player.release: ${t.message}")
        }
        player = null
        try {
            vibrator?.cancel()
        } catch (t: Throwable) {
            Log.d(TAG, "vibrator.cancel: ${t.message}")
        }
        vibrator = null
        restoreVolumes()
    }

    // ────────────────────────────────────────────────────────────── chuông

    private fun playSound() {
        val am = audioManager()
        val normalMode = am == null || am.ringerMode == AudioManager.RINGER_MODE_NORMAL
        Log.i(TAG, "ringerMode=${am?.ringerMode ?: -1} normal=$normalMode")

        if (normalMode) {
            raiseVolume(AudioManager.STREAM_RING)
            if (startRingtone(RingtoneManager.TYPE_RINGTONE)) return
            if (startPlayer(
                    usage = AudioAttributes.USAGE_NOTIFICATION_RINGTONE,
                    contentType = AudioAttributes.CONTENT_TYPE_SONIFICATION
                )
            ) return
        } else {
            // Máy đang im lặng / chỉ rung: USAGE_NOTIFICATION_RINGTONE sẽ bị mute -> đi đường báo động.
            raiseVolume(AudioManager.STREAM_ALARM)
            if (startPlayer(
                    usage = AudioAttributes.USAGE_ALARM,
                    contentType = AudioAttributes.CONTENT_TYPE_SONIFICATION
                )
            ) return
            if (startRingtone(RingtoneManager.TYPE_RINGTONE)) return
        }
        // Cùng đường: chuông -> âm báo -> báo động.
        if (startRingtone(RingtoneManager.TYPE_NOTIFICATION)) return
        if (startPlayer(AudioAttributes.USAGE_ALARM, AudioAttributes.CONTENT_TYPE_SONIFICATION)) return
        Log.w(TAG, "may khong co am thanh nao dung duoc — chi rung")
    }

    /** Chuông mặc định của máy (hoặc loại dự phòng) bằng Ringtone lặp. */
    private fun startRingtone(type: Int): Boolean {
        val uri = defaultUri(type) ?: return false
        return try {
            val rt = RingtoneManager.getRingtone(appCtx, uri) ?: return false
            rt.audioAttributes = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
            // Android 9+ (minSdk 29): lặp vô hạn cho tới stop().
            rt.isLooping = true
            rt.play()
            synchronized(this) {
                if (!ringing) {
                    // stop() đã được gọi trong lúc đang play: tắt ngay, đừng để chuông mồ côi.
                    try {
                        rt.stop()
                    } catch (t: Throwable) {
                        // bỏ qua
                    }
                    return false
                }
                ringtone = rt
            }
            Log.i(TAG, "chuong Ringtone: $uri")
            true
        } catch (t: Throwable) {
            Log.w(TAG, "Ringtone $uri loi: ${t.javaClass.simpleName}: ${t.message}")
            false
        }
    }

    /** Dự phòng: MediaPlayer lặp trên file chuông hệ thống, định tuyến theo [usage]. */
    private fun startPlayer(usage: Int, contentType: Int): Boolean {
        val uri = defaultUri(RingtoneManager.TYPE_RINGTONE)
            ?: defaultUri(RingtoneManager.TYPE_NOTIFICATION)
            ?: defaultUri(RingtoneManager.TYPE_ALARM)
            ?: return false
        return try {
            val mp = MediaPlayer()
            mp.setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(usage)
                    .setContentType(contentType)
                    .build()
            )
            mp.setDataSource(appCtx, uri)
            mp.isLooping = true
            mp.setOnErrorListener { _, what, extra ->
                Log.w(TAG, "MediaPlayer loi what=$what extra=$extra")
                true
            }
            mp.prepare()
            mp.start()
            synchronized(this) {
                if (!ringing) {
                    try {
                        mp.stop()
                        mp.release()
                    } catch (t: Throwable) {
                        // bỏ qua
                    }
                    return false
                }
                player = mp
            }
            Log.i(TAG, "chuong MediaPlayer: $uri usage=$usage")
            true
        } catch (t: Throwable) {
            Log.w(TAG, "MediaPlayer $uri loi: ${t.javaClass.simpleName}: ${t.message}")
            false
        }
    }

    private fun defaultUri(type: Int): Uri? = try {
        RingtoneManager.getDefaultUri(type)
    } catch (t: Throwable) {
        null
    }

    // ────────────────────────────────────────────────────────────── rung

    private fun startVibration() {
        val v = vibratorOrNull() ?: run {
            Log.w(TAG, "may khong co Vibrator")
            return
        }
        try {
            if (!v.hasVibrator()) {
                Log.w(TAG, "may khong co rung")
                return
            }
        } catch (t: Throwable) {
            // bỏ qua, cứ thử rung
        }
        // 0 ms chờ, rung 800 ms, nghỉ 1000 ms — lặp lại từ đầu (repeat = 0) cho tới stop().
        val pattern = longArrayOf(0, 800, 1000)
        try {
            v.vibrate(VibrationEffect.createWaveform(pattern, 0))
            synchronized(this) { vibrator = v }
        } catch (t: Throwable) {
            Log.w(TAG, "khong rung duoc: ${t.javaClass.simpleName}: ${t.message}")
        }
    }

    @Suppress("DEPRECATION")
    private fun vibratorOrNull(): Vibrator? = try {
        (appCtx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
            ?: appCtx.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
    } catch (t: Throwable) {
        null
    }

    // ────────────────────────────────────────────────────────────── âm lượng

    /** Nâng âm lượng của [stream] lên mức cao nhất nếu đang thấp (nhớ mức cũ để trả lại). */
    private fun raiseVolume(stream: Int) {
        val am = audioManager() ?: return
        try {
            val max = am.getStreamMaxVolume(stream)
            val cur = am.getStreamVolume(stream)
            if (max <= 0 || cur >= max) return
            synchronized(this) {
                if (!savedVolumes.containsKey(stream)) savedVolumes[stream] = cur
            }
            am.setStreamVolume(stream, max, 0)
            Log.i(TAG, "nang am luong stream=$stream $cur -> $max")
        } catch (t: Throwable) {
            // Chế độ Không làm phiền có thể chặn đổi âm lượng (cần quyền DND access).
            Log.w(TAG, "khong nang duoc am luong stream=$stream: ${t.javaClass.simpleName}")
        }
    }

    private fun restoreVolumes() {
        val am = audioManager()
        val saved = synchronized(this) {
            val copy = HashMap(savedVolumes)
            savedVolumes.clear()
            copy
        }
        if (am == null) return
        for ((stream, volume) in saved) {
            try {
                am.setStreamVolume(stream, volume, 0)
            } catch (t: Throwable) {
                Log.d(TAG, "tra am luong stream=$stream loi: ${t.message}")
            }
        }
    }

    private fun audioManager(): AudioManager? = try {
        appCtx.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
    } catch (t: Throwable) {
        null
    }

    companion object {
        private const val TAG = "CallRinger"

        @Volatile
        private var instance: CallRinger? = null

        /** Một bản duy nhất cho cả tiến trình app. */
        fun get(ctx: Context): CallRinger = synchronized(this) {
            instance ?: CallRinger(ctx.applicationContext).also { instance = it }
        }
    }
}

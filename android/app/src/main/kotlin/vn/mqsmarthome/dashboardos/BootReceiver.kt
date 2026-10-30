package vn.mqsmarthome.dashboardos

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * (10/11/2026) GD2 — khởi động lại PhoneService sau khi máy khởi động lại (hoặc sau khi cập nhật app).
 *
 * Android 15 (targetSdk 35) chặn một số kiểu foreground service khởi động từ BOOT_COMPLETED (dataSync, camera,
 * microphone, mediaPlayback, phoneCall...), nhưng KHÔNG chặn `specialUse` — vì vậy PhoneService dùng specialUse trên
 * Android 14+ (xem PhoneService.promoteToForeground). Nếu hệ thống vẫn từ chối, PhoneService.start() chỉ ghi log.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        if (action != Intent.ACTION_BOOT_COMPLETED &&
            action != "android.intent.action.QUICKBOOT_POWERON" &&
            action != Intent.ACTION_MY_PACKAGE_REPLACED
        ) return
        if (!Prefs.receiveEnabled(context)) {
            Log.i(TAG, "$action: nguoi dung da tat nhan cuoc goi -> bo qua")
            return
        }
        Log.i(TAG, "$action: khoi dong lai PhoneService")
        PhoneService.start(context)
    }

    private companion object {
        const val TAG = "BootReceiver"
    }
}

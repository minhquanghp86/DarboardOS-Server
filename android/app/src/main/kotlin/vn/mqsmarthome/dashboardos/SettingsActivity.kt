package vn.mqsmarthome.dashboardos

import android.Manifest
import android.app.Activity
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.widget.Button
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast

/**
 * (10/11/2026) GD2 — màn Cài đặt nhỏ: bật/tắt "Nhận cuộc gọi khi app đóng" và xin các quyền cần thiết.
 *
 * Ba thứ quyết định chuông có kêu khi app đóng / máy khoá:
 *   1. quyền POST_NOTIFICATIONS (Android 13+) — không có thì không có thông báo full-screen,
 *   2. bỏ tối ưu pin — Android sẽ giết foreground service nếu nhà sản xuất quá tay,
 *   3. quyền "hiện toàn màn hình" (Android 14+) — app không phải loại gọi điện phải xin thủ công.
 */
class SettingsActivity : Activity() {

    companion object {
        private const val REQ_NOTIFICATIONS = 2001
    }

    private lateinit var receiveSwitch: Switch
    private lateinit var statusView: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)

        receiveSwitch = findViewById(R.id.receiveSwitch)
        statusView = findViewById(R.id.statusView)

        receiveSwitch.isChecked = Prefs.receiveEnabled(this)
        receiveSwitch.setOnCheckedChangeListener { _, on ->
            Prefs.setReceiveEnabled(this, on)
            if (on) PhoneService.start(this) else PhoneService.stop(this)
            updateStatus()
        }

        findViewById<Button>(R.id.notifButton).setOnClickListener { requestNotifications() }
        findViewById<Button>(R.id.batteryButton).setOnClickListener { requestIgnoreBattery() }
        findViewById<Button>(R.id.fullScreenButton).setOnClickListener { requestFullScreenIntent() }
        findViewById<Button>(R.id.closeButton).setOnClickListener { finish() }

        updateStatus()
    }

    override fun onResume() {
        super.onResume()
        updateStatus()
    }

    // ── quyền thông báo

    private fun requestNotifications() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            toast(getString(R.string.st_notif_ok))
            return
        }
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            toast(getString(R.string.st_notif_ok))
            return
        }
        requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIFICATIONS)
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQ_NOTIFICATIONS) return
        val ok = checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        toast(getString(if (ok) R.string.st_notif_ok else R.string.st_notif_no))
        if (!ok) openAppNotificationSettings()
        updateStatus()
    }

    private fun openAppNotificationSettings() {
        try {
            startActivity(
                Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        } catch (t: Throwable) {
            // bỏ qua
        }
    }

    // ── tối ưu pin

    private fun requestIgnoreBattery() {
        val pm = getSystemService(PowerManager::class.java)
        if (pm?.isIgnoringBatteryOptimizations(packageName) == true) {
            toast(getString(R.string.st_battery_ok))
            return
        }
        try {
            startActivity(
                Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        } catch (t: Throwable) {
            try {
                startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            } catch (t2: Throwable) {
                toast(getString(R.string.st_battery_no))
            }
        }
    }

    // ── toàn màn hình (Android 14+)

    private fun requestFullScreenIntent() {
        if (Build.VERSION.SDK_INT < 34) {
            toast(getString(R.string.st_full_ok))
            return
        }
        val nm = getSystemService(NotificationManager::class.java)
        if (nm?.canUseFullScreenIntent() == true) {
            toast(getString(R.string.st_full_ok))
            return
        }
        try {
            startActivity(
                Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:$packageName"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        } catch (t: Throwable) {
            toast(getString(R.string.st_full_no))
        }
    }

    // ── trạng thái

    private fun updateStatus() {
        val base = PhoneApi.apiBase(Prefs.url(this))
        val lines = StringBuilder()
        lines.append(getString(R.string.st_phone_id, Prefs.phoneId(this))).append('\n')
        lines.append(getString(R.string.st_server, base ?: getString(R.string.st_no_server))).append('\n')
        lines.append(getString(R.string.st_service, if (PhoneService.isRunning()) getString(R.string.st_on) else getString(R.string.st_off))).append('\n')
        lines.append(
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
            ) getString(R.string.st_notif_ok) else getString(R.string.st_notif_no)
        ).append('\n')
        val pm = getSystemService(PowerManager::class.java)
        lines.append(
            if (pm?.isIgnoringBatteryOptimizations(packageName) == true) getString(R.string.st_battery_ok)
            else getString(R.string.st_battery_no)
        )
        statusView.text = lines.toString()
    }

    private fun toast(msg: String) {
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
    }
}

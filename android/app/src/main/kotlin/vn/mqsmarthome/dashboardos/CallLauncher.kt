package vn.mqsmarthome.dashboardos

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.util.Log
import android.widget.Toast

/**
 * (1.8) **MỞ TRANG GỌI Ở ĐÚNG CHỖ** — phần "chạm Android" của việc bấm **Nghe** (phần THUẦN dựng/kiểm tra URL nằm ở
 * [CallPageTarget], xem KDoc đầu tệp đó để biết lỗi "hiện dashboard Home Assistant" của bản 1.7).
 *
 * Luật (đúng yêu cầu 1–4 của bản 1.8):
 *  1. URL do [CallPageTarget.build] quyết: `apiBase` (ingress) → dựng lại từ domain + TOKEN → `webUrl` (chỉ IP LAN);
 *  2. **chỉ mở** URL là ingress (`…/api/hassio_ingress/…`) hoặc `http(s)://<ip>:<port>`; panel HA thuần bị **loại**
 *     ([CallPageTarget.openable]) — không bao giờ quay lại lỗi cũ;
 *  3. ghi **một** dòng `[answer] url=… source=… ok=…` vào [Diag] (màn Cài đặt → Chẩn đoán) — dòng này **không**
 *     kích hoạt tự lưu tệp chẩn đoán ([DiagFile.shouldAutoSave]);
 *  4. **app đang mở + WebView còn sống** → điều hướng chính WebView đó ([MainActivity.openUrlIfLive]), KHÔNG tạo
 *     WebView/activity mới (giữ nguyên chế độ full-screen của add-on); app ở nền/đã đóng → mở [MainActivity] với
 *     [MainActivity.EXTRA_OPEN_URL] như bản trước.
 *
 * Vì sao tách khỏi [IncomingCallActivity]: cùng một việc "mở trang gọi" được gọi từ 2 chỗ — nút **Nghe** trên màn
 * hình gọi ([IncomingCallActivity]) và nút **Nghe** trên thông báo ([CallActionReceiver], action
 * [CallActionReceiver.ACTION_ANSWER]) — nên chỉ có MỘT đoạn code dựng URL.
 */
object CallLauncher {

    private const val TAG = "CallLauncher"

    /** `nav=` trong log: đã điều hướng WebView đang sống (không tạo activity mới). */
    const val NAV_WEBVIEW = "webview"

    /** `nav=` trong log: mở [MainActivity] bằng [MainActivity.EXTRA_OPEN_URL] (app ở nền / đã đóng). */
    const val NAV_ACTIVITY = "activity"

    /**
     * Dựng URL trang gọi cho [callId] rồi mở nó (WebView đang sống hoặc MainActivity).
     *
     * @param from nhãn nguồn gọi (chỉ để ghi Logcat: `activity` / `notification`).
     * @return `true` ⇔ đã có URL dùng được VÀ đã yêu cầu mở (không có nghĩa là trang đã nạp xong).
     */
    fun open(ctx: Context, callId: String, from: String = "?"): Boolean {
        val result = CallPageTarget.build(
            callId = callId,
            phoneId = Prefs.phoneId(ctx),
            apiBase = Prefs.apiBase(ctx),
            webUrl = Prefs.webUrl(ctx),
            loginUrl = Prefs.loginUrl(ctx),
            typed = Prefs.oneInput(ctx),
            token = Prefs.ingressToken(ctx)
        )
        // (1.8) YÊU CẦU 3 — dòng chẩn đoán chuẩn, KHÔNG kích hoạt tự lưu tệp (xem CallPageTarget.logLine).
        val line = CallPageTarget.logLine(result.url, result.source, result.ok)
        Diag.log(line)
        Log.i(TAG, "$line from=$from")

        val url = result.url ?: return false

        // (1.8) YÊU CẦU 4 — app đang mở và WebView còn sống: điều hướng chính WebView đó (giữ full-screen add-on).
        if (MainActivity.openUrlIfLive(url)) {
            Diag.log(CallPageTarget.navLine(url, NAV_WEBVIEW))
            return true
        }

        // App ở nền / đã đóng (không còn WebView): mở MainActivity với EXTRA_OPEN_URL như bản trước.
        val intent = Intent(ctx, MainActivity::class.java)
            .addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP
            )
            .putExtra(MainActivity.EXTRA_OPEN_URL, url)
        return try {
            ctx.startActivity(intent)
            Diag.log(CallPageTarget.navLine(url, NAV_ACTIVITY))
            true
        } catch (t: Throwable) {
            Log.w(TAG, "khong mo duoc trang goi: ${t.javaClass.simpleName}: ${t.message}")
            if (ctx is Activity) {
                runCatching { Toast.makeText(ctx, t.message ?: "?", Toast.LENGTH_SHORT).show() }
            }
            false
        }
    }
}

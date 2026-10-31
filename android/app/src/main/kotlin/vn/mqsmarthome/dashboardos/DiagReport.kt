package vn.mqsmarthome.dashboardos

import android.content.Context
import android.webkit.CookieManager

/**
 * (29/11/2026) GD17 — **NỘI DUNG BÁO CÁO CHẨN ĐOÁN** dùng chung cho 3 chỗ:
 *  1. màn Chẩn đoán ([DiagActivity] — hiển thị/sao chép/chia sẻ),
 *  2. nút **“Lưu ra tệp”** ([DiagStore.write]),
 *  3. tệp **tự lưu khi lỗi** ([DiagAutoSave] — kèm dòng “lý do”).
 *
 * Nhờ vậy tệp người dùng gửi đi luôn có cùng bố cục: header → (lý do) → 5 giá trị → 300 dòng log gần nhất.
 */
object DiagReport {

    /** Header + 5 giá trị + toàn bộ log ([Diag], tối đa 300 dòng). [reason] = lý do tự lưu (nếu có). */
    fun build(context: Context, reason: String? = null): String = buildString {
        append(context.getString(R.string.diag_share_header)).append('\n')
        val why = reason?.trim().orEmpty()
        if (why.isNotEmpty()) {
            append(context.getString(R.string.diag_file_reason, why)).append('\n')
        }
        append(values(context)).append("\n\n")
        append(context.getString(R.string.diag_log_section)).append('\n')
        append(Diag.text())
    }

    /** 5 giá trị chẩn đoán (mỗi dòng một giá trị) — đọc [DiagState] / [Prefs] / `CookieManager`. */
    fun values(context: Context): String {
        val none = context.getString(R.string.diag_none)
        val domain = DiagState.domain
            ?: DashboardTarget.originOf(Prefs.webUrl(context))
            ?: DashboardTarget.originOf(Prefs.loginUrl(context))
            ?: DashboardTarget.originOf(Prefs.oneInput(context))
        val webInUse = DiagState.webUrlInUse
            ?: Prefs.webUrl(context)?.takeIf { DashboardTarget.isValidSaved(it) }
            ?: DashboardTarget.candidates(
                saved = Prefs.webUrl(context),
                loginUrl = Prefs.loginUrl(context),
                typed = Prefs.oneInput(context),
                token = Prefs.ingressToken(context)
            ).firstOrNull()
        val current = DiagState.currentUrl
            ?: if (DiagState.webViewOpened) context.getString(R.string.diag_current_no_url)
            else context.getString(R.string.diag_current_no_webview)
        return buildString {
            append(context.getString(R.string.diag_v_domain, domain ?: none)).append('\n')
            append(context.getString(R.string.diag_v_web_in_use, webInUse ?: none)).append('\n')
            append(context.getString(R.string.diag_v_current, current)).append('\n')
            append(
                context.getString(
                    R.string.diag_v_cookie,
                    context.getString(if (hasIngressCookie(domain)) R.string.diag_yes else R.string.diag_no)
                )
            ).append('\n')
            append(context.getString(R.string.diag_v_token, Prefs.ingressToken(context)))
            if (DiagState.lastPromoteUrl != null || DiagState.lastPromoteResult != null) {
                append('\n').append(
                    context.getString(
                        R.string.diag_v_promote,
                        DiagState.lastPromoteResult ?: "-",
                        DiagState.lastPromoteUrl ?: none
                    )
                )
            }
        }
    }

    /**
     * `CookieManager` có `ingress_session` (hoặc `hassio_ingress`) cho [domain] không — dò cả cookie đặt ở
     * `Path=/api/hassio_ingress/` (đúng path mà HA frontend dùng).
     */
    fun hasIngressCookie(domain: String?): Boolean {
        val d = domain?.trim()?.trimEnd('/').orEmpty()
        if (d.isEmpty()) return false
        for (target in listOf(d + HaIngress.COOKIE_PATH, d)) {
            val raw = try {
                CookieManager.getInstance().getCookie(target)
            } catch (t: Throwable) {
                null
            }
            if (WebTargetResolver.hasSessionCookie(raw)) return true
        }
        return false
    }
}

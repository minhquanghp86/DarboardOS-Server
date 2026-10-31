package vn.mqsmarthome.dashboardos

/**
 * (1.6) **DÒNG PHIÊN BẢN** ở đầu trang nhập địa chỉ: `v<versionName> (<versionCode>)`, ví dụ `v1.6 (7)`.
 *
 * Lấy số liệu từ `PackageManager.getPackageInfo(...).versionName` / `.longVersionCode` (không cần bật
 * `buildFeatures.buildConfig`, app vẫn không phụ thuộc gì thêm). Hàm ở đây **thuần** nên unit test được trên JVM —
 * xem `AppVersionTest`.
 */
object AppVersion {

    /**
     * `versionName = "1.6"`, `versionCode = 7` → `"v1.6 (7)"`.
     *
     * `versionName` rỗng/không đọc được (PackageInfo lỗi) → `"v? (7)"` (vẫn hiện được mã build).
     */
    fun line(versionName: String?, versionCode: Long): String {
        val name = versionName?.trim().orEmpty().ifEmpty { "?" }
        val code = if (versionCode > 0L) versionCode.toString() else "?"
        return "v$name ($code)"
    }
}

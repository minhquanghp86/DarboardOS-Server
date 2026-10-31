package vn.mqsmarthome.dashboardos

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * (1.6) — dòng phiên bản ở đầu trang nhập địa chỉ: `v<versionName> (<versionCode>)` ([AppVersion]).
 *
 * Chạy: `cd android && ./gradlew testDebugUnitTest --offline --no-daemon`.
 */
class AppVersionTest {

    @Test
    fun dinh_dang_v_version_code() {
        // Đúng yêu cầu 3: `Dashboard OS` + `v<versionName> (<versionCode>)`.
        assertEquals("v1.6 (7)", AppVersion.line("1.6", 7L))
        assertEquals("v1.10 (12)", AppVersion.line("1.10", 12L))
        assertEquals("v1.6 (7)", AppVersion.line("  1.6  ", 7L))
    }

    @Test
    fun khong_doc_duoc_version_name_van_hien_ma_build() {
        assertEquals("v? (7)", AppVersion.line(null, 7L))
        assertEquals("v? (7)", AppVersion.line("", 7L))
        assertEquals("v? (7)", AppVersion.line("   ", 7L))
        assertEquals("v1.6 (?)", AppVersion.line("1.6", 0L))
    }
}

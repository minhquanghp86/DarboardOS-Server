import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// (26/11/2026) KY APK RELEASE bang khoa cua DashboardOS (android/keystore/dashboardos-release.jks).
// Mat khau nam trong android/keystore/keystore.properties (repo private, CO COMMIT — xem android/README.md).
// Khong co keystore.properties (may khac / clone thieu file) -> release tu fallback ve chu ky DEBUG de build
// khong vo; APK van cai duoc, chi la khong dung khoa phat hanh.
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore/keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
val hasReleaseKeystore = keystoreProps.getProperty("storeFile")?.let { f ->
    rootProject.file(f).exists() && keystoreProps.getProperty("storePassword") != null
} == true

android {
    namespace = "vn.mqsmarthome.dashboardos"
    compileSdk = 35
    buildToolsVersion = "35.0.0"

    defaultConfig {
        applicationId = "vn.mqsmarthome.dashboardos"
        minSdk = 29
        targetSdk = 35
        versionCode = 5
        versionName = "1.4"
    }

    signingConfigs {
        if (hasReleaseKeystore) {
            create("release") {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword") ?: keystoreProps.getProperty("storePassword")
            }
        }
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
            isShrinkResources = false
        }
        release {
            isMinifyEnabled = false
            isShrinkResources = false
            // Co khoa release -> ky bang khoa that; khong co -> debug (build khong vo).
            signingConfig = if (hasReleaseKeystore) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    // (10/11/2026) GD2: test JVM cho phan THUAN (dan xuat URL tu dia chi nguoi dung nhap) —
    // ./gradlew testDebugUnitTest --offline
    testOptions {
        unitTests.isReturnDefaultValues = true
    }

    // No local unit/androidTest sources yet; keep the build lean.
    packaging {
        resources.excludes += setOf("/META-INF/{AL2.0,LGPL2.1}")
    }
}

dependencies {
    // Intentionally dependency-free at runtime: framework android.* classes only
    // (WebView, SharedPreferences, Activity, Service) so the build works offline.
    // (10/11/2026) GD2: JUnit chỉ cho unit test JVM (đã có trong bộ nhớ đệm Gradle offline).
    testImplementation("junit:junit:4.13.2")
}

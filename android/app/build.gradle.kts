plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "vn.mqsmarthome.dashboardos"
    compileSdk = 35
    buildToolsVersion = "35.0.0"

    defaultConfig {
        applicationId = "vn.mqsmarthome.dashboardos"
        minSdk = 29
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
            isShrinkResources = false
        }
        release {
            isMinifyEnabled = false
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

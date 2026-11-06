plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "com.matchi.tool"
    compileSdk = 34
    defaultConfig {
        applicationId = "com.matchi.tool"
        minSdk = 26
        targetSdk = 28   // old target: keeps legacy /sdcard + exec behaviour working on router firmware
        versionCode = 152
        versionName = "1.1.42"
    }
    buildTypes { release { isMinifyEnabled = false } }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}
dependencies {
    implementation("org.nanohttpd:nanohttpd:2.3.1")
}

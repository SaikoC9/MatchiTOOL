import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// One permanent signing key for every build (debug and release), so updates can be installed over each other.
// Local: keystore.properties in the project root. CI: MATCHI_* environment variables (GitHub Secrets).
val ksProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.isFile) f.inputStream().use { load(it) }
}
fun ksValue(key: String, env: String): String? = ksProps.getProperty(key) ?: System.getenv(env)
android {
    namespace = "com.matchi.tool"
    compileSdk = 34
    defaultConfig {
        applicationId = "com.matchi.tool"
        minSdk = 26
        targetSdk = 28   // old target: keeps legacy /sdcard + exec behaviour working on router firmware
        versionCode = 205
        versionName = "1.2.5"
    }
    signingConfigs {
        create("matchi") {
            val file = ksValue("storeFile", "MATCHI_KEYSTORE_FILE")
            if (file != null) {
                storeFile = rootProject.file(file.removePrefix("../"))
                storePassword = ksValue("storePassword", "MATCHI_KEYSTORE_PASSWORD")
                keyAlias = ksValue("keyAlias", "MATCHI_KEY_ALIAS")
                keyPassword = ksValue("keyPassword", "MATCHI_KEY_PASSWORD")
            }
        }
    }
    buildTypes {
        // Releases must never be debuggable (a debuggable APK exposes the app's private data through `run-as`).
        release { isMinifyEnabled = false; isDebuggable = false }
        // A build without the keystore falls back to the default debug key (and cannot update a permanently signed install).
        // Without the keystore a RELEASE build used to come out unsigned (app-release-unsigned.apk), which the updater and Android both
        // reject ("The APK has no valid signature"). It now falls back to the debug key, like debug builds do.
        all {
            if (ksValue("storeFile", "MATCHI_KEYSTORE_FILE") != null) signingConfig = signingConfigs.getByName("matchi")
            else if (name == "release") signingConfig = signingConfigs.getByName("debug")
        }
    }
    // targetSdk 28 is deliberate (router firmware); without this the release lint gate rejects it as "expired".
    lint { disable += listOf("ExpiredTargetSdkVersion", "OldTargetApi") }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}
dependencies {
    implementation("org.nanohttpd:nanohttpd:2.3.1")
    testImplementation("junit:junit:4.13.2")
}

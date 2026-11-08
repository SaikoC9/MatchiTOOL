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
fun ksValue(key: String, env: String): String? = (ksProps.getProperty(key) ?: System.getenv(env))?.takeIf { it.isNotBlank() }   // an empty secret counts as missing
val ksIncomplete = ksValue("storeFile", "MATCHI_KEYSTORE_FILE") != null &&
    (ksValue("storePassword", "MATCHI_KEYSTORE_PASSWORD") == null || ksValue("keyAlias", "MATCHI_KEY_ALIAS") == null || ksValue("keyPassword", "MATCHI_KEY_PASSWORD") == null)
android {
    namespace = "com.matchi.tool"
    compileSdk = 34
    defaultConfig {
        applicationId = "com.matchi.tool"
        minSdk = 26
        targetSdk = 28   // old target: keeps legacy /sdcard + exec behaviour working on router firmware
        versionCode = 307
        versionName = "1.3.7"
    }
    signingConfigs {
        create("matchi") {
            val file = ksValue("storeFile", "MATCHI_KEYSTORE_FILE")
            if (file != null) {
                val sp = ksValue("storePassword", "MATCHI_KEYSTORE_PASSWORD")
                val ka = ksValue("keyAlias", "MATCHI_KEY_ALIAS")
                val kp = ksValue("keyPassword", "MATCHI_KEY_PASSWORD")
                // Incomplete settings are reported only when a task really signs (see the taskGraph check below), so unit tests
                // and other tasks that never sign still run when only the keystore file is set.
                if (sp != null && ka != null && kp != null) {
                // Paths in keystore.properties may start with "../" (relative to app/); they are resolved from the project root.
                    storeFile = rootProject.file(file.removePrefix("../"))
                    storePassword = sp
                    keyAlias = ka
                    keyPassword = kp
                }
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
            else if (name == "release") {
                logger.warn("WARNING: no keystore configured - this release APK is signed with the DEBUG key and cannot update a permanently signed install.")
                signingConfig = signingConfigs.getByName("debug")
            }
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

// Clear message instead of an obscure signing error: only when a signing task is part of this build.
gradle.taskGraph.whenReady {
    if (ksIncomplete && allTasks.any { it.name.startsWith("validateSigning") || it.name.startsWith("sign") })
        throw GradleException("Keystore file is set but MATCHI_KEYSTORE_PASSWORD, MATCHI_KEY_ALIAS or MATCHI_KEY_PASSWORD (or storePassword/keyAlias/keyPassword in keystore.properties) is missing or empty.")
}

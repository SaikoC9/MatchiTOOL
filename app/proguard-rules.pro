# Release builds run R8: shrink unused code/resources, obfuscate (rename) MatchiTOOL's own classes/members, and optimise.
#
# Readable crash traces without keeping names: SourceFile + LineNumberTable are kept (so the Log Catcher still shows a file
# and a line, which is enough to find the spot in source with the matching mapping.txt) and -renamesourcefileattribute
# replaces the real file name in that attribute with "MatchiTOOL" (the line number alone is useless without the mapping
# anyway, and this keeps a renamed class from also leaking its original file name). Every release build's
# app/build/outputs/mapping/release/mapping.txt must be kept (named by versionCode) to de-obfuscate a trace pulled off a
# device; CI uploads it as a private build artifact (see .github/workflows/build.yml) - never attach it to a public release.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute MatchiTOOL

# Checked (16 Nov 2026) before turning renaming on: no Class.forName/reflection, no Gson/Room/Dagger or other
# annotation-driven lookup, and the only app classes read by javaClass.simpleName in a log/error message are JDK/Android
# exception types (IOException, SecurityException, ...), which this file does not touch - never a type this app defines.
# The three manifest components (MainActivity, HostService, BootReceiver) are kept by AGP's own default rules
# (getDefaultProguardFile("proguard-android.txt") in build.gradle.kts), so the manifest's launch-by-class-name still works
# renamed. Nothing else in the app is looked up by class/method name, so no app-specific -keep is needed for that.
-keep class fi.iki.elonen.** { *; }

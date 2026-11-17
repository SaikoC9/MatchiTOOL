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
#
# AGP 8.5.2 runs R8 in full mode by default, which already merges/flattens MatchiTOOL's own classes into short,
# single-letter package+class names (confirmed in a built release APK: a/a0, a/b2, ...). The two lines below make
# that explicit and push it slightly further instead of relying on full mode's current defaults:
#   - repackageclasses puts every renamed app class in one unnamed top-level package (not just short names within
#     each original package), so the dex no longer preserves the app's original package layout at all.
#   - allowaccessmodification lets R8 widen/merge visibility across app classes so more private-looking helper
#     classes and methods can be inlined or merged away entirely rather than just renamed. Safe here because
#     nothing in the app is looked up by name (see above) and the only components that must stay reachable
#     (MainActivity/HostService/BootReceiver) are already force-kept by AGP's default rules.
-repackageclasses ''
-allowaccessmodification

# fi.iki.elonen.** (nanohttpd) is intentionally kept fully readable and un-renamed, not shrunk: NanoHTTPD's static
# initializer loads its default temp-file-manager factory via Class.forName() using the library's own hardcoded
# class name. Renaming or stripping any of its internals would break that lookup at runtime. This keep only
# affects the third-party library, never MatchiTOOL's own code above.
-keep class fi.iki.elonen.** { *; }

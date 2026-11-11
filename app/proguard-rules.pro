# Release builds run R8 to drop unused code and resources, and nothing else.
# MatchiTOOL is a root tool that shows its own stack traces in the Log Catcher, and it has no reflection to keep track of, so:
#   - no renaming (readable traces, same class names in logs and in the source)
#   - no optimising (the code that runs is the code that was written)
#   - every class of the app and of the bundled web server library is kept as is
-dontobfuscate
-dontoptimize
-keep class com.matchi.tool.** { *; }
-keep class fi.iki.elonen.** { *; }

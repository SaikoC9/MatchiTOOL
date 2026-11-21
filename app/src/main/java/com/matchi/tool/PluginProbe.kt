package com.matchi.tool

// The size probe behind the plugin Delete dialog. Pure logic (no Android classes) so unit tests can run it.

// Paths passed the strict character check in checkPluginDataPath, so they cannot break out of single quotes.
internal fun quotedList(paths: List<String>) = paths.joinToString(" ") { "'$it'" }

/**
 * Size probe cache: the dialog and repeated clicks used to start a fresh root du every time. One probe at a time, and a successful answer is
 * reused for [ttlMs] (dropped when a plugin is deleted so the re-check after Delete is always fresh). A failed answer is never reused.
 */
internal class ProbeCacheImpl(private val ttlMs: Long = 10_000, private val clock: () -> Long = System::currentTimeMillis) {
    private var key = ""; private var at = 0L; private var res: ShellResult? = null
    @Synchronized fun get(k: String, run: () -> ShellResult): ShellResult {
        val r = res
        if (r != null && k == key && clock() - at < ttlMs && r.success) return r
        val n = run(); key = k; at = clock(); res = n; return n
    }
    @Synchronized fun clear() { res = null }
}

internal val ProbeCache = ProbeCacheImpl()

/** -x: never cross into a proc/sys/dev mount inside a plugin's rootfs. timeout 8: never hang. Output lines: "EXISTS <kb> <path>". */
internal fun probeScript(paths: List<String>) =
    "T=; command -v timeout >/dev/null 2>&1 && T='timeout 8'; " +
    "for p in ${quotedList(paths)}; do if [ -e \"\$p\" ] || [ -L \"\$p\" ]; then " +
    "echo \"EXISTS \$(\$T du -skx -- \"\$p\" 2>/dev/null | cut -f1) \$p\"; fi; done; true"

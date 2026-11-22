package com.matchi.tool

/**
 * The app side of the bundled `matchi-guard` (tools/guard): the root scripts that start and stop its `watch` loop and the rules for
 * reading its report. Plain Kotlin, no Android classes, so it is unit tested. Starting as root and the route are in GuardRoutes.kt.
 *
 * The program is started only by its full path inside the app's files folder, after [BinaryCheck.problem] said the file is the one the app
 * was built with. The report is written by the program into the app's own files folder (see [reportFile]), so the page route reads it
 * without a root call. Only `watch` is started here; `run` is not used by the host yet.
 */
object GuardHost {
    /** Name in assets/bin, in the files folder and in [BinaryHashes]. */
    const val BINARY = "matchi-guard"

    /** Seconds between two sweeps of the program (the default), and the ones the person may choose. 1 s costs about 2.5 % of a core. */
    const val INTERVAL_S = 10
    val INTERVALS = listOf(1, 5, 10)
    fun validInterval(n: Int): Boolean = n in INTERVALS

    /** A report older than this many intervals means the program is not running (or the phone slept). */
    const val STALE_INTERVALS = 3

    /** Folder (inside the files folder) and file name of the report. */
    const val REPORT_DIR = "guard"
    const val REPORT_NAME = "report.json"

    /** A report larger than this is not ours; the route does not parse it. */
    const val REPORT_MAX = 64 * 1024

    fun reportPath(dir: String): String = "$dir/$REPORT_DIR/$REPORT_NAME"

    /**
     * Root script: ends an older `watch` of ours, then starts a new one in its own session with no input and no output.
     * Only a process whose command line STARTS with "<dir>/matchi-guard watch " is ended, so a `run` (which supervises a plugin) and
     * the shell that runs this script are never touched. Null when [dir] is not a plain absolute path.
     */
    fun startScript(dir: String, interval: Int = INTERVAL_S): String? {
        if (!LiveEngine.pathIsSafe(dir) || !validInterval(interval)) return null
        val g = "$dir/$BINARY"
        return listOf(
            stopLines(g),
            "if command -v setsid >/dev/null 2>&1; then S=setsid; else S=; fi",
            "\$S nohup '$g' watch --interval $interval --report '${reportPath(dir)}' </dev/null >/dev/null 2>&1 &",
            "echo started",
        ).joinToString("\n")
    }

    /** Root script: ends our `watch` and nothing else (same match as [startScript]). Null when [dir] is not a plain absolute path. */
    fun stopScript(dir: String): String? {
        if (!LiveEngine.pathIsSafe(dir)) return null
        return stopLines("$dir/$BINARY") + "\necho stopped"
    }

    private fun stopLines(g: String): String =
        "ps -A -o PID,ARGS 2>/dev/null | while read -r p a; do case \"\$p\" in ''|*[!0-9]*) continue ;; esac; " +
            "case \"\$a\" in '$g watch '*) kill \"\$p\" 2>/dev/null ;; esac; done"

    /** True when a report written at [ts] (unix seconds) still shows a running program at [now]. */
    fun fresh(ts: Long, now: Long, intervalS: Int = INTERVAL_S): Boolean =
        ts > 0 && now - ts <= intervalS.toLong() * STALE_INTERVALS + 5
}

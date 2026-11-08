package com.matchi.tool

/**
 * Pure logic for the boot-time log capture (no Android classes, unit tested): settings limits, the file names the
 * viewer may open, the version header of the shipped script, status parsing and the shell fragment that reads one page.
 */
object BootLogdModel {
    const val SCRIPT_PATH = "/data/adb/service.d/matchi_logd.sh"
    const val BASE_DIR = "/data/local/matchitool"
    const val LOG_DIR = "$BASE_DIR/bootlogs"
    const val CONF_PATH = "$BASE_DIR/logd.conf"
    const val MAX_PAGE_LINES = 500

    data class Config(val fileKb: Int = 2048, val files: Int = 10, val minFreeMb: Int = 200) {
        /** Same limits the script applies, so what the page shows is what runs. */
        fun clamped() = Config(fileKb.coerceIn(64, 16384), files.coerceIn(2, 40), minFreeMb.coerceIn(50, 5000))
        /** Upper bound of disk use: two rotated sources plus small files. */
        fun maxTotalKb(): Int { val c = clamped(); return c.fileKb * c.files * 2 + 2048 }
        fun render(): String { val c = clamped(); return "FILE_KB=${c.fileKb}\nFILES=${c.files}\nMIN_FREE_MB=${c.minFreeMb}\n" }
    }

    private val versionRx = Regex("^# MATCHI_LOGD_VERSION=(\\d+)\\s*$", RegexOption.MULTILINE)
    /** The "# MATCHI_LOGD_VERSION=n" header of a script text, or null. */
    fun scriptVersion(text: String): Int? = versionRx.find(text.take(2000))?.groupValues?.get(1)?.toIntOrNull()

    /** True when an installed script is missing or older than the one shipped in the app, so it must be re-installed. */
    fun needsReinstall(installed: Int?, bundled: Int?): Boolean = bundled != null && (installed == null || installed < bundled)

    private val fileRx = Regex("^(logcat\\.log|dmesg\\.log)(\\.\\d{1,2})?$")
    private val fixedFiles = setOf("events.log", "context.txt", "logcat.gaps", "status", "magisk.log", "modules.txt", "app_shell_audit.log", "updater.log", "app_events.log")
    /** Only these names can be opened through the web API (no path separators, nothing outside the capture folder). */
    fun isSafeFileName(name: String): Boolean = name.length <= 24 && (fixedFiles.contains(name) || fileRx.matches(name))

    /** Rotation number: logcat.log = 0 (newest), logcat.log.3 = 3 (older). Used to list newest first. */
    fun rotationIndex(name: String): Int = name.substringAfterLast('.', "").toIntOrNull() ?: 0

    fun parseStatus(text: String): Map<String, String> =
        text.lineSequence().mapNotNull { l -> val i = l.indexOf('='); if (i > 0) l.substring(0, i).trim() to l.substring(i + 1).trim() else null }.toMap()

    private val timeRx = Regex("^[0-9:. \\-]{1,30}$")
    /** A time prefix as it appears in a logcat line ("11-08 16:00"), or null when it holds anything else (it goes into a shell command). */
    fun safeTimePrefix(s: String?): String? = s?.trim()?.takeIf { it.isNotEmpty() && timeRx.matches(it) }

    /**
     * Shell fragment that prints "TOTAL=<lines>", "START=<line>" and "---" followed by up to [limit] lines starting at
     * line [start] (1-based), or at the first line containing [from] when given. Long lines are cut at 1000 characters.
     */
    fun pageCommand(file: String, start: Int, limit: Int, from: String?): String {
        require(isSafeFileName(file)) { "unsafe file name" }
        val path = "$LOG_DIR/$file"
        val n = limit.coerceIn(1, MAX_PAGE_LINES)
        val s = start.coerceAtLeast(1)
        val jump = safeTimePrefix(from)
        val startExpr = if (jump != null) "S=\$(grep -n -m1 -F -- '$jump' '$path' | cut -d: -f1); [ -n \"\$S\" ] || S=$s" else "S=$s"
        return "F='$path'; [ -f \"\$F\" ] || { echo MISSING; exit 0; }\n" +
            "echo TOTAL=\$(wc -l < \"\$F\")\n$startExpr\necho START=\$S\necho ---\n" +
            "tail -n +\$S \"\$F\" | head -n $n | cut -c1-1000"
    }

    /** What the boot script has captured, counted from the files themselves (it never filters or collapses anything). */
    data class Counters(val logcatLines: Long, val logcatErrors: Long, val logcatWarnings: Long, val dmesgLines: Long, val gaps: Long, val events: Long)

    /** One shell fragment that prints the counts as KEY=value lines. Rotated parts (logcat.log.1, ...) are included. */
    fun countersCommand(): String {
        val d = LOG_DIR
        val lc = "cat \"$d\"/logcat.log \"$d\"/logcat.log.[0-9]* 2>/dev/null"
        val head = "^[0-9-]+ [0-9:.]+ +[0-9]+ +[0-9]+ "     // date, time, pid, tid; the priority letter follows
        return "echo LOGCAT_LINES=\$($lc | wc -l)\n" +
            "echo LOGCAT_ERRORS=\$($lc | grep -c -E '$head[EFA] ')\n" +
            "echo LOGCAT_WARNINGS=\$($lc | grep -c -E '${head}W ')\n" +
            "echo DMESG_LINES=\$(cat \"$d\"/dmesg.log \"$d\"/dmesg.log.[0-9]* 2>/dev/null | wc -l)\n" +
            "echo GAPS=\$(wc -l < \"$d/logcat.gaps\" 2>/dev/null || echo 0)\n" +
            "echo EVENTS=\$(wc -l < \"$d/events.log\" 2>/dev/null || echo 0)\n"
    }

    fun parseCounters(out: String): Counters {
        val m = parseStatus(out)
        fun n(k: String) = m[k]?.trim()?.toLongOrNull() ?: 0L
        return Counters(n("LOGCAT_LINES"), n("LOGCAT_ERRORS"), n("LOGCAT_WARNINGS"), n("DMESG_LINES"), n("GAPS"), n("EVENTS"))
    }

    data class Page(val total: Int, val start: Int, val lines: List<String>)
    fun parsePage(out: String): Page? {
        val all = out.lines()
        val sep = all.indexOf("---")
        if (sep < 0) return null
        val head = parseStatus(all.take(sep).joinToString("\n"))
        val total = head["TOTAL"]?.toIntOrNull() ?: return null
        val start = head["START"]?.toIntOrNull() ?: return null
        return Page(total, start, all.drop(sep + 1).dropLastWhile { it.isEmpty() })
    }
}

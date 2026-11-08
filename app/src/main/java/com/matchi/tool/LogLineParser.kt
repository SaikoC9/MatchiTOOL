package com.matchi.tool

/**
 * Pure parser (no Android classes, unit tested) for the lines the boot capture writes, so the viewer can show the
 * original Android timestamp, PID, thread, priority and tag as columns instead of one block of text.
 *
 * Understood formats:
 *  - logcat threadtime:        "11-08 16:00:01.123  1234  5678 I Tag     : message"
 *  - logcat threadtime + year: "2026-11-08 16:00:01.123  1234  5678 I Tag     : message"
 *  - kernel (dmesg -w):        "[ 5284.512345] message"  (also "<6>[ 5284.5] message" and "[Sun Nov 8 ...] message")
 *  - logcat buffer markers:    "--------- beginning of crash"
 * Anything else (script markers, events.log lines) comes back as kind "text" with the whole line as the message.
 *
 * Note: Android's threadtime format does not say which log buffer (main/system/radio/events/crash) a line came from,
 * so no buffer is reported per line. Only the "--------- beginning of <buffer>" markers carry that information.
 */
object LogLineParser {
    data class Parsed(
        val kind: String,        // "logcat", "kernel", "marker" or "text"
        val time: String,        // "11-08 16:00:01.123", kernel uptime "5284.512345", or ""
        val pid: Int,            // -1 when unknown
        val tid: Int,            // -1 when unknown
        val level: String,       // ERROR / WARNING / INFO / DEBUG
        val tag: String,
        val message: String,
    )

    private val THREADTIME = Regex("""^((?:\d{4}-)?\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})\s+(\d+)\s+(\d+)\s+([VDIWEAF])\s+(.*?)\s*:(?: (.*))?$""")
    private val KERNEL = Regex("""^(?:<\d+>)?\[\s*([^\]]+?)\s*\]\s?(.*)$""")
    private val MARKER = Regex("""^-{5,}\s*beginning of (\w+)\s*$""")

    fun levelOf(priority: String): String = when (priority) {
        "E", "A", "F" -> "ERROR"
        "W" -> "WARNING"
        "D", "V" -> "DEBUG"
        else -> "INFO"
    }

    private val KERN_ERR = Regex("""(?i)\b(error|fail(ed|ure)?|panic|oops|fatal|segfault)\b""")
    private val KERN_WARN = Regex("""(?i)\b(warn(ing)?|timeout|timed out|retry)\b""")

    fun parse(raw: String): Parsed {
        val line = raw.trimEnd('\r', '\n')
        THREADTIME.matchEntire(line)?.let { m ->
            val g = m.groupValues
            return Parsed("logcat", g[1], g[2].toIntOrNull() ?: -1, g[3].toIntOrNull() ?: -1, levelOf(g[4]),
                g[5].ifBlank { "Android" }, g[6])
        }
        MARKER.matchEntire(line.trim())?.let { m ->
            return Parsed("marker", "", -1, -1, "INFO", "logcat", "beginning of " + m.groupValues[1])
        }
        KERNEL.matchEntire(line)?.let { m ->
            val msg = m.groupValues[2]
            val level = when {
                KERN_ERR.containsMatchIn(msg) -> "ERROR"
                KERN_WARN.containsMatchIn(msg) -> "WARNING"
                else -> "INFO"
            }
            return Parsed("kernel", m.groupValues[1], -1, -1, level, "kernel", msg)
        }
        return Parsed("text", "", -1, -1, "INFO", "", line)
    }

    /** Parse a page of lines. */
    fun parseAll(lines: List<String>): List<Parsed> = lines.map { parse(it) }

    /**
     * Display-only filter (never used at capture time): keeps lines whose level is at least [minLevel] and that
     * contain [text] (case-insensitive) in the tag or message. Blank arguments keep everything.
     */
    fun matches(p: Parsed, minLevel: String, text: String): Boolean {
        val order = listOf("DEBUG", "INFO", "WARNING", "ERROR")
        val min = order.indexOf(minLevel.uppercase()).coerceAtLeast(0)
        if (order.indexOf(p.level) < min) return false
        if (text.isBlank()) return true
        return p.tag.contains(text, ignoreCase = true) || p.message.contains(text, ignoreCase = true)
    }
}

package com.matchi.tool

/**
 * Pure parsing of `logcat -v threadtime` lines for the in-app capture loops (no Android classes, unit tested).
 * A null result means "drop this line" (the caller counts it as dropped): not a log line, empty message, or a line
 * that must not be captured (the app's own tag, System.out, or - for the device log - this app's own process).
 */
internal object CaptureLines {
    class Parsed(val pid: Int?, val level: String, val tag: String, val message: String)

    private val APP_LINE = Regex("\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}\\.\\d{3} +\\d+ +\\d+ ([VDIWEAF]) +(.+?) *:(?: |$)(.*)")
    private val DEVICE_LINE = Regex("""^\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}\s+(\d+)\s+\d+\s+([VDIWEAF])\s+(.+?)\s*:(?: |$)(.*)$""")

    /** Priority letter to the app's level names (app capture: F is shown as INFO, as before). */
    fun appLevel(priority: String): String = when (priority) { "E", "A" -> "ERROR"; "W" -> "WARNING"; "D", "V" -> "DEBUG"; else -> "INFO" }

    /** Priority letter to the level names for the device log (F counts as ERROR). */
    fun deviceLevel(priority: String): String = when (priority) { "E", "A", "F" -> "ERROR"; "W" -> "WARNING"; "D", "V" -> "DEBUG"; else -> "INFO" }

    /** One line of this app's own process log; [ownTag] (the log catcher's tag) is skipped so the log does not feed itself. */
    fun parseApp(line: String, ownTag: String): Parsed? {
        val m = APP_LINE.matchEntire(line.trim()) ?: return null
        val tag = m.groupValues[2].substringBefore(':').trim().ifBlank { "Android" }
        val message = m.groupValues[3]
        if (tag == ownTag || tag == "System.out" || message.isBlank()) return null
        return Parsed(null, appLevel(m.groupValues[1]), tag, message)
    }

    /** One line of the device-wide log; lines of [myPid] are skipped (the app is captured separately). The tag is made safe for the page. */
    fun parseDevice(line: String, myPid: String): Parsed? {
        val m = DEVICE_LINE.matchEntire(line.trim()) ?: return null
        if (m.groupValues[1] == myPid) return null
        val msg = m.groupValues[4]
        if (msg.isBlank()) return null
        val tag = m.groupValues[3].substringBefore(':').trim().ifBlank { "android" }.replace('.', '_').take(60)
        return Parsed(m.groupValues[1].toIntOrNull(), deviceLevel(m.groupValues[2]), tag, msg)
    }
}

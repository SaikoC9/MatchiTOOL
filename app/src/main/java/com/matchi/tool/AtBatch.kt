package com.matchi.tool

import java.security.SecureRandom

/**
 * Script building and result parsing for /api/at/batch. Every request uses its own random marker, so a modem reply
 * (USSD text, operator names, PDU data) that contains "##" or even prints something that looks like another command's
 * marker cannot cut a result short or forge a neighbour's result: the marker is unknown until the request is made.
 * Markers are only recognised at the start of a line. No Android classes, so this runs in JVM unit tests.
 */
object AtBatch {
    private val rng = SecureRandom()

    /** "##" + 128 random bits as hex: letters and digits only, safe inside single quotes. */
    fun newMarker(): String {
        val b = ByteArray(16); rng.nextBytes(b)
        return "##" + b.joinToString("") { "%02x".format(it) }
    }

    /**
     * Checks one AT command from UFI's GET /api/AT?command=&slot= route. Same rules as /api/at: starts with AT, at most
     * 300 characters, one line. Throws IllegalArgumentException (the server answers 400). Returns the trimmed command.
     */
    fun checkCommand(raw: String?): String {
        val cmd = (raw ?: "").trim()
        if (!cmd.startsWith("AT", ignoreCase = true) || cmd.length > 300 || cmd.any { it == '\n' || it == '\r' || it == '\u0000' })
            throw IllegalArgumentException("AT command must start with AT")
        return cmd
    }

    /**
     * The slot of the same route: missing means 0. Anything but "0" or "1" is refused, because a plugin that edits modem
     * settings must not be silently sent to the other SIM slot (the older /api/at route clamps instead).
     */
    fun checkSlot(raw: String?): Int = when (raw?.trim()) {
        null, "", "0" -> 0
        "1" -> 1
        else -> throw IllegalArgumentException("slot must be 0 or 1")
    }

    /**
     * The text UFI-TOOLS' own GET /api/AT puts in its reply (read from its atModule.kt): every CR and LF removed (lines are
     * joined with no separator), leading blanks trimmed, a closing "ok" in any case replaced by " OK" after trimming the text
     * before it, and a leading comma dropped. Plugins were written against this form, so it is copied as it is, quirks included.
     */
    fun ufiText(raw: String): String {
        var res = raw.replace("\n", "").replace("\r", "").trimStart()
        if (res.lowercase().endsWith("ok")) res = res.dropLast(2).trimEnd() + " OK"
        if (res.startsWith(",")) res = res.removePrefix(",").trimStart()
        return res
    }

    /** One `sendat` call per command, each preceded by a marker line, and a final END marker. [commands] are already validated. */
    fun script(sendat: String, slot: Int, commands: List<String>, marker: String): String {
        val sb = StringBuilder()
        for ((i, cmd) in commands.withIndex()) {
            val q = "'" + cmd.replace("'", "'\\''") + "'"
            // printf starts with a newline so the marker is on its own line even when the previous output had no trailing newline
            sb.append("printf '\\n%s\\n' '$marker:AT$i'; \"$sendat\" -n $slot -c $q 2>&1\n")
        }
        sb.append("printf '\\n%s\\n' '$marker:END'\n")
        return sb.toString()
    }

    /** The output of each of [count] commands, in order; "" for a command whose section is missing. */
    fun parse(out: String, marker: String, count: Int): List<String> {
        val results = Array(count) { "" }
        val buf = StringBuilder()
        var cur = -1
        fun flush() {
            if (cur in 0 until count) results[cur] = buf.toString().trim()
            buf.setLength(0)
        }
        val prefix = "$marker:"
        for (raw in out.split('\n')) {
            val line = raw.trimEnd('\r')
            if (line.startsWith(prefix)) {
                val tag = line.substring(prefix.length)
                if (tag == "END") { flush(); cur = -1; break }
                if (tag.startsWith("AT")) {
                    val idx = tag.substring(2).toIntOrNull()
                    if (idx != null && idx in 0 until count && tag == "AT$idx") { flush(); cur = idx; continue }
                }
            }
            if (cur >= 0) { if (buf.isNotEmpty()) buf.append('\n'); buf.append(line) }
        }
        flush()   // output cut short (timeout): keep what the last command had printed so far
        return results.toList()
    }
}

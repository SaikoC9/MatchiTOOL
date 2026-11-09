package com.matchi.tool

import java.util.TreeMap

/**
 * Pure model (no Android classes, unit tested) for the ready-for-update snapshot: one text file with the app version, how many
 * problems each plugin logged, how the plugin routes behaved and the last lines of the session. Run it before and after a plugin
 * update and compare the two files. The counts sections have a fixed layout and sorted names, so a plain text diff shows what changed.
 * The server passes the finished text through [Redactor] before it is saved.
 */
internal object LogSnapshot {
    const val TAIL_LINES = 200
    val LABELS = setOf("", "before", "after")

    /** [problems] = plugin name -> ERROR and WARNING lines from that plugin's scripts. [routes] = route tag -> counts. */
    data class Counts(val problems: Map<String, Int>, val routes: Map<String, Route>)
    data class Route(val lines: Int, val warnings: Int, val errors: Int)

    // A line is "time [LEVEL] [function] message"; plugin script errors carry the plugin name first in the message: "[NAME.js] JS error: ...".
    private val head = Regex("""\[(ERROR|WARNING|INFO|DEBUG)\] \[(plugin/[a-z]+)\] ?(?:\[([^\]]{1,80})\])?""")

    /** Adds lines one at a time, so a whole session (even several files) can be counted without holding it in memory. */
    class Counter {
        private val problems = TreeMap<String, Int>()
        private val routes = TreeMap<String, IntArray>()
        var examined = 0
            private set

        fun add(l: String) {
            if (l.isEmpty()) return
            examined++
            val m = head.find(l) ?: return
            val level = m.groupValues[1]; val tag = m.groupValues[2]
            if (tag == "plugin/js") {
                if (level == "ERROR" || level == "WARNING") {
                    val name = m.groupValues[3].ifEmpty { "(unnamed)" }
                    problems[name] = (problems[name] ?: 0) + 1
                }
            } else {
                val c = routes.getOrPut(tag) { IntArray(3) }
                c[0]++
                if (level == "WARNING") c[1]++
                if (level == "ERROR") c[2]++
            }
        }

        fun counts(): Counts = Counts(TreeMap(problems), routes.mapValuesTo(TreeMap<String, Route>()) { Route(it.value[0], it.value[1], it.value[2]) })
    }

    fun count(lines: List<String>): Counts = Counter().also { c -> lines.forEach { c.add(it) } }.counts()

    /** "matchitool_snapshot_before_20261109_101500.txt"; an unknown label is dropped. Always a safe plain file name. */
    fun fileName(label: String, stamp: String): String {
        val l = if (label in LABELS) label else ""
        return "matchitool_snapshot_" + (if (l.isEmpty()) "" else l + "_") + stamp.filter { it.isDigit() || it == '_' } + ".txt"
    }

    /** Counts and tail from the same list of lines (used for the recent buffer and in tests). */
    fun render(version: String, stamp: String, label: String, source: String, lines: List<String>): String =
        render(version, stamp, label, source, count(lines), lines.count { it.isNotEmpty() }, lines)

    /** [counts] cover [examined] lines; [tail] is the end of those lines (only the last [TAIL_LINES] are written). */
    fun render(version: String, stamp: String, label: String, source: String, counts: Counts, examined: Int, tail: List<String>): String {
        val c = counts
        val sb = StringBuilder()
        sb.append("MATCHITOOL SNAPSHOT\n")
        sb.append("App version: ").append(version.ifEmpty { "unknown" }).append('\n')
        sb.append("Label: ").append(if (label in LABELS && label.isNotEmpty()) label else "none").append('\n')
        sb.append("Taken: ").append(stamp).append('\n')
        sb.append("Source: ").append(source).append('\n')
        sb.append("Lines examined: ").append(examined).append("\n\n")
        sb.append("PLUGIN SCRIPT PROBLEMS (ERROR and WARNING lines per plugin)\n")
        if (c.problems.isEmpty()) sb.append("  none\n") else c.problems.forEach { (n, k) -> sb.append("  ").append(n).append(": ").append(k).append('\n') }
        sb.append("\nPLUGIN ROUTES (lines, warnings, errors)\n")
        if (c.routes.isEmpty()) sb.append("  none\n")
        else c.routes.forEach { (t, r) -> sb.append("  ").append(t).append(": ").append(r.lines).append(" lines, ").append(r.warnings).append(" warnings, ").append(r.errors).append(" errors\n") }
        val last = tail.takeLast(TAIL_LINES)
        sb.append("\nLAST ").append(last.size).append(" LINES\n")
        last.forEach { sb.append(it).append('\n') }
        return sb.toString()
    }
}

package com.matchi.tool

/**
 * Pure model (no Android classes, unit tested) for the Log basket: one row per log file of every kind.
 * The server builds rows from its folders and this object decides the id, the order and which actions a row allows.
 * A row id is "type:name"; [parseId] only accepts plain file names, so an id can never point outside its folder.
 */
internal object LogBasket {
    const val SESSION = "session"   // files/logs/sessions/*.log (the .txt companion goes with it)
    const val EXPORT = "export"     // files/logs/exports/*.txt
    const val AUDIT = "audit"       // files/shell_audit.log (deleting it needs a root sign-in; a new line records that it was cleared)
    const val BOOT = "boot"         // /data/local/matchitool/bootlogs/* (root only)

    /** Display order of the types in the list. */
    private val order = listOf(SESSION, EXPORT, AUDIT, BOOT)

    data class Row(
        val type: String, val name: String, val size: Long,
        val modified: Long,              // epoch ms, 0 when unknown
        val modifiedText: String = "",   // shown when [modified] is 0 (boot files report a text time)
        val active: Boolean = false,     // the session still being written
        val rootOnly: Boolean = false
    ) {
        val id: String get() = "$type:$name"
        /** Delete: finished sessions, exports, the audit log and rotated boot files. The server asks for a root sign-in for audit and boot rows. */
        val canDelete: Boolean get() = !active && when (type) {
            SESSION, EXPORT, AUDIT -> true
            BOOT -> bootDeletable(name)
            else -> false
        }
        val canView: Boolean get() = true
        val canCopy: Boolean get() = true
    }

    private val rotatedBoot = Regex("^(logcat|dmesg)\\.log\\.\\d{1,2}$")

    /** Only rotated capture files (logcat.log.1, dmesg.log.2 ...) may be deleted: the live logcat.log and dmesg.log are still being written, and the script's own info files are kept. */
    fun bootDeletable(name: String): Boolean = rotatedBoot.matches(name)

    /** A file name with no path part: letters, digits, dot, dash, underscore; no leading dot; at most 120 characters. */
    fun isSafeName(name: String): Boolean =
        name.isNotEmpty() && name.length <= 120 && !name.startsWith(".") && !name.contains("..") &&
            name.all { it.isLetterOrDigit() && it.code < 128 || it == '.' || it == '-' || it == '_' }

    /** "type:name" back to its two parts, or null when the type is unknown or the name is not a plain file name. */
    fun parseId(id: String): Pair<String, String>? {
        val i = id.indexOf(':')
        if (i <= 0) return null
        val type = id.substring(0, i); val name = id.substring(i + 1)
        return if (type in order && isSafeName(name)) type to name else null
    }

    /** Types first in display order, then newest first (unknown time last), then by name. Rows with an unsafe name are dropped. */
    fun arrange(rows: List<Row>): List<Row> =
        rows.filter { isSafeName(it.name) }
            .sortedWith(compareBy<Row>({ order.indexOf(it.type) }, { -it.modified }, { it.name }))

    /** Why boot files are not in the list, for the page to show: "" when they are included. */
    fun bootNote(installed: Boolean, rootOk: Boolean): String = when {
        !installed -> "Boot capture is not installed"
        !rootOk -> "Sign in for root to list boot files"
        else -> ""
    }

    /** Default and largest number of lines the basket's View and Copy ask for. */
    const val TAIL_DEFAULT = 500
    const val TAIL_MAX = 5000

    fun clampTail(n: Int): Int = n.coerceIn(1, TAIL_MAX)

    /** The last [n] lines of [text] (n clamped to 1..TAIL_MAX); a trailing newline does not count as a line. */
    fun tailLines(text: String, n: Int): List<String> {
        val lines = text.split('\n').let { if (it.isNotEmpty() && it.last().isEmpty()) it.dropLast(1) else it }
        return lines.takeLast(clampTail(n)).map { it.trimEnd('\r') }
    }
}

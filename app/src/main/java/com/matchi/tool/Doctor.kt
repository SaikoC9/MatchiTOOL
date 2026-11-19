package com.matchi.tool

/**
 * The call from Full diagnose to the bundled `matchi-doctor` (tools/doctor): the command line and the text lines. Plain Kotlin, no
 * Android classes, so it is unit tested. Reading the JSON is in [DoctorReport]; starting the program as root is in WebRoutesDevice.
 *
 * The program only reads; it is started only by its full path inside the app's files folder, after [BinaryCheck.problem] said the
 * file is the one the app was built with. A missing, refused or failing doctor only means the section says why it did not run.
 */
object Doctor {
    /** Name in assets/bin, in the files folder and in [BinaryHashes]. */
    const val BINARY = "matchi-doctor"

    /** The TLS check needs a public host that always answers; the report says warn (not a CA fault) when there is no uplink. */
    const val TLS_TARGET = "example.com:443"

    private val SHA = Regex("^[0-9a-f]{64}$")
    private val NAME = Regex("^[A-Za-z0-9_.-]{1,40}$")

    /** One check of the report, as the page would show it. */
    data class Check(val id: String, val title: String, val status: String, val detail: String, val hint: String)

    /**
     * The text handed to `su -c`: fixed flags, the paths in single quotes, one `-hash name=sha256` for every bundled file, stdin from
     * /dev/null. Null when [dir] is not a plain absolute path or a name or hash is not what the build writes.
     */
    fun command(dir: String, hashes: Map<String, String>): String? {
        if (!LiveEngine.pathIsSafe(dir)) return null
        val sb = StringBuilder("exec '$dir/$BINARY' -files '$dir' -tls $TLS_TARGET")
        for ((name, sha) in hashes.toSortedMap()) {
            if (!NAME.matches(name) || !SHA.matches(sha)) return null
            sb.append(" -hash $name=$sha")
        }
        return sb.append(" </dev/null").toString()
    }

    /** The JSON object in [output], from the first `{` to the last `}` (a root manager may print a line before it), or null. */
    fun jsonIn(output: String): String? {
        val a = output.indexOf('{')
        val b = output.lastIndexOf('}')
        return if (a in 0 until b) output.substring(a, b + 1) else null
    }

    /** One line per check, like the lines of the page's own checks: `[ok] Root - running as uid 0`, with the hint after a dash. */
    fun lines(checks: List<Check>): String = checks.joinToString("\n") { c ->
        "[${c.status}] ${c.title} - ${c.detail}" + if (c.hint.isNotBlank() && c.status != "ok") "  (${c.hint})" else ""
    }

    /** The first line of the section: the counts, in the order the program writes them. */
    fun summaryLine(ok: Int, warn: Int, fail: Int, skip: Int): String = "summary: $ok ok, $warn warn, $fail fail, $skip skip"

    /** What the section says when the program was not run or gave no report. */
    fun notRun(why: String): String = "matchi-doctor did not run: $why"
}

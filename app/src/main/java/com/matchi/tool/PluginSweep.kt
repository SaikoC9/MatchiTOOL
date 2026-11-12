package com.matchi.tool

/*
 * Plugin process sweep (Phase 2 of MatchiTOOL_Phase2_todo.txt). Plain Kotlin with NO android, org.json or NanoHTTPD imports, so
 * scripts/kotlin_pure_tests.sh compiles it and its unit tests run without the Android SDK. WebRoutesPlugins.kt and WebRoutesRoot.kt
 * only call into this file; every rule that can be tested without a device (the tag prefix, the probe script and its parser, the
 * candidate rules, the never-kill list, the shared-path guard, the cap, the kill plan and the report text) is meant to live here.
 *
 * Step 0 (this commit) only creates the file: the fixed numbers from the owner's decisions and the two data types the later steps
 * share. Steps 1-5 of the to-do add their functions below. This file must not import anything from the project except through plain
 * parameters, like PluginUninstall.kt does (shellDanger is passed in; this file needs no other file).
 *
 * The sweep is best effort. It protects the person from a forgetful plugin, not from a hostile one (the plugin names itself, P1).
 */

/** Step 1: the name of the environment variable the host adds to a plugin's own commands ("export MATCHI_PLUGIN='NAME'; "). */
internal const val SWEEP_TAG_VAR = "MATCHI_PLUGIN"

/** Step 2: the probe prints at most this many characters of a process's command line (ARGS). */
internal const val SWEEP_ARGS_MAX = 200

/** Step 3 (D1): how a candidate was found. "cmdline" is the weakest and is only ever killed when it was shown in the dialog. */
internal const val SWEEP_HOW_TAG = "tag"
internal const val SWEEP_HOW_PIDFILE = "pidfile"
internal const val SWEEP_HOW_CMDLINE = "cmdline"

/** Step 3: a command-line match needs a FILE path with at least this many segments (/data/local/x/beat.sh = 4). */
internal const val SWEEP_CMDLINE_MIN_SEGMENTS = 3

/** Step 3: a command-line match never counts for a path under these folders (system files are not a plugin's own files). */
internal val SWEEP_SYSTEM_PREFIXES: List<String> = listOf("/system", "/vendor", "/apex", "/proc", "/dev")

/** Step 3: more candidates than this -> the sweep refuses to stop automatically and says so. */
internal const val SWEEP_MAX_CANDIDATES = 50

/** Step 4: the read-only probe may take this long. It is NOT part of the 60 s stop clock (STOP_TOTAL_MS in PluginUninstall.kt). */
internal const val SWEEP_PROBE_TIMEOUT_MS = 15_000L

/** Step 5 (D4): after SIGSTOP and SIGTERM the sweep waits this long, then sends SIGKILL. All of it stays inside STOP_TOTAL_MS. */
internal const val SWEEP_TERM_WAIT_MS = 2_000L

/** D8: the never-kill list is fixed in code. This is the app's own package name; the app process and its root session pool are never touched. */
internal const val SWEEP_APP_PACKAGE = "com.matchi.tool"

/** D8: PID 1 is never touched (kernel threads and the sweep's own PID chain are excluded by the Step 3 rules). */
internal const val SWEEP_INIT_PID = 1

/**
 * Step 2: one running process as the probe saw it. [start] is the process start time exactly as the probe printed it; together with
 * [pid] and [args] it identifies the process, so a reused PID is not mistaken for the old one (D3). [tagged] is the plugin name found
 * in the MATCHI_PLUGIN variable of /proc/PID/environ, or null when there is none or it could not be read.
 */
internal class SweepProc(
    val pid: Int,
    val ppid: Int,
    val start: String,
    val uid: Int,
    val args: String,
    val tagged: String?,
)

/**
 * Step 3: a process the sweep would end for one plugin. [how] is one of SWEEP_HOW_TAG, SWEEP_HOW_PIDFILE, SWEEP_HOW_CMDLINE.
 * The dialog shows these (Step 4) and only these may be killed (D3).
 */
internal class SweepCandidate(
    val pid: Int,
    val start: String,
    val how: String,
    val args: String,
)

/**
 * Step 1 (the tag): the text the host puts in front of a command that is attributed to a plugin, so every process that command
 * starts inherits MATCHI_PLUGIN=NAME in its environment (the probe in Step 2 reads it from /proc/PID/environ). Only a name that
 * passes tracePluginName (letters, digits, dot, dash, underscore, ending in .js or .html) gets a tag; those characters cannot end
 * the single quotes, and a second check below refuses anything else. A bad, empty or missing name gives "" (no tag, no error).
 * The tag is added AFTER shellDanger, traceCommand and the sandbox exact match, which keep seeing the original text, and never
 * on the Phase 1 stop commands (they must not tag themselves).
 */
internal fun tagPrefix(plugin: String?): String {
    val name = tracePluginName(plugin) ?: return ""
    if (name.any { it == '\'' || it == '\\' || it == '\n' || it == '\r' || it == '\u0000' }) return ""
    return "export $SWEEP_TAG_VAR='$name'; "
}

/** Step 1: [command] with the tag in front for [plugin]; the command itself is not changed, so it is returned as is when there is no valid name. */
internal fun tagCommand(plugin: String?, command: String): String = tagPrefix(plugin) + command

/** Step 2: every probe line starts with this word; the last line is "MTSWEEP-END <count>", the first "MTSWEEP-SELF <pid>". */
internal const val SWEEP_LINE_PREFIX = "MTSWEEP"

/**
 * Step 2: what the probe saw. [procs] are the lines that parsed; [selfPid] is the PID of the probe's own shell (Step 3 walks the PPID
 * chain from it, P5); [skipped] counts probe lines that were cut or malformed; [complete] is true only when the closing END line
 * arrived AND its count equals procs + skipped, so an output cut short by a timeout or a size limit is never trusted as "nothing else runs".
 */
internal class SweepProbe(
    val procs: List<SweepProc>,
    val selfPid: Int?,
    val complete: Boolean,
    val skipped: Int,
)

/**
 * Step 2: the READ-ONLY probe script. It lists /proc and prints one line per process:
 *   MTSWEEP|PID|PPID|START|UID|TAG|ARGS
 * START is field 22 of /proc/PID/stat (start time in clock ticks since boot): one token, and with PID it tells a reused PID from the
 * old process (D3). TAG is the value of MATCHI_PLUGIN in /proc/PID/environ ("" when there is none or it cannot be read). ARGS is the
 * command line with NUL, newline and tab turned into spaces, cut at [SWEEP_ARGS_MAX] characters, so a line is always one line.
 * ARGS is last, so a "|" inside it cannot shift a column. Kernel threads have an empty ARGS and their environ is not read.
 * It writes nothing and kills nothing: the only redirects are inputs and 2>/dev/null. Needs root to read other users' environ.
 * [UNVERIFIED] on the F50: tr's NUL escape, "stat -c %u", "grep -m1", and the cost of the loop (a few hundred processes).
 */
internal fun sweepProbeScript(): String = listOf(
    "echo \"$SWEEP_LINE_PREFIX-SELF \$\$\"",
    "n=0",
    "for d in /proc/[0-9]*; do",
    "  p=\${d#/proc/}",
    "  s=\$(cat \$d/stat 2>/dev/null) || continue",
    "  case \"\$s\" in *') '*) ;; *) continue ;; esac",
    "  s=\${s##*) }",
    "  set -- \$s",
    "  pp=\$2; st=\${20}",
    "  u=\$(stat -c %u \$d 2>/dev/null) || u=",
    "  a=\$(tr '\\000\\n\\t' '   ' <\$d/cmdline 2>/dev/null | cut -c1-$SWEEP_ARGS_MAX)",
    "  t=",
    "  if [ -n \"\$a\" ]; then t=\$(tr '\\000' '\\n' <\$d/environ 2>/dev/null | grep -m1 '^$SWEEP_TAG_VAR=') || t=; t=\${t#$SWEEP_TAG_VAR=}; fi",
    "  echo \"$SWEEP_LINE_PREFIX|\$p|\$pp|\$st|\$u|\$t|\$a\"",
    "  n=\$((n+1))",
    "done",
    "echo \"$SWEEP_LINE_PREFIX-END \$n\""
).joinToString("\n")

/**
 * Step 2: pure parser for the probe's output. Lines that are not ours (shell noise, su banners) are ignored. A line of ours that is cut or has a
 * non-numeric PID, PPID or START is skipped and counted. An unreadable UID becomes -1. A TAG that is not a valid plugin name becomes null
 * (a process can put anything in its own environment). Never throws.
 */
internal fun parseSweepProbe(output: String): SweepProbe {
    val procs = ArrayList<SweepProc>()
    var self: Int? = null
    var skipped = 0
    var endCount: Int? = null
    for (raw in output.split('\n')) {
        val line = raw.trimEnd('\r')
        when {
            line.startsWith("$SWEEP_LINE_PREFIX|") -> {
                val f = line.split('|', limit = 7)
                val pid = f.getOrNull(1)?.toIntOrNull()
                val ppid = f.getOrNull(2)?.toIntOrNull()
                val start = f.getOrNull(3)
                if (f.size < 7 || pid == null || ppid == null || start.isNullOrEmpty() || !start.all { it.isDigit() }) { skipped++; continue }
                val tag = tracePluginName(f[5].takeIf { it.isNotEmpty() })
                procs.add(SweepProc(pid, ppid, start, f[4].toIntOrNull() ?: -1, f[6].trim(), tag))
            }
            line.startsWith("$SWEEP_LINE_PREFIX-SELF ") -> self = line.substringAfter(' ').trim().toIntOrNull()
            line.startsWith("$SWEEP_LINE_PREFIX-END ") -> endCount = line.substringAfter(' ').trim().toIntOrNull()
        }
    }
    return SweepProbe(procs, self, endCount != null && endCount == procs.size + skipped, skipped)
}


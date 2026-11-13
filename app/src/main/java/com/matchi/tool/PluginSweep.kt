package com.matchi.tool

/*
 * Plugin process sweep (Phase 2 of MatchiTOOL_Phase2_todo.txt). Plain Kotlin with NO Android, JSON-library or web-server-library imports, so
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
 * Step 4: [pidfiles] (paths from sweepPidfilePaths) are read too, before the END line, one line each: MTSWEEP-PID|PATH|DIGITS. Only a REGULAR file that
 * is not a symlink is read (a FIFO would block the probe), only its first line, only digits, at most 9. parseSweepProbe ignores these lines.
 * [UNVERIFIED] on the F50: tr's NUL escape, "stat -c %u", "grep -m1", and the cost of the loop (a few hundred processes).
 */
internal fun sweepProbeScript(pidfiles: List<String> = emptyList()): String = (listOf(
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
) + sweepPidfileLines(pidfiles) + "echo \"$SWEEP_LINE_PREFIX-END \$n\"").joinToString("\n")

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


// ---- Step 3: candidate rules ----

/**
 * Step 3: what the rules found for ONE plugin. [candidates] are the processes that may be ended, strongest way first, then by PID (at most
 * SWEEP_MAX_CANDIDATES are listed). [notStopped] are processes that matched but are left alone on purpose (the shared guard, P8), each
 * as one line for the dialog. [found] is the number of candidates before the cap; [overCap] is true when it was above SWEEP_MAX_CANDIDATES:
 * then the sweep must NOT stop anything automatically (Step 5 checks this). [complete] is the probe's flag: when false, "nothing found" must
 * never be read as "nothing runs". [notes] are short lines for the dialog.
 */
internal class SweepResult(
    val candidates: List<SweepCandidate>,
    val notStopped: List<String>,
    val found: Int,
    val overCap: Boolean,
    val complete: Boolean,
    val notes: List<String>,
)

private const val SWEEP_MAX_DEPTH = 64
private val SWEEP_WS = Regex("\\s+")
private val SWEEP_SHELLS = setOf("sh", "ash", "bash", "mksh", "dash")

private fun isSweepPathChar(c: Char) = c.isLetterOrDigit() || c == '.' || c == '_' || c == '-' || c == '/'

/**
 * Step 3: true when [path] appears in [args] as a whole path, not as a piece of a longer one ("/x/beat.sh" is not in "/x/beat.sh.bak" or
 * "/y/x/beat.sh"). The characters before and after must not be path characters; "=", ":", quotes, spaces and ";" are fine.
 */
internal fun argsMentionsPath(args: String, path: String): Boolean {
    val p = path.trimEnd('/')
    if (p.isEmpty()) return false
    var i = args.indexOf(p)
    while (i >= 0) {
        val before = if (i == 0) ' ' else args[i - 1]
        val end = i + p.length
        val after = if (end >= args.length) ' ' else args[end]
        if (!isSweepPathChar(before) && !isSweepPathChar(after)) return true
        i = args.indexOf(p, i + 1)
    }
    return false
}

private fun sweepSegments(p: String) = p.split('/').count { it.isNotEmpty() }

/** True for a path at or under /system /vendor /apex /proc /dev (SWEEP_SYSTEM_PREFIXES). */
internal fun isSweepSystemPath(p: String): Boolean = SWEEP_SYSTEM_PREFIXES.any { p == it || p.startsWith("$it/") }

/** Step 3: a path with ".." or "." segments, or no leading "/", is never trusted. */
private fun isPlainAbsolute(p: String): Boolean =
    p.startsWith("/") && p.split('/').drop(1).none { it == "." || it == ".." }

/**
 * Step 3 (D1, cmdline): the ledger paths of this plugin that may be matched against a command line. The ledger holds write targets, folders
 * included (mkdir), so a path counts only when it looks like a FILE: its last segment has an extension (a dot that is not the first or last
 * character) and no other ledger path lies inside it. It needs [SWEEP_CMDLINE_MIN_SEGMENTS] segments, must not be under a system folder,
 * and must not be used by another installed plugin ([others], pluginsUsingPath). A renamed binary without an extension is missed on purpose.
 */
internal fun sweepCmdlinePaths(ledgerPaths: List<String>, others: Map<String, List<String>>): List<String> {
    val all = ledgerPaths.map { it.trim().trimEnd('/') }.filter { it.isNotEmpty() }.distinct()
    return all.filter { p ->
        val last = p.substringAfterLast('/')
        val dot = last.lastIndexOf('.')
        isPlainAbsolute(p) &&
            sweepSegments(p) >= SWEEP_CMDLINE_MIN_SEGMENTS &&
            !isSweepSystemPath(p) &&
            dot > 0 && dot < last.length - 1 &&
            all.none { it != p && it.startsWith("$p/") } &&
            pluginsUsingPath(p, others).isEmpty()
    }
}

/** Step 3 (pidfile): the ledger paths that may be read as a pidfile: absolute, plain, ending in ".pid", not under a system folder. */
internal fun sweepPidfilePaths(ledgerPaths: List<String>): List<String> =
    ledgerPaths.map { it.trim().trimEnd('/') }
        .filter { it.length > 4 && isPlainAbsolute(it) && it.endsWith(".pid") && !isSweepSystemPath(it) }
        .distinct()

/** Step 3: "bare" = a shell with no script or -c text (an interactive session shell), or any "su". It is the shape of a root session. */
internal fun isSweepSessionShell(args: String): Boolean {
    val t = args.trim().split(SWEEP_WS).filter { it.isNotEmpty() }
    if (t.isEmpty()) return false
    val base = t[0].substringAfterLast('/')
    if (base == "su") return true
    return base in SWEEP_SHELLS && t.drop(1).all { it.startsWith("-") && it != "-c" }
}

/** Step 3: the app's own process is named by its first word only ("com.matchi.tool", or "com.matchi.tool:service"). A later word proves nothing. */
internal fun isSweepAppProcess(args: String): Boolean {
    val first = args.trim().split(SWEEP_WS).firstOrNull() ?: return false
    return first == SWEEP_APP_PACKAGE || first.startsWith("$SWEEP_APP_PACKAGE:")
}

/**
 * Step 3 (P5, D8): every process the sweep must never touch, as PID -> reason. It does not matter how the process matched or what its tag says.
 *  - the sweep's own shell ([selfPid]), every PARENT of it (the su session, the shell, the app) and every CHILD it started;
 *  - PID 1 and any PID <= 0;
 *  - kernel threads (empty command line, PID 2, or a child of PID 2);
 *  - the MatchiTOOL app process, and the root session shells below it (a bare shell or su). A plugin's own job below the app is NOT protected.
 */
internal fun sweepNeverKill(procs: List<SweepProc>, selfPid: Int): Map<Int, String> {
    val byPid = HashMap<Int, SweepProc>()
    for (p in procs) byPid[p.pid] = p
    fun parents(pid: Int): List<Int> {
        val seen = LinkedHashSet<Int>()
        var cur = byPid[pid]?.ppid
        while (cur != null && cur > 0 && seen.size < SWEEP_MAX_DEPTH && seen.add(cur)) cur = byPid[cur]?.ppid
        return seen.toList()
    }
    val out = LinkedHashMap<Int, String>()
    out[selfPid] = "the sweep itself"
    for (a in parents(selfPid)) out.putIfAbsent(a, "the sweep runs below it")
    val appPids = procs.filter { isSweepAppProcess(it.args) }.map { it.pid }.toSet()
    for (p in procs) {
        val up = parents(p.pid)
        when {
            p.pid <= 0 -> out.putIfAbsent(p.pid, "not a real process")
            p.pid == SWEEP_INIT_PID -> out.putIfAbsent(p.pid, "init (PID 1)")
            p.pid == 2 || p.ppid == 2 || p.args.isBlank() -> out.putIfAbsent(p.pid, "kernel thread or no command line")
            p.pid in appPids -> out.putIfAbsent(p.pid, "the MatchiTOOL app")
            selfPid in up -> out.putIfAbsent(p.pid, "started by the sweep itself")
            isSweepSessionShell(p.args) && up.any { it in appPids } -> out.putIfAbsent(p.pid, "a root session of the app")
        }
    }
    return out
}

private val SWEEP_HOW_RANK = mapOf(SWEEP_HOW_TAG to 0, SWEEP_HOW_PIDFILE to 1, SWEEP_HOW_CMDLINE to 2)

/**
 * Step 3: the candidate rules for plugin [plugin]. Pure; it reads nothing and kills nothing.
 *  - [probe] is parseSweepProbe(...) of the read-only probe. Without the sweep's own PID the sweep cannot tell itself from a plugin's
 *    process (P5), so it lists nothing and says so.
 *  - [ledgerPaths] are the plugin's ledger "P" paths. [pidfilePids] is "pidfile path -> the PID it holds", read by the caller (Step 4);
 *    only paths that sweepPidfilePaths accepts are used.
 *  - [others] maps every OTHER installed plugin to the paths it uses (ledger, "@matchi-data", commandPaths): the shared guard (P8).
 * Ways, strongest first (a process gets only the strongest):
 *  tag      the process carries this plugin's MATCHI_PLUGIN marker.
 *  pidfile  a pidfile holds its PID AND it still fits the plugin (PID reuse!): the command line names one of the plugin's file paths.
 *  cmdline  the command line names one of the plugin's file paths (sweepCmdlinePaths).
 * A process tagged with ANOTHER plugin is never claimed by pidfile or cmdline: it belongs to that plugin.
 * After the rules: never-kill list (sweepNeverKill), then the shared guard for every way (a command line that names a path another
 * installed plugin uses is left alone and listed in [SweepResult.notStopped]), then the cap.
 */
internal fun classifySweep(
    plugin: String,
    probe: SweepProbe,
    ledgerPaths: List<String>,
    pidfilePids: Map<String, Int>,
    others: Map<String, List<String>>,
): SweepResult {
    val selfPid = probe.selfPid
    if (selfPid == null) {
        return SweepResult(emptyList(), emptyList(), 0, false, false,
            listOf("could not tell which process is the sweep itself, so no process list was made"))
    }
    val never = sweepNeverKill(probe.procs, selfPid)
    val filePaths = sweepCmdlinePaths(ledgerPaths, others)
    val pidfiles = sweepPidfilePaths(ledgerPaths).toSet()
    val pidfilePidSet = pidfilePids.filter { (path, pid) -> path.trimEnd('/') in pidfiles && pid > SWEEP_INIT_PID }.values.toSet()

    val found = ArrayList<SweepCandidate>()
    val notStopped = ArrayList<String>()
    for (p in probe.procs.sortedBy { it.pid }) {
        if (p.pid in never) continue
        val mentions = filePaths.any { argsMentionsPath(p.args, it) }
        val how = when {
            p.tagged == plugin -> SWEEP_HOW_TAG
            p.tagged != null -> null
            p.pid in pidfilePidSet && mentions -> SWEEP_HOW_PIDFILE
            mentions -> SWEEP_HOW_CMDLINE
            else -> null
        } ?: continue
        val used = commandPaths(listOf(p.args), null)
            .flatMap { pluginsUsingPath(it, others) }.distinct().sorted()
        if (used.isNotEmpty()) {
            notStopped.add("PID ${p.pid} ${p.args}: also used by ${used.joinToString(", ")}")
            continue
        }
        found.add(SweepCandidate(p.pid, p.start, how, p.args))
    }
    found.sortWith(compareBy({ SWEEP_HOW_RANK[it.how] ?: 9 }, { it.pid }))
    val over = found.size > SWEEP_MAX_CANDIDATES
    val notes = ArrayList<String>()
    if (!probe.complete) notes.add("the process list was cut short, so the sweep may have missed some processes")
    if (over) notes.add("${found.size} processes found; more than $SWEEP_MAX_CANDIDATES, so they are not stopped automatically")
    return SweepResult(found.take(SWEEP_MAX_CANDIDATES), notStopped, found.size, over, probe.complete, notes)
}

// ---- Step 4: the data for the delete dialog ----

private val SWEEP_PIDFILE_SAFE = Regex("^/[A-Za-z0-9._/-]{1,199}$")

/** Step 4: the shell lines that read each pidfile (read-only). Only plain, quote-safe paths are put in; the rest are dropped. */
internal fun sweepPidfileLines(paths: List<String>): List<String> {
    val safe = sweepPidfilePaths(paths).filter { SWEEP_PIDFILE_SAFE.matches(it) }.take(SWEEP_MAX_CANDIDATES)
    if (safe.isEmpty()) return emptyList()
    return listOf(
        "for f in " + safe.joinToString(" ") { "'$it'" } + "; do",
        "  v=",
        "  if [ -f \"\$f\" ] && [ ! -L \"\$f\" ]; then v=\$(head -n 1 \"\$f\" 2>/dev/null | tr -cd '0-9' | cut -c1-9); fi",
        "  echo \"$SWEEP_LINE_PREFIX-PID|\$f|\$v\"",
        "done",
    )
}

/** Step 4: "pidfile path -> PID" from the probe output. Only paths in [asked] count; an empty, non-numeric or zero value is dropped. Never throws. */
internal fun parseSweepPidfiles(output: String, asked: List<String>): Map<String, Int> {
    val ok = asked.toSet()
    val out = LinkedHashMap<String, Int>()
    for (raw in output.split('\n')) {
        val line = raw.trimEnd('\r')
        if (!line.startsWith("$SWEEP_LINE_PREFIX-PID|")) continue
        val f = line.split('|', limit = 3)
        val path = f.getOrNull(1) ?: continue
        val pid = f.getOrNull(2)?.trim()?.toIntOrNull() ?: continue
        if (path in ok && pid > 0) out[path] = pid
    }
    return out
}

/**
 * Step 4 (D3): sha256 over the shown candidates (PID, start time, way, command line), one labelled line each, in the order they are shown.
 * "" when nothing would be stopped. Step 5 computes it again and refuses ("plan-changed") when it differs from what the person saw.
 */
internal fun sweepHash(candidates: List<SweepCandidate>): String {
    if (candidates.isEmpty()) return ""
    val sb = StringBuilder()
    for (c in candidates) sb.append("proc:").append(c.pid).append('|').append(c.start).append('|').append(c.how).append('|').append(c.args).append('\n')
    return sha256Hex(sb.toString().toByteArray(Charsets.UTF_8))
}

/**
 * Step 4: what the dialog gets. [checked] is false when the probe could not run (no root, timeout, failure): then there is NO list, not a guessed
 * one, and [result] only carries the reason in its notes. [hash] is sweepHash of the shown candidates, "" when unchecked, empty or over the cap
 * (an over-cap list is never stopped automatically).
 */
internal class SweepView(val checked: Boolean, val result: SweepResult, val hash: String)

private fun uncheckedSweep(why: String) = SweepView(false, SweepResult(emptyList(), emptyList(), 0, false, false, listOf(why)), "")

/**
 * Step 4: turns the probe's run into [SweepView]. Pure: the caller runs the probe ([run], null when it did not run) and passes [rootGranted],
 * the plugin's ledger paths (already mapped with UfiPathMap, because the process command lines hold the mapped text) and [others] (the shared guard).
 */
internal fun buildSweepView(plugin: String, rootGranted: Boolean, run: ShellResult?, ledgerPaths: List<String>, others: Map<String, List<String>>): SweepView {
    if (!rootGranted || run == null) return uncheckedSweep("cannot be checked: root is not available")
    if (!run.success) return uncheckedSweep(
        if (run.content.contains("[timeout after")) "cannot be checked: the process check did not finish in time" else "cannot be checked: the process check failed")
    val probe = parseSweepProbe(run.content)
    val pidfiles = parseSweepPidfiles(run.content, sweepPidfilePaths(ledgerPaths))
    val r = classifySweep(plugin, probe, ledgerPaths, pidfiles, others)
    return SweepView(true, r, if (r.overCap) "" else sweepHash(r.candidates))
}

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
 * Step 2: the READ-ONLY probe script. It lists the processes that have a command line and prints one line per process:
 *   MTSWEEP|PID|PPID|START|UID|TAG|ARGS
 * START is field 22 of /proc/PID/stat (start time in clock ticks since boot): one token, and with PID it tells a reused PID from the
 * old process (D3). TAG is the value of MATCHI_PLUGIN in /proc/PID/environ ("" when there is none or it cannot be read). ARGS is the
 * command line with NUL and tab turned into spaces, the lines of a multi-line command joined with one space; the script keeps about
 * SWEEP_ARGS_MAX + 60 characters per line and parseSweepProbe cuts ARGS at [SWEEP_ARGS_MAX], so a line is always one line.
 * ARGS is last, so a "|" inside it cannot shift a column. Kernel threads have no command line and are NOT listed (they are never candidates).
 * SPEED (device test, F50, 496 processes): the first version started about 8 programs per process and took 19 s, over the 15 s limit.
 * This version reads everything with TWO bulk commands (one grep over every cmdline, one grep over every environ)
 * and then walks the result with shell built-ins only, so it starts no program per process. The UID column is always EMPTY (parsed as -1): nothing
 * uses it. SPEED (device test, F50, 150 processes with a command line, 490 in /proc): a lookup of each PID in one 15 KB "stat -c %n %u" string
 * (a prefix pattern on that string, once per process) made the loop take 27-29 s, over the 15 s limit; without it the loop takes 0.2 s.
 * Never search a big string once per process in this loop. The first-line match of environ needs a name
 * boundary in front of MATCHI_PLUGIN= so a longer variable name does not count.
 * It writes nothing and kills nothing: the only redirects are inputs and 2>/dev/null. Needs root to read other users' environ.
 * Step 4: [pidfiles] (paths from sweepPidfilePaths) are read too, before the END line, one line each: MTSWEEP-PID|PATH|DIGITS. Only a REGULAR file that
 * is not a symlink is read (a FIFO would block the probe), only its first line, only digits, at most 9. parseSweepProbe ignores these lines.
 * [UNVERIFIED] on the F50: the whole script as one after this change (before it: bulk part 0.06 s, loop 28 s; the variant without the UID lookup ran in 0.5 s).
 */
internal fun sweepProbeScript(pidfiles: List<String> = emptyList()): String = (listOf(
    "echo \"$SWEEP_LINE_PREFIX-SELF \$\$\"",
    "n=0",
    "cp=",
    "C=\$(grep -a -H '' /proc/[0-9]*/cmdline 2>/dev/null | tr '\\000\\t' '  ' | cut -c1-${SWEEP_ARGS_MAX + 60})",
    "E=\$(grep -a -o -H -E '(^|[^A-Za-z0-9_])$SWEEP_TAG_VAR=[A-Za-z0-9._-]+' /proc/[0-9]*/environ 2>/dev/null | tr '\\000' ' ')",
    "flush() {",
    "  [ -n \"\$cp\" ] || return 0",
    "  echo \"$SWEEP_LINE_PREFIX|\$cp|\$cpp|\$cst|\$cu|\$ct|\$ca\"",
    "  n=\$((n+1))",
    "  cp=",
    "}",
    "while IFS= read -r l; do",
    "  case \"\$l\" in /proc/[0-9]*/cmdline:*) ;; *) continue ;; esac",
    "  p=\${l#/proc/}; p=\${p%%/*}",
    "  a=\${l#*/cmdline:}",
    "  if [ \"\$p\" = \"\$cp\" ]; then",
    "    [ \${#ca} -lt 300 ] && ca=\"\$ca \$a\"",
    "    continue",
    "  fi",
    "  flush",
    "  { read -r s < /proc/\$p/stat; } 2>/dev/null || continue",
    "  case \"\$s\" in *') '*) ;; *) continue ;; esac",
    "  s=\${s##*) }",
    "  set -- \$s",
    "  t=",
    "  case \"\$E\" in *\"/proc/\$p/environ:\"*) y=\${E#*\"/proc/\$p/environ:\"}; y=\${y#*$SWEEP_TAG_VAR=}; t=\${y%%[!A-Za-z0-9._-]*} ;; esac",
    "  cp=\$p; cpp=\$2; cst=\${20}; cu=; ct=\$t; ca=\$a",
    "done <<${SWEEP_LINE_PREFIX}_EOF",
    "\$C",
    "${SWEEP_LINE_PREFIX}_EOF",
    "flush",
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
                procs.add(SweepProc(pid, ppid, start, f[4].toIntOrNull() ?: -1, f[6].trim().take(SWEEP_ARGS_MAX), tag))
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

/** F1: a process this plugin claims (how it was found) and the names of the other plugins that also use its files (empty = not guarded). */
private class SweepClaim(val proc: SweepProc, val how: String, val used: List<String>)

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
 * F1 (device test D, F50, 2026-11-13): what a guarded process started is covered by the guard. A process with a GUARDED ancestor (a process
 * this plugin claims and the shared guard leaves running on purpose) is neither a candidate nor a notStopped line of its own: it is not ended
 * (it belongs to a process that must keep running), it is not counted by the re-scan after the stop, and the person sees one line for the
 * parent. Before this, the loop "while :; do ...; sleep 30; done" of a guarded parent started a NEW tagged "sleep 30" after the listed one
 * was ended; the re-scan found it as a leftover and "Delete and stop" could never succeed. Only a CLAIMED and guarded process covers its
 * descendants: a parent that belongs to another plugin (its tag) or that this plugin does not claim covers nothing, and PID 1 never does.
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

    // Pass 1: every process this plugin claims (a way matched), with the plugins that also use its files (the shared guard, P8).
    val claims = ArrayList<SweepClaim>()
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
        claims.add(SweepClaim(p, how, used))
    }
    // F1: a claimed process that the guard leaves running covers everything below it.
    val guardedPids = claims.filter { it.used.isNotEmpty() }.map { it.proc.pid }.toSet()
    val ppidOf = probe.procs.associate { it.pid to it.ppid }
    fun underGuarded(pid: Int): Boolean {
        if (guardedPids.isEmpty()) return false
        val seen = HashSet<Int>()
        var cur = ppidOf[pid]
        while (cur != null && cur > SWEEP_INIT_PID && seen.size < SWEEP_MAX_DEPTH && seen.add(cur)) {
            if (cur in guardedPids) return true
            cur = ppidOf[cur]
        }
        return false
    }
    // Pass 2: candidates, and the guarded ones as notStopped lines (once, for the parent only).
    val found = ArrayList<SweepCandidate>()
    val notStopped = ArrayList<String>()
    for (c in claims) {
        if (underGuarded(c.proc.pid)) continue
        if (c.used.isNotEmpty()) {
            notStopped.add("PID ${c.proc.pid} ${c.proc.args}: also used by ${c.used.joinToString(", ")}")
            continue
        }
        found.add(SweepCandidate(c.proc.pid, c.proc.start, c.how, c.proc.args))
    }
    // Device test (F50, 2026-11-13): a job like "while :; do ...; sleep 30; done" starts a NEW child every 30 s, so a list that holds the
    // children changed between the dialog and the click, the hash no longer matched and the stop was refused (409) again and again. The kill
    // script ends the whole tree below a listed process anyway, so a process whose parent is also listed is covered by that parent and is
    // left out of the list and of the hash. Only the roots are shown and hashed.
    val listed = found.map { it.pid }.toSet()
    found.removeAll { c -> val pp = ppidOf[c.pid]; pp != null && pp in listed }
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
 * 1.4.2 (F10): the process list for a request the root gate refuses (session older than 4 h, or a connection that may not run root commands).
 * No probe is run; the answer is "cannot be checked", never a list. The text is the one the page shows after "It could not be checked...".
 */
internal fun refusedSweep(): SweepView = uncheckedSweep("cannot be checked: this sign-in or connection may not run root commands now")

/**
 * Step 4: turns the probe's run into [SweepView]. Pure: the caller runs the probe ([run], null when it did not run) and passes [rootGranted],
 * the plugin's ledger paths (the text the plugin sent, which is what the process command lines hold) and [others] (the shared guard).
 */
internal fun buildSweepView(plugin: String, rootGranted: Boolean, run: ShellResult?, ledgerPaths: List<String>, others: Map<String, List<String>>): SweepView {
    if (!rootGranted || run == null) return uncheckedSweep("cannot be checked: root is not available")
    if (!run.success) {
        // the end of what the probe printed is kept (at most 160 characters, one line) so the next device test shows how far it got
        val tail = run.content.replace('\r', ' ').replace('\n', ' ').trim().takeLast(160)
        val why = if (run.content.contains("[timeout after")) "cannot be checked: the process check did not finish in time" else "cannot be checked: the process check failed"
        return uncheckedSweep(if (tail.isEmpty()) why else "$why (last output: $tail)")
    }
    val probe = parseSweepProbe(run.content)
    val pidfiles = parseSweepPidfiles(run.content, sweepPidfilePaths(ledgerPaths))
    val r = classifySweep(plugin, probe, ledgerPaths, pidfiles, others)
    return SweepView(true, r, if (r.overCap) "" else sweepHash(r.candidates))
}

// ---- Step 5: ending the processes and checking again ----

/** Step 5: the sweep step is not started with less than this left of the 60 s (its own wait is [SWEEP_TERM_WAIT_MS], plus the work around it). */
internal const val SWEEP_MIN_MS = 6_000L

/** Step 5: the kill script gets at most this long (it needs about 3 s); a shorter limit keeps it out of the "long" root slots (F9 of Phase 1). */
internal const val SWEEP_KILL_TIMEOUT_MS = 20_000L

/** Step 5: how the kill script may report one process. */
private val SWEEP_KILL_STATUSES = setOf("ended", "killed", "gone", "changed", "protected")

/**
 * Step 5 (D3, D4): the root script that ends the shown candidates. Only digits go into it (PID and start time, both checked here); the command
 * lines are NOT put in, because they come from other processes. The caller has already compared the fresh scan with what the person saw
 * (sweepHash), so "what you saw is what runs"; the script checks PID + start time once more right before it acts.
 * Order (deviation from the wording of D4: SIGCONT is added, because a stopped process never acts on SIGTERM):
 *   1. every root whose PID, start time and state still fit is taken; the sweep's own shell and its parents, PID 1, PID 2 are never taken;
 *   2. the whole tree below the roots is frozen (SIGSTOP; the tree is read again and frozen again, so nothing started in between escapes);
 *   3. SIGTERM to the tree, then SIGCONT, so the processes can end by themselves; wait [SWEEP_TERM_WAIT_MS];
 *   4. the tree is read again (a parent that respawned a child is found), frozen again, then SIGKILL to all of it.
 * SPEED (device test, F50, 2026-11-13, 490 entries in /proc): the first version read /proc/PID/stat with "$(cat ...)" for EVERY process on every pass
 * of tree() (three calls, two or more passes each), thousands of programs, and the script ran into its 20 s limit ("NO ANSWER", plugin kept, and the
 * tree may have been left stopped). tree() now reads every stat file with ONE cat and walks the lines with shell built-ins. Never start a program per
 * process in this script.
 * The MatchiTOOL app process is never touched, wherever it appears in a tree. One line per root: MTKILL|PID|ended|killed|gone|changed|protected.
 * Returns null when a candidate cannot be put in safely (the caller then does not run anything).
 */
internal fun sweepKillScript(candidates: List<SweepCandidate>): String? {
    val ok = candidates.filter { it.pid > SWEEP_INIT_PID && it.start.isNotEmpty() && it.start.all { c -> c in '0'..'9' } }
    if (ok.isEmpty() || ok.size != candidates.size) return null
    val pairs = ok.joinToString(" ") { "'${it.pid}:${it.start}'" }
    // ^ stands for the dollar sign (replaced below), so the Kotlin raw string needs no escapes.
    val template = """
me=^^
prot=" 1 2 ^me "
q=^me; i=0
while [ ^i -lt 64 ]; do
  s=^(cat /proc/^q/stat 2>/dev/null) || break
  case "^s" in *') '*) ;; *) break ;; esac
  r=^{s##*) }; set -- ^r; q=^2
  [ "^q" -gt 0 ] 2>/dev/null || break
  prot="^prot^q "; i=^((i+1))
done
alive() { s=^(cat /proc/^1/stat 2>/dev/null) || return 1; case "^s" in *') '*) ;; *) return 1 ;; esac; s=^{s##*) }; case "^s" in Z*|X*) return 1 ;; esac; return 0; }
tree() {
  all=" ^* "; c=1
  T=^(cat /proc/[0-9]*/stat 2>/dev/null)
  while [ ^c = 1 ]; do
    c=0
    while IFS= read -r s; do
      case "^s" in *') '*) ;; *) continue ;; esac
      pid=^{s%% *}
      case "^all" in *" ^pid "*) continue ;; esac
      r=^{s##*) }; set -- ^r
      case "^all" in *" ^2 "*) all="^all^pid "; c=1 ;; esac
    done <<MTKILL_EOF
^T
MTKILL_EOF
  done
  echo ^all
}
keep() {
  out=
  for p in ^*; do
    case "^prot" in *" ^p "*) continue ;; esac
    a=^(tr '\000' ' ' 2>/dev/null </proc/^p/cmdline)
    case "^a" in 'com.matchi.tool'|'com.matchi.tool '*|'com.matchi.tool:'*) continue ;; esac
    out="^out ^p"
  done
  echo ^out
}
roots=
for pair in @PAIRS@; do
  p=^{pair%%:*}; st=^{pair##*:}
  s=^(cat /proc/^p/stat 2>/dev/null) || { echo "MTKILL|^p|gone"; continue; }
  case "^s" in *') '*) ;; *) echo "MTKILL|^p|gone"; continue ;; esac
  r=^{s##*) }; set -- ^r
  if [ "^{20}" != "^st" ]; then echo "MTKILL|^p|changed"; continue; fi
  alive ^p || { echo "MTKILL|^p|gone"; continue; }
  case "^prot" in *" ^p "*) echo "MTKILL|^p|protected"; continue ;; esac
  roots="^roots ^p"
done
[ -n "^roots" ] || { echo "MTKILL-END"; exit 0; }
set1=^(keep ^(tree ^roots))
for p in ^set1; do kill -STOP ^p 2>/dev/null; done
set2=^(keep ^(tree ^set1))
for p in ^set2; do kill -STOP ^p 2>/dev/null; done
for p in ^set2; do kill -TERM ^p 2>/dev/null; done
for p in ^set2; do kill -CONT ^p 2>/dev/null; done
sleep @WAIT@
for p in ^roots; do if alive ^p; then echo "MTKILL|^p|killed"; else echo "MTKILL|^p|ended"; fi; done
set3=^(keep ^(tree ^set2))
for p in ^set3; do kill -STOP ^p 2>/dev/null; done
for p in ^set3; do kill -KILL ^p 2>/dev/null; done
echo "MTKILL-END"
""".trimIndent()
    return template.replace('^', '$').replace("@PAIRS@", pairs).replace("@WAIT@", (SWEEP_TERM_WAIT_MS / 1000).toString())
}

/** Step 5: pure parser of the kill script's output: PID -> status. Only the known statuses count; anything else is ignored. Never throws. */
internal fun parseSweepKill(output: String): Map<Int, String> {
    val out = LinkedHashMap<Int, String>()
    for (raw in output.split('\n')) {
        val f = raw.trimEnd('\r').split('|')
        if (f.size != 3 || f[0] != "MTKILL") continue
        val pid = f[1].toIntOrNull() ?: continue
        if (f[2] in SWEEP_KILL_STATUSES) out[pid] = f[2]
    }
    return out
}

private fun sweepKillLine(c: SweepCandidate, status: String?): String {
    val who = "PID ${c.pid} (${c.how}) ${c.args}".trim()
    return when (status) {
        "ended" -> "sweep: ended after SIGTERM: $who"
        "killed" -> "sweep: needed SIGKILL: $who"
        "gone" -> "sweep: already gone: $who"
        "changed" -> "sweep: skipped, the PID now belongs to another process: $who"
        "protected" -> "sweep: skipped, protected: $who"
        else -> "sweep: NO ANSWER for $who"
    }
}

/** Step 5 (D3): true when the sweep list the person reviewed ([sent]) is the list a fresh scan gives now. An unchecked or empty scan has the hash "". */
internal fun sweepHashMatches(sent: String, view: SweepView): Boolean = sent == view.hash

/**
 * Step 5: what the sweep step did. [counts] is true when the first scan could run: the re-scan is then a required check (D6, for processes
 * only), so success needs [rescanRan] and no [leftovers]. [killLog] are the lines for the stop log, [notChecked] the lines for "Not checked"
 * (shared processes that were left alone, a step that did not run). [leftovers] are processes still running (or not stopped).
 */
internal class SweepStopResult(
    val counts: Boolean,
    val killLog: List<String>,
    val rescanRan: Boolean,
    val leftovers: List<String>,
    val notChecked: List<String>,
) {
    val clean: Boolean get() = counts && rescanRan && leftovers.isEmpty()
}

/**
 * Step 5 (D2-D4, D6): the sweep step of a stop. [view] is the scan made just before anything ran and already compared with what the person saw.
 * Order inside the stop: the declared uninstall commands ran first (the caller), then this: end the shown candidates, then scan again.
 * Shares the 60 s clock ([totalMs], [start], [now]); the kill script is not started with under [SWEEP_MIN_MS] left; the re-scan needs a second.
 * No retry. [onKill] is called once per candidate right before the script starts (the route writes one "plugin-sweep" audit line each);
 * [onProbe] once before the re-scan. Pure: the shell is passed in, so the tests use fakes.
 *  - an unchecked first scan: nothing is ended, [SweepStopResult.counts] is false and the reason goes to notChecked;
 *  - more than the cap: nothing is ended, the processes are leftovers;
 *  - the re-scan decides: success needs it to RUN, to be complete, and to find nothing. A respawned process shows up there.
 */
internal fun runSweepStop(
    plugin: String,
    view: SweepView,
    totalMs: Long,
    start: Long,
    now: () -> Long,
    exec: (String, Long) -> ShellResult,
    ledgerPaths: List<String>,
    others: Map<String, List<String>>,
    onKill: (String) -> Unit = {},
    onProbe: (String) -> Unit = {},
): SweepStopResult {
    val log = ArrayList<String>(); val notes = ArrayList<String>(); val left = ArrayList<String>()
    fun timeLeft() = totalMs - (now() - start)
    fun shell(script: String, ms: Long): ShellResult =
        try { exec(script, ms) } catch (e: Exception) { ShellResult(false, "could not run: ${e.message ?: e.javaClass.simpleName}") }
    if (!view.checked) {
        for (n in view.result.notes) notes.add("processes: $n")
        return SweepStopResult(false, log, false, left, notes)
    }
    for (s in view.result.notStopped) notes.add("not stopped: $s")
    if (!view.result.complete) notes.add("processes: the first scan was cut short, so some processes may have been missed")
    val cands = view.result.candidates
    if (view.result.overCap) {
        left.add("${view.result.found} processes found; more than $SWEEP_MAX_CANDIDATES, so they are not stopped automatically")
        return SweepStopResult(true, log, false, left, notes)
    }
    var killRan = false
    if (cands.isNotEmpty()) {
        val script = sweepKillScript(cands)
        val t = timeLeft()
        if (script == null) {
            notes.add("sweep did not run: a process entry could not be used safely")
        } else if (t < SWEEP_MIN_MS) {
            notes.add("sweep did not run (the ${totalMs / 1000} s total ran out)")
            for (c in cands) log.add("NOT RUN: end PID ${c.pid} (${c.how}) ${c.args}")
        } else {
            for (c in cands) onKill("sweep end PID ${c.pid} (${c.how}) ${c.args}")
            val r = shell(script, minOf(t, SWEEP_KILL_TIMEOUT_MS))
            killRan = true
            val st = parseSweepKill(r.content)
            for (c in cands) log.add(sweepKillLine(c, st[c.pid]))
            if (!r.success) log.add((if (r.content.contains("[timeout after")) "sweep TIMEOUT: " else "sweep FAILED: ") + r.content.trim().take(STOP_OUTPUT_MAX).replace('\n', ' '))
        }
        if (!killRan) for (c in cands) left.add("process not stopped: PID ${c.pid} ${c.args} (found by ${c.how})")
    }
    val t2 = timeLeft()
    if (t2 < MIN_STOP_COMMAND_MS) {
        notes.add("process re-scan did not run (the ${totalMs / 1000} s total ran out)")
        return SweepStopResult(true, log, false, left, notes)
    }
    onProbe("sweep re-scan (read-only process list)")
    val r2 = shell(sweepProbeScript(sweepPidfilePaths(ledgerPaths)), minOf(t2, SWEEP_PROBE_TIMEOUT_MS))
    val v2 = buildSweepView(plugin, true, r2, ledgerPaths, others)
    var ran = false
    if (!v2.checked) {
        notes.add("process re-scan did not run (" + (v2.result.notes.firstOrNull() ?: "no answer").removePrefix("cannot be checked: ") + ")")
    } else {
        // What is still there is reported even when the list is cut short, but only a complete clean list proves that nothing is left.
        // A candidate the first scan already listed as not stopped (killRan false) is already in [left]; the re-scan would repeat it.
        if (killRan || cands.isEmpty()) for (c in v2.result.candidates) left.add("process still running: PID ${c.pid} ${c.args} (found by ${c.how})")
        if (v2.result.overCap) left.add("${v2.result.found} processes found again; more than $SWEEP_MAX_CANDIDATES")
        if (v2.result.complete) ran = true else notes.add("process re-scan was cut short, so it cannot show that nothing is left")
    }
    return SweepStopResult(true, log, ran, left, notes)
}

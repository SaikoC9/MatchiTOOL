package com.matchi.tool

import android.content.Context
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.IOException
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

/**
 * Independent root backend. Uses the device's existing su implementation (Magisk, KernelSU,
 * APatch, etc.) and never relies on UFI-TOOLS, socat, a shared socket, or an external boot script.
 * Root authorization is granted/revoked by the installed su manager.
 */
data class ShellResult(val success: Boolean, val content: String)

/** Read-only description of the currently granted su session. */
data class RootStatus(
    val granted: Boolean,
    val uid: String,
    val suPath: String,
    val managerHint: String,
    val detail: String
)

object RootShell {
    private const val MAX_OUTPUT_CHARS = 1_000_000
    private const val MAX_SESSIONS = 4          // keep root concurrency modest on the F50 (one slot always stays free for short commands)
    private const val MAX_LONG_JOBS = 3         // boot script + IMEI keeper no longer block every other long job; jobs longer than LONG_JOB_MS may use at most this many of the slots
    private const val LONG_JOB_MS = 30_000L     // the remaining slot stays free for short commands (status polls)
    private const val MAX_QUEUED_LINES = 2048
    private const val IDLE_MS = 180_000L        // an idle shell is closed after 3 minutes
    private const val EOF = "\u0000EOF"
    private const val DENIAL_COOLDOWN_MS = 45_000L // after a refused su, do not ask the root manager again for this long
    private const val TMP = "/data/local/matchitool/tmp"   // root-only: the adb shell user can write /data/local/tmp, so pid/out files must not live there

    /**
     * A long-lived `su -c sh`. Starting su for every command costs 150-400 ms (more on a hot, loaded device),
     * so scripts are fed to an already-open root shell instead. Each script runs in its own child `sh`
     * (stdin = a here-document), so `exit` or a failing command cannot end the session, and the exit code
     * and end of output are marked with a unique line.
     */
    private class Session(val p: Process) {
        // Bounded queue prevents a noisy root command from growing app memory without limit: the reader blocks (put) when it is
        // full, which slows the shell instead of dropping output. Only the end marker uses enqueue (it must never block).
        val lines = ArrayBlockingQueue<String>(MAX_QUEUED_LINES)
        private fun enqueue(line: String) {
            if (!lines.offer(line)) {
                lines.poll()
                lines.offer(line)
            }
        }
        val writer = p.outputStream.bufferedWriter(Charsets.UTF_8)
        @Volatile var busy = false
        @Volatile var used = false
        @Volatile var dead = false
        @Volatile var lastUsed = System.currentTimeMillis()
        init {
            Thread({
                try {
                    BufferedReader(InputStreamReader(p.inputStream, Charsets.UTF_8)).use { r ->
                        while (true) lines.put(r.readLine() ?: break)
                    }
                } catch (e: Exception) { Quiet.note("RootShell.enqueue", e) }
                enqueue(EOF)
            }, "MatchiRootSession").apply { isDaemon = true; start() }
        }
        fun alive() = !dead && p.isAlive
        fun kill() {
            dead = true // Never hand a closing shell to another command.
            try { p.outputStream.close() } catch (e: Exception) { Quiet.note("RootShell.kill", e) }
            try { p.destroy() } catch (e: Exception) { Quiet.note("RootShell.kill", e) }
            try {
                if (!p.waitFor(150, TimeUnit.MILLISECONDS) && p.isAlive) p.destroyForcibly()
            } catch (_: Exception) {
                try { if (p.isAlive) p.destroyForcibly() } catch (e: Exception) { Quiet.note("RootShell.kill", e) }
            }
            try { p.inputStream.close() } catch (e: Exception) { Quiet.note("RootShell.kill", e) }
        }
    }

    // ---- Denied root: remember it briefly so polling cannot trigger a prompt per command ----
    @Volatile private var suBlockedUntil = 0L
    @Volatile private var suBlockedMsg = ""

    /** A ready-made error while su is in its cool-down, or null when su may be tried. */
    private fun blockedResult(): ShellResult? {
        val left = suBlockedUntil - System.currentTimeMillis()
        if (left <= 0L) return null
        return ShellResult(false, "$suBlockedMsg (not asking again for ${(left + 999) / 1000}s)")
    }

    private fun blockSu() {
        suBlockedMsg = "Root was denied or su is not available. Allow MatchiTOOL in your root manager, then try again"
        suBlockedUntil = System.currentTimeMillis() + DENIAL_COOLDOWN_MS
    }

    /** True while su is in its "was refused" cool-down: callers that start su themselves must not do it then. */
    fun isDenied(): Boolean = suBlockedUntil > System.currentTimeMillis()

    /** For callers that start su themselves: su could not be started or died at once, so everyone shares one cool-down. */
    fun noteDenied() = blockSu()

    /** Forget a stored denial (for a manual retry after the user granted root). */
    fun resetDenial() { suBlockedUntil = 0L }

    // Only a line that is su's own message ("su: ...", "/system/bin/su: ...", "su not found"), not any failing command's text.
    private val SU_REFUSAL = Regex("(?m)^\\s*(sh: )?(\\S*/)?su\\b.*(denied|not allowed|authori|not found|no such file|unable to start|cannot run|inaccessible)")

    /** True when a failed one-shot looks like su itself refused/vanished, not like the script failing. */
    private fun looksLikeSuRefusal(r: ShellResult): Boolean {
        if (r.success || r.content.contains("[timeout after")) return false
        return r.content.isBlank() || SU_REFUSAL.containsMatchIn(r.content.lowercase())
    }

    // ---- Timeout: run every script in its own process group and kill that group ----

    /**
     * Shell lines that start `sh` as the leader of its own session/process group (when `setsid` exists) and
     * record its pid in [pf]. `exec sh` keeps that pid, so the pid is also the group id. The script follows as a
     * here-document ([delim]) that is handed to `sh` on file descriptor 3, NOT on stdin: stdin is /dev/null, so a
     * command in the script that reads stdin (cat, read) gets end-of-file instead of swallowing the rest of the
     * script. [redirect] is appended to the command line.
     */
    internal fun launcher(pf: String, delim: String, redirect: String): String =
        "if command -v setsid >/dev/null 2>&1; then MS=setsid; else MS=; fi\n" +
        // The temp folder must be a real directory owned by root (never a link); otherwise nothing is started. The pid file is
        // created with noclobber (set -C) so an existing file or link is never followed or overwritten.
        "MT_OK=; mkdir -p $TMP 2>/dev/null; chmod 700 $TMP 2>/dev/null; if [ ! -L $TMP ] && [ \"\$(stat -c %u $TMP 2>/dev/null)\" = 0 ]; then MT_OK=1; else echo 'unsafe root temp folder'; fi\n" +
        "[ -n \"\$MT_OK\" ] && \$MS sh -c 'set -C; echo \$\$ >$pf || exit 1; set +C; exec sh /dev/fd/3' $redirect </dev/null 3<<'$delim'\n"

    /**
     * Stops everything a timed-out script started. Kills the whole process group, and also walks the child
     * tree (frozen first, so nothing can fork again), which covers shells where `setsid` is missing.
     */
    private fun killScriptTree(pf: String, outFile: String?) {
        val rm = if (outFile != null) "$pf $outFile" else pf
        val script = listOf(
            "P=\$(cat $pf 2>/dev/null)",
            "case \"\$P\" in ''|*[!0-9]*) P= ;; esac",
            "if [ -n \"\$P\" ] && [ \"\$P\" -gt 1 ]; then",
            "  kids() { ps -A -o PID,PPID 2>/dev/null | while read a b; do [ \"\$b\" = \"\$1\" ] && echo \"\$a\"; done; }",
            "  tree() { echo \"\$1\"; for c in \$(kids \"\$1\"); do tree \"\$c\"; done; }",
            "  L=\$(tree \"\$P\")",
            "  kill -STOP \$L 2>/dev/null",
            "  kill -9 -- -\$P 2>/dev/null",
            "  kill -9 \$L 2>/dev/null",
            "fi",
            "rm -f $rm"
        ).joinToString("\n")
        try { runOnce(script, 5_000L, isolate = false) } catch (e: Exception) { Quiet.note("RootShell.killScriptTree", e) }
    }

    private val pool = ArrayList<Session>()
    private val counter = AtomicLong()
    // Hard cap includes one-shot fallback commands; never spawn unlimited concurrent su processes.
    private val commandSlots = Semaphore(MAX_SESSIONS, true)
    // One long job plus one more must not starve the UI polls: long jobs share this smaller pool.
    private val longSlots = Semaphore(MAX_LONG_JOBS, true)

    /** An idle session, a new one if the pool has room, or null when every shell is busy. */
    private fun acquire(): Session? {
        synchronized(pool) {
            val now = System.currentTimeMillis()
            val iter = pool.iterator()
            while (iter.hasNext()) {
                val x = iter.next()
                if (!x.alive() || (!x.busy && now - x.lastUsed > IDLE_MS)) { x.kill(); iter.remove() }
            }
            for (x in pool) if (!x.busy) { x.busy = true; return x }
            if (pool.size >= MAX_SESSIONS) return null
            val created = Session(ProcessBuilder("su", "-c", "sh").redirectErrorStream(true).start())
            created.busy = true
            pool.add(created)
            return created
        }
    }

    private fun release(s: Session, drop: Boolean) {
        synchronized(pool) {
            s.lastUsed = System.currentTimeMillis()
            if (drop) { s.kill(); pool.remove(s) }
            s.busy = false
        }
    }

    /** null = the session could not take the command (nothing ran), so the caller falls back to a one-shot su. */
    private fun runOn(s: Session, script: String, timeout: Long): ShellResult? {
        val id = counter.incrementAndGet().toString(36) + System.nanoTime().toString(36)
        val delim = "MATCHI_EOF_$id"
        val end = "@@MATCHI_END_$id:"
        val pf = "$TMP/.matchi_pid_$id"
        val o = "$TMP/.matchi_out_$id"
        s.lines.clear()
        try {
            // Output goes to a temp file, not the session pipe, so a daemon the script leaves running in the
            // background cannot write into a later command's output. The file is read back and removed at the end.
            s.writer.write("set -C\n")   // noclobber: ">$o" must create a NEW file, never follow or truncate an existing one/link
            s.writer.write(launcher(pf, delim, ">$o 2>&1"))
            // ulimit -f applies to every file the command (and anything it starts) writes, so it must be generous:
            // a 1 MiB cap broke downloads, installs and backups run through plugins. This only stops a runaway
            // writer from filling storage; the captured OUTPUT is bounded separately by head -c below.
            s.writer.write("ulimit -f 4194304 2>/dev/null || true\n") // 4194304 * 512 bytes = 2 GiB
            s.writer.write(script)
            if (!script.endsWith("\n")) s.writer.write("\n")
            s.writer.write("$delim\nrc=\$?; set +C; head -c 1100000 $o 2>/dev/null; rm -f $o $pf; printf '\\n$end%d\\n' \"\$rc\"\n")
            s.writer.flush()
        } catch (_: IOException) { return null }
        val sb = StringBuilder()
        var outputTruncated = false
        val deadline = System.currentTimeMillis() + timeout
        while (true) {
            val remain = deadline - System.currentTimeMillis()
            if (remain <= 0) {
                s.kill()
                // su alone dying does not stop the script's own shell or anything it started: kill the group.
                killScriptTree(pf, o)
                return ShellResult(false, sb.toString().trimEnd() + "\n[timeout after ${timeout}ms]")
            }
            val line = s.lines.poll(remain, TimeUnit.MILLISECONDS) ?: continue
            if (line == EOF) {
                if (!s.used && sb.isEmpty()) return null
                killScriptTree(pf, o) // the shell is gone, but its script's processes may not be
                return ShellResult(false, (sb.toString().trimEnd() + "\n[root shell closed]").trim())
            }
            if (line.startsWith(end)) {
                val rc = line.removePrefix(end).trim().toIntOrNull() ?: 1
                s.used = true
                var text = sb.toString().trim()
                // head -c may have cut a multi-byte character at the capture limit; drop the broken character it leaves at the very end.
                if (text.endsWith('\uFFFD') && text.toByteArray(Charsets.UTF_8).size >= 1_050_000) text = text.trimEnd('\uFFFD')
                val notes = ArrayList<String>(2)
                if (outputTruncated) notes.add("output exceeded the 1 MiB capture limit")
                val note = if (notes.isEmpty()) "" else "\n[output truncated: ${notes.joinToString("; ")}]"
                return ShellResult(rc == 0, text + note)
            }
            if (sb.length < MAX_OUTPUT_CHARS) {
                val room = MAX_OUTPUT_CHARS - sb.length
                if (line.length + 1 > room) outputTruncated = true
                sb.append(line.take(room.coerceAtLeast(0)))
                if (sb.length < MAX_OUTPUT_CHARS) sb.append('\n')
            } else {
                outputTruncated = true
            }
        }
    }

    fun run(ctx: Context, script: String, timeoutMs: Long): ShellResult {
        if (script.isBlank()) return ShellResult(false, "No command supplied")
        if (script.length > 128_000 || script.indexOf('\u0000') >= 0)
            return ShellResult(false, "Command rejected: maximum 128 KB and no NUL bytes")
        val timeout = timeoutMs.coerceIn(1_000L, 180_000L) // ImeiGuard asks for 150 s; the web console caps its own calls at 120 s
        // Root was just refused: answer at once instead of making the root manager ask again.
        blockedResult()?.let { return it }
        // A busy router should fail clearly instead of queuing/spawning an unbounded number of root processes.
        if (!commandSlots.tryAcquire(2, TimeUnit.SECONDS))
            return ShellResult(false, "Root command capacity reached; wait for the current operation to finish")
        var longHeld = false
        try {
            if (timeout > LONG_JOB_MS) {
                if (!longSlots.tryAcquire(2, TimeUnit.SECONDS))
                    return ShellResult(false, "Root command capacity reached; wait for the current operation to finish")
                longHeld = true
            }
            blockedResult()?.let { return it } // another command may have been refused while we waited for a slot
            var sessionFailedToStart = false
            val s = try { acquire() } catch (_: Exception) { sessionFailedToStart = true; null }
            if (s != null) {
                var broken = true
                var r: ShellResult? = null
                try {
                    r = runOn(s, script, timeout)
                    broken = r == null || !s.alive()
                } catch (_: Exception) {
                } finally { release(s, broken) }
                if (r != null) return r
                sessionFailedToStart = true
            }
            val one = runOnce(script, timeout)
            // The session could not start AND the one-shot su failed like a refusal: remember it, ask once.
            if (sessionFailedToStart && looksLikeSuRefusal(one)) blockSu()
            return one
        } finally {
            if (longHeld) longSlots.release()
            commandSlots.release()
        }
    }

    /** The original one-process-per-command path: used when all shells are busy or a session cannot start. */
    private fun runOnce(script: String, timeout: Long, isolate: Boolean = true): ShellResult {
        var process: Process? = null
        val uid = counter.incrementAndGet().toString(36) + System.nanoTime().toString(36)
        val pf: String? = if (isolate) "$TMP/.matchi_pid_$uid" else null
        val delim = "MATCHI_EOF_$uid"
        val output = StringBuilder()
        var readError: String? = null
        var oneShotCut = false
        try {
            // `su -c sh` is supported by common Android root managers. The script is sent over
            // stdin, avoiding shell interpolation of user-provided command text or temp paths.
            val p = ProcessBuilder("su", "-c", "sh")
                .redirectErrorStream(true)
                .start()
            process = p
            val reader = Thread({
                try {
                    BufferedReader(InputStreamReader(p.inputStream, Charsets.UTF_8)).use { r ->
                        while (true) {
                            val line = r.readLine() ?: break
                            synchronized(output) {
                                if (output.length < MAX_OUTPUT_CHARS) {
                                    output.append(line).append('\n')
                                } else {
                                    oneShotCut = true
                                }
                            }
                        }
                    }
                } catch (e: Exception) {
                    readError = e.message
                }
            }, "MatchiRootOutput").apply { isDaemon = true; start() }

            p.outputStream.bufferedWriter(Charsets.UTF_8).use { w ->
                w.write("#!/system/bin/sh\n")
                if (pf != null) {
                    // Same isolation as the session path: the script runs in its own process group.
                    w.write(launcher(pf, delim, ""))
                    w.write(script)
                    if (!script.endsWith("\n")) w.write("\n")
                    w.write("$delim\nrc=\$?; rm -f $pf; exit \$rc\n")
                } else {
                    w.write(script)
                    if (!script.endsWith("\n")) w.write("\n")
                }
                w.flush()
            }

            val exited = p.waitFor(timeout, TimeUnit.MILLISECONDS)
            if (!exited) {
                p.destroy()
                if (p.isAlive) p.destroyForcibly()
                reader.join(500)
                if (pf != null) killScriptTree(pf, null)
                return ShellResult(false, synchronized(output) { output.toString().trimEnd() } + "\n[timeout after ${timeout}ms]")
            }
            reader.join(1_000)
            val text = synchronized(output) { output.toString().trimEnd() }
            val code = p.exitValue()
            val detail = (if (!readError.isNullOrBlank()) "\n[output read: $readError]" else "") +
                (if (oneShotCut) "\n[output truncated: exceeded the 1 MiB capture limit]" else "")
            return ShellResult(code == 0, (text + detail).trim())
        } catch (e: SecurityException) {
            return ShellResult(false, "Unable to start su: ${e.message ?: "permission denied"}")
        } catch (e: Exception) {
            return ShellResult(false, "Root command failed: ${e.message ?: e.javaClass.simpleName}")
        } finally {
            try { process?.outputStream?.close() } catch (e: Exception) { Quiet.note("RootShell.runOnce", e) }
            try { process?.inputStream?.close() } catch (e: Exception) { Quiet.note("RootShell.runOnce", e) }
            try { process?.destroy() } catch (e: Exception) { Quiet.note("RootShell.runOnce", e) }
        }
    }

    /**
     * Ask the installed su manager for a fresh grant. This deliberately does not try to install,
     * patch, or bypass a root manager; Magisk, KernelSU and APatch remain the authority.
     */
    fun status(ctx: Context): RootStatus {
        val script = """
            MUID=$(id -u 2>/dev/null)
            SUPATH=$(command -v su 2>/dev/null)
            HINT="Generic su"
            [ -e /data/adb/magisk ] && HINT="Magisk"
            [ -e /data/adb/ksu ] && HINT="KernelSU"
            [ -e /data/adb/ap ] && HINT="APatch"
            echo "MATCHI_UID=${'$'}{MUID:-unknown}"
            echo "MATCHI_SUPATH=${'$'}{SUPATH:-not found}"
            echo "MATCHI_MANAGER=${'$'}HINT"
        """.trimIndent()
        val r = run(ctx, script, 15_000)
        val values = r.content.lineSequence().mapNotNull {
            val at = it.indexOf('=')
            if (at <= 0) null else it.substring(0, at) to it.substring(at + 1).trim()
        }.toMap()
        val uid = values["MATCHI_UID"] ?: "unknown"
        val path = values["MATCHI_SUPATH"] ?: "unknown"
        val hint = values["MATCHI_MANAGER"] ?: "Unknown su manager"
        val granted = r.success && uid == "0"
        val detail = when {
            granted -> "$hint · UID 0"
            !r.success -> r.content.ifBlank { "su request failed or was denied" }.take(240)
            uid != "unknown" -> "su responded with UID $uid; root was not granted"
            else -> "No usable su response"
        }
        return RootStatus(granted, uid, path, hint, detail)
    }

    /** Close idle persistent shells when the owning foreground service is destroyed. */
    fun closeAll() {
        synchronized(pool) {
            pool.toList().forEach { it.kill() }
            pool.clear()
        }
    }
}

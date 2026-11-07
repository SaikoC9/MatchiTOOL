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
    private const val MAX_SESSIONS = 2          // keep root concurrency modest on the F50
    private const val MAX_QUEUED_LINES = 2048
    private const val IDLE_MS = 180_000L        // an idle shell is closed after 3 minutes
    private const val EOF = "\u0000EOF"

    /**
     * A long-lived `su -c sh`. Starting su for every command costs 150-400 ms (more on a hot, loaded device),
     * so scripts are fed to an already-open root shell instead. Each script runs in its own child `sh`
     * (stdin = a here-document), so `exit` or a failing command cannot end the session, and the exit code
     * and end of output are marked with a unique line.
     */
    private class Session(val p: Process) {
        // Bounded queue prevents a noisy root command from growing app memory without limit.
        val lines = ArrayBlockingQueue<String>(MAX_QUEUED_LINES)
        @Volatile var droppedLines = 0
        private fun enqueue(line: String) {
            if (!lines.offer(line)) {
                lines.poll()
                droppedLines++
                lines.offer(line)
            }
        }
        private fun readBoundedLine(reader: BufferedReader, maxChars: Int = 8192): String? {
            val out = StringBuilder()
            var seen = false
            while (true) {
                val c = reader.read()
                if (c < 0) return if (seen) out.toString() else null
                seen = true
                if (c == 10) return out.toString()
                if (c != 13 && out.length < maxChars) out.append(c.toChar())
                // Continue consuming an overlong line, but never retain more than maxChars.
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
                } catch (_: Exception) { }
                enqueue(EOF)
            }, "MatchiRootSession").apply { isDaemon = true; start() }
        }
        fun alive() = !dead && p.isAlive
        fun kill() {
            dead = true // Never hand a closing shell to another command.
            try { p.outputStream.close() } catch (_: Exception) {}
            try { p.destroy() } catch (_: Exception) {}
            try {
                if (!p.waitFor(150, TimeUnit.MILLISECONDS) && p.isAlive) p.destroyForcibly()
            } catch (_: Exception) {
                try { if (p.isAlive) p.destroyForcibly() } catch (_: Exception) {}
            }
            try { p.inputStream.close() } catch (_: Exception) {}
        }
    }

    private val pool = ArrayList<Session>()
    private val counter = AtomicLong()
    // Hard cap includes one-shot fallback commands; never spawn unlimited concurrent su processes.
    private val commandSlots = Semaphore(MAX_SESSIONS, true)

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
        s.lines.clear()
        s.droppedLines = 0
        try {
            // Output goes to a temp file, not the session pipe, so a daemon the script leaves running in the
            // background cannot write into a later command's output. The file is read back and removed at the end.
            val o = "/data/local/tmp/.matchi_out_$id"
            s.writer.write("sh >$o 2>&1 <<'$delim'\n")
            // ulimit -f applies to every file the command (and anything it starts) writes, so it must be generous:
            // a 1 MiB cap broke downloads, installs and backups run through plugins. This only stops a runaway
            // writer from filling storage; the captured OUTPUT is bounded separately by head -c below.
            s.writer.write("ulimit -f 4194304 2>/dev/null || true\n") // 4194304 * 512 bytes = 2 GiB
            s.writer.write(script)
            if (!script.endsWith("\n")) s.writer.write("\n")
            s.writer.write("$delim\nrc=\$?; head -c 1100000 $o 2>/dev/null; rm -f $o; printf '\\n$end%d\\n' \"\$rc\"\n")
            s.writer.flush()
        } catch (_: IOException) { return null }
        val sb = StringBuilder()
        var outputTruncated = false
        val deadline = System.currentTimeMillis() + timeout
        while (true) {
            val remain = deadline - System.currentTimeMillis()
            if (remain <= 0) {
                s.kill()
                Thread { try { runOnce("rm -f /data/local/tmp/.matchi_out_$id", 5_000L) } catch (_: Exception) {} }.apply { isDaemon = true; start() }
                return ShellResult(false, sb.toString().trimEnd() + "\n[timeout after ${timeout}ms]")
            }
            val line = s.lines.poll(remain, TimeUnit.MILLISECONDS) ?: continue
            if (line == EOF) {
                return if (!s.used && sb.isEmpty()) null
                else ShellResult(false, (sb.toString().trimEnd() + "\n[root shell closed]").trim())
            }
            if (line.startsWith(end)) {
                val rc = line.removePrefix(end).trim().toIntOrNull() ?: 1
                s.used = true
                val text = sb.toString().trim()
                val notes = ArrayList<String>(2)
                if (s.droppedLines > 0) notes.add("${s.droppedLines} output lines discarded to protect memory")
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
        val timeout = timeoutMs.coerceIn(1_000L, 120_000L)
        // A busy router should fail clearly instead of queuing/spawning an unbounded number of root processes.
        if (!commandSlots.tryAcquire(2, TimeUnit.SECONDS))
            return ShellResult(false, "Root command capacity reached; wait for the current operation to finish")
        try {
            val s = try { acquire() } catch (_: Exception) { null }
            if (s != null) {
                var broken = true
                try {
                    val r = runOn(s, script, timeout)
                    broken = r == null || !s.alive()
                    if (r != null) return r
                } catch (_: Exception) {
                } finally { release(s, broken) }
            }
            return runOnce(script, timeout)
        } finally {
            commandSlots.release()
        }
    }

    /** The original one-process-per-command path: used when all shells are busy or a session cannot start. */
    private fun runOnce(script: String, timeout: Long): ShellResult {
        var process: Process? = null
        val output = StringBuilder()
        var readError: String? = null
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
                                if (output.length < MAX_OUTPUT_CHARS) output.append(line).append('\n')
                            }
                        }
                    }
                } catch (e: Exception) {
                    readError = e.message
                }
            }, "MatchiRootOutput").apply { isDaemon = true; start() }

            p.outputStream.bufferedWriter(Charsets.UTF_8).use { w ->
                w.write("#!/system/bin/sh\n")
                w.write(script)
                if (!script.endsWith("\n")) w.write("\n")
                w.flush()
            }

            val exited = p.waitFor(timeout, TimeUnit.MILLISECONDS)
            if (!exited) {
                p.destroy()
                if (p.isAlive) p.destroyForcibly()
                reader.join(500)
                return ShellResult(false, synchronized(output) { output.toString().trimEnd() } + "\n[timeout after ${timeout}ms]")
            }
            reader.join(1_000)
            val text = synchronized(output) { output.toString().trimEnd() }
            val code = p.exitValue()
            val detail = if (!readError.isNullOrBlank()) "\n[output read: $readError]" else ""
            return ShellResult(code == 0, (text + detail).trim())
        } catch (e: SecurityException) {
            return ShellResult(false, "Unable to start su: ${e.message ?: "permission denied"}")
        } catch (e: Exception) {
            return ShellResult(false, "Root command failed: ${e.message ?: e.javaClass.simpleName}")
        } finally {
            try { process?.outputStream?.close() } catch (_: Exception) {}
            try { process?.inputStream?.close() } catch (_: Exception) {}
            try { process?.destroy() } catch (_: Exception) {}
        }
    }

    /**
     * Ask the installed su manager for a fresh grant. This deliberately does not try to install,
     * patch, or bypass a root manager; Magisk, KernelSU and APatch remain the authority.
     */
    fun status(ctx: Context): RootStatus {
        val script = """
            UID=$(id -u 2>/dev/null)
            SUPATH=$(command -v su 2>/dev/null)
            HINT="Generic su"
            [ -e /data/adb/magisk ] && HINT="Magisk"
            [ -e /data/adb/ksu ] && HINT="KernelSU"
            [ -e /data/adb/ap ] && HINT="APatch"
            echo "MATCHI_UID=${'$'}{UID:-unknown}"
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

    fun isRoot(ctx: Context): Boolean = status(ctx).granted

    /** Close idle persistent shells when the owning foreground service is destroyed. */
    fun closeAll() {
        synchronized(pool) {
            pool.toList().forEach { it.kill() }
            pool.clear()
        }
    }
}

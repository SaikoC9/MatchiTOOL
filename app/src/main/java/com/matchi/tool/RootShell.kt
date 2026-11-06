package com.matchi.tool

import android.content.Context
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.IOException
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

/**
 * Independent root backend. Uses the device's existing su implementation (Magisk, KernelSU,
 * APatch, etc.) and never relies on UFI-TOOLS, socat, a shared socket, or an external boot script.
 * Root authorization is granted/revoked by the installed su manager.
 */
data class ShellResult(val success: Boolean, val content: String)

object RootShell {
    private const val MAX_OUTPUT_CHARS = 1_000_000
    private const val MAX_SESSIONS = 3          // parallel persistent root shells
    private const val IDLE_MS = 180_000L        // an idle shell is closed after 3 minutes
    private const val EOF = "\u0000EOF"

    /**
     * A long-lived `su -c sh`. Starting su for every command costs 150-400 ms (more on a hot, loaded device),
     * so scripts are fed to an already-open root shell instead. Each script runs in its own child `sh`
     * (stdin = a here-document), so `exit` or a failing command cannot end the session, and the exit code
     * and end of output are marked with a unique line.
     */
    private class Session(val p: Process) {
        val lines = LinkedBlockingQueue<String>()
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
                lines.put(EOF)
            }, "MatchiRootSession").apply { isDaemon = true; start() }
        }
        fun alive() = !dead && p.isAlive
        fun kill() {
            dead = true   // destroy() is asynchronous: never hand a killed shell to the next command
            try { p.destroy() } catch (_: Exception) {}
            try { if (p.isAlive) p.destroyForcibly() } catch (_: Exception) {}
        }
    }

    private val pool = ArrayList<Session>()
    private val counter = AtomicLong()

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
        s.lastUsed = System.currentTimeMillis()
        if (drop) { s.kill(); synchronized(pool) { pool.remove(s) } }
        s.busy = false
    }

    /** null = the session could not take the command (nothing ran), so the caller falls back to a one-shot su. */
    private fun runOn(s: Session, script: String, timeout: Long): ShellResult? {
        val id = counter.incrementAndGet().toString(36) + System.nanoTime().toString(36)
        val delim = "MATCHI_EOF_$id"
        val end = "@@MATCHI_END_$id:"
        s.lines.clear()
        try {
            // Output goes to a temp file, not the session pipe, so a daemon the script leaves running in the
            // background cannot write into a later command's output. The file is read back and removed at the end.
            val o = "/data/local/tmp/.matchi_out_$id"
            s.writer.write("sh >$o 2>&1 <<'$delim'\n")
            s.writer.write(script)
            if (!script.endsWith("\n")) s.writer.write("\n")
            s.writer.write("$delim\nrc=\$?; cat $o 2>/dev/null; rm -f $o; printf '\\n$end%d\\n' \"\$rc\"\n")
            s.writer.flush()
        } catch (_: IOException) { return null }
        val sb = StringBuilder()
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
                return ShellResult(rc == 0, sb.toString().trim())
            }
            if (sb.length < MAX_OUTPUT_CHARS) sb.append(line).append('\n')
        }
    }

    fun run(ctx: Context, script: String, timeoutMs: Long): ShellResult {
        if (script.isBlank()) return ShellResult(false, "No command supplied")
        val timeout = timeoutMs.coerceIn(1_000L, 120_000L)
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

    fun isRoot(ctx: Context): Boolean {
        val result = run(ctx, "id -u", 15_000)
        return result.success && result.content.trim().lines().lastOrNull() == "0"
    }
}

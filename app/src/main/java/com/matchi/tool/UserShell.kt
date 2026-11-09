package com.matchi.tool

import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Runs a command as the app's own Android user (no su). UFI-TOOLS plugins call this for work that needs no privileges,
 * so it must never be a plain alias for the root shell. The command starts in the app's private files folder and its
 * output (stdout and stderr together) is cut at [MAX_OUT] bytes.
 */
object UserShell {
    private const val MAX_OUT = 256 * 1024

    fun run(dir: File, command: String, timeoutMs: Long): ShellResult {
        val p = try {
            ProcessBuilder("sh", "-c", command).directory(dir).redirectErrorStream(true).start()
        } catch (e: Exception) {
            return ShellResult(false, e.message ?: "could not start sh")
        }
        val out = java.io.ByteArrayOutputStream()
        val reader = Thread {
            try {
                val buf = ByteArray(8192)
                p.inputStream.use { ins ->
                    while (true) {
                        val n = ins.read(buf)
                        if (n < 0) break
                        if (out.size() < MAX_OUT) out.write(buf, 0, minOf(n, MAX_OUT - out.size()))   // keep draining so the child never blocks
                    }
                }
            } catch (_: Exception) { /* process ended or was killed */ }
        }.apply { isDaemon = true; start() }
        val done = try { p.waitFor(timeoutMs, TimeUnit.MILLISECONDS) } catch (_: InterruptedException) { false }
        if (!done) p.destroyForcibly()
        try { reader.join(500) } catch (_: InterruptedException) { /* give up waiting for the tail */ }
        val text = String(synchronized(out) { out.toByteArray() }, Charsets.UTF_8).trimEnd()
        if (!done) return ShellResult(false, (text + "\n[timed out after ${timeoutMs / 1000}s]").trim())
        return ShellResult(p.exitValue() == 0, text)
    }
}

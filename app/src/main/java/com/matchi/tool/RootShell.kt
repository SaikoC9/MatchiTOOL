package com.matchi.tool

import android.content.Context
import java.io.BufferedReader
import java.io.InputStreamReader
import java.util.concurrent.TimeUnit

/**
 * Independent root backend. Uses the device's existing su implementation (Magisk, KernelSU,
 * APatch, etc.) and never relies on UFI-TOOLS, socat, a shared socket, or an external boot script.
 * Root authorization is granted/revoked by the installed su manager.
 */
data class ShellResult(val success: Boolean, val content: String)

object RootShell {
    private const val MAX_OUTPUT_CHARS = 1_000_000

    fun run(ctx: Context, script: String, timeoutMs: Long): ShellResult {
        if (script.isBlank()) return ShellResult(false, "No command supplied")
        val timeout = timeoutMs.coerceIn(1_000L, 120_000L)
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

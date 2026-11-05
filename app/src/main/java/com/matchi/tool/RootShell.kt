package com.matchi.tool

import android.content.Context
import android.net.LocalSocket
import android.net.LocalSocketAddress
import android.util.Base64
import java.io.File

data class ShellResult(val success: Boolean, val content: String)

/**
 * Root access the same way UFI-TOOLS does it: a root daemon (socat) listens on a unix socket inside
 * this app's own files dir, owned by this app's uid. The app never runs as root itself.
 * The daemon is started once by start.sh (see MainActivity for the setup command).
 */
object RootShell {
    fun sockFile(ctx: Context) = File(ctx.filesDir, "matchi_root.sock")

    fun run(ctx: Context, script: String, timeoutMs: Long): ShellResult {
        val f = sockFile(ctx)
        if (!f.exists()) return ShellResult(false, "Root daemon socket missing. Run the setup command shown in the MatchiTOOL app once.")
        val ls = LocalSocket()
        val out = StringBuilder()
        var rc = -1
        var finished = false
        try {
            ls.connect(LocalSocketAddress(f.absolutePath, LocalSocketAddress.Namespace.FILESYSTEM))
            val tmp = "/data/local/tmp/matchi_" + System.nanoTime()
            val b64 = Base64.encodeToString(script.toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
            val w = ls.outputStream.bufferedWriter()
            w.write(": > ${tmp}.b64\n")
            for (chunk in b64.chunked(3000)) w.write("printf %s '" + chunk + "' >> ${tmp}.b64\n")
            w.write("base64 -d ${tmp}.b64 > ${tmp}.sh\n")
            w.write("sh ${tmp}.sh 2>&1 < /dev/null; R=\$?; echo; echo __RC__\$R\n")
            w.write("rm -f ${tmp}.b64 ${tmp}.sh; echo __END__\n")
            w.flush()
            val reader = Thread {
                try {
                    ls.inputStream.bufferedReader().use { r ->
                        while (true) {
                            val line = r.readLine() ?: break
                            if (line == "__END__") { finished = true; break }
                            if (line.startsWith("__RC__")) { rc = line.substring(6).trim().toIntOrNull() ?: -1; continue }
                            synchronized(out) { if (out.length < 1_000_000) out.append(line).append('\n') }
                        }
                    }
                } catch (_: Exception) {}
            }
            reader.start()
            reader.join(timeoutMs)
            if (reader.isAlive) {
                try { ls.close() } catch (_: Exception) {}
                return ShellResult(false, synchronized(out) { out.toString() }.trimEnd() + "\n[timeout]")
            }
            val text = synchronized(out) { out.toString() }.trimEnd()
            return ShellResult(finished && rc == 0, text)
        } catch (e: Exception) {
            return ShellResult(false, "root socket error: ${e.message}")
        } finally {
            try { ls.close() } catch (_: Exception) {}
        }
    }

    fun isRoot(ctx: Context): Boolean = run(ctx, "id -u", 5000).content.trim() == "0"
}

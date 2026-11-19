package com.matchi.tool

import android.content.Context
import java.io.File
import java.nio.file.Files

/**
 * The device side of [BinaryGuard]: looks at the copies in the app's files folder before the app runs them as root.
 *
 * A file that does not match the hash from the build is deleted, not left in place with a warning. Deleting is what makes "refused"
 * true for the scripts that call curl, jq and zreq by path, because they never pass through the app. The file comes back from the APK at
 * the next start of the host (see WebServer.seedPlugins).
 */
object BinaryCheck {
    /**
     * Null when [name] may run. Otherwise the text to show: the file was missing or was not the one the app was built with.
     * Cheap on the second call (see [BinaryGuard.isStamped]).
     */
    fun problem(ctx: Context, name: String): String? {
        val f = File(ctx.filesDir, name)
        if (!f.isFile) return "$name is not installed. Restart the MatchiTOOL host to copy it again."
        val size = f.length()
        val modified = f.lastModified()
        if (BinaryGuard.isStamped(name, size, modified)) return null
        return when (BinaryGuard.verdict(name, BinaryGuard.hashFile(f))) {
            BinaryGuard.Verdict.OK, BinaryGuard.Verdict.UNKNOWN -> { BinaryGuard.stamp(name, size, modified); BinaryGuard.clearRefusal(name); null }
            else -> reject(ctx, name, "it does not match the hash from the build")
        }
    }

    /** Removes the file and remembers why. Returns the text for the caller to show. */
    fun reject(ctx: Context, name: String, why: String): String {
        val f = File(ctx.filesDir, name)
        BinaryGuard.unstamp(name)
        val gone = try { !f.exists() || f.delete() } catch (e: Exception) { Quiet.note("BinaryCheck.reject", e); false }
        val text = "$name was refused: $why." + if (gone) " The file was removed; restart the MatchiTOOL host to copy the original again." else " The file could not be removed."
        BinaryGuard.refuse(name, text)
        LogCatcher.log("ERROR", "BinaryCheck", text)
        return text
    }

    /**
     * Group or other write access on the binaries or on the folder that holds them. On the binaries it is taken away. On the folder it is
     * only logged: the app's folder belongs to Android and is not changed from here. Never throws.
     */
    fun checkPermissions(ctx: Context) {
        try {
            val dir = ctx.filesDir
            if (BinaryGuard.othersCanWrite(Files.getPosixFilePermissions(dir.toPath())))
                LogCatcher.log("WARNING", "BinaryCheck", "The folder that holds the bundled binaries can be written by other users (${dir.absolutePath})")
            for (name in BinaryHashes.names()) {
                val f = File(dir, name)
                if (!f.isFile) continue
                if (BinaryGuard.othersCanWrite(Files.getPosixFilePermissions(f.toPath()))) {
                    f.setWritable(false, false)   // clears the write bit for everybody ...
                    f.setWritable(true, true)     // ... and gives it back to the owner only
                    LogCatcher.log("WARNING", "BinaryCheck", "$name could be written by other users; changed to owner only")
                }
            }
        } catch (e: Exception) { Quiet.note("BinaryCheck.checkPermissions", e) }
    }

    /** The lines Full diagnose adds. Hashes each file once; only runs when someone asks for the diagnosis. */
    fun report(ctx: Context): String {
        val refusals = BinaryGuard.refusals()
        return BinaryHashes.names().joinToString("\n") { name ->
            BinaryGuard.reportLine(name, BinaryGuard.verdict(name, BinaryGuard.hashFile(File(ctx.filesDir, name))), refusals[name])
        }
    }
}

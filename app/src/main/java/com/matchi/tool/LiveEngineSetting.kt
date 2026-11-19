package com.matchi.tool

import android.content.Context
import java.io.File

/**
 * The app side of [LiveEngine]: the "Fast sampler" setting and the check of the program's file. The Live panel's root reader asks
 * [binaryPath] every time it starts, so a changed setting is picked up at the next start (the route that changes it restarts a running reader).
 */
object LiveEngineSetting {
    @Volatile private var app: Context? = null

    /** Called once by WebServer. Until then the setting reads as off, which is the shell loop. */
    fun bind(c: Context) { app = c.applicationContext ?: c }

    /** True when the file in the files folder is exactly the one the app was built with. Does not change anything on disk. */
    fun available(): Boolean {
        val c = app ?: return false
        return BinaryGuard.verdict(LiveEngine.BINARY, BinaryGuard.hashFile(File(c.filesDir, LiveEngine.BINARY))) == BinaryGuard.Verdict.OK
    }

    /**
     * The full path of matchi-sampler when the setting is on and the file passes the hash check, otherwise null (the shell loop runs).
     * A file that does not match is refused and removed by [BinaryCheck], like the other bundled binaries; it comes back at the next host start.
     */
    fun binaryPath(): String? {
        val c = app ?: return null
        val on = Prefs.liveBinary(c)
        val problem = if (on) BinaryCheck.problem(c, LiveEngine.BINARY) else null
        if (!LiveEngine.useBinary(on, problem)) {
            if (on) LogCatcher.log("WARNING", "LiveSampler", "Fast sampler is on but matchi-sampler is not used, the shell loop runs instead: $problem")
            return null
        }
        val path = File(c.filesDir, LiveEngine.BINARY).absolutePath
        if (!LiveEngine.pathIsSafe(path)) {
            LogCatcher.log("WARNING", "LiveSampler", "matchi-sampler path is not a plain path ($path), the shell loop runs instead")
            return null
        }
        return path
    }
}

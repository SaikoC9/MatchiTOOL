package com.matchi.tool

import android.content.Context
import java.io.File

/**
 * Keeps a user-chosen IMEI across reboots. AT+SPIMEI changes the modem, but the firmware can restore the factory value
 * at boot, so the chosen value is saved in /data/local/matchitool/imei_target.txt and written again whenever the modem
 * reports something else (at most 3 tries per slot until the IMEI matches again).
 */
object ImeiGuard {
    /** [waitSteps] x 3 s to wait for the modem (boot), [force] = ignore the 3-try limit (manual "Apply now"). */
    fun apply(ctx: Context, waitSteps: Int, force: Boolean): String {
        val sendat = File(ctx.filesDir, "sendat").absolutePath
        val script = ctx.assets.open("bin/imei_apply.sh").bufferedReader().use { it.readText() }.replace("__SENDAT__", sendat)
        val steps = waitSteps.coerceIn(0, 60)
        val r = RootShell.run(ctx, "WAIT=$steps\nFORCE=${if (force) 1 else 0}\n$script", 150_000)
        return r.content.trim()
    }
}

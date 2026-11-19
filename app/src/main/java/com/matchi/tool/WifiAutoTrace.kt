package com.matchi.tool

import android.content.Context

/**
 * A small text log of what the Wi-Fi auto switch saw and did, written to a file so it is still there after the router restarts
 * (the in-memory app log is not). One line per change, not per look. The file is rolled to ".1" when it passes about 100 KB.
 * Read it with: cat /data/local/matchitool/wifi_auto.log
 *
 * Blocking (one short root call): worker thread only.
 */
internal object WifiAutoTrace {
    const val FILE = "/data/local/matchitool/wifi_auto.log"
    private const val MAX_BYTES = 100_000

    fun note(ctx: Context, message: String) {
        // Only plain characters go into the shell line, so nothing in a message can break out of the quotes.
        val clean = message.replace(Regex("[^A-Za-z0-9 .,:;=()_/+-]"), " ").take(200)
        val script = "mkdir -p /data/local/matchitool; " +
            "[ \"\$(wc -c < $FILE 2>/dev/null || echo 0)\" -gt $MAX_BYTES ] && mv -f $FILE $FILE.1; " +
            "echo \"\$(date '+%m-%d %H:%M:%S') up=\$(cut -d. -f1 /proc/uptime) $clean\" >> $FILE"
        try { RootShell.run(ctx, script, 5_000L) } catch (e: Exception) { Quiet.note("WifiAutoTrace.note", e) }
    }
}

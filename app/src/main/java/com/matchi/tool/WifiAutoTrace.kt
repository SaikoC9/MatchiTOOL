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

    @Volatile private var lastNetAt = 0L

    /**
     * One extra line with the router's own network state, written when the router web API cannot be reached: br0 state and
     * address, its ports, usb0 carrier, wlan0 state, hostapd, and which way the route to 192.168.0.1 goes. It shows why the
     * address was missing. At most one line per 20 s. Plain characters only (everything read is cut to those).
     */
    fun noteNet(ctx: Context) {
        val now = System.currentTimeMillis()
        if (now - lastNetAt < 20_000L) return
        lastNetAt = now
        val keep = "tr -cd 'A-Za-z0-9 .,:/_-'"
        val script = "mkdir -p /data/local/matchitool; " +
            "echo \"\$(date '+%m-%d %H:%M:%S') up=\$(cut -d. -f1 /proc/uptime) net: " +
            "br0=\$(cat /sys/class/net/br0/operstate 2>&1 | $keep) " +
            "br0ip=\$(ip -4 addr show br0 2>&1 | grep -o 'inet [0-9.]*' | tr ' ' = | tr '\\n' , | $keep) " +
            "ports=\$(ls /sys/class/net/br0/brif 2>&1 | tr '\\n' , | $keep) " +
            "usb0=\$(cat /sys/class/net/usb0/carrier 2>&1 | $keep) " +
            "wlan0=\$(cat /sys/class/net/wlan0/operstate 2>&1 | $keep) " +
            "hostapd=\$(getprop init.svc.hostapd | $keep) " +
            "route=\$(ip route get 192.168.0.1 2>&1 | head -1 | $keep)\" >> $FILE"
        try { RootShell.run(ctx, script, 5_000L) } catch (e: Exception) { Quiet.note("WifiAutoTrace.noteNet", e) }
    }
}

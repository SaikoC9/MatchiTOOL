package com.matchi.tool

import android.content.Context

/**
 * AdGuard Home web page "door". The page (port 3000) has its own login and its own long-lived cookie, which a MatchiTOOL sign-out
 * cannot end. So the AdGuard Home plugin keeps port 3000 closed to the hotspot with an iptables chain AGH_UI (loopback RETURN, then DROP),
 * and this object adds an ACCEPT for ONE client address while that client holds a live console session. The door closes when the
 * session ends (sign-out, idle, 12 h, password change), after [DOOR_MS], and when the host starts. The plugin creates the chain; without it
 * [open] refuses, so nothing is ever opened by accident.
 */
object AghDoor {
    const val CHAIN = "AGH_UI"
    const val DOOR_MS = 30L * 60 * 1000
    private const val SWEEP_MS = 10_000L

    private class Door(val ip: String, val token: String, var until: Long)
    private val doors = LinkedHashMap<String, Door>()
    private var sweeper: Thread? = null

    /** The address in iptables form, or null when it is not a plain IPv4 / IPv6 address. IPv4-mapped IPv6 becomes IPv4. */
    internal fun cleanIp(raw: String?): String? {
        val x = (raw ?: "").trim().substringBefore('%').lowercase().removePrefix("::ffff:")
        val m = Regex("^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$").matchEntire(x)
        if (m != null) return if (m.groupValues.drop(1).all { it.toInt() in 0..255 }) x else null
        return if (x.contains(':') && Regex("^[0-9a-f:]{2,39}$").matches(x)) x else null
    }

    private fun tool(ip: String) = if (ip.contains(':')) "ip6tables" else "iptables"

    internal fun openScript(ip: String): String {
        val t = tool(ip)
        return "$t -w 5 -S $CHAIN >/dev/null 2>&1 || { echo NOCHAIN; exit 1; }\n" +
            "$t -w 5 -C $CHAIN -s $ip -j ACCEPT 2>/dev/null || $t -w 5 -I $CHAIN 1 -s $ip -j ACCEPT || { echo FAIL; exit 1; }\necho OK"
    }

    internal fun closeScript(ip: String): String {
        val t = tool(ip)
        return "i=0; while [ \$i -lt 5 ] && $t -w 5 -D $CHAIN -s $ip -j ACCEPT 2>/dev/null; do i=\$((i+1)); done; echo OK"
    }

    /** Back to the base state: loopback RETURN, then DROP. Does nothing for a tool whose chain does not exist. */
    internal fun resetScript(): String = "for t in iptables ip6tables; do\n" +
        "  command -v \$t >/dev/null 2>&1 || continue\n" +
        "  \$t -w 5 -S $CHAIN >/dev/null 2>&1 || continue\n" +
        "  \$t -w 5 -F $CHAIN; \$t -w 5 -A $CHAIN -i lo -j RETURN; \$t -w 5 -A $CHAIN -j DROP\n" +
        "done\necho OK"

    /** Opens the door for [rawIp] for the session [token]. Returns null on success, otherwise the reason. */
    fun open(ctx: Context, rawIp: String?, token: String?): String? {
        val ip = cleanIp(rawIp) ?: return "not a usable client address"
        if (token.isNullOrEmpty()) return "no session"
        val r = RootShell.run(ctx, openScript(ip), 10_000)
        if (!r.content.contains("OK")) {
            return if (r.content.contains("NOCHAIN")) "port 3000 is not protected yet (turn the AdGuard Home web page on LAN off and on again in the plugin)" else "the firewall refused the rule"
        }
        synchronized(doors) { doors[ip] = Door(ip, token, System.currentTimeMillis() + DOOR_MS) }
        startSweeper(ctx.applicationContext)
        return null
    }

    fun close(ctx: Context, rawIp: String?) {
        val ip = cleanIp(rawIp) ?: return
        synchronized(doors) { doors.remove(ip) }
        try { RootShell.run(ctx, closeScript(ip), 10_000) } catch (e: Exception) { Quiet.note("AghDoor.close", e) }
    }

    /** Closes every door whose session is gone or whose time is up. */
    fun sweep(ctx: Context) {
        val now = System.currentTimeMillis()
        val dead = synchronized(doors) { doors.values.filter { now > it.until || !Sessions.validate(ctx, it.token, touch = false) }.map { it.ip } }
        dead.forEach { close(ctx, it) }
    }

    /** After a sign-out or a password change: close at once, off the request thread. */
    fun sweepAsync(ctx: Context) {
        WebGate.sweepAsync()   // every web gate ends its logins of dead console sessions too
        if (synchronized(doors) { doors.isEmpty() }) return
        val c = ctx.applicationContext
        Thread { try { sweep(c) } catch (e: Exception) { Quiet.note("AghDoor.sweepAsync", e) } }.also { it.isDaemon = true }.start()
    }

    /** Host start: nothing is open from an earlier run. Only touches an existing chain. */
    fun closeAll(ctx: Context) {
        WebGate.closeAll()
        synchronized(doors) { doors.clear() }
        try { RootShell.run(ctx, resetScript(), 10_000) } catch (e: Exception) { Quiet.note("AghDoor.closeAll", e) }
    }

    private fun startSweeper(c: Context) {
        synchronized(doors) {
            if (sweeper?.isAlive == true) return
            sweeper = Thread {
                while (true) {
                    try { Thread.sleep(SWEEP_MS) } catch (_: InterruptedException) { return@Thread }
                    try { sweep(c) } catch (e: Exception) { Quiet.note("AghDoor.sweeper", e) }
                    if (synchronized(doors) { doors.isEmpty() }) { synchronized(doors) { sweeper = null }; return@Thread }
                }
            }.also { it.isDaemon = true; it.start() }
        }
    }
}

package com.matchi.tool

import android.content.Context

/**
 * Android side of the generic web gate. One [WebGateProxy] per gate NAME (the name a plugin declares with @matchi-gate), each on a port
 * MatchiTOOL picks from 3100-3199 ([GatePortTable]) and remembers per name. Nothing listens on any gate port until a plugin's first Open:
 * [open] starts that gate lazily. At most [GATE_MAX_OPEN] gates listen at once; a gate nobody is logged in to is stopped to make room.
 * Every gate ends its logins when the console session ends (sweep), so the hooks in AghDoor / the auth routes call [sweepAsync] and [closeAll].
 *
 * The declaration ([GateDecl]) always comes from the installed plugin file (see WebRoutesGate.kt), never from a request.
 */
object WebGate {
    private class Running(val decl: GateDecl, val listen: Int, val proxy: WebGateProxy)

    /** [ticket] and [port] are set on success, [error] otherwise. */
    class Opened(val ticket: String?, val port: Int, val error: String?)

    private val lock = Any()
    private val running = LinkedHashMap<String, Running>()

    internal fun open(ctx: Context, decl: GateDecl, rawIp: String?, token: String?): Opened {
        if (token.isNullOrEmpty()) return Opened(null, 0, "no session")
        val app = ctx.applicationContext
        val toStop = ArrayList<WebGateProxy>()
        synchronized(lock) {
            val old = running[decl.name]
            if (old != null && !old.decl.sameAs(decl)) { running.remove(decl.name); toStop.add(old.proxy) }   // the plugin was updated: new rules need a new gate
            if (!running.containsKey(decl.name) && running.size >= GATE_MAX_OPEN) {
                val idle = running.entries.filter { it.value.proxy.isIdle() }.map { it.key }
                for (k in idle) { running.remove(k)?.let { toStop.add(it.proxy) } }
            }
        }
        toStop.forEach { try { it.stop() } catch (e: Exception) { Quiet.note("WebGate.stop", e) } }
        val made: Any = synchronized(lock) {
            val have = running[decl.name]
            if (have != null) return@synchronized have
            if (running.size >= GATE_MAX_OPEN) return@synchronized "too many protected web pages are open ($GATE_MAX_OPEN); sign out of one of them first"
            val table = GatePortTable(Prefs.gatePorts(app))
            val skip = HashSet<Int>()
            var why = "no free gate port"
            for (attempt in 0 until 5) {
                val listen = table.portFor(decl.name, skip) ?: break
                val cfg = WebGateConfig(listen, decl.port, decl.logout, decl.idleMs, decl.tabClose, "${WebGateProxy.COOKIE}_$listen")
                val p = WebGateProxy(cfg, { Sessions.validate(app, it, touch = false) })
                val err = p.start()
                if (err == null) {
                    val r = Running(decl, listen, p)
                    Prefs.setGatePorts(app, table.snapshot())
                    running[decl.name] = r
                    return@synchronized r
                }
                why = err; skip.add(listen)
            }
            why
        }
        if (made is String) return Opened(null, 0, made)
        val entry = made as Running
        val t = entry.proxy.newTicket(rawIp, token) ?: return Opened(null, 0, "not a usable client address")
        return Opened(t, entry.listen, null)
    }

    /** After a sign-out or a password change: end gates of dead sessions at once, off the request thread. */
    fun sweepAsync() {
        val all = synchronized(lock) { running.values.map { it.proxy } }
        if (all.isEmpty()) return
        Thread { for (p in all) try { p.sweep() } catch (e: Exception) { Quiet.note("WebGate.sweepAsync", e) } }.also { it.isDaemon = true }.start()
    }

    /** Plugin deleted or switched off: log that gate out, close its port and forget its port number. */
    fun stop(ctx: Context, gateName: String) {
        val r = synchronized(lock) { running.remove(gateName) }
        try { r?.proxy?.stop() } catch (e: Exception) { Quiet.note("WebGate.stop", e) }
        try {
            val app = ctx.applicationContext
            val t = GatePortTable(Prefs.gatePorts(app))
            if (gateName in t.snapshot()) { t.forget(gateName); Prefs.setGatePorts(app, t.snapshot()) }
        } catch (e: Exception) { Quiet.note("WebGate.forget", e) }
    }

    /** The gate names that are listening now (for the stop hooks and the diagnostics). */
    fun openNames(): List<String> = synchronized(lock) { running.keys.toList() }

    fun closeAll() {
        val all = synchronized(lock) { val l = running.values.map { it.proxy }; running.clear(); l }
        for (p in all) try { p.stop() } catch (e: Exception) { Quiet.note("WebGate.closeAll", e) }
    }
}

package com.matchi.tool

import android.content.Context

/**
 * Android side of [WebGateProxy]: starts the proxy on first use (nothing listens on [PORT] until the plugin's Open is pressed),
 * hands out entry tickets and ends gates when a console session ends. See WebGateProxy for how the login is kept off the browser.
 */
object AghGate {
    const val PORT = 3001
    private const val UPSTREAM = 3000
    @Volatile private var proxy: WebGateProxy? = null

    /** Returns (ticket, null) or (null, reason). */
    fun open(ctx: Context, rawIp: String?, token: String?): Pair<String?, String?> {
        if (token.isNullOrEmpty()) return null to "no session"
        val app = ctx.applicationContext
        val p = synchronized(this) { proxy ?: WebGateProxy(WebGateConfig(PORT, UPSTREAM, logoutPath = "/control/logout", idleMs = 3_600_000L, tabClose = false), { Sessions.validate(app, it, touch = false) }).also { proxy = it } }
        p.start()?.let { return null to it }
        val t = p.newTicket(rawIp, token) ?: return null to "not a usable client address"
        return t to null
    }

    /** After a sign-out or a password change: end gates of dead sessions at once, off the request thread. */
    fun sweepAsync() {
        val p = proxy ?: return
        Thread { try { p.sweep() } catch (e: Exception) { Quiet.note("AghGate.sweepAsync", e) } }.also { it.isDaemon = true }.start()
    }

    fun closeAll() { try { proxy?.closeAll() } catch (e: Exception) { Quiet.note("AghGate.closeAll", e) } }
}

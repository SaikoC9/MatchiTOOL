package com.matchi.tool

import android.content.Context
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Phase 6b glue: after a router IP change, make sure the console still points at an address that answers, and put the old values
 * back when the router came up with something else. The decision itself is [LanPending.decide] (unit tested); this file only reads the
 * note (root shell), probes the two addresses, reads the router and writes. Runs at boot (HostService) and, for a restart that does not
 * restart the app, started by the page's /api/net/lan-applied call. One check at a time; the note is deleted when the check is over.
 */
object LanRevert {
    private const val TAG = "LanRevert"
    private const val WAIT_MS = 120_000L
    private const val STEP_MS = 5_000L
    private val running = AtomicBoolean(false)

    /** null = root did not answer (try again); Pair(true, null) = root answered and there is no (valid) note. `; true` keeps a missing file from looking like a root failure. */
    private fun readNote(ctx: Context): Pair<Boolean, LanPending.Note?> =
        try { val r = RootShell.run(ctx, "cat ${LanPending.PATH} 2>/dev/null; true", 10_000); if (r.success) true to LanPending.parse(r.content) else false to null } catch (_: Exception) { false to null }

    private fun deleteNote(ctx: Context) {
        try { RootShell.run(ctx, "rm -f ${LanPending.PATH}", 10_000) } catch (e: Exception) { LogCatcher.log("WARNING", TAG, "Could not delete the pending note: ${e.message}") }
    }

    private fun pointAt(ctx: Context, ip: String) {
        val h = LanPending.hostWithIp(Prefs.zteHost(ctx), ip)
        if (h != Prefs.zteHost(ctx)) { Prefs.setZteHost(ctx, h); LogCatcher.log("INFO", TAG, "Router address for the console set to $h") }
        ZteClient.reset()
    }

    /** Called by POST /api/net/lan-applied (root-gated): only the new address named in the pending note is accepted. */
    fun applied(ctx: Context, ip: String): Boolean {
        if (!LanPending.appliedOk(readNote(ctx).second, ip)) return false
        pointAt(ctx, ip)
        start(ctx, 20_000L)
        return true
    }

    /** Runs the check on its own thread (it can wait up to two minutes); does nothing when no note exists or a check is already running. */
    fun start(ctx: Context, delayMs: Long) {
        val app = ctx.applicationContext
        Thread {
            try { if (delayMs > 0) Thread.sleep(delayMs); runCheck(app) }
            catch (e: InterruptedException) { Thread.currentThread().interrupt() }
            catch (e: Exception) { LogCatcher.log("ERROR", TAG, "Check failed: ${e.javaClass.simpleName}: ${e.message}") }
        }.apply { name = "lan-revert"; isDaemon = true }.start()
    }

    private fun runCheck(ctx: Context) {
        if (!running.compareAndSet(false, true)) return
        try {
            var got = readNote(ctx)
            var tries = 0
            while (!got.first && tries++ < 6) { Thread.sleep(10_000); got = readNote(ctx) }   // root may not be ready right after boot
            val note = got.second ?: return
            LogCatcher.log("INFO", TAG, "Pending router IP change ${note.old.ip} -> ${note.new.ip}: checking")
            val deadline = System.currentTimeMillis() + WAIT_MS
            while (true) {
                val newAns = ZteClient.answers(note.new.ip)
                var seen: LanPending.Seen? = null
                if (newAns) {
                    pointAt(ctx, note.new.ip)
                    seen = try { LanPending.seenFrom(ZteClient.call(ctx, "get", mapOf("multi_data" to "1", "cmd" to LanPending.READ_CMD))) } catch (_: Exception) { null }
                }
                val oldAns = !newAns && ZteClient.answers(note.old.ip)
                val over = System.currentTimeMillis() >= deadline
                when (LanPending.decide(note, System.currentTimeMillis(), newAns, seen, oldAns, over)) {
                    LanPending.Verdict.WAIT -> { Thread.sleep(STEP_MS); continue }
                    LanPending.Verdict.EXPIRED -> { LogCatcher.log("INFO", TAG, "The pending note is stale: deleted, nothing changed"); deleteNote(ctx) }
                    LanPending.Verdict.KEEP_NEW -> { pointAt(ctx, note.new.ip); LogCatcher.log("INFO", TAG, "The router answers at ${note.new.ip}: change kept"); deleteNote(ctx) }
                    LanPending.Verdict.USE_OLD -> { pointAt(ctx, note.old.ip); LogCatcher.log("WARNING", TAG, "Only ${note.old.ip} answers: the change did not take effect, console back on it"); deleteNote(ctx) }
                    LanPending.Verdict.GIVE_UP -> LogCatcher.log("WARNING", TAG, "Neither ${note.new.ip} nor ${note.old.ip} answers within the wait: nothing written; the note stays until it is stale")
                    LanPending.Verdict.REVERT -> {
                        LogCatcher.log("WARNING", TAG, "The router answers at ${note.new.ip} but not with the wanted values: putting ${note.old.ip} back")
                        try {
                            ZteClient.call(ctx, "set", LanPending.revertParams(note))
                            pointAt(ctx, note.old.ip)
                            LogCatcher.log("WARNING", TAG, "Old values sent; the router restarts and comes back on ${note.old.ip}")
                            deleteNote(ctx)
                        } catch (e: Exception) { LogCatcher.log("ERROR", TAG, "Could not put the old values back: ${e.message}. The note stays until it is stale.") }
                    }
                }
                return
            }
        } finally { running.set(false) }
    }
}

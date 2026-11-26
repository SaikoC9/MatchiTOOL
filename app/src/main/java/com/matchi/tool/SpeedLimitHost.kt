package com.matchi.tool

import android.content.Context
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

/**
 * The root side of the per-device speed limit: runs the scripts [SpeedLimit] builds, reads the result back, and keeps the saved
 * limits in [Prefs]. One lock covers every change, so the routes and the loop never write at the same time.
 * Blocking: worker or request thread only. See docs/LIMIT_SPEED.md.
 */
object SpeedLimitHost {
    private val lock = Any()
    private const val READ_MS = 15_000L
    private const val WRITE_MS = 30_000L

    class Outcome(val ok: Boolean, val message: String, val v6Note: String = "")
    /** One saved limit as the page shows it. [active] is null when the phone state could not be read or the device has no address yet. */
    class Row(val mac: String, val down: Int?, val up: Int?, val ip: String?, val online: Boolean, val active: Boolean?)
    class View(val rows: List<Row>, val lanUp: Boolean, val rootBusy: Boolean, val note: String)

    fun stored(ctx: Context): List<SpeedLimit.Entry> = SpeedLimit.decode(Prefs.speedLimits(ctx))
    private fun save(ctx: Context, list: List<SpeedLimit.Entry>) = Prefs.setSpeedLimits(ctx, SpeedLimit.encode(list))

    private fun readLive(ctx: Context): SpeedLimit.Live? {
        val r = try { RootShell.run(ctx, SpeedLimit.READ_SCRIPT, READ_MS) } catch (e: Exception) { Quiet.note("SpeedLimit.read", e); return null }
        return if (r.success && r.content.contains("--- root")) SpeedLimit.parseLive(r.content) else null
    }

    private fun runScript(ctx: Context, script: String): Outcome {
        val r = try { RootShell.run(ctx, script, WRITE_MS) } catch (e: Exception) { return Outcome(false, "root call failed: ${e.message}") }
        val c = r.content
        return when {
            c.contains("MATCHI_ROOT_BUSY") -> Outcome(false, "br0 already has another traffic setup; nothing was changed")
            c.contains("MATCHI_OK") -> Outcome(true, "ok", if (c.contains("MATCHI_V6")) c.lines().filter { it.isNotBlank() && it != "MATCHI_OK" }.take(4).joinToString("; ") else "")
            else -> {
                val errs = c.lines().filter { it.startsWith("MATCHI_ERR") }.take(3).joinToString("; ")
                Outcome(false, errs.ifBlank { c.trim().take(200).ifBlank { "root call failed" } })
            }
        }
    }

    /** Sets or clears one device's limit. [ipRaw] is only a check: the address comes from the phone's neighbour table. */
    fun set(ctx: Context, macRaw: String?, ipRaw: String?, limit: SpeedLimit.Limit): Outcome =
        synchronized(lock) { setLocked(ctx, macRaw, ipRaw, limit) }

    private fun setLocked(ctx: Context, macRaw: String?, ipRaw: String?, limit: SpeedLimit.Limit): Outcome {
        val mac = SpeedLimit.normalizeMac(macRaw) ?: return Outcome(false, "not a valid device MAC address")
        SpeedLimit.limitError(limit.down, limit.up)?.let { return Outcome(false, it) }
        val live = readLive(ctx) ?: return Outcome(false, "could not read the network state (is root granted?)")
        if (!live.lanUp) return Outcome(false, "the hotspot network (br0) is not up")
        if (live.rootBusy) return Outcome(false, "br0 already has another traffic setup; nothing was changed")
        val now = live.neigh[mac] ?: return Outcome(false, "this device is not on the network right now")
        val asked = ipRaw?.trim().orEmpty()
        if (asked.isNotEmpty() && asked != now) return Outcome(false, "the device now has address $now, not $asked; refresh the list")
        val octet = SpeedLimit.octetOf(now) ?: return Outcome(false, "address $now cannot be limited")
        val list = stored(ctx)
        val old = list.firstOrNull { it.mac == mac }
        val oldOctet = SpeedLimit.octetOf(old?.ip)
        if (oldOctet != null && oldOctet != octet) runScript(ctx, SpeedLimit.removeScript(listOf(oldOctet)))   // the device moved: drop what it left behind
        if (limit.none) {
            val out = runScript(ctx, SpeedLimit.removeScript(listOf(octet)))
            if (!out.ok) return out
            save(ctx, SpeedLimit.without(list, mac))
            LogCatcher.log("INFO", "SpeedLimit", "Limit removed for $mac ($now)")
            SpeedLimitLoop.sync(ctx)
            return Outcome(true, "unlimited")
        }
        val script = SpeedLimit.applyScript(now, limit, mac) ?: return Outcome(false, "address or value not valid")
        val out = runScript(ctx, script)
        val after = if (out.ok) readLive(ctx) else null
        if (!out.ok || after == null || !SpeedLimit.matches(limit, after, octet, v6 = true)) {
            runScript(ctx, SpeedLimit.removeScript(listOf(octet)))   // do not leave half a limit behind
            val why = when {
                !out.ok -> out.message
                out.v6Note.isNotEmpty() -> "the IPv6 rule was refused (${out.v6Note.take(160)}); the limit was removed again so IPv6 does not bypass it"
                else -> "the limit was set but reading it back did not match; it was removed again"
            }
            return Outcome(false, why)
        }
        save(ctx, SpeedLimit.upsert(list, SpeedLimit.Entry(mac, limit, now)))
        LogCatcher.log("INFO", "SpeedLimit", "Limit set for $mac ($now): down=${limit.down ?: "-"} up=${limit.up ?: "-"} KB/s")
        SpeedLimitLoop.sync(ctx)
        return Outcome(true, "ok")
    }

    /** Brings the phone in line with the saved limits (missing rules, moved devices). Returns what it did, for the log; null when nothing was saved. */
    fun reconcile(ctx: Context): String? = synchronized(lock) {
        val list = stored(ctx)
        if (list.isEmpty()) return@synchronized null
        val live = readLive(ctx) ?: return@synchronized "state not readable"
        val plan = SpeedLimit.plan(list, live)
        if (plan.apply.isEmpty() && plan.remove.isEmpty()) return@synchronized "nothing to do"
        var next = list
        val notes = ArrayList<String>()
        if (plan.remove.isNotEmpty()) {
            val out = runScript(ctx, SpeedLimit.removeScript(plan.remove))
            notes.add("removed ${plan.remove.size} stale: ${if (out.ok) "ok" else out.message}")
        }
        for (t in plan.apply) {
            val script = SpeedLimit.applyScript(t.ip, t.limit, t.mac) ?: continue
            val out = runScript(ctx, script)
            if (out.ok) next = SpeedLimit.upsert(next, SpeedLimit.Entry(t.mac, t.limit, t.ip))
            notes.add("${t.mac} at ${t.ip}: ${if (out.ok) "applied" else out.message}")
        }
        if (next != list) save(ctx, next)
        val text = notes.joinToString("; ")
        LogCatcher.log("INFO", "SpeedLimit", "Reconcile: $text")
        text
    }

    /** What the Devices tab shows: the saved limits, whether each is really on the phone, after one reconcile. */
    fun view(ctx: Context): View {
        reconcile(ctx)
        val list = stored(ctx)
        val live = readLive(ctx)
        val rows = list.map { e ->
            val now = live?.neigh?.get(e.mac)
            val ip = now ?: e.ip
            val octet = SpeedLimit.octetOf(ip)
            val active = if (live == null || octet == null) null else SpeedLimit.matches(e.limit, live, octet, v6 = true)
            Row(e.mac, e.limit.down, e.limit.up, ip, now != null, active)
        }
        val note = when {
            live == null -> "the network state could not be read"
            !live.lanUp -> "the hotspot network (br0) is not up; limits are applied when it comes back"
            live.rootBusy -> "br0 already has another traffic setup; limits are not applied"
            else -> ""
        }
        return View(rows, live?.lanUp ?: false, live?.rootBusy ?: false, note)
    }
}

/**
 * Keeps the saved limits on the phone. The rules are lost on a reboot and when the hotspot or USB tether restarts, so while any
 * limit is saved this looks every 30 s (one short root read) and puts back what is missing. With no saved limit it does not run
 * and asks for no root. Started with the host (so after a boot too) and when a limit is set.
 */
object SpeedLimitLoop {
    private const val EVERY_S = 30L
    private var pool: ScheduledExecutorService? = null

    @Synchronized fun sync(ctx: Context) {
        val app = ctx.applicationContext
        if (SpeedLimitHost.stored(app).isEmpty()) { stop(); return }
        if (pool != null) return
        val p = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "MatchiSpeedLimit").also { it.isDaemon = true } }
        pool = p
        p.scheduleWithFixedDelay({ tick(app) }, 5, EVERY_S, TimeUnit.SECONDS)
    }

    private fun tick(app: Context) {
        try {
            if (SpeedLimitHost.stored(app).isEmpty()) { stop(); return }
            SpeedLimitHost.reconcile(app)
        } catch (e: Exception) { Quiet.note("SpeedLimitLoop.tick", e) }
    }

    @Synchronized fun stop() {
        pool?.shutdown()
        pool = null
    }
}

package com.matchi.tool

import fi.iki.elonen.NanoHTTPD.IHTTPSession
import fi.iki.elonen.NanoHTTPD.Response
import org.json.JSONObject
import java.io.File

/*
 * Routes of the plugin guard (matchi-guard, tools/guard).
 *   GET  /api/guard/report  open, cheap: reads one small file the program wrote; no root call, no process scan.
 *   POST /api/guard/state   {"on":true|false}  behind rootGate: starts or stops the program and remembers the choice.
 */

private fun WebServer.guardReportFile(): File = File(File(ctx.filesDir, GuardHost.REPORT_DIR), GuardHost.REPORT_NAME)

/** What GET /api/guard/report answers: the setting, whether the program is installed and intact, whether it is alive, and the last report. */
internal fun WebServer.guardState(): JSONObject {
    val out = JSONObject().put("on", Prefs.guardOn(ctx)).put("interval", Prefs.guardInterval(ctx)).put("available", BinaryCheck.problem(ctx, GuardHost.BINARY) == null)
    val f = guardReportFile()
    var report: JSONObject? = null
    try {
        if (f.isFile && f.length() in 1..GuardHost.REPORT_MAX) report = JSONObject(f.readText())
    } catch (e: Exception) { Quiet.note("GuardRoutes.report", e) }
    val ts = report?.optLong("ts", 0L) ?: 0L
    val now = System.currentTimeMillis() / 1000
    out.put("running", report != null && GuardHost.fresh(ts, now, report.optInt("interval_s", GuardHost.INTERVAL_S)))
    out.put("now", now)
    if (report != null) out.put("report", report)
    return out
}

/** Starts or stops the program as root. Returns null on success, otherwise the reason. */
internal fun WebServer.guardApply(on: Boolean): String? {
    val dir = ctx.filesDir.absolutePath
    if (on) {
        BinaryCheck.problem(ctx, GuardHost.BINARY)?.let { return it }
        File(ctx.filesDir, GuardHost.REPORT_DIR).mkdirs()
    }
    val script = (if (on) GuardHost.startScript(dir, Prefs.guardInterval(ctx)) else GuardHost.stopScript(dir)) ?: return "the files folder path is not in the expected form"
    val r = RootShell.run(ctx, script, 15_000)
    return if (r.success) null else r.content.ifBlank { "root command failed" }.take(240)
}

/** POST /api/guard/state {"on":true|false, "interval":1|5|10 (optional)}. The caller has passed rootGate. A new interval is saved and, when the guard is on, applied at once. */
internal fun WebServer.guardSet(s: IHTTPSession): Response {
    val req = body(s)
    if (!req.has("on") || req.opt("on") !is Boolean)
        return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "on (true or false) is required"))
    val on = req.getBoolean("on")
    var interval: Int? = null
    if (req.has("interval")) {
        val v = req.opt("interval")
        if (v !is Int || !GuardHost.validInterval(v))
            return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "interval must be one of ${GuardHost.INTERVALS.joinToString(", ")} (seconds)"))
        interval = v
    }
    auditShell(s.remoteIpAddress ?: "?", "guard on=$on interval=${interval ?: "-"}", "guard-state")
    val old = Prefs.guardInterval(ctx)
    if (interval != null) Prefs.setGuardInterval(ctx, interval)
    val why = guardApply(on)
    if (why != null) { Prefs.setGuardInterval(ctx, old); return json(Response.Status.CONFLICT, JSONObject().put("error", why)) }
    Prefs.setGuardOn(ctx, on)
    return json(Response.Status.OK, guardState().put("ok", true))
}

/**
 * Called once from the WebServer constructor's worker thread: bring the program back after a host restart or a reboot when the owner
 * switched it on. Right after a boot root may not be ready yet (the root manager is still starting), so a failed start is tried again
 * after 20, 60 and 120 s instead of leaving the guard off until the person switches it off and on.
 */
internal fun WebServer.guardAutostart() {
    for ((i, wait) in longArrayOf(0, 20_000, 60_000, 120_000).withIndex()) {
        if (wait > 0) try { Thread.sleep(wait) } catch (_: InterruptedException) { return }
        if (!Prefs.guardOn(ctx)) return   // switched off meanwhile
        val why = guardApply(true) ?: return
        LogCatcher.log("WARNING", "Guard", "matchi-guard did not start (try ${i + 1} of 4): $why")
    }
}

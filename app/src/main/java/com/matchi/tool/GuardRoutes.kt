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
    val out = JSONObject().put("on", Prefs.guardOn(ctx)).put("available", BinaryCheck.problem(ctx, GuardHost.BINARY) == null)
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
    val script = (if (on) GuardHost.startScript(dir) else GuardHost.stopScript(dir)) ?: return "the files folder path is not in the expected form"
    val r = RootShell.run(ctx, script, 15_000)
    return if (r.success) null else r.content.ifBlank { "root command failed" }.take(240)
}

/** POST /api/guard/state {"on":true|false}. The caller has passed rootGate. */
internal fun WebServer.guardSet(s: IHTTPSession): Response {
    val req = body(s)
    if (!req.has("on") || req.opt("on") !is Boolean)
        return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "on (true or false) is required"))
    val on = req.getBoolean("on")
    auditShell(s.remoteIpAddress ?: "?", "guard on=$on", "guard-state")
    val why = guardApply(on)
    if (why != null) return json(Response.Status.CONFLICT, JSONObject().put("error", why))
    Prefs.setGuardOn(ctx, on)
    return json(Response.Status.OK, guardState().put("ok", true))
}

/** Called once from the WebServer constructor's worker thread: bring the program back after a host restart when the owner switched it on. */
internal fun WebServer.guardAutostart() {
    if (!Prefs.guardOn(ctx)) return
    guardApply(true)?.let { LogCatcher.log("WARNING", "Guard", "matchi-guard did not start: $it") }
}

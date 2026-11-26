package com.matchi.tool

import fi.iki.elonen.NanoHTTPD.IHTTPSession
import fi.iki.elonen.NanoHTTPD.Method
import fi.iki.elonen.NanoHTTPD.Response
import org.json.JSONArray
import org.json.JSONObject

// "Wipe everything when MatchiTOOL is uninstalled": the switch, the status and the read-only list in Settings (Phase 6). See Reaper.kt,
// ReaperSettings.kt and docs/UNINSTALL_WIPE.md. Each route function returns null when the path is not its own.

private fun WebServer.reaperInfoJson(): Response {
    val groups = JSONArray()
    for (g in ReaperSettings.removed()) groups.put(JSONObject().put("title", g.title).put("lines", JSONArray(g.lines)))
    return json(Response.Status.OK, JSONObject().put("enabled", Reaper.enabled(ctx))
        .put("onText", ReaperSettings.ON_TEXT).put("offText", ReaperSettings.OFF_TEXT)
        .put("removed", groups).put("notRestored", ReaperSettings.NOT_RESTORED).put("pluginNote", ReaperSettings.PLUGIN_NOTE))
}

internal fun WebServer.routeReaper(s: IHTTPSession, uri: String): Response? = when {
    // The saved switch and the fixed texts and list. Reads one preference and starts nothing: no root call.
    uri == "/api/reaper" && s.method == Method.GET -> reaperInfoJson()
    // The live state (installed, version, running, boot script) is one root call, so it has the same fresh sign-in as the other root reads.
    uri == "/api/reaper/status" && s.method == Method.GET -> rootGate(s) ?: json(Response.Status.OK, Reaper.status(ctx))
    // The switch installs or removes a root watcher and a boot script, so it needs the fresh sign-in. The new state is saved only when the root call worked.
    uri == "/api/reaper" && s.method == Method.POST -> rootGate(s) ?: run {
        val req = body(s)
        if (!req.has("enabled") || req.opt("enabled") !is Boolean) throw IllegalArgumentException("enabled must be true or false")
        val on = req.getBoolean("enabled")
        auditShell(s.remoteIpAddress ?: "?", "reaper " + (if (on) "on" else "off"), "reaper-switch")
        val res = Reaper.setEnabled(ctx, on)
        json(if (res.optBoolean("ok")) Response.Status.OK else Response.Status.INTERNAL_ERROR, res)
    }
    else -> null
}

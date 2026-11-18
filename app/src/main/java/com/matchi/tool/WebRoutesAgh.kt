package com.matchi.tool

import fi.iki.elonen.NanoHTTPD.IHTTPSession
import fi.iki.elonen.NanoHTTPD.Method
import fi.iki.elonen.NanoHTTPD.Response
import org.json.JSONObject

// AdGuard Home web page door (see AghDoor.kt). Each route function returns null when the path is not its own.

internal fun WebServer.routeAgh(s: IHTTPSession, uri: String): Response? = when {
    // Open (or, with {"close":true}, close) port 3000 for the address of the caller. Needs the fresh sign-in, so a stale session cannot open it.
    uri == "/api/agh/door" && s.method == Method.POST -> rootGate(s) ?: run {
        val req = body(s)
        val ip = s.remoteIpAddress ?: "?"
        if (isLoopbackIp(ip)) return@run json(Response.Status.OK, JSONObject().put("ok", true).put("local", true))   // this device reaches port 3000 over loopback, no rule needed
        if (req.optBoolean("close", false)) {
            AghDoor.close(ctx, ip)
            auditShell(ip, "agh-door close", "agh-door")
            return@run json(Response.Status.OK, JSONObject().put("ok", true))
        }
        val why = AghDoor.open(ctx, ip, sessionToken(s))
        auditShell(ip, "agh-door open " + (why ?: "ok"), "agh-door")
        if (why != null) json(Response.Status.CONFLICT, JSONObject().put("ok", false).put("error", why))
        else json(Response.Status.OK, JSONObject().put("ok", true).put("minutes", (AghDoor.DOOR_MS / 60000).toInt()))
    }
    else -> null
}

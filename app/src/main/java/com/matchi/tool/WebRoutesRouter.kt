package com.matchi.tool

import fi.iki.elonen.NanoHTTPD.IHTTPSession
import fi.iki.elonen.NanoHTTPD.Method
import fi.iki.elonen.NanoHTTPD.Response
import fi.iki.elonen.NanoHTTPD.newFixedLengthResponse
import org.json.JSONObject

// Routes that talk to the ZTE router: the get/set proxy (/api/zte), the router page fetch, the saved router address and password.
// Split out of WebServer.kt (route groups are extension functions; helpers moved with them). Each route function
// returns null when the path is not one of its own, so WebServer.route() can ask the next group.

internal fun WebServer.routeRouter(s: IHTTPSession, uri: String): Response? = when {
    // Proxy to the ZTE web API: {"op":"get"|"set","params":{"cmd":"signalbar",...}}
    uri == "/api/zte" && s.method == Method.POST -> run {
        val req = body(s)
        val op = req.optString("op")
        if (op != "get" && op != "set") throw IllegalArgumentException("op must be get or set")
        val po = req.optJSONObject("params") ?: JSONObject()
        val p = LinkedHashMap<String, String>()
        for (k in po.keys()) p[k] = po.optString(k)
        // Positive list: a set call needs the fresh sign-in unless its goformId is in NetGoform.OPEN_SET (band lock, cell lock, network mode, performance mode, SMS). Reads stay open.
        if (op == "set" && NetGoform.needsGate(p)) rootGate(s)?.let { return@run it }
        val raw = ZteClient.call(ctx, op, p, req.optInt("retry", 0).coerceIn(0, 2))
        val parsed: Any = try { JSONObject(raw) } catch (_: Exception) { raw }
        json(Response.Status.OK, JSONObject().put("success", true).put("data", parsed).put("info", if (op == "set") ZteClient.lastInfo else ""))
    }
    // Network tools: the address this request comes from, so the Devices tab can hide "Block" on the row of the device being used. Read only.
    uri == "/api/net/whoami" && s.method == Method.GET -> json(Response.Status.OK, JSONObject().put("ip", s.remoteIpAddress ?: ""))
    // After a router IP change the page tells the host the new address. Only the address named in the pending note (written by the
    // page's root shell just before the change) is accepted; the host then points the router client at it and checks the router after the restart.
    uri == "/api/net/lan-applied" && s.method == Method.POST -> rootGate(s) ?: run {
        val ip = body(s).optString("ip").trim()
        if (!LanRevert.applied(ctx, ip)) throw IllegalArgumentException("no pending router IP change for that address")
        json(Response.Status.OK, JSONObject().put("ok", true))
    }
    uri == "/api/zte/page" && s.method == Method.POST ->
        json(Response.Status.OK, JSONObject().put("ok", true).put("text", ZteClient.fetchPage(ctx, body(s).optString("path"))))
    uri == "/api/zte/config" && s.method == Method.GET ->
        json(Response.Status.OK, JSONObject().put("host", Prefs.zteHost(ctx)).put("passwordSet", Prefs.ztePass(ctx).isNotEmpty())
            .put("passwordStorageReset", Prefs.passwordStorageReset(ctx)).put("passwordStoredInClear", Prefs.passwordStoredInClear(ctx)))
    // C1 (1.4.3): changing the router address or password needs the fresh sign-in AND the current password again (same lockout as /api/login). The router
    // password is also the console password unless a separate one is set, and the address decides where the router login is sent, so a stale, stolen or plugin-held
    // session must not be able to change either one silently. A change that changes nothing needs no password.
    uri == "/api/zte/config" && s.method == Method.POST -> rootGate(s) ?: run {
        val req = body(s)
        var routerChanged = false
        val newHost = if (req.has("host")) req.optString("host").trim() else null
        val newPass = if (req.has("password")) req.optString("password") else null
        val wouldChange = (newHost != null && newHost != Prefs.zteHost(ctx)) || (newPass != null && newPass != Prefs.ztePass(ctx))
        if (wouldChange && Prefs.hasAdminPassword(ctx)) {
            val ip = s.remoteIpAddress ?: "?"
            passwordGate(s, req.optString("current").take(200), "Current password is wrong (send it as \"current\")")?.let { return@run it }
            auditShell(ip, "zte-config host=" + (newHost != null) + " password=" + (newPass != null), "zte-config")
        }
        if (req.has("host")) {
            val host = req.optString("host").trim()
            val hostChanged = host != Prefs.zteHost(ctx)
            Prefs.setZteHost(ctx, host)   // throws on an invalid host before anything is changed
            if (hostChanged) routerChanged = true
        }
        if (req.has("password")) {
            val changed = req.optString("password") != Prefs.ztePass(ctx)
            if (!Prefs.setZtePass(ctx, req.optString("password")))
                throw IllegalArgumentException("The Android key store could not encrypt the password, so it was NOT saved")
            if (changed) {
                routerChanged = true
                Sessions.revokeAllExcept(ctx, sessionToken(s)); AghDoor.sweepAsync(ctx)   // other sessions end; this one stays
            }
        }
        // Drop the cached router session, the 60 s "login failed recently" cool-down and the detected port, so the new
        // password / address is used on the very next router call instead of after the cool-down.
        if (routerChanged) ZteClient.reset()
        json(Response.Status.OK, JSONObject().put("ok", true))
    }
    else -> null
}

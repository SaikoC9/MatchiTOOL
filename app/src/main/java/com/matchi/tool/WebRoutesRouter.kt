package com.matchi.tool

import fi.iki.elonen.NanoHTTPD.IHTTPSession
import fi.iki.elonen.NanoHTTPD.Method
import fi.iki.elonen.NanoHTTPD.Response
import fi.iki.elonen.NanoHTTPD.newFixedLengthResponse
import org.json.JSONObject

// Routes that talk to the ZTE router: the get/set proxy, UFI goform and proxy routes, cookie, saved router address.
// Split out of WebServer.kt (route groups are extension functions; helpers moved with them). Each route function
// returns null when the path is not one of its own, so WebServer.route() can ask the next group.

/**
 * Parameters of a forwarded router request: the query string, plus for a POST the body (a JSON object, or a form when it
 * does not start with "{"). At most 64 KB of body is read; a missing Content-Length means an empty body.
 */
internal fun WebServer.gatewayParams(s: IHTTPSession): Map<String, String> {
    val out = LinkedHashMap<String, String>()
    for ((k, v) in s.parameters) v.firstOrNull()?.let { out[k] = it }
    if (s.method == Method.POST) {
        val len = s.headers["content-length"]?.trim()?.toIntOrNull() ?: 0
        if (len < 0 || len > 65536) throw IllegalArgumentException("request body too large")
        if (len > 0) {
            val buf = ByteArray(len)
            var off = 0
            while (off < len) { val n = s.inputStream.read(buf, off, len - off); if (n < 0) break; off += n }
            val text = String(buf, 0, off, Charsets.UTF_8).trim()
            if (text.startsWith("{")) { val o = JSONObject(text); for (k in o.keys()) out[k] = o.optString(k) }
            else out.putAll(GatewayProxy.parseForm(text))
        }
    }
    return out
}

internal fun WebServer.routeRouter(s: IHTTPSession, uri: String): Response? = when {
    // Proxy to the ZTE web API: {"op":"get"|"set","params":{"cmd":"signalbar",...}}
    uri == "/api/zte" && s.method == Method.POST -> run {
        val req = body(s)
        val op = req.optString("op")
        if (op != "get" && op != "set") throw IllegalArgumentException("op must be get or set")
        val po = req.optJSONObject("params") ?: JSONObject()
        val p = LinkedHashMap<String, String>()
        for (k in po.keys()) p[k] = po.optString(k)
        // Network tools (Wi-Fi, devices, APN, LAN / DHCP, MTU / MSS, mobile data): these writes can cut the person off, so they need the fresh sign-in like /api/proxy POST. Reads and the radio calls stay open.
        if (op == "set" && NetGoform.needsGate(p)) rootGate(s)?.let { return@run it }
        val raw = ZteClient.call(ctx, op, p, req.optInt("retry", 0).coerceIn(0, 2))
        val parsed: Any = try { JSONObject(raw) } catch (_: Exception) { raw }
        json(Response.Status.OK, JSONObject().put("success", true).put("data", parsed).put("info", if (op == "set") ZteClient.lastInfo else ""))
    }
    // UFI-TOOLS router routes. The target is always the saved gateway (ZteClient never takes a host from a request).
    // goform: GET query = router "get"; POST (form or JSON body) = router "set" with the AD token added, as /api/zte does.
    uri.startsWith("/api/goform/") && (s.method == Method.GET || s.method == Method.POST) -> run {
        val name = uri.removePrefix("/api/goform/")
        GatewayProxy.goformPath(name) ?: throw IllegalArgumentException("unknown goform endpoint")
        val p = GatewayProxy.params(gatewayParams(s)) ?: throw IllegalArgumentException("too many or too long parameters")
        val isSet = name == "goform_set_cmd_process"
        if (isSet != (s.method == Method.POST)) throw IllegalArgumentException(if (isSet) "goform_set_cmd_process needs POST" else "goform_get_cmd_process needs GET")
        // Same rule as /api/zte: a network-changing goformId needs the fresh sign-in; every other call and every read stays open.
        if (isSet && NetGoform.needsGate(p)) rootGate(s)?.let { return@run it }
        val raw = ZteClient.call(ctx, if (isSet) "set" else "get", p.filterKeys { it != "isTest" })
        harden(newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", raw))
    }
    // 1.4.0 security pass: a POST can change router settings through any path on the router, with the router session this
    // app holds, so it needs the same fresh sign-in as the other root-capable routes. A GET stays open (read-only plugins).
    uri.startsWith("/api/proxy/") && (s.method == Method.GET || s.method == Method.POST) -> run {
        if (s.method == Method.POST) rootGate(s)?.let { return@run it }
        val path = GatewayProxy.proxyPath(uri.removePrefix("/api/proxy/")) ?: throw IllegalArgumentException("bad proxy path")
        val p = GatewayProxy.params(gatewayParams(s)) ?: throw IllegalArgumentException("too many or too long parameters")
        val r = ZteClient.proxy(ctx, s.method.name, path, p)
        harden(newFixedLengthResponse(Response.Status.OK, "text/plain; charset=utf-8", r.body)).also { it.addHeader("X-Router-Status", r.code.toString()) }
    }
    // Router session cookie. Root-gated: whoever holds it is signed in to the router. Shapes as in UFI's server: {"cookie":"..."} and {"result":true}.
    uri == "/api/get_cookie" && s.method == Method.GET -> rootGate(s) ?: json(Response.Status.OK, JSONObject().put("cookie", ZteClient.sessionCookie()))
    uri == "/api/set_cookie" && s.method == Method.POST -> rootGate(s) ?: run {
        val c = body(s).optString("cookie")
        if (!GatewayProxy.cookieOk(c)) throw IllegalArgumentException("cookie must be printable ASCII, at most 2 KB")
        auditShell(s.remoteIpAddress ?: "?", "set_cookie len=" + c.length, "set_cookie")
        ZteClient.setSessionCookie(c)
        json(Response.Status.OK, JSONObject().put("result", true))
    }
    uri == "/api/zte/page" && s.method == Method.POST ->
        json(Response.Status.OK, JSONObject().put("ok", true).put("text", ZteClient.fetchPage(ctx, body(s).optString("path"))))
    uri == "/api/zte/config" && s.method == Method.GET ->
        json(Response.Status.OK, JSONObject().put("host", Prefs.zteHost(ctx)).put("passwordSet", Prefs.ztePass(ctx).isNotEmpty())
            .put("passwordStorageReset", Prefs.passwordStorageReset(ctx)).put("passwordStoredInClear", Prefs.passwordStoredInClear(ctx)))
    uri == "/api/zte/config" && s.method == Method.POST -> {
        val req = body(s)
        var routerChanged = false
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
                Sessions.revokeAllExcept(ctx, sessionToken(s))   // other sessions end; this one stays
            }
        }
        // Drop the cached router session, the 60 s "login failed recently" cool-down and the detected port, so the new
        // password / address is used on the very next router call instead of after the cool-down.
        if (routerChanged) ZteClient.reset()
        json(Response.Status.OK, JSONObject().put("ok", true))
    }
    else -> null
}

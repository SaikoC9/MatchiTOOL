package com.matchi.tool

import fi.iki.elonen.NanoHTTPD.IHTTPSession
import fi.iki.elonen.NanoHTTPD.Method
import fi.iki.elonen.NanoHTTPD.Response
import org.json.JSONArray
import org.json.JSONObject

// Sign-out, console password and network/HTTP security switches.
// Split out of WebServer.kt (route groups are extension functions; helpers moved with them). Each route function
// returns null when the path is not one of its own, so WebServer.route() can ask the next group.

internal fun WebServer.routeAuth(s: IHTTPSession, uri: String): Response? = when {
    uri == "/api/logout" && s.method == Method.POST -> {
        drainBody(s)
        Sessions.revoke(ctx, sessionToken(s))
        json(Response.Status.OK, JSONObject().put("ok", true)).also { it.addHeader("Set-Cookie", clearSessionCookieHeader(Tls.active)) }
    }
    uri == "/api/console/password" && s.method == Method.GET ->
        json(Response.Status.OK, JSONObject().put("separate", Prefs.hasConsolePassword(ctx)).put("minLength", Prefs.MIN_CONSOLE_PW))
    uri == "/api/console/password" && s.method == Method.POST -> run {
        val req = body(s, MAX_LOGIN_BODY)
        // The current sign-in password is required again, so a stolen session cannot take the console over. Guesses count
        // toward the same lockout as /api/login, otherwise a stolen session could try passwords here without any limit.
        val pwIp = s.remoteIpAddress ?: "?"
        val pwLoop = isLoopbackIp(pwIp)
        val pwWait = guard.retryAfterMs(pwIp, pwLoop)
        if (pwWait > 0) {
            val secs = (pwWait + 999) / 1000
            return@run json(tooMany, JSONObject().put("error", "too many bad attempts, wait ${if (secs >= 120) "${(secs + 59) / 60} minutes" else "$secs s"}"))
                .also { it.addHeader("Retry-After", secs.toString()) }
        }
        if (!Prefs.checkAdminPassword(ctx, req.optString("current").take(200))) {
            guard.failed(pwIp, pwLoop)
            throw IllegalArgumentException("Current password is wrong")
        }
        Prefs.setConsolePassword(ctx, req.optString("password").take(200))   // empty = go back to the router password
        Sessions.revokeAllExcept(ctx, sessionToken(s))
        auditShell(s.remoteIpAddress ?: "?", "console-password " + (if (Prefs.hasConsolePassword(ctx)) "set" else "removed"), "console-password")
        json(Response.Status.OK, JSONObject().put("ok", true).put("separate", Prefs.hasConsolePassword(ctx)))
    }
    // Network rules for plugins. Reading is open to any signed-in page. Changing needs the sign-in password again (same lockout as
    // /api/login), so a plugin that holds the session token cannot add its own host or switch the filter off.
    uri == "/api/security/net" && s.method == Method.GET ->
        json(Response.Status.OK, JSONObject().put("strict", Prefs.netStrict(ctx)).put("defaults", JSONArray(NetPolicy.DEFAULT_HOSTS)).put("extra", JSONArray(Prefs.netHosts(ctx))))
    uri == "/api/security/net" && s.method == Method.POST -> rootGate(s) ?: run {
        val req = body(s)
        val ip = s.remoteIpAddress ?: "?"
        val loop = isLoopbackIp(ip)
        val wait = guard.retryAfterMs(ip, loop)
        if (wait > 0) {
            val secs = (wait + 999) / 1000
            return@run json(tooMany, JSONObject().put("error", "too many bad attempts, wait $secs s")).also { it.addHeader("Retry-After", secs.toString()) }
        }
        if (!Prefs.checkAdminPassword(ctx, req.optString("password").take(200))) {
            guard.failed(ip, loop)
            throw IllegalArgumentException("Password is wrong")
        }
        if (req.has("strict")) Prefs.setNetStrict(ctx, req.optBoolean("strict", true))
        val bad = JSONArray()
        if (req.has("hosts")) {
            val arr = req.optJSONArray("hosts") ?: throw IllegalArgumentException("hosts must be an array")
            val raw = (0 until arr.length()).map { arr.optString(it) }
            for (r in raw) if (r.isNotBlank() && NetPolicy.cleanEntry(r) == null) bad.put(r.take(100))
            Prefs.setNetHosts(ctx, raw)
        }
        auditShell(ip, "net-policy strict=" + Prefs.netStrict(ctx) + " hosts=" + Prefs.netHosts(ctx).joinToString(","), "net-policy")
        json(Response.Status.OK, JSONObject().put("ok", true).put("strict", Prefs.netStrict(ctx)).put("extra", JSONArray(Prefs.netHosts(ctx))).put("rejected", bad))
    }
    // "Root over HTTP" switch. Not behind rootGate on purpose: it must be reachable when HTTPS failed, otherwise nobody could ever turn it on.
    // It needs a recent sign-in AND the password again (same lockout as /api/login).
    uri == "/api/security/http" && s.method == Method.GET ->
        json(Response.Status.OK, JSONObject().put("allowRootOverHttp", Prefs.rootOverHttp(ctx)).put("tls", Tls.active))
    uri == "/api/security/http" && s.method == Method.POST -> run {
        val req = body(s)
        val ip = s.remoteIpAddress ?: "?"
        val loop = isLoopbackIp(ip)
        if (!RootGate.freshEnough(Sessions.ageMs(ctx, sessionToken(s)), SHELL_MAX_SESSION_MS))
            return@run json(Response.Status.FORBIDDEN, JSONObject().put("code", "reauth").put("error", "Session too old - sign in again"))
        val wait = guard.retryAfterMs(ip, loop)
        if (wait > 0) {
            val secs = (wait + 999) / 1000
            return@run json(tooMany, JSONObject().put("error", "too many bad attempts, wait $secs s")).also { it.addHeader("Retry-After", secs.toString()) }
        }
        if (!Prefs.checkAdminPassword(ctx, req.optString("password").take(200))) {
            guard.failed(ip, loop)
            throw IllegalArgumentException("Password is wrong")
        }
        Prefs.setRootOverHttp(ctx, req.optBoolean("allow", false))
        auditShell(ip, "root-over-http " + Prefs.rootOverHttp(ctx), "net-policy")
        json(Response.Status.OK, JSONObject().put("ok", true).put("allowRootOverHttp", Prefs.rootOverHttp(ctx)))
    }
    else -> null
}

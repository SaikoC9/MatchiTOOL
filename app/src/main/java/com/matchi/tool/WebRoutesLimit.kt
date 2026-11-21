package com.matchi.tool

import fi.iki.elonen.NanoHTTPD.IHTTPSession
import fi.iki.elonen.NanoHTTPD.Method
import fi.iki.elonen.NanoHTTPD.Response
import org.json.JSONArray
import org.json.JSONObject

// Per-device speed limit: the list of saved limits and the call that sets or clears one. See SpeedLimit.kt and docs/LIMIT_SPEED.md.
// Each route function returns null when the path is not its own.

private fun WebServer.limitsJson(): Response {
    val v = SpeedLimitHost.view(ctx)
    val rows = JSONArray()
    for (r in v.rows) {
        rows.put(JSONObject().put("mac", r.mac).put("down", r.down ?: JSONObject.NULL).put("up", r.up ?: JSONObject.NULL)
            .put("ip", r.ip ?: JSONObject.NULL).put("online", r.online).put("active", r.active ?: JSONObject.NULL))
    }
    return json(Response.Status.OK, JSONObject().put("success", true).put("lanUp", v.lanUp).put("rootBusy", v.rootBusy)
        .put("note", v.note).put("minKbps", SpeedLimit.MIN_KBPS).put("maxKbps", SpeedLimit.MAX_KBPS).put("limits", rows))
}

/** A whole number of KB/s, or null for a missing, null or empty value (= Unlimited). */
private fun limitKb(req: JSONObject, key: String): Int? {
    val v = req.opt(key)
    return when {
        v == null || v == JSONObject.NULL -> null
        v is Number -> {
            val d = v.toDouble()
            if (d != Math.floor(d) || d < 0 || d > 1_000_000_000) throw IllegalArgumentException("$key must be a whole number of KB/s")
            d.toInt()
        }
        v is String -> if (v.isBlank()) null else v.trim().toIntOrNull() ?: throw IllegalArgumentException("$key must be a whole number of KB/s")
        else -> throw IllegalArgumentException("$key must be a whole number of KB/s")
    }
}

internal fun WebServer.routeLimit(s: IHTTPSession, uri: String): Response? = when {
    // Reads the live tc state as root and puts back saved limits that are missing, so it needs the fresh sign-in like the change below.
    uri == "/api/net/limits" && s.method == Method.GET -> rootGate(s) ?: limitsJson()
    // Sets (or, with both values empty, clears) one device's limit. The address is taken from the phone, not from the request.
    uri == "/api/net/limit" && s.method == Method.POST -> rootGate(s) ?: run {
        val req = body(s)
        val limit = SpeedLimit.Limit(limitKb(req, "down"), limitKb(req, "up"))
        val out = SpeedLimitHost.set(ctx, req.optString("mac"), req.optString("ip"), limit)
        if (out.ok) limitsJson()
        else json(Response.Status.OK, JSONObject().put("success", false).put("error", out.message))
    }
    else -> null
}

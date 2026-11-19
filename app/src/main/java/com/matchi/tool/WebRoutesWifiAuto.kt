package com.matchi.tool

import fi.iki.elonen.NanoHTTPD.IHTTPSession
import fi.iki.elonen.NanoHTTPD.Method
import fi.iki.elonen.NanoHTTPD.Response
import org.json.JSONObject

// "Turn Wi-Fi off while USB tethering is on": the switch and its status line in the Network window (Wi-Fi tab). See WifiAutoLoop.kt.
// Each route function returns null when the path is not its own.

private fun WebServer.wifiAutoJson(): Response {
    val st = WifiAutoLoop.status(ctx)
    return json(Response.Status.OK, JSONObject().put("enabled", st.enabled).put("passwordSaved", st.passwordSaved)
        .put("running", st.running).put("status", st.line))
}

internal fun WebServer.routeWifiAuto(s: IHTTPSession, uri: String): Response? = when {
    // Status only: reads the saved switch and what the last look saw. Starts nothing, asks neither the router nor root.
    uri == "/api/wifiauto" && s.method == Method.GET -> wifiAutoJson()
    // Turning the switch on or off changes what the router does with its Wi-Fi, so it needs the fresh sign-in.
    uri == "/api/wifiauto" && s.method == Method.POST -> rootGate(s) ?: run {
        val req = body(s)
        if (!req.has("enabled") || req.opt("enabled") !is Boolean) throw IllegalArgumentException("enabled must be true or false")
        Prefs.setWifiAutoTether(ctx, req.getBoolean("enabled"))
        WifiAutoLoop.sync(ctx)
        wifiAutoJson()
    }
    else -> null
}

package com.matchi.tool

import fi.iki.elonen.NanoHTTPD.IHTTPSession
import fi.iki.elonen.NanoHTTPD.Method
import fi.iki.elonen.NanoHTTPD.Response
import org.json.JSONObject
import java.io.File

// Generic web gate (see WebGate.kt and WebGateProxy.kt). The declaration is read from the installed plugin file, never from the request.

/** The AdGuard Home gate as plugin 0.9.7 knew it (it has no @matchi-gate line). Used only by the old route /api/agh/gate. */
internal val LEGACY_ADGUARD_GATE = GateDecl("adguard", 3000, "/control/logout", GATE_IDLE_DEFAULT_S, false)

/**
 * The declaration of gate [gateName]: from the ENABLED plugin files (.js) whose approved file is not marked changed. Exactly one plugin may declare it.
 * Returns (declaration, null) or (null, reason).
 */
internal fun WebServer.gateDeclFor(gateName: String): Pair<GateDecl?, String?> {
    val off = Prefs.disabled(ctx)
    val records = Prefs.pluginRecords(ctx)
    val hits = ArrayList<Pair<String, GateDecl>>()
    var problem: String? = null
    val files = pluginDir.listFiles { f -> f.isFile && f.name.endsWith(".js") && f.name !in off }?.sortedBy { it.name }.orEmpty()
    for (f in files) {
        val bytes = try { f.readBytes() } catch (_: Exception) { continue }
        val code = String(bytes, Charsets.UTF_8)
        if (!code.contains("@matchi-gate")) continue
        val r = parseGateDecl(code, Prefs.PORT)
        if (r.decl == null) { if (r.error != null && code.contains("name=$gateName")) problem = "${f.name}: ${r.error}"; continue }
        if (r.decl.name != gateName) continue
        val why = stopBlockedReason(integrityState(records[f.name]?.sha, sha256Hex(bytes)))
        if (why != null) { problem = "${f.name}: $why"; continue }
        hits.add(f.name to r.decl)
    }
    return when {
        hits.size == 1 -> hits[0].second to null
        hits.size > 1 -> null to "two plugins declare the web page \"$gateName\" (${hits.joinToString { it.first }}); turn one off"
        else -> null to (problem ?: "no enabled plugin declares the web page \"$gateName\"")
    }
}

/** Gate names the plugin file [pluginName] declares (empty when none or invalid). Used to stop its gate when it is deleted or switched off. */
internal fun WebServer.gateNamesOfPlugin(pluginName: String): List<String> {
    val f = File(pluginDir, pluginName)
    if (!f.isFile || !pluginName.endsWith(".js")) return emptyList()
    val code = try { f.readText() } catch (_: Exception) { return emptyList() }
    return listOfNotNull(parseGateDecl(code, Prefs.PORT).decl?.name)
}

internal fun WebServer.routeGate(s: IHTTPSession, uri: String): Response? = when {
    // {"name":"adguard"} -> one-time entry ticket + the gate's port. Same fresh sign-in rule as every root-capable route.
    uri == "/api/gate/open" && s.method == Method.POST -> rootGate(s) ?: run {
        val req = body(s)
        val name = req.optString("name")
        val ip = s.remoteIpAddress ?: "?"
        if (!Regex("^[a-z0-9-]{1,32}$").matches(name)) throw IllegalArgumentException("invalid gate name")
        openGate(s, ip, name, gateDeclFor(name))
    }
    // Kept for one release: plugin 0.9.7 calls this. Same gate, built-in AdGuard Home declaration.
    uri == "/api/agh/gate" && s.method == Method.POST -> rootGate(s) ?: run {
        drainBody(s)
        openGate(s, s.remoteIpAddress ?: "?", LEGACY_ADGUARD_GATE.name, LEGACY_ADGUARD_GATE to null)
    }
    else -> null
}

private fun WebServer.openGate(s: IHTTPSession, ip: String, name: String, found: Pair<GateDecl?, String?>): Response {
    val decl = found.first
    if (decl == null) {
        auditShell(ip, "gate open $name refused", "web-gate")
        return json(Response.Status.CONFLICT, JSONObject().put("ok", false).put("error", found.second ?: "failed"))
    }
    val r = WebGate.open(ctx, decl, ip, sessionToken(s))
    auditShell(ip, "gate open $name " + (r.error ?: "ok"), "web-gate")
    return if (r.ticket == null) json(Response.Status.CONFLICT, JSONObject().put("ok", false).put("error", r.error ?: "failed"))
    else json(Response.Status.OK, JSONObject().put("ok", true).put("ticket", r.ticket).put("port", r.port))
}

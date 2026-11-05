package com.matchi.tool

import android.content.Context
import fi.iki.elonen.NanoHTTPD
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

class WebServer(private val ctx: Context, port: Int) : NanoHTTPD(port) {
    private val pluginDir = File(ctx.filesDir, "plugins").apply { mkdirs() }
    private val nameRx = Regex("^[A-Za-z0-9._-]{1,80}\\.js$")

    // Brute-force protection: after MAX_FAILS bad tokens an IP is locked out for LOCK_MS.
    private val fails = HashMap<String, Pair<Int, Long>>()
    private val MAX_FAILS = 8
    private val LOCK_MS = 60_000L

    init { seedPlugins() }

    /**
     * Copy bundled plugins to filesDir. Bundled plugins are refreshed whenever the app version changes
     * (so updates actually reach the device); plugins the user uploaded under other names are never touched.
     */
    private fun seedPlugins() {
        @Suppress("DEPRECATION")
        val ver = ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionCode
        val refresh = Prefs.seededVersion(ctx) != ver
        ctx.assets.list("plugins")?.forEach { n ->
            val out = File(pluginDir, n)
            if (refresh || !out.exists()) ctx.assets.open("plugins/$n").use { i -> out.outputStream().use { i.copyTo(it) } }
        }
        if (refresh) Prefs.setSeededVersion(ctx, ver)
    }

    private fun authed(s: IHTTPSession): Boolean {
        val given = s.headers["x-token"] ?: return false
        return MessageDigest.isEqual(given.toByteArray(), Prefs.token(ctx).toByteArray())
    }

    private fun locked(ip: String): Boolean = synchronized(fails) {
        val f = fails[ip] ?: return false
        if (System.currentTimeMillis() - f.second > LOCK_MS) { fails.remove(ip); return false }
        f.first >= MAX_FAILS
    }
    private fun fail(ip: String) = synchronized(fails) {
        val now = System.currentTimeMillis()
        val f = fails[ip]
        fails[ip] = if (f == null || now - f.second > LOCK_MS) Pair(1, now) else Pair(f.first + 1, now)
    }
    private fun ok(ip: String) = synchronized(fails) { fails.remove(ip) }

    private val tooMany = object : Response.IStatus {
        override fun getRequestStatus() = 429
        override fun getDescription() = "429 Too Many Requests"
    }

    private fun json(code: Response.IStatus, o: Any) =
        newFixedLengthResponse(code, "application/json", o.toString()).also { it.addHeader("Cache-Control", "no-store") }

    private fun body(s: IHTTPSession): JSONObject {
        val b = HashMap<String, String>(); s.parseBody(b)
        return JSONObject(b["postData"] ?: "{}")
    }

    override fun serve(s: IHTTPSession): Response {
        val uri = s.uri
        if (uri == "/" || uri == "/index.html") {
            val html = ctx.assets.open("web/index.html").bufferedReader().readText()
            return newFixedLengthResponse(Response.Status.OK, "text/html; charset=utf-8", html)
        }
        if (!uri.startsWith("/api/")) return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "404")

        val ip = s.remoteIpAddress ?: "?"
        if (locked(ip)) return json(tooMany, JSONObject().put("error", "too many bad tokens, wait a minute"))
        if (!authed(s)) { fail(ip); return json(Response.Status.UNAUTHORIZED, JSONObject().put("error", "bad token")) }
        ok(ip)

        return try { route(s, uri) } catch (e: Exception) {
            json(Response.Status.BAD_REQUEST, JSONObject().put("error", e.message ?: "bad request"))
        }
    }

    private fun route(s: IHTTPSession, uri: String): Response = when {
        uri == "/api/ping" -> json(Response.Status.OK, JSONObject().put("ok", true))
        uri == "/api/shell" && s.method == Method.POST -> {
            val req = body(s)
            val t = req.optLong("timeout", 20000).coerceIn(1000, 120000)
            val r = RootShell.run(ctx, req.optString("cmd"), t)
            json(Response.Status.OK, JSONObject().put("success", r.success).put("content", r.content))
        }
        uri == "/api/plugins" && s.method == Method.GET -> {
            val off = Prefs.disabled(ctx)
            val arr = JSONArray()
            pluginDir.listFiles { f -> f.name.endsWith(".js") }?.sortedBy { it.name }?.forEach {
                arr.put(JSONObject().put("name", it.name).put("code", it.readText()).put("enabled", it.name !in off))
            }
            json(Response.Status.OK, arr)
        }
        // Upload or replace a plugin: {"name":"My_Plugin.js","code":"..."}
        uri == "/api/plugins" && s.method == Method.POST -> {
            val req = body(s)
            val name = req.optString("name"); val code = req.optString("code")
            if (!nameRx.matches(name) || name.contains("..")) throw IllegalArgumentException("invalid plugin name")
            if (code.isBlank() || code.length > 2_000_000) throw IllegalArgumentException("empty or too large")
            File(pluginDir, name).writeText(code)
            json(Response.Status.OK, JSONObject().put("ok", true))
        }
        uri == "/api/plugins/delete" && s.method == Method.POST -> {
            val name = body(s).optString("name")
            if (!nameRx.matches(name) || name.contains("..")) throw IllegalArgumentException("invalid plugin name")
            val deleted = File(pluginDir, name).delete()
            Prefs.setEnabled(ctx, name, true)
            json(Response.Status.OK, JSONObject().put("ok", deleted))
        }
        uri == "/api/plugins/toggle" && s.method == Method.POST -> {
            val req = body(s); val name = req.optString("name")
            if (!nameRx.matches(name) || name.contains("..")) throw IllegalArgumentException("invalid plugin name")
            Prefs.setEnabled(ctx, name, req.optBoolean("enabled", true))
            json(Response.Status.OK, JSONObject().put("ok", true))
        }
        else -> json(Response.Status.NOT_FOUND, JSONObject().put("error", "not found"))
    }
}

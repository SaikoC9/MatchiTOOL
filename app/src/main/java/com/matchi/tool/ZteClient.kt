package com.matchi.tool

import android.content.Context
import android.util.Base64
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.security.MessageDigest

/**
 * Minimal client for the ZTE router web API (/goform/goform_get_cmd_process and goform_set_cmd_process),
 * the same API UFI-TOOLS uses for SMS and signal data. The app runs on the router itself, so it simply
 * talks to the gateway address over HTTP. Logs in with the admin password when the router asks for it.
 */
object ZteClient {
    private const val GET_PATH = "/goform/goform_get_cmd_process"
    private const val SET_PATH = "/goform/goform_set_cmd_process"
    private const val LOGIN_COOLDOWN_MS = 60_000L   // ZTE firmware can lock the login after a few bad attempts

    private val lock = Any()
    private var cookie = ""
    private var lastLoginFail = 0L

    private class Resp(val code: Int, val body: String)

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
    private fun form(p: Map<String, String>) = p.entries.joinToString("&") { enc(it.key) + "=" + enc(it.value) }

    private fun sha256Upper(s: String): String =
        MessageDigest.getInstance("SHA-256").digest(s.toByteArray(Charsets.UTF_8)).joinToString("") { "%02X".format(it) }

    private fun http(ctx: Context, method: String, path: String, params: Map<String, String>): Resp {
        val host = Prefs.zteHost(ctx)
        val q = form(params)
        val url = URL(if (method == "GET") "http://$host$path?$q" else "http://$host$path")
        val c = url.openConnection() as HttpURLConnection
        try {
            c.requestMethod = method
            c.connectTimeout = 5000
            c.readTimeout = 15000
            c.instanceFollowRedirects = false
            // The router rejects requests that do not look like they come from its own web UI.
            c.setRequestProperty("Referer", "http://$host/index.html")
            c.setRequestProperty("Origin", "http://$host")
            c.setRequestProperty("X-Requested-With", "XMLHttpRequest")
            if (cookie.isNotEmpty()) c.setRequestProperty("Cookie", cookie)
            if (method == "POST") {
                c.doOutput = true
                c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
                c.outputStream.use { it.write(q.toByteArray(Charsets.UTF_8)) }
            }
            val code = c.responseCode
            val stream = if (code >= 400) c.errorStream else c.inputStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            val fresh = c.headerFields.entries
                .filter { it.key != null && it.key.equals("Set-Cookie", ignoreCase = true) }
                .flatMap { it.value }
                .map { it.substringBefore(';').trim() }
                .filter { it.contains('=') }
            if (fresh.isNotEmpty()) {
                val jar = LinkedHashMap<String, String>()
                cookie.split(';').map { it.trim() }.filter { it.contains('=') }.forEach { jar[it.substringBefore('=')] = it }
                fresh.forEach { jar[it.substringBefore('=')] = it }
                cookie = jar.values.joinToString("; ")
            }
            return Resp(code, text)
        } finally {
            c.disconnect()
        }
    }

    /** Returns null on success, otherwise a human readable error. */
    private fun login(ctx: Context): String? {
        val pw = Prefs.ztePass(ctx)
        if (pw.isEmpty()) return "Router admin password not set (use the settings row in the plugin)"
        if (System.currentTimeMillis() - lastLoginFail < LOGIN_COOLDOWN_MS)
            return "Router login failed recently, waiting before trying again"
        cookie = ""
        val ld = try {
            JSONObject(http(ctx, "GET", GET_PATH, mapOf("isTest" to "false", "cmd" to "LD")).body).optString("LD")
        } catch (_: Exception) { "" }
        // Newer firmware: SHA256(SHA256(password) + LD). Older firmware: base64(password).
        val secret = if (ld.isNotEmpty()) sha256Upper(sha256Upper(pw) + ld)
                     else Base64.encodeToString(pw.toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
        val r = http(ctx, "POST", SET_PATH, mapOf("isTest" to "false", "goformId" to "LOGIN", "password" to secret))
        val result = try { JSONObject(r.body).optString("result") } catch (_: Exception) { "" }
        if (result == "0") return null
        lastLoginFail = System.currentTimeMillis()
        cookie = ""
        return "Router login failed (result=$result). Check the admin password and gateway address."
    }

    private fun send(ctx: Context, op: String, params: Map<String, String>): Resp =
        if (op == "get") http(ctx, "GET", GET_PATH, params + ("isTest" to "false"))
        else http(ctx, "POST", SET_PATH, params + ("isTest" to "false"))

    private fun looksUnauthorized(r: Resp) =
        r.code == 401 || r.code == 403 || r.body.isBlank() || r.body.contains("\"result\":\"failure\"")

    /** op is "get" or "set". Returns the router's raw response body. */
    fun call(ctx: Context, op: String, params: Map<String, String>): String = synchronized(lock) {
        if (cookie.isEmpty() && Prefs.ztePass(ctx).isNotEmpty()) login(ctx)?.let { throw IllegalStateException(it) }
        var r = send(ctx, op, params)
        // Retry once after logging in. Only for reads (or an explicit 401/403): a failed "set" must never be repeated blindly.
        if ((op == "get" && looksUnauthorized(r)) || r.code == 401 || r.code == 403) {
            login(ctx)?.let { throw IllegalStateException(it) }
            r = send(ctx, op, params)
        }
        if (r.code >= 400) throw IllegalStateException("Router returned HTTP ${r.code}")
        r.body
    }
}

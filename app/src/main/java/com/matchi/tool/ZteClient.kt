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
    private const val IDLE_RELOGIN_MS = 120_000L   // sign in again after this much idle time instead of reusing a dead cookie
    private const val LOGIN_COOLDOWN_MS = 60_000L   // ZTE firmware can lock the login after a few bad attempts

    private val lock = Any()
    private var cookie = ""
    private var lastLoginFail = 0L
    private var lastUse = 0L          // last successful router call: the router drops idle sessions
    private var found = ""            // host:port that answered the router API last time
    private var foundFor = ""         // the saved gateway value that `found` belongs to
    private val CANDIDATE_PORTS = listOf(80, 8080, 9090, 9999)   // F50 stock firmware has nothing on 80

    /** Forget the cached router session so a newly saved password is used immediately. */
    fun reset() = synchronized(lock) { cookie = ""; lastLoginFail = 0L; lastUse = 0L; found = ""; foundFor = "" }

    private class Resp(val code: Int, val body: String)

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
    private fun form(p: Map<String, String>) = p.entries.joinToString("&") { enc(it.key) + "=" + enc(it.value) }

    private fun sha256Upper(s: String): String =
        MessageDigest.getInstance("SHA-256").digest(s.toByteArray(Charsets.UTF_8)).joinToString("") { "%02X".format(it) }

    /** True if host:port answers the ZTE goform API with JSON (not just any web server). */
    private fun probe(hostPort: String): Boolean = try {
        val c = URL("http://$hostPort$GET_PATH?isTest=false&cmd=LD").openConnection() as HttpURLConnection
        try {
            c.connectTimeout = 1200; c.readTimeout = 2500; c.instanceFollowRedirects = false
            c.setRequestProperty("Referer", "http://$hostPort/index.html")
            val body = (if (c.responseCode >= 400) c.errorStream else c.inputStream)?.bufferedReader()?.use { it.readText() } ?: ""
            body.trimStart().startsWith("{")
        } finally { c.disconnect() }
    } catch (_: Exception) { false }

    /** Saved gateway: "host" (port auto-detected from 80, 8080, 9090, 9999) or "host:port" (used as given). */
    private fun resolveHost(ctx: Context): String {
        val saved = Prefs.zteHost(ctx)
        if (saved.contains(':')) return saved
        if (found.isNotEmpty() && foundFor == saved) return found
        for (p in CANDIDATE_PORTS) {
            val hp = if (p == 80) saved else "$saved:$p"
            if (probe(hp)) { found = hp; foundFor = saved; return hp }
        }
        return saved   // nothing answered: keep port 80 so the error is the usual "unreachable"
    }

    private fun http(ctx: Context, method: String, path: String, params: Map<String, String>): Resp {
        val host = resolveHost(ctx)
        val q = form(params)
        val url = URL(if (method == "GET") "http://$host$path?$q" else "http://$host$path")
        val c = url.openConnection() as HttpURLConnection
        try {
            c.requestMethod = method
            c.connectTimeout = 2500
            c.readTimeout = 15000
            c.instanceFollowRedirects = false
            // The router rejects requests that do not look like they come from its own web UI.
            c.setRequestProperty("Referer", "http://$host/index.html")
            c.setRequestProperty("Origin", "http://$host")
            c.setRequestProperty("X-Requested-With", "XMLHttpRequest")
            // The firmware's own web page sends these; some ZTE builds ignore requests that do not look like a browser.
            c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36")
            c.setRequestProperty("Accept", "application/json, text/javascript, */*; q=0.01")
            c.setRequestProperty("Accept-Language", "en-US,en;q=0.9")
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
    private fun login(ctx: Context): String? = loginWith(ctx, Prefs.ztePass(ctx), true)

    /** [track] = remember a failure so the saved password is not retried for a minute (not for a typed guess). */
    private fun loginWith(ctx: Context, pw: String, track: Boolean): String? {
        if (pw.isEmpty()) return "Router admin password not known yet: sign in to the web console with it once"
        if (track && System.currentTimeMillis() - lastLoginFail < LOGIN_COOLDOWN_MS)
            return "Router login failed recently, waiting before trying again"
        cookie = ""
        // A network error here (timeout, reset, refused) must NOT be mistaken for "old firmware without LD": it propagates as an
        // IOException (callers report "router unreachable"), so the password is never posted in the weak base64 form on a
        // transient failure, and a failed attempt is not counted as a wrong password. Only a router that ANSWERS without an
        // LD value is treated as older firmware.
        val ldResp = http(ctx, "GET", GET_PATH, mapOf("isTest" to "false", "cmd" to "LD"))
        if (ldResp.code >= 500) throw java.io.IOException("router error HTTP ${ldResp.code} on the login challenge")   // busy / restarting: not "old firmware"
        val ld = try { JSONObject(ldResp.body).optString("LD") } catch (_: Exception) { "" }
        // Newer firmware: SHA256(SHA256(password) + LD). Older firmware: base64(password).
        val secret = if (ld.isNotEmpty()) sha256Upper(sha256Upper(pw) + ld)
                     else Base64.encodeToString(pw.toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
        val r = http(ctx, "POST", SET_PATH, mapOf("isTest" to "false", "goformId" to "LOGIN", "password" to secret))
        val result = try { JSONObject(r.body).optString("result") } catch (_: Exception) { "" }
        if (result == "0") return null
        if (track) lastLoginFail = System.currentTimeMillis()
        cookie = ""
        return "Router login failed (result=$result). Check the admin password and gateway address."
    }

    /**
     * Checks a password against the router itself, so the web console accepts the router's own admin password
     * whatever is stored. true = accepted, false = rejected, null = the router API could not be reached.
     */
    fun verify(ctx: Context, pw: String): Boolean? {
        if (pw.isEmpty() || pw.length > 200) return false
        return synchronized(lock) {
            val keep = cookie
            val r: Boolean? = try {
                if (loginWith(ctx, pw, false) == null) { lastUse = System.currentTimeMillis(); lastLoginFail = 0L; true }
                else { cookie = keep; false }
            } catch (_: java.io.IOException) { cookie = keep; null }
            r
        }
    }

    @Volatile private var autoTried = false   // true once the search ended with a definite answer (found, or nothing worked)
    private var rejectedGuesses = 0           // guesses the router actually REFUSED; capped so its own login lock is never triggered
    /** Short facts about the last "set" call (AD token, session, HTTP code, start of the reply) for error messages. */
    @Volatile var lastInfo = ""

    /**
     * Learns the router admin password without the user typing it: reads the router's own setting as root and keeps
     * a value only if the router accepts it (wrong guesses are never saved). At most 3 guesses the router refuses.
     * Does nothing when a password is already saved. Signing in to the web console with the password also saves it.
     *
     * Returns true when there is nothing more to do (password saved or already known, or the search ended with a definite
     * answer) and false when it could not finish yet (root not ready, or the router web API unreachable, which is normal
     * right after boot); the caller should call it again later. An unreachable router or an empty root answer is not a
     * guess and is not counted.
     */
    @Synchronized
    fun autoDetect(ctx: Context): Boolean {
        if (Prefs.ztePass(ctx).isNotEmpty() || autoTried) return true
        val script = "for k in admin_Password Admin_Password admin_password; do for b in nv /system/bin/nv /system/xbin/nv /vendor/bin/nv; do " +
            "command -v ${'$'}b >/dev/null 2>&1 || continue; v=${'$'}(${'$'}b get ${'$'}k 2>/dev/null); [ -n \"${'$'}v\" ] && echo \"${'$'}v\"; done; done"
        val out = try { RootShell.run(ctx, script, 15_000).content } catch (_: Exception) { return false }
        if (out.isBlank()) return false   // root not granted/ready yet, or no such setting: try again later (bounded by the caller)
        val cands = LinkedHashSet<String>()
        for (raw in out.lines()) {
            val line = raw.trim().removeSurrounding("\"")
            if (line.isEmpty() || line.length > 64) continue
            cands.add(line)
            if (line.contains('=')) cands.add(line.substringAfter('='))
            try {
                val dec = String(Base64.decode(line, Base64.DEFAULT), Charsets.UTF_8)
                if (dec.isNotEmpty() && dec.all { it.code in 32..126 }) cands.add(dec)
            } catch (e: Exception) { Quiet.note("ZteClient.autoDetect", e) }
        }
        for (c in cands) {
            if (rejectedGuesses >= 3) break
            when (verify(ctx, c)) {
                true -> { val saved = Prefs.setZtePass(ctx, c); autoTried = true; return saved }   // false: key store could not encrypt it, nothing was saved
                null -> return false   // router API unreachable: not a guess, retry later
                else -> rejectedGuesses++
            }
        }
        autoTried = true
        return true
    }

    private fun md5Hex(s: String) =
        MessageDigest.getInstance("MD5").digest(s.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

    /**
     * Newer ZTE firmware (F50 included) answers every "set" that lacks a valid AD token with an empty body or
     * {"result":"failure"} and does nothing: SMS delete / send, settings. The router's own web page computes
     * AD = md5(md5(wa_inner_version + cr_version) + RD), where RD is a fresh value for every request.
     */
    private fun adToken(ctx: Context, upper: Boolean = false): String? = try {
        val v = JSONObject(http(ctx, "GET", GET_PATH, mapOf("isTest" to "false", "cmd" to "wa_inner_version,cr_version", "multi_data" to "1")).body)
        val rd = JSONObject(http(ctx, "GET", GET_PATH, mapOf("isTest" to "false", "cmd" to "RD")).body).optString("RD")
        if (rd.isEmpty() || (v.optString("wa_inner_version") + v.optString("cr_version")).isEmpty()) null else {
            val inner = md5Hex(v.optString("wa_inner_version") + v.optString("cr_version"))
            // Some firmware builds expect the hex digest in upper case; the retry path tries that form.
            if (upper) md5Hex(inner + rd).uppercase() else md5Hex(inner + rd)
        }
    } catch (e: java.io.IOException) { throw e } catch (_: Exception) { null }

    private fun send(ctx: Context, op: String, params: Map<String, String>, upper: Boolean = false): Resp =
        if (op == "get") http(ctx, "GET", GET_PATH, params + ("isTest" to "false"))
        else {
            val p = LinkedHashMap<String, String>()
            p["isTest"] = "false"          // same field order as the router's own page: isTest, goformId, ..., AD
            p.putAll(params.filterKeys { it != "isTest" })
            val ad = adToken(ctx, upper)
            ad?.let { p["AD"] = it }
            val r = http(ctx, "POST", SET_PATH, p)
            lastInfo = "AD " + (if (ad != null) (if (upper) "ok/upper" else "ok") else "missing") + ", session " + (if (cookie.isNotEmpty()) "yes" else "no") +
                ", HTTP " + r.code + ", reply " + (if (r.body.isBlank()) "empty" else r.body.trim().take(60))
            r
        }

    private fun looksUnauthorized(r: Resp) =
        r.code == 401 || r.code == 403 || r.body.isBlank() || r.body.contains("\"result\":\"failure\"")

    /** Plain GET of one static file of the router's own web page (e.g. /index.html or a script it loads). Read-only. */
    fun fetchPage(ctx: Context, path: String): String = synchronized(lock) {
        if (!Regex("^/[A-Za-z0-9._/-]{1,200}$").matches(path) || path.contains("..")) throw IllegalArgumentException("bad path")
        try {
            val host = resolveHost(ctx)
            val c = URL("http://$host$path").openConnection() as HttpURLConnection
            try {
                c.connectTimeout = 2500; c.readTimeout = 10000; c.instanceFollowRedirects = false
                val code = c.responseCode
                if (code >= 400) throw IllegalStateException("Router returned HTTP $code for $path")
                c.inputStream.bufferedReader(Charsets.UTF_8).use { r ->
                    val sb = StringBuilder(); val buf = CharArray(8192)
                    while (true) { val n = r.read(buf); if (n < 0) break; sb.append(buf, 0, n); if (sb.length > 4_000_000) break }
                    sb.toString()
                }
            } finally { c.disconnect() }
        } catch (e: java.io.IOException) { throw IllegalStateException("Router web page unreachable: ${e.message ?: e.javaClass.simpleName}") }
    }

    /** op is "get" or "set". Returns the router's raw response body. */
    fun call(ctx: Context, op: String, params: Map<String, String>, retry: Int = 0): String = synchronized(lock) {
        try {
            callLocked(ctx, op, params, retry)
        } catch (e: java.io.IOException) {
            // Connection refused / timed out / no route: the router web API cannot be reached at all, so the
            // password is irrelevant. Callers (the SMS tool) recognise the "unreachable" wording and fall back to
            // the modem's AT commands instead of showing a raw socket error.
            found = ""   // re-detect the port next time
            val saved = Prefs.zteHost(ctx)
            val where = if (saved.contains(':')) saved else "$saved (ports ${CANDIDATE_PORTS.joinToString("/")})"
            throw IllegalStateException("Router web API unreachable at $where (${e.message ?: e.javaClass.simpleName})")
        }
    }

    /**
     * [retry] is used by the SMS tool for an idempotent "set" (delete) that the router answered with an empty body:
     * 1 = throw the cached session away and sign in again first, 2 = the same plus the upper-case AD token form.
     */
    private fun callLocked(ctx: Context, op: String, params: Map<String, String>, retry: Int = 0): String {
        if (retry >= 1) { cookie = ""; lastLoginFail = 0L }
        // The router expires idle sessions but still answers HTTP 200 {"result":"failure"} to a "set" made with the dead
        // cookie (delete / send SMS then silently do nothing). A "set" must not be repeated blindly, so renew the
        // session up front when it has been idle for a while.
        val hasPass = Prefs.ztePass(ctx).isNotEmpty()
        if (hasPass && cookie.isNotEmpty() && System.currentTimeMillis() - lastUse > IDLE_RELOGIN_MS) cookie = ""
        if (cookie.isEmpty() && hasPass) login(ctx)?.let { throw IllegalStateException(it) }
        val upper = retry >= 2
        var r = send(ctx, op, params, upper)
        // Retry once after logging in. Only for reads (or an explicit 401/403): a failed "set" must never be repeated blindly.
        if ((op == "get" && looksUnauthorized(r)) || r.code == 401 || r.code == 403) {
            login(ctx)?.let { throw IllegalStateException(it) }
            r = send(ctx, op, params, upper)
        }
        if (r.code >= 400) throw IllegalStateException("Router returned HTTP ${r.code}")
        lastUse = System.currentTimeMillis()
        return r.body
    }
}

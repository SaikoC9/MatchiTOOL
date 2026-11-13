package com.matchi.tool

import android.content.Context
import android.util.Log
import fi.iki.elonen.NanoHTTPD
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.io.StringReader
import org.xmlpull.v1.XmlPullParser
import android.util.Xml
import java.security.MessageDigest

class WebServer(internal val ctx: Context, port: Int, bindAddress: String = "127.0.0.1") : NanoHTTPD(bindAddress, port) {
    internal val pluginDir = File(ctx.filesDir, "plugins").apply { mkdirs() }
    internal val nameRx = Regex("^[A-Za-z0-9._-]{1,80}\\.(js|html)$")
    // Files handed to plugins (UFI-TOOLS plugins expect an upload endpoint). Root plugins read them from this folder.
    internal val uploadDir = File(ctx.filesDir, "uploads").apply { mkdirs() }
    // Ledger of what each plugin wrote (paths, uploads, side effects), filled from root commands the page attributes to a plugin.
    internal val traceStore = PluginTraceStore(File(ctx.filesDir, "plugin_trace"))

    /** Refuses a root or user command that is clearly destructive or opens a remote shell (see shellDanger). The command text is never logged. */
    internal fun commandBlocked(s: IHTTPSession, command: String): Response? {
        val fromPlugin = tracePluginName(s.headers["x-matchi-plugin"]) != null
        val why = shellDanger(command, fromPlugin) ?: return null
        LogCatcher.log("WARNING", "plugin/guard", "Blocked a command: $why" + (if (fromPlugin) " (sent by a plugin)" else ""))
        auditShell(s.remoteIpAddress ?: "?", "BLOCKED: $why", "shell-blocked")
        return json(Response.Status.FORBIDDEN, JSONObject().put("code", "blocked").put("error", "Blocked by MatchiTOOL security: this command $why. (This check only catches common mistakes; it is not a security boundary.)"))
    }

    /** Remember the paths and side effects of a command that the page says a plugin sent (header x-matchi-plugin). */
    internal fun traceCommand(s: IHTTPSession, command: String) {
        val plugin = tracePluginName(s.headers["x-matchi-plugin"]) ?: return
        try {
            traceStore.recordCommand(plugin, command)
        } catch (e: Exception) { Quiet.note("WebServer.traceCommand", e) }
    }
    /** Phase 2 Step 1: the command with the plugin tag in front, from the x-matchi-plugin header (best effort, see PluginSweep.kt). Use AFTER shellDanger/traceCommand. */
    internal fun tagged(s: IHTTPSession, command: String): String = tagCommand(s.headers["x-matchi-plugin"], command)
    internal val uploadNameRx = Regex("^[A-Za-z0-9._-]{1,120}$")
    internal val MAX_UPLOAD_BYTES = 512L * 1024L * 1024L
    internal val MAX_UPLOAD_TOTAL_BYTES = 1024L * 1024L * 1024L

    // Brute-force protection for /api/login (per-IP + global back-off, router-forward budget): see LoginGuard.
    internal val guard = LoginGuard()
    // Every root-capable call needs a login that is recent, not just a live 12 h session: see rootGate().
    internal val SHELL_MAX_SESSION_MS = RootGate.MAX_SESSION_MS

    /**
     * One rule for everything that runs as root or makes root run something (shell, AT writes, IMEI, USB mode, screen input,
     * APK install, plugin upload/erase): plain HTTP needs the page's confirmation, and the sign-in must be younger than 4 h.
     * Returns the 403 answer to send, or null when the call may go on. The codes ("insecure", "reauth") are the ones the page handles.
     */
    internal fun rootGate(s: IHTTPSession): Response? {
        val ip = s.remoteIpAddress ?: "?"
        return when (RootGate.decide(Tls.active, isLoopbackIp(ip), Prefs.rootOverHttp(ctx), s.headers["x-insecure-ok"], Sessions.ageMs(ctx, sessionToken(s)), SHELL_MAX_SESSION_MS)) {
            RootGate.Refusal.INSECURE_OFF -> json(Response.Status.FORBIDDEN, JSONObject().put("code", RootGate.Refusal.INSECURE_OFF.code).put("error", "Root actions are off while this console runs over plain HTTP (not encrypted). Open the console over HTTPS, or switch on \"Root over HTTP\" under Plugins > Root over HTTP."))
            RootGate.Refusal.INSECURE -> json(Response.Status.FORBIDDEN, JSONObject().put("code", RootGate.Refusal.INSECURE.code).put("error", "This connection is not encrypted (HTTP). Confirm in the page to run root commands anyway."))
            RootGate.Refusal.REAUTH -> json(Response.Status.FORBIDDEN, JSONObject().put("code", RootGate.Refusal.REAUTH.code).put("error", "Session too old for root commands - sign in again"))
            null -> null
        }
    }

    private val BUNDLED_TOOLS = listOf("jq", "sha256", "zreq")

    init { seedPlugins(); ApkUpdater.cleanStale(ctx) }

    /**
     * Prepare the plugin folder (custom plugins only) and the bundled sendat binary. The built-in tools
     * are embedded in the web page itself (web/index.html), not copied into the custom plugin directory.
     */
    private fun seedPlugins() {
        @Suppress("DEPRECATION")
        val ver = try { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionCode } catch (_: Exception) { 0 }
        val refresh = Prefs.seededVersion(ctx) != ver
        // sendat (from UFI-TOOLS, MIT) talks to the modem for AT commands. It is a native binary, so it stays in the APK.
        val sendat = File(ctx.filesDir, "sendat")
        var copied = true
        if (refresh || !sendat.exists()) copied = installSendat(sendat)
        try { sendat.setExecutable(true, false) } catch (e: Exception) { Quiet.note("WebServer.seedPlugins", e) }
        // curl (arm64, from UFI-TOOLS V4.0.0) is for plugins that download files (for example ADGuard Home). Android has no curl.
        val curl = File(ctx.filesDir, "curl")
        if (refresh || !curl.exists()) installBundledBinary("bin/curl", curl)
        try { curl.setExecutable(true, false) } catch (e: Exception) { Quiet.note("WebServer.seedPlugins", e) }
        // jq, sha256 and zreq (arm64, from UFI-TOOLS 4.1.5) are for plugins that call them by the UFI path
        // /data/data/com.minikano.f50_sms/files/NAME, which UfiPathMap rewrites to this folder. Same copy-then-rename as curl.
        for (tool in BUNDLED_TOOLS) {
            val dest = File(ctx.filesDir, tool)
            if (refresh || !dest.exists()) installBundledBinary("bin/$tool", dest)
            try { dest.setExecutable(true, false) } catch (e: Exception) { Quiet.note("WebServer.seedPlugins", e) }
        }
        // Only remember the version when the copy worked, so a failed copy is tried again at the next start.
        if (refresh && copied) Prefs.setSeededVersion(ctx, ver)
    }

    /**
     * Copies the bundled sendat next to its final name and renames it into place. Writing straight over the file fails with
     * "Text file busy" while an old sendat is still running (an update right after an AT command), and that exception used
     * to escape the WebServer constructor and keep the whole console from starting. A rename replaces the directory entry
     * and works while the old binary runs. Never throws: on failure the old binary (if any) stays and false is returned.
     */
    private fun installSendat(dest: File): Boolean {
        val tmp = File(dest.parentFile, "sendat.new")
        return try {
            ctx.assets.open("bin/sendat").use { i -> tmp.outputStream().use { i.copyTo(it) } }
            tmp.setExecutable(true, false)
            if (!tmp.renameTo(dest)) throw java.io.IOException("could not move sendat into place")
            true
        } catch (e: Exception) {
            LogCatcher.log("WARNING", "WebServer", "sendat copy failed, keeping the existing binary: ${e.message}")
            try { tmp.delete() } catch (e: Exception) { Quiet.note("WebServer.installSendat", e) }
            false
        }
    }

    /** Same safe copy-then-rename as [installSendat], for any bundled executable. Never throws; false when the copy failed. */
    private fun installBundledBinary(asset: String, dest: File): Boolean {
        val tmp = File(dest.parentFile, dest.name + ".new")
        return try {
            ctx.assets.open(asset).use { i -> tmp.outputStream().use { i.copyTo(it) } }
            tmp.setExecutable(true, false)
            if (!tmp.renameTo(dest)) throw java.io.IOException("could not move ${dest.name} into place")
            true
        } catch (e: Exception) {
            LogCatcher.log("WARNING", "WebServer", "${dest.name} copy failed, keeping the existing binary: ${e.message}")
            try { tmp.delete() } catch (e2: Exception) { Quiet.note("WebServer.installBundledBinary", e2) }
            false
        }
    }

    /**
     * The session token of this request. It comes only from the HttpOnly cookie, and only when the page's marker header x-token is sent too
     * (CSRF rule, see SessionCookie.kt). Every place that needs "this request's session" goes through here, so no route reads the header itself.
     */
    internal fun sessionToken(s: IHTTPSession): String? = requestToken(s.headers["cookie"], s.headers["x-token"])

    /** True when the request carries a live per-login session token (see [SessionStore]). */
    private fun authed(s: IHTTPSession): Boolean = Sessions.validate(ctx, sessionToken(s))

    /**
     * Every app on the device reaches the console as 127.0.0.1 / ::1, so they would all share one lockout bucket and one
     * app could lock the owner out (or the owner's typos could lock apps out). Loopback is therefore never hard-locked;
     * each bad password from it is answered after a short delay instead (see [login]).
     */
    internal fun isLoopbackIp(raw: String): Boolean {
        val x = raw.substringBefore('%').lowercase().removePrefix("::ffff:")
        return x == "::1" || x == "0:0:0:0:0:0:0:1" || x == "localhost" || x.startsWith("127.")
    }

    internal val snapshotBusy = java.util.concurrent.Semaphore(1)
    internal val tooMany = object : Response.IStatus {
        override fun getRequestStatus() = 429
        override fun getDescription() = "429 Too Many Requests"
    }

    /**
     * NanoHTTPD 2.3.1 decides gzip per response AFTER serve() returns (text/ * and JSON when the browser accepts it), which
     * overrides setGzipEncoding(false) set in [harden]; its GZIPOutputStream is never closed, so every answer leaked a native
     * Deflater ("A resource failed to call end." in the log). Switching it off here is the hook NanoHTTPD provides.
     */
    override fun useGzipWhenAccepted(r: Response): Boolean = false

    internal fun harden(response: Response): Response = response.also {
        // NanoHTTPD 2.3.1 gzips text/* and JSON itself but only calls finish() on its GZIPOutputStream, never close(),
        // so every compressed answer leaks a native Deflater until the GC finalizer logs "A resource failed to call end".
        // Compression is therefore switched off here; the one large body (the page) is gzipped once below.
        it.setGzipEncoding(false)
        it.addHeader("Cache-Control", "no-store")
        it.addHeader("X-Content-Type-Options", "nosniff")
        it.addHeader("X-Frame-Options", "DENY")
        it.addHeader("Referrer-Policy", "no-referrer")
        it.addHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        // Plugins are trusted code that runs through new Function, so script 'unsafe-eval' stays. What they may CONTACT is decided by
        // NetPolicy: in strict mode (the default) only this page and the allow-list; everything else is closed: no framing, no <base>, no plugins, own forms only.
        it.addHeader("Content-Security-Policy", NetPolicy.csp(Prefs.netHosts(ctx), Prefs.netStrict(ctx)))
        // NanoHTTPD 2.3.1 does not skip a request body the handler never read. An error answer (401/403/429/...) may
        // have been sent before the body was consumed, so close the connection instead of letting the leftover bytes
        // be parsed as the start of the next keep-alive request.
        if (it.status.requestStatus >= 400) it.addHeader("Connection", "close")
    }

    /** UFI-TOOLS shell reply: {"result": ..., "error": ...}; the one that does not apply is JSON null. */
    /** UFI's shell routes (read from its advancedToolsModule.kt): {"result":...} with 200, or {"error":"..."} with HTTP 500. */
    internal fun ufiShellReply(result: Any?, error: String?): Response =
        if (error == null) json(Response.Status.OK, JSONObject().put("result", result ?: JSONObject.NULL))
        else json(Response.Status.INTERNAL_ERROR, JSONObject().put("error", error))

    internal fun json(code: Response.IStatus, o: Any) = harden(newFixedLengthResponse(code, "application/json; charset=utf-8", o.toString()))

    // NanoHTTPD 2.3.1 decodes a request body with no charset as US-ASCII, so every non-ASCII character in a posted
    // plugin (the dots, ellipses and check marks in Bypass, for one) was saved as U+FFFD and showed as "?" boxes.
    // The JSON body is therefore read as raw bytes and decoded as UTF-8 here, whatever the Content-Type says.
    private val MAX_JSON_BODY = 16 * 1024 * 1024

    internal val MAX_LOGIN_BODY = 4 * 1024

    /**
     * Reads a JSON request body of at most [max] bytes. A missing Content-Length means an empty body, and a larger or
     * invalid length is refused BEFORE anything is read: the old fallback handed such requests to NanoHTTPD's parseBody,
     * which spools the whole body to a temp file, so /api/login (open to every hotspot client) could be used to fill
     * memory or the cache folder without a password.
     */
    /**
     * For POST routes that do not need their body: read and drop it. NanoHTTPD 2.3.1 keeps the connection open and does not
     * skip an unread body, so the leftover bytes (the page's `{}` on /api/logout) were parsed as the start of the next request
     * on that connection and the reload after signing out answered "BAD REQUEST: ... HTTP verb {}GET unhandled".
     */
    internal fun drainBody(s: IHTTPSession) { try { body(s, MAX_LOGIN_BODY) } catch (e: Exception) { LogCatcher.log("WARNING", "WebServer", "request body not drained: " + e.message) } }

    internal fun body(s: IHTTPSession, max: Int = MAX_JSON_BODY): JSONObject {
        val raw = s.headers["content-length"]?.trim()
        if (raw == null && s.method == Method.POST && s.headers["transfer-encoding"] != null)
            throw IllegalArgumentException("chunked request bodies are not supported - send a Content-Length (411)")
        val len = if (raw == null) 0 else raw.toIntOrNull() ?: throw IllegalArgumentException("bad Content-Length")
        if (len < 0 || len > max) throw IllegalArgumentException("request body too large")
        if (len == 0) return JSONObject()
        val buf = ByteArray(len)
        var off = 0
        val input = s.inputStream
        while (off < len) {
            val n = input.read(buf, off, len - off)
            if (n < 0) break
            off += n
        }
        val text = String(buf, 0, off, Charsets.UTF_8).trim()
        return JSONObject(if (text.isEmpty()) "{}" else text)
    }

    // The page is read once and answered from memory. NanoHTTPD's own gzip is disabled in harden() (it leaks a Deflater
    // per response), so the page is compressed ONCE here, with the stream closed, and sent as-is to browsers that accept it.
    // ETag makes a reload a 304.
    private val pageBytes: ByteArray by lazy { ctx.assets.open("web/index.html").use { it.readBytes() } }
    private val pageGzip: ByteArray? by lazy {
        try {
            val out = java.io.ByteArrayOutputStream(pageBytes.size / 4 + 1024)
            java.util.zip.GZIPOutputStream(out).use { it.write(pageBytes) }   // close() ends the Deflater
            out.toByteArray().takeIf { it.size < pageBytes.size }
        } catch (_: Exception) { null }
    }
    internal val pageTag by lazy { "\"" + MessageDigest.getInstance("SHA-256").digest(pageBytes).take(8).joinToString("") { "%02x".format(it) } + "\"" }

    private fun servePage(s: IHTTPSession): Response {
        if (s.headers["if-none-match"] == pageTag)
            return harden(newFixedLengthResponse(Response.Status.NOT_MODIFIED, "text/html", "")).also {
                it.addHeader("ETag", pageTag); it.addHeader("Vary", "Accept-Encoding")
            }
        val gz = pageGzip
        val useGz = gz != null && (s.headers["accept-encoding"] ?: "").contains("gzip", ignoreCase = true)
        val body = if (useGz) gz!! else pageBytes
        return harden(newFixedLengthResponse(Response.Status.OK, "text/html; charset=utf-8", ByteArrayInputStream(body), body.size.toLong())).also {
            it.addHeader("ETag", pageTag)
            it.addHeader("Vary", "Accept-Encoding")
            it.addHeader("Cache-Control", "no-cache")
            if (useGz) it.addHeader("Content-Encoding", "gzip")
        }
    }

    override fun serve(s: IHTTPSession): Response {
        val uri = s.uri
        // DNS-rebinding guard: a page on an attacker's host name that is re-pointed at this device would send
        // "Host: attacker.example", and the Origin check below would then match it. Only IP addresses and
        // "localhost" are valid Host values for this console, whatever the path.
        if (!hostHeaderAllowed(s.headers["host"]))
            return json(Response.Status.FORBIDDEN, JSONObject().put("error", "open the console by its IP address, not a host name"))
        val ip = s.remoteIpAddress ?: "?"
        // Network check first for EVERY path (page and 404 included), so hosts outside the hotspot cannot even fingerprint the app.
        if (!HostControl.isHotspotClient(ctx, ip)) return json(Response.Status.FORBIDDEN, JSONObject().put("error", "ZTE hotspot network access only"))
        if (uri == "/" || uri == "/index.html") {
            return servePage(s)
        }
        if (!uri.startsWith("/api/")) return harden(newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "404"))

        // Reject cross-origin browser requests. Same-origin page/plugin requests continue to work.
        val origin = s.headers["origin"]
        if (origin != null) {
            val hostUri = try { java.net.URI("${Tls.scheme}://${s.headers["host"] ?: ""}") } catch (_: Exception) { null }
            val originUri = try { java.net.URI(origin) } catch (_: Exception) { null }
            val sameOrigin = hostUri != null && originUri != null && originUri.scheme == Tls.scheme &&
                originUri.host?.equals(hostUri.host, ignoreCase = true) == true &&
                (if (originUri.port >= 0) originUri.port else if (Tls.active) 443 else 80) == (if (hostUri.port >= 0) hostUri.port else if (Tls.active) 443 else 80)
            if (!sameOrigin)
                return json(Response.Status.FORBIDDEN, JSONObject().put("error", "cross-origin request refused"))
        }
        // Only password/token guesses at /api/login count toward the lockout. A browser tab still holding an old
        // session token (after the password or token changed) used to rack up failures by polling, which then
        // locked the real login out ("Too many attempts"). Session tokens are 96-bit random, so they need no lockout.
        if (uri == "/api/login" && s.method == Method.POST) {
            val wait = guard.retryAfterMs(ip, isLoopbackIp(ip))
            if (wait > 0) {
                val secs = (wait + 999) / 1000
                return json(tooMany, JSONObject().put("error", "too many bad attempts, wait ${if (secs >= 120) "${(secs + 59) / 60} minutes" else "$secs s"}"))
                    .also { it.addHeader("Retry-After", secs.toString()) }
            }
            return login(ip, s)
        }
        if (!authed(s)) return json(Response.Status.UNAUTHORIZED, JSONObject().put("error", "Session expired or invalid - log in again"))

        val pluginKind = PluginLog.kindOf(s.method.name, uri)
        val t0 = System.nanoTime()
        val resp = try { route(s, uri) } catch (e: Exception) {
            // Deliberate refusals (IllegalArgument/IllegalState/IO/Update) are normal 400s; anything else is a bug worth a log line.
            if (e !is IllegalArgumentException && e !is IllegalStateException && e !is java.io.IOException && e !is ApkUpdater.UpdateException && e !is org.json.JSONException)
                Quiet.note("WebServer.route", e)
            json(Response.Status.BAD_REQUEST, JSONObject().put("error", e.message ?: "bad request"))
        }
        // Plugin-facing routes are logged (route kind, status, time; never commands, queries, cookies or bodies).
        if (pluginKind != null) {
            val ms = (System.nanoTime() - t0) / 1_000_000L
            val code = resp.status.requestStatus
            LogCatcher.log(PluginLog.level(code, ms), pluginKind, PluginLog.message(s.method.name, uri, code, ms))
        }
        return resp
    }

    internal val auditLock = Any()

    /**
     * One line per console root command: time, client address and a short SHA-256 of the command (never the command
     * text, which can hold passwords). Kept in the app's private folder, so it needs no root call, takes no root slot and
     * is written even while root is denied. Trimmed to its newest ~32 KB once it passes 64 KB.
     */
    internal fun auditShell(ip: String, command: String, kind: String = "shell") {
        try {
            val h = MessageDigest.getInstance("SHA-256").digest(command.toByteArray(Charsets.UTF_8)).take(6).joinToString("") { "%02x".format(it) }
            val stamp = java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss", java.util.Locale.US).format(java.util.Date())
            synchronized(auditLock) {
                val f = File(ctx.filesDir, "shell_audit.log")
                if (f.length() > 64 * 1024) {
                    val tail = String(f.readBytes().takeLast(32 * 1024).toByteArray(), Charsets.UTF_8)
                    f.writeText(tail.substringAfter('\n', tail))
                }
                f.appendText("$stamp $kind ip=$ip sha256=$h len=${command.length}\n")
            }
        } catch (e: Exception) { Quiet.note("WebServer.auditShell", e) }
    }

    private val busyAudit = HashMap<String, Long>()

    /**
     * For calls that tools make many times a second (screen taps, AT polling): at most one audit line per client and kind per
     * 60 s, so they cannot push the rarer, more important entries (shell, USB, IMEI, update) out of the size-capped log.
     */
    internal fun auditBusy(ip: String, kind: String) {
        val now = System.currentTimeMillis()
        val key = "$kind|$ip"
        val log = synchronized(busyAudit) {
            if (busyAudit.size > 200) busyAudit.clear()
            val last = busyAudit[key] ?: 0L
            if (now - last >= 60_000L) { busyAudit[key] = now; true } else false
        }
        if (log) auditShell(ip, "$kind (first call in 60 s)", kind)
    }

    /** Password login: starts a session and sets its cookie. Bad attempts count toward the per-IP lockout. */
    internal fun login(ip: String, s: IHTTPSession): Response {
        val pw = try { body(s, MAX_LOGIN_BODY).optString("password").take(200) } catch (e: Exception) {
            return json(Response.Status.BAD_REQUEST, JSONObject().put("error", "bad request"))
        }
        // Only the admin password logs in. The old permanent access token is no longer accepted as a password.
        var good = Prefs.hasAdminPassword(ctx) && Prefs.checkAdminPassword(ctx, pw)
        // The web console accepts the router's own admin password: if it is not what is stored (nothing stored yet,
        // or the router password was changed), ask the router. When it accepts, remember it for the SMS / signal tools.
        // Skipped after 3 bad tries from this address so the router's own login lockout is not triggered.
        // The router is asked at most 3 times per address AND 3 times per 10 minutes in total (see LoginGuard.mayAskRouter).
        if (!good && pw.isNotEmpty() && !Prefs.hasConsolePassword(ctx) && guard.failCount(ip) < 3 && guard.mayAskRouter(ip) && ZteClient.verify(ctx, pw) == true) {
            Prefs.setZtePass(ctx, pw)
            Sessions.revokeAll(ctx)   // the password changed (or was learned): every older session ends
            good = true
        }
        if (!good) {
            val loop = isLoopbackIp(ip)
            guard.failed(ip, loop)
            auditBusy(ip, "login-failed")   // one line per client per minute: visible to the owner, cannot flood the log
            if (loop) {
                // Apps on the phone share 127.0.0.1: answer late instead of locking, but with a bounded number of waiting threads.
                if (!guard.enterLoopbackDelay())
                    return json(tooMany, JSONObject().put("error", "too many bad attempts, wait a few seconds")).also { it.addHeader("Retry-After", "5") }
                try { Thread.sleep(guard.loopbackDelayMs()) } catch (_: InterruptedException) { Thread.currentThread().interrupt() }
                finally { guard.leaveLoopbackDelay() }
            }
            return json(Response.Status.UNAUTHORIZED, JSONObject().put("error", "Wrong password"))
        }
        guard.succeeded(ip, isLoopbackIp(ip))
        // A fresh random token for THIS login; it expires when idle, after 12 h, on sign-out or on a password change.
        // The token goes into an HttpOnly cookie and NOT into the reply, so page script and plugins never see it (SessionCookie.kt).
        return json(Response.Status.OK, JSONObject().put("ok", true))
            .also { it.addHeader("Set-Cookie", sessionCookieHeader(Sessions.issue(ctx), Tls.active)) }
    }

    private fun route(s: IHTTPSession, uri: String): Response =
        routeDevice(s, uri) ?: routeAuth(s, uri) ?: routeLogs(s, uri) ?: routeRoot(s, uri) ?: routeUpdate(s, uri)
            ?: routeRouter(s, uri) ?: routePlugins(s, uri)
            ?: json(Response.Status.NOT_FOUND, JSONObject().put("error", "not found"))
}

private val IPV4_HOST = Regex("^(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])(\\.(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])){3}$")
private val IPV6_HOST = Regex("^[0-9A-Fa-f:.]{2,45}$")

private fun hostPortOk(s: String): Boolean = s.length in 2..6 && s[0] == ':' && s.substring(1).all { it in '0'..'9' }

/**
 * True only for a Host header that is an IPv4 literal, a bracketed IPv6 literal or "localhost", with an optional
 * port. Pure string checks: nothing is resolved, so a host name is never looked up.
 */
internal fun hostHeaderAllowed(raw: String?): Boolean {
    val h = raw?.trim().orEmpty()
    if (h.isEmpty() || h.length > 64) return false
    if (h.startsWith("[")) {
        val end = h.indexOf(']')
        if (end < 0) return false
        val rest = h.substring(end + 1)
        if (rest.isNotEmpty() && !hostPortOk(rest)) return false
        val inner = h.substring(1, end)
        return inner.contains(':') && IPV6_HOST.matches(inner)
    }
    val colon = h.lastIndexOf(':')
    val name = if (colon >= 0) {
        if (!hostPortOk(h.substring(colon))) return false
        h.substring(0, colon)
    } else h
    return name.equals("localhost", ignoreCase = true) || IPV4_HOST.matches(name)
}

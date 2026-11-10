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

class WebServer(private val ctx: Context, port: Int, bindAddress: String = "127.0.0.1") : NanoHTTPD(bindAddress, port) {
    private val pluginDir = File(ctx.filesDir, "plugins").apply { mkdirs() }
    private val nameRx = Regex("^[A-Za-z0-9._-]{1,80}\\.(js|html)$")
    // Files handed to plugins (UFI-TOOLS plugins expect an upload endpoint). Root plugins read them from this folder.
    private val uploadDir = File(ctx.filesDir, "uploads").apply { mkdirs() }
    private val uploadNameRx = Regex("^[A-Za-z0-9._-]{1,120}$")
    private val MAX_UPLOAD_BYTES = 512L * 1024L * 1024L
    private val MAX_UPLOAD_TOTAL_BYTES = 1024L * 1024L * 1024L

    // Brute-force protection for /api/login (per-IP + global back-off, router-forward budget): see LoginGuard.
    private val guard = LoginGuard()
    // Every root-capable call needs a login that is recent, not just a live 12 h session: see rootGate().
    private val SHELL_MAX_SESSION_MS = RootGate.MAX_SESSION_MS

    /**
     * One rule for everything that runs as root or makes root run something (shell, AT writes, IMEI, USB mode, screen input,
     * APK install, plugin upload/erase): plain HTTP needs the page's confirmation, and the sign-in must be younger than 4 h.
     * Returns the 403 answer to send, or null when the call may go on. The codes ("insecure", "reauth") are the ones the page handles.
     */
    private fun rootGate(s: IHTTPSession): Response? {
        val ip = s.remoteIpAddress ?: "?"
        if (RootGate.insecureNeedsConfirm(Tls.active, isLoopbackIp(ip), s.headers["x-insecure-ok"]))
            return json(Response.Status.FORBIDDEN, JSONObject().put("code", "insecure").put("error", "This connection is not encrypted (HTTP). Confirm in the page to run root commands anyway."))
        if (!RootGate.freshEnough(Sessions.ageMs(ctx, s.headers["x-token"]), SHELL_MAX_SESSION_MS))
            return json(Response.Status.FORBIDDEN, JSONObject().put("code", "reauth").put("error", "Session too old for root commands - sign in again"))
        return null
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

    /** True when the request carries a live per-login session token (see [SessionStore]). */
    private fun authed(s: IHTTPSession): Boolean = Sessions.validate(ctx, s.headers["x-token"])


    /**
     * Every app on the device reaches the console as 127.0.0.1 / ::1, so they would all share one lockout bucket and one
     * app could lock the owner out (or the owner's typos could lock apps out). Loopback is therefore never hard-locked;
     * each bad password from it is answered after a short delay instead (see [login]).
     */
    private fun isLoopbackIp(raw: String): Boolean {
        val x = raw.substringBefore('%').lowercase().removePrefix("::ffff:")
        return x == "::1" || x == "0:0:0:0:0:0:0:1" || x == "localhost" || x.startsWith("127.")
    }

    private val snapshotBusy = java.util.concurrent.Semaphore(1)
    private val tooMany = object : Response.IStatus {
        override fun getRequestStatus() = 429
        override fun getDescription() = "429 Too Many Requests"
    }

    /**
     * NanoHTTPD 2.3.1 decides gzip per response AFTER serve() returns (text/ * and JSON when the browser accepts it), which
     * overrides setGzipEncoding(false) set in [harden]; its GZIPOutputStream is never closed, so every answer leaked a native
     * Deflater ("A resource failed to call end." in the log). Switching it off here is the hook NanoHTTPD provides.
     */
    override fun useGzipWhenAccepted(r: Response): Boolean = false

    private fun harden(response: Response): Response = response.also {
        // NanoHTTPD 2.3.1 gzips text/* and JSON itself but only calls finish() on its GZIPOutputStream, never close(),
        // so every compressed answer leaks a native Deflater until the GC finalizer logs "A resource failed to call end".
        // Compression is therefore switched off here; the one large body (the page) is gzipped once below.
        it.setGzipEncoding(false)
        it.addHeader("Cache-Control", "no-store")
        it.addHeader("X-Content-Type-Options", "nosniff")
        it.addHeader("X-Frame-Options", "DENY")
        it.addHeader("Referrer-Policy", "no-referrer")
        it.addHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        // Plugins are trusted code that runs through new Function and may call other hosts (IP / DNS checks), so script
        // 'unsafe-eval' and open connect-src stay; everything else is closed: no framing, no <base>, no plugins, own forms only.
        it.addHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' http: https:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
        // NanoHTTPD 2.3.1 does not skip a request body the handler never read. An error answer (401/403/429/...) may
        // have been sent before the body was consumed, so close the connection instead of letting the leftover bytes
        // be parsed as the start of the next keep-alive request.
        if (it.status.requestStatus >= 400) it.addHeader("Connection", "close")
    }

    /** UFI-TOOLS shell reply: {"result": ..., "error": ...}; the one that does not apply is JSON null. */
    /** UFI's shell routes (read from its advancedToolsModule.kt): {"result":...} with 200, or {"error":"..."} with HTTP 500. */
    private fun ufiShellReply(result: Any?, error: String?): Response =
        if (error == null) json(Response.Status.OK, JSONObject().put("result", result ?: JSONObject.NULL))
        else json(Response.Status.INTERNAL_ERROR, JSONObject().put("error", error))

    /**
     * Parameters of a forwarded router request: the query string, plus for a POST the body (a JSON object, or a form when it
     * does not start with "{"). At most 64 KB of body is read; a missing Content-Length means an empty body.
     */
    private fun gatewayParams(s: IHTTPSession): Map<String, String> {
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

    private fun json(code: Response.IStatus, o: Any) = harden(newFixedLengthResponse(code, "application/json; charset=utf-8", o.toString()))

    // NanoHTTPD 2.3.1 decodes a request body with no charset as US-ASCII, so every non-ASCII character in a posted
    // plugin (the dots, ellipses and check marks in Bypass, for one) was saved as U+FFFD and showed as "?" boxes.
    // The JSON body is therefore read as raw bytes and decoded as UTF-8 here, whatever the Content-Type says.
    private val MAX_JSON_BODY = 16 * 1024 * 1024

    private val MAX_LOGIN_BODY = 4 * 1024

    /**
     * Reads a JSON request body of at most [max] bytes. A missing Content-Length means an empty body, and a larger or
     * invalid length is refused BEFORE anything is read: the old fallback handed such requests to NanoHTTPD's parseBody,
     * which spools the whole body to a temp file, so /api/login (open to every hotspot client) could be used to fill
     * memory or the cache folder without a password.
     */
    private fun body(s: IHTTPSession, max: Int = MAX_JSON_BODY): JSONObject {
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
    private val pageTag by lazy { "\"" + MessageDigest.getInstance("SHA-256").digest(pageBytes).take(8).joinToString("") { "%02x".format(it) } + "\"" }

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


    /** Paths to erase for a plugin: (allowed, rejected with reason). The plugin's own data folder is always included. */
    private fun pluginDataPlan(name: String): Pair<List<String>, List<Pair<String, String>>> {
        val f = File(pluginDir, name)
        val code = if (f.isFile) try { f.readText() } catch (_: Exception) { "" } else ""
        val ok = ArrayList<String>()
        val bad = ArrayList<Pair<String, String>>()
        ok.add(pluginDataDir(name))
        for (d in pluginDataDeclarations(code)) {
            val why = checkPluginDataPath(d, name)
            if (why == null) { if (d !in ok) ok.add(d) } else bad.add(d to why)
        }
        return ok to bad
    }

    // Paths passed the strict character check in checkPluginDataPath, so they cannot break out of single quotes.
    private fun quotedList(paths: List<String>) = paths.joinToString(" ") { "'$it'" }

    private fun probeScript(paths: List<String>) =
        "for p in ${quotedList(paths)}; do if [ -e \"\$p\" ] || [ -L \"\$p\" ]; then " +
        "echo \"EXISTS \$(du -sk -- \"\$p\" 2>/dev/null | cut -f1) \$p\"; fi; done; true"

    // rm -rf on a symlink removes the link itself, never what it points to, but it DOES follow a symlink in a parent folder.
    // So every folder between the allowed root and the path is tested with [ -L ] first, and the path is skipped if one is a link.
    private fun eraseScript(paths: List<String>) = paths.joinToString("\n") { p ->
        val links = symlinkAncestors(p).joinToString(" || ") { "[ -L '$it' ]" }.ifEmpty { "false" }
        "if [ -e '$p' ] || [ -L '$p' ]; then if $links; then echo \"SKIPPED $p\"; " +
        "elif rm -rf -- '$p'; then echo \"REMOVED $p\"; else echo \"FAILED $p\"; fi; fi"
    } + "\ntrue"

    /** Last [maxBytes] of a file as text, and whether the start was cut (the first partial line is dropped then). */
    private fun readTail(file: File, maxBytes: Long): Pair<String, Boolean> {
        val len = file.length()
        val start = (len - maxBytes).coerceAtLeast(0L)
        java.io.RandomAccessFile(file, "r").use { raf ->
            raf.seek(start)
            val buf = ByteArray((len - start).toInt())
            raf.readFully(buf)
            var text = String(buf, Charsets.UTF_8)
            if (start > 0) text = text.substringAfter('\n', "")
            return text to (start > 0)
        }
    }

    private val auditLock = Any()

    /**
     * One line per console root command: time, client address and a short SHA-256 of the command (never the command
     * text, which can hold passwords). Kept in the app's private folder, so it needs no root call, takes no root slot and
     * is written even while root is denied. Trimmed to its newest ~32 KB once it passes 64 KB.
     */
    private fun auditShell(ip: String, command: String, kind: String = "shell") {
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
    private fun auditBusy(ip: String, kind: String) {
        val now = System.currentTimeMillis()
        val key = "$kind|$ip"
        val log = synchronized(busyAudit) {
            if (busyAudit.size > 200) busyAudit.clear()
            val last = busyAudit[key] ?: 0L
            if (now - last >= 60_000L) { busyAudit[key] = now; true } else false
        }
        if (log) auditShell(ip, "$kind (first call in 60 s)", kind)
    }

    /** Password login: returns the session token. Bad attempts count toward the per-IP lockout. */
    private fun login(ip: String, s: IHTTPSession): Response {
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
        return json(Response.Status.OK, JSONObject().put("ok", true).put("token", Sessions.issue(ctx)))
    }

    /** Read-only diagnostics: no modem settings or partitions are modified. */
    /** Per-source counters of the in-app capture for /api/logs/status (see SourceCounters). */
    private fun countersJson(): JSONObject {
        val o = JSONObject()
        SourceStats.all().forEach { (name, c) ->
            o.put(name, JSONObject().put("seen", c.seen).put("passed", c.passed).put("collapsed", c.collapsed)
                .put("dropped", c.dropped).put("gaps", c.gaps))
        }
        return o.put("queueDropped", SourceStats.queueDropped.get()).put("swallowedErrors", Quiet.total())
    }

    private fun diagnostics(): Response {
        val script = """
            echo '--- identity ---'; id
            echo '--- platform ---'; getprop ro.product.manufacturer; getprop ro.product.model; getprop ro.build.version.release; getprop ro.build.version.sdk
            echo '--- kernel ---'; uname -a
            echo '--- architecture ---'; getprop ro.product.cpu.abi; getprop ro.product.cpu.abilist
            echo '--- network ---'; ip -brief address 2>/dev/null || ip addr 2>/dev/null | head -80
            echo '--- routes (main table) ---'; ip route 2>/dev/null; ip -6 route 2>/dev/null
            echo '--- policy routing rules ---'; ip rule 2>/dev/null | head -30
            echo '--- default routes in all tables ---'; ip route show table all 2>/dev/null | grep '^default' | head -10; echo '(empty = no default route in any table)'
            echo '--- dns ---'; getprop 2>/dev/null | grep -iE 'dns[0-9]' | head -8
            echo '--- tool availability ---'
            for x in busybox ip nft iptables ip6tables tc bpftool; do p=$(command -v "${'$'}x" 2>/dev/null); echo "${'$'}x: ${'$'}{p:-unavailable}"; done
            [ -x "${ctx.filesDir.absolutePath}/sendat" ] && echo "sendat: ${ctx.filesDir.absolutePath}/sendat" || echo "sendat: unavailable"
            [ -x "${ctx.filesDir.absolutePath}/curl" ] && echo "curl: ${ctx.filesDir.absolutePath}/curl (bundled)" || echo "curl: bundled copy unavailable"
            [ -x /data/local/matchitool/dpi/nfqws ] && echo "nfqws: /data/local/matchitool/dpi/nfqws" || echo "nfqws: not installed (optional)"
            echo '--- root capabilities ---'; [ "$(id -u)" = 0 ] && echo 'UID 0 confirmed' || echo 'root unavailable'
            echo '--- storage ---'; df -h /data 2>/dev/null; echo '(the mount point shown can be a bind mount such as Android/obb; it is the same /data partition)'; grep ' /data ' /proc/mounts | head -1 | cut -d' ' -f1-3
        """.trimIndent()
        val r = RootShell.run(ctx, script, 30_000)
        return json(Response.Status.OK, JSONObject().put("success", r.success).put("report", r.content).put("generatedAt", System.currentTimeMillis()))
    }

    /** Inspect XML/scatter text only. This endpoint never writes or flashes a device. */
    private fun inspectFirmware(req: JSONObject): Response {
        val name = req.optString("name").take(160)
        val content = req.optString("content")
        if (content.isBlank() || content.length > 2_000_000) throw IllegalArgumentException("Firmware manifest must be 1 byte to 2 MB")
        val lower = content.lowercase()
        val format = when {
            lower.contains("<?xml") || lower.contains("<partition") || lower.contains("<program") -> "xml"
            lower.contains("partition_name:") || lower.contains("- partition_index:") -> "scatter"
            else -> "text/unknown"
        }
        val labels = Regex("""(?im)^\s*(?:<partition[^>]*name=|partition_name\s*:\s*)(?:"([^"]+)"|'([^']+)'|([^\s>]+))""")
        val partitions = linkedSetOf<String>()
        labels.findAll(content).forEach { m -> (1..3).firstNotNullOfOrNull { m.groups[it]?.value }?.let { partitions.add(it) } }
        val sha = MessageDigest.getInstance("SHA-256").digest(content.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
        val device = JSONObject()
        val checks = JSONArray()
        val warnings = JSONArray()
        val manifestModels = Regex("""(?im)(?:product|model|project|platform|target)[_\s:=<>\"']+([A-Za-z0-9._-]{2,80})""")
            .findAll(content).map { it.groupValues[1] }.distinct().take(30).toList()
        val manifestPartitions = partitions.toList()
        val risky = manifestPartitions.filter { it.lowercase() in setOf("preloader", "xbl", "abl", "boot", "vendor_boot", "vbmeta", "super", "modem", "persist", "userdata") }
        if (format == "text/unknown") warnings.put("Unrecognized manifest format; no compatibility conclusion can be made")
        if (format == "xml") {
            try {
                val parser = Xml.newPullParser()
                parser.setInput(StringReader(content))
                while (parser.next() != XmlPullParser.END_DOCUMENT) { /* well-formedness check only */ }
                checks.put(JSONObject().put("check", "XML well-formedness").put("status", "valid"))
            } catch (e: Exception) {
                checks.put(JSONObject().put("check", "XML well-formedness").put("status", "invalid"))
                warnings.put("XML parser rejected this manifest: ${e.message ?: "parse error"}")
            }
        }
        if (manifestPartitions.isEmpty()) warnings.put("No partition names were recognized")
        if (risky.isNotEmpty()) warnings.put("Manifest includes boot-critical or device-specific partitions: ${risky.joinToString(", ")}")
        checks.put(JSONObject().put("check", "manifest format").put("status", if (format == "xml" || format == "scatter") "recognized" else "unknown"))
        checks.put(JSONObject().put("check", "partition metadata").put("status", if (manifestPartitions.isNotEmpty()) "found" else "not found"))
        checks.put(JSONObject().put("check", "device identity").put("status", "not verified").put("detail", "Manifest model labels are hints only; exact hardware and build compatibility requires a trusted device-specific source"))
        val summary = JSONObject().put("fileName", name).put("format", format).put("sizeBytes", content.toByteArray(Charsets.UTF_8).size)
            .put("sha256", sha).put("partitionCount", partitions.size).put("partitions", JSONArray(partitions.take(250)))
            .put("manifestModelHints", JSONArray(manifestModels)).put("criticalPartitionHints", JSONArray(risky))
            .put("checks", checks).put("warnings", warnings).put("flashPerformed", false)
            .put("warning", "This is a static manifest preflight, not proof of compatibility. Never flash based only on filename, model hints, or partition names.")
        return json(Response.Status.OK, summary)
    }

    /** USB controls expose Android gadget modes; support is confirmed from live USB properties/sysfs. */
    private fun usbStatus(): Response {
        val script = """
            echo "ADB=$(settings get global adb_enabled 2>/dev/null | tr -d '\r')"
            echo "CONFIG=$(getprop sys.usb.config | tr -d '\r')"
            echo "STATE=$(getprop sys.usb.state | tr -d '\r')"
            echo "PERSIST=$(getprop persist.sys.usb.config | tr -d '\r')"
            echo "RNDIS_SUPPORTED=$(for f in /config/usb_gadget/*/functions/rndis.* /sys/kernel/config/usb_gadget/*/functions/rndis.*; do [ -e "${'$'}f" ] && { echo 1; exit; }; done; case "$(getprop sys.usb.config),$(getprop sys.usb.state)" in *rndis*) echo 1;; *) echo 0;; esac)"
            echo "ECM_SUPPORTED=$(for f in /config/usb_gadget/*/functions/ecm.* /sys/kernel/config/usb_gadget/*/functions/ecm.* /config/usb_gadget/*/functions/cdc_ecm.* /sys/kernel/config/usb_gadget/*/functions/cdc_ecm.*; do [ -e "${'$'}f" ] && { echo 1; exit; }; done; case "$(getprop sys.usb.config),$(getprop sys.usb.state)" in *ecm*) echo 1;; *) echo 0;; esac)"
            echo "NETIFS=$(ip -o link show 2>/dev/null | sed 's/: .*//' | tr '\n' ' ')"
        """.trimIndent()
        val r = RootShell.run(ctx, script, 15_000)
        val lines = r.content.lines().mapNotNull { line ->
            val i = line.indexOf('='); if (i > 0) line.substring(0, i) to line.substring(i + 1).trim() else null
        }.toMap()
        val adb = lines["ADB"] == "1"
        val config = lines["CONFIG"].orEmpty()
        val state = lines["STATE"].orEmpty()
        val active = "$config,$state"
        val rndis = active.contains("rndis", true)
        val ecm = active.contains("ecm", true)
        return json(Response.Status.OK, JSONObject().put("success", r.success).put("adbEnabled", adb)
            .put("usbConfig", config).put("usbState", state).put("persistConfig", lines["PERSIST"].orEmpty())
            .put("rndisActive", rndis).put("ecmActive", ecm).put("usbTethering", rndis || ecm)
            .put("rndisSupported", lines["RNDIS_SUPPORTED"] == "1").put("ecmSupported", lines["ECM_SUPPORTED"] == "1")
            .put("networkInterfaces", lines["NETIFS"].orEmpty()).put("detail", r.content))
    }

    // Shell snippets are written with § in place of $ so Kotlin does not treat shell variables as templates.
    private val USB_UNBRIDGE = "for IF in usb0 rndis0 ecm0 ncm0; do ip link set \"§IF\" nomaster 2>/dev/null; done; ".replace('§', '$')

    /** Switch the USB gadget function the way this ZTE/Unisoc build expects (via init's sys.usb.config triggers;
     *  `svc usb setFunctions` gets SIGKILLed on the F50), verify it in configfs, then bring the new USB network
     *  interface up and bridge it into br0 (the hotspot LAN) so a PC on the cable gets DHCP/NAT. */
    private fun usbEnableScript(fn: String): String = """
        has() { ls -l /config/usb_gadget/*/configs/*/ 2>/dev/null | grep -qi "§1"; }
        ADB="§(settings get global adb_enabled 2>/dev/null | tr -d '\r')"
        if [ "§ADB" = 1 ]; then CANDS="$fn,mtp,adb $fn,adb"; else CANDS="$fn,mtp $fn"; fi
        echo "Before: sys.usb.config=§(getprop sys.usb.config)"
        OK=0
        for C in §CANDS; do
          echo "Trying sys.usb.config=§C"
          setprop sys.usb.config "§C"
          sleep 3
          if has $fn; then OK=1; echo "Active with §C"; break; fi
        done
        if [ §OK = 0 ]; then
          echo "init did not apply it; trying svc (10 s limit)"
          # svc accepts ONE function only (no ",adb", no "ecm"); anything else makes it crash with IllegalArgumentException
          case "$fn" in
            rndis) timeout 10 svc usb setFunctions rndis 2>&1; sleep 3; has $fn && OK=1 ;;
            *) echo "svc cannot set $fn (not an Android USB function), skipped" ;;
          esac
        fi
        for IF in usb0 rndis0 ecm0 ncm0; do
          if ip link show "§IF" >/dev/null 2>&1; then
            ip link set "§IF" up 2>&1
            ip link set "§IF" master br0 2>&1 && echo "bridged §IF into br0"
          fi
        done
        echo "--- gadget ---"
        echo "config=§(getprop sys.usb.config) state=§(getprop sys.usb.state)"
        ls -l /config/usb_gadget/*/configs/*/ 2>&1 | grep -- '->'
        ls /config/usb_gadget/*/functions 2>&1
        ip -o link show 2>/dev/null | grep -E 'usb|rndis|ecm|ncm|br0' || true
        if [ §OK = 0 ]; then echo "USB function $fn is not active"; exit 3; fi
    """.trimIndent().replace('§', '$')

    /** Back to the saved default mode without rndis / ecm, keeping adb if it is on. Applied through init (sys.usb.config)
     *  like the enable path; `svc usb setFunctions` is only a fallback and only ever gets ONE plain function, because
     *  "mtp,adb" or "ecm" make it throw IllegalArgumentException (that was the crash seen in the logcat). */
    private val USB_RESTORE = """
        BASE="§(getprop persist.sys.usb.config)"; [ -n "§BASE" ] || BASE=mtp
        BASE="§(printf '%s' "§BASE" | sed 's/\(^\|,\)rndis\($\|,\)/\1/g; s/\(^\|,\)ecm\($\|,\)/\1/g; s/\(^\|,\)cdc_ecm\($\|,\)/\1/g; s/,,*/,/g; s/^,//; s/,$//')"
        [ -n "§BASE" ] || BASE=mtp
        if [ "§(settings get global adb_enabled 2>/dev/null | tr -d '\r')" = 1 ]; then case ",§BASE," in *,adb,*) ;; *) BASE="§BASE,adb" ;; esac; fi
        echo "Restoring sys.usb.config=§BASE"
        setprop sys.usb.config "§BASE"
        sleep 3
        if [ "§(getprop sys.usb.config)" != "§BASE" ]; then
          S="§(printf '%s' "§BASE" | tr ',' '\n' | grep -vx adb | head -n 1)"
          case "§S" in
            mtp|ptp|midi|ncm) echo "init did not apply it; trying svc usb setFunctions §S"; timeout 10 svc usb setFunctions "§S" 2>&1; sleep 2 ;;
            *) echo "svc fallback skipped (§S is not a single Android USB function)" ;;
          esac
        fi
        echo "config=§(getprop sys.usb.config) state=§(getprop sys.usb.state)"
        [ -n "§(getprop sys.usb.config)" ]
    """.trimIndent().replace('§', '$')

    private fun controlUsb(req: JSONObject): Response {
        val action = req.optString("action")
        val restoreDefault = USB_RESTORE
        val script = when (action) {
            "adb_enable" -> "settings put global adb_enabled 1 && [ \"$(settings get global adb_enabled)\" = 1 ]"
            "adb_disable" -> "settings put global adb_enabled 0 && [ \"$(settings get global adb_enabled)\" = 0 ]"
            "rndis_enable" -> usbEnableScript("rndis")
            "ecm_enable" -> usbEnableScript("ecm")
            "tether_disable" -> USB_UNBRIDGE + restoreDefault
            else -> throw IllegalArgumentException("unsupported USB action")
        }
        // The script runs in a subshell so its own "exit N" cannot skip the diagnostics. On failure, append the exit code and USB-related props so the UI can show why it failed.
        val wrapped = "( $script\n)\nrc=${'$'}?\nif [ ${'$'}rc -ne 0 ]; then echo \"[exit code ${'$'}rc]\"; command -v svc || echo 'svc: not found'; getprop | grep -i usb | head -20; fi\nexit ${'$'}rc"
        val r = RootShell.run(ctx, wrapped, 40_000)
        // Always HTTP 200: the web UI only shows `output` when the response is not an HTTP error.
        return json(Response.Status.OK,
            JSONObject().put("success", r.success).put("action", action).put("output", r.content.ifBlank { "Command failed with no output" })
                .put("note", "USB gadget mode is firmware-dependent. Re-read USB status after switching; reconnect the cable if Android does not re-enumerate the USB device."))
    }

    /** The next JPEG frame newer than ?since= (waits up to 3.5 s; 204 = screen unchanged). Real screen size goes back in X-Screen-W / X-Screen-H. */
    private fun screenFrame(s: IHTTPSession): Response {
        val scale = s.parameters["scale"]?.firstOrNull()?.toIntOrNull() ?: 50
        val quality = s.parameters["q"]?.firstOrNull()?.toIntOrNull() ?: 60
        val since = s.parameters["since"]?.firstOrNull()?.toLongOrNull() ?: 0L
        return try {
            val shot = ScreenStreamer.next(ctx, since, scale, quality, 3_500L, s.remoteIpAddress ?: "?")
            if (shot == null) {
                harden(newFixedLengthResponse(Response.Status.NO_CONTENT, "text/plain", ""))
            } else {
                val f = shot.frame
                harden(newFixedLengthResponse(Response.Status.OK, "image/jpeg", ByteArrayInputStream(f.jpeg), f.jpeg.size.toLong())).also {
                    it.addHeader("Cache-Control", "no-store")
                    it.addHeader("X-Screen-W", f.width.toString())
                    it.addHeader("X-Screen-H", f.height.toString())
                    it.addHeader("X-Frame-Seq", shot.seq.toString())
                    it.addHeader("X-Capture-Mode", ScreenStreamer.modeName())
                    it.addHeader("X-Screen-Scale", ScreenStreamer.currentScale().toString())
                }
            }
        } catch (e: Exception) {
            json(Response.Status.INTERNAL_ERROR, JSONObject().put("error", e.message ?: "screen capture failed"))
        }
    }

    /** Inject a tap / swipe / key / text event: {"type":"tap","x":100,"y":200}. */
    private fun screenInput(req: JSONObject): Response {
        val r = ScreenCapture.input(ctx, req)
        return json(Response.Status.OK, JSONObject().put("success", r.success).put("output", r.content))
    }

    // NanoHTTPD copies the whole body to a temp file BEFORE any of our checks run, so the limits are enforced up front:
    // one upload at a time (both upload routes share the slot) and enough free space for the announced size plus a reserve.
    private val uploadSlot = java.util.concurrent.Semaphore(1)

    private fun <T> withUploadSlot(len: Long, block: () -> T): T {
        if (!uploadSlot.tryAcquire()) throw IllegalArgumentException("Another upload is in progress; try again when it has finished")
        try {
            val free = try { android.os.StatFs(ctx.cacheDir.absolutePath).availableBytes } catch (_: Exception) { Long.MAX_VALUE }
            if (!uploadSpaceOk(free, len)) throw IllegalArgumentException("Not enough free space on the device for this upload")
            return block()
        } finally { uploadSlot.release() }
    }

    /**
     * Multipart upload (field "file") for plugins: {"ok":true,"name":"x.tar.gz","url":"/uploads/x.tar.gz","path":"..."}.
     * The name is sanitised to [A-Za-z0-9._-]; an existing file of the same name is replaced.
     */
    private fun uploadFile(s: IHTTPSession, viaUfiRoute: Boolean = false): Response {
        val len = s.headers["content-length"]?.toLongOrNull() ?: -1L
        if (len < 0 || len > MAX_UPLOAD_BYTES + 1_000_000L)
            throw IllegalArgumentException("Upload must be at most ${MAX_UPLOAD_BYTES / 1024 / 1024} MB")
        auditShell(s.remoteIpAddress ?: "?", "len=$len", "upload")
        return withUploadSlot(len) { uploadFileLocked(s, viaUfiRoute) }
    }

    private fun uploadFileLocked(s: IHTTPSession, viaUfiRoute: Boolean): Response {
        val files = HashMap<String, String>()
        s.parseBody(files)
        val tmp = files["file"]?.let { File(it) } ?: throw IllegalArgumentException("No file received (multipart field \"file\")")
        try {
            val original = s.parameters["file"]?.firstOrNull().orEmpty()
            var name = original.substringAfterLast('/').substringAfterLast('\\').replace(Regex("[^A-Za-z0-9._-]"), "_").take(120)
            if (name.isBlank() || name.all { it == '.' || it == '_' }) name = "upload_" + System.currentTimeMillis()
            if (name.startsWith(".")) name = "_$name"
            if (!uploadNameRx.matches(name) || name.contains("..")) throw IllegalArgumentException("invalid file name")
            val dest = File(uploadDir, name)
            val used = uploadDir.listFiles()?.filter { it.isFile && it.name != name }?.sumOf { it.length() } ?: 0L
            if (used + tmp.length() > MAX_UPLOAD_TOTAL_BYTES)
                throw IllegalArgumentException("Upload folder is full; delete old uploads first")
            if (!tmp.renameTo(dest)) { tmp.copyTo(dest, overwrite = true) }
            dest.setReadable(true, false)
            // UFI's /upload_img replies "/uploads/NAME" and its plugins cut that prefix off to get the file name; /api/upload keeps "/api/uploads/NAME".
            val url = (if (viaUfiRoute) "/uploads/" else "/api/uploads/") + name
            return json(Response.Status.OK, JSONObject().put("ok", true).put("name", name)
                .put("url", url).put("path", dest.absolutePath).put("size", dest.length()))
        } finally {
            try { if (tmp.exists()) tmp.delete() } catch (e: Exception) { Quiet.note("WebServer.uploadFileLocked", e) }
        }
    }

    /** Streams a previously uploaded (or root-copied) file from the uploads folder. */
    private fun serveUpload(name: String): Response {
        if (!uploadNameRx.matches(name) || name.contains(".."))
            throw IllegalArgumentException("invalid file name")
        val f = File(uploadDir, name)
        if (!f.isFile) return json(Response.Status.NOT_FOUND, JSONObject().put("error", "file not found"))
        val r = newFixedLengthResponse(Response.Status.OK, "application/octet-stream", java.io.FileInputStream(f), f.length())
        r.addHeader("Content-Disposition", "attachment; filename=\"$name\"")
        return harden(r)
    }

    private fun deleteUpload(name: String): Response {
        if (!uploadNameRx.matches(name) || name.contains(".."))
            throw IllegalArgumentException("invalid file name")
        return json(Response.Status.OK, JSONObject().put("ok", File(uploadDir, name).delete()))
    }

    /** Multipart upload (field "apk"): saved to a temp file by NanoHTTPD, then size-capped, parsed and verified by ApkUpdater. */
    private fun updateStage(s: IHTTPSession): Response {
        val len = s.headers["content-length"]?.toLongOrNull() ?: -1L
        if (len < 0 || len > ApkUpdater.MAX_BYTES + 1_000_000L)
            throw IllegalArgumentException("Upload must be at most ${ApkUpdater.MAX_BYTES / 1024 / 1024} MB")
        auditShell(s.remoteIpAddress ?: "?", "len=$len", "update-stage")
        return withUploadSlot(len) { updateStageLocked(s) }
    }

    private fun updateStageLocked(s: IHTTPSession): Response {
        val files = HashMap<String, String>()
        s.parseBody(files)
        val tmp = files["apk"]?.let { File(it) } ?: throw IllegalArgumentException("No file received (multipart field \"apk\")")
        val staged = try { ApkUpdater.stageFile(ctx, tmp) } finally { try { tmp.delete() } catch (e: Exception) { Quiet.note("WebServer.updateStageLocked", e) } }
        return json(Response.Status.OK, JSONObject().put("ok", true)
            .put("oldName", staged.oldName).put("oldCode", staged.oldCode)
            .put("newName", staged.newName).put("newCode", staged.newCode)
            .put("relation", staged.relation)
            .put("size", staged.size).put("sha256", staged.sha256).put("installedSha256", staged.installedSha))
    }

    /** OTA step 1: {"url":"https://..."}; asks what the link points to (version, size) without downloading the APK. */
    private fun updateCheck(req: JSONObject): Response {
        val r = ApkUpdater.check(ctx, req.optString("url"))
        return json(Response.Status.OK, JSONObject().put("ok", true)
            .put("installedName", r.installedName).put("installedCode", r.installedCode)
            .put("remoteName", r.remoteName).put("relation", r.relation)
            .put("size", r.size).put("sha256", r.sha256).put("source", r.source).put("installedSha256", r.installedSha))
    }

    /** OTA step 2: {"url":"https://..."}; downloaded by the device, then verified exactly like an uploaded file. */
    private fun updateFetch(req: JSONObject): Response {
        val staged = ApkUpdater.stageFromUrl(ctx, req.optString("url"))
        return json(Response.Status.OK, JSONObject().put("ok", true)
            .put("oldName", staged.oldName).put("oldCode", staged.oldCode)
            .put("newName", staged.newName).put("newCode", staged.newCode)
            .put("relation", staged.relation)
            .put("size", staged.size).put("sha256", staged.sha256).put("installedSha256", staged.installedSha))
    }

    private fun updateInstall(req: JSONObject): Response {
        ApkUpdater.installStaged(ctx, req.optString("sha256"))
        return json(Response.Status.OK, JSONObject().put("ok", true).put("note", "Installing. The host restarts in a few seconds; reload the page when it comes back."))
    }

    @Suppress("DEPRECATION")
    private fun updateStatus(s: IHTTPSession): Response {
        val ver = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
        return json(Response.Status.OK, JSONObject().put("version", ver.versionName ?: "").put("code", ver.versionCode).put("lastUpdate", ver.lastUpdateTime)
            .also { if (s.parameters["log"]?.firstOrNull() == "1") it.put("log", ApkUpdater.lastLog(ctx)) })
    }

    private fun route(s: IHTTPSession, uri: String): Response = when {
        uri == "/api/ping" -> {
            @Suppress("DEPRECATION")
            val v = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
            json(Response.Status.OK, JSONObject().put("ok", true).put("version", v.versionName ?: "").put("page", pageTag.trim('"')))
        }
        uri == "/api/logout" && s.method == Method.POST -> {
            Sessions.revoke(ctx, s.headers["x-token"])
            json(Response.Status.OK, JSONObject().put("ok", true))
        }
        uri == "/api/diagnostics" && s.method == Method.GET -> diagnostics()
        uri == "/api/logs/status" && s.method == Method.GET -> json(Response.Status.OK, JSONObject()
            .put("running", LogCatcher.isRunning()).put("session", LogCatcher.currentSession() ?: JSONObject.NULL)
            .put("droppedWrites", LogCatcher.droppedWriteCount()).put("counters", countersJson()))
        uri == "/api/logs/start" && s.method == Method.POST -> {
            LogCatcher.start(ctx)
            json(Response.Status.OK, JSONObject().put("ok", LogCatcher.isRunning()).put("running", LogCatcher.isRunning()).put("session", LogCatcher.currentSession() ?: JSONObject.NULL))
        }
        // JavaScript errors from the web page go into the app log (the page sends at most 20 per load, text is clipped here too).
        uri == "/api/logs/clienterror" && s.method == Method.POST -> {
            val req = body(s, 8 * 1024)
            val plugin = PluginLog.pluginFromSource(req.optString("src"))
            LogCatcher.log("ERROR", if (plugin != null) "plugin/js" else "WebPage", (if (plugin != null) "[$plugin] " else "") + "JS error: " + req.optString("msg").take(500) +
                (req.optString("src").takeIf { it.isNotBlank() }?.let { " @ " + it.take(200) } ?: "") +
                (if (req.has("line")) ":" + req.optInt("line") else ""))
            json(Response.Status.OK, JSONObject().put("ok", true))
        }
        uri == "/api/logs/stop" && s.method == Method.POST -> {
            LogCatcher.stop()
            json(Response.Status.OK, JSONObject().put("ok", true).put("running", false))
        }
        uri == "/api/logs/entries" && s.method == Method.GET -> {
            val rows = JSONArray()
            // ?since=<id> returns only newer entries, so a 3 s poll does not resend the whole 3000-entry buffer.
            // If the client's id is ahead of ours (app restarted, ids began again) it is told to start over.
            val all = LogCatcher.snapshot()
            val lastId = all.lastOrNull()?.id ?: 0L
            val askedSince = s.parameters["since"]?.firstOrNull()?.toLongOrNull() ?: 0L
            val reset = askedSince > lastId
            val since = if (reset) 0L else askedSince
            all.filter { it.id > since }.forEach { e -> rows.put(entryJson(e)) }
            json(Response.Status.OK, JSONObject().put("entries", rows).put("lastId", lastId).put("reset", reset)
                .put("droppedWrites", LogCatcher.droppedWriteCount()).put("running", LogCatcher.isRunning()))
        }
        uri == "/api/logs/stream" && s.method == Method.GET -> {
            val since = s.parameters["since"]?.firstOrNull()?.toLongOrNull() ?: 0L
            val live = LogStream.acquire(since)
            if (live == null) json(tooMany, JSONObject().put("error", "too many live log streams are open"))
            else harden(newChunkedResponse(Response.Status.OK, "text/event-stream; charset=utf-8", live)).also {
                it.addHeader("X-Accel-Buffering", "no")
                it.setGzipEncoding(false)   // gzip would hold the small event frames back until its buffer fills
            }
        }
        uri == "/api/logs/search" && s.method == Method.GET -> {
            fun p(n: String) = s.parameters[n]?.firstOrNull() ?: ""
            val found = LogSearch.run(ctx, p("q"), p("regex") == "1", p("level"), p("from"), p("until"), (p("limit").toIntOrNull() ?: 300).coerceIn(1, 1000))
            json(if (found.busy) tooMany else Response.Status.OK, found.toJson())
        }
        uri == "/api/logs/export" && s.method == Method.GET -> {
            val kind = s.parameters["kind"]?.firstOrNull()
            val bundle = kind == "bundle"
            val report = kind == "report" || bundle
            val redact = s.parameters["redact"]?.firstOrNull() != "0"
            val gate = if (report) rootGate(s) else null
            if (bundle && gate != null) gate   // the bundle reads root-only files: no silent downgrade to a plain export
            else {
                val zip = LogExport.build(ctx, report, report && gate == null, bundle, redact)
                if (zip == null) json(Response.Status.INTERNAL_ERROR, JSONObject().put("error", "Could not build the archive (another export is running, or storage is full)"))
                else harden(newFixedLengthResponse(Response.Status.OK, "application/zip", LogExport.DeleteOnClose(zip), zip.length())).also {
                    it.addHeader("Content-Disposition", "attachment; filename=\"${zip.name}\"")
                }
            }
        }
        uri == "/api/logs/device" && s.method == Method.GET -> {
            val st = DeviceLogs.settings(ctx)
            json(Response.Status.OK, JSONObject().put("logcat", st.logcat).put("dmesg", st.dmesg).put("level", st.level).put("keepAll", st.keepAll).put("active", DeviceLogs.isActive()))
        }
        uri == "/api/logs/device" && s.method == Method.POST -> rootGate(s) ?: run {
            val req = body(s)
            auditShell(s.remoteIpAddress ?: "?", req.toString(), "logs-device")
            DeviceLogs.configure(ctx, req.optBoolean("logcat"), req.optBoolean("dmesg"), req.optString("level", "W"), if (req.has("keepAll")) req.optBoolean("keepAll") else null)
            val st = DeviceLogs.settings(ctx)
            json(Response.Status.OK, JSONObject().put("ok", true).put("logcat", st.logcat).put("dmesg", st.dmesg).put("level", st.level).put("keepAll", st.keepAll).put("active", DeviceLogs.isActive()))
        }
        // Boot-time capture (Magisk script): every call reads or changes root-owned files, so all need the root gate.
        uri == "/api/logs/boot/status" && s.method == Method.GET -> rootGate(s) ?: json(Response.Status.OK, BootLogd.status(ctx))
        uri == "/api/logs/boot/files" && s.method == Method.GET -> rootGate(s) ?: json(Response.Status.OK, BootLogd.files(ctx))
        uri == "/api/logs/boot/counters" && s.method == Method.GET -> rootGate(s) ?: json(Response.Status.OK, BootLogd.counters(ctx))
        uri == "/api/logs/boot/read" && s.method == Method.GET -> rootGate(s) ?: run {
            fun p(n: String) = s.parameters[n]?.firstOrNull() ?: ""
            val res = BootLogd.page(ctx, p("file"), p("start").toIntOrNull() ?: 1, p("limit").toIntOrNull() ?: 300, p("from").ifBlank { null })
            json(if (res.optBoolean("ok")) Response.Status.OK else Response.Status.BAD_REQUEST, res)
        }
        uri == "/api/logs/boot/install" && s.method == Method.POST -> rootGate(s) ?: run {
            val req = body(s)
            auditShell(s.remoteIpAddress ?: "?", req.toString(), "logs-boot-install")
            val cur = BootLogd.config(ctx)
            val cfg = BootLogdModel.Config(req.optInt("fileKb", cur.fileKb), req.optInt("files", cur.files), req.optInt("minFreeMb", cur.minFreeMb), req.optInt("retainDays", cur.retainDays))
            val res = BootLogd.install(ctx, cfg)
            json(if (res.optBoolean("ok")) Response.Status.OK else Response.Status.INTERNAL_ERROR, res)
        }
        uri == "/api/logs/boot/uninstall" && s.method == Method.POST -> rootGate(s) ?: run {
            val req = body(s)
            auditShell(s.remoteIpAddress ?: "?", req.toString(), "logs-boot-remove")
            val res = BootLogd.uninstall(ctx, req.optBoolean("purge", false))
            json(if (res.optBoolean("ok")) Response.Status.OK else Response.Status.INTERNAL_ERROR, res)
        }
        uri == "/api/logs/delete" && s.method == Method.POST -> {
            val ok = LogCatcher.deleteSession(ctx, body(s).optString("name", ""))
            json(if (ok) Response.Status.OK else Response.Status.BAD_REQUEST, JSONObject().put("ok", ok)
                .put("error", if (ok) JSONObject.NULL else "Session not found, or it is still logging"))
        }
        uri == "/api/logs/sessions" && s.method == Method.GET -> {
            val rows = JSONArray()
            LogCatcher.sessions(ctx).forEach { f -> rows.put(JSONObject().put("name", f.name).put("size", f.length()).put("modified", f.lastModified())) }
            json(Response.Status.OK, JSONObject().put("sessions", rows).put("bootEnabled", BootLogd.enabled(ctx)))
        }
        // Log basket (step 1): one list of every log file. Boot files are added only when capture is installed and the root gate passes.
        uri == "/api/logs/basket" && s.method == Method.GET -> {
            val rows = ArrayList<LogBasket.Row>()
            val activeName = LogCatcher.currentSession()?.let { "$it.log" }
            LogCatcher.sessions(ctx).forEach { f -> rows.add(LogBasket.Row(LogBasket.SESSION, f.name, f.length(), f.lastModified(), "", f.name == activeName)) }
            File(ctx.filesDir, "logs/exports").listFiles()?.filter { it.isFile && it.extension == "txt" }
                ?.forEach { f -> rows.add(LogBasket.Row(LogBasket.EXPORT, f.name, f.length(), f.lastModified())) }
            File(ctx.filesDir, "shell_audit.log").takeIf { it.isFile }
                ?.let { f -> rows.add(LogBasket.Row(LogBasket.AUDIT, f.name, f.length(), f.lastModified())) }
            val installed = BootLogd.enabled(ctx)
            val rootOk = installed && rootGate(s) == null
            if (rootOk) {
                try {
                    val files = BootLogd.files(ctx).optJSONArray("files") ?: JSONArray()
                    for (i in 0 until files.length()) {
                        val o = files.getJSONObject(i)
                        rows.add(LogBasket.Row(LogBasket.BOOT, o.optString("name"), o.optLong("size"), 0L, o.optString("modified"), false, true))
                    }
                } catch (e: Exception) { Quiet.note("WebServer.logsBasket", e) }
            }
            val out = JSONArray()
            LogBasket.arrange(rows).forEach { r ->
                out.put(JSONObject().put("id", r.id).put("type", r.type).put("name", r.name).put("size", r.size)
                    .put("modified", r.modified).put("modifiedText", r.modifiedText).put("active", r.active).put("rootOnly", r.rootOnly)
                    .put("canView", r.canView).put("canCopy", r.canCopy).put("canDelete", r.canDelete))
            }
            json(Response.Status.OK, JSONObject().put("rows", out).put("running", LogCatcher.isRunning())
                .put("bootNote", LogBasket.bootNote(installed, rootOk)))
        }
        // Log basket (step 6): one redacted snapshot file (version, plugin problem counts, session tail) saved as an export row, so a before and an after run can be compared.
        uri == "/api/logs/snapshot" && s.method == Method.POST -> {
            if (!snapshotBusy.tryAcquire()) json(tooMany, JSONObject().put("error", "A snapshot is already being made")) else try {
            val label = body(s).optString("label", "").takeIf { it in LogSnapshot.LABELS } ?: ""
            val stamp = java.text.SimpleDateFormat("yyyyMMdd_HHmmss", java.util.Locale.US).format(java.util.Date())
            // Counts cover every kept part of the newest session (a session rotates into "_part" files at 8 MB), not just the 3000-line recent buffer,
            // so a before and an after snapshot taken at different times still compare like with like. Capped at 64 MB, oldest part dropped first.
            val all = LogCatcher.sessions(ctx)
            val base = all.firstOrNull()?.nameWithoutExtension?.substringBefore("_part")
            val parts = if (base == null) emptyList() else all.filter { it.nameWithoutExtension.substringBefore("_part") == base }.sortedBy { it.lastModified() }
            val use = ArrayList<File>(); var budget = 64L * 1024 * 1024
            for (f in parts.asReversed()) { if (budget - f.length() < 0 && use.isNotEmpty()) break; budget -= f.length(); use.add(0, f) }
            val counter = LogSnapshot.Counter(); val tail = java.util.ArrayDeque<String>()
            val fromFiles = try {
                for (f in use) f.useLines(Charsets.UTF_8) { seq -> for (l in seq) { counter.add(l); tail.addLast(l); if (tail.size > LogSnapshot.TAIL_LINES) tail.removeFirst() } }
                use.isNotEmpty()
            } catch (_: Exception) { false }
            val (counts, examined, tailLines, source) = if (fromFiles)
                Quad(counter.counts(), counter.examined, tail.toList(), "newest session, all kept parts (${use.size} file(s))" + (if (LogCatcher.isRunning()) ", still logging" else ""))
            else {
                val buf = if (LogCatcher.isRunning()) LogCatcher.snapshot().map { it.line() } else emptyList()
                Quad(LogSnapshot.count(buf), buf.size, buf, if (buf.isEmpty()) "no session available" else "running session (recent buffer only: no session file yet)")
            }
            @Suppress("DEPRECATION")
            val version = try { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: "" } catch (_: Exception) { "" }
            val red = Redactor()
            val text = red.text(LogSnapshot.render(version, stamp, label, source, counts, examined, tailLines)) + "\nPrivate data hidden by the snapshot: " + red.summary() + "\n"
            val dir = File(ctx.filesDir, "logs/exports").apply { mkdirs() }
            val file = File(dir, LogSnapshot.fileName(label, stamp))
            file.writeText(text)
            json(Response.Status.OK, JSONObject().put("ok", true).put("id", LogBasket.EXPORT + ":" + file.name).put("name", file.name).put("lines", examined).put("source", source))
            } finally { snapshotBusy.release() }
        }
        // Log basket (step 2): the last lines of one session, export or audit file. Boot files keep their own root route.
        uri == "/api/logs/basket/read" && s.method == Method.GET -> {
            val parsed = LogBasket.parseId(s.parameters["id"]?.firstOrNull() ?: "") ?: throw IllegalArgumentException("bad log id")
            val full = s.parameters["full"]?.firstOrNull() == "1"
            val tail = if (full) LogBasket.TAIL_MAX else LogBasket.clampTail(s.parameters["tail"]?.firstOrNull()?.toIntOrNull() ?: LogBasket.TAIL_DEFAULT)
            val file: File? = when (parsed.first) {
                LogBasket.SESSION -> LogCatcher.sessions(ctx).firstOrNull { it.name == parsed.second }
                LogBasket.EXPORT -> File(ctx.filesDir, "logs/exports/" + parsed.second).takeIf { it.isFile && it.extension == "txt" }
                LogBasket.AUDIT -> File(ctx.filesDir, "shell_audit.log").takeIf { it.isFile && parsed.second == "shell_audit.log" }
                else -> throw IllegalArgumentException("boot files are read with /api/logs/boot/read")
            }
            if (file == null) json(Response.Status.NOT_FOUND, JSONObject().put("error", "Log not found"))
            else {
                val (text, cut) = readTail(file, 2L * 1024 * 1024)
                val lines = LogBasket.tailLines(text, tail)
                json(Response.Status.OK, JSONObject().put("id", s.parameters["id"]?.firstOrNull()).put("size", file.length())
                    .put("lines", JSONArray(lines)).put("shown", lines.size)
                    .put("truncated", cut || lines.size >= tail))
            }
        }
        // Log basket: delete finished sessions, exports, the audit log and rotated boot files. Audit and boot rows need the root gate; clearing the audit log leaves a new line saying so. The active session and the live boot files are refused per row.
        uri == "/api/logs/basket/delete" && s.method == Method.POST -> {
            val ids = body(s).optJSONArray("ids") ?: JSONArray()
            if (ids.length() > 100) throw IllegalArgumentException("at most 100 rows at once")
            val results = JSONArray()
            for (i in 0 until ids.length()) {
                val id = ids.optString(i, "")
                val p = LogBasket.parseId(id)
                var reason = ""
                val ok = if (p == null) false else when (p.first) {
                    LogBasket.SESSION -> LogCatcher.deleteSession(ctx, p.second)
                    LogBasket.EXPORT -> File(ctx.filesDir, "logs/exports/" + p.second).let { it.isFile && it.extension == "txt" && it.delete() }
                    LogBasket.AUDIT -> if (p.second != "shell_audit.log") false
                        else if (rootGate(s) != null) { reason = "root sign-in needed"; false }
                        else synchronized(auditLock) { File(ctx.filesDir, "shell_audit.log").let { it.isFile && it.delete() } }
                            .also { done -> if (done) auditShell(s.remoteIpAddress ?: "?", "audit log cleared from the log basket", "audit-cleared") }
                    LogBasket.BOOT -> if (!LogBasket.bootDeletable(p.second)) { reason = "only rotated capture files can be deleted"; false }
                        else if (rootGate(s) != null) { reason = "root sign-in needed"; false }
                        else BootLogd.deleteFile(ctx, p.second).also { auditShell(s.remoteIpAddress ?: "?", "boot file " + p.second, "logs-boot-delete") }
                    else -> false
                }
                results.put(JSONObject().put("id", id).put("ok", ok).put("reason", reason))
            }
            json(Response.Status.OK, JSONObject().put("results", results))
        }
        uri.startsWith("/api/logs/session/") && s.method == Method.GET -> {
            val name = uri.removePrefix("/api/logs/session/")
            val file = LogCatcher.sessions(ctx).firstOrNull { it.name == name }
            if (file == null) json(Response.Status.NOT_FOUND, JSONObject().put("error", "Session not found"))
            else json(Response.Status.OK, JSONObject().put("name", file.name).put("lines", JSONArray(LogCatcher.readSession(file))))
        }
        uri == "/api/root/status" && s.method == Method.GET -> {
            // ?retry=1 = explicit re-check (root just granted): forget the cool-down after a refusal. Plain polls keep it.
            if (s.parameters["retry"]?.firstOrNull() == "1") RootShell.resetDenial()
            val status = RootShell.status(ctx)
            json(Response.Status.OK, JSONObject()
                .put("granted", status.granted)
                .put("uid", status.uid)
                .put("suPath", status.suPath)
                .put("manager", status.managerHint)
                .put("detail", status.detail))
        }
        uri == "/api/screen/frame" && s.method == Method.GET -> screenFrame(s)
        uri == "/api/screen/input" && s.method == Method.POST -> rootGate(s) ?: run { auditBusy(s.remoteIpAddress ?: "?", "screen-input"); screenInput(body(s)) }
        uri == "/api/usb/status" && s.method == Method.GET -> usbStatus()
        uri == "/api/usb/control" && s.method == Method.POST -> rootGate(s) ?: run {
            val req = body(s)
            auditShell(s.remoteIpAddress ?: "?", req.toString(), "usb-control")
            controlUsb(req)
        }
        uri == "/api/firmware/inspect" && s.method == Method.POST -> inspectFirmware(body(s))
        uri == "/api/update/stage" && s.method == Method.POST -> updateStage(s)
        uri == "/api/update/check" && s.method == Method.POST -> updateCheck(body(s))
        uri == "/api/update/fetch" && s.method == Method.POST -> updateFetch(body(s))
        uri == "/api/update/install" && s.method == Method.POST -> rootGate(s) ?: run {
            val req = body(s)
            auditShell(s.remoteIpAddress ?: "?", req.toString(), "update-install")
            updateInstall(req)
        }
        uri == "/api/update/status" && s.method == Method.GET -> updateStatus(s)
        uri == "/api/shell" && s.method == Method.POST -> rootGate(s) ?: run {
            val req = body(s)
            val command = req.optString("cmd")
            if (command.isBlank() || command.length > 128_000 || command.contains('\u0000'))
                throw IllegalArgumentException("command must be 1 to 128 KB and contain no NUL bytes")
            val t = req.optLong("timeout", 20000).coerceIn(1000, 120000)
            auditShell(s.remoteIpAddress ?: "?", command)
            val r = RootShell.run(ctx, UfiPathMap.map(command, ctx.packageName), t)
            json(Response.Status.OK, JSONObject().put("success", r.success).put("content", r.content))
        }
        // UFI-TOOLS aliases (shapes read from UFI's own server source, advancedToolsModule.kt). root_shell: request {"command","timeout"},
        // reply {"result":"<text>"} or HTTP 500 {"error":"..."}; UFI's timeout cap is 100 s (kept). The default is 30 s, not UFI's 100 s: above 30 s a call counts as a long job and shares only 3 slots with the boot script and the IMEI keeper. Same gate, limits and
        // path mapping as /api/shell. UFI's kano-t / kano-sign / authorization headers are never read, so they are ignored.
        uri == "/api/root_shell" && s.method == Method.POST -> rootGate(s) ?: run {
            val req = body(s)
            val command = req.optString("command")
            if (command.isBlank() || command.length > 128_000 || command.contains('\u0000'))
                throw IllegalArgumentException("command must be 1 to 128 KB and contain no NUL bytes")
            val t = req.optLong("timeout", 30000).coerceIn(1000, 100000)
            auditShell(s.remoteIpAddress ?: "?", command, "root_shell")
            val r = RootShell.run(ctx, UfiPathMap.map(command, ctx.packageName), t)
            ufiShellReply(if (r.success) r.content else null, if (r.success) null else r.content.ifBlank { "command failed" })
        }
        // UFI's one_click_shell is a GET with no body: it drives the phone screen over adb to switch on UFI's own root shell. It is
        // not a command runner. MatchiTOOL already runs commands as root, so there is nothing to switch on: the reply says whether
        // root is available. (Before this it was wrongly treated as a second root_shell.)
        uri == "/api/one_click_shell" && s.method == Method.GET -> run {
            if (RootShell.status(ctx).granted) ufiShellReply("Root shell is already available (MatchiTOOL runs commands as root)", null)
            else ufiShellReply(null, "Root access has not been granted to MatchiTOOL")
        }
        uri == "/api/user_shell" && s.method == Method.POST -> rootGate(s) ?: run {
            val req = body(s)
            val command = req.optString("command")
            if (command.isBlank() || command.length > 128_000 || command.contains('\u0000'))
                throw IllegalArgumentException("command must be 1 to 128 KB and contain no NUL bytes")
            auditShell(s.remoteIpAddress ?: "?", command, "user_shell")
            val r = UserShell.run(ctx.filesDir, command, 20000)
            // UFI's reply: {"result":{"done":true,"content":"<stdout>"}}; any stderr output makes UFI answer an error instead.
            ufiShellReply(if (r.success) JSONObject().put("done", true).put("content", r.content) else null, if (r.success) null else r.content.ifBlank { "command failed" })
        }
        // Re-write the saved IMEI now (the same keeper that runs at boot): {"force":true}
        uri == "/api/imei/apply" && s.method == Method.POST -> rootGate(s) ?: run {
            val req = body(s)
            auditShell(s.remoteIpAddress ?: "?", "imei-apply force=" + req.optBoolean("force", true), "imei-apply")
            json(Response.Status.OK, JSONObject().put("result", ImeiGuard.apply(ctx, 0, req.optBoolean("force", true))))
        }
        // Run an AT command on the modem as root: {"command":"AT+CSQ","slot":0}
        uri == "/api/at" && s.method == Method.POST -> run {
            val req = body(s)
            val cmd = req.optString("command").trim()
            val slot = req.optInt("slot", 0).coerceIn(0, 1)
            if (!cmd.startsWith("AT", ignoreCase = true) || cmd.length > 300 || cmd.any { it == '\n' || it == '\r' })
                throw IllegalArgumentException("AT command must start with AT")
            // Read-only queries (polled by Live Status / AT Radio) skip the gate; every other AT command can change the modem.
            if (!RootGate.isReadOnlyAt(cmd)) rootGate(s)?.let { return@run it }
            auditBusy(s.remoteIpAddress ?: "?", "at")
            val q = "'" + cmd.replace("'", "'\\''") + "'"
            val r = RootShell.run(ctx, File(ctx.filesDir, "sendat").absolutePath + " -n $slot -c $q", 15000)
            json(Response.Status.OK, JSONObject().put("success", r.success).put("result", r.content.trim()))
        }
        // UFI-TOOLS route GET /api/AT?command=AT+CSQ&slot=0 (UFI's own tools and plugins call it). Reply shape taken from UFI's
        // server source (atModule.kt): {"result":"<modem text>"} on success, HTTP 500 {"error":"<text>"} on failure. The text is
        // normalised the way UFI does it (AtBatch.ufiText). No "success" field: UFI's reply has none. Difference kept on purpose:
        // a slot other than 0 or 1 is refused with 400 (UFI silently passes any number on). Same gate as /api/at: pure read
        // commands skip the sign-in age check, everything else (NV writes, AT+CFUN, AT^...) needs it. Writes are audited.
        uri == "/api/AT" && s.method == Method.GET -> run {
            val cmd = AtBatch.checkCommand(s.parameters["command"]?.firstOrNull())
            val slot = AtBatch.checkSlot(s.parameters["slot"]?.firstOrNull())
            val readOnly = RootGate.isReadOnlyAt(cmd)
            if (!readOnly) rootGate(s)?.let { return@run it }
            if (readOnly) auditBusy(s.remoteIpAddress ?: "?", "at-ufi") else auditShell(s.remoteIpAddress ?: "?", cmd, "at-ufi-write")
            val q = "'" + cmd.replace("'", "'\\''") + "'"
            val r = RootShell.run(ctx, File(ctx.filesDir, "sendat").absolutePath + " -n $slot -c $q", 15000)
            val text = r.content.trim()
            if (r.success) json(Response.Status.OK, JSONObject().put("result", AtBatch.ufiText(text)))
            else json(Response.Status.INTERNAL_ERROR, JSONObject().put("error", "AT command failed: " + text.ifBlank { "no output" }))
        }
        // Several AT commands in ONE root call: {"commands":["AT+CSQ","AT+COPS?"],"slot":0} -> {"results":["...","..."]}
        uri == "/api/at/batch" && s.method == Method.POST -> run {
            val req = body(s)
            val slot = req.optInt("slot", 0).coerceIn(0, 1)
            val arr = req.optJSONArray("commands") ?: throw IllegalArgumentException("commands must be an array")
            if (arr.length() < 1 || arr.length() > 12) throw IllegalArgumentException("1 to 12 commands")
            val sendat = File(ctx.filesDir, "sendat").absolutePath
            val cmds = ArrayList<String>(arr.length())
            for (i in 0 until arr.length()) {
                val cmd = arr.optString(i).trim()
                if (!cmd.startsWith("AT", ignoreCase = true) || cmd.length > 300 || cmd.any { it == '\n' || it == '\r' })
                    throw IllegalArgumentException("AT command must start with AT")
                cmds.add(cmd)
            }
            // Same rule as /api/at: only a batch of pure read commands may skip the fresh-sign-in / HTTP-confirm gate.
            if (!cmds.all { RootGate.isReadOnlyAt(it) }) rootGate(s)?.let { return@run it }
            // A random marker per request: a modem reply containing "##" or a look-alike marker cannot cut or forge results.
            auditBusy(s.remoteIpAddress ?: "?", "at-batch")
            val marker = AtBatch.newMarker()
            val r = RootShell.run(ctx, AtBatch.script(sendat, slot, cmds, marker), 20000)
            val results = JSONArray(AtBatch.parse(r.content, marker, cmds.size))
            json(Response.Status.OK, JSONObject().put("success", r.success).put("results", results))
        }
        // Proxy to the ZTE web API: {"op":"get"|"set","params":{"cmd":"signalbar",...}}
        uri == "/api/zte" && s.method == Method.POST -> {
            val req = body(s)
            val op = req.optString("op")
            if (op != "get" && op != "set") throw IllegalArgumentException("op must be get or set")
            val po = req.optJSONObject("params") ?: JSONObject()
            val p = LinkedHashMap<String, String>()
            for (k in po.keys()) p[k] = po.optString(k)
            val raw = ZteClient.call(ctx, op, p, req.optInt("retry", 0).coerceIn(0, 2))
            val parsed: Any = try { JSONObject(raw) } catch (_: Exception) { raw }
            json(Response.Status.OK, JSONObject().put("success", true).put("data", parsed).put("info", if (op == "set") ZteClient.lastInfo else ""))
        }
        // UFI-TOOLS router routes. The target is always the saved gateway (ZteClient never takes a host from a request).
        // goform: GET query = router "get"; POST (form or JSON body) = router "set" with the AD token added, as /api/zte does.
        uri.startsWith("/api/goform/") && (s.method == Method.GET || s.method == Method.POST) -> {
            val name = uri.removePrefix("/api/goform/")
            GatewayProxy.goformPath(name) ?: throw IllegalArgumentException("unknown goform endpoint")
            val p = GatewayProxy.params(gatewayParams(s)) ?: throw IllegalArgumentException("too many or too long parameters")
            val isSet = name == "goform_set_cmd_process"
            if (isSet != (s.method == Method.POST)) throw IllegalArgumentException(if (isSet) "goform_set_cmd_process needs POST" else "goform_get_cmd_process needs GET")
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
                    Sessions.revokeAllExcept(ctx, s.headers["x-token"])   // other sessions end; this one stays
                }
            }
            // Drop the cached router session, the 60 s "login failed recently" cool-down and the detected port, so the new
            // password / address is used on the very next router call instead of after the cool-down.
            if (routerChanged) ZteClient.reset()
            json(Response.Status.OK, JSONObject().put("ok", true))
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
            Sessions.revokeAllExcept(ctx, s.headers["x-token"])
            auditShell(s.remoteIpAddress ?: "?", "console-password " + (if (Prefs.hasConsolePassword(ctx)) "set" else "removed"), "console-password")
            json(Response.Status.OK, JSONObject().put("ok", true).put("separate", Prefs.hasConsolePassword(ctx)))
        }
        (uri == "/api/upload" || uri == "/api/upload_img") && s.method == Method.POST -> uploadFile(s, uri == "/api/upload_img")
        uri == "/api/uploads/delete" && s.method == Method.POST -> deleteUpload(body(s).optString("name"))
        uri.startsWith("/api/uploads/") && s.method == Method.GET -> serveUpload(uri.removePrefix("/api/uploads/"))
        uri == "/api/plugins" && s.method == Method.GET -> {
            val off = Prefs.disabled(ctx)
            val arr = JSONArray()
            val all = pluginDir.listFiles { f -> f.isFile && (f.name.endsWith(".js") || f.name.endsWith(".html")) }
                ?.associateBy { it.name }.orEmpty()
            val titles = Prefs.pluginTitles(ctx)
            for (n in orderPlugins(all.keys, Prefs.pluginOrder(ctx))) {
                val f = all.getValue(n)
                arr.put(JSONObject().put("name", n).put("code", f.readText()).put("enabled", n !in off)
                    .put("kind", pluginKind(n)).put("title", titles[n] ?: n.removeSuffix(".js").removeSuffix(".html")))
            }
            json(Response.Status.OK, arr)
        }
        // Upload or replace a plugin: {"name":"My_Plugin.js","code":"..."}
        uri == "/api/plugins" && s.method == Method.POST -> rootGate(s) ?: run {
            val req = body(s)
            val name = req.optString("name"); val code = req.optString("code")
            if (!nameRx.matches(name) || name.contains("..")) throw IllegalArgumentException("invalid plugin name")
            val codeBytes = code.toByteArray(Charsets.UTF_8).size
            if (code.isBlank() || codeBytes > 1_048_576) throw IllegalArgumentException("plugin must be 1 byte to 1 MB")
            val reserved = setOf("AT_Radio.js", "Network_Diagnostics.js",
                "Live_Status.js", "Memory_Cleaner.js", "Change_IP.js", "SMS.js", "Screen_Control.js", "Bypass.js")
            if (name in reserved) throw IllegalArgumentException("built-in tool names are reserved")
            val files = pluginDir.listFiles { f -> f.isFile && (f.name.endsWith(".js") || f.name.endsWith(".html")) }?.toList().orEmpty()
            if (files.none { it.name == name } && files.size >= 50) throw IllegalArgumentException("maximum of 50 custom plugins reached")
            val total = files.filter { it.name != name }.sumOf { it.length() } + codeBytes
            if (total > 5L * 1024L * 1024L) throw IllegalArgumentException("custom plugin storage limit is 5 MB")
            auditShell(s.remoteIpAddress ?: "?", name + "\n" + code, "plugin-upload")
            File(pluginDir, name).writeText(code)
            // UFI-TOOLS blocks keep their original name (it may hold spaces or non-Latin letters) next to the safe file name.
            if (req.has("title")) Prefs.setPluginTitle(ctx, name, cleanPluginTitle(req.optString("title")).ifBlank { null })
            json(Response.Status.OK, JSONObject().put("ok", true))
        }
        // Save the load order: {"names":["B.js","A-1f2e3d.html"]}. Unknown names are dropped; plugins not listed load after them.
        uri == "/api/plugins/order" && s.method == Method.POST -> rootGate(s) ?: run {
            val arr = body(s).optJSONArray("names") ?: throw IllegalArgumentException("names must be an array")
            if (arr.length() > 50) throw IllegalArgumentException("at most 50 names")
            val have = pluginDir.listFiles { f -> f.isFile }?.map { it.name }?.toSet().orEmpty()
            val names = (0 until arr.length()).map { arr.optString(it) }
            if (names.any { !nameRx.matches(it) || it.contains("..") }) throw IllegalArgumentException("invalid plugin name")
            Prefs.setPluginOrder(ctx, names.filter { it in have })
            json(Response.Status.OK, JSONObject().put("ok", true))
        }
        // What deleting this plugin would erase (read-only): its own data folder plus the paths it declares with
        // "// @matchi-data /path" in its source. Used by the page to show the list before the user confirms.
        uri == "/api/plugins/data" && s.method == Method.POST -> {
            val name = body(s).optString("name")
            if (!nameRx.matches(name) || name.contains("..")) throw IllegalArgumentException("invalid plugin name")
            val (paths, rejected) = pluginDataPlan(name)
            val probe = RootShell.run(ctx, probeScript(paths), 15_000)
            val found = HashMap<String, Long>()
            if (probe.success) probe.content.lineSequence().forEach { line ->
                val m = Regex("^EXISTS (\\d*) (/\\S+)$").find(line.trim()) ?: return@forEach
                found[m.groupValues[2]] = m.groupValues[1].toLongOrNull() ?: -1L
            }
            val items = JSONArray()
            for (p in paths) items.put(JSONObject().put("path", p).apply {
                if (probe.success) { put("exists", p in found); if ((found[p] ?: -1L) >= 0) put("kb", found[p]) }
            })
            val bad = JSONArray()
            for ((p, why) in rejected) bad.put(JSONObject().put("path", p).put("reason", why))
            json(Response.Status.OK, JSONObject().put("items", items).put("rejected", bad).put("rootOk", probe.success))
        }
        // Delete a plugin: {"name":"My_Plugin.js","erase":true}. With erase, the data from /api/plugins/data is removed too.
        uri == "/api/plugins/delete" && s.method == Method.POST -> run {
            val req = body(s)
            // Erasing plugin data runs a root script; a plain delete of the plugin file does not.
            if (req.optBoolean("erase", false)) rootGate(s)?.let { return@run it }
            val name = req.optString("name")
            if (!nameRx.matches(name) || name.contains("..")) throw IllegalArgumentException("invalid plugin name")
            val plan = if (req.optBoolean("erase", false)) pluginDataPlan(name) else null // read the source BEFORE it is deleted
            val deleted = File(pluginDir, name).delete()
            Prefs.setEnabled(ctx, name, true)
            if (deleted) Prefs.forgetPlugin(ctx, name)
            val out = JSONObject().put("ok", deleted)
            if (plan != null && deleted) {
                val script = eraseScript(plan.first)
                auditShell(s.remoteIpAddress ?: "?", script, "plugin-erase")
                val r = RootShell.run(ctx, script, 30_000)
                val bad = JSONArray()
                for ((p, why) in plan.second) bad.put(JSONObject().put("path", p).put("reason", why))
                out.put("erase", JSONObject().put("success", r.success && !r.content.contains("FAILED ") && !r.content.contains("SKIPPED ")).put("log", r.content.take(2000)).put("rejected", bad))
            }
            json(Response.Status.OK, out)
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

// ---- Plugin data: what deleting a plugin may erase ----------------------------------------------------------------
private const val MATCHI_DIR = "/data/local/matchitool"
private val DATA_DECL = Regex("^\\s*//\\s*@matchi-data\\s+(\\S+)\\s*$")
private val DATA_PATH_CHARS = Regex("^/[A-Za-z0-9._/-]+$")
private val LOCAL_PROTECTED = setOf("tmp", "matchitool", "ufi_ttl", "ufi_dpi", "ufi_boot", "ufi_lock")
private val SDCARD_PROTECTED = setOf("download", "dcim", "pictures", "movies", "music", "documents", "android",
    "alarms", "notifications", "podcasts", "ringtones", "audiobooks", "recordings")
private val TMP_OWN = Regex("^\\.?(matchi|mt_|sqlite)")

/** The folder every plugin may use for its own data; it is erased automatically when the plugin is deleted. */
internal fun pluginDataDir(pluginName: String): String = "$MATCHI_DIR/plugin_data/" + pluginName.removeSuffix(".js").removeSuffix(".html")

/** Paths a plugin asks to have erased: header lines of the form `// @matchi-data /path` (first 400 lines, at most 20). */
internal fun pluginDataDeclarations(code: String): List<String> =
    code.lineSequence().take(400).mapNotNull { DATA_DECL.find(it)?.groupValues?.get(1) }.distinct().take(20).toList()

/** null when [path] may be erased on plugin delete, otherwise the reason it may not. Strict on purpose: it runs `rm -rf` as root. */
internal fun checkPluginDataPath(path: String, pluginName: String): String? {
    if (path.length > 200 || !DATA_PATH_CHARS.matches(path)) return "use only letters, digits . _ - and /"
    val parts = path.split('/').drop(1)
    if (parts.any { it.isEmpty() || it == "." || it == ".." }) return "no empty, . or .. parts and no trailing /"
    return when {
        // Only the plugin's own data folder (or something inside it): another plugin's data is never erased by this one.
        path.startsWith("$MATCHI_DIR/plugin_data/") -> {
            val own = pluginDataDir(pluginName)
            if (path == own || path.startsWith("$own/")) null else "a plugin may only erase its own data folder"
        }
        path.startsWith("$MATCHI_DIR/plugins/") -> "other plugins' files are protected"
        path == MATCHI_DIR || path.startsWith("$MATCHI_DIR/") -> "MatchiTOOL's own folder is protected"
        path.startsWith("/data/local/tmp/") ->
            if (parts.size < 4) "name a folder inside /data/local/tmp"
            else if (TMP_OWN.containsMatchIn(parts[3].lowercase())) "that name belongs to MatchiTOOL" else null
        path.startsWith("/data/local/") -> if (parts[2] in LOCAL_PROTECTED) "protected folder" else null
        path.startsWith("/sdcard/") || path.startsWith("/storage/emulated/0/") -> {
            val rest = if (path.startsWith("/sdcard/")) parts.drop(1) else parts.drop(3)
            when {
                rest.isEmpty() -> "name a folder inside it"
                rest[0].lowercase() == "android" -> "the Android folder is protected"
                rest.size == 1 && rest[0].lowercase() in SDCARD_PROTECTED -> "a standard folder is protected"
                else -> null
            }
        }
        else -> "only /data/local, /data/local/tmp and /sdcard may be erased"
    }
}

/**
 * Folders that must not be symlinks before [path] may be erased: every parent below the allowed root (/data/local, /sdcard or
 * /storage/emulated/0; the roots themselves are symlinks on some devices and are trusted). The path itself is not listed:
 * rm removes a final symlink without following it.
 */
internal fun symlinkAncestors(path: String): List<String> {
    val parts = path.split('/').drop(1)
    val rootDepth = when {
        path.startsWith("/sdcard/") -> 1
        path.startsWith("/storage/emulated/0/") -> 3
        path.startsWith("/data/local/") -> 2
        else -> return emptyList()
    }
    return (rootDepth + 1 until parts.size).map { "/" + parts.take(it).joinToString("/") }
}

/** Free space needed before accepting a body of [len] bytes: the body itself plus [UPLOAD_RESERVE_BYTES] left for the system. */
internal const val UPLOAD_RESERVE_BYTES = 200L * 1024L * 1024L
internal fun uploadSpaceOk(freeBytes: Long, len: Long): Boolean = len >= 0 && freeBytes - len >= UPLOAD_RESERVE_BYTES

/** Four values returned together by the snapshot route. */
private data class Quad<A, B, C, D>(val a: A, val b: B, val c: C, val d: D)

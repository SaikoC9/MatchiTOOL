package com.matchi.tool

import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.SecureRandom
import java.util.concurrent.Executors
import java.util.concurrent.ThreadFactory

/** What one gate needs to know about its target. [tabClose] adds the page ping + close beacon (logout when the last page of the tab closes). */
class WebGateConfig(
    val listenPort: Int,
    val upstreamPort: Int,
    val logoutPath: String? = null,
    val idleMs: Long = 3_600_000L,
    val tabClose: Boolean = false,
    /** Name of the browser cookie. Browsers do not separate cookies by port, so two gates on one host need two names (WebGate uses matchi_gate_PORT). */
    val cookieName: String = WebGateProxy.COOKIE,
)

/**
 * Front door for ONE local web page (listens on cfg.listenPort, talks to 127.0.0.1:cfg.upstreamPort). No Android classes, so it runs in plain JVM tests.
 *
 * Why: a local web page (AdGuard Home, router panels) sets its own login cookie, often for 30 days, which MatchiTOOL cannot end. This proxy keeps ALL
 * cookies of the target on the router side only. The browser gets a session cookie (matchi_gate) that is worth something only while the MatchiTOOL console
 * session lives. The target's login is ended (cfg.logoutPath, when given) and its cookies dropped when the console session ends, after cfg.idleMs without
 * a request and, with cfg.tabClose, when the last page of the tab closes (pagehide beacon + 6 s grace, so a page change does not count) or no page has
 * pinged for 150 s. The next visit shows the target's own login again.
 *
 * Entry: the console asks for a one-time ticket ([newTicket], bound to the caller's address, 60 s), the browser opens /__matchi/enter?t=TICKET,
 * the proxy sets matchi_gate and redirects to /. Everything else without a valid gate for the same address gets 403.
 */
class WebGateProxy(
    private val cfg: WebGateConfig,
    private val consoleValid: (String) -> Boolean,
    private val clock: () -> Long = { System.currentTimeMillis() },
) {
    companion object {
        const val COOKIE = "matchi_gate"
        const val TICKET_MS = 60_000L
        const val GRACE_MS = 6_000L
        const val TAB_STALE_MS = 150_000L
        const val MAX_REQ_BODY = 2 * 1024 * 1024
        const val MAX_RESP = 24 * 1024 * 1024
        private const val MAX_HEAD = 16 * 1024
        private const val MAX_GATES = 16
        private const val MAX_TICKETS = 16
        private const val MAX_JAR = 20
        private val COOKIE_NAME_RX = Regex("^[A-Za-z0-9_.!#$%&'*+^`|~-]{1,64}$")
        private val TAB_RX = Regex("^[a-z0-9]{4,24}$")
        private val HEX_RX = Regex("^[0-9a-f]{64}$")

        fun normIp(raw: String?): String = (raw ?: "").trim().removePrefix("/").substringBefore('%').lowercase().removePrefix("::ffff:")

        const val GATE_JS = "(function(){var id=Math.random().toString(36).slice(2,14),u='/__matchi/hb?t='+id;" +
            "function p(){try{fetch(u,{method:'POST',credentials:'same-origin',keepalive:true}).catch(function(){})}catch(e){}}" +
            "p();setInterval(p,10000);" +
            "addEventListener('pagehide',function(){try{navigator.sendBeacon('/__matchi/bye?t='+id)}catch(e){}});})();"
    }

    private class Gate(val ip: String, val consoleToken: String, now: Long) {
        val jar = LinkedHashMap<String, String>()   // cookie name -> "name=value" of the target, never sent to the browser
        val tabs = HashMap<String, Long>()
        var lastActivity = now
        var emptySince = 0L
    }

    private class Ticket(val ip: String, val consoleToken: String, val until: Long)

    private val rng = SecureRandom()
    private val lock = Any()
    private val gates = LinkedHashMap<String, Gate>()
    private val tickets = LinkedHashMap<String, Ticket>()
    private var server: ServerSocket? = null
    private var pool: java.util.concurrent.ExecutorService? = null
    private var sweeper: Thread? = null
    @Volatile private var running = false

    private fun token(): String { val b = ByteArray(32); rng.nextBytes(b); return b.joinToString("") { "%02x".format(it) } }

    /** Starts listening. Returns null on success (also when already running), otherwise the reason. */
    fun start(): String? = synchronized(lock) {
        if (running) return null
        try {
            val ss = ServerSocket()
            ss.reuseAddress = true
            ss.bind(InetSocketAddress("0.0.0.0", cfg.listenPort))
            server = ss
        } catch (e: Exception) { return "port ${cfg.listenPort} could not be opened (${e.message})" }
        running = true
        val tf = ThreadFactory { r -> Thread(r, "web-gate").also { it.isDaemon = true } }
        pool = Executors.newFixedThreadPool(12, tf)
        val ss = server!!
        Thread {
            while (running) {
                try {
                    val c = ss.accept()
                    pool?.execute { try { handle(c) } catch (e: Exception) { Quiet.note("WebGateProxy.handle", e) } finally { try { c.close() } catch (e: Exception) { Quiet.note("WebGateProxy.closeClient", e) } } }
                } catch (_: Exception) { if (!running) break }
            }
        }.also { it.isDaemon = true; it.name = "web-gate-accept"; it.start() }
        sweeper = Thread {
            while (running) {
                try { Thread.sleep(2000) } catch (_: InterruptedException) { break }
                try { sweep() } catch (e: Exception) { Quiet.note("WebGateProxy.sweep", e) }
            }
        }.also { it.isDaemon = true; it.name = "web-gate-sweep"; it.start() }
        null
    }

    fun stop() {
        closeAll()
        synchronized(lock) {
            running = false
            try { server?.close() } catch (e: Exception) { Quiet.note("WebGateProxy.stop", e) }
            server = null
            pool?.shutdownNow(); pool = null
            sweeper?.interrupt(); sweeper = null
        }
    }

    val isRunning: Boolean get() = running
    /** The port really bound (useful when the config asks for port 0). */
    val port: Int get() = server?.localPort ?: -1

    /** One-time entry ticket for [rawIp], valid while [consoleToken] is a live console session. */
    fun newTicket(rawIp: String?, consoleToken: String): String? {
        val ip = normIp(rawIp)
        if (ip.isEmpty() || consoleToken.isEmpty()) return null
        val t = token()
        synchronized(lock) {
            val now = clock()
            tickets.entries.removeIf { it.value.until < now }
            while (tickets.size >= MAX_TICKETS) tickets.remove(tickets.keys.first())
            tickets[t] = Ticket(ip, consoleToken, now + TICKET_MS)
        }
        return t
    }

    /** Logs every gate out of AdGuard Home and forgets it (host start, plugin switched off). */
    fun closeAll() {
        val cookies = synchronized(lock) {
            val c = gates.values.mapNotNull { cookieHeader(it) }
            gates.clear(); tickets.clear(); c
        }
        cookies.forEach { logoutUpstream(it) }
    }

    private fun cookieHeader(g: Gate): String? = if (g.jar.isEmpty()) null else g.jar.values.joinToString("; ")

    /** Ends gates whose console session is gone or that were idle too long, and (tabClose) logs out pages that were closed or went silent. */
    fun sweep() {
        val now = clock()
        val logouts = ArrayList<String>()
        synchronized(lock) {
            tickets.entries.removeIf { it.value.until < now }
            val it = gates.entries.iterator()
            while (it.hasNext()) {
                val g = it.next().value
                val dead = !consoleValid(g.consoleToken) || now - g.lastActivity > cfg.idleMs
                if (dead) { cookieHeader(g)?.let { c -> logouts.add(c) }; it.remove(); continue }
                if (!cfg.tabClose) continue
                val before = g.tabs.size
                g.tabs.entries.removeIf { now - it.value > TAB_STALE_MS }
                if (g.tabs.isEmpty() && before > 0 && g.emptySince == 0L) g.emptySince = now
                if (g.tabs.isEmpty() && g.jar.isNotEmpty() && now - maxOf(g.emptySince, g.lastActivity) > GRACE_MS) {
                    cookieHeader(g)?.let { c -> logouts.add(c) }; g.jar.clear()
                }
            }
        }
        logouts.forEach { logoutUpstream(it) }
    }

    /** Test helper: how many gates exist and whether the first one still holds an AdGuard Home cookie. */
    fun gateCount(): Int = synchronized(lock) { gates.size }
    /** True when nobody is logged in and no entry ticket is waiting: the listener can be stopped without harming anyone. */
    fun isIdle(): Boolean = synchronized(lock) { gates.isEmpty() && tickets.isEmpty() }
    fun anyCookie(): Boolean = synchronized(lock) { gates.values.any { it.jar.isNotEmpty() } }

    private fun logoutUpstream(cookie: String) {
        val path = cfg.logoutPath ?: return
        try {
            Socket().use { s ->
                s.connect(InetSocketAddress("127.0.0.1", cfg.upstreamPort), 2000); s.soTimeout = 3000
                s.getOutputStream().write(("GET $path HTTP/1.0\r\nHost: 127.0.0.1:${cfg.upstreamPort}\r\nCookie: $cookie\r\n\r\n").toByteArray(Charsets.ISO_8859_1))
                s.getOutputStream().flush()
                val buf = ByteArray(1024); while (s.getInputStream().read(buf) >= 0) { /* drain */ }
            }
        } catch (e: Exception) { Quiet.note("WebGateProxy.logout", e) }
    }

    // ---------- one connection ----------

    private class Req(val method: String, val target: String, val headers: List<Pair<String, String>>, val body: ByteArray) {
        fun header(n: String): String? = headers.firstOrNull { it.first == n }?.second
        val path: String get() = target.substringBefore('?')
        val query: String get() = if (target.contains('?')) target.substringAfter('?') else ""
    }

    private fun readHead(inp: InputStream): String? {
        val bo = ByteArrayOutputStream()
        var state = 0
        while (bo.size() < MAX_HEAD) {
            val b = inp.read()
            if (b < 0) return null
            bo.write(b)
            state = when {
                b == 13 && (state == 0 || state == 2) -> state + 1
                b == 10 && (state == 1 || state == 3) -> state + 1
                else -> 0
            }
            if (state == 4) return String(bo.toByteArray(), Charsets.ISO_8859_1)
        }
        return null
    }

    private fun parse(inp: InputStream): Req? {
        val head = readHead(inp) ?: return null
        val lines = head.split("\r\n").filter { it.isNotEmpty() }
        if (lines.isEmpty()) return null
        val rl = lines[0].split(" ")
        if (rl.size < 3 || !rl[1].startsWith("/")) return null
        val hs = ArrayList<Pair<String, String>>()
        for (l in lines.drop(1)) {
            val i = l.indexOf(':'); if (i <= 0) continue
            hs.add(l.substring(0, i).trim().lowercase() to l.substring(i + 1).trim())
        }
        if (hs.any { it.first == "transfer-encoding" }) return Req("TE", rl[1], hs, ByteArray(0))
        val len = hs.firstOrNull { it.first == "content-length" }?.second?.toIntOrNull() ?: 0
        if (len < 0 || len > MAX_REQ_BODY) return Req("BIG", rl[1], hs, ByteArray(0))
        val body = ByteArray(len)
        var off = 0
        while (off < len) { val n = inp.read(body, off, len - off); if (n < 0) return null; off += n }
        return Req(rl[0].uppercase(), rl[1], hs, body)
    }

    private fun reply(out: java.io.OutputStream, code: Int, reason: String, type: String, body: ByteArray, extra: List<String> = emptyList()) {
        val sb = StringBuilder("HTTP/1.1 $code $reason\r\nContent-Type: $type\r\nContent-Length: ${body.size}\r\nCache-Control: no-store\r\nConnection: close\r\nX-Content-Type-Options: nosniff\r\n")
        extra.forEach { sb.append(it).append("\r\n") }
        sb.append("\r\n")
        out.write(sb.toString().toByteArray(Charsets.ISO_8859_1)); out.write(body); out.flush()
    }

    private fun text(out: java.io.OutputStream, code: Int, reason: String, msg: String) =
        reply(out, code, reason, "text/plain; charset=utf-8", msg.toByteArray(Charsets.UTF_8))

    private fun gateOf(req: Req, ip: String): Pair<String, Gate>? {
        val cookie = req.header("cookie") ?: return null
        val tok = cookie.split(";").map { it.trim() }.firstOrNull { it.startsWith("${cfg.cookieName}=") }?.substringAfter('=') ?: return null
        if (!HEX_RX.matches(tok)) return null
        val g = synchronized(lock) { gates[tok] } ?: return null
        if (g.ip != ip) return null
        if (!consoleValid(g.consoleToken)) return null
        return tok to g
    }

    /** Short reason for the 403 page, so a failed Open can be diagnosed from the browser. Same checks as [gateOf], in the same order. */
    private fun whyNoGate(req: Req, ip: String): String {
        val cookie = req.header("cookie") ?: return "no cookie sent"
        val tok = cookie.split(";").map { it.trim() }.firstOrNull { it.startsWith("${cfg.cookieName}=") }?.substringAfter('=')
            ?: return "no ${cfg.cookieName} cookie"
        if (!HEX_RX.matches(tok)) return "cookie has a bad form, length ${tok.length}"
        val g = synchronized(lock) { gates[tok] } ?: return "gate session unknown or already ended"
        if (g.ip != ip) return "address changed: gate ${g.ip}, now $ip"
        if (!consoleValid(g.consoleToken)) return "MatchiTOOL console session ended"
        return "unknown"
    }

    private fun handle(sock: Socket) {
        sock.soTimeout = 20_000
        val inp = BufferedInputStream(sock.getInputStream())
        val out = sock.getOutputStream()
        val ip = normIp((sock.remoteSocketAddress as? InetSocketAddress)?.address?.hostAddress)
        val req = parse(inp) ?: return
        if (req.method == "TE") { text(out, 411, "Length Required", "Chunked request bodies are not supported."); return }
        if (req.method == "BIG") { text(out, 413, "Payload Too Large", "Request too large."); return }
        if (req.header("upgrade") != null) { text(out, 501, "Not Implemented", "WebSocket and other upgrades are not supported behind the MatchiTOOL gate."); return }
        val now = clock()
        when (req.path) {
            "/__matchi/gate.js" -> { reply(out, 200, "OK", "application/javascript; charset=utf-8", GATE_JS.toByteArray(Charsets.UTF_8)); return }
            "/__matchi/enter" -> {
                val t = req.query.split("&").firstOrNull { it.startsWith("t=") }?.substringAfter('=') ?: ""
                val tk = synchronized(lock) { if (HEX_RX.matches(t)) tickets.remove(t) else null }
                if (tk == null || tk.until < now || tk.ip != ip || !consoleValid(tk.consoleToken)) {
                    text(out, 403, "Forbidden", "This link is not valid any more. Press Open in the plugin in MatchiTOOL again."); return
                }
                val gt = token()
                val oldCookies = ArrayList<String>()
                synchronized(lock) {
                    while (gates.size >= MAX_GATES) { val k = gates.keys.first(); gates.remove(k)?.let { og -> cookieHeader(og)?.let { c -> oldCookies.add(c) } } }
                    gates[gt] = Gate(ip, tk.consoleToken, now)
                }
                oldCookies.forEach { logoutUpstream(it) }
                reply(out, 302, "Found", "text/plain; charset=utf-8", ByteArray(0), listOf("Location: /", "Set-Cookie: ${cfg.cookieName}=$gt; Path=/; HttpOnly; SameSite=Lax"))
                return
            }
        }
        val (_, gate) = gateOf(req, ip) ?: run {
            text(out, 403, "Forbidden", "Not signed in (" + whyNoGate(req, ip) + "). Press Open in the plugin in MatchiTOOL."); return
        }
        if (req.path == "/__matchi/hb" || req.path == "/__matchi/bye") {
            val tab = req.query.split("&").firstOrNull { it.startsWith("t=") }?.substringAfter('=') ?: ""
            if (TAB_RX.matches(tab)) synchronized(lock) {
                gate.lastActivity = now
                if (!cfg.tabClose) { /* not used */ }
                else if (req.path == "/__matchi/hb") { gate.tabs[tab] = now; gate.emptySince = 0L }
                else { gate.tabs.remove(tab); if (gate.tabs.isEmpty()) gate.emptySince = now }
            }
            reply(out, 204, "No Content", "text/plain", ByteArray(0)); return
        }
        synchronized(lock) { gate.lastActivity = now }
        forward(req, gate, out)
    }

    private val dropReq = setOf("host", "cookie", "connection", "keep-alive", "proxy-connection", "te", "trailer", "upgrade", "accept-encoding", "origin", "referer",
        "if-none-match", "if-modified-since", "if-range", "range", "content-length", "transfer-encoding", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto")
    private val dropResp = setOf("connection", "keep-alive", "transfer-encoding", "content-length", "set-cookie", "proxy-connection")

    private fun forward(req: Req, gate: Gate, out: java.io.OutputStream) {
        val up = Socket()
        val raw: ByteArray
        try {
            up.connect(InetSocketAddress("127.0.0.1", cfg.upstreamPort), 3000); up.soTimeout = 30_000
            val sb = StringBuilder("${req.method} ${req.target} HTTP/1.0\r\nHost: 127.0.0.1:${cfg.upstreamPort}\r\nAccept-Encoding: identity\r\n")
            for ((k, v) in req.headers) if (k !in dropReq) sb.append(k).append(": ").append(v).append("\r\n")
            if (req.header("origin") != null) sb.append("Origin: http://127.0.0.1:${cfg.upstreamPort}\r\n")
            if (req.header("referer") != null) sb.append("Referer: http://127.0.0.1:${cfg.upstreamPort}/\r\n")
            synchronized(lock) { cookieHeader(gate) }?.let { sb.append("Cookie: ").append(it).append("\r\n") }
            if (req.body.isNotEmpty() || req.method == "POST" || req.method == "PUT") sb.append("Content-Length: ${req.body.size}\r\n")
            sb.append("\r\n")
            val o = up.getOutputStream()
            o.write(sb.toString().toByteArray(Charsets.ISO_8859_1)); o.write(req.body); o.flush()
            val bo = ByteArrayOutputStream(); val buf = ByteArray(16384); val i = up.getInputStream()
            while (true) {
                val n = i.read(buf); if (n < 0) break
                bo.write(buf, 0, n)
                if (bo.size() > MAX_RESP) { text(out, 502, "Bad Gateway", "Answer too large."); return }
            }
            raw = bo.toByteArray()
        } catch (e: Exception) {
            text(out, 502, "Bad Gateway", "The page does not answer on 127.0.0.1:${cfg.upstreamPort}. Start it in the plugin."); return
        } finally { try { up.close() } catch (e: Exception) { Quiet.note("WebGateProxy.closeUpstream", e) } }

        val s = String(raw, Charsets.ISO_8859_1)
        val cut = s.indexOf("\r\n\r\n")
        if (cut < 0) { text(out, 502, "Bad Gateway", "The page sent no usable answer."); return }
        val headLines = s.substring(0, cut).split("\r\n")
        val statusLine = headLines[0]
        val code = statusLine.split(" ").getOrNull(1)?.toIntOrNull() ?: 502
        var body = raw.copyOfRange(cut + 4, raw.size)
        val rh = ArrayList<Pair<String, String>>()
        for (l in headLines.drop(1)) {
            val i = l.indexOf(':'); if (i <= 0) continue
            rh.add(l.substring(0, i).trim() to l.substring(i + 1).trim())
        }
        // The target's cookies stay here. The browser never gets them.
        for ((k, v) in rh) if (k.equals("set-cookie", true)) {
            val pair = v.substringBefore(';').trim()
            val name = pair.substringBefore('=').trim()
            if (!pair.contains('=') || !COOKIE_NAME_RX.matches(name) || name == cfg.cookieName) continue
            val value = pair.substringAfter('=')
            val lc = v.lowercase()
            val cleared = value.isEmpty() || Regex("max-age=\\s*(0|-)").containsMatchIn(lc) || lc.contains("expires=thu, 01 jan 1970")
            synchronized(lock) {
                if (cleared) {
                    gate.jar.remove(name)
                } else if (value.length <= 4096 && (gate.jar.containsKey(name) || gate.jar.size < MAX_JAR)) {
                    gate.jar[name] = pair
                }
                Unit
            }
        }
        val ctype = rh.firstOrNull { it.first.equals("content-type", true) }?.second ?: ""
        val encoded = rh.any { it.first.equals("content-encoding", true) }
        val isHtml = ctype.lowercase().startsWith("text/html")
        if (cfg.tabClose && isHtml && !encoded && req.method != "HEAD") {
            val tag = "<script src=\"/__matchi/gate.js\"></script>"
            val h = String(body, Charsets.ISO_8859_1)
            val at = h.lowercase().lastIndexOf("</body>")
            body = (if (at >= 0) h.substring(0, at) + tag + h.substring(at) else h + tag).toByteArray(Charsets.ISO_8859_1)
        }
        val noBody = req.method == "HEAD" || code == 204 || code == 304 || code in 100..199
        val noStore = isHtml || req.path.startsWith("/control/")
        val sb = StringBuilder("HTTP/1.1 ").append(statusLine.substringAfter(' ', "$code")).append("\r\n")
        for ((k, v) in rh) {
            val lk = k.lowercase()
            if (lk in dropResp) continue
            if (noStore && lk == "cache-control") continue
            val vv = if (lk == "location") v.replace("http://127.0.0.1:${cfg.upstreamPort}", "") else v
            sb.append(k).append(": ").append(vv).append("\r\n")
        }
        if (noStore) sb.append("Cache-Control: no-store\r\n")
        if (req.method == "HEAD") rh.firstOrNull { it.first.equals("content-length", true) }?.let { sb.append("Content-Length: ").append(it.second).append("\r\n") }
        else if (!noBody) sb.append("Content-Length: ${body.size}\r\n")
        sb.append("Connection: close\r\n\r\n")
        out.write(sb.toString().toByteArray(Charsets.ISO_8859_1))
        if (!noBody) out.write(body)
        out.flush()
    }
}

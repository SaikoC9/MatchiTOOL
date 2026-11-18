package com.matchi.tool

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

/** Runs the gate against a tiny fake web page on loopback. No Android classes. The clock is fake, so no test sleeps. */
class WebGateProxyTest {
    private class Resp(val code: Int, val headers: List<Pair<String, String>>, val body: String) {
        fun h(n: String) = headers.filter { it.first.equals(n, true) }.map { it.second }
    }

    private val now = AtomicLong(1_000_000L)
    private val valid = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()
    private val seen = CopyOnWriteArrayList<String>()          // "METHOD path | cookie" as the fake page received it
    private var upSrv: ServerSocket? = null
    private val upPool = Executors.newCachedThreadPool { r -> Thread(r).also { it.isDaemon = true } }
    private var proxy: WebGateProxy? = null

    @Before fun setUp() { valid.add("tok"); startUpstream() }
    @After fun tearDown() { proxy?.stop(); upSrv?.close(); upPool.shutdownNow() }

    // ---- fake page ----
    private fun startUpstream() {
        val ss = ServerSocket(0, 50, java.net.InetAddress.getByName("127.0.0.1")); upSrv = ss
        Thread { while (!ss.isClosed) { try { val c = ss.accept(); upPool.execute { try { upstream(c) } catch (_: Exception) {} finally { c.close() } } } catch (_: Exception) {} } }.also { it.isDaemon = true }.start()
    }

    private fun upstream(c: Socket) {
        val inp = c.getInputStream()
        val bo = ByteArrayOutputStream(); var st = 0
        while (st < 4) { val b = inp.read(); if (b < 0) return; bo.write(b); st = if ((b == 13 && (st == 0 || st == 2)) || (b == 10 && (st == 1 || st == 3))) st + 1 else 0 }
        val lines = String(bo.toByteArray(), Charsets.ISO_8859_1).split("\r\n").filter { it.isNotEmpty() }
        val (m, path) = lines[0].split(" ").let { it[0] to it[1] }
        val hs = lines.drop(1).associate { it.substringBefore(':').lowercase() to it.substringAfter(':').trim() }
        val len = hs["content-length"]?.toInt() ?: 0
        val body = ByteArray(len); var off = 0; while (off < len) { val n = inp.read(body, off, len - off); if (n < 0) break; off += n }
        seen.add("$m $path | ${hs["cookie"] ?: ""}")
        fun send(code: Int, ct: String, b: String, extra: List<String> = emptyList()) {
            val sb = StringBuilder("HTTP/1.0 $code X\r\nContent-Type: $ct\r\nContent-Length: ${b.toByteArray().size}\r\n"); extra.forEach { sb.append(it).append("\r\n") }; sb.append("\r\n")
            c.getOutputStream().write(sb.toString().toByteArray()); c.getOutputStream().write(b.toByteArray()); c.getOutputStream().flush()
        }
        when {
            path == "/login" -> send(200, "application/json", "{}", listOf("Set-Cookie: a=1; Path=/; Max-Age=2592000", "Set-Cookie: b=2; Path=/; Expires=Fri, 01 Jan 2027 00:00:00 GMT"))
            path == "/clearb" -> send(200, "text/plain", "x", listOf("Set-Cookie: b=; Max-Age=0"))
            path == "/logout" -> send(302, "text/plain", "", listOf("Set-Cookie: a=; Max-Age=0", "Location: http://127.0.0.1:${upSrv!!.localPort}/login.html"))
            path == "/redir" -> send(302, "text/plain", "", listOf("Location: http://127.0.0.1:${upSrv!!.localPort}/next"))
            path == "/big" -> send(200, "text/plain", "z".repeat(1000))
            path == "/slowbody" -> send(200, "text/plain", "ok")
            else -> send(200, "text/html", "<html><body>HELLO $m ${String(body)}</body></html>")
        }
    }

    private fun gate(tabClose: Boolean = false, idleMs: Long = 3_600_000L, logout: String? = "/logout"): WebGateProxy {
        val p = WebGateProxy(WebGateConfig(0, upSrv!!.localPort, logout, idleMs, tabClose), { valid.contains(it) }, { now.get() })
        assertNull(p.start()); proxy = p; return p
    }

    // ---- tiny HTTP client ----
    private fun http(method: String, target: String, cookie: String? = null, body: String = "", extra: List<String> = emptyList(), raw: String? = null): Resp {
        Socket().use { s ->
            s.connect(InetSocketAddress("127.0.0.1", proxy!!.port), 3000); s.soTimeout = 5000
            val req = raw ?: buildString {
                append("$method $target HTTP/1.1\r\nHost: x\r\n")
                if (cookie != null) append("Cookie: $cookie\r\n")
                extra.forEach { append(it).append("\r\n") }
                if (body.isNotEmpty() || method == "POST") append("Content-Length: ${body.toByteArray().size}\r\n")
                append("\r\n").append(body)
            }
            s.getOutputStream().write(req.toByteArray()); s.getOutputStream().flush()
            val all = s.getInputStream().readBytes(); val t = String(all, Charsets.ISO_8859_1)
            val cut = t.indexOf("\r\n\r\n"); val hl = t.substring(0, cut).split("\r\n")
            val hs = hl.drop(1).map { it.substringBefore(':') to it.substringAfter(':').trim() }
            return Resp(hl[0].split(" ")[1].toInt(), hs, t.substring(cut + 4))
        }
    }

    private fun enter(p: WebGateProxy, ip: String = "127.0.0.1", token: String = "tok"): String {
        val t = p.newTicket(ip, token)!!
        val r = http("GET", "/__matchi/enter?t=$t")
        assertEquals(302, r.code)
        return r.h("Set-Cookie").single().substringBefore(';')
    }

    // ---- fail closed ----
    @Test fun noCookieIs403AndNeverReachesThePage() {
        gate(); assertEquals(403, http("GET", "/").code); assertTrue(seen.isEmpty())
    }

    @Test fun badCookieIs403() {
        gate(); assertEquals(403, http("GET", "/", "matchi_gate=" + "a".repeat(64)).code); assertEquals(403, http("GET", "/", "matchi_gate=zz").code)
    }

    @Test fun deadConsoleSessionIs403() {
        val p = gate(); val c = enter(p); assertEquals(200, http("GET", "/", c).code)
        valid.remove("tok"); assertEquals(403, http("GET", "/", c).code)
    }

    @Test fun cookieOfAnotherAddressIs403() {
        val p = gate(); val t = p.newTicket("10.9.9.9", "tok")!!
        assertEquals(403, http("GET", "/__matchi/enter?t=$t").code)   // the client here is 127.0.0.1, not 10.9.9.9
    }

    // ---- tickets ----
    @Test fun ticketWorksOnce() {
        val p = gate(); val t = p.newTicket("127.0.0.1", "tok")!!
        assertEquals(302, http("GET", "/__matchi/enter?t=$t").code); assertEquals(403, http("GET", "/__matchi/enter?t=$t").code)
    }

    @Test fun ticketExpiresAfter60Seconds() {
        val p = gate(); val t = p.newTicket("127.0.0.1", "tok")!!
        now.addAndGet(WebGateProxy.TICKET_MS + 1); assertEquals(403, http("GET", "/__matchi/enter?t=$t").code)
    }

    @Test fun ticketNeedsALiveConsoleSession() {
        val p = gate(); val t = p.newTicket("127.0.0.1", "tok")!!; valid.remove("tok")
        assertEquals(403, http("GET", "/__matchi/enter?t=$t").code)
    }

    // ---- cookies ----
    @Test fun targetCookiesStayOnTheRouterAndGoUpstreamNextTime() {
        val p = gate(); val c = enter(p)
        val r = http("POST", "/login", c, "pw")
        assertTrue(r.h("Set-Cookie").isEmpty())
        http("GET", "/x", c)
        assertTrue(seen.last().endsWith("| a=1; b=2"))
        assertTrue(c.startsWith("matchi_gate="))
    }

    @Test fun aClearingCookieEmptiesThatCookieOnly() {
        val p = gate(); val c = enter(p); http("POST", "/login", c, "pw"); http("GET", "/clearb", c); http("GET", "/x", c)
        assertTrue(seen.last().endsWith("| a=1"))
    }

    @Test fun browserCookieHasNoExpiry() {
        val p = gate(); val t = p.newTicket("127.0.0.1", "tok")!!
        val sc = http("GET", "/__matchi/enter?t=$t").h("Set-Cookie").single().lowercase()
        assertFalse(sc.contains("expires")); assertFalse(sc.contains("max-age")); assertTrue(sc.contains("httponly"))
    }

    // ---- sign-out, idle, logout ----
    @Test fun sweepAfterSignOutLogsOutTheTargetOnceAndDropsTheGate() {
        val p = gate(); val c = enter(p); http("POST", "/login", c, "pw")
        valid.remove("tok"); p.sweep()
        assertEquals(1, seen.count { it.startsWith("GET /logout") }); assertEquals(0, p.gateCount())
    }

    @Test fun idleEndsTheGate() {
        val p = gate(idleMs = 10_000); val c = enter(p); http("POST", "/login", c, "pw")
        now.addAndGet(9_000); p.sweep(); assertEquals(1, p.gateCount())
        now.addAndGet(2_000); p.sweep(); assertEquals(0, p.gateCount()); assertEquals(403, http("GET", "/", c).code)
    }

    @Test fun activityKeepsTheGateAlive() {
        val p = gate(idleMs = 10_000); val c = enter(p)
        repeat(5) { now.addAndGet(8_000); assertEquals(200, http("GET", "/", c).code); p.sweep() }
        assertEquals(1, p.gateCount())
    }

    @Test fun noLogoutPathMeansNoLogoutCall() {
        val p = gate(logout = null); val c = enter(p); http("POST", "/login", c, "pw"); valid.remove("tok"); p.sweep()
        assertEquals(0, seen.count { it.startsWith("GET /logout") })
    }

    // ---- tab close ----
    @Test fun tabCloseOffLeavesHtmlAlone() {
        val p = gate(tabClose = false); val c = enter(p)
        assertFalse(http("GET", "/", c).body.contains("gate.js"))
    }

    @Test fun tabCloseOnInjectsTheScript() {
        val p = gate(tabClose = true); val c = enter(p)
        assertTrue(http("GET", "/", c).body.contains("<script src=\"/__matchi/gate.js\"></script></body>"))
    }

    @Test fun closingTheLastPageLogsOutAfterTheGrace() {
        val p = gate(tabClose = true); val c = enter(p); http("POST", "/login", c, "pw")
        http("POST", "/__matchi/hb?t=tab1abcd", c); http("POST", "/__matchi/bye?t=tab1abcd", c)
        now.addAndGet(WebGateProxy.GRACE_MS - 1000); p.sweep(); assertTrue(p.anyCookie())
        now.addAndGet(2000); p.sweep(); assertFalse(p.anyCookie()); assertEquals(1, p.gateCount())
    }

    @Test fun aPageChangeInsideTheGraceDoesNotLogOut() {
        val p = gate(tabClose = true); val c = enter(p); http("POST", "/login", c, "pw")
        http("POST", "/__matchi/hb?t=tab1abcd", c); http("POST", "/__matchi/bye?t=tab1abcd", c)
        now.addAndGet(2000); http("POST", "/__matchi/hb?t=tab2abcd", c)
        now.addAndGet(WebGateProxy.GRACE_MS * 2); p.sweep(); assertTrue(p.anyCookie())
    }

    @Test fun anotherOpenTabKeepsTheLogin() {
        val p = gate(tabClose = true); val c = enter(p); http("POST", "/login", c, "pw")
        http("POST", "/__matchi/hb?t=tab1abcd", c); http("POST", "/__matchi/hb?t=tab2abcd", c); http("POST", "/__matchi/bye?t=tab1abcd", c)
        now.addAndGet(WebGateProxy.GRACE_MS * 2); http("POST", "/__matchi/hb?t=tab2abcd", c); p.sweep(); assertTrue(p.anyCookie())
    }

    @Test fun aSilentPageGoesStaleAfter150Seconds() {
        val p = gate(tabClose = true); val c = enter(p); http("POST", "/login", c, "pw"); http("POST", "/__matchi/hb?t=tab1abcd", c)
        now.addAndGet(WebGateProxy.TAB_STALE_MS + 1000); p.sweep()            // tab goes stale, empty clock starts now
        now.addAndGet(WebGateProxy.GRACE_MS + 1000); p.sweep(); assertFalse(p.anyCookie())
    }

    // ---- http details ----
    @Test fun redirectsLoseTheTargetAddress() {
        val p = gate(); val c = enter(p); assertEquals("/next", http("GET", "/redir", c).h("Location").single())
    }

    @Test fun hugeRequestIs413ChunkedIs411UpgradeIs501() {
        val p = gate(); val c = enter(p)
        assertEquals(413, http("POST", "/x", c, raw = "POST /x HTTP/1.1\r\nHost: x\r\nCookie: $c\r\nContent-Length: ${WebGateProxy.MAX_REQ_BODY + 1}\r\n\r\n").code)
        assertEquals(411, http("POST", "/x", c, raw = "POST /x HTTP/1.1\r\nHost: x\r\nCookie: $c\r\nTransfer-Encoding: chunked\r\n\r\n").code)
        assertEquals(501, http("GET", "/x", c, extra = listOf("Upgrade: websocket")).code)
    }

    @Test fun pageDownIs502() {
        val p = gate(); val c = enter(p); upSrv!!.close(); Thread.sleep(50)
        assertEquals(502, http("GET", "/", c).code)
    }

    @Test fun postBodyReachesThePage() {
        val p = gate(); val c = enter(p); assertTrue(http("POST", "/echo", c, "hello").body.contains("HELLO POST hello"))
    }

    @Test fun headHasNoBody() {
        val p = gate(); val c = enter(p); assertEquals("", http("HEAD", "/big", c).body)
    }

    @Test fun manyRequestsAtOnceDoNotDeadlock() {
        val p = gate(); val c = enter(p); val pool = Executors.newFixedThreadPool(20); val ok = java.util.concurrent.atomic.AtomicInteger(); val l = CountDownLatch(40)
        repeat(40) { pool.execute { try { if (http("GET", "/big", c).code == 200) ok.incrementAndGet() } finally { l.countDown() } } }
        assertTrue(l.await(20, TimeUnit.SECONDS)); pool.shutdownNow(); assertEquals(40, ok.get())
    }

    @Test fun closeAllLogsOutEveryGate() {
        val p = gate(); val c = enter(p); http("POST", "/login", c, "pw"); p.closeAll()
        assertEquals(1, seen.count { it.startsWith("GET /logout") }); assertEquals(403, http("GET", "/", c).code)
    }

    @Test fun normIpHandlesMappedAndScoped() {
        assertEquals("1.2.3.4", WebGateProxy.normIp("::ffff:1.2.3.4")); assertEquals("fe80::1", WebGateProxy.normIp("FE80::1%wlan0")); assertEquals("1.2.3.4", WebGateProxy.normIp("/1.2.3.4"))
        assertNotNull(WebGateProxy.GATE_JS)
    }
}

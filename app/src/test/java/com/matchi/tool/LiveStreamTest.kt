package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.InputStream
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicBoolean

/** The frames, the stream and the viewer counting of the Live push route (no Android classes, no root, no network). */
class LiveStreamTest {
    private fun snap(
        at: Long = 1000, cpu: Double? = 12.5, cores: List<CorePct> = listOf(CorePct(0, 10.0), CorePct(1, 20.0)),
        freqs: List<CoreFreq> = listOf(CoreFreq(0, true, 936000, 1800000), CoreFreq(1, false, 0, 1800000)),
        zones: List<ThermalZone> = listOf(ThermalZone("soc-thermal", 45.0), ThermalZone("mdm-q6", 51.5)),
        sys: SysInfo? = SysInfo(0.1, 0.2, 0.3, 100.5, 4000000, 2000000), sysAt: Long? = 1000
    ) = LiveSnapshot(at, cpu, cores, freqs, zones, sys, if (sys == null) null else sysAt)

    // ---- frames ----

    @Test fun theFirstFrameIsFullAndCarriesEverything() {
        val f = LiveFrameEncoder().encode(snap())
        assertEquals(
            "{\"v\":1,\"seq\":1,\"t\":1000,\"full\":true,\"cpu\":12.5,\"pc\":{\"0\":10.0,\"1\":20.0}," +
                "\"fq\":{\"0\":[1,936000,1800000],\"1\":[0,0,1800000]},\"tz\":{\"soc-thermal\":45.0,\"mdm-q6\":51.5}," +
                "\"sys\":{\"l\":[0.1,0.2,0.3],\"up\":100.5,\"mt\":4000000,\"ma\":2000000,\"at\":1000}}", f)
        assertFalse("one line only", f.contains('\n'))
    }

    @Test fun laterFramesCarryOnlyWhatChanged() {
        val e = LiveFrameEncoder()
        e.encode(snap())
        val same = e.encode(snap(at = 2000))
        assertEquals("{\"v\":1,\"seq\":2,\"t\":2000,\"full\":false}", same)                        // nothing changed: only the stamp
        val warmer = e.encode(snap(at = 3000, zones = listOf(ThermalZone("soc-thermal", 46.0), ThermalZone("mdm-q6", 51.5))))
        assertEquals("{\"v\":1,\"seq\":3,\"t\":3000,\"full\":false,\"tz\":{\"soc-thermal\":46.0}}", warmer)
        val busier = e.encode(snap(at = 4000, cpu = 80.0, cores = listOf(CorePct(0, 10.0), CorePct(1, 90.0)),
            zones = listOf(ThermalZone("soc-thermal", 46.0), ThermalZone("mdm-q6", 51.5))))
        assertEquals("{\"v\":1,\"seq\":4,\"t\":4000,\"full\":false,\"cpu\":80.0,\"pc\":{\"1\":90.0}}", busier)
    }

    @Test fun systemValuesAreSentWhenTheyAreReadAgainNotEverySecond() {
        val e = LiveFrameEncoder()
        e.encode(snap())
        // carried forward unchanged (same sysAt): not repeated
        assertFalse(e.encode(snap(at = 2000)).contains("\"sys\""))
        // read again: new numbers and a new "at"
        val again = e.encode(snap(at = 6000, sys = SysInfo(0.2, 0.2, 0.3, 105.5, 4000000, 1900000), sysAt = 6000))
        assertTrue(again, again.contains("\"sys\":{\"l\":[0.2,0.2,0.3],\"up\":105.5,\"mt\":4000000,\"ma\":1900000,\"at\":6000}"))
    }

    @Test fun everyNthFrameIsFullAgainSoNothingStaysWrong() {
        val e = LiveFrameEncoder(fullEvery = 3)
        val fulls = (1..7).map { e.encode(snap(at = it * 1000L)).contains("\"full\":true") }
        assertEquals(listOf(true, false, false, true, false, false, true), fulls)
        // a full frame repeats everything even though nothing changed
        val e2 = LiveFrameEncoder(fullEvery = 2)
        e2.encode(snap()); e2.encode(snap(at = 2000))
        assertTrue(e2.encode(snap(at = 3000)).contains("\"tz\":{\"soc-thermal\":45.0"))
    }

    @Test fun aDroppedFrameMakesTheNextOneFull() {
        val e = LiveFrameEncoder()
        e.encode(snap())
        e.encode(snap(at = 2000, cpu = 50.0))
        e.forceFull()
        val f = e.encode(snap(at = 3000, cpu = 50.0))
        assertTrue(f, f.contains("\"full\":true") && f.contains("\"cpu\":50.0") && f.contains("\"pc\":{\"0\":10.0"))
        assertTrue(e.encode(snap(at = 4000, cpu = 50.0)).contains("\"full\":false"))
    }

    @Test fun anUnknownCpuIsLeftOutAndAFullFrameStillHasTheGroups() {
        val f = LiveFrameEncoder().encode(snap(cpu = null, cores = emptyList(), freqs = emptyList(), zones = emptyList(), sys = null))
        assertEquals("{\"v\":1,\"seq\":1,\"t\":1000,\"full\":true,\"pc\":{},\"fq\":{},\"tz\":{}}", f)
    }

    @Test fun oddNamesAndNumbersCannotBreakTheLine() {
        assertEquals("\"a\\\"b\\\\c\\u000ad\"", liveJsonString("a\"b\\c\nd"))
        val f = LiveFrameEncoder().encode(snap(cpu = Double.NaN, zones = listOf(ThermalZone("x\"y\n", 40.0))))
        assertFalse(f, f.contains('\n'))
        assertTrue(f, f.contains("\"cpu\":null"))
        assertTrue(f, f.contains("\"x\\\"y\\u000a\":40.0"))
    }

    // ---- stream and hub (a fake root reader instead of su) ----

    private class FakeShell : LiveShell {
        val queue = LinkedBlockingQueue<String>()
        override fun readLine(): String? { val x = queue.take(); return if (x === END) null else x }
        override fun close() { queue.add(END) }
        companion object { val END = String() }
    }

    private fun line(cpu: String, z: String = "soc=45000", s: String = "") = "@L1|c:;cpu $cpu;cpu0 $cpu|f:;0 1 936000 1800000|z:;$z|s:$s"

    private val pool = Executors.newCachedThreadPool { r -> Thread(r).apply { isDaemon = true } }

    /** One read of the stream, with a time limit (a stream that never answers would otherwise hang the test run). */
    private fun chunk(s: InputStream, ms: Long = 5000): String? {
        val f = pool.submit(Callable<String?> { val b = ByteArray(8192); val n = s.read(b, 0, b.size); if (n < 0) null else String(b, 0, n, Charsets.UTF_8) })
        return try { f.get(ms, TimeUnit.MILLISECONDS) } catch (e: TimeoutException) { f.cancel(true); throw AssertionError("nothing arrived within $ms ms") }
    }

    /** Reads until a chunk containing [needle] arrives; returns that chunk. */
    private fun until(s: InputStream, needle: String, maxChunks: Int = 50): String {
        repeat(maxChunks) { val c = chunk(s) ?: throw AssertionError("stream ended before \"$needle\""); if (c.contains(needle)) return c }
        throw AssertionError("\"$needle\" never arrived")
    }

    private val fast = LiveTiming(tickMs = 10, pingMs = 40, stallMs = 120, maxLifeMs = 60_000, allowedEveryMs = 10, graceMs = 0)

    private fun hub(shell: FakeShell, max: Int = 4, timing: LiveTiming = fast) = LiveHub(LiveSampler({ shell }, delayMs = { 1 }), max, timing)

    @Test fun firstViewerStartsTheSamplerAndTheLastOneStopsIt() {
        val shell = FakeShell()
        val sampler = LiveSampler({ shell }, delayMs = { 1 })
        val h = LiveHub(sampler, 4, fast)
        assertFalse(sampler.isRunning())
        val a = h.open { true }!!
        assertTrue(sampler.isRunning())
        val b = h.open { true }!!
        assertEquals(2, h.viewers())
        a.close()
        assertTrue("still one viewer", sampler.isRunning())
        b.close()
        assertFalse("no viewer left", sampler.isRunning())
        assertEquals(0, h.viewers())
        b.close(); a.close()                                                                  // closing again must not count twice
        assertEquals(0, h.viewers())
        val c = h.open { true }!!                                                             // and it can start again
        assertTrue(sampler.isRunning())
        c.close()
    }

    @Test fun onlyAFewViewersAtOnce() {
        val h = hub(FakeShell(), max = 2)
        val a = h.open { true }!!
        val b = h.open { true }!!
        assertNull(h.open { true })
        a.close()
        val c = h.open { true }
        assertNotNull(c)
        b.close(); c!!.close()
    }

    @Test fun aViewerGetsAFullFrameThenOnlyChanges() {
        val shell = FakeShell()
        val h = hub(shell)
        val s = h.open { true }!!
        assertEquals(": connected\n\n", chunk(s))
        shell.queue.add(line("0 0 0 0 0 0 0 0", s = "0.1 0.2 0.3 50.0 1000 500"))
        val first = until(s, "data: ")
        assertTrue(first, first.startsWith("data: {\"v\":1,\"seq\":1,") && first.contains("\"full\":true") && first.contains("\"sys\":{"))
        assertFalse("no percentage after one round: " + first, first.contains("\"cpu\""))
        shell.queue.add(line("100 0 0 100 0 0 0 0"))
        val second = until(s, "data: ")
        assertTrue(second, second.contains("\"seq\":2") && second.contains("\"full\":false") && second.contains("\"cpu\":50.0"))
        assertFalse("the system values did not change", second.contains("\"sys\""))
        assertFalse("the temperature did not change", second.contains("\"tz\""))
        assertTrue(second.endsWith("\n\n"))
        s.close()
    }

    @Test fun twoViewersEachGetTheirOwnFullFrame() {
        val shell = FakeShell()
        val h = hub(shell)
        val a = h.open { true }!!
        shell.queue.add(line("0 0 0 0 0 0 0 0"))
        assertTrue(until(a, "data: ").contains("\"full\":true"))
        val b = h.open { true }!!                                                             // joins while the sampler already runs
        shell.queue.add(line("10 0 0 10 0 0 0 0"))
        assertTrue("the newcomer starts with a full frame", until(b, "data: ").contains("\"full\":true"))
        assertTrue("the first viewer keeps getting changes", until(a, "data: ").contains("\"full\":false"))
        a.close(); b.close()
    }

    @Test fun aSessionThatIsNoLongerAllowedEndsTheStream() {
        val shell = FakeShell()
        val sampler = LiveSampler({ shell }, delayMs = { 1 })
        val h = LiveHub(sampler, 4, fast)
        val ok = AtomicBoolean(true)
        val s = h.open { ok.get() }!!
        assertEquals(": connected\n\n", chunk(s))
        ok.set(false)
        val end = until(s, "event: end")
        assertEquals("event: end\ndata: {\"reason\":\"session\"}\n\n", end)
        assertNull("the stream closes after it", chunk(s))
        s.close()
        assertFalse("and the root reader is stopped with it", sampler.isRunning())
    }

    @Test fun everyStreamEndsByItself() {
        val h = hub(FakeShell(), timing = fast.copy(maxLifeMs = 60))
        val s = h.open { true }!!
        assertEquals("event: end\ndata: {\"reason\":\"lifetime\"}\n\n", until(s, "event: end"))
        assertNull(chunk(s))
        s.close()
    }

    @Test fun aSilentReaderIsReportedOnceAndPingsKeepTheLineOpen() {
        val shell = FakeShell()
        val h = hub(shell)
        val s = h.open { true }!!
        val stale = until(s, "event: stale")
        assertTrue(stale, stale.startsWith("event: stale\ndata: {\"note\":\"") && stale.endsWith("\n\n"))
        // after that only pings, not another stale event
        val next = StringBuilder()
        repeat(3) { next.append(chunk(s)) }
        assertFalse(next.toString(), next.contains("event: stale"))
        assertTrue(next.toString(), next.contains(": ping"))
        shell.queue.add(line("5 0 0 5 0 0 0 0"))                                              // the reader comes back: data flows again
        assertTrue(until(s, "data: ").contains("\"seq\":1"))
        s.close()
    }

    @Test fun closingEndsTheStreamAndFreesTheSlot() {
        val h = hub(FakeShell(), max = 1)
        val s = h.open { true }!!
        s.close()
        assertNull("a closed stream reads as ended, even with its first line still waiting", chunk(s))
        assertEquals(0, h.viewers())
        assertNotNull("the slot is free again", h.open { true }?.also { it.close() })
    }

    @Test fun anInterruptedWaitEndsTheRead() {
        val h = hub(FakeShell(), timing = fast.copy(tickMs = 5_000, pingMs = 60_000, stallMs = 60_000))
        val s = h.open { true }!!
        assertEquals(": connected\n\n", chunk(s))
        val result = LinkedBlockingQueue<Int>()
        val t = Thread { result.add(s.read(ByteArray(64), 0, 64)) }.apply { isDaemon = true; start() }
        Thread.sleep(50)                                                                      // now it waits for the next frame
        t.interrupt()                                                                         // what the server does to a worker it gives up on
        assertEquals(-1, result.poll(2, TimeUnit.SECONDS))
        s.close()
        assertEquals(0, h.viewers())
    }

    // ---- Phase 3: run only while watched ----

    /** A timer the test fires by hand, so the 10 s grace time does not have to be waited for. */
    private class ManualTimer {
        class Entry(val task: () -> Unit) { var cancelled = false }
        val entries = ArrayList<Entry>()
        fun schedule(ms: Long, task: () -> Unit): () -> Unit { val e = Entry(task); entries.add(e); return { e.cancelled = true } }
        fun fireAll() { val now = ArrayList(entries); entries.clear(); for (e in now) if (!e.cancelled) e.task() }
        fun pending() = entries.count { !it.cancelled }
    }

    private val grace = fast.copy(graceMs = 10_000)

    @Test fun theLastViewerLeavingStopsTheReaderOnlyAfterTheGraceTime() {
        val timer = ManualTimer()
        val sampler = LiveSampler({ FakeShell() }, delayMs = { 1 })
        val h = LiveHub(sampler, 4, grace, schedule = timer::schedule)
        val a = h.open({ true }, "tok")!!
        assertTrue(sampler.isRunning())
        a.close()
        assertEquals(0, h.viewers())
        assertTrue("still running during the grace time", sampler.isRunning())
        assertEquals(1, timer.pending())
        timer.fireAll()
        assertFalse("stopped when the grace time is over", sampler.isRunning())
    }

    @Test fun aViewerWhoComesBackDuringTheGraceTimeKeepsTheReader() {
        val timer = ManualTimer()
        val sampler = LiveSampler({ FakeShell() }, delayMs = { 1 })
        val h = LiveHub(sampler, 4, grace, schedule = timer::schedule)
        h.open({ true }, "tok")!!.close()
        val b = h.open({ true }, "tok")!!
        assertEquals("the pending stop was cancelled", 0, timer.pending())
        timer.fireAll()                                                                       // even a timer that fires late does nothing
        assertTrue(sampler.isRunning())
        b.close()
        assertEquals(1, timer.pending())
        timer.fireAll()
        assertFalse(sampler.isRunning())
    }

    @Test fun aHiddenTabDoesNotKeepTheReaderAliveAndAVisibleOneStartsItAgain() {
        val timer = ManualTimer()
        val sampler = LiveSampler({ FakeShell() }, delayMs = { 1 })
        val h = LiveHub(sampler, 4, grace, schedule = timer::schedule)
        val a = h.open({ true }, "tok")!!
        assertEquals(1, h.watching())
        assertTrue(h.setVisible(a.id, "tok", false))
        assertEquals(0, h.watching())
        assertEquals("the stream itself stays open", 1, h.viewers())
        assertTrue(sampler.isRunning())
        timer.fireAll()
        assertFalse("hidden for the whole grace time: the reader is gone", sampler.isRunning())
        assertTrue(h.setVisible(a.id, "tok", true))
        assertTrue("visible again: it starts again", sampler.isRunning())
        a.close()
        timer.fireAll()
        assertFalse(sampler.isRunning())
    }

    @Test fun oneVisibleViewerIsEnoughEvenIfAnotherTabIsHidden() {
        val timer = ManualTimer()
        val sampler = LiveSampler({ FakeShell() }, delayMs = { 1 })
        val h = LiveHub(sampler, 4, grace, schedule = timer::schedule)
        val a = h.open({ true }, "t1")!!
        val b = h.open({ true }, "t2")!!
        assertTrue(h.setVisible(a.id, "t1", false))
        assertEquals(0, timer.pending())
        assertTrue(sampler.isRunning())
        a.close(); b.close()
    }

    @Test fun onlyTheSessionThatOpenedTheStreamCanHideIt() {
        val h = LiveHub(LiveSampler({ FakeShell() }, delayMs = { 1 }), 4, fast)
        val a = h.open({ true }, "mine")!!
        assertFalse("somebody else", h.setVisible(a.id, "other", false))
        assertFalse("no session at all", h.setVisible(a.id, "", false))
        assertFalse("unknown stream", h.setVisible("0123456789ab", "mine", false))
        assertEquals(1, h.watching())
        val none = h.open({ true })!!                                                         // a stream opened without a token can never be changed
        assertFalse(h.setVisible(none.id, "", false))
        a.close(); none.close()
    }

    @Test fun everyStreamHasItsOwnId() {
        val h = LiveHub(LiveSampler({ FakeShell() }, delayMs = { 1 }), 4, fast)
        val a = h.open({ true }, "t")!!
        val b = h.open({ true }, "t")!!
        assertTrue(a.id.length == 24 && a.id.all { it in "0123456789abcdef" })
        assertTrue(a.id != b.id)
        a.close(); b.close()
    }

    @Test fun aNewViewerGetsTheLastReadingAtOnce() {
        val shell = FakeShell()
        val h = hub(shell)
        val a = h.open { true }!!
        shell.queue.add(line("0 0 0 0 0 0 0 0", z = "soc=47000", s = "0.1 0.2 0.3 50.0 1000 500"))
        until(a, "data: ")
        a.close()                                                                             // grace 0 in this test: the reader stops, the last reading stays
        val b = h.open { true }!!
        assertEquals(": connected\n\n", chunk(b))
        val first = until(b, "data: ")                                                        // no new line was fed: this is the cached one
        assertTrue(first, first.contains("\"full\":true") && first.contains("\"soc\":47.0") && first.contains("\"sys\":{"))
        b.close()
    }

    @Test fun anOldReadingIsNotSentAsIfItWereNew() {
        val shell = FakeShell()
        val sampler = LiveSampler({ shell }, now = { 1000L }, delayMs = { 1 })
        val h = LiveHub(sampler, 4, fast.copy(cacheMaxMs = 60_000), { System.currentTimeMillis() + 120_000 })
        val a = h.open { true }!!
        shell.queue.add(line("0 0 0 0 0 0 0 0"))
        until(a, "data: ")
        a.close()
        val b = h.open { true }!!
        assertEquals(": connected\n\n", chunk(b))
        assertFalse("nothing cached is sent when it is older than the limit", (chunk(b) ?: "").startsWith("data: "))
        b.close()
    }

    @Test fun aHiddenStreamIsNotReportedAsStale() {
        val shell = FakeShell()
        val h = LiveHub(LiveSampler({ shell }, delayMs = { 1 }), 4, grace, schedule = ManualTimer()::schedule)
        val a = h.open({ true }, "tok")!!
        shell.queue.add(line("0 0 0 0 0 0 0 0"))
        until(a, "data: ")
        assertTrue(h.setVisible(a.id, "tok", false))
        until(a, ": ping")
        val more = StringBuilder()
        repeat(6) { more.append(chunk(a)) }                                                   // longer than the stall time of 120 ms
        assertFalse(more.toString(), more.contains("event: stale"))
        a.close()
    }

    @Test fun shutdownEndsEveryStreamAndTheReader() {
        val timer = ManualTimer()
        val sampler = LiveSampler({ FakeShell() }, delayMs = { 1 })
        val h = LiveHub(sampler, 4, grace, schedule = timer::schedule)
        val a = h.open({ true }, "t")!!
        val b = h.open({ true }, "t")!!
        h.shutdown()
        assertEquals(0, h.viewers())
        assertFalse(sampler.isRunning())
        assertNull(chunk(a)); assertNull(chunk(b))
        assertEquals(0, timer.pending())
        h.shutdown()                                                                          // again: nothing breaks
    }
}

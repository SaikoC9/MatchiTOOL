package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** The line parser, the percentages, and the restart / back-off / stop behaviour of [LiveSampler] (no Android classes, no root). */
class LiveSamplerTest {
    private fun line(cpu: String, cores: String = "", f: String = "", z: String = "", s: String = "") =
        "@L1|c:;cpu $cpu${if (cores.isEmpty()) "" else ";$cores"}|f:$f|z:$z|s:$s"

    // ---- parser ----

    @Test fun parsesAFullLine() {
        val l = LiveScript.parse(
            "@L1|c:;cpu  1000 0 500 80000 100 0 0 0 99 99;cpu0 125 0 62 10000 12 0 0 0 0 0;cpu1 125 0 62 10000 12 0 0 0 0 0" +
                "|f:;1 0 0 1800000;0 1 936000 1800000;2 1 614000 2000000" +
                "|z:;soc-thermal=45000;mdm-q6-usr=51500;bad=abc" +
                "|s:0.10 0.20 0.30 100.50 4000000 2000000"
        )!!
        // total = first 8 columns, idle = idle + iowait, guest columns ignored (same as the page)
        assertEquals(CpuTimes(81600, 80100), l.cpu)
        assertEquals(setOf(0, 1), l.cores.keys)
        assertEquals(listOf(0, 1, 2), l.freqs.map { it.id })                       // sorted by core
        assertEquals(CoreFreq(0, true, 936000, 1800000), l.freqs[0])
        assertFalse(l.freqs[1].online)
        assertEquals(listOf("soc-thermal", "mdm-q6-usr"), l.zones.map { it.name }) // the unreadable zone is dropped
        assertEquals(45.0, l.zones[0].celsius, 0.0)
        assertEquals(51.5, l.zones[1].celsius, 0.0)
        assertEquals(SysInfo(0.1, 0.2, 0.3, 100.5, 4000000, 2000000), l.sys)
    }

    @Test fun roundsWithoutTheSlowSectionHaveNoSys() {
        val l = LiveScript.parse(line("10 0 10 80 0 0 0 0"))!!
        assertNull(l.sys)
        assertNotNull(l.cpu)
    }

    @Test fun thermalValuesFollowThePageRule() {
        val l = LiveScript.parse("@L1|c:|f:|z:;a=45000;b=38;c=0;d=-5;e=200000;f=150|s:")!!
        assertEquals(mapOf("a" to 45.0, "b" to 38.0), l.zones.associate { it.name to it.celsius }) // whole degrees kept, 0 / negative / >= 150 C dropped
    }

    @Test fun rejectsLinesThatAreNotOurs() {
        assertNull(LiveScript.parse(""))
        assertNull(LiveScript.parse("su: Permission denied"))
        assertNull(LiveScript.parse("@L2|c:;cpu 1 2 3 4"))
        assertNull(LiveScript.parse("@L1"))
        assertNull(LiveScript.parse("@L1|c:|f:|z:|s:"))                       // nothing readable
        assertNull(LiveScript.parse("@L1|c:;cpu 1 2 3 4|" + "x".repeat(LiveScript.MAX_LINE)))
    }

    @Test fun skipsBrokenEntriesButKeepsTheGoodOnes() {
        val l = LiveScript.parse("@L1|c:;cpu 1 2 x 4;cpu0 1 2 3 4;cpuX 1 2 3 4;cpu1 1 2 3|f:;1 2 3 4;300 1 1 1;1 1 1|z:;=5;noequals|s:1 2 3")!!
        assertNull(l.cpu)                                                      // non-numeric
        assertEquals(setOf(0), l.cores.keys)                                    // cpuX and a row with too few columns are skipped
        assertTrue(l.freqs.isEmpty())                                           // online flag 2, core id 300, 3 columns
        assertTrue(l.zones.isEmpty())
        assertNull(l.sys)                                                       // wrong number of values
    }

    @Test fun badSysValuesAreRefused() {
        for (s in listOf("0.1 0.2 0.3 100 0 0", "0.1 0.2 0.3 -1 4000 2000", "a 0.2 0.3 100 4000 2000", "0.1 0.2 0.3 100 4000"))
            assertNull(s, LiveScript.parse("@L1|c:;cpu 1 2 3 4|f:|z:|s:$s")!!.sys)
    }

    // ---- percentages (numbers from scripts/test_live_cpu.js) ----

    @Test fun cpuPercentIsBusyShareWithOneDecimal() {
        // 3 busy of 800 ticks = 0.375 % -> 0.4 ; 1 of 1000 = 0.1 ; all busy = 100 ; all idle = 0
        assertEquals(0.4, LiveScript.pct(CpuTimes(81600, 80200), CpuTimes(82400, 80997))!!, 0.0)
        assertEquals(0.1, LiveScript.pct(CpuTimes(0, 0), CpuTimes(1000, 999))!!, 0.0)
        assertEquals(100.0, LiveScript.pct(CpuTimes(0, 0), CpuTimes(800, 0))!!, 0.0)
        assertEquals(0.0, LiveScript.pct(CpuTimes(0, 0), CpuTimes(800, 800))!!, 0.0)
    }

    @Test fun noMovementOrAResetGivesNoValue() {
        assertNull(LiveScript.pct(CpuTimes(100, 90), CpuTimes(100, 90)))
        assertNull(LiveScript.pct(CpuTimes(100, 90), CpuTimes(50, 40)))
        assertNull(LiveScript.pct(null, CpuTimes(50, 40)))
    }

    @Test fun snapshotNeedsTwoRoundsForPercentAndCarriesSysForward() {
        val a = LiveScript.parse(line("0 0 0 0 0 0 0 0", "cpu0 0 0 0 0 0 0 0 0", "0 1 900000 1800000", "soc=40000", "0.5 0.4 0.3 50.0 4000000 3000000"))!!
        val b = LiveScript.parse(line("100 0 0 100 0 0 0 0", "cpu0 50 0 0 50 0 0 0 0", "0 1 1200000 1800000", "soc=41000"))!!
        val s1 = LiveScript.snapshot(null, a, null, null, 1000)
        assertNull(s1.cpuPct)
        assertTrue(s1.cores.isEmpty())
        assertEquals(1000L, s1.sysAt)
        val s2 = LiveScript.snapshot(a, b, s1.sys, s1.sysAt, 2000)
        assertEquals(50.0, s2.cpuPct!!, 0.0)
        assertEquals(listOf(CorePct(0, 50.0)), s2.cores)
        assertEquals(41.0, s2.zones[0].celsius, 0.0)
        assertEquals(s1.sys, s2.sys)                                            // not read this round: the last one is kept...
        assertEquals(1000L, s2.sysAt)                                           // ...and says how old it is
    }

    // ---- the script itself ----

    @Test fun scriptTextIsFixedAndSafeToSend() {
        val t = LiveScript.launch()
        assertTrue(t, t.startsWith("exec sh /dev/fd/3 </dev/null 3<<'MATCHI_LIVE_EOF'\n"))   // stdin is /dev/null for the loop, as in RootShell.launcher
        assertTrue(t, t.endsWith("\nMATCHI_LIVE_EOF\n"))
        assertEquals(1, t.lines().count { it == "MATCHI_LIVE_EOF" })                          // the delimiter is only the closing line
        assertFalse(t, t.contains('\u0000'))
        assertFalse(t, t.contains('§'))
        assertFalse(t, t.contains("@ROUNDS@") || t.contains("@SYS@") || t.contains("@SLEEP@"))
        assertTrue(t, t.length < 4000)
        assertTrue(t, t.contains("|| exit 0"))                                               // ends when the pipe is gone
        assertTrue(t, t.contains("-lt ${LiveScript.MAX_ROUNDS}"))                            // bounded
        assertTrue(t, t.contains("echo \"${LiveScript.TAG}|"))                               // the tag the parser expects
        assertEquals(1, Regex("(?m)^ {2}echo ").findAll(t).count())                          // exactly one line printed per round
        assertFalse(t, Regex("\\b(rm|mv|dd|chmod|chown|setprop|iptables|kill|reboot|settings|am|pm)\\b").containsMatchIn(t)) // reads only
        assertFalse(t, Regex(">(?!/dev/null)").containsMatchIn(t.substringAfter("\n")))      // writes to no file (only 2>/dev/null)
    }

    /** Runs the real script in the host's `sh` for 3 rounds and parses what it prints. Skipped where there is no /proc or sh. */
    @Test fun scriptRunsInARealShellAndItsOutputParses() {
        assumeTrue(File("/proc/stat").exists() && File("/proc/meminfo").exists() && File("/bin/sh").exists())
        val p = try {
            ProcessBuilder("sh").redirectErrorStream(true).start()
        } catch (e: IOException) { assumeTrue("no sh", false); return }
        p.outputStream.bufferedWriter().use { it.write(LiveScript.launch(rounds = 3, sleepSec = 0)) }
        val lines = p.inputStream.bufferedReader().readLines()
        assertTrue(p.waitFor(10, TimeUnit.SECONDS))
        val parsed = lines.map { LiveScript.parse(it) }
        assertEquals(lines.toString(), 3, lines.size)                                       // one line per round, nothing else (no stray messages)
        assertTrue(lines.toString(), parsed.all { it != null && it.cpu != null && it.cores.isNotEmpty() })
        assertNotNull("memory, load and uptime on the first round", parsed[0]!!.sys)
        assertNull("not on the second", parsed[1]!!.sys)
    }

    // ---- restart, back-off, stop ----

    private class FakeShell(vararg initial: String) : LiveShell {
        val queue = LinkedBlockingQueue<String>()
        val closed = CountDownLatch(1)
        init { initial.forEach { queue.add(it) } }
        fun end() { queue.add(END) }
        override fun readLine(): String? {
            val x = queue.take()
            if (x === END) return null
            return x
        }
        override fun close() { closed.countDown(); queue.add(END) }
        companion object { val END = String() }
    }

    @Test fun backoffDoublesAndStopsAtThirtySeconds() {
        assertEquals(listOf(1000L, 2000L, 4000L, 8000L, 16000L, 30000L, 30000L), listOf(1, 2, 3, 4, 5, 6, 7).map { LiveSampler.backoff(it) })
        assertEquals(1000L, LiveSampler.backoff(0))
    }

    @Test fun deliversSnapshotsAndStopsCleanly() {
        val shell = FakeShell(line("0 0 0 0 0 0 0 0", s = "0.1 0.1 0.1 5.0 1000 500"), line("50 0 0 50 0 0 0 0"))
        val got = LinkedBlockingQueue<LiveSnapshot>()
        val s = LiveSampler({ shell }, delayMs = { 1 })
        s.listen { got.add(it) }
        s.start()
        s.start()                                                                  // a second start does nothing
        val first = got.poll(5, TimeUnit.SECONDS)!!
        val second = got.poll(5, TimeUnit.SECONDS)!!
        assertNull(first.cpuPct)
        assertEquals(50.0, second.cpuPct!!, 0.0)
        assertEquals(second, s.latest())
        assertTrue(s.isRunning())
        s.stop()
        assertTrue("the shell must be closed by stop()", shell.closed.await(2, TimeUnit.SECONDS))
        assertFalse(s.isRunning())
        s.stop()                                                                   // twice is fine
    }

    @Test fun restartsAShellThatEndedAndKeepsGoing() {
        val launches = AtomicInteger()
        val second = CountDownLatch(1)
        val first = FakeShell(line("1 0 0 1 0 0 0 0")).also { it.end() }
        val shells = listOf(first, FakeShell(line("2 0 0 2 0 0 0 0")))
        val s = LiveSampler({ val i = launches.getAndIncrement(); if (i == 1) second.countDown(); shells[minOf(i, 1)] }, delayMs = { 1 })
        s.start()
        assertTrue("a new shell is started after the first one ended", second.await(5, TimeUnit.SECONDS))
        s.stop()
        assertTrue(launches.get() >= 2)
    }

    @Test fun aShellThatNeverDeliversBacksOffMoreAndMore() {
        val waits = ArrayList<Int>()
        val enough = CountDownLatch(4)
        val s = LiveSampler({ FakeShell("su: something").also { it.end() } }, delayMs = { f -> synchronized(waits) { waits.add(f) }; enough.countDown(); 1 })
        s.start()
        assertTrue(enough.await(5, TimeUnit.SECONDS))
        s.stop()
        synchronized(waits) { assertEquals(listOf(1, 2, 3, 4), waits.take(4)) }    // failures count up, so the real waits grow 1, 2, 4, 8 s
        assertEquals("su: something", s.lastNote())
        assertNull(s.latest())
    }

    @Test fun aShellThatDeliveredStartsOverWithTheShortestWait() {
        val waits = ArrayList<Int>()
        val enough = CountDownLatch(3)
        val s = LiveSampler({ FakeShell(line("1 0 0 1 0 0 0 0")).also { it.end() } }, delayMs = { f -> synchronized(waits) { waits.add(f) }; enough.countDown(); 1 })
        s.start()
        assertTrue(enough.await(5, TimeUnit.SECONDS))
        s.stop()
        synchronized(waits) { assertEquals(listOf(1, 1, 1), waits.take(3)) }
    }

    @Test fun aRefusedSuIsReportedOnceAndNotRetriedWhileDenied() {
        val denied = AtomicInteger()
        val launches = AtomicInteger()
        val told = CountDownLatch(1)
        val s = LiveSampler({ launches.incrementAndGet(); throw IOException("su: not found") }, onDenied = { denied.incrementAndGet(); told.countDown() }, delayMs = { 20 })
        s.start()
        assertTrue(told.await(5, TimeUnit.SECONDS))
        s.stop()
        assertTrue(denied.get() >= 1)
        assertTrue(s.lastNote(), s.lastNote().startsWith("start failed"))

        var down = true
        val calls = AtomicInteger()
        val s2 = LiveSampler({ calls.incrementAndGet(); FakeShell().also { it.end() } }, isDenied = { down }, delayMs = { 5 })
        s2.start()
        Thread.sleep(100)
        assertEquals("no su start while the shared cool-down runs", 0, calls.get())
        down = false
        val deadline = System.currentTimeMillis() + 5000
        while (calls.get() == 0 && System.currentTimeMillis() < deadline) Thread.sleep(10)
        s2.stop()
        assertTrue(calls.get() > 0)
    }

    @Test fun stopWhileTheShellIsSilentReturnsPromptlyAndAllowsANewStart() {
        val shell = FakeShell()                                                    // never prints anything
        val s = LiveSampler({ shell }, delayMs = { 1 })
        s.start()
        Thread.sleep(50)
        val t0 = System.nanoTime()
        s.stop()
        assertTrue("stop took too long", (System.nanoTime() - t0) / 1_000_000 < 1500)
        assertFalse(s.isRunning())
        val shell2 = FakeShell(line("1 0 0 1 0 0 0 0"))
        val got = CountDownLatch(1)
        val s3 = LiveSampler({ shell2 }, delayMs = { 1 })
        s3.listen { got.countDown() }
        s3.start()
        assertTrue(got.await(5, TimeUnit.SECONDS))
        s3.stop()
    }
}

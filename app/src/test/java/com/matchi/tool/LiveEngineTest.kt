package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** The choice between the shell loop and matchi-sampler: the command line, the rules for using the program, and the way back to the loop. */
class LiveEngineTest {
    private val goodLine = "@L1|c:;cpu 1 0 1 8 0 0 0 0|f:;0 1 614400 2002000|z:;soc-thmzone=59963|s:"

    private class Shell(override val engine: String, vararg lines: String) : LiveShell {
        private val queue = LinkedBlockingQueue<String>()
        init { lines.forEach { queue.add(it) }; queue.add(END) }
        override fun readLine(): String? { val x = queue.take(); return if (x === END) null else x }
        override fun close() { queue.add(END) }
        companion object { val END = String() }
    }

    // ---- command line ----

    @Test fun commandIsOneFixedLineWithTheQuotedPath() {
        assertEquals(
            "exec '/data/data/com.matchi.tool/files/matchi-sampler' -rounds 3600 -sleep 1 -sys-every 5 </dev/null",
            LiveEngine.command("/data/data/com.matchi.tool/files/matchi-sampler")
        )
    }

    @Test fun commandUsesTheSameLimitsAsTheShellLoop() {
        val c = LiveEngine.command("/data/data/com.matchi.tool/files/matchi-sampler")!!
        assertTrue(c, c.contains("-rounds ${LiveScript.MAX_ROUNDS} "))
        assertTrue(c, c.contains("-sys-every ${LiveScript.SYS_EVERY} "))
    }

    @Test fun commandNumbersAreKeptInRange() {
        val c = LiveEngine.command("/x/y", rounds = 0, sleepSec = 9999)!!
        assertTrue(c, c.contains("-rounds 1 ") && c.contains("-sleep 60 "))
    }

    @Test fun oddPathsAreRefused() {
        for (p in listOf("", "matchi-sampler", "/a b/c", "/a'b", "/a;rm -rf /", "/a/../b", "/a\$(id)", "/a`id`", "/a\nb", "/" + "a".repeat(300)))
            assertNull("path: $p", LiveEngine.command(p))
    }

    @Test fun theRealFilesFolderPathIsAccepted() {
        assertTrue(LiveEngine.pathIsSafe("/data/data/com.matchi.tool/files/matchi-sampler"))
        assertTrue(LiveEngine.pathIsSafe("/data/user/0/com.matchi.tool/files/matchi-sampler"))
    }

    // ---- when the program is used ----

    @Test fun theProgramNeedsTheSettingAndAGoodFile() {
        assertTrue(LiveEngine.useBinary(true, null))
        assertFalse(LiveEngine.useBinary(false, null))
        assertFalse(LiveEngine.useBinary(true, "matchi-sampler is not installed."))
        assertFalse(LiveEngine.useBinary(false, "anything"))
    }

    @Test fun theProgramIsAListedBinaryWithAHash() {
        assertNotNull(BinaryHashes.expected(LiveEngine.BINARY))
    }

    @Test fun theProgramIsInTheApk() {
        var dir: File? = File(System.getProperty("user.dir")).absoluteFile
        var found: File? = null
        while (dir != null && found == null) {
            for (rel in listOf("app/src/main/assets/bin", "src/main/assets/bin")) File(dir, "$rel/${LiveEngine.BINARY}").takeIf { it.isFile }?.let { found = it }
            dir = dir.parentFile
        }
        assertNotNull("assets/bin/${LiveEngine.BINARY} not found", found)
    }

    // ---- the way back to the shell loop ----

    @Test fun aProgramThatNeverPrintsIsReplacedByTheShellLoop() {
        val binary = AtomicInteger(); val shell = AtomicInteger()
        val told = ArrayList<String>()
        val got = CountDownLatch(1)
        val s = LiveSampler(
            launch = { binary.incrementAndGet(); Shell(LiveEngine.ENGINE_BINARY, "sh: /data/data/x/matchi-sampler: not found") },
            delayMs = { 1 },
            safeLaunch = { shell.incrementAndGet(); Shell(LiveEngine.ENGINE_SHELL, goodLine) },
            onFallback = { synchronized(told) { told.add(it) } }
        )
        s.listen { got.countDown() }
        s.start()
        assertTrue("the shell loop must take over", got.await(5, TimeUnit.SECONDS))
        s.stop()
        assertEquals("the program gets exactly BINARY_TRIES tries", LiveEngine.BINARY_TRIES, binary.get())
        assertTrue(shell.get() >= 1)
        assertEquals(LiveEngine.ENGINE_SHELL, s.engine())
        synchronized(told) {
            assertEquals("the log is told once", 1, told.size)
            assertTrue(told[0], told[0].contains("not found"))
        }
    }

    @Test fun aProgramThatPrintsIsKept() {
        val shell = AtomicInteger()
        val launches = AtomicInteger()
        val three = CountDownLatch(3)
        val s = LiveSampler(
            launch = { launches.incrementAndGet(); three.countDown(); Shell(LiveEngine.ENGINE_BINARY, goodLine) },
            delayMs = { 1 },
            safeLaunch = { shell.incrementAndGet(); Shell(LiveEngine.ENGINE_SHELL, goodLine) }
        )
        s.start()
        assertTrue(three.await(5, TimeUnit.SECONDS))
        s.stop()
        assertEquals("a reader that delivered never counts as bad", 0, shell.get())
        assertEquals(LiveEngine.ENGINE_BINARY, s.engine())
    }

    @Test fun oneBadRunInTheMiddleDoesNotSwitchEngines() {
        val n = AtomicInteger(); val shell = AtomicInteger()
        val enough = CountDownLatch(5)
        val s = LiveSampler(
            launch = { val i = n.incrementAndGet(); enough.countDown(); if (i == 2) Shell(LiveEngine.ENGINE_BINARY) else Shell(LiveEngine.ENGINE_BINARY, goodLine) },
            delayMs = { 1 },
            safeLaunch = { shell.incrementAndGet(); Shell(LiveEngine.ENGINE_SHELL, goodLine) }
        )
        s.start()
        assertTrue(enough.await(5, TimeUnit.SECONDS))
        s.stop()
        assertEquals(0, shell.get())
    }

    @Test fun theShellLoopIsNeverCountedAgainstTheProgram() {
        val shell = AtomicInteger()
        val enough = CountDownLatch(4)
        val s = LiveSampler(
            launch = { shell.incrementAndGet(); enough.countDown(); Shell(LiveEngine.ENGINE_SHELL, "su: nothing") },
            delayMs = { 1 },
            safeLaunch = { throw AssertionError("safeLaunch is only for a failed program") }
        )
        s.start()
        assertTrue(enough.await(5, TimeUnit.SECONDS))
        s.stop()
        assertEquals(LiveEngine.ENGINE_SHELL, s.engine())
    }

    @Test fun withoutASafeLaunchAFailingProgramIsJustRetried() {
        val n = AtomicInteger()
        val enough = CountDownLatch(4)
        val s = LiveSampler(launch = { n.incrementAndGet(); enough.countDown(); Shell(LiveEngine.ENGINE_BINARY) }, delayMs = { 1 })
        s.start()
        assertTrue(enough.await(5, TimeUnit.SECONDS))
        s.stop()
        assertTrue(n.get() >= 4)
    }

    @Test fun aNewStartTriesTheProgramAgain() {
        val binary = AtomicInteger()
        val shellGot = CountDownLatch(1)
        val s = LiveSampler(
            launch = { binary.incrementAndGet(); Shell(LiveEngine.ENGINE_BINARY) },
            delayMs = { 1 },
            safeLaunch = { Shell(LiveEngine.ENGINE_SHELL, goodLine) }
        )
        s.listen { shellGot.countDown() }
        s.start()
        assertTrue(shellGot.await(5, TimeUnit.SECONDS))
        s.stop()
        val before = binary.get()
        s.start()
        val deadline = System.currentTimeMillis() + 5000
        while (binary.get() == before && System.currentTimeMillis() < deadline) Thread.sleep(5)
        s.stop()
        assertTrue("stop() then start() gives the program another chance", binary.get() > before)
    }
}

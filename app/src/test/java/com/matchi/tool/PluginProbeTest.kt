package com.matchi.tool

import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class PluginProbeTest {
    @get:Rule val tmp = TemporaryFolder()

    @Test fun scriptStaysOnOneFilesystemAndHasATimeout() {
        val s = probeScript(listOf("/data/local/x"))
        assertTrue("du must use -skx", s.contains("du -skx --"))
        assertFalse("plain du -sk is forbidden", Regex("du -sk(\\s|$)").containsMatchIn(s))
        assertTrue("timeout wrapper", s.contains("timeout 8"))
        assertTrue("paths are single-quoted", s.contains("'/data/local/x'"))
    }

    @Test fun scriptRunsInShAndReportsSizeAndSkipsMissingPaths() {
        val d = tmp.newFolder("plug"); java.io.File(d, "f").writeBytes(ByteArray(8192))
        val out = ProcessBuilder("sh", "-c", probeScript(listOf(d.path, d.path + "-missing"))).redirectErrorStream(true).start()
            .let { it.inputStream.bufferedReader().readText().also { _ -> it.waitFor() } }
        val lines = out.lines().filter { it.isNotBlank() }
        assertEquals(out, 1, lines.size)
        assertTrue(out, Regex("^EXISTS \\d+ ${Regex.escape(d.path)}$").matches(lines[0]))
    }

    @Test fun cacheReusesForTenSecondsThenRunsAgain() {
        var now = 1_000L; var runs = 0
        val c = ProbeCacheImpl(10_000) { now }
        val run = { runs++; ShellResult(true, "r$runs") }
        assertEquals("r1", c.get("a", run).content)
        now += 9_999; assertEquals("r1", c.get("a", run).content); assertEquals(1, runs)
        now += 2; assertEquals("r2", c.get("a", run).content); assertEquals(2, runs)
    }

    @Test fun clearForcesARunAndAnotherKeyRunsToo() {
        var runs = 0; val c = ProbeCacheImpl(10_000) { 5L }
        val run = { runs++; ShellResult(true, "x") }
        c.get("a", run); c.get("a", run); assertEquals(1, runs)
        c.clear(); c.get("a", run); assertEquals(2, runs)
        c.get("b", run); assertEquals(3, runs)
    }

    @Test fun aFailedProbeIsNeverReused() {
        var runs = 0; val c = ProbeCacheImpl(10_000) { 5L }
        val run = { runs++; ShellResult(false, "") }
        c.get("a", run); c.get("a", run); assertEquals(2, runs)
    }
}

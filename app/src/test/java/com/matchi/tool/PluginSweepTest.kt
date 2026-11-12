package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PluginSweepTest {
    @Test fun fixedNumbersMatchTheOwnersDecisions() {
        assertEquals("MATCHI_PLUGIN", SWEEP_TAG_VAR)
        assertEquals(2_000L, SWEEP_TERM_WAIT_MS)          // D4: wait 2 s between SIGTERM and SIGKILL
        assertEquals(50, SWEEP_MAX_CANDIDATES)            // Step 3: cap
        assertEquals(15_000L, SWEEP_PROBE_TIMEOUT_MS)     // Step 4: probe limit
        assertTrue(SWEEP_PROBE_TIMEOUT_MS < STOP_TOTAL_MS) // the probe is separate from, and shorter than, the 60 s stop clock
        assertTrue(SWEEP_TERM_WAIT_MS < STOP_TOTAL_MS)
    }

    @Test fun theNeverKillListIsFixed() {
        assertEquals(1, SWEEP_INIT_PID)                   // D8
        assertEquals("com.matchi.tool", SWEEP_APP_PACKAGE)
        assertEquals(listOf("/system", "/vendor", "/apex", "/proc", "/dev"), SWEEP_SYSTEM_PREFIXES)
    }

    @Test fun theThreeWaysAreDistinct() {
        assertEquals(3, setOf(SWEEP_HOW_TAG, SWEEP_HOW_PIDFILE, SWEEP_HOW_CMDLINE).size)
    }

    @Test fun typesHoldWhatTheyAreGiven() {
        val p = SweepProc(1234, 1, "12:00:01", 0, "sh /data/local/x/beat.sh", null)
        assertEquals(1234, p.pid); assertEquals(1, p.ppid); assertEquals("12:00:01", p.start); assertEquals(0, p.uid)
        assertEquals("sh /data/local/x/beat.sh", p.args); assertNull(p.tagged)
        val c = SweepCandidate(p.pid, p.start, SWEEP_HOW_TAG, p.args)
        assertEquals(1234, c.pid); assertEquals("tag", c.how)
    }

    // ---- Step 1: the tag ----
    @Test fun goodNamesGetTheTagPrefix() {
        assertEquals("export MATCHI_PLUGIN='Bypass_v65_17.js'; ", tagPrefix("Bypass_v65_17.js"))
        assertEquals("export MATCHI_PLUGIN='my-plugin.v2.html'; ", tagPrefix("  my-plugin.v2.html "))   // tracePluginName trims
    }

    @Test fun badOrMissingNamesGetNoTag() {
        assertEquals("", tagPrefix(null))
        assertEquals("", tagPrefix(""))
        assertEquals("", tagPrefix("noext"))
        assertEquals("", tagPrefix("../evil.js"))
        assertEquals("", tagPrefix("a..b.js"))
        assertEquals("", tagPrefix("x".repeat(81) + ".js"))
    }

    @Test fun aNameWithAQuoteOrShellCharactersCannotGetThrough() {
        for (bad in listOf("a'b.js", "a'; reboot; '.js", "a\"b.js", "a b.js", "a;b.js", "a\$(id).js", "a`id`.js", "a\\b.js", "a\nb.js", "a\u0000b.js"))
            assertEquals("no tag for: $bad", "", tagPrefix(bad))
    }

    @Test fun theOriginalCommandTextIsUntouched() {
        val cmd = "nohup sh /data/local/x/beat.sh &\necho \$! > /data/local/x/beat.pid"
        val t = tagCommand("beat.js", cmd)
        assertTrue(t.endsWith(cmd))
        assertEquals("export MATCHI_PLUGIN='beat.js'; " + cmd, t)
        assertEquals(cmd, tagCommand(null, cmd))          // no name: returned as is
        assertEquals(cmd, tagCommand("bad name", cmd))
    }

    // ---- Step 2: the probe and its parser ----
    private fun probeOut(vararg lines: String) = lines.joinToString("\n") + "\n"

    @Test fun theProbeScriptOnlyReads() {
        val sc = sweepProbeScript()
        for (bad in listOf("kill", "rm ", "rm\n", "mv ", "chmod", "mkdir", "touch", ">>", "tee ", "reboot", "svc "))
            assertFalse("probe must not contain: $bad", sc.contains(bad))
        // the only ">" allowed is the 2>/dev/null of a read; every other redirect is an input
        assertFalse(sc.replace("2>/dev/null", "").contains(">"))
        assertTrue(sc.contains("/proc/[0-9]*") && sc.contains("MATCHI_PLUGIN") && sc.contains("cut -c1-200"))
        assertTrue(sc.startsWith("echo \"MTSWEEP-SELF ") && sc.trimEnd().endsWith("\"MTSWEEP-END \$n\""))
    }

    @Test fun normalOutputParses() {
        val r = parseSweepProbe(probeOut(
            "MTSWEEP-SELF 900",
            "MTSWEEP|1|0|1|0||/init",
            "MTSWEEP|2|0|5|0||",
            "MTSWEEP|1234|1|88123|0|beat.js|sh /data/local/x/beat.sh",
            "MTSWEEP-END 3"))
        assertTrue(r.complete); assertEquals(0, r.skipped); assertEquals(900, r.selfPid)
        assertEquals(3, r.procs.size)
        val p = r.procs[2]
        assertEquals(1234, p.pid); assertEquals(1, p.ppid); assertEquals("88123", p.start); assertEquals(0, p.uid)
        assertEquals("beat.js", p.tagged); assertEquals("sh /data/local/x/beat.sh", p.args)
        assertNull(r.procs[0].tagged); assertEquals("", r.procs[1].args)               // kernel thread: empty ARGS
    }

    @Test fun argsWithSpacesAndBarsStayInOneColumn() {
        val r = parseSweepProbe(probeOut("MTSWEEP|77|1|500|2000||sh -c echo a | grep b   x", "MTSWEEP-END 1"))
        assertTrue(r.complete)
        assertEquals("sh -c echo a | grep b   x", r.procs[0].args); assertEquals(2000, r.procs[0].uid)
    }

    @Test fun aCutOutputIsNeverComplete() {
        val r = parseSweepProbe("MTSWEEP-SELF 9\nMTSWEEP|10|1|20|0||sh a\nMTSWEEP|11|1|2")   // no END, last line cut
        assertFalse(r.complete); assertEquals(1, r.procs.size); assertEquals(1, r.skipped)
        val r2 = parseSweepProbe(probeOut("MTSWEEP|10|1|20|0||sh a", "MTSWEEP-END 1").replace("MTSWEEP-END 1\n", ""))
        assertFalse(r2.complete)
    }

    @Test fun anEndCountThatDoesNotMatchIsNotComplete() {
        assertFalse(parseSweepProbe(probeOut("MTSWEEP|10|1|20|0||sh a", "MTSWEEP-END 2")).complete)
        assertFalse(parseSweepProbe(probeOut("MTSWEEP|10|1|20|0||sh a", "MTSWEEP-END x")).complete)
    }

    @Test fun emptyAndGarbageOutput() {
        for (g in listOf("", "\n\n", "su: not found\n", "\u0000\u0001 garbage |||\n", "MTSWEEP\nMTSWEEP|\nMTSWEEP|a|b|c|d|e|f\n")) {
            val r = parseSweepProbe(g)
            assertFalse(r.complete); assertTrue(r.procs.isEmpty()); assertNull(r.selfPid)
        }
        val r = parseSweepProbe(probeOut("warning: x", "MTSWEEP-SELF 5", "MTSWEEP|a|b|c|d|e|f", "MTSWEEP|6|1|30|0||ok", "MTSWEEP-END 2"))
        assertTrue(r.complete); assertEquals(1, r.skipped); assertEquals(listOf(6), r.procs.map { it.pid })
    }

    @Test fun oddFieldsAreHandledNotTrusted() {
        val r = parseSweepProbe(probeOut(
            "MTSWEEP|20|1|40||evil'name.js|x",       // no uid -> -1; a bad tag -> null
            "MTSWEEP|21|1|41|0|../x.js|y",
            "MTSWEEP|22|1|abc|0||z",                 // START not a number -> skipped
            "MTSWEEP-END 3"))
        assertTrue(r.complete); assertEquals(1, r.skipped); assertEquals(2, r.procs.size)
        assertEquals(-1, r.procs[0].uid); assertNull(r.procs[0].tagged); assertNull(r.procs[1].tagged)
    }

    @Test fun windowsLineEndingsAreTolerated() {
        val r = parseSweepProbe("MTSWEEP-SELF 3\r\nMTSWEEP|4|1|9|0|a.js|sh x\r\nMTSWEEP-END 1\r\n")
        assertTrue(r.complete); assertEquals("a.js", r.procs[0].tagged); assertEquals("sh x", r.procs[0].args)
    }
}

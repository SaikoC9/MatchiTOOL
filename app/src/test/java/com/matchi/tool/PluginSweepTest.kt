package com.matchi.tool

import org.junit.Assert.assertEquals
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
}

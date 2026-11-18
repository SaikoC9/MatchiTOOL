package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The host only writes down how a sandboxed plugin's stop hook went; it never lets that change the outcome. */
class PluginHookTest {
    @Test fun knownStatusesAreWrittenAsTheyAre() {
        assertEquals("hook A.js ran=true status=ok", hookAuditLine("A.js", true, "ok"))
        assertEquals("hook A.js ran=false status=timeout", hookAuditLine("A.js", false, "timeout"))
        assertEquals("hook A.js ran=true status=failed", hookAuditLine("A.js", true, "failed"))
        assertEquals("hook A.js ran=false status=dead", hookAuditLine("A.js", false, "dead"))
    }

    @Test fun anythingElseIsWrittenAsUnknownSoNoTextCanReachTheLog() {
        assertEquals("hook A.js ran=true status=unknown", hookAuditLine("A.js", true, "ok\nFORGED line"))
        assertEquals("hook A.js ran=false status=unknown", hookAuditLine("A.js", false, ""))
        assertEquals("hook A.js ran=false status=unknown", hookAuditLine("A.js", false, "OK"))
        assertFalse(hookAuditLine("A.js", true, "x".repeat(500)).contains("xxx"))
    }

    @Test fun statusListIsExactlyWhatThePageSends() {
        assertEquals(setOf("ok", "failed", "timeout", "dead", "none"), HOOK_STATUSES)
        assertTrue(HOOK_STATUSES.all { it.length < 10 })
    }

    @Test fun theHookHasNoWayIntoTheStopDecision() {
        // stopMode and stopHashMatches take no hook argument, so a hook answer cannot turn a failed stop into a successful one.
        val plan = stopPlan("A.js", "", "ok", false, emptyList(), emptyList(), { null }, { it })
        assertEquals(StopMode.NONE, stopMode(true, false, plan, 0))
        assertEquals(StopMode.RUN, stopMode(true, false, plan, 2))
    }
}

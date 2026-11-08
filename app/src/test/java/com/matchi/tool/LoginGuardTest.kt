package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LoginGuardTest {
    private var now = 1_000_000_000L
    private fun guard() = LoginGuard { now }

    private fun fails(g: LoginGuard, ip: String, n: Int) = repeat(n) { g.failed(ip, false); now += 100 }

    @Test fun ipIsLockedAfterMaxFailsAndFreedAfterTheLock() {
        val g = guard()
        fails(g, "10.0.0.2", LoginGuard.MAX_FAILS - 1)
        assertEquals(0L, g.retryAfterMs("10.0.0.2", false))
        fails(g, "10.0.0.2", 1)
        assertTrue(g.retryAfterMs("10.0.0.2", false) > 0)
        now += LoginGuard.LOCK_MS + 1
        assertEquals(0L, g.retryAfterMs("10.0.0.2", false))
    }

    @Test fun repeatedLocksOfOneIpGrow() {
        val g = guard()
        fails(g, "10.0.0.2", LoginGuard.MAX_FAILS)
        val first = g.retryAfterMs("10.0.0.2", false)
        now += LoginGuard.LOCK_MS + 1
        fails(g, "10.0.0.2", LoginGuard.MAX_FAILS)
        assertTrue(g.retryAfterMs("10.0.0.2", false) > first)
    }

    @Test fun changingIpDoesNotResetTheGlobalBackOff() {
        val g = guard()
        // 3 failures from each of many addresses: no single IP is locked, together they exceed GLOBAL_FREE
        for (i in 1..8) fails(g, "10.0.0.$i", 3)
        assertTrue(g.retryAfterMs("10.0.0.99", false) > 0)      // a brand-new address must wait too
        now += LoginGuard.GLOBAL_MAX_WAIT_MS + 1
        assertEquals(0L, g.retryAfterMs("10.0.0.99", false))
    }

    @Test fun globalBackOffGrowsAndIsCapped() {
        val g = guard()
        fails(g, "10.0.0.1", 0)
        for (i in 1..200) { g.failed("10.1.${i / 250}.${i % 250}", false) }
        assertTrue(g.retryAfterMs("10.9.9.9", false) <= LoginGuard.GLOBAL_MAX_WAIT_MS)
    }

    @Test fun goodLoginClearsIpAndGlobalCounters() {
        val g = guard()
        for (i in 1..8) fails(g, "10.0.0.$i", 3)
        g.succeeded("10.0.0.50", false)
        assertEquals(0L, g.retryAfterMs("10.0.0.51", false))
    }

    @Test fun loopbackIsNeverRefusedAndDoesNotFeedTheGlobalCounter() {
        val g = guard()
        repeat(100) { g.failed("127.0.0.1", true) }
        assertEquals(0L, g.retryAfterMs("127.0.0.1", true))
        assertEquals(0L, g.retryAfterMs("10.0.0.2", false))
    }

    @Test fun loopbackDelayGrowsButStaysBounded() {
        val g = guard()
        assertEquals(LoginGuard.LOOP_BASE_MS, g.loopbackDelayMs())
        repeat(50) { g.failed("127.0.0.1", true) }
        assertTrue(g.loopbackDelayMs() > LoginGuard.LOOP_BASE_MS)
        assertTrue(g.loopbackDelayMs() <= LoginGuard.LOOP_MAX_MS)
    }

    @Test fun loopbackSleepSlotsAreLimited() {
        val g = guard()
        repeat(LoginGuard.MAX_LOOPBACK_SLEEPERS) { assertTrue(g.enterLoopbackDelay()) }
        assertFalse(g.enterLoopbackDelay())
        g.leaveLoopbackDelay()
        assertTrue(g.enterLoopbackDelay())
    }

    @Test fun routerIsAskedAtMostBudgetTimesPerWindow() {
        val g = guard()
        repeat(LoginGuard.ROUTER_BUDGET) { assertTrue(g.mayAskRouter("10.0.0.2")) }
        assertFalse(g.mayAskRouter("10.0.0.2"))
        now += LoginGuard.ROUTER_WINDOW_MS + 1
        assertTrue(g.mayAskRouter("10.0.0.2"))
    }

    @Test fun oneClientCannotUseUpTheRouterBudgetOfOthers() {
        val g = guard()
        repeat(LoginGuard.ROUTER_BUDGET) { assertTrue(g.mayAskRouter("10.0.0.2")) }
        assertFalse(g.mayAskRouter("10.0.0.2"))
        assertTrue(g.mayAskRouter("10.0.0.3"))          // the owner on another address still gets through
    }

    @Test fun routerBudgetIsAlsoCappedForTheWholeApp() {
        val g = guard()
        var allowed = 0
        for (i in 1..20) if (g.mayAskRouter("10.0.1.$i")) allowed++
        assertEquals(LoginGuard.ROUTER_GLOBAL_BUDGET, allowed)
    }

    @Test fun failCountForgetsOldFailures() {
        val g = guard()
        fails(g, "10.0.0.2", 2)
        assertEquals(2, g.failCount("10.0.0.2"))
        now += LoginGuard.COUNT_DECAY_MS + 1
        assertEquals(0, g.failCount("10.0.0.2"))
    }

    @Test fun perIpCountDoesNotResetEveryMinute() {
        val g = guard()
        fails(g, "10.0.0.2", LoginGuard.MAX_FAILS - 1)
        now += LoginGuard.LOCK_WINDOW_MS + 1
        fails(g, "10.0.0.2", 1)                 // still counts toward the same lock
        assertTrue(g.retryAfterMs("10.0.0.2", false) > 0)
    }

    @Test fun loopbackIsNeverLockedOutEvenAfterTheDailyCap() {
        val g = guard()
        repeat(LoginGuard.LOOP_DAILY_CAP) { g.failed("127.0.0.1", true) }
        assertEquals(0L, g.retryAfterMs("127.0.0.1", true))            // the owner can still try (and a right password works)
        assertEquals(LoginGuard.LOOP_CAPPED_MS, g.loopbackDelayMs())   // but guessing is slowed down
        g.succeeded("127.0.0.1", true)
        assertTrue(g.loopbackDelayMs() <= LoginGuard.LOOP_MAX_MS)       // a good login clears it
        repeat(LoginGuard.LOOP_DAILY_CAP) { g.failed("127.0.0.1", true) }
        now += LoginGuard.LOOP_DAY_MS + 1
        assertTrue(g.loopbackDelayMs() <= LoginGuard.LOOP_MAX_MS)       // and it expires after a day
    }
}

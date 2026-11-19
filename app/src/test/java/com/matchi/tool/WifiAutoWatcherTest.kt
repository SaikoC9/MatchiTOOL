package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The rules R1-R7, run through the watcher with a fake router and a fake clock (3 s poll, like the real loop). Wi-Fi off needs 15 s of ACTIVE in a row, Wi-Fi on needs 5 s of IDLE. */
class WifiAutoWatcherTest {
    private class Fake : WifiAutoPort {
        var now = 0L
        var link = TetherLink.IDLE
        var wifi: Boolean? = true
        var state = false
        var failOff = false
        var failOn = false
        var failWrite = false
        var offCalls = 0
        var onCalls = 0
        var failRescue = false
        var rescueCalls = 0
        var lagUntil = 0L          // after turning Wi-Fi off, the read-back still says "on" until this time
        val logs = ArrayList<String>()
        override fun link() = link
        override fun wifiOn(): Boolean? = if (now < lagUntil) true else wifi
        override fun hasState() = state
        override fun writeState(): Boolean { if (failWrite) return false; state = true; return true }
        override fun clearState() { state = false }
        override fun wifiOff(): Boolean { offCalls++; if (failOff) return false; wifi = false; return true }
        override fun wifiOnAgain(): Boolean { onCalls++; if (failOn) return false; wifi = true; return true }
        override fun wifiRescue(): Boolean { rescueCalls++; if (failRescue) return false; wifi = true; return true }
        override fun log(message: String) { logs.add(message) }
    }

    private class Run(val port: Fake = Fake(), var bootMs: Long = 10 * 60_000L) {
        var w = WifiAutoWatcher(port)
        var enabled = true
        /** Runs [seconds] of 3 s ticks. */
        fun run(seconds: Int) { var s = 0; while (s < seconds) { port.now += 3_000; bootMs += 3_000; w.tick(port.now, bootMs, enabled); s += 3 } }
        /** The app (or the router) restarts: a fresh watcher, the state file and Wi-Fi stay as they are. */
        fun restart(newBootMs: Long? = null) { w = WifiAutoWatcher(port); if (newBootMs != null) bootMs = newBootMs }
    }

    // R1
    @Test fun r1_tetheringActiveTurnsWifiOffAfterDebounce() {
        val r = Run(); r.port.link = TetherLink.ACTIVE
        r.run(12); assertEquals(true, r.port.wifi); assertFalse(r.port.state)  // 12 s is not enough (15 s in a row are needed)
        r.run(6)
        assertEquals(false, r.port.wifi); assertTrue(r.port.state)
    }

    @Test fun r1_debounceConstants() {
        assertEquals(15_000L, WifiAutoRules.ACTIVE_DEBOUNCE_MS)                  // turn-off: slow
        assertEquals(5_000L, WifiAutoRules.IDLE_DEBOUNCE_MS)                     // turn-on: as fast as before
    }

    @Test fun r1_flappingLinkNeverTurnsWifiOff() {
        // the 2026-11-19 21:07 log: ACTIVE for 7-9 s, IDLE for 3-4 s, over and over, while the PC side was stuck
        val r = Run()
        repeat(6) { r.port.link = TetherLink.ACTIVE; r.run(9); r.port.link = TetherLink.IDLE; r.run(3) }
        assertEquals(true, r.port.wifi); assertEquals(0, r.port.offCalls); assertFalse(r.port.state)
    }

    @Test fun r1_shortActiveBlipDoesNothing() {
        val r = Run(); r.port.link = TetherLink.ACTIVE; r.run(3)
        r.port.link = TetherLink.IDLE; r.run(30)
        assertEquals(true, r.port.wifi); assertEquals(0, r.port.offCalls)
    }

    // R2
    @Test fun r2_tetheringGoneTurnsWifiBackOnAndDeletesState() {
        val r = Run(); r.port.link = TetherLink.ACTIVE; r.run(18)
        r.port.link = TetherLink.IDLE; r.run(3); assertEquals(false, r.port.wifi)   // 3 s is not enough
        r.run(30)
        assertEquals(true, r.port.wifi); assertFalse(r.port.state)
    }

    // R3
    @Test fun r3_wifiAlreadyOffIsNeverTurnedOn() {
        val r = Run(); r.port.wifi = false
        r.port.link = TetherLink.ACTIVE; r.run(30)
        assertFalse(r.port.state)
        r.port.link = TetherLink.IDLE; r.run(60)
        assertEquals(false, r.port.wifi); assertEquals(0, r.port.onCalls); assertEquals(0, r.port.offCalls)
    }

    // R4
    @Test fun r4_appKilledWhileTetheredKeepsRulesGoing() {
        val r = Run(); r.port.link = TetherLink.ACTIVE; r.run(18)
        r.restart(); r.run(30)
        assertEquals(false, r.port.wifi); assertTrue(r.port.state)             // still ours, still off
        r.port.link = TetherLink.IDLE; r.run(30)
        assertEquals(true, r.port.wifi); assertFalse(r.port.state)
    }

    // R5
    @Test fun r5_afterBootNoTurnOnDuringTheWaitAndStateKept() {
        val r = Run(bootMs = 0); r.port.state = true; r.port.wifi = false; r.port.link = TetherLink.IDLE
        r.run(39)                                                                // 39 s after boot
        assertEquals(0, r.port.onCalls); assertTrue(r.port.state)
        r.run(30)                                                                // wait over, then 5 s debounce
        assertEquals(true, r.port.wifi); assertFalse(r.port.state)
    }

    @Test fun r5_rebootTetherStillActiveWifiStaysOffAfterBoot() {
        val r = Run(bootMs = 0); r.port.state = true; r.port.wifi = false; r.port.link = TetherLink.ACTIVE
        r.run(120)
        assertEquals(false, r.port.wifi); assertTrue(r.port.state); assertEquals(0, r.port.onCalls)
    }

    @Test fun r5_rebootRouterWifiComesUpByItselfIsTurnedOffAgainNotTreatedAsManual() {
        val r = Run(bootMs = 0); r.port.state = true; r.port.wifi = true; r.port.link = TetherLink.ACTIVE
        r.run(30)
        assertEquals(false, r.port.wifi); assertTrue(r.port.state)
    }

    @Test fun r5_rebootWifiSeenOffThenComesUpByItselfDuringBootWaitIsTurnedOffAgain() {
        val r = Run(bootMs = 0); r.port.state = true; r.port.wifi = false; r.port.link = TetherLink.ACTIVE
        r.run(15)                                                                // Wi-Fi still down while the router boots
        r.port.wifi = true                                                       // the router starts its hotspot by itself
        r.run(30)
        assertEquals(false, r.port.wifi); assertTrue(r.port.state); assertEquals(0, r.port.onCalls)
    }

    @Test fun r6_offSeenAfterTheBootWaitStillCountsAsManualTurnOn() {
        val r = Run(bootMs = 60_000L); r.port.state = true; r.port.wifi = false; r.port.link = TetherLink.ACTIVE
        r.run(15); r.port.wifi = true; r.run(30)
        assertEquals(true, r.port.wifi); assertTrue(!r.port.state)
    }

    @Test fun r5_rebootThenCablePulledDuringWaitWifiOnAfterWait() {
        val r = Run(bootMs = 0); r.port.state = true; r.port.wifi = false; r.port.link = TetherLink.ACTIVE
        r.run(15); r.port.link = TetherLink.IDLE; r.run(24)
        assertEquals(0, r.port.onCalls)                                          // still inside the 45 s
        r.run(30)
        assertEquals(true, r.port.wifi); assertFalse(r.port.state)
    }

    @Test fun r5_rebootTetherGoneAndRouterAlreadyHasWifiOnJustDropsState() {
        val r = Run(bootMs = 0); r.port.state = true; r.port.wifi = true; r.port.link = TetherLink.IDLE
        r.run(90)
        assertEquals(true, r.port.wifi); assertFalse(r.port.state); assertEquals(0, r.port.onCalls)
    }

    // R6
    @Test fun r6_manualWifiOnWhileTetheredStaysOnAndStateDropped() {
        val r = Run(); r.port.link = TetherLink.ACTIVE; r.run(30)
        assertEquals(false, r.port.wifi)
        r.port.wifi = true                                                       // the user turns it on
        r.run(30)
        assertEquals(true, r.port.wifi); assertFalse(r.port.state)
        assertEquals(1, r.port.offCalls)                                         // not turned off again
    }

    @Test fun r6_afterTetheringGoneAndBackItIsOffAgain() {
        val r = Run(); r.port.link = TetherLink.ACTIVE; r.run(30)
        r.port.wifi = true; r.run(30)
        r.port.link = TetherLink.IDLE; r.run(30)
        r.port.link = TetherLink.ACTIVE; r.run(30)
        assertEquals(false, r.port.wifi); assertTrue(r.port.state)
    }

    @Test fun r6_laggingReadBackAfterOurOwnTurnOffIsNotAManualTurnOn() {
        val r = Run(); r.port.link = TetherLink.ACTIVE
        r.run(18)                                                                // off is sent here
        r.port.lagUntil = r.port.now + 10_000                                    // read-back says "on" for 10 s
        r.run(40)
        assertEquals(false, r.port.wifi); assertTrue(r.port.state); assertEquals(1, r.port.offCalls)
    }

    // R7
    @Test fun r7_switchOffWhileHoldingStateTurnsWifiBackOn() {
        val r = Run(); r.port.link = TetherLink.ACTIVE; r.run(18)
        r.enabled = false; r.run(3)
        assertEquals(true, r.port.wifi); assertFalse(r.port.state)
    }

    @Test fun r7_failedTurnOnAfterSwitchOffWaitsBeforeTryingAgain() {
        val r = Run(); r.port.link = TetherLink.ACTIVE; r.run(18)
        r.port.failOn = true; r.enabled = false; r.run(30)
        assertEquals(WifiAutoWatcher.ATTEMPTS, r.port.onCalls)                   // one round of tries, then quiet for 30 s
        r.run(9)
        assertTrue(r.port.onCalls > WifiAutoWatcher.ATTEMPTS)                    // tried again after the pause
        r.port.failOn = false; r.run(60)
        assertEquals(true, r.port.wifi); assertFalse(r.port.state)
    }

    @Test fun r7_switchOffWithoutStateDoesNothing() {
        val r = Run(); r.port.wifi = false; r.enabled = false; r.run(30)
        assertEquals(false, r.port.wifi); assertEquals(0, r.port.onCalls); assertEquals(0, r.port.offCalls)
        r.port.link = TetherLink.ACTIVE; r.port.wifi = true; r.run(30)
        assertEquals(true, r.port.wifi); assertEquals(0, r.port.offCalls)
    }

    // Unknown reads
    @Test fun unknownLinkNeverChangesWifi() {
        val r = Run(); r.port.link = TetherLink.UNKNOWN; r.run(60)
        assertEquals(true, r.port.wifi); assertEquals(0, r.port.offCalls)
        r.port.state = true; r.port.wifi = false; r.run(60)
        assertEquals(false, r.port.wifi); assertEquals(0, r.port.onCalls); assertTrue(r.port.state)
    }

    @Test fun unknownWifiReadNeverChangesAnything() {
        val r = Run(); r.port.link = TetherLink.ACTIVE; r.port.wifi = null; r.run(60)
        assertEquals(0, r.port.offCalls); assertFalse(r.port.state)
    }

    @Test fun unknownSampleBreaksTheRow() {
        val r = Run(); r.port.link = TetherLink.ACTIVE; r.run(3)
        r.port.link = TetherLink.UNKNOWN; r.run(3)
        r.port.link = TetherLink.ACTIVE; r.run(3)
        assertEquals(0, r.port.offCalls)                                         // the row restarted
        r.run(12)
        assertEquals(0, r.port.offCalls)                                         // 21 s after the first look, but only 12 s of the new row
        r.run(3)
        assertEquals(1, r.port.offCalls)
    }

    // Failures
    @Test fun neverTurnsWifiOffWithoutBeingAbleToUndoIt() {
        val r = Run(); r.port.failWrite = true; r.port.link = TetherLink.ACTIVE; r.run(60)
        assertEquals(0, r.port.offCalls); assertEquals(true, r.port.wifi)
        assertTrue(r.port.logs.isNotEmpty())
    }

    @Test fun failedTurnOffIsRetriedTwiceThenLeftAloneForAWhile() {
        val r = Run(); r.port.failOff = true; r.port.link = TetherLink.ACTIVE
        r.run(18)
        assertEquals(WifiAutoWatcher.ATTEMPTS, r.port.offCalls); assertEquals(1, r.port.logs.size)
        r.run(24)
        assertEquals(WifiAutoWatcher.ATTEMPTS, r.port.offCalls)                  // inside the 30 s pause
        r.run(30)
        assertTrue(r.port.offCalls > WifiAutoWatcher.ATTEMPTS)                   // tried again afterwards
    }

    @Test fun failedTurnOnKeepsTheStateFileSoItIsTriedAgain() {
        val r = Run(); r.port.link = TetherLink.ACTIVE; r.run(18)
        r.port.failOn = true; r.port.link = TetherLink.IDLE; r.run(30)          // 15 s settle pause, then 5 s idle row, then the failed try
        assertEquals(WifiAutoWatcher.ATTEMPTS, r.port.onCalls)
        assertTrue(r.port.state); assertEquals(false, r.port.wifi)
        r.port.failOn = false; r.run(60)
        assertEquals(true, r.port.wifi); assertFalse(r.port.state)
    }

    // Root fallback: the router API cannot be read while the link is IDLE and we hold the state file (seen after a boot with the data link out)
    @Test fun rescue_unreadableRouterAfterTheWaitStartsTheRootFallback() {
        val r = Run(); r.port.state = true; r.port.wifi = null; r.port.link = TetherLink.IDLE
        r.run(21); assertEquals(0, r.port.rescueCalls)                           // 18 s of unreadable so far, 20 s are needed
        r.run(3)
        assertEquals(1, r.port.rescueCalls); assertEquals(true, r.port.wifi); assertFalse(r.port.state)
        r.run(60); assertEquals(1, r.port.rescueCalls)                           // done: nothing left to undo
    }

    @Test fun rescue_notDuringTheBootWait() {
        val r = Run(bootMs = 0L); r.port.state = true; r.port.wifi = null; r.port.link = TetherLink.IDLE
        r.run(60); assertEquals(0, r.port.rescueCalls)                           // the 45 s boot wait, then 15 s of unreadable
        r.run(9); assertEquals(1, r.port.rescueCalls)
    }

    @Test fun rescue_neverWhileTetheredOrWithoutTheStateFile() {
        val r = Run(); r.port.state = true; r.port.wifi = null; r.port.link = TetherLink.ACTIVE
        r.run(120); assertEquals(0, r.port.rescueCalls)
        val q = Run(); q.port.state = false; q.port.wifi = null; q.port.link = TetherLink.IDLE
        q.run(120); assertEquals(0, q.port.rescueCalls)
    }

    @Test fun rescue_neverWhenTheLinkIsUnknown() {
        val r = Run(); r.port.state = true; r.port.wifi = null; r.port.link = TetherLink.UNKNOWN
        r.run(120); assertEquals(0, r.port.rescueCalls)
    }

    @Test fun rescue_readableRouterUsesTheNormalTurnOnInstead() {
        val r = Run(); r.port.state = true; r.port.wifi = null; r.port.link = TetherLink.IDLE
        r.run(15); r.port.wifi = false; r.run(30)
        assertEquals(0, r.port.rescueCalls); assertEquals(1, r.port.onCalls)
        assertEquals(true, r.port.wifi); assertFalse(r.port.state)
    }

    @Test fun rescue_failedIsTriedAtMostThreeTimesAndKeepsTheStateFile() {
        val r = Run(); r.port.failRescue = true; r.port.state = true; r.port.wifi = null; r.port.link = TetherLink.IDLE
        r.run(600)
        assertEquals(WifiAutoRules.MAX_RESCUES, r.port.rescueCalls)              // 24 s, 75 s, 126 s (30 s pause + 20 s unreadable between tries)
        assertTrue(r.port.state); assertTrue(r.port.logs.size >= WifiAutoRules.MAX_RESCUES)
    }

    @Test fun rescue_constants() {
        assertEquals(20_000L, WifiAutoRules.UNREADABLE_MS); assertEquals(3, WifiAutoRules.MAX_RESCUES)
    }
}

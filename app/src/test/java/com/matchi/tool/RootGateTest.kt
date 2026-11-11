package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RootGateTest {
    private val h = 60L * 60 * 1000

    @Test fun sessionOlderThanFourHoursIsNotFresh() {
        assertTrue(RootGate.freshEnough(0))
        assertTrue(RootGate.freshEnough(4 * h))
        assertFalse(RootGate.freshEnough(4 * h + 1))
        assertFalse(RootGate.freshEnough(11 * h))
        assertFalse(RootGate.freshEnough(null))
    }

    @Test fun plainHttpFromAnotherDeviceNeedsConfirmation() {
        assertTrue(RootGate.insecureNeedsConfirm(false, false, null))
        assertTrue(RootGate.insecureNeedsConfirm(false, false, "0"))
        assertFalse(RootGate.insecureNeedsConfirm(false, false, "1"))
        assertFalse(RootGate.insecureNeedsConfirm(false, true, null))   // loopback
        assertFalse(RootGate.insecureNeedsConfirm(true, false, null))   // https
    }

    @Test fun onlyPureAtQueriesAreReadOnly() {
        for (c in listOf("AT+COPS?", "at+cereg?", "AT+CSQ", "AT+CESQ", "AT+CGSN", "AT+CFUN=?", "AT", " AT+CSQ "))
            assertTrue(c, RootGate.isReadOnlyAt(c))
        for (c in listOf("AT+CFUN=0", "AT+EGMR=1,7,\"123\"", "AT^SYSCFG=2,2", "AT+CSQ;+CFUN=0", "AT+COPS?;+CFUN=0", "ATD123;", "", "AT+CSQ=1"))
            assertFalse(c, RootGate.isReadOnlyAt(c))
    }

    @Test fun rootOverPlainHttpIsRefusedUnlessTheOwnerAllowedIt() {
        assertTrue(RootGate.insecureRefused(false, false, false))    // http from another device, switch off (default)
        assertFalse(RootGate.insecureRefused(false, false, true))    // http, owner switched it on (the page still asks to confirm)
        assertFalse(RootGate.insecureRefused(false, true, false))    // loopback: apps on the phone itself
        assertFalse(RootGate.insecureRefused(true, false, false))    // https
    }

    // ---- decide(): the whole gate in order (what WebServer.rootGate answers for every root-capable route) ----
    private val fresh = 60_000L
    private val stale = 5 * h

    @Test fun httpsWithAFreshSignInPasses() {
        assertNull(RootGate.decide(true, false, false, null, fresh))
        assertNull(RootGate.decide(true, false, true, null, 0))
    }

    @Test fun httpsWithAnOldOrUnknownSignInNeedsAReauth() {
        assertEquals(RootGate.Refusal.REAUTH, RootGate.decide(true, false, false, null, stale))
        assertEquals(RootGate.Refusal.REAUTH, RootGate.decide(true, false, false, null, null))
        assertEquals("reauth", RootGate.Refusal.REAUTH.code)
    }

    @Test fun plainHttpIsRefusedFirstWhateverTheOtherChecksSay() {
        // switch off: refused even with the page's confirmation and a fresh sign-in
        assertEquals(RootGate.Refusal.INSECURE_OFF, RootGate.decide(false, false, false, "1", fresh))
        assertEquals(RootGate.Refusal.INSECURE_OFF, RootGate.decide(false, false, false, null, stale))
        assertEquals("insecure-off", RootGate.Refusal.INSECURE_OFF.code)
    }

    @Test fun plainHttpWithTheSwitchOnStillNeedsTheConfirmationThenAFreshSignIn() {
        assertEquals(RootGate.Refusal.INSECURE, RootGate.decide(false, false, true, null, fresh))
        assertEquals(RootGate.Refusal.INSECURE, RootGate.decide(false, false, true, "0", stale))   // confirm is checked before the age
        assertEquals(RootGate.Refusal.REAUTH, RootGate.decide(false, false, true, "1", stale))
        assertNull(RootGate.decide(false, false, true, "1", fresh))
        assertEquals("insecure", RootGate.Refusal.INSECURE.code)
    }

    @Test fun loopbackAppsSkipTheHttpChecksButNotTheSignInAge() {
        assertNull(RootGate.decide(false, true, false, null, fresh))
        assertEquals(RootGate.Refusal.REAUTH, RootGate.decide(false, true, false, null, stale))
    }

    @Test fun theAgeLimitIsInclusiveAtFourHours() {
        assertNull(RootGate.decide(true, false, false, null, 4 * h))
        assertEquals(RootGate.Refusal.REAUTH, RootGate.decide(true, false, false, null, 4 * h + 1))
        assertNull(RootGate.decide(true, false, false, null, 9 * h, maxMs = 10 * h))   // a caller-supplied limit is honoured
    }
}

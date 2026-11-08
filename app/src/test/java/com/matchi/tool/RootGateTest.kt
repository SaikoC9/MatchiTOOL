package com.matchi.tool

import org.junit.Assert.assertFalse
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
}

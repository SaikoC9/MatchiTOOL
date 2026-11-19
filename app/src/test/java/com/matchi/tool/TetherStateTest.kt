package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Test

class TetherStateTest {
    private fun d(udc: List<String>?, carrier: String?) = TetherState.decide(udc, carrier)

    // Rows seen in the F50 capture.
    @Test fun cableInLinkUpIsActive() {
        assertEquals(TetherLink.ACTIVE, d(listOf("configured", "not attached"), "1"))
    }

    @Test fun adapterDisabledOnPcIsIdle() {
        assertEquals(TetherLink.IDLE, d(listOf("not attached", "not attached"), "0"))
    }

    @Test fun reconnectStepsAreIdleUntilConfigured() {
        assertEquals(TetherLink.IDLE, d(listOf("default", "not attached"), "0"))
        assertEquals(TetherLink.IDLE, d(listOf("default", "not attached"), "1"))
        assertEquals(TetherLink.IDLE, d(listOf("configured", "not attached"), "0"))
    }

    @Test fun onlyTheFirstUdcEntryCounts() {
        assertEquals(TetherLink.IDLE, d(listOf("not attached", "configured"), "1"))
        assertEquals(TetherLink.ACTIVE, d(listOf("configured", "configured"), "1"))
    }

    // Missing readings.
    @Test fun carrierZeroIsIdleEvenWithoutUdc() {
        assertEquals(TetherLink.IDLE, d(null, "0"))
        assertEquals(TetherLink.IDLE, d(listOf(""), "0"))
    }

    @Test fun notConfiguredIsIdleEvenWithoutCarrier() {
        assertEquals(TetherLink.IDLE, d(listOf("not attached"), null))
        assertEquals(TetherLink.IDLE, d(listOf("default"), ""))
    }

    @Test fun missingReadingThatCouldSettleItIsUnknown() {
        assertEquals(TetherLink.UNKNOWN, d(listOf("configured"), null))
        assertEquals(TetherLink.UNKNOWN, d(listOf("configured"), ""))
        assertEquals(TetherLink.UNKNOWN, d(null, "1"))
        assertEquals(TetherLink.UNKNOWN, d(emptyList(), "1"))
        assertEquals(TetherLink.UNKNOWN, d(listOf(""), "1"))
        assertEquals(TetherLink.UNKNOWN, d(null, null))
    }

    @Test fun garbageCarrierIsUnknownNotActive() {
        assertEquals(TetherLink.UNKNOWN, d(listOf("configured"), "up"))
        assertEquals(TetherLink.UNKNOWN, d(listOf("configured"), "2"))
    }

    @Test fun whitespaceIsIgnored() {
        assertEquals(TetherLink.ACTIVE, d(listOf(" configured\n"), "1\n"))
    }

    // Parsing the output of the one shell line.
    @Test fun parsesCommandOutput() {
        assertEquals(TetherLink.ACTIVE, TetherState.fromOutput("udc=configured\nudc=not attached\ncarrier=1\n"))
        assertEquals(TetherLink.IDLE, TetherState.fromOutput("udc=not attached\nudc=not attached\ncarrier=0\n"))
        assertEquals(TetherLink.IDLE, TetherState.fromOutput("udc=default\nudc=not attached\ncarrier=\n"))
        assertEquals(TetherLink.IDLE, TetherState.fromOutput("udc=\ncarrier=0\n"))
    }

    @Test fun badOutputIsUnknown() {
        assertEquals(TetherLink.UNKNOWN, TetherState.fromOutput(null))
        assertEquals(TetherLink.UNKNOWN, TetherState.fromOutput(""))
        assertEquals(TetherLink.UNKNOWN, TetherState.fromOutput("su: not found"))
        assertEquals(TetherLink.UNKNOWN, TetherState.fromOutput("udc=configured\ncarrier=\n"))
        assertEquals(TetherLink.UNKNOWN, TetherState.fromOutput("carrier=1\n"))
    }

    // The peer reading (a PC that is gone although the UDC and the carrier still look connected: the half-pulled cable seen on the F50).
    @Test fun peerZeroTurnsAnActiveLinkIdle() {
        assertEquals(TetherLink.IDLE, TetherState.decide(listOf("configured", "not attached"), "1", "0"))
        assertEquals(TetherLink.IDLE, TetherState.fromOutput("udc=configured\nudc=not attached\ncarrier=1\npeer=0\n"))
    }

    @Test fun peerOneOrUnknownKeepsTheOldAnswer() {
        assertEquals(TetherLink.ACTIVE, TetherState.decide(listOf("configured"), "1", "1"))
        assertEquals(TetherLink.ACTIVE, TetherState.decide(listOf("configured"), "1", null))
        assertEquals(TetherLink.ACTIVE, TetherState.decide(listOf("configured"), "1", ""))
        assertEquals(TetherLink.ACTIVE, TetherState.decide(listOf("configured"), "1", "garbage"))
        assertEquals(TetherLink.ACTIVE, TetherState.fromOutput("udc=configured\ncarrier=1\npeer=1\n"))
        assertEquals(TetherLink.ACTIVE, TetherState.fromOutput("udc=configured\ncarrier=1\npeer=\n"))
        assertEquals(TetherLink.ACTIVE, TetherState.fromOutput("udc=configured\ncarrier=1\n"))
    }

    @Test fun peerNeverMakesAnIdleOrUnknownLinkActive() {
        assertEquals(TetherLink.IDLE, TetherState.decide(listOf("not attached"), "0", "1"))
        assertEquals(TetherLink.IDLE, TetherState.decide(listOf("default"), "1", "1"))
        assertEquals(TetherLink.UNKNOWN, TetherState.decide(listOf("configured"), null, "1"))
        assertEquals(TetherLink.UNKNOWN, TetherState.decide(null, "1", "1"))
    }

    @Test fun readCommandHasAllMarkers() {
        assert(TetherState.READ_COMMAND.contains("udc=") && TetherState.READ_COMMAND.contains("carrier=") && TetherState.READ_COMMAND.contains("peer="))
        assert(!TetherState.READ_COMMAND.contains('\n'))
    }
}

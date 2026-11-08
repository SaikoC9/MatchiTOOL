package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NoiseGateTest {
    @Test fun repeatedLinesPassThreeTimesThenAreHidden() {
        val gate = NoiseGate(perWindow = 3, windowMs = 60_000L) { _, _, _ -> }
        val passed = (1..10).count { gate.allow("WARNING", "System", "A resource failed to call end.") }
        assertEquals(3, passed)
    }

    @Test fun digitsAreIgnoredWhenComparingLines() {
        val gate = NoiseGate(perWindow = 1, windowMs = 60_000L) { _, _, _ -> }
        assertTrue(gate.allow("DEBUG", "X", "socket(5) open"))
        assertFalse(gate.allow("DEBUG", "X", "socket(77) open"))
    }

    @Test fun flushReportsHiddenCount() {
        val out = ArrayList<String>()
        val gate = NoiseGate(perWindow = 2, windowMs = 60_000L) { _, _, m -> out.add(m) }
        repeat(5) { gate.allow("WARNING", "T", "same") }
        gate.flush()
        assertEquals(listOf("(repeated 3 more times, hidden) same"), out)
    }

    @Test fun platformChatterIsDroppedOutrightAlsoForDeviceCapture() {
        val gate = NoiseGate { _, _, _ -> }
        assertFalse(gate.allow("DEBUG", "TrafficStats", "tagSocket(5) with statsTag=0xffffffff, statsUid=-1"))
        assertFalse(gate.allow("DEBUG", "device/TrafficStats", "tagSocket(5) with statsTag=0xffffffff, statsUid=-1"))
        assertFalse(gate.allow("INFO", "tool", "type=1400 audit(0.0:1): avc: denied { read } permissive=1 app=com.matchi.tool"))
        assertTrue(gate.allow("ERROR", "TrafficStats", "real failure"))
        assertTrue(gate.allow("WARNING", "Tls", "TLS self-test failed"))
    }

    @Test fun kernelDriverChatterIsDroppedButFaultsStay() {
        val gate = NoiseGate { _, _, _ -> }
        assertFalse(gate.allow("INFO", "kernel", "[ 5284.569816] [c0] sprd-wlan: cmd->refcnt=1"))
        assertFalse(gate.allow("INFO", "kernel", "[ 5284.828545] [c2] [SPRD_PDBG] [EB_INFO  ] ap1: 0x1"))
        assertFalse(gate.allow("INFO", "device/kernel", "[ 5285.3] [c3] healthd: battery l=50 v=3800"))
        assertTrue(gate.allow("INFO", "kernel", "[ 5283.004493] [c4] sprd-wlan: sc2355_pcie_hif_fill_msdu_dscr, 1170, sta disconn, no data tx!"))
        assertTrue(gate.allow("ERROR", "kernel", "[ 5294.2] [c2] charged: charge_set_basp: convert basp = -1 failed"))
    }

    @Test fun knownBenignErrorsAreShownAsInfo() {
        assertEquals("INFO", NoiseGate.levelFor("WARNING", "sprd_wdt_fiq: sprd wdt load value timeout =40, pretimeout =20"))
        assertEquals("INFO", NoiseGate.levelFor("ERROR", "Couldn't get temperatures because of HAL error: can't find this type sensor"))
        assertEquals("ERROR", NoiseGate.levelFor("ERROR", "sipa_eth: fail to send, ret -12"))
        assertEquals("ERROR", NoiseGate.levelFor("ERROR", "charge_set_basp: convert basp = -1 failed"))
    }
}

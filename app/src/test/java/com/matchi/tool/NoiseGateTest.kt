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
}

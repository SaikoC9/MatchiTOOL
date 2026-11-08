package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Test

class SourceCountersTest {
    @Test fun countsAndResets() {
        val c = SourceCounters()
        c.seen(10); c.passed(6); c.collapsed(3); c.dropped(1); c.gap(); c.gap()
        val s = c.snapshot()
        assertEquals(10L, s.seen); assertEquals(6L, s.passed); assertEquals(3L, s.collapsed); assertEquals(1L, s.dropped); assertEquals(2L, s.gaps)
        assertEquals(0L, s.unaccounted)
        c.reset(); assertEquals(0L, c.snapshot().seen)
    }

    @Test fun unaccountedNeverNegative() {
        val c = SourceCounters(); c.passed(5)
        assertEquals(0L, c.snapshot().unaccounted)
        c.seen(9); assertEquals(4L, c.snapshot().unaccounted)
    }

    @Test fun noiseGateFeedsTheCounters() {
        val c = SourceCounters()
        val gate = NoiseGate(perWindow = 2, windowMs = 60_000L) { _, _, _ -> }
        gate.stats = c
        repeat(5) { c.seen(); gate.allow("WARNING", "T", "same line") }      // 2 pass, 3 collapsed
        c.seen(); gate.allow("INFO", "TrafficStats", "chatter")               // dropped outright
        val s = c.snapshot()
        assertEquals(6L, s.seen); assertEquals(2L, s.passed); assertEquals(3L, s.collapsed); assertEquals(1L, s.dropped)
        assertEquals(0L, s.unaccounted)
    }

    @Test fun registryResetClearsEverySource() {
        SourceStats.app.seen(); SourceStats.device.dropped(); SourceStats.kernel.gap(); SourceStats.queueDropped.incrementAndGet()
        SourceStats.reset()
        assertEquals(0L, SourceStats.all().values.sumOf { it.seen + it.dropped + it.gaps })
        assertEquals(0L, SourceStats.queueDropped.get())
    }
}

package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LogLineParserTest {
    @Test fun threadtimeLine() {
        val p = LogLineParser.parse("11-08 16:00:01.123  1234  5678 E AndroidRuntime: FATAL EXCEPTION: main")
        assertEquals("logcat", p.kind); assertEquals("11-08 16:00:01.123", p.time)
        assertEquals(1234, p.pid); assertEquals(5678, p.tid)
        assertEquals("ERROR", p.level); assertEquals("AndroidRuntime", p.tag); assertEquals("FATAL EXCEPTION: main", p.message)
    }

    @Test fun threadtimeWithYearAndPaddedTag() {
        val p = LogLineParser.parse("2026-11-08 16:00:01.123   999  1000 I ActivityManager: Start proc 12:com.x/u0a1")
        assertEquals("2026-11-08 16:00:01.123", p.time); assertEquals(999, p.pid); assertEquals("ActivityManager", p.tag)
        assertEquals("Start proc 12:com.x/u0a1", p.message)
    }

    @Test fun messageContainingColonsKeepsFirstTagSplit() {
        val p = LogLineParser.parse("11-08 16:00:01.123  1  2 W Tag: key: value: more")
        assertEquals("Tag", p.tag); assertEquals("key: value: more", p.message)
    }

    @Test fun emptyMessageAndTagWithSpaces() {
        val p = LogLineParser.parse("11-08 16:00:01.123  1  2 D My Tag:")
        assertEquals("My Tag", p.tag); assertEquals("", p.message); assertEquals("DEBUG", p.level)
    }

    @Test fun priorityMapping() {
        assertEquals("ERROR", LogLineParser.levelOf("F")); assertEquals("ERROR", LogLineParser.levelOf("A"))
        assertEquals("WARNING", LogLineParser.levelOf("W")); assertEquals("DEBUG", LogLineParser.levelOf("V"))
        assertEquals("INFO", LogLineParser.levelOf("I"))
    }

    @Test fun bufferMarker() {
        val p = LogLineParser.parse("--------- beginning of crash")
        assertEquals("marker", p.kind); assertEquals("beginning of crash", p.message)
    }

    @Test fun kernelLines() {
        val a = LogLineParser.parse("[ 5284.512345] sprd-wlan: connection failed")
        assertEquals("kernel", a.kind); assertEquals("5284.512345", a.time); assertEquals("ERROR", a.level)
        assertEquals("sprd-wlan: connection failed", a.message)
        val b = LogLineParser.parse("<6>[    1.000000] Booting Linux")
        assertEquals("kernel", b.kind); assertEquals("1.000000", b.time); assertEquals("INFO", b.level)
        assertEquals("WARNING", LogLineParser.parse("[ 3.0] request timeout").level)
    }

    @Test fun unknownLinesAreKeptAsText() {
        val p = LogLineParser.parse("2026-11-08 16:00:01 GAP: logcat exited rc=7, restarting")
        assertEquals("text", p.kind); assertEquals(-1, p.pid); assertEquals("2026-11-08 16:00:01 GAP: logcat exited rc=7, restarting", p.message)
        assertEquals("text", LogLineParser.parse("").kind)
    }

    @Test fun displayFilterNeverNeededAtCapture() {
        val e = LogLineParser.parse("11-08 16:00:01.123  1  2 E Net: socket closed")
        val i = LogLineParser.parse("11-08 16:00:01.123  1  2 I Net: ok")
        assertTrue(LogLineParser.matches(e, "WARNING", ""))
        assertFalse(LogLineParser.matches(i, "WARNING", ""))
        assertTrue(LogLineParser.matches(i, "", "net"))
        assertFalse(LogLineParser.matches(i, "", "socket"))
    }
}

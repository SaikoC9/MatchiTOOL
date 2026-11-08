package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class CaptureLinesTest {
    private fun tt(pid: Int, pri: String, tag: String, msg: String) = "11-08 16:00:01.123  $pid  42 $pri $tag: $msg"

    @Test fun appLineParsed() {
        val p = CaptureLines.parseApp(tt(100, "W", "WifiHal", "link lost"), "MatchiLogCatcher")
        assertNotNull(p); assertEquals("WARNING", p!!.level); assertEquals("WifiHal", p.tag); assertEquals("link lost", p.message)
    }
    @Test fun appDropsOwnTagSystemOutBlankAndGarbage() {
        assertNull(CaptureLines.parseApp(tt(1, "I", "MatchiLogCatcher", "x"), "MatchiLogCatcher"))
        assertNull(CaptureLines.parseApp(tt(1, "I", "System.out", "x"), "MatchiLogCatcher"))
        assertNull(CaptureLines.parseApp(tt(1, "I", "Tag", "   "), "MatchiLogCatcher"))
        assertNull(CaptureLines.parseApp("--------- beginning of main", "MatchiLogCatcher"))
    }
    @Test fun appLevels() {
        assertEquals("ERROR", CaptureLines.appLevel("E")); assertEquals("ERROR", CaptureLines.appLevel("A"))
        assertEquals("INFO", CaptureLines.appLevel("F")); assertEquals("DEBUG", CaptureLines.appLevel("V"))
    }
    @Test fun deviceLineParsedAndTagMadeSafe() {
        val p = CaptureLines.parseDevice(tt(200, "F", "a.b.C", "boom"), "999")
        assertNotNull(p); assertEquals(200, p!!.pid); assertEquals("ERROR", p.level); assertEquals("a_b_C", p.tag)
    }
    @Test fun deviceSkipsOwnPidAndBlank() {
        assertNull(CaptureLines.parseDevice(tt(999, "I", "T", "m"), "999"))
        assertNull(CaptureLines.parseDevice(tt(5, "I", "T", ""), "999"))
        assertNull(CaptureLines.parseDevice("not a log line", "999"))
    }
}

package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BootLogdModelTest {
    @Test fun configIsClampedToTheScriptLimits() {
        val c = BootLogdModel.Config(fileKb = 1, files = 999, minFreeMb = 0).clamped()
        assertEquals(64, c.fileKb); assertEquals(40, c.files); assertEquals(50, c.minFreeMb)
        assertEquals("FILE_KB=2048\nFILES=10\nMIN_FREE_MB=200\n", BootLogdModel.Config().render())
        assertEquals(2048 * 10 * 2 + 1024, BootLogdModel.Config().maxTotalKb())
    }

    @Test fun scriptVersionIsReadFromTheHeaderAndDecidesReinstall() {
        assertEquals(3, BootLogdModel.scriptVersion("#!/system/bin/sh\n# MATCHI_LOGD_VERSION=3\nx"))
        assertNull(BootLogdModel.scriptVersion("#!/bin/sh\necho hi"))
        assertTrue(BootLogdModel.needsReinstall(null, 1))
        assertTrue(BootLogdModel.needsReinstall(1, 2))
        assertFalse(BootLogdModel.needsReinstall(2, 2))
        assertFalse(BootLogdModel.needsReinstall(null, null))
    }

    @Test fun onlyCaptureFilesCanBeOpened() {
        for (ok in listOf("logcat.log", "logcat.log.3", "dmesg.log.12", "events.log", "context.txt", "status", "logcat.gaps"))
            assertTrue(ok, BootLogdModel.isSafeFileName(ok))
        for (bad in listOf("../etc/passwd", "logcat.log/../x", "logcat.log.123", "logd.pid", "a b", "", "logcat.log;id", "/data/x"))
            assertFalse(bad, BootLogdModel.isSafeFileName(bad))
    }

    @Test fun statusLinesAreParsed() {
        val m = BootLogdModel.parseStatus("state=running\nused_kb=1234\nnoise\nheartbeat=2026-11-08 16:00:01\n")
        assertEquals("running", m["state"]); assertEquals("1234", m["used_kb"]); assertEquals("2026-11-08 16:00:01", m["heartbeat"])
    }

    @Test fun timePrefixCannotCarryShellText() {
        assertEquals("11-08 16:00", BootLogdModel.safeTimePrefix(" 11-08 16:00 "))
        assertNull(BootLogdModel.safeTimePrefix("x'; rm -rf /"))
        assertNull(BootLogdModel.safeTimePrefix("\$(id)"))
        assertNull(BootLogdModel.safeTimePrefix(""))
    }

    @Test fun pageCommandAndParser() {
        val cmd = BootLogdModel.pageCommand("logcat.log", 0, 99999, "11-08 16:00")
        assertTrue(cmd.contains("grep -n -m1 -F -- '11-08 16:00'"))
        assertTrue(cmd.contains("head -n ${BootLogdModel.MAX_PAGE_LINES}"))
        assertTrue(BootLogdModel.pageCommand("events.log", 5, 10, null).contains("S=5"))
        val p = BootLogdModel.parsePage("TOTAL=120\nSTART=41\n---\nline a\nline b\n")!!
        assertEquals(120, p.total); assertEquals(41, p.start); assertEquals(listOf("line a", "line b"), p.lines)
        assertNull(BootLogdModel.parsePage("garbage"))
    }

    @Test(expected = IllegalArgumentException::class) fun pageCommandRejectsUnsafeNames() {
        BootLogdModel.pageCommand("../../etc/shadow", 1, 10, null)
    }

    @Test fun rotationIndexOrdersNewestFirst() {
        assertEquals(0, BootLogdModel.rotationIndex("logcat.log")); assertEquals(4, BootLogdModel.rotationIndex("logcat.log.4"))
    }
}

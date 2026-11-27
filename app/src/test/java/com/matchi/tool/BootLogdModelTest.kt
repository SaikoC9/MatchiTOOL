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
        assertEquals("FILE_KB=2048\nFILES=10\nMIN_FREE_MB=200\nRETAIN_DAYS=0\n", BootLogdModel.Config().render())
        assertEquals(2048 * 10 * 2 + 2048, BootLogdModel.Config().maxTotalKb())
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
        for (ok in listOf("logcat.log", "logcat.log.3", "dmesg.log.12", "events.log", "context.txt", "status", "logcat.gaps", "magisk.log", "modules.txt", "app_shell_audit.log", "updater.log", "app_events.log"))
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

    @Test fun countersParseAndCommandCoverRotatedFiles() {
        val c = BootLogdModel.parseCounters("LOGCAT_LINES=5\nLOGCAT_ERRORS=3\nLOGCAT_WARNINGS=1\nDMESG_LINES=2\nGAPS=1\nEVENTS=0\nnoise line\n")
        assertEquals(5L, c.logcatLines); assertEquals(3L, c.logcatErrors); assertEquals(1L, c.logcatWarnings)
        assertEquals(2L, c.dmesgLines); assertEquals(1L, c.gaps); assertEquals(0L, c.events)
        assertEquals(0L, BootLogdModel.parseCounters("").logcatLines)      // unreadable output counts as zero, never throws
        val cmd = BootLogdModel.countersCommand()
        assertTrue(cmd.contains("logcat.log.[0-9]*") && cmd.contains("dmesg.log.[0-9]*") && cmd.contains("logcat.gaps"))
        assertTrue(!cmd.contains("rm ") && !cmd.contains("mv "))         // read-only
    }

    @Test fun bundleOrderPutsInfoFirst() {
        val names = listOf("dmesg.log", "logcat.log.1", "context.txt", "logcat.log", "magisk.log")
        val sorted = names.sortedWith(compareBy({ BootLogdModel.bundleOrder(it) }, { BootLogdModel.rotationIndex(it) }))
        assertEquals(listOf("context.txt", "magisk.log", "logcat.log", "logcat.log.1", "dmesg.log"), sorted)
    }

    @Test fun retentionDaysAreClampedAndRendered() {
        assertEquals(0, BootLogdModel.Config().retainDays)
        assertEquals(365, BootLogdModel.Config(retainDays = 9999).clamped().retainDays)
        assertEquals(0, BootLogdModel.Config(retainDays = -5).clamped().retainDays)
        assertTrue(BootLogdModel.Config(retainDays = 7).render().contains("RETAIN_DAYS=7"))
    }

    @Test fun pidHelperNeedsTheProcessNameBeforeAnyKill() {
        val fn = BootLogdModel.PID_FN
        // A pid file can outlive a reboot and name a process that has nothing to do with the capture script.
        assertTrue(fn.contains("ps -A -o PID,ARGS"))
        assertTrue(fn.contains("matchi_logd.sh"))
        assertTrue(fn.contains("kill -0"))
        assertFalse(fn.contains("/proc/"))   // command lines come from ps (docs/PLUGIN_RULES.md)
        assertTrue(fn.endsWith("\n"))        // callers append their own command on the next line
    }
}

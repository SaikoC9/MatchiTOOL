package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LogBasketTest {
    private fun row(type: String, name: String, modified: Long = 0, active: Boolean = false, rootOnly: Boolean = false) =
        LogBasket.Row(type, name, 10, modified, "", active, rootOnly)

    @Test fun idRoundTrip() {
        val r = row(LogBasket.SESSION, "session_20261109_101500_123_ab12cd34.log")
        assertEquals(LogBasket.SESSION to r.name, LogBasket.parseId(r.id))
    }

    @Test fun parseIdRefusesPathsAndUnknownTypes() {
        assertNull(LogBasket.parseId("session:../x.log"))
        assertNull(LogBasket.parseId("session:a/b.log"))
        assertNull(LogBasket.parseId("session:.hidden"))
        assertNull(LogBasket.parseId("session:"))
        assertNull(LogBasket.parseId("other:file.log"))
        assertNull(LogBasket.parseId("nocolon"))
        assertNull(LogBasket.parseId("export:a b.txt"))
    }

    @Test fun deleteRules() {
        assertTrue(row(LogBasket.SESSION, "a.log").canDelete)
        assertTrue(row(LogBasket.EXPORT, "a.txt").canDelete)
        assertFalse(row(LogBasket.SESSION, "a.log", active = true).canDelete)
        assertTrue(row(LogBasket.AUDIT, "shell_audit.log").canDelete)
        assertFalse(row(LogBasket.BOOT, "logcat.log", rootOnly = true).canDelete)
        assertFalse(row(LogBasket.BOOT, "dmesg.log", rootOnly = true).canDelete)
        assertFalse(row(LogBasket.BOOT, "events.log", rootOnly = true).canDelete)
        assertTrue(row(LogBasket.BOOT, "logcat.log.1", rootOnly = true).canDelete)
        assertTrue(row(LogBasket.BOOT, "dmesg.log.12", rootOnly = true).canDelete)
    }

    @Test fun bootDeletableOnlyRotatedCaptureFiles() {
        assertTrue(LogBasket.bootDeletable("logcat.log.3"))
        assertFalse(LogBasket.bootDeletable("logcat.log"))
        assertFalse(LogBasket.bootDeletable("logcat.log.100"))
        assertFalse(LogBasket.bootDeletable("status"))
        assertFalse(LogBasket.bootDeletable("../logcat.log.1"))
    }

    @Test fun arrangeOrdersTypesThenNewestFirst() {
        val out = LogBasket.arrange(listOf(
            row(LogBasket.BOOT, "dmesg.log", rootOnly = true),
            row(LogBasket.EXPORT, "e1.txt", 5),
            row(LogBasket.SESSION, "old.log", 1),
            row(LogBasket.SESSION, "new.log", 9),
            row(LogBasket.AUDIT, "shell_audit.log", 3)
        )).map { it.id }
        assertEquals(listOf("session:new.log", "session:old.log", "export:e1.txt", "audit:shell_audit.log", "boot:dmesg.log"), out)
    }

    @Test fun arrangeDropsUnsafeNames() {
        assertEquals(listOf("export:ok.txt"), LogBasket.arrange(listOf(row(LogBasket.EXPORT, "ok.txt"), row(LogBasket.EXPORT, "a/b.txt"))).map { it.id })
    }

    @Test fun bootNote() {
        assertEquals("", LogBasket.bootNote(true, true))
        assertEquals("Boot capture is not installed", LogBasket.bootNote(false, true))
        assertEquals("Sign in for root to list boot files", LogBasket.bootNote(true, false))
    }

    @Test fun tailKeepsLastLines() {
        assertEquals(listOf("c", "d"), LogBasket.tailLines("a\nb\nc\nd\n", 2))
        assertEquals(listOf("a", "b"), LogBasket.tailLines("a\r\nb", 10))
        assertEquals(emptyList<String>(), LogBasket.tailLines("", 5))
    }

    @Test fun tailCountIsClamped() {
        assertEquals(1, LogBasket.clampTail(0))
        assertEquals(LogBasket.TAIL_MAX, LogBasket.clampTail(1_000_000))
        assertEquals(LogBasket.TAIL_DEFAULT, LogBasket.clampTail(LogBasket.TAIL_DEFAULT))
    }
}

package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ExitReasonModelTest {
    @Test fun names() {
        assertTrue(ExitReasonModel.name(6).startsWith("ANR"))
        assertTrue(ExitReasonModel.name(16).startsWith("PACKAGE_UPDATED"))
        assertTrue(ExitReasonModel.name(99).contains("99"))
    }
    @Test fun levels() {
        assertEquals("ERROR", ExitReasonModel.level(4))
        assertEquals("ERROR", ExitReasonModel.level(6))
        assertEquals("WARNING", ExitReasonModel.level(3))
        assertEquals("INFO", ExitReasonModel.level(16))
        assertEquals("INFO", ExitReasonModel.level(10))
    }
    @Test fun describeIsOneLine() {
        val d = ExitReasonModel.describe(3, 0, 400, "a\nb", 123L)
        assertTrue(!d.contains('\n'))
        assertTrue(d.contains("LOW_MEMORY") && d.contains("at=123"))
    }
}

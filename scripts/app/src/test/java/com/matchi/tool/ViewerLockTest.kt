package com.matchi.tool

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ViewerLockTest {
    @Test fun firstViewerOwnsTheSettings() {
        val l = ViewerLock(10_000)
        assertTrue(l.mayChange("a", 0))
        assertFalse(l.mayChange("b", 1_000))
        assertTrue(l.mayChange("a", 2_000))
    }

    @Test fun anotherViewerTakesOverAfterTheOwnerIsIdle() {
        val l = ViewerLock(10_000)
        assertTrue(l.mayChange("a", 0))
        assertFalse(l.mayChange("b", 9_000))
        assertTrue(l.mayChange("b", 10_500))
        assertFalse(l.mayChange("a", 11_000))
    }
}

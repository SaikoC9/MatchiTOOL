package com.matchi.tool

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class QuietTest {
    private val reports = ArrayList<Pair<String, String>>()

    @Before fun setUp() { Quiet.reset(); reports.clear(); Quiet.sink = { site, msg -> reports.add(site to msg) } }
    @After fun tearDown() { Quiet.sink = { _, _ -> }; Quiet.reset() }

    @Test fun swallowsButReports() {
        Quiet.attempt("T.one") { throw IllegalStateException("boom") }
        assertEquals(1, reports.size)
        assertEquals("T.one", reports[0].first)
        assertTrue(reports[0].second.contains("IllegalStateException: boom"))
    }

    @Test fun orElseReturnsFallbackAndValue() {
        assertEquals(7, Quiet.orElse("T.two", 7) { error("x") })
        assertEquals(3, Quiet.orElse("T.two", 7) { 3 })
        assertEquals(1L, Quiet.count("T.two"))
    }

    @Test fun floodIsThinned() {
        repeat(1000) { Quiet.attempt("T.loop") { throw RuntimeException("again") } }
        assertEquals(1000L, Quiet.count("T.loop"))
        // first 5, then every 100th: 5 + 10
        assertEquals(15, reports.size)
        assertTrue(reports.last().second.contains("failure #1000"))
    }

    @Test fun shouldReportRule() {
        assertTrue(Quiet.shouldReport(1)); assertTrue(Quiet.shouldReport(5))
        assertFalse(Quiet.shouldReport(6)); assertFalse(Quiet.shouldReport(99))
        assertTrue(Quiet.shouldReport(100)); assertTrue(Quiet.shouldReport(200))
    }

    @Test fun sitesAreCountedSeparately() {
        Quiet.attempt("A") { error("1") }; Quiet.attempt("B") { error("2") }; Quiet.attempt("B") { error("3") }
        assertEquals(1L, Quiet.count("A")); assertEquals(2L, Quiet.count("B")); assertEquals(3L, Quiet.total())
        assertEquals("B", Quiet.snapshot().first().first)
    }

    @Test fun sinkThatThrowsOrRecursesDoesNotEscape() {
        Quiet.sink = { _, _ -> Quiet.attempt("T.inner") { error("inner") }; throw RuntimeException("sink broke") }
        Quiet.attempt("T.outer") { error("outer") }   // must not throw
        assertEquals(1L, Quiet.count("T.outer"))
    }

    @Test fun errorsAreNotSwallowed() {
        // Only Exception is caught: an Error such as OutOfMemoryError still propagates, as before.
        var thrown = false
        try { Quiet.attempt("T.err") { throw OutOfMemoryError("x") } } catch (_: OutOfMemoryError) { thrown = true }
        assertTrue(thrown)
    }
}

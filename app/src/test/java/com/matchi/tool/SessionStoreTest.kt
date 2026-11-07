package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionStoreTest {
    private var now = 1_000_000_000L
    private val idle = 1_000L
    private val maxAge = 10_000L

    private fun store(max: Int = 16, saved: MutableList<String>? = null) =
        SessionStore(clock = { now }, idleMs = idle, maxAgeMs = maxAge, maxSessions = max, persist = { saved?.add(it) })

    @Test fun issuedTokenIsRandomHexAndValid() {
        val s = store()
        val a = s.issue(); val b = s.issue()
        assertTrue(Regex("^[0-9a-f]{64}$").matches(a))
        assertNotEquals(a, b)
        assertTrue(s.validate(a)); assertTrue(s.validate(b))
    }

    @Test fun unknownEmptyAndOversizedTokensAreRejected() {
        val s = store(); s.issue()
        assertFalse(s.validate(null)); assertFalse(s.validate("")); assertFalse(s.validate("nope"))
        assertFalse(s.validate("a".repeat(500)))
    }

    @Test fun idleSessionExpires() {
        val s = store(); val t = s.issue()
        now += idle + 1
        assertFalse(s.validate(t))
        assertEquals(0, s.count())
    }

    @Test fun activityKeepsSessionAliveUntilMaxAge() {
        val s = store(); val t = s.issue()
        repeat(9) { now += idle - 1; assertTrue(s.validate(t)) }   // 8991 ms, still under maxAge
        now += idle - 1                                            // 9990 ms
        assertTrue(s.validate(t))
        now += idle - 1                                            // 10989 ms > maxAge although never idle
        assertFalse(s.validate(t))
    }

    @Test fun revokeEndsOnlyThatSession() {
        val s = store(); val a = s.issue(); val b = s.issue()
        s.revoke(a)
        assertFalse(s.validate(a)); assertTrue(s.validate(b))
    }

    @Test fun revokeAllAndRevokeAllExcept() {
        val s = store(); val a = s.issue(); val b = s.issue(); val c = s.issue()
        s.revokeAllExcept(b)
        assertFalse(s.validate(a)); assertTrue(s.validate(b)); assertFalse(s.validate(c))
        s.revokeAll()
        assertFalse(s.validate(b)); assertEquals(0, s.count())
    }

    @Test fun oldestSessionIsEvictedAtTheLimit() {
        val s = store(max = 2)
        val a = s.issue(); val b = s.issue(); val c = s.issue()
        assertFalse(s.validate(a)); assertTrue(s.validate(b)); assertTrue(s.validate(c))
        assertEquals(2, s.count())
    }

    @Test fun sessionsSurviveARestartButStoredFormHasNoRawToken() {
        val saved = mutableListOf<String>()
        val first = store(saved = saved)
        val t = first.issue()
        val blob = saved.last()
        assertFalse(blob.contains(t))
        val second = store(); second.load(blob)
        assertTrue(second.validate(t))
    }

    @Test fun loadDropsGarbageAndExpiredEntries() {
        val saved = mutableListOf<String>()
        val first = store(saved = saved); val t = first.issue()
        val good = saved.last()
        now += idle + 1
        val second = store(); second.load("garbage\n1,2,3\n" + good)
        assertFalse(second.validate(t))
        assertEquals(0, second.count())
    }
}

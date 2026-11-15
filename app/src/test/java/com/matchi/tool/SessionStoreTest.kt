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

    @Test fun backgroundPollsDoNotKeepASessionAlive() {
        val s = store(); val t = s.issue()
        now += idle / 2; assertTrue(s.validate(t, touch = false))    // 500 ms: still inside the idle time
        now += idle / 2; assertTrue(s.validate(t, touch = false))    // 1000 ms: exactly the idle time, not over it yet
        now += 1;        assertFalse(s.validate(t, touch = false))   // 1001 ms: the polls did not restart the timer, so it is gone
        assertEquals(0, s.count())
    }

    @Test fun aRealRequestRestartsTheIdleTimerButAPollDoesNot() {
        val s = store(); val t = s.issue()
        now += idle - 1; assertTrue(s.validate(t, touch = true))    // person clicked: timer restarts
        now += idle - 1; assertTrue(s.validate(t, touch = false))   // a poll, still inside the new idle window
        now += 2;        assertFalse(s.validate(t, touch = true))   // no real request for longer than idle: expired
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

    @Test fun theSessionUsedLeastRecentlyIsEvictedNotAnActiveOne() {
        val s = store(max = 2)
        val a = s.issue()            // oldest login
        now += 100; val b = s.issue()
        now += 100; assertTrue(s.validate(a))   // a is in use, b is not
        now += 100; val c = s.issue()
        assertTrue("the active session must stay", s.validate(a))
        assertFalse("the idle one goes", s.validate(b))
        assertTrue(s.validate(c))
        assertEquals(2, s.count())
    }

    @Test fun backgroundPollsDoNotMakeASessionLookRecentlyUsed() {
        val s = store(max = 2)
        val a = s.issue()
        now += 100; val b = s.issue()
        now += 100; s.validate(a, touch = false)   // a poll only
        now += 100; s.validate(b)                  // a real request
        now += 100; val c = s.issue()
        assertFalse(s.validate(a)); assertTrue(s.validate(b)); assertTrue(s.validate(c))
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

    @Test fun ageCountsFromLoginAndIgnoresActivity() {
        val s = store(); val t = s.issue()
        now += idle - 1; assertTrue(s.validate(t))
        now += idle - 1
        assertEquals(2 * (idle - 1), s.ageMs(t))
        assertEquals(null, s.ageMs("nope")); assertEquals(null, s.ageMs(null))
        now += idle + 1
        assertEquals(null, s.ageMs(t))   // idle-expired sessions have no age
    }

    @Test fun everySavedSnapshotMatchesTheStateAtThatMoment() {
        // persist runs under the store's lock, so the LAST saved snapshot is always the final state (a signed-out session
        // can never come back after a restart because an older snapshot was written later).
        val saved = mutableListOf<String>()
        val s = store(saved = saved)
        val a = s.issue(); val b = s.issue()
        s.revoke(a)
        val restored = store(); restored.load(saved.last())
        assertFalse(restored.validate(a)); assertTrue(restored.validate(b))
    }

    @Test fun concurrentLoginsAndSignOutsLeaveAConsistentSnapshot() {
        val saved = java.util.Collections.synchronizedList(mutableListOf<String>())
        val s = store(saved = saved)
        val tokens = (1..8).map { s.issue() }
        val revoked = tokens.take(4)
        val threads = tokens.map { t -> Thread { if (t in revoked) s.revoke(t) else s.validate(t) } }
        threads.forEach { it.start() }; threads.forEach { it.join() }
        val restored = store(); restored.load(saved.last())
        revoked.forEach { assertFalse(restored.validate(it)) }
        tokens.drop(4).forEach { assertTrue(restored.validate(it)) }
    }
}

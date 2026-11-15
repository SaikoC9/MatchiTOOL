package com.matchi.tool

import java.security.MessageDigest
import java.security.SecureRandom

/**
 * Web console sessions. Every successful login gets its OWN random 256-bit token (the old design handed out one
 * permanent token to everybody). A session ends when it has been idle for [idleMs], when it is older than
 * [maxAgeMs], when it is signed out, or when the password changes.
 *
 * Only the SHA-256 of a token is kept (in memory and, through [persist], in private preferences so a host restart
 * such as an OTA update does not sign everybody out). A leaked preferences file therefore does not contain
 * usable tokens. No Android classes here, so this runs in plain JVM unit tests.
 */
class SessionStore(
    private val clock: () -> Long = { System.currentTimeMillis() },
    private val idleMs: Long = IDLE_MS,
    private val maxAgeMs: Long = MAX_AGE_MS,
    private val maxSessions: Int = MAX_SESSIONS,
    private val persist: (String) -> Unit = {},
) {
    private class Entry(val created: Long, var lastSeen: Long)

    private val rng = SecureRandom()
    private val map = LinkedHashMap<String, Entry>()   // insertion order = oldest login first
    private var lastPersistAt = 0L

    /** Restore sessions saved by [persist]. Garbage lines and expired sessions are dropped. */
    fun load(serialized: String?) {
        val now = clock()
        synchronized(map) {
            map.clear()
            if (!serialized.isNullOrEmpty()) {
                for (line in serialized.lines()) {
                    val p = line.trim().split(",")
                    if (p.size != 3 || !HASH_RX.matches(p[0])) continue
                    val created = p[1].toLongOrNull() ?: continue
                    val seen = p[2].toLongOrNull() ?: continue
                    if (!expired(created, seen, now)) map[p[0]] = Entry(created, seen)
                }
            }
        }
    }

    /** Start a new session and return its token (shown to the client once, never stored in clear). */
    fun issue(): String {
        val raw = ByteArray(32)
        rng.nextBytes(raw)
        val token = raw.joinToString("") { "%02x".format(it) }
        val now = clock()
        synchronized(map) {
            map.values.removeAll { expired(it.created, it.lastSeen, now) }
            // At the limit the session that was used LEAST recently goes (C12). It used to be the first one in creation order, which could be a
            // session in constant use. [lastSeen] only moves on a real request (a background poll does not touch it), and a tie (never used since
            // login) goes to the older login because the map keeps creation order.
            while (map.size >= maxSessions) {
                val victim = map.entries.minByOrNull { it.value.lastSeen }?.key ?: break
                map.remove(victim)
            }
            map[hash(token)] = Entry(now, now)
            lastPersistAt = now
            persistLocked()
        }
        return token
    }

    /**
     * True when [token] belongs to a live session. With [touch] (the default) it also restarts that session's idle timer.
     * Background polls from an open tab pass touch = false: otherwise a tab left open (Live Status polls every few seconds)
     * kept the session alive until the 12 h maximum. An expired session is still removed either way.
     */
    fun validate(token: String?, touch: Boolean = true): Boolean {
        if (token.isNullOrEmpty() || token.length > MAX_TOKEN_LEN) return false
        val key = hash(token)
        val now = clock()
        val ok = synchronized(map) {
            val e = map[key]
            when {
                e == null -> false
                expired(e.created, e.lastSeen, now) -> {
                    map.remove(key)
                    persistLocked()
                    false
                }
                !touch -> true
                else -> {
                    e.lastSeen = now
                    if (now - lastPersistAt >= PERSIST_EVERY_MS) {
                        lastPersistAt = now
                        persistLocked()
                    }
                    true
                }
            }
        }
        return ok
    }

    /** Milliseconds since this session was created, or null when the token is not a live session. Does not touch the idle timer. */
    fun ageMs(token: String?): Long? {
        if (token.isNullOrEmpty() || token.length > MAX_TOKEN_LEN) return null
        val now = clock()
        return synchronized(map) {
            val e = map[hash(token)]
            if (e == null || expired(e.created, e.lastSeen, now)) null else now - e.created
        }
    }

    /** Sign one session out. */
    fun revoke(token: String?) {
        if (token.isNullOrEmpty() || token.length > MAX_TOKEN_LEN) return
        val key = hash(token)
        synchronized(map) { if (map.remove(key) != null) persistLocked() }
    }

    /** Sign everybody out (password changed). */
    fun revokeAll() {
        synchronized(map) { map.clear(); persistLocked() }
    }

    /** Sign everybody out except the session that is making the change. */
    fun revokeAllExcept(keep: String?) {
        val keepKey = if (keep.isNullOrEmpty() || keep.length > MAX_TOKEN_LEN) null else hash(keep)
        synchronized(map) { map.keys.removeAll { it != keepKey }; persistLocked() }
    }

    fun count(): Int = synchronized(map) { map.size }

    private fun expired(created: Long, lastSeen: Long, now: Long): Boolean =
        now - lastSeen > idleMs || now - created > maxAgeMs

    /**
     * Saves the current sessions. Always called while holding the [map] lock: when the snapshot was built inside the lock
     * but written outside it, two threads could write out of order and an older snapshot (still holding a signed-out
     * session) could overwrite the newer one, so that session worked again after the next restart. [persist] only hands
     * the string to SharedPreferences.apply(), so holding the lock for it is cheap.
     */
    private fun persistLocked() { persist(serialize()) }

    private fun serialize(): String =
        map.entries.joinToString("\n") { "${it.key},${it.value.created},${it.value.lastSeen}" }

    private fun hash(token: String): String =
        MessageDigest.getInstance("SHA-256").digest(token.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

    companion object {
        const val IDLE_MS = 2L * 60 * 60 * 1000        // signed out after 2 h without a request
        const val MAX_AGE_MS = 12L * 60 * 60 * 1000    // and in any case after 12 h
        const val MAX_SESSIONS = 16
        private const val PERSIST_EVERY_MS = 60_000L   // idle timer is saved at most once a minute
        private const val MAX_TOKEN_LEN = 128
        private val HASH_RX = Regex("^[0-9a-f]{64}$")
    }
}

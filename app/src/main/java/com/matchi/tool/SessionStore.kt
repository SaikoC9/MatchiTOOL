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
    private val map = LinkedHashMap<String, Entry>()   // insertion order = oldest first
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
        val snapshot = synchronized(map) {
            map.values.removeAll { expired(it.created, it.lastSeen, now) }
            while (map.size >= maxSessions) map.remove(map.keys.first())
            map[hash(token)] = Entry(now, now)
            lastPersistAt = now
            serialize()
        }
        persist(snapshot)
        return token
    }

    /** True when [token] belongs to a live session; also restarts that session's idle timer. */
    fun validate(token: String?): Boolean {
        if (token.isNullOrEmpty() || token.length > MAX_TOKEN_LEN) return false
        val key = hash(token)
        val now = clock()
        var snapshot: String? = null
        val ok = synchronized(map) {
            val e = map[key]
            when {
                e == null -> false
                expired(e.created, e.lastSeen, now) -> {
                    map.remove(key)
                    snapshot = serialize()
                    false
                }
                else -> {
                    e.lastSeen = now
                    if (now - lastPersistAt >= PERSIST_EVERY_MS) {
                        lastPersistAt = now
                        snapshot = serialize()
                    }
                    true
                }
            }
        }
        snapshot?.let { persist(it) }
        return ok
    }

    /** Sign one session out. */
    fun revoke(token: String?) {
        if (token.isNullOrEmpty() || token.length > MAX_TOKEN_LEN) return
        val key = hash(token)
        val snapshot = synchronized(map) { if (map.remove(key) != null) serialize() else null }
        snapshot?.let { persist(it) }
    }

    /** Sign everybody out (password changed). */
    fun revokeAll() {
        val snapshot = synchronized(map) { map.clear(); serialize() }
        persist(snapshot)
    }

    /** Sign everybody out except the session that is making the change. */
    fun revokeAllExcept(keep: String?) {
        val keepKey = if (keep.isNullOrEmpty() || keep.length > MAX_TOKEN_LEN) null else hash(keep)
        val snapshot = synchronized(map) { map.keys.removeAll { it != keepKey }; serialize() }
        persist(snapshot)
    }

    fun count(): Int = synchronized(map) { map.size }

    private fun expired(created: Long, lastSeen: Long, now: Long): Boolean =
        now - lastSeen > idleMs || now - created > maxAgeMs

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

package com.matchi.tool

/**
 * Brute-force protection for /api/login. No Android classes, so it runs in plain JVM unit tests.
 *
 * - Per source IP: [MAX_FAILS] bad passwords lock that address; every further lock for the same address doubles
 *   (60 s, 2 min, 4 min ... up to [MAX_LOCK_MS]). The strike count is forgotten after an hour without failures.
 * - Global: bad passwords from ALL non-loopback addresses are counted together, so changing IP (DHCP renew, static IP,
 *   spoofed MAC) does not give fresh tries. After [GLOBAL_FREE] failures in a window every further attempt has to wait
 *   a growing time since the last failure (2 s, 4 s ... up to [GLOBAL_MAX_WAIT_MS], 30 s) whoever it comes from.
 * - Loopback: every app on the phone shares 127.0.0.1, so it is not locked per attempt (after [LOOP_DAILY_CAP] wrong passwords a day the delay rises to [LOOP_CAPPED_MS], but it is never refused); each bad password is answered after a
 *   delay instead ([loopbackDelayMs]) and only [MAX_LOOPBACK_SLEEPERS] such delays may be waiting at once, so guessing
 *   from the device cannot pile up threads ([enterLoopbackDelay] / [leaveLoopbackDelay]).
 * - Router forwarding: the console login can ask the router whether a guess is ITS admin password. Without a limit that
 *   is a password oracle and can trip the router's own lockout, so only [ROUTER_BUDGET] forwards are allowed per
 *   [ROUTER_WINDOW_MS] for the whole app ([mayAskRouter]).
 */
class LoginGuard(private val clock: () -> Long = { System.currentTimeMillis() }) {
    private class Ip(var count: Int, var last: Long, var strikes: Int, var lockUntil: Long)

    private val ips = HashMap<String, Ip>()
    private var gFails = 0
    private var gLast = 0L
    private var loopFails = 0
    private var loopLast = 0L
    private var loopSleepers = 0
    private var loopDayStart = 0L
    private var loopDayFails = 0
    private var attemptsInFlight = 0
    private val routerAsks = ArrayDeque<Long>()
    private val routerAsksByIp = HashMap<String, ArrayDeque<Long>>()

    /** Milliseconds this request must wait before it may try a password; 0 = allowed now. Loopback is never refused. */
    fun retryAfterMs(ip: String, loopback: Boolean): Long = synchronized(this) {
        val now = clock()
        // Loopback is never refused: a refusal would let any app on the phone lock the owner out of the console. A wrong
        // password from loopback is answered late instead (see loopbackDelayMs); a correct one is never delayed.
        if (loopback) return 0L
        var wait = 0L
        ips[ip]?.let { wait = maxOf(wait, it.lockUntil - now) }
        if (gFails > GLOBAL_FREE && now - gLast <= GLOBAL_WINDOW_MS) {
            val w = minOf(GLOBAL_BASE_WAIT_MS shl minOf(gFails - GLOBAL_FREE - 1, 10), GLOBAL_MAX_WAIT_MS)
            wait = maxOf(wait, gLast + w - now)
        }
        maxOf(0L, wait)
    }

    /**
     * C2 (1.4.3): a bad password is only counted AFTER the slow password check, so requests that arrive together all passed [retryAfterMs] and could each
     * try a password before the lock applied. Non-loopback logins therefore take one of [MAX_PARALLEL_ATTEMPTS] slots first; false = answer 429 at once.
     * Always pair a true answer with [endAttempt] (finally), and ask [retryAfterMs] again after getting the slot.
     */
    fun tryBeginAttempt(): Boolean = synchronized(this) {
        if (attemptsInFlight >= MAX_PARALLEL_ATTEMPTS) false else { attemptsInFlight++; true }
    }
    fun endAttempt() = synchronized(this) { if (attemptsInFlight > 0) attemptsInFlight-- }

    /** Record a wrong password. */
    fun failed(ip: String, loopback: Boolean) = synchronized(this) {
        val now = clock()
        if (loopback) {
            if (now - loopLast > GLOBAL_WINDOW_MS) loopFails = 0
            loopFails++; loopLast = now
            if (now - loopDayStart > LOOP_DAY_MS) { loopDayStart = now; loopDayFails = 0 }
            loopDayFails++
            return
        }
        if (now - gLast > GLOBAL_WINDOW_MS) gFails = 0
        gFails++; gLast = now
        if (ip !in ips && ips.size >= MAX_TRACKED) ips.entries.minByOrNull { it.value.last }?.key?.let { ips.remove(it) }
        val e = ips.getOrPut(ip) { Ip(0, now, 0, 0) }
        if (now - e.last > STRIKE_FORGET_MS) e.strikes = 0
        if (now - e.last > COUNT_DECAY_MS && now >= e.lockUntil) e.count = 0   // decays slowly: no fresh 8 tries every minute
        e.count++; e.last = now
        if (e.count >= MAX_FAILS) {
            e.strikes++
            e.lockUntil = now + minOf(LOCK_MS shl minOf(e.strikes - 1, 10), MAX_LOCK_MS)
            e.count = 0
        }
    }

    /** Record a good login: that address and the shared counters start over. */
    fun succeeded(ip: String, loopback: Boolean) = synchronized(this) {
        if (loopback) { loopFails = 0; loopDayFails = 0; return }
        ips.remove(ip)
        gFails = 0
    }

    /** Bad passwords already seen from this address (used to stop forwarding guesses to the router after 3). */
    fun failCount(ip: String): Int = synchronized(this) {
        val e = ips[ip] ?: return 0
        if (clock() - e.last > COUNT_DECAY_MS) 0 else e.count
    }

    /** Delay applied to a wrong loopback password; grows after a few failures, never above 10 s. */
    fun loopbackDelayMs(): Long = synchronized(this) {
        val now = clock()
        // After LOOP_DAILY_CAP wrong passwords in 24 h every further wrong answer waits LOOP_CAPPED_MS (slows guessing, never locks the owner out).
        if (now - loopDayStart <= LOOP_DAY_MS && loopDayFails >= LOOP_DAILY_CAP) return LOOP_CAPPED_MS
        if (now - loopLast > GLOBAL_WINDOW_MS) return LOOP_BASE_MS
        if (loopFails < 5) LOOP_BASE_MS else minOf(LOOP_BASE_MS * (1L shl minOf(loopFails - 4, 3)), LOOP_MAX_MS)
    }

    /** Reserve one of the few loopback delay slots; false = too many are waiting, answer 429 at once. */
    fun enterLoopbackDelay(): Boolean = synchronized(this) {
        if (loopSleepers >= MAX_LOOPBACK_SLEEPERS) false else { loopSleepers++; true }
    }
    fun leaveLoopbackDelay() = synchronized(this) { if (loopSleepers > 0) loopSleepers-- }

    /**
     * True (and one use of the budget is spent) when this login may be forwarded to the router for checking.
     * The budget is kept per address ([ROUTER_BUDGET] per window) AND for the whole app ([ROUTER_GLOBAL_BUDGET]), so one
     * client's wrong guesses cannot use up everything and lock the real owner out when the stored router password is stale.
     */
    fun mayAskRouter(ip: String = ""): Boolean = synchronized(this) {
        val now = clock()
        while (routerAsks.isNotEmpty() && now - routerAsks.first() > ROUTER_WINDOW_MS) routerAsks.removeFirst()
        // Clean up BEFORE the lookup, so the entry of the address being checked is never the one that gets dropped.
        if (routerAsksByIp.size > MAX_TRACKED) {
            routerAsksByIp.values.forEach { q -> while (q.isNotEmpty() && now - q.first() > ROUTER_WINDOW_MS) q.removeFirst() }
            routerAsksByIp.entries.removeAll { it.value.isEmpty() }
        }
        val mine = routerAsksByIp.getOrPut(ip) { ArrayDeque() }
        while (mine.isNotEmpty() && now - mine.first() > ROUTER_WINDOW_MS) mine.removeFirst()
        if (mine.size >= ROUTER_BUDGET || routerAsks.size >= ROUTER_GLOBAL_BUDGET) false
        else { mine.addLast(now); routerAsks.addLast(now); true }
    }

    companion object {
        const val MAX_FAILS = 8
        const val LOCK_MS = 60_000L
        const val MAX_LOCK_MS = 15L * 60_000L
        const val LOCK_WINDOW_MS = 60_000L
        const val STRIKE_FORGET_MS = 60L * 60_000L
        const val COUNT_DECAY_MS = STRIKE_FORGET_MS   // per-IP failure count is forgotten after an hour without failures
        const val LOOP_DAY_MS = 24L * 60L * 60_000L
        const val LOOP_DAILY_CAP = 300                // after this many wrong loopback passwords in 24 h the answer delay rises to LOOP_CAPPED_MS
        const val LOOP_CAPPED_MS = 30_000L
        const val GLOBAL_FREE = 12
        const val GLOBAL_WINDOW_MS = 10L * 60_000L
        const val GLOBAL_BASE_WAIT_MS = 2_000L
        const val GLOBAL_MAX_WAIT_MS = 30_000L   // was 5 min: one hotspot client could keep everyone waiting that long; the per-IP lock stays the main brake
        const val MAX_TRACKED = 256
        const val LOOP_BASE_MS = 2_000L
        const val LOOP_MAX_MS = 10_000L
        const val MAX_LOOPBACK_SLEEPERS = 4
        const val MAX_PARALLEL_ATTEMPTS = 2   // password checks (non-loopback) running at the same moment
        const val ROUTER_BUDGET = 3          // per address
        const val ROUTER_GLOBAL_BUDGET = 9   // whole app: three addresses' worth, so the router's own lockout is still protected
        const val ROUTER_WINDOW_MS = 10L * 60_000L
    }
}

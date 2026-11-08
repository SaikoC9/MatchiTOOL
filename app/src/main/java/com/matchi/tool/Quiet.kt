package com.matchi.tool

import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/**
 * Replacement for the old empty catch blocks that swallowed every exception. The behaviour is the same (the failure does not
 * propagate), but the exception is reported once through [sink] so a hidden fault can be found in the log.
 *
 * Pure Kotlin (no Android classes) so it is unit tested. [LogCatcher.initialize] points [sink] at the app log.
 *
 * Flood protection: for each call site the first [FIRST_N] failures are reported, then only every [EVERY_N]th one
 * (with the running count), so a failure inside a tight loop cannot fill the log or the bounded write queue.
 * A report that itself fails or recurses (the sink logging again through code that uses [note]) is ignored.
 */
object Quiet {
    const val FIRST_N = 5L
    const val EVERY_N = 100L

    /** (site, message). Replaced by the app at start-up; the default does nothing so unit tests need no setup. */
    @Volatile var sink: (String, String) -> Unit = { _, _ -> }

    private val counts = ConcurrentHashMap<String, AtomicLong>()
    private val reporting = ThreadLocal<Boolean>()

    /** Number of failures seen at [site] (reported or not). */
    fun count(site: String): Long = counts[site]?.get() ?: 0L

    /** Total failures seen at all sites. */
    fun total(): Long = counts.values.sumOf { it.get() }

    /** Per-site counts, highest first (for the status page and tests). */
    fun snapshot(): List<Pair<String, Long>> = counts.entries.map { it.key to it.value.get() }.sortedByDescending { it.second }

    /** Forget all counts (tests). */
    fun reset() { counts.clear() }

    /** True when the n-th failure at a site is written to the log. */
    fun shouldReport(n: Long): Boolean = n <= FIRST_N || n % EVERY_N == 0L

    /** Record a swallowed exception at [site] (a short stable name such as "ApkUpdater.cleanStale"). */
    fun note(site: String, error: Throwable) {
        val n = counts.getOrPut(site) { AtomicLong() }.incrementAndGet()
        if (!shouldReport(n)) return
        if (reporting.get() == true) return
        reporting.set(true)
        try {
            val detail = "${error.javaClass.simpleName}: ${error.message ?: "no message"}"
            sink(site, if (n > FIRST_N) "$detail (failure #$n)" else detail)
        } catch (_: Throwable) {
            // The reporter must never throw into the code that was already handling a failure.
        } finally {
            reporting.set(false)
        }
    }

    /** Run [block]; if it throws an Exception, record it and return [fallback]. */
    inline fun <T> orElse(site: String, fallback: T, block: () -> T): T =
        try { block() } catch (e: Exception) { note(site, e); fallback }

    /** Run [block]; if it throws an Exception, record it. */
    inline fun attempt(site: String, block: () -> Unit) {
        try { block() } catch (e: Exception) { note(site, e) }
    }
}

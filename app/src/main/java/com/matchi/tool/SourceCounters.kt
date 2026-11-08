package com.matchi.tool

import java.util.concurrent.atomic.AtomicLong

/**
 * Per-source line counters for the viewer. Pure Kotlin (no Android classes), thread-safe, unit tested.
 *
 *  seen      raw lines read from the source
 *  passed    lines that were recorded in the log
 *  collapsed lines hidden because the same line repeated within a window (a summary line says how many)
 *  dropped   lines removed by the noise filters, or that could not be parsed
 *  gaps      times the source stopped by itself and had to be restarted (lines may be missing there)
 *
 * The in-app capture still filters before it records. The boot script never does (it keeps everything), so its
 * numbers come from the files themselves and are shown beside these.
 */
class SourceCounters {
    private val seenN = AtomicLong(); private val passedN = AtomicLong(); private val collapsedN = AtomicLong()
    private val droppedN = AtomicLong(); private val gapsN = AtomicLong()

    data class Snapshot(val seen: Long, val passed: Long, val collapsed: Long, val dropped: Long, val gaps: Long) {
        /** Lines read but not accounted for yet (in flight) or lost by a queue overflow elsewhere. */
        val unaccounted: Long get() = (seen - passed - collapsed - dropped).coerceAtLeast(0L)
    }

    fun seen(n: Long = 1) { seenN.addAndGet(n) }
    fun passed(n: Long = 1) { passedN.addAndGet(n) }
    fun collapsed(n: Long = 1) { collapsedN.addAndGet(n) }
    fun dropped(n: Long = 1) { droppedN.addAndGet(n) }
    fun gap() { gapsN.incrementAndGet() }
    fun reset() { seenN.set(0); passedN.set(0); collapsedN.set(0); droppedN.set(0); gapsN.set(0) }
    fun snapshot() = Snapshot(seenN.get(), passedN.get(), collapsedN.get(), droppedN.get(), gapsN.get())
}

/** The three in-app sources. A new logging session starts them from zero. */
object SourceStats {
    val app = SourceCounters()       // this app's own process log
    val device = SourceCounters()    // whole-device logcat through root
    val kernel = SourceCounters()    // dmesg through root
    /** Lines refused because the bounded write queue was full (all sources together). */
    val queueDropped = java.util.concurrent.atomic.AtomicLong()

    fun all(): Map<String, SourceCounters.Snapshot> =
        linkedMapOf("app" to app.snapshot(), "device" to device.snapshot(), "kernel" to kernel.snapshot())

    fun reset() { app.reset(); device.reset(); kernel.reset(); queueDropped.set(0) }
}

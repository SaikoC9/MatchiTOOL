package com.matchi.tool

/**
 * Screen settings (scale, quality) are shared by all viewers of the screen. Without a rule, two browsers with different
 * settings flip them on every request and force a re-encode each time. The first viewer owns the settings while it keeps
 * asking; another viewer gets frames at the owner's settings until the owner has been silent for [IDLE_MS].
 */
internal class ViewerLock(private val idleMs: Long = IDLE_MS) {
    private var owner: String? = null
    private var seenAt = 0L

    /** True when [viewer] may change the settings now (it is, or becomes, the owner). */
    @Synchronized fun mayChange(viewer: String, now: Long): Boolean {
        val o = owner
        if (o == null || o == viewer || now - seenAt > idleMs) { owner = viewer; seenAt = now; return true }
        return false
    }

    companion object { const val IDLE_MS = 10_000L }
}

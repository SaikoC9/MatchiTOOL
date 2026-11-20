package com.matchi.tool

/** What the watcher must do after one look at the router. */
enum class WifiAutoAction {
    NONE,
    /**
     * The router web API cannot be read (no 192.168.0.1) while the link is IDLE and we hold the state file: start the hotspot by root
     * first, then restore the stock config through the router API. The state file is deleted only when that worked.
     */
    RESCUE,
    /** Turn Wi-Fi off (the state file must exist first, so the change can always be undone). */
    TURN_OFF,
    /** Turn Wi-Fi on, then delete the state file. */
    TURN_ON,
    /** Delete the state file only; Wi-Fi is left as it is. */
    DROP_STATE,
}

/**
 * The whole decision logic of "Wi-Fi off while USB tethering is on". Pure Kotlin: no shell, no clock of its own (the caller passes the time),
 * so every rule is unit tested with made-up times.
 *
 * "State file" = [holdsState]: it exists when WE turned Wi-Fi off. It is what makes a later turn-on ours to do.
 *
 *  - Tethering active for [ACTIVE_DEBOUNCE_MS] in a row and Wi-Fi on: turn it off (the caller writes the state file first). This is long on
 *    purpose: with the PC stuck the link flips ACTIVE/IDLE every few seconds, and turning Wi-Fi off on a short ACTIVE streak can leave
 *    the router with neither Wi-Fi nor a working USB link. Any IDLE or unreadable look restarts the count.
 *  - Tethering not active for [IDLE_DEBOUNCE_MS] in a row and we hold the state file: turn Wi-Fi on and delete the file (kept short: getting
 *    Wi-Fi back is the safe direction).
 *  - Wi-Fi was already off before tethering started: no state file, so it is never turned on by us.
 *  - After a boot nothing is decided as "tethering is gone" for [BOOT_WAIT_MS]; the state file stays as it is.
 *  - Wi-Fi turned on by hand while tethered (after we had seen it off): left on, state file dropped, and not turned off again
 *    until tethering has been gone once.
 *  - Switch off while we hold the state file: Wi-Fi is turned back on first.
 *  - An unreadable link or Wi-Fi state never changes anything.
 *
 * After a boot the router's own Wi-Fi may come up by itself while the state file still exists. That is not a manual turn-on: a manual
 * turn-on only counts when this run had already seen Wi-Fi off while holding the file, and a reading taken during the first
 * [BOOT_WAIT_MS] after boot does not count (Wi-Fi is still down then, so "off, then on" there is the router starting, not the user).
 */
class WifiAutoRules {
    companion object {
        /** Wi-Fi goes off only after the link has been ACTIVE this long without a break. */
        const val ACTIVE_DEBOUNCE_MS = 15_000L
        /** Wi-Fi comes back after the link has been IDLE this long without a break. */
        const val IDLE_DEBOUNCE_MS = 5_000L
        const val BOOT_WAIT_MS = 45_000L
        /** After a successful change the Wi-Fi read-back may lag; readings are ignored for this long. */
        const val SETTLE_MS = 15_000L
        /** After a failed change nothing is tried again for this long. */
        const val RETRY_MS = 30_000L
        /** The router must stay unreadable this long (link IDLE, state file held, after the boot wait) before the root fallback runs. */
        const val UNREADABLE_MS = 20_000L
        /** The root fallback is tried at most this often until a normal turn-on works (each try restarts the hotspot). */
        const val MAX_RESCUES = 3
        /**
         * Turn-on cycles (3 tries each) that may fail while the router is still READABLE before the root fallback runs anyway. Seen 2026-11-20 after
         * a long tether: reads worked, every turn-on was sent and never took effect, and nothing else ever tried.
         */
        const val TURN_ON_FAILS_BEFORE_RESCUE = 2
    }

    private var activeSince: Long? = null
    private var idleSince: Long? = null
    private var offSeen = false        // this run has seen Wi-Fi off while holding the state file
    private var userOverride = false   // the user turned Wi-Fi on while tethered: do not turn it off again until tethering has been gone
    private var pausedUntil = 0L
    private var unreadableSince: Long? = null
    private var rescues = 0
    private var turnOnFails = 0        // failed turn-on cycles in a row (reset by a success)
    private var retryUntil = 0L        // set only by a FAILED change; the switch-off path waits for it too (it ignores the 15 s settle pause on purpose)

    private fun resetCounters() { activeSince = null; idleSince = null; unreadableSince = null }

    /**
     * [nowMs]: any steadily increasing clock. [sinceBootMs]: time since the router booted. [wifiOn]: null = could not be read.
     * [holdsState]: the state file exists.
     */
    fun evaluate(nowMs: Long, sinceBootMs: Long, enabled: Boolean, link: TetherLink, wifiOn: Boolean?, holdsState: Boolean): WifiAutoAction {
        if (!enabled) {
            resetCounters(); offSeen = false; userOverride = false
            if (nowMs < retryUntil) return WifiAutoAction.NONE   // a failed turn-on is not hammered every poll
            return when {
                !holdsState -> WifiAutoAction.NONE
                wifiOn == true -> WifiAutoAction.DROP_STATE
                else -> WifiAutoAction.TURN_ON
            }
        }
        if (nowMs < pausedUntil) { resetCounters(); return WifiAutoAction.NONE }
        // Not during the boot wait: the router's own Wi-Fi is still down then and comes up by itself, which must not look like a manual turn-on.
        if (holdsState && wifiOn == false && sinceBootMs >= BOOT_WAIT_MS) offSeen = true
        if (!holdsState) offSeen = false
        // Router API unreadable while the USB link is gone and we hold the file (seen after a boot with the data link out): wait, then fall back to root.
        if (link == TetherLink.IDLE && wifiOn == null && holdsState && sinceBootMs >= BOOT_WAIT_MS) {
            activeSince = null; idleSince = null
            val since = unreadableSince ?: nowMs.also { unreadableSince = it }
            return if (nowMs - since >= UNREADABLE_MS && rescues < MAX_RESCUES) WifiAutoAction.RESCUE else WifiAutoAction.NONE
        }
        if (link == TetherLink.UNKNOWN || wifiOn == null) { resetCounters(); return WifiAutoAction.NONE }
        unreadableSince = null

        if (link == TetherLink.ACTIVE) {
            idleSince = null
            val since = activeSince ?: nowMs.also { activeSince = it }
            if (nowMs - since < ACTIVE_DEBOUNCE_MS) return WifiAutoAction.NONE
            if (!wifiOn || userOverride) return WifiAutoAction.NONE
            if (!holdsState || !offSeen) return WifiAutoAction.TURN_OFF
            userOverride = true
            return WifiAutoAction.DROP_STATE
        }

        // IDLE
        activeSince = null
        if (sinceBootMs < BOOT_WAIT_MS) { idleSince = null; return WifiAutoAction.NONE }
        val since = idleSince ?: nowMs.also { idleSince = it }
        if (nowMs - since < IDLE_DEBOUNCE_MS) return WifiAutoAction.NONE
        userOverride = false
        if (!holdsState) return WifiAutoAction.NONE
        if (wifiOn) return WifiAutoAction.DROP_STATE
        // Router readable but turning Wi-Fi on keeps failing: stop repeating the same call, start the hotspot by root.
        return if (turnOnFails >= TURN_ON_FAILS_BEFORE_RESCUE && rescues < MAX_RESCUES) WifiAutoAction.RESCUE else WifiAutoAction.TURN_ON
    }

    /** The caller reports what happened to the action it ran. */
    fun result(action: WifiAutoAction, ok: Boolean, nowMs: Long) {
        resetCounters()
        if (action == WifiAutoAction.NONE) return
        if (action == WifiAutoAction.RESCUE) rescues++
        if (action == WifiAutoAction.TURN_ON) turnOnFails = if (ok) 0 else turnOnFails + 1
        pausedUntil = nowMs + if (ok) SETTLE_MS else RETRY_MS
        if (!ok) { retryUntil = pausedUntil; return }
        retryUntil = 0L
        when (action) {
            WifiAutoAction.TURN_OFF -> offSeen = true
            WifiAutoAction.TURN_ON -> { offSeen = false; rescues = 0 }
            WifiAutoAction.RESCUE -> { offSeen = false; rescues = 0; turnOnFails = 0 }
            WifiAutoAction.DROP_STATE -> offSeen = false
            WifiAutoAction.NONE -> {}
        }
    }
}

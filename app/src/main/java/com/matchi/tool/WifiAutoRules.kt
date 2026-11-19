package com.matchi.tool

/** What the watcher must do after one look at the router. */
enum class WifiAutoAction {
    NONE,
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
 *  - Tethering active for [DEBOUNCE_MS] in a row and Wi-Fi on: turn it off (the caller writes the state file first).
 *  - Tethering not active for [DEBOUNCE_MS] in a row and we hold the state file: turn Wi-Fi on and delete the file.
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
        const val DEBOUNCE_MS = 5_000L
        const val BOOT_WAIT_MS = 45_000L
        /** After a successful change the Wi-Fi read-back may lag; readings are ignored for this long. */
        const val SETTLE_MS = 15_000L
        /** After a failed change nothing is tried again for this long. */
        const val RETRY_MS = 30_000L
    }

    private var activeSince: Long? = null
    private var idleSince: Long? = null
    private var offSeen = false        // this run has seen Wi-Fi off while holding the state file
    private var userOverride = false   // the user turned Wi-Fi on while tethered: do not turn it off again until tethering has been gone
    private var pausedUntil = 0L
    private var retryUntil = 0L        // set only by a FAILED change; the switch-off path waits for it too (it ignores the 15 s settle pause on purpose)

    private fun resetCounters() { activeSince = null; idleSince = null }

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
        if (link == TetherLink.UNKNOWN || wifiOn == null) { resetCounters(); return WifiAutoAction.NONE }

        if (link == TetherLink.ACTIVE) {
            idleSince = null
            val since = activeSince ?: nowMs.also { activeSince = it }
            if (nowMs - since < DEBOUNCE_MS) return WifiAutoAction.NONE
            if (!wifiOn || userOverride) return WifiAutoAction.NONE
            if (!holdsState || !offSeen) return WifiAutoAction.TURN_OFF
            userOverride = true
            return WifiAutoAction.DROP_STATE
        }

        // IDLE
        activeSince = null
        if (sinceBootMs < BOOT_WAIT_MS) { idleSince = null; return WifiAutoAction.NONE }
        val since = idleSince ?: nowMs.also { idleSince = it }
        if (nowMs - since < DEBOUNCE_MS) return WifiAutoAction.NONE
        userOverride = false
        if (!holdsState) return WifiAutoAction.NONE
        return if (wifiOn) WifiAutoAction.DROP_STATE else WifiAutoAction.TURN_ON
    }

    /** The caller reports what happened to the action it ran. */
    fun result(action: WifiAutoAction, ok: Boolean, nowMs: Long) {
        resetCounters()
        if (action == WifiAutoAction.NONE) return
        pausedUntil = nowMs + if (ok) SETTLE_MS else RETRY_MS
        if (!ok) { retryUntil = pausedUntil; return }
        retryUntil = 0L
        when (action) {
            WifiAutoAction.TURN_OFF -> offSeen = true
            WifiAutoAction.TURN_ON, WifiAutoAction.DROP_STATE -> offSeen = false
            WifiAutoAction.NONE -> {}
        }
    }
}

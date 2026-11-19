package com.matchi.tool

/**
 * The one status line under the switch in the Network window (Wi-Fi tab). Pure Kotlin, so every wording is unit tested.
 * The words are the ones the Wi-Fi tab shows as they are.
 *
 * [problem]: a reason the feature cannot work right now, written by the real port (for example "both bands are on").
 * [link] / [wifiOn] / [holdsState] are what the last look at the router saw; null = no look yet or it could not be read.
 */
object WifiAutoStatus {
    const val OFF = "Off"
    const val NEEDS_PASSWORD = "Save the router password first (the router calls cannot sign in without it)"
    const val STARTING = "Starting…"
    const val UNREADABLE = "Cannot read the router right now, nothing is changed"
    const val WATCHING = "Watching: no USB tethering"
    const val RESTORING = "Off: turning Wi-Fi back on"
    const val WAITING_BOOT = "Waiting after boot (Wi-Fi stays off while tethering may still come up)"
    const val TETHER_WIFI_OFF = "USB tethering active, Wi-Fi off by us"
    const val TETHER_WIFI_ON = "USB tethering active, Wi-Fi on"
    const val TETHER_WIFI_WAS_OFF = "USB tethering active, Wi-Fi was already off (left alone)"
    const val TETHER_GONE = "USB tethering gone, turning Wi-Fi back on"

    fun line(
        enabled: Boolean,
        passwordSaved: Boolean,
        link: TetherLink?,
        wifiOn: Boolean?,
        holdsState: Boolean,
        sinceBootMs: Long,
        problem: String?,
    ): String {
        if (!enabled) return if (holdsState) RESTORING else OFF
        if (!passwordSaved) return NEEDS_PASSWORD
        if (!problem.isNullOrBlank()) return problem
        if (link == null) return STARTING
        if (link == TetherLink.UNKNOWN || wifiOn == null) return UNREADABLE
        if (link == TetherLink.ACTIVE) return when {
            holdsState -> TETHER_WIFI_OFF
            wifiOn -> TETHER_WIFI_ON
            else -> TETHER_WIFI_WAS_OFF
        }
        // IDLE
        if (!holdsState) return WATCHING
        return if (sinceBootMs < WifiAutoRules.BOOT_WAIT_MS) WAITING_BOOT else TETHER_GONE
    }
}

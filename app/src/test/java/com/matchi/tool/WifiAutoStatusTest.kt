package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Test

class WifiAutoStatusTest {
    private val late = WifiAutoRules.BOOT_WAIT_MS + 1
    private fun line(
        enabled: Boolean = true, pw: Boolean = true, link: TetherLink? = TetherLink.IDLE, wifi: Boolean? = true,
        holds: Boolean = false, boot: Long = late, problem: String? = null,
    ) = WifiAutoStatus.line(enabled, pw, link, wifi, holds, boot, problem)

    @Test fun switchOffIsOff() = assertEquals(WifiAutoStatus.OFF, line(enabled = false))
    @Test fun switchOffWithStateFileSaysItIsRestoring() = assertEquals(WifiAutoStatus.RESTORING, line(enabled = false, holds = true))
    @Test fun switchOffBeatsAMissingPassword() = assertEquals(WifiAutoStatus.OFF, line(enabled = false, pw = false))
    @Test fun missingPasswordIsNamed() = assertEquals(WifiAutoStatus.NEEDS_PASSWORD, line(pw = false))
    @Test fun problemIsShown() = assertEquals("both bands are on", line(problem = "both bands are on"))
    @Test fun blankProblemIsIgnored() = assertEquals(WifiAutoStatus.WATCHING, line(problem = "  "))
    @Test fun noLookYetIsStarting() = assertEquals(WifiAutoStatus.STARTING, line(link = null, wifi = null))
    @Test fun unknownLinkIsUnreadable() = assertEquals(WifiAutoStatus.UNREADABLE, line(link = TetherLink.UNKNOWN))
    @Test fun unreadableWifiIsUnreadable() = assertEquals(WifiAutoStatus.UNREADABLE, line(wifi = null))
    @Test fun idleWithoutFileIsWatching() = assertEquals(WifiAutoStatus.WATCHING, line())
    @Test fun activeWithFileIsOffByUs() = assertEquals(WifiAutoStatus.TETHER_WIFI_OFF, line(link = TetherLink.ACTIVE, wifi = false, holds = true))
    @Test fun activeWifiOnWithoutFile() = assertEquals(WifiAutoStatus.TETHER_WIFI_ON, line(link = TetherLink.ACTIVE, wifi = true))
    @Test fun activeWifiAlreadyOffWithoutFile() = assertEquals(WifiAutoStatus.TETHER_WIFI_WAS_OFF, line(link = TetherLink.ACTIVE, wifi = false))
    @Test fun idleWithFileRightAfterBootWaits() = assertEquals(WifiAutoStatus.WAITING_BOOT, line(wifi = false, holds = true, boot = 10_000))
    @Test fun idleWithFileAfterTheWaitIsTurningOn() = assertEquals(WifiAutoStatus.TETHER_GONE, line(wifi = false, holds = true))
    @Test fun idleWithoutFileRightAfterBootIsJustWatching() = assertEquals(WifiAutoStatus.WATCHING, line(boot = 10_000))
}

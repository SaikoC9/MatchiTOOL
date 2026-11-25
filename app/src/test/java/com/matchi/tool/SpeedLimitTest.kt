package com.matchi.tool

import com.matchi.tool.SpeedLimit.Entry
import com.matchi.tool.SpeedLimit.Limit
import com.matchi.tool.SpeedLimit.Live
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SpeedLimitTest {
    private val macA = "96:d1:33:9a:2d:46"   // 192.168.0.167 on the F50 test
    private val macB = "5c:4d:bf:88:9c:78"   // 192.168.0.4

    private fun live(
        down: Map<Int, Int> = emptyMap(), up: Map<Int, Int>? = emptyMap(), neigh: Map<String, String> = emptyMap(),
        lanUp: Boolean = true, busy: Boolean = false, ifs: List<String> = listOf("wlan0", "usb0")
    ) = Live(down, if (up == null) emptyMap() else ifs.associateWith { up }, neigh, lanUp, busy)

    // ---- validation ----
    @Test fun macIsNormalizedAndChecked() {
        assertEquals("96:d1:33:9a:2d:46", SpeedLimit.normalizeMac(" 96-D1-33-9A-2D-46 "))
        assertNull(SpeedLimit.normalizeMac("96:d1:33:9a:2d"))
        assertNull(SpeedLimit.normalizeMac("zz:d1:33:9a:2d:46"))
        assertNull(SpeedLimit.normalizeMac("ff:ff:ff:ff:ff:ff"))   // group address
        assertNull(SpeedLimit.normalizeMac("01:00:5e:00:00:01"))   // multicast
        assertNull(SpeedLimit.normalizeMac("00:00:00:00:00:00"))
        assertNull(SpeedLimit.normalizeMac(null))
    }

    @Test fun onlyLanClientAddressesAreAccepted() {
        assertEquals(167, SpeedLimit.octetOf("192.168.0.167"))
        assertEquals(2, SpeedLimit.octetOf("192.168.0.2"))
        assertEquals(254, SpeedLimit.octetOf("192.168.0.254"))
        assertNull(SpeedLimit.octetOf("192.168.0.1"))      // the router itself
        assertNull(SpeedLimit.octetOf("192.168.0.0"))
        assertNull(SpeedLimit.octetOf("192.168.0.255"))
        assertNull(SpeedLimit.octetOf("192.168.0.256"))
        assertNull(SpeedLimit.octetOf("192.168.0.07"))     // not the plain form
        assertNull(SpeedLimit.octetOf("192.168.1.5"))
        assertNull(SpeedLimit.octetOf("192.168.0.5; reboot"))
        assertNull(SpeedLimit.octetOf(null))
    }

    @Test fun limitsAreRangeChecked() {
        assertNull(SpeedLimit.limitError(null, null))
        assertNull(SpeedLimit.limitError(8, 125_000))
        assertNotNull(SpeedLimit.limitError(7, null))
        assertNotNull(SpeedLimit.limitError(null, 125_001))
        assertNotNull(SpeedLimit.limitError(0, null))
        assertNotNull(SpeedLimit.limitError(-5, null))
    }

    @Test fun priorityClassAndBurstFollowTheAddress() {
        assertEquals(1167, SpeedLimit.prefOf(167))
        assertEquals("1a7", SpeedLimit.minorOf(167))
        assertEquals("102", SpeedLimit.minorOf(2))
        assertEquals("1fe", SpeedLimit.minorOf(254))
        assertEquals(20, SpeedLimit.burstKb(125))        // the 1 Mbit case tested on the F50
        assertEquals(20, SpeedLimit.burstKb(400))
        assertEquals(5000, SpeedLimit.burstKb(100_000))
    }

    // ---- scripts ----
    private fun allScripts(): List<String> = listOf(
        SpeedLimit.applyScript("192.168.0.167", Limit(500, 250))!!,
        SpeedLimit.applyScript("192.168.0.167", Limit(500, 250), "aa:bb:cc:dd:ee:04")!!,
        SpeedLimit.applyScript("192.168.0.4", Limit(null, 90))!!,
        SpeedLimit.applyScript("192.168.0.254", Limit(125_000, null))!!,
        SpeedLimit.applyScript("192.168.0.2", Limit(null, null))!!,
        SpeedLimit.removeScript(listOf(2, 4, 167, 254)),
        SpeedLimit.READ_SCRIPT
    )

    @Test fun applyScriptBuildsDownloadAndUploadRules() {
        val s = SpeedLimit.applyScript("192.168.0.167", Limit(500, 250))!!
        assertTrue(s.contains("tc class replace dev br0 parent 1: classid 1:1a7 htb rate 500kbps ceil 500kbps"))
        assertTrue(s.contains("tc filter add dev br0 parent 1: protocol ip prio 1167 u32 match ip dst 192.168.0.167/32 flowid 1:1a7"))
        for (i in listOf("wlan0", "usb0")) {
            assertTrue(s.contains("tc filter add dev $i parent ffff: protocol ip prio 1167 u32 match ip src 192.168.0.167/32 action police rate 250kbps burst 20k drop"))
            assertTrue(s.contains("[ -d /sys/class/net/$i ]"))
        }
        assertTrue(s.contains("tc qdisc replace dev br0 root handle 1: htb default 10"))
        assertTrue(s.contains("MATCHI_ROOT_BUSY"))
        assertTrue(s.contains("MATCHI_OK"))
    }

    @Test fun macGivesIpv6RulesOnTheirOwnPriority() {
        val s = SpeedLimit.applyScript("192.168.0.167", Limit(500, 250), "AA-BB-CC-DD-EE-02".replace("02", "04"))!!
        assertTrue(s.contains("protocol ipv6 prio 1467 u32 match u32 0xaabbccdd 0xffffffff at -14 match u16 0xee04 0xffff at -10 flowid 1:1a7"))
        for (i in listOf("wlan0", "usb0"))
            assertTrue(s.contains("tc filter add dev $i parent ffff: protocol ipv6 prio 1467 u32 match u32 0xaabbccdd 0xffffffff at -8 match u16 0xee04 0xffff at -4 action police rate 250kbps burst 20k drop"))
        assertTrue(SpeedLimit.removeScript(listOf(167)).contains("prio 1467"))
        assertFalse(SpeedLimit.applyScript("192.168.0.167", Limit(500, 250))!!.contains("ipv6"))
    }

    @Test fun uploadOnlyLeavesDownloadClearedAndRootAlone() {
        val s = SpeedLimit.applyScript("192.168.0.4", Limit(null, 90))!!
        assertFalse(s.contains("htb rate 90"))
        assertFalse(s.contains("tc qdisc replace"))          // no download limit: br0's root is not touched to set one up
        assertTrue(s.contains("tc class del dev br0 classid 1:104"))
        assertTrue(s.contains("police rate 90kbps"))
    }

    @Test fun downloadOnlyRemovesTheUploadRules() {
        val s = SpeedLimit.applyScript("192.168.0.254", Limit(125_000, null))!!
        assertTrue(s.contains("htb rate 125000kbps"))
        assertFalse(s.contains("police"))
        assertTrue(s.contains("tc filter del dev wlan0 parent ffff: prio 1254"))
        assertTrue(s.contains("tc filter del dev usb0 parent ffff: prio 1254"))
    }

    @Test fun invalidInputGivesNoScript() {
        assertNull(SpeedLimit.applyScript("192.168.0.1", Limit(100, 100)))
        assertNull(SpeedLimit.applyScript("192.168.0.9; id", Limit(100, 100)))
        assertNull(SpeedLimit.applyScript("192.168.0.9", Limit(3, 100)))
    }

    @Test fun removeScriptDropsOnlyOwnedRulesAndSkipsBadOctets() {
        val s = SpeedLimit.removeScript(listOf(167, 167, 1, 255, 300, -4))
        assertTrue(s.contains("prio 1167"))
        assertTrue(s.contains("classid 1:1a7"))
        assertFalse(s.contains("prio 1001"))
        assertFalse(s.contains("prio 1255"))
        assertEquals(1, Regex("tc class del dev br0").findAll(s).count())
    }

    @Test fun noScriptEverTouchesThePrioritiesOrQdiscsTheSystemOwns() {
        for (s in allScripts()) {
            assertFalse("prio 1 is the system TTL filter", Regex("prio 1(?![0-9])").containsMatchIn(s))
            assertFalse(Regex("pref 1(?![0-9])").containsMatchIn(s))
            assertFalse(s.contains("ttl"))
            assertFalse(s.contains("flush"))
            assertFalse(s.contains("qdisc del dev wlan0"))
            assertFalse(s.contains("qdisc del dev usb0"))
            // every tc filter delete names a priority
            for (l in s.lines()) if (l.contains("tc filter del")) assertTrue(l, Regex("prio 1[0-9]{3}").containsMatchIn(l))
            // every priority used is in the owned range
            for (m in Regex("prio ([0-9]+)").findAll(s)) assertTrue(m.value, m.groupValues[1].toInt() in 1002..1254 || m.groupValues[1].toInt() in 1302..1554)
        }
    }

    @Test fun rootQdiscIsOnlyRemovedWhenItIsOurs() {
        val s = SpeedLimit.removeScript(listOf(167))
        assertTrue(s.contains("grep -q \"qdisc htb 1:\" && tc qdisc del dev br0 root"))
        assertTrue(s.contains("htb 1:1[0-9a-f][0-9a-f] "))
    }

    // ---- reading the phone ----
    // Lines copied from the F50 test (the class and filter lines use the numbers of the real runs, address .167).
    private val classes = listOf(
        "class htb 1:10 root prio 0 rate 1Gbit ceil 1Gbit burst 1375b cburst 1375b ",
        "class htb 1:1a7 parent 1: prio 0 rate 4Mbit ceil 4Mbit burst 1600b cburst 1600b ",
        "class htb 1:20 root prio 0 rate 1Mbit ceil 1Mbit burst 1600b cburst 1600b "
    )
    private val upWlan = listOf(
        "filter protocol all pref 1 bpf chain 0 ",
        "filter protocol all pref 1 bpf chain 0 handle 0x1 ttl_bpf:[*fsobj] direct-action not_in_hw id 33 tag e4ba332d7787af19 jited ",
        "filter protocol ip pref 1167 u32 chain 0 ",
        "filter protocol ip pref 1167 u32 chain 0 fh 800: ht divisor 1 ",
        "filter protocol ip pref 1167 u32 chain 0 fh 800::800 order 2048 key ht 800 bkt 0 terminal flowid ??? not_in_hw ",
        "  match c0a800a7/ffffffff at 12",
        "\taction order 1:  police 0x1 rate 1Mbit burst 20Kb mtu 2Kb action drop overhead 0b ",
        "\tref 1 bind 1 installed 40 sec used 0 sec"
    )
    private val upUsb = listOf(
        "filter protocol all pref 1 bpf chain 0 ",
        "filter protocol all pref 1 bpf chain 0 handle 0x1 ttl_bpf:[*fsobj] direct-action not_in_hw id 33 tag e4ba332d7787af19 jited "
    )
    private val neighText = listOf(
        "192.168.0.167 dev br0 lladdr 96:d1:33:9a:2d:46 REACHABLE",
        "192.168.0.4 dev br0 lladdr 5c:4d:bf:88:9c:78 REACHABLE",
        "2405:8d40:4072:8e5:b846:f7ff:fe01:73e4 dev br0 lladdr ba:46:f7:01:73:e4 STALE",
        "2405:8d40:4072:8e5:855e:dade:ca55:81ec dev br0  FAILED",
        "fe80::b846:f7ff:fe01:73e4 dev br0 lladdr ba:46:f7:01:73:e4 STALE"
    )
    private fun output(root: String = "qdisc noqueue 0: dev br0 root refcnt 2 ") =
        (listOf("--- classes") + classes + "--- up wlan0" + upWlan + "--- up usb0" + upUsb + "--- neigh" + neighText + "--- root" + root)
            .joinToString("\n")

    @Test fun parseLiveReadsClassesFiltersAndNeighbours() {
        val l = SpeedLimit.parseLive(output())
        assertEquals(mapOf(167 to 500), l.down)                 // 4 Mbit = 500 KB/s; 1:10 and 1:20 are not ours
        assertEquals(setOf("wlan0", "usb0"), l.up.keys)
        assertEquals(mapOf(167 to 125), l.up["wlan0"])           // 1 Mbit = 125 KB/s; the system pref 1 filter is ignored
        assertEquals(emptyMap<Int, Int>(), l.up["usb0"])
        assertEquals(mapOf(macA to "192.168.0.167", macB to "192.168.0.4"), l.neigh)   // IPv6 and FAILED lines are not used
        assertTrue(l.lanUp)
        assertFalse(l.rootBusy)
    }

    @Test fun rateUnitsConvertToKilobytesPerSecond() {
        assertEquals(125, SpeedLimit.toKbps("1", "M"))
        assertEquals(8, SpeedLimit.toKbps("64", "K"))
        assertEquals(800, SpeedLimit.toKbps("6400", "K"))
        assertEquals(125_000, SpeedLimit.toKbps("1", "G"))
        assertNull(SpeedLimit.toKbps("x", "M"))
    }

    @Test fun rootBusyAndLanDownAreDetected() {
        assertTrue(SpeedLimit.parseLive(output("qdisc mq 0: dev br0 root")).rootBusy)
        assertFalse(SpeedLimit.parseLive(output("qdisc htb 1: dev br0 root refcnt 2 r2q 10 default 10")).rootBusy)
        val none = SpeedLimit.parseLive("--- classes\n--- neigh\n--- root\n")
        assertFalse(none.lanUp)
        assertFalse(none.rootBusy)
    }

    @Test fun neighbourLinesFromTheFilteredCommandAreRead() {
        // Real F50 output of `ip neigh show dev br0`: no "dev br0" in the line.
        val l = SpeedLimit.parseLive("--- neigh\n" +
            "192.168.0.167 lladdr 96:d1:33:9a:2d:46 REACHABLE\n" +
            "192.168.0.4 lladdr 5c:4d:bf:88:9c:78 REACHABLE\n" +
            "2405:8d40:4072:8e5:b846:f7ff:fe01:73e4 lladdr ba:46:f7:01:73:e4 STALE\n" +
            "2405:8d40:4072:8e5:855e:dade:ca55:81ec  FAILED\n" +
            "192.168.0.9 dev wlan0 lladdr aa:bb:cc:dd:ee:02 REACHABLE\n--- root\nqdisc noqueue 0: dev br0 root")
        assertEquals(mapOf(macA to "192.168.0.167", macB to "192.168.0.4"), l.neigh)   // another dev is not used
    }

    @Test fun neighbourTableIsReadCarefully() {
        val newer = SpeedLimit.parseLive("--- neigh\n" +
            "192.168.0.50 dev br0 lladdr 96:d1:33:9a:2d:46 STALE\n" +
            "192.168.0.167 dev br0 lladdr 96:d1:33:9a:2d:46 REACHABLE\n--- root\nqdisc noqueue 0: dev br0 root")
        assertEquals("192.168.0.167", newer.neigh[macA])                       // the better state wins
        val twoStale = SpeedLimit.parseLive("--- neigh\n" +
            "192.168.0.50 dev br0 lladdr 96:d1:33:9a:2d:46 STALE\n" +
            "192.168.0.51 dev br0 lladdr 96:d1:33:9a:2d:46 STALE\n--- root\nqdisc noqueue 0: dev br0 root")
        assertNull(twoStale.neigh[macA])                                       // cannot tell which: no guess
        val clash = SpeedLimit.parseLive("--- neigh\n" +
            "192.168.0.60 dev br0 lladdr 96:d1:33:9a:2d:46 REACHABLE\n" +
            "192.168.0.60 dev br0 lladdr 5c:4d:bf:88:9c:78 REACHABLE\n--- root\nqdisc noqueue 0: dev br0 root")
        assertTrue(clash.neigh.isEmpty())                                      // one address, two devices: neither is limited
    }

    @Test fun matchesAllowsForRoundingAndNeedsEveryInterface() {
        val want = Limit(500, 125)
        assertTrue(SpeedLimit.matches(want, live(down = mapOf(167 to 500), up = mapOf(167 to 125)), 167))
        assertTrue(SpeedLimit.matches(want, live(down = mapOf(167 to 510), up = mapOf(167 to 124)), 167))   // tc rounds
        assertFalse(SpeedLimit.matches(want, live(down = mapOf(167 to 800), up = mapOf(167 to 125)), 167))
        assertFalse(SpeedLimit.matches(want, live(down = mapOf(167 to 500), up = emptyMap()), 167))          // upload rule missing
        assertFalse(SpeedLimit.matches(want, live(down = emptyMap(), up = mapOf(167 to 125)), 167))          // class missing
        assertTrue(SpeedLimit.matches(Limit(null, 125), live(up = mapOf(167 to 125)), 167))
        assertFalse(SpeedLimit.matches(Limit(null, 125), live(down = mapOf(167 to 500), up = mapOf(167 to 125)), 167))   // an unwanted rule is left over
        val onlyWlan = Live(mapOf(167 to 500), mapOf("wlan0" to mapOf(167 to 125), "usb0" to emptyMap()), emptyMap(), true, false)
        assertFalse(SpeedLimit.matches(want, onlyWlan, 167))                                                 // usb0 lacks it
    }

    // ---- plan ----
    private val limitA = Limit(500, 125)
    private fun stored(ip: String? = "192.168.0.167") = listOf(Entry(macA, limitA, ip))
    private val here = mapOf(macA to "192.168.0.167")

    @Test fun nothingToDoWhenRulesAreInPlace() {
        val p = SpeedLimit.plan(stored(), live(down = mapOf(167 to 500), up = mapOf(167 to 125), neigh = here))
        assertTrue(p.apply.isEmpty())
        assertTrue(p.remove.isEmpty())
    }

    @Test fun missingRulesAreAppliedAgain() {
        val p = SpeedLimit.plan(stored(), live(neigh = here))
        assertEquals(listOf(SpeedLimit.Todo(macA, "192.168.0.167", limitA)), p.apply)
        assertTrue(p.remove.isEmpty())
    }

    @Test fun afterRebootTheLastAddressIsUsedWhileTheDeviceIsNotListed() {
        val p = SpeedLimit.plan(stored(), live())
        assertEquals(listOf(SpeedLimit.Todo(macA, "192.168.0.167", limitA)), p.apply)
    }

    @Test fun aDeviceThatMovedGetsTheNewAddressAndLosesTheOldRules() {
        val p = SpeedLimit.plan(stored("192.168.0.50"),
            live(down = mapOf(50 to 500), up = mapOf(50 to 125), neigh = mapOf(macA to "192.168.0.167")))
        assertEquals(listOf(SpeedLimit.Todo(macA, "192.168.0.167", limitA)), p.apply)
        assertEquals(listOf(50), p.remove)
    }

    @Test fun anotherDeviceOnTheOldAddressIsNotLimited() {
        // A is offline; B now has A's last address and has rules from the reboot catch-up: they go, and nothing is applied.
        val p = SpeedLimit.plan(stored(),
            live(down = mapOf(167 to 500), up = mapOf(167 to 125), neigh = mapOf(macB to "192.168.0.167")))
        assertTrue(p.apply.isEmpty())
        assertEquals(listOf(167), p.remove)
    }

    @Test fun nothingHappensWhileBr0IsDownOrBusyOrNothingIsSaved() {
        assertEquals(SpeedLimit.Plan(emptyList(), emptyList()), SpeedLimit.plan(stored(), live(lanUp = false)))
        assertEquals(SpeedLimit.Plan(emptyList(), emptyList()), SpeedLimit.plan(stored(), live(busy = true, neigh = here)))
        assertEquals(SpeedLimit.Plan(emptyList(), emptyList()), SpeedLimit.plan(emptyList(), live(down = mapOf(167 to 500), neigh = here)))
    }

    @Test fun anEntryWithNoAddressAndNoNeighbourWaits() {
        val p = SpeedLimit.plan(stored(null), live())
        assertTrue(p.apply.isEmpty())
        assertTrue(p.remove.isEmpty())
    }

    // ---- saved form ----
    @Test fun savedFormRoundTrips() {
        val list = listOf(Entry(macA, Limit(500, null), "192.168.0.167"), Entry(macB, Limit(null, 90), null))
        val text = SpeedLimit.encode(list)
        assertEquals("96:d1:33:9a:2d:46=500||192.168.0.167,5c:4d:bf:88:9c:78=|90|", text)
        assertEquals(list, SpeedLimit.decode(text))
    }

    @Test fun savedFormDropsAnythingInvalid() {
        val text = "garbage,96:d1:33:9a:2d:46=500||192.168.0.167,5c:4d:bf:88:9c:78=|3|," +
            "ff:ff:ff:ff:ff:ff=100|100|,aa:bb:cc:dd:ee:02=||,aa:bb:cc:dd:ee:04=abc||,aa:bb:cc:dd:ee:06=100|100|10.0.0.5"
        val got = SpeedLimit.decode(text)
        assertEquals(listOf(macA, "aa:bb:cc:dd:ee:06"), got.map { it.mac })
        assertNull(got[1].ip)                                // an address outside the LAN is forgotten, the limit stays
        assertTrue(SpeedLimit.decode(null).isEmpty())
        assertTrue(SpeedLimit.decode("").isEmpty())
    }

    @Test fun upsertAndWithoutKeepOneEntryPerMac() {
        val a = Entry(macA, Limit(100, 100), null)
        val a2 = Entry(macA, Limit(200, null), "192.168.0.9")
        val b = Entry(macB, Limit(null, 50), null)
        assertEquals(listOf(b, a2), SpeedLimit.upsert(listOf(a, b), a2))
        assertEquals(listOf(a), SpeedLimit.without(listOf(a, b), macB))
    }
}

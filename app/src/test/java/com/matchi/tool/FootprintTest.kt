package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FootprintTest {
    @Test fun folderAndEverythingInsideIsRemoved() {
        assertEquals(Footprint.Class.REMOVE, Footprint.classify("/data/local/matchitool"))
        assertEquals(Footprint.Class.REMOVE, Footprint.classify("/data/local/matchitool/boot.d/10-cpu.sh"))
        assertEquals(Footprint.Class.REMOVE, Footprint.classify("/data/local/matchitool/reaper/matchi_reaper.sh"))
    }

    @Test fun lookAlikesAndDangerousPathsAreNotRemoved() {
        for (p in listOf("/data/local", "/data/local/tmp", "/data", "/sdcard", "/data/adb", "/data/adb/service.d",
            "/data/local/matchitool2", "/data/local/matchitool/../x", "/data/local/matchitool//x", "data/local/matchitool", "/data/local/tmp/x"))
            assertEquals(p, Footprint.Class.UNKNOWN, Footprint.classify(p))
    }

    @Test fun bootStubsAndLegacyTmpAreRemovedByExactName() {
        for (p in Footprint.BOOT_STUBS + Footprint.LEGACY_TMP) assertEquals(p, Footprint.Class.REMOVE, Footprint.classify(p))
        assertEquals(Footprint.Class.UNKNOWN, Footprint.classify("/data/adb/service.d/other.sh"))
        assertEquals(Footprint.Class.UNKNOWN, Footprint.classify("/data/local/tmp/.matchi_out_x"))
    }

    @Test fun reaperLogIsRemovedButItsLookAlikeIsNot() {
        assertEquals(Footprint.Class.REMOVE, Footprint.classify(Footprint.REAPER_LOG))
        assertEquals(Footprint.Class.UNKNOWN, Footprint.classify("/data/local/matchitool-uninstall.log2"))
    }

    @Test fun adGuardHomeFolderIsRemovedButItsLookAlikeIsNot() {
        for (p in Footprint.PLUGIN_KNOWN_DIRS) assertEquals(p, Footprint.Class.REMOVE, Footprint.classify(p))
        assertEquals(Footprint.Class.REMOVE, Footprint.classify("/data/local/adguardhome/data/AdGuardHome.yaml"))
        assertEquals(Footprint.Class.UNKNOWN, Footprint.classify("/data/local/adguardhome2"))
        assertTrue(Footprint.PROCESS_NAMES.contains("AdGuardHome"))
    }

    @Test fun openWrtVmFolderIsRemovedButItsLookAlikeIsNot() {
        assertTrue(Footprint.PLUGIN_KNOWN_DIRS.contains(Footprint.OWRT_DIR))
        assertEquals(Footprint.Class.REMOVE, Footprint.classify("/data/local/matchi_owrt"))
        assertEquals(Footprint.Class.REMOVE, Footprint.classify("/data/local/matchi_owrt/rootfs.img"))
        assertEquals(Footprint.Class.REMOVE, Footprint.classify("/data/local/matchi_owrt/run/ip_forward"))
        assertEquals(Footprint.Class.UNKNOWN, Footprint.classify("/data/local/matchi_owrt2"))
        assertEquals(Footprint.Class.UNKNOWN, Footprint.classify("/data/local/matchi_owrt/../x"))
    }

    @Test fun openWrtNetworkNamesAreExactAndNeverBuiltIn() {
        val chains = Footprint.OWRT_FILTER_CHAINS + Footprint.OWRT_NAT_CHAINS
        for (c in chains) { assertTrue(c, c.startsWith("OWRT_")); assertFalse(c, c in listOf("INPUT", "OUTPUT", "FORWARD", "PREROUTING", "POSTROUTING")) }
        assertEquals(setOf("owrt-lan", "owrt-wan"), Footprint.OWRT_LINKS.toSet())
        assertEquals("192.168.88.2/24", Footprint.OWRT_BRIDGE_ADDR)
        assertTrue(5000 in Footprint.OWRT_RULE_PREFS && 5002 in Footprint.OWRT_RULE_PREFS && 4999 !in Footprint.OWRT_RULE_PREFS && 5003 !in Footprint.OWRT_RULE_PREFS)
    }

    @Test fun foreignBinariesAreLeft() {
        for (p in Footprint.NOT_OURS) assertEquals(p, Footprint.Class.LEAVE, Footprint.classify(p))
    }

    @Test fun matchesTheShippedBootLogd() {
        assertTrue(Footprint.BOOT_STUBS.contains(BootLogdModel.SCRIPT_PATH))
        assertEquals(BootLogdModel.BASE_DIR, Footprint.BASE_DIR)
        assertEquals(BootLogdModel.LOG_DIR + "/logd.pid", Footprint.LOGD_PID)
    }

    @Test fun lanInterfaceNamesMatchHostControl() {
        for (n in listOf("br0", "ap0", "swlan0", "usb0", "rndis0", "ecm0")) assertTrue(n, Footprint.isLanInterface(n))
        for (n in listOf("wlan0", "rmnet_data0", "lo", "eth0", "ccmni0")) assertFalse(n, Footprint.isLanInterface(n))
    }

    @Test fun tcPrioritiesMatchSpeedLimit() {
        assertTrue(Footprint.isOurTcPrio(1000)); assertTrue(Footprint.isOurTcPrio(1255))
        assertTrue(Footprint.isOurTcPrio(1300)); assertTrue(Footprint.isOurTcPrio(1555))
        for (p in listOf(1, 999, 1256, 1299, 1556)) assertFalse(p.toString(), Footprint.isOurTcPrio(p))
    }

    @Test fun processNamesAreExactAndNeverBroad() {
        for (n in Footprint.PROCESS_NAMES) { assertTrue(n, n.length >= 4 && Regex("[A-Za-z-]+").matches(n)); assertFalse(n, n == "matchi") }
    }
}

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
        for (n in Footprint.PROCESS_NAMES) { assertTrue(n, n.length >= 4 && Regex("[a-z-]+").matches(n)); assertFalse(n, n == "matchi") }
    }
}

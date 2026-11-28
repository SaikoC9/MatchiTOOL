package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ReaperSettingsTest {
    private val all = ReaperSettings.removed().flatMap { it.lines }.joinToString("\n")

    @Test fun listCoversEveryFootprintKind() {
        assertEquals(listOf("Start-up entries", "Firewall", "Speed limits", "Running programs", "Files"), ReaperSettings.removed().map { it.title })
        assertTrue(ReaperSettings.removed().all { it.lines.isNotEmpty() && it.lines.all { l -> l.isNotBlank() } })
    }

    @Test fun listIsBuiltFromTheRegistry() {
        assertTrue(all.contains(Footprint.BASE_DIR))
        assertTrue(all.contains(Footprint.CONSOLE_PORT.toString()))
        assertTrue(all.contains(Footprint.AGH_CHAIN))
        assertTrue(all.contains(Footprint.TC_DEVICE))
        for (b in Footprint.BOOT_STUBS) assertTrue(b, all.contains(b.substringAfterLast('/')))
        for (t in Footprint.LEGACY_TMP) assertTrue(t, all.contains(t.substringAfterLast('/')))
        for (p in Footprint.PROCESS_NAMES) assertTrue(p, all.contains(p))
        assertTrue(all.contains(Footprint.REAPER_LOG.substringAfterLast('/')))
        for (c in Footprint.OWRT_FILTER_CHAINS + Footprint.OWRT_NAT_CHAINS + Footprint.OWRT_LINKS) assertTrue(c, all.contains(c))
        assertTrue(all.contains(Footprint.OWRT_DIR.substringAfterLast('/')))
        assertTrue(all.contains("cloud-hypervisor"))
    }

    @Test fun listNeverPromisesWhatStaysBehind() {
        // D2 / D6: these are left on purpose, so they must not appear in the "removed" list
        for (w in listOf("IMEI", "USB mode", "adb", "router settings", "Wi-Fi")) assertTrue(w, !all.contains(w, ignoreCase = true))
    }

    @Test fun notRestoredNoteNamesEveryDecisionD2D6Item() {
        for (w in listOf("Wi-Fi", "LAN IP", "IMEI", "router settings", "USB mode", "adb")) assertTrue(w, ReaperSettings.NOT_RESTORED.contains(w))
    }

    @Test fun switchTextsSayWhatOnInstallsAndWhatOffMeans() {
        assertTrue(ReaperSettings.ON_TEXT.contains("root watcher") && ReaperSettings.ON_TEXT.contains("boot script"))
        assertTrue(ReaperSettings.OFF_TEXT.contains("BEFORE uninstalling") && ReaperSettings.OFF_TEXT.contains("stay"))
        assertTrue(ReaperSettings.PLUGIN_NOTE.contains("deleted without erasing"))
    }
}

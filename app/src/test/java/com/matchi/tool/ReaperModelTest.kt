package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ReaperModelTest {
    private val script = "#!/system/bin/sh\n# MATCHI_REAPER_VERSION=3\necho hi\n"

    @Test fun versionHeaderIsRead() {
        assertEquals(3, ReaperModel.scriptVersion(script))
        assertNull(ReaperModel.scriptVersion("#!/bin/sh\necho hi\n"))
        assertNull(ReaperModel.scriptVersion("#!/bin/sh\n# MATCHI_REAPER_VERSION=x\n"))
    }

    @Test fun reinstallRuleMatchesBootLogd() {
        assertTrue(ReaperModel.needsReinstall(null, 1))      // nothing installed
        assertTrue(ReaperModel.needsReinstall(1, 2))         // older
        assertFalse(ReaperModel.needsReinstall(2, 2))
        assertFalse(ReaperModel.needsReinstall(3, 2))        // never replace a newer copy with an older build
        assertFalse(ReaperModel.needsReinstall(null, null))  // shipped script unreadable: do nothing
    }

    @Test fun stubVersionMustEqualTheShippedOne() {
        assertTrue(ReaperModel.stubCurrent(ReaperModel.STUB_VERSION))
        assertFalse(ReaperModel.stubCurrent(null))
        assertFalse(ReaperModel.stubCurrent(ReaperModel.STUB_VERSION + 1))
    }

    @Test fun pathsAreAllCoveredByTheFootprint() {
        assertEquals(Footprint.Class.REMOVE, Footprint.classify(ReaperModel.SCRIPT_PATH))
        assertEquals(Footprint.Class.REMOVE, Footprint.classify(ReaperModel.PID_FILE))
        assertEquals(Footprint.Class.REMOVE, Footprint.classify(ReaperModel.UPDATING_MARKER))
        assertEquals(Footprint.Class.REMOVE, Footprint.classify(ReaperModel.STUB_PATH))
        assertTrue(Footprint.BOOT_STUBS.contains(ReaperModel.STUB_PATH))
        assertEquals("/data/local/matchitool/reaper/matchi_reaper.sh", ReaperModel.SCRIPT_PATH)
        assertEquals("/data/local/matchitool/updating", ReaperModel.UPDATING_MARKER)
    }

    @Test fun installCommandCarriesTheScriptOnceAndItsExactSize() {
        val cmd = ReaperModel.installCommand(script)!!
        assertEquals(1, Regex("# MATCHI_REAPER_VERSION=3").findAll(cmd).count())
        val body = script.trimEnd('\n')
        assertTrue(cmd.contains("= " + (body.toByteArray().size + 1) + " ]"))   // here-document adds the final newline
        assertFalse(cmd.contains('\u00a7'))
        assertFalse(cmd.contains(ReaperModel.SCRIPT_MARK))
        assertFalse(cmd.contains(ReaperModel.SIZE_MARK))
    }

    @Test fun installCommandRefusesUnusableScripts() {
        assertNull(ReaperModel.installCommand("echo no version header\n"))
        assertNull(ReaperModel.installCommand(script + "MATCHI_REAPER_EOF\nrm -rf /\n"))      // would end the here-document early
        assertNull(ReaperModel.installCommand(script + "MATCHI_STUB_EOF\nrm -rf /\n"))
    }

    @Test fun installWritesBeforeItReplacesAndStartsDetached() {
        val cmd = ReaperModel.installCommand(script)!!
        assertTrue(cmd.indexOf(".new\" <<'MATCHI_REAPER_EOF'") in 0 until cmd.indexOf("stopold\nmv "))   // check the new file first, stop the old copy second
        assertTrue(cmd.contains("setsid"))
        assertTrue(cmd.contains("nohup sh \"\$S\" watch </dev/null >/dev/null 2>&1 &"))
        assertTrue(cmd.contains("MATCHI_REAPER_STUB=${ReaperModel.STUB_VERSION}"))
    }

    @Test fun scriptsNeverUseBroadKillsOrWipes() {
        for (c in listOf(ReaperModel.installCommand(script)!!, ReaperModel.removeCommand(), ReaperModel.statusCommand())) {
            assertFalse(c, c.contains("pkill"))
            assertFalse(c, c.contains("killall"))
            assertFalse(c, c.contains("rm -rf /data/local/tmp"))
        }
        // OFF removes only the reaper's own folder and stub
        val rm = ReaperModel.removeCommand()
        assertTrue(rm.contains("rm -f \$STUB"))
        assertTrue(rm.contains("rm -rf \$D"))
        assertTrue(rm.contains("D=/data/local/matchitool/reaper"))
    }

    @Test fun updatingMarkerIsCreatedWithoutFollowingLinks() {
        val c = ReaperModel.updatingMarkerCommand()
        assertTrue(c.startsWith("rm -f ${ReaperModel.UPDATING_MARKER};"))
        assertTrue(c.contains("set -C"))
        assertTrue(c.contains("date +%s > ${ReaperModel.UPDATING_MARKER}"))
    }

    @Test fun statusIsParsed() {
        val s = ReaperModel.parseStatus("INSTALLED_SCRIPT=1\nINSTALLED_VERSION=2\nRUNNING=1\nSTUB=1\nSTUB_VERSION=1\n")
        assertEquals(ReaperModel.Status(true, 2, true, true, 1), s)
        assertEquals(ReaperModel.Status(false, null, false, false, null), ReaperModel.parseStatus("RUNNING=0\nSTUB=0\n"))
        assertEquals(ReaperModel.Status(false, null, false, false, null), ReaperModel.parseStatus(""))
    }
}

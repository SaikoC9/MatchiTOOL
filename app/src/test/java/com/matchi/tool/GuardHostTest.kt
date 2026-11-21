package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class GuardHostTest {
    private val dir = "/data/data/com.matchi.tool/files"

    @Test fun startScriptStartsOnlyWatchByFullPathWithNoInputAndNoOutput() {
        val s = GuardHost.startScript(dir)!!
        assertTrue(s.contains("nohup '$dir/matchi-guard' watch --interval 30 --report '$dir/guard/report.json' </dev/null >/dev/null 2>&1 &"))
        assertFalse(s.contains(" run "))
        assertTrue(s.trimEnd().endsWith("echo started"))
    }

    @Test fun stopMatchesOnlyOurWatchByTheStartOfTheCommandLine() {
        val s = GuardHost.stopScript(dir)!!
        assertTrue(s.contains("case \"\$a\" in '$dir/matchi-guard watch '*) kill \"\$p\""))
        assertFalse(s.contains("pkill")); assertFalse(s.contains("killall")); assertFalse(s.contains("kill -9 -1"))
        assertTrue(GuardHost.startScript(dir)!!.contains(s.substringBefore("\necho stopped")))   // start ends the old one the same way
    }

    @Test fun unsafePathsGiveNoScript() {
        for (bad in listOf("", "files", "/data/x y", "/data/../x", "/data/x'; reboot; '", "/data/\$(id)")) {
            assertNull(bad, GuardHost.startScript(bad)); assertNull(bad, GuardHost.stopScript(bad))
        }
    }

    @Test fun reportPathIsInsideTheFilesFolder() = assertEquals("$dir/guard/report.json", GuardHost.reportPath(dir))

    @Test fun freshMeansWithinThreeIntervalsAndFiveSeconds() {
        assertTrue(GuardHost.fresh(1000, 1000)); assertTrue(GuardHost.fresh(1000, 1095))
        assertFalse(GuardHost.fresh(1000, 1096)); assertFalse(GuardHost.fresh(0, 5))
        assertTrue(GuardHost.fresh(1000, 1020, 5)); assertFalse(GuardHost.fresh(1000, 1021, 5))
    }

    @Test fun binaryIsPinned() = assertNotNull(BinaryHashes.expected(GuardHost.BINARY))
}

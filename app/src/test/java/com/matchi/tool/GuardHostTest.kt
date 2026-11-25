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
        assertTrue(s.contains("nohup '$dir/matchi-guard' watch --interval 10 --report '$dir/guard/report.json' </dev/null >/dev/null 2>&1 &"))
        assertFalse(s.contains(" run "))
        assertTrue(s.trimEnd().endsWith("echo started"))
    }

    @Test fun killAndRunawayFlagsAreFixedWordsAndOffByDefault() {
        val s = GuardHost.startScript(dir, 5, "kill", true)!!
        assertTrue(s.contains("--report '$dir/guard/report.json' --action kill --kill-after 30 --runaway 90 --runaway-secs 30 </dev/null"))
        assertFalse(GuardHost.startScript(dir)!!.contains("--action"))
        assertFalse(GuardHost.startScript(dir, 5, "freeze")!!.contains("--runaway"))
        assertNull(GuardHost.startScript(dir, 5, "kill; reboot"))
        assertNull(GuardHost.startScript(dir, 5, ""))
    }

    @Test fun startRemovesTheOldReportBeforeStartingSoItsIntervalIsNotShown() {
        val s = GuardHost.startScript(dir, 10)!!
        val rm = s.indexOf("rm -f '$dir/guard/report.json'")
        assertTrue(rm > s.indexOf("kill ") && rm < s.indexOf("nohup"))
    }

    @Test fun intervalIsChosenFromOneFiveTenAndNothingElse() {
        for (n in listOf(1, 5, 10)) assertTrue(GuardHost.startScript(dir, n)!!.contains("watch --interval $n --report"))
        for (n in listOf(0, 2, 30, -1, 3600)) assertNull(n.toString(), GuardHost.startScript(dir, n))
        assertEquals(10, GuardHost.INTERVAL_S)
    }

    @Test fun stopMatchesOnlyOurWatchByTheStartOfTheCommandLine() {
        val s = GuardHost.stopScript(dir)!!
        assertTrue(s.contains("'$dir/matchi-guard watch '*"))
        assertTrue(s.contains("'matchi-guard watch '*'--report $dir/guard/report.json'*) kill \"\$p\""))   // ps shows the bare name
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
        assertTrue(GuardHost.fresh(1000, 1000)); assertTrue(GuardHost.fresh(1000, 1035))   // default interval is 10 s: 3 * 10 + 5
        assertFalse(GuardHost.fresh(1000, 1036)); assertFalse(GuardHost.fresh(0, 5))
        assertTrue(GuardHost.fresh(1000, 1095, 30)); assertFalse(GuardHost.fresh(1000, 1096, 30))
        assertTrue(GuardHost.fresh(1000, 1020, 5)); assertFalse(GuardHost.fresh(1000, 1021, 5))
    }

    @Test fun binaryIsPinned() = assertNotNull(BinaryHashes.expected(GuardHost.BINARY))
}

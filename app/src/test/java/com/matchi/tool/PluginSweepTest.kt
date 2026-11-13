package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PluginSweepTest {
    @Test fun fixedNumbersMatchTheOwnersDecisions() {
        assertEquals("MATCHI_PLUGIN", SWEEP_TAG_VAR)
        assertEquals(2_000L, SWEEP_TERM_WAIT_MS)          // D4: wait 2 s between SIGTERM and SIGKILL
        assertEquals(50, SWEEP_MAX_CANDIDATES)            // Step 3: cap
        assertEquals(15_000L, SWEEP_PROBE_TIMEOUT_MS)     // Step 4: probe limit
        assertTrue(SWEEP_PROBE_TIMEOUT_MS < STOP_TOTAL_MS) // the probe is separate from, and shorter than, the 60 s stop clock
        assertTrue(SWEEP_TERM_WAIT_MS < STOP_TOTAL_MS)
    }

    @Test fun theNeverKillListIsFixed() {
        assertEquals(1, SWEEP_INIT_PID)                   // D8
        assertEquals("com.matchi.tool", SWEEP_APP_PACKAGE)
        assertEquals(listOf("/system", "/vendor", "/apex", "/proc", "/dev"), SWEEP_SYSTEM_PREFIXES)
    }

    @Test fun theThreeWaysAreDistinct() {
        assertEquals(3, setOf(SWEEP_HOW_TAG, SWEEP_HOW_PIDFILE, SWEEP_HOW_CMDLINE).size)
    }

    @Test fun typesHoldWhatTheyAreGiven() {
        val p = SweepProc(1234, 1, "12:00:01", 0, "sh /data/local/x/beat.sh", null)
        assertEquals(1234, p.pid); assertEquals(1, p.ppid); assertEquals("12:00:01", p.start); assertEquals(0, p.uid)
        assertEquals("sh /data/local/x/beat.sh", p.args); assertNull(p.tagged)
        val c = SweepCandidate(p.pid, p.start, SWEEP_HOW_TAG, p.args)
        assertEquals(1234, c.pid); assertEquals("tag", c.how)
    }

    // ---- Step 1: the tag ----
    @Test fun goodNamesGetTheTagPrefix() {
        assertEquals("export MATCHI_PLUGIN='Bypass_v65_17.js'; ", tagPrefix("Bypass_v65_17.js"))
        assertEquals("export MATCHI_PLUGIN='my-plugin.v2.html'; ", tagPrefix("  my-plugin.v2.html "))   // tracePluginName trims
    }

    @Test fun badOrMissingNamesGetNoTag() {
        assertEquals("", tagPrefix(null))
        assertEquals("", tagPrefix(""))
        assertEquals("", tagPrefix("noext"))
        assertEquals("", tagPrefix("../evil.js"))
        assertEquals("", tagPrefix("a..b.js"))
        assertEquals("", tagPrefix("x".repeat(81) + ".js"))
    }

    @Test fun aNameWithAQuoteOrShellCharactersCannotGetThrough() {
        for (bad in listOf("a'b.js", "a'; reboot; '.js", "a\"b.js", "a b.js", "a;b.js", "a\$(id).js", "a`id`.js", "a\\b.js", "a\nb.js", "a\u0000b.js"))
            assertEquals("no tag for: $bad", "", tagPrefix(bad))
    }

    @Test fun theOriginalCommandTextIsUntouched() {
        val cmd = "nohup sh /data/local/x/beat.sh &\necho \$! > /data/local/x/beat.pid"
        val t = tagCommand("beat.js", cmd)
        assertTrue(t.endsWith(cmd))
        assertEquals("export MATCHI_PLUGIN='beat.js'; " + cmd, t)
        assertEquals(cmd, tagCommand(null, cmd))          // no name: returned as is
        assertEquals(cmd, tagCommand("bad name", cmd))
    }

    // ---- Step 2: the probe and its parser ----
    private fun probeOut(vararg lines: String) = lines.joinToString("\n") + "\n"

    @Test fun theProbeScriptOnlyReads() {
        val sc = sweepProbeScript()
        for (bad in listOf("kill", "rm ", "rm\n", "mv ", "chmod", "mkdir", "touch", ">>", "tee ", "reboot", "svc "))
            assertFalse("probe must not contain: $bad", sc.contains(bad))
        // the only ">" allowed is the 2>/dev/null of a read; every other redirect is an input
        assertFalse(sc.replace("2>/dev/null", "").contains(">"))
        assertTrue(sc.contains("/proc/[0-9]*") && sc.contains("MATCHI_PLUGIN") && sc.contains("cut -c1-200"))
        assertTrue(sc.startsWith("echo \"MTSWEEP-SELF ") && sc.trimEnd().endsWith("\"MTSWEEP-END \$n\""))
    }

    @Test fun normalOutputParses() {
        val r = parseSweepProbe(probeOut(
            "MTSWEEP-SELF 900",
            "MTSWEEP|1|0|1|0||/init",
            "MTSWEEP|2|0|5|0||",
            "MTSWEEP|1234|1|88123|0|beat.js|sh /data/local/x/beat.sh",
            "MTSWEEP-END 3"))
        assertTrue(r.complete); assertEquals(0, r.skipped); assertEquals(900, r.selfPid)
        assertEquals(3, r.procs.size)
        val p = r.procs[2]
        assertEquals(1234, p.pid); assertEquals(1, p.ppid); assertEquals("88123", p.start); assertEquals(0, p.uid)
        assertEquals("beat.js", p.tagged); assertEquals("sh /data/local/x/beat.sh", p.args)
        assertNull(r.procs[0].tagged); assertEquals("", r.procs[1].args)               // kernel thread: empty ARGS
    }

    @Test fun argsWithSpacesAndBarsStayInOneColumn() {
        val r = parseSweepProbe(probeOut("MTSWEEP|77|1|500|2000||sh -c echo a | grep b   x", "MTSWEEP-END 1"))
        assertTrue(r.complete)
        assertEquals("sh -c echo a | grep b   x", r.procs[0].args); assertEquals(2000, r.procs[0].uid)
    }

    @Test fun aCutOutputIsNeverComplete() {
        val r = parseSweepProbe("MTSWEEP-SELF 9\nMTSWEEP|10|1|20|0||sh a\nMTSWEEP|11|1|2")   // no END, last line cut
        assertFalse(r.complete); assertEquals(1, r.procs.size); assertEquals(1, r.skipped)
        val r2 = parseSweepProbe(probeOut("MTSWEEP|10|1|20|0||sh a", "MTSWEEP-END 1").replace("MTSWEEP-END 1\n", ""))
        assertFalse(r2.complete)
    }

    @Test fun anEndCountThatDoesNotMatchIsNotComplete() {
        assertFalse(parseSweepProbe(probeOut("MTSWEEP|10|1|20|0||sh a", "MTSWEEP-END 2")).complete)
        assertFalse(parseSweepProbe(probeOut("MTSWEEP|10|1|20|0||sh a", "MTSWEEP-END x")).complete)
    }

    @Test fun emptyAndGarbageOutput() {
        for (g in listOf("", "\n\n", "su: not found\n", "\u0000\u0001 garbage |||\n", "MTSWEEP\nMTSWEEP|\nMTSWEEP|a|b|c|d|e|f\n")) {
            val r = parseSweepProbe(g)
            assertFalse(r.complete); assertTrue(r.procs.isEmpty()); assertNull(r.selfPid)
        }
        val r = parseSweepProbe(probeOut("warning: x", "MTSWEEP-SELF 5", "MTSWEEP|a|b|c|d|e|f", "MTSWEEP|6|1|30|0||ok", "MTSWEEP-END 2"))
        assertTrue(r.complete); assertEquals(1, r.skipped); assertEquals(listOf(6), r.procs.map { it.pid })
    }

    @Test fun oddFieldsAreHandledNotTrusted() {
        val r = parseSweepProbe(probeOut(
            "MTSWEEP|20|1|40||evil'name.js|x",       // no uid -> -1; a bad tag -> null
            "MTSWEEP|21|1|41|0|../x.js|y",
            "MTSWEEP|22|1|abc|0||z",                 // START not a number -> skipped
            "MTSWEEP-END 3"))
        assertTrue(r.complete); assertEquals(1, r.skipped); assertEquals(2, r.procs.size)
        assertEquals(-1, r.procs[0].uid); assertNull(r.procs[0].tagged); assertNull(r.procs[1].tagged)
    }

    @Test fun windowsLineEndingsAreTolerated() {
        val r = parseSweepProbe("MTSWEEP-SELF 3\r\nMTSWEEP|4|1|9|0|a.js|sh x\r\nMTSWEEP-END 1\r\n")
        assertTrue(r.complete); assertEquals("a.js", r.procs[0].tagged); assertEquals("sh x", r.procs[0].args)
    }

    // ---- Step 3: candidate rules ----
    private fun pr(pid: Int, ppid: Int, args: String, tag: String? = null, start: String = "100") = SweepProc(pid, ppid, start, 0, args, tag)
    private fun probeOf(vararg ps: SweepProc, self: Int? = 900, complete: Boolean = true) = SweepProbe(ps.toList(), self, complete, 0)

    /** init, the app (500), its root session (600 -> su), the sweep's own chain (700 su -> 900 sh), a kernel thread and the sweep's child. */
    private fun base(): Array<SweepProc> = arrayOf(
        pr(1, 0, "/init"), pr(2, 0, ""), pr(3, 2, ""), pr(500, 1, "com.matchi.tool"),
        pr(600, 500, "su"), pr(700, 600, "su -c sh"), pr(900, 700, "sh"), pr(901, 900, "cat /proc/1/stat"),
    )
    private val PL = "beat.js"
    private val LEDGER = listOf("/data/local/x", "/data/local/x/beat.sh", "/data/local/x/beat.pid")

    private fun run(extra: List<SweepProc>, ledger: List<String> = LEDGER, pidfiles: Map<String, Int> = emptyMap(),
                    others: Map<String, List<String>> = emptyMap(), complete: Boolean = true, self: Int? = 900) =
        classifySweep(PL, SweepProbe(base().toList() + extra, self, complete, 0), ledger, pidfiles, others)

    private fun pids(r: SweepResult) = r.candidates.map { it.pid }

    @Test fun argsMentionsWholePathsOnly() {
        assertTrue(argsMentionsPath("sh /data/local/x/beat.sh", "/data/local/x/beat.sh"))
        assertTrue(argsMentionsPath("sh -c '/data/local/x/beat.sh;'", "/data/local/x/beat.sh"))
        assertTrue(argsMentionsPath("PATH=/a:/data/local/x/beat.sh", "/data/local/x/beat.sh"))
        assertTrue(argsMentionsPath("sh /data/local/x/beat.sh", "/data/local/x/beat.sh/"))   // trailing slash ignored
        assertFalse(argsMentionsPath("sh /data/local/x/beat.sh.bak", "/data/local/x/beat.sh"))
        assertFalse(argsMentionsPath("sh /y/data/local/x/beat.sh", "/data/local/x/beat.sh"))
        assertFalse(argsMentionsPath("sh /data/local/x/beat.shx", "/data/local/x/beat.sh"))
        assertFalse(argsMentionsPath("", "/data/local/x/beat.sh")); assertFalse(argsMentionsPath("sh a", ""))
        assertTrue(argsMentionsPath("sh /data/local/x/beat.sh.bak /data/local/x/beat.sh", "/data/local/x/beat.sh"))   // second hit counts
    }

    @Test fun cmdlinePathsAreFilesWithEnoughSegmentsOutsideSystemFolders() {
        val got = sweepCmdlinePaths(listOf(
            "/data/local/x", "/data/local/x/beat.sh", "/data/local/x/beat.pid",   // folder dropped, files kept
            "/data/x.sh",                                                        // 2 segments
            "/system/bin/tool.sh", "/vendor/a/b.sh", "/apex/a/b.sh", "/proc/1/x.y", "/dev/a/b.c",
            "/data/local/x/noext", "/data/local/x/.hidden", "/data/local/x/trail.",
            "/data/local/../etc/x.sh", "relative/a/b.sh", "/data/local/y.d", "/data/local/y.d/inner.sh"), emptyMap())
        assertEquals(listOf("/data/local/x/beat.sh", "/data/local/x/beat.pid", "/data/local/y.d/inner.sh"), got)   // y.d has a child, so it is a folder
    }

    @Test fun aPathAnotherPluginUsesIsNotMatched() {
        val others = mapOf("other.js" to listOf("/data/local/x"))                 // a folder around it
        assertTrue(sweepCmdlinePaths(LEDGER, others).isEmpty())
        assertEquals(listOf("/data/local/x/beat.sh"), sweepCmdlinePaths(listOf("/data/local/x/beat.sh"), mapOf("o.js" to listOf("/data/local/z"))))
    }

    @Test fun pidfilePathsEndInPidAndAreNotSystem() {
        assertEquals(listOf("/data/local/x/beat.pid"), sweepPidfilePaths(listOf("/data/local/x/beat.pid", "/data/local/x/beat.pid/", "/data/local/x/beat.txt", "/proc/1/a.pid", "/dev/a.pid", "a.pid", "/x/../a.pid", ".pid")))
    }

    @Test fun sessionShellAndAppShapes() {
        for (s in listOf("su", "/system/bin/su", "su 0 sh", "sh", "/system/bin/sh", "sh -", "sh -l", "mksh")) assertTrue(s, isSweepSessionShell(s))
        for (s in listOf("sh /data/local/x/beat.sh", "sh -c sleep 30", "sleep 30", "", "nohup sh x")) assertFalse(s, isSweepSessionShell(s))
        assertTrue(isSweepAppProcess("com.matchi.tool")); assertTrue(isSweepAppProcess("com.matchi.tool:remote"))
        assertFalse(isSweepAppProcess("sh /x/y.sh com.matchi.tool")); assertFalse(isSweepAppProcess("com.matchi.toolbox")); assertFalse(isSweepAppProcess(""))
    }

    @Test fun neverKillCoversSelfParentsChildrenInitKernelAndApp() {
        val never = sweepNeverKill(base().toList() + listOf(pr(950, 500, "sh"), pr(951, 500, "sh /data/local/x/beat.sh"), pr(952, 500, "su")), 900)
        for (pid in listOf(900, 700, 600, 500, 901, 1, 2, 3, 950, 952)) assertTrue("never: $pid", pid in never)
        assertFalse(951 in never)                        // a plugin's own job below the app is NOT protected
    }

    @Test fun neverKillSurvivesALoopAndAMissingParent() {
        val loop = listOf(pr(10, 11, "a"), pr(11, 10, "b"), pr(900, 10, "sh"))
        val never = sweepNeverKill(loop, 900)
        assertTrue(900 in never && 10 in never && 11 in never)
        assertTrue(900 in sweepNeverKill(listOf(pr(900, 4242, "sh")), 900))
    }

    @Test fun tagIsFoundAndStrongest() {
        val r = run(listOf(pr(1234, 1, "sh /data/local/x/beat.sh", PL, "88123"), pr(1300, 1, "sleep 99", PL)), pidfiles = mapOf("/data/local/x/beat.pid" to 1234))
        assertEquals(listOf(1234, 1300), pids(r))
        assertEquals(listOf(SWEEP_HOW_TAG, SWEEP_HOW_TAG), r.candidates.map { it.how })   // a process matching several ways gets the strongest only
        assertEquals("88123", r.candidates[0].start); assertEquals("sh /data/local/x/beat.sh", r.candidates[0].args)
        assertTrue(r.complete); assertFalse(r.overCap); assertEquals(2, r.found); assertTrue(r.notes.isEmpty()); assertTrue(r.notStopped.isEmpty())
    }

    @Test fun pidfileMatchNeedsAFittingProcess() {
        val pf = mapOf("/data/local/x/beat.pid" to 2000)
        val ok = run(listOf(pr(2000, 1, "sh /data/local/x/beat.sh")), pidfiles = pf)
        assertEquals(listOf(SWEEP_HOW_PIDFILE), ok.candidates.map { it.how })
        val reused = run(listOf(pr(2000, 1, "/system/bin/logcat -b all")), pidfiles = pf)    // PID reuse: the stale PID is another program
        assertTrue(reused.candidates.isEmpty())
        val notLedger = run(listOf(pr(2000, 1, "sh /data/local/x/beat.sh")), pidfiles = mapOf("/data/local/other.pid" to 2000))
        assertEquals(listOf(SWEEP_HOW_CMDLINE), notLedger.candidates.map { it.how })     // the pidfile is not the plugin's, so only the command line fits
        val one = run(listOf(pr(1, 0, "/init")), pidfiles = mapOf("/data/local/x/beat.pid" to 1))
        assertTrue(one.candidates.isEmpty())
    }

    @Test fun pidfileOfAnotherPluginsProcessIsIgnored() {
        val r = run(listOf(pr(2000, 1, "sh /data/local/x/beat.sh", "other.js")), pidfiles = mapOf("/data/local/x/beat.pid" to 2000))
        assertTrue(r.candidates.isEmpty())
    }

    @Test fun cmdlineMatchOnlyForFilePathsOfThePlugin() {
        val r = run(listOf(
            pr(3000, 1, "sh /data/local/x/beat.sh"),
            pr(3001, 1, "sh /data/local/x/beat.sh.bak"),
            pr(3002, 1, "sleep 30"),
            pr(3003, 1, "ls /data/local/x"),                           // the folder alone is not a file match
            pr(3004, 1, "sh /data/local/x/beat.sh", "other.js")))      // belongs to another plugin
        assertEquals(listOf(3000), pids(r)); assertEquals(SWEEP_HOW_CMDLINE, r.candidates[0].how)
    }

    @Test fun exclusionsBeatEveryWay() {
        val r = run(listOf(
            pr(950, 500, "sh", PL), pr(952, 500, "su", PL),                                   // root sessions, even if tagged
            pr(960, 900, "sh /data/local/x/beat.sh"),                                          // child of the sweep
            pr(970, 1, "com.matchi.tool", PL), pr(971, 1, "", PL), pr(972, 2, "x /data/local/x/beat.sh", PL),
            pr(1, 0, "/init", PL)), pidfiles = mapOf("/data/local/x/beat.pid" to 950))
        assertTrue(pids(r).toString(), r.candidates.isEmpty())
    }

    @Test fun aJobBelowTheAppIsStillFound() {
        val r = run(listOf(pr(980, 500, "sh /data/local/x/beat.sh", PL)))
        assertEquals(listOf(980), pids(r))
    }

    @Test fun withoutTheSweepsOwnPidNothingIsListed() {
        val r = run(listOf(pr(1234, 1, "sh /data/local/x/beat.sh", PL)), self = null)
        assertTrue(r.candidates.isEmpty()); assertFalse(r.complete); assertEquals(1, r.notes.size)
    }

    @Test fun sharedGuardLeavesAProcessAnotherPluginUses() {
        val others = mapOf("new.js" to listOf("/data/local/x/beat.sh"))                   // the NEW copy uses the same script
        val r = run(listOf(pr(1234, 1, "sh /data/local/x/beat.sh", PL), pr(1235, 1, "sleep 5", PL)), ledger = listOf("/data/local/x/beat.sh"), others = others)
        assertEquals(listOf(1235), pids(r))                                                // a tagged process is guarded too (test C)
        assertEquals(1, r.notStopped.size); assertTrue(r.notStopped[0], r.notStopped[0].contains("1234") && r.notStopped[0].contains("also used by new.js"))
    }

    @Test fun sharedGuardMatchesFoldersAndNamesEveryPlugin() {
        val others = mapOf("b.js" to listOf("/data/local/x"), "a.js" to listOf("/data/local/x/sub"))
        val r = run(listOf(pr(1234, 1, "sh /data/local/x/sub/run.sh", PL)), ledger = emptyList(), others = others)
        assertTrue(r.candidates.isEmpty()); assertTrue(r.notStopped[0].endsWith("also used by a.js, b.js"))
    }

    @Test fun sharedGuardIgnoresShortPathsAndUnrelatedPlugins() {
        val others = mapOf("o.js" to listOf("/data/local/zzz"))
        val r = run(listOf(pr(1234, 1, "sh /data/x.sh /data/local/x/beat.sh", PL)), others = others)
        assertEquals(listOf(1234), pids(r)); assertTrue(r.notStopped.isEmpty())
    }

    @Test fun capRefusesMoreThanFifty() {
        val fifty = (1000 until 1050).map { pr(it, 1, "sleep $it", PL) }
        val ok = run(fifty)
        assertEquals(50, ok.candidates.size); assertEquals(50, ok.found); assertFalse(ok.overCap)
        val over = run(fifty + pr(1050, 1, "sleep 1050", PL))
        assertTrue(over.overCap); assertEquals(51, over.found); assertEquals(50, over.candidates.size)
        assertTrue(over.notes.any { it.contains("51") && it.contains("not stopped automatically") })
    }

    @Test fun anIncompleteProbeIsFlaggedButStillLists() {
        val r = run(listOf(pr(1234, 1, "sleep 9", PL)), complete = false)
        assertEquals(listOf(1234), pids(r)); assertFalse(r.complete); assertTrue(r.notes.any { it.contains("cut short") })
    }

    @Test fun orderIsStrongestWayThenPid() {
        val r = run(listOf(pr(3000, 1, "sh /data/local/x/beat.sh"), pr(2000, 1, "sh /data/local/x/beat.sh"), pr(4000, 1, "sleep 1", PL), pr(5000, 1, "sleep 2", PL)),
            pidfiles = mapOf("/data/local/x/beat.pid" to 2000))
        assertEquals(listOf(4000, 5000, 2000, 3000), pids(r))
        assertEquals(listOf("tag", "tag", "pidfile", "cmdline"), r.candidates.map { it.how })
    }

    @Test fun nothingRunningGivesAnEmptyCompleteResult() {
        val r = run(listOf(pr(3002, 1, "sleep 30"), pr(3003, 1, "/system/bin/logcat", "other.js")))
        assertTrue(r.candidates.isEmpty()); assertTrue(r.complete); assertEquals(0, r.found); assertTrue(r.notes.isEmpty())
    }
}

package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Phase 2 / Step 5: the kill script, the sweep step of a stop (runSweepStop), and how it folds into verify and the report. Pure; the shell is faked. */
private const val SR_PL = "beat.js"
private val SR_LEDGER = listOf("/data/local/x", "/data/local/x/beat.sh", "/data/local/x/beat.pid")

private fun srCand(pid: Int, start: String = "501", how: String = "tag", args: String = "sleep 99") = SweepCandidate(pid, start, how, args)
private fun srOut(vararg lines: String) = lines.joinToString("\n") + "\n"
private fun srProc(pid: Int, start: String, tag: String, args: String) = "MTSWEEP|$pid|1|$start|0|$tag|$args"
/** A probe output: the sweep's own shell (PID 900) plus [procs]. */
private fun srProbe(vararg procs: String) = srOut("MTSWEEP-SELF 900", "MTSWEEP|900|1|9|0||sh", *procs, "MTSWEEP-END ${procs.size + 1}")
private fun srView(output: String, others: Map<String, List<String>> = emptyMap()) = buildSweepView(SR_PL, true, ShellResult(true, output), SR_LEDGER, others)
private val SR_ONE = srProc(2001, "501", SR_PL, "sleep 99")
private val SR_CLEAN = ShellResult(true, srProbe())

private class SrClock(var t: Long = 0L) { fun now() = t }

/** A fake root shell: the kill script (it contains "kill -STOP") and the probe (everything else) are told apart by their text. */
private class SrFake(val clock: SrClock, val kill: ShellResult = ShellResult(true, ""), val probes: List<ShellResult> = listOf(SR_CLEAN), val killCost: Long = 0L, val probeCost: Long = 0L, val boom: Boolean = false) {
    val calls = ArrayList<Pair<String, Long>>()
    var probeIdx = 0
    fun exec(script: String, ms: Long): ShellResult {
        calls.add(script to ms)
        if (boom) throw IllegalStateException("su died")
        if (script.contains("kill -STOP")) { clock.t += killCost; return kill }
        val r = probes[minOf(probeIdx, probes.size - 1)]; probeIdx++; clock.t += probeCost; return r
    }
    fun killCalls() = calls.filter { it.first.contains("kill -STOP") }
    fun probeCalls() = calls.filter { !it.first.contains("kill -STOP") }
}

private fun srGo(view: SweepView, f: SrFake, others: Map<String, List<String>> = emptyMap(), onKill: (String) -> Unit = {}, onProbe: (String) -> Unit = {}) =
    runSweepStop(SR_PL, view, 60_000L, 0L, f.clock::now, f::exec, SR_LEDGER, others, onKill, onProbe)

class PluginSweepKillScriptTest {
    @Test fun fixedNumbers() {
        assertEquals(6_000L, SWEEP_MIN_MS)
        assertEquals(20_000L, SWEEP_KILL_TIMEOUT_MS)
        assertTrue(SWEEP_MIN_MS > SWEEP_TERM_WAIT_MS)            // the wait must fit in the time the step needs
        assertTrue(SWEEP_KILL_TIMEOUT_MS <= 30_000L)             // stays out of the \"long\" root slots (F9 of Phase 1)
    }

    @Test fun noScriptForNothingOrForAnUnsafeEntry() {
        assertNull(sweepKillScript(emptyList()))
        assertNull(sweepKillScript(listOf(srCand(1))))                          // PID 1 is never touched
        assertNull(sweepKillScript(listOf(srCand(0))))
        assertNull(sweepKillScript(listOf(srCand(5, start = "12x"))))           // the start time must be digits
        assertNull(sweepKillScript(listOf(srCand(5, start = ""))))
        assertNull(sweepKillScript(listOf(srCand(5), srCand(6, start = "1; reboot"))))   // one bad entry: nothing runs at all
    }

    @Test fun onlyPidAndStartTimeGoIntoTheScript() {
        val evil = "sh -c 'x'; reboot; echo \"\$(id)\" `id`"
        val s = sweepKillScript(listOf(srCand(2001, "501", "tag", evil), srCand(2002, "777", "pidfile", "rm -rf /")))!!
        assertTrue(s.contains("'2001:501' '2002:777'"))
        assertFalse(s.contains("reboot")); assertFalse(s.contains("rm -rf")); assertFalse(s.contains("\$(id)")); assertFalse(s.contains("`id`"))
    }

    @Test fun placeholdersAreAllReplaced() {
        val s = sweepKillScript(listOf(srCand(2001)))!!
        assertFalse(s.contains('^')); assertFalse(s.contains("@PAIRS@")); assertFalse(s.contains("@WAIT@"))
        assertTrue(s.contains("sleep 2\n"))                       // SWEEP_TERM_WAIT_MS / 1000
        assertTrue(s.contains("me=\$\$"))
    }

    @Test fun theOrderIsFreezeTermContWaitFreezeKill() {
        val s = sweepKillScript(listOf(srCand(2001)))!!
        val stop1 = s.indexOf("kill -STOP"); val term = s.indexOf("kill -TERM"); val cont = s.indexOf("kill -CONT")
        val wait = s.indexOf("sleep 2"); val stop2 = s.lastIndexOf("kill -STOP"); val kill = s.indexOf("kill -KILL")
        assertTrue(stop1 in 0 until term)                        // frozen before anything is told to end
        assertTrue(term < cont)                                  // a stopped process never acts on SIGTERM, so it is continued after it
        assertTrue(cont < wait)
        assertTrue(wait < stop2)                                 // a respawned child is frozen again ...
        assertTrue(stop2 < kill)                                 // ... before SIGKILL
        assertEquals(1, Regex("kill -KILL").findAll(s).count())
    }

    @Test fun itStartsNoProgramPerProcess() {
        // device test (F50, 490 entries in /proc): "$(cat $d/stat)" for every process, three times over, ran into the 20 s limit
        val s = sweepKillScript(listOf(srCand(2001)))!!
        assertTrue(s.contains("cat /proc/[0-9]*/stat"))                  // ONE cat for every stat file
        assertEquals(1, Regex("cat /proc/\\[0-9\\]\\*/stat").findAll(s).count())
        for (perProcess in listOf("for d in /proc", "cat \$d", "\$d/stat"))
            assertFalse("per-process program: $perProcess", s.contains(perProcess))
        assertTrue(s.contains("<<MTKILL_EOF"))                           // the walk runs in the main shell, so its result survives
    }

    @Test fun itNeverTakesItselfItsParentsInitKernelOrTheApp() {
        val s = sweepKillScript(listOf(srCand(2001)))!!
        assertTrue(s.contains("prot=\" 1 2 \$me \""))   // PID 1, PID 2 and the script's own shell
        assertTrue(s.contains("prot=\"\$prot\$q \""))                      // every parent of the script
        assertTrue(s.contains("'com.matchi.tool'|'com.matchi.tool '*|'com.matchi.tool:'*"))
        assertTrue(s.contains("\"MTKILL|\$p|protected\""))
    }

    @Test fun itChecksPidStartTimeAndStateAgainRightBeforeActing() {
        val s = sweepKillScript(listOf(srCand(2001)))!!
        assertTrue(s.contains("[ \"\${20}\" != \"\$st\" ]"))      // field 22 of /proc/PID/stat, the same one the probe printed
        assertTrue(s.contains("MTKILL|\$p|changed")); assertTrue(s.contains("MTKILL|\$p|gone"))
        assertTrue(s.contains("Z*|X*"))                          // a zombie is not alive
    }

    @Test fun itDoesNotWriteOrRunAnythingElse() {
        val s = sweepKillScript(listOf(srCand(2001)))!!
        for (bad in listOf("rm ", "reboot", " su ", "svc ", "setprop", "iptables", "mv ", "> /data", "mount"))
            assertFalse("script must not contain: $bad", s.contains(bad))
    }

    @Test fun parserKeepsOnlyKnownStatusesAndNumericPids() {
        val o = srOut("noise", "MTKILL|2001|killed", "MTKILL|2002|ended", "MTKILL|2003|gone", "MTKILL|2004|changed", "MTKILL|2005|protected",
            "MTKILL|2006|exploded", "MTKILL|abc|killed", "MTKILL|2007", "MTKILL|2008|killed|extra", "MTKILL-END")
        assertEquals(mapOf(2001 to "killed", 2002 to "ended", 2003 to "gone", 2004 to "changed", 2005 to "protected"), parseSweepKill(o))
        assertTrue(parseSweepKill("").isEmpty()); assertTrue(parseSweepKill("\u0000garbage\r\n").isEmpty())
        assertEquals(mapOf(5 to "killed"), parseSweepKill("MTKILL|5|killed\r\n"))
    }

    @Test fun theHashCheckIsAnExactMatchOfWhatWasShown() {
        val v = srView(srProbe(SR_ONE))
        assertEquals(64, v.hash.length)
        assertTrue(sweepHashMatches(v.hash, v))
        assertFalse(sweepHashMatches("", v))                                       // the page saw nothing, the scan finds something: refuse
        assertFalse(sweepHashMatches(v.hash, srView(srProbe())))                     // it ended meanwhile: the person saw a different list
        assertFalse(sweepHashMatches(v.hash, srView(srProbe(srProc(2001, "502", SR_PL, "sleep 99")))))   // same PID, new start time = a reused PID
        val unchecked = buildSweepView(SR_PL, false, null, SR_LEDGER, emptyMap())
        assertTrue(sweepHashMatches("", unchecked)); assertFalse(sweepHashMatches(v.hash, unchecked))
        assertTrue(sweepHashMatches("", srView(srProbe())))                          // nothing found, nothing shown: matches
    }
}

class PluginSweepRunTest {
    @Test fun nothingFoundStillScansAgainAndCleanIsSuccess() {
        val f = SrFake(SrClock()); val r = srGo(srView(srProbe()), f)
        assertTrue(r.counts); assertTrue(r.rescanRan); assertTrue(r.clean)
        assertTrue(f.killCalls().isEmpty())                       // nothing to end: no kill script
        assertEquals(1, f.probeCalls().size); assertEquals(SWEEP_PROBE_TIMEOUT_MS, f.probeCalls()[0].second)
        assertTrue(r.killLog.isEmpty()); assertTrue(r.leftovers.isEmpty())
    }

    @Test fun aProcessThatIgnoresTermNeedsKillAndTheCleanRescanDecides() {
        val f = SrFake(SrClock(), kill = ShellResult(true, srOut("MTKILL|2001|killed", "MTKILL-END")))
        val r = srGo(srView(srProbe(SR_ONE)), f)
        assertEquals(1, f.killCalls().size); assertEquals(SWEEP_KILL_TIMEOUT_MS, f.killCalls()[0].second)
        assertEquals(listOf("sweep: needed SIGKILL: PID 2001 (tag) sleep 99"), r.killLog)
        assertTrue(r.rescanRan); assertTrue(r.clean)
        assertTrue(f.killCalls()[0].first.contains("'2001:501'"))
    }

    @Test fun aProcessThatEndsAfterTermIsLoggedAsEnded() {
        val f = SrFake(SrClock(), kill = ShellResult(true, srOut("MTKILL|2001|ended", "MTKILL-END")))
        val r = srGo(srView(srProbe(SR_ONE)), f)
        assertEquals(listOf("sweep: ended after SIGTERM: PID 2001 (tag) sleep 99"), r.killLog); assertTrue(r.clean)
    }

    @Test fun goneChangedProtectedAndSilentAreAllNamed() {
        val three = srProbe(SR_ONE, srProc(2002, "502", SR_PL, "sleep 98"), srProc(2003, "503", SR_PL, "sleep 97"), srProc(2004, "504", SR_PL, "sleep 96"))
        val f = SrFake(SrClock(), kill = ShellResult(true, srOut("MTKILL|2001|gone", "MTKILL|2002|changed", "MTKILL|2003|protected", "MTKILL-END")))
        val r = srGo(srView(three), f)
        assertEquals(4, r.killLog.size)
        assertTrue(r.killLog[0].startsWith("sweep: already gone")); assertTrue(r.killLog[1].contains("now belongs to another process"))
        assertTrue(r.killLog[2].contains("protected")); assertTrue(r.killLog[3].startsWith("sweep: NO ANSWER"))
    }

    @Test fun aRespawnedProcessIsAFailureEvenAfterTheKill() {
        val back = ShellResult(true, srProbe(srProc(3000, "900", SR_PL, "sleep 99")))
        val f = SrFake(SrClock(), kill = ShellResult(true, srOut("MTKILL|2001|killed", "MTKILL-END")), probes = listOf(back))
        val r = srGo(srView(srProbe(SR_ONE)), f)
        assertTrue(r.rescanRan); assertFalse(r.clean)
        assertEquals(listOf("process still running: PID 3000 sleep 99 (found by tag)"), r.leftovers)
    }

    @Test fun aKillThatTimesOutIsLoggedAndTheRescanStillSaysWhatIsLeft() {
        val still = ShellResult(true, srProbe(SR_ONE))
        val f = SrFake(SrClock(), kill = ShellResult(false, "partial\n[timeout after 20000ms]"), probes = listOf(still))
        val r = srGo(srView(srProbe(SR_ONE)), f)
        assertTrue(r.killLog.any { it.startsWith("sweep TIMEOUT:") }); assertTrue(r.killLog.any { it.startsWith("sweep: NO ANSWER") })
        assertFalse(r.clean); assertEquals(1, r.leftovers.size)
    }

    @Test fun rootCapacityOnTheKillIsAFailureLineNotASuccess() {
        val still = ShellResult(true, srProbe(SR_ONE))
        val f = SrFake(SrClock(), kill = ShellResult(false, "Root command capacity reached"), probes = listOf(still))
        val r = srGo(srView(srProbe(SR_ONE)), f)
        assertTrue(r.killLog.any { it.startsWith("sweep FAILED: Root command capacity reached") }); assertFalse(r.clean)
    }

    @Test fun rootCapacityOnTheRescanMeansNoProofAndNoSuccess() {
        val f = SrFake(SrClock(), kill = ShellResult(true, srOut("MTKILL|2001|killed")), probes = listOf(ShellResult(false, "Root command capacity reached")))
        val r = srGo(srView(srProbe(SR_ONE)), f)
        assertFalse(r.rescanRan); assertFalse(r.clean)
        assertTrue(r.notChecked.any { it.startsWith("process re-scan did not run") && it.contains("the process check failed") })
    }

    @Test fun aRescanThatTimesOutIsNotProofEither() {
        val f = SrFake(SrClock(), probes = listOf(ShellResult(false, "[timeout after 15000ms]")))
        val r = srGo(srView(srProbe()), f)
        assertFalse(r.rescanRan); assertFalse(r.clean); assertTrue(r.notChecked.any { it.contains("did not finish in time") })
    }

    @Test fun aCutRescanIsNotProofThatNothingIsLeft() {
        val cut = ShellResult(true, srOut("MTSWEEP-SELF 900", "MTSWEEP|900|1|9|0||sh"))      // no END line
        val f = SrFake(SrClock(), probes = listOf(cut))
        val r = srGo(srView(srProbe()), f)
        assertFalse(r.rescanRan); assertFalse(r.clean); assertTrue(r.notChecked.any { it.contains("cut short") })
    }

    @Test fun whatIsStillThereIsListedEvenWhenTheRescanIsCut() {
        val cut = ShellResult(true, srOut("MTSWEEP-SELF 900", "MTSWEEP|900|1|9|0||sh", srProc(2001, "501", SR_PL, "sleep 99")))
        val f = SrFake(SrClock(), probes = listOf(cut))
        val r = srGo(srView(srProbe()), f)
        assertFalse(r.rescanRan); assertEquals(1, r.leftovers.size)
    }

    @Test fun theTotalRunningOutBeforeTheKillKeepsEverythingAndSaysSo() {
        val clock = SrClock(55_000L)                                 // 5 s left, the step needs SWEEP_MIN_MS = 6 s
        val f = SrFake(clock, probes = listOf(ShellResult(true, srProbe(SR_ONE))))
        val r = srGo(srView(srProbe(SR_ONE)), f)
        assertTrue(f.killCalls().isEmpty())                        // nothing is started that could be cut off while processes are frozen
        assertTrue(r.killLog.single().startsWith("NOT RUN: end PID 2001"))
        assertTrue(r.notChecked.any { it.startsWith("sweep did not run") && it.contains("60 s") })
        assertEquals(listOf("process not stopped: PID 2001 sleep 99 (found by tag)"), r.leftovers)   // listed once, the rescan does not repeat it
        assertTrue(r.rescanRan); assertFalse(r.clean)
    }

    @Test fun lessThanASecondLeftMeansNoRescan() {
        val f = SrFake(SrClock(), kill = ShellResult(true, srOut("MTKILL|2001|killed")), killCost = 59_500L)
        val r = srGo(srView(srProbe(SR_ONE)), f)
        assertEquals(0, f.probeCalls().size)
        assertFalse(r.rescanRan); assertFalse(r.clean); assertTrue(r.notChecked.any { it.startsWith("process re-scan did not run") && it.contains("60 s") })
    }

    @Test fun theRescanSharesTheClockAndItsTimeoutIsWhatIsLeft() {
        val f = SrFake(SrClock(), kill = ShellResult(true, srOut("MTKILL|2001|ended")), killCost = 50_000L)
        srGo(srView(srProbe(SR_ONE)), f)
        assertEquals(10_000L, f.probeCalls().single().second)      // 60 s - 50 s, below the 15 s probe limit
    }

    @Test fun withoutRootNothingRunsAndNothingCounts() {
        val f = SrFake(SrClock())
        for (v in listOf(buildSweepView(SR_PL, false, null, SR_LEDGER, emptyMap()), buildSweepView(SR_PL, true, ShellResult(false, "su: denied"), SR_LEDGER, emptyMap()))) {
            val r = srGo(v, f)
            assertFalse(r.counts); assertFalse(r.rescanRan); assertFalse(r.clean); assertTrue(r.killLog.isEmpty())
            assertTrue(r.notChecked.single().startsWith("processes: cannot be checked"))
        }
        assertTrue(f.calls.isEmpty())
    }

    @Test fun moreThanFiftyAreNotEndedAutomatically() {
        val lines = (1000 until 1051).map { srProc(it, "$it", SR_PL, "sleep $it") }
        val f = SrFake(SrClock())
        val r = srGo(srView(srProbe(*lines.toTypedArray())), f)
        assertTrue(f.calls.isEmpty())
        assertTrue(r.counts); assertFalse(r.rescanRan); assertFalse(r.clean)
        assertTrue(r.leftovers.single().contains("51 processes found") && r.leftovers.single().contains("more than 50"))
    }

    @Test fun oneAuditLinePerCandidateBeforeTheScriptAndOneForTheRescan() {
        val order = ArrayList<String>()
        val f = SrFake(SrClock(), kill = ShellResult(true, srOut("MTKILL|2001|killed", "MTKILL|2002|ended")))
        val seen = object { var killsBeforeExec = -1 }
        val view = srView(srProbe(SR_ONE, srProc(2002, "502", SR_PL, "sleep 98")))
        val r = runSweepStop(SR_PL, view, 60_000L, 0L, f.clock::now,
            { s, ms -> if (s.contains("kill -STOP") && seen.killsBeforeExec < 0) seen.killsBeforeExec = order.size; f.exec(s, ms) },
            SR_LEDGER, emptyMap(), { order.add("kill:$it") }, { order.add("probe:$it") })
        assertEquals(2, seen.killsBeforeExec)                      // both audit lines were written before the script started
        assertEquals(listOf("kill:sweep end PID 2001 (tag) sleep 99", "kill:sweep end PID 2002 (tag) sleep 98"), order.take(2))
        assertEquals(3, order.size); assertTrue(order[2].startsWith("probe:")); assertTrue(r.clean)
    }

    @Test fun noAuditLineWhenNothingRuns() {
        val order = ArrayList<String>()
        val f = SrFake(SrClock(55_000L), probes = listOf(ShellResult(true, srProbe())))
        srGo(srView(srProbe(SR_ONE)), f, onKill = { order.add(it) })
        assertTrue(order.isEmpty())
    }

    @Test fun anExceptionFromTheShellIsAFailureNotACrash() {
        val r = srGo(srView(srProbe(SR_ONE)), SrFake(SrClock(), boom = true))
        assertFalse(r.clean); assertFalse(r.rescanRan)
        assertTrue(r.killLog.any { it.startsWith("sweep FAILED: could not run: su died") })
        assertTrue(r.notChecked.any { it.startsWith("process re-scan did not run") })
    }

    @Test fun sharedProcessesAreNotEndedAndAreReportedAsNotChecked() {
        val others = mapOf("new.js" to listOf("/data/local/x/beat.sh"))
        val shared = srProc(2002, "502", SR_PL, "sh /data/local/x/beat.sh")
        val f = SrFake(SrClock(), kill = ShellResult(true, srOut("MTKILL|2001|killed")))
        val r = srGo(srView(srProbe(SR_ONE, shared), others), f, others)
        assertTrue(f.killCalls()[0].first.contains("'2001:501'")); assertFalse(f.killCalls()[0].first.contains("2002"))   // the shared one is never in the script
        assertTrue(r.notChecked.any { it.startsWith("not stopped: PID 2002") && it.contains("also used by new.js") })
        assertTrue(r.clean)                                        // the rescan also leaves it alone: it is not this plugin's to stop
    }

    @Test fun aCutFirstScanIsNamedButStillLists() {
        val cut = srOut("MTSWEEP-SELF 900", "MTSWEEP|900|1|9|0||sh", SR_ONE)
        val f = SrFake(SrClock(), kill = ShellResult(true, srOut("MTKILL|2001|killed")))
        val r = srGo(srView(cut), f)
        assertEquals(1, f.killCalls().size); assertTrue(r.notChecked.any { it.contains("first scan was cut short") })
    }
}

class PluginSweepVerifyAndReportTest {
    private fun plan(code: String = "") = stopPlan("A.js", code, "ok", false, emptyList(), emptyList(), { null }, { it })
    private fun base(p: StopPlan, ok: Boolean = true) = verifyStop(p, 60_000L, 0L, { 0L }, { _, _ -> ShellResult(ok, "") })
    private fun sweep(counts: Boolean = true, ran: Boolean = true, left: List<String> = emptyList(), log: List<String> = emptyList(), notes: List<String> = emptyList()) =
        SweepStopResult(counts, log, ran, left, notes)
    private val withCmd = "// @matchi-uninstall echo one\n"
    private val withCheck = "// @matchi-uninstall echo one\n// @matchi-check true\n"
    private fun ok(p: StopPlan) = p.commands.map { CommandOutcome(it, "ok", "") }

    @Test fun stopModeRunsForAFoundProcessEvenWithoutHeaders() {
        val p = plan()
        assertEquals(StopMode.NONE, stopMode(true, false, p))                  // nothing declared, nothing found: as before
        assertEquals(StopMode.NONE, stopMode(true, false, p, 0))
        assertEquals(StopMode.RUN, stopMode(true, false, p, 1))                // D2: found processes make it a stop
        assertEquals(StopMode.NONE, stopMode(false, false, p, 3))              // no "stop" flag: never
        assertEquals(StopMode.SKIP, stopMode(true, true, p, 3))                // "Delete without stopping": never
    }

    @Test fun verifyRemembersHowManyChecksTheFileDeclared() {
        assertEquals(0, base(plan()).declared)
        assertEquals(0, base(plan(withCmd)).declared)
        assertEquals(1, base(plan(withCheck)).declared)
        assertEquals(2, base(plan(withCheck + "// @matchi-boot /data/local/matchitool/boot.d/30-x.sh\n")).declared)
        assertEquals(0, StopVerify.NOT_RUN.declared)
    }

    @Test fun aCleanRescanIsTheCheckForAPluginThatDeclaredNone() {
        val p = plan(withCmd); val v = withSweepVerify(base(p), sweep())
        assertTrue(v.checkRan); assertTrue(v.checkPassed); assertTrue(v.leftovers.isEmpty()); assertEquals(1, v.declared)
        // without the sweep, the Phase 1 rule is unchanged: nothing verified = never success
        assertFalse(base(p).checkRan); assertFalse(base(p).checkPassed)
    }

    @Test fun aFailedDeclaredCheckStillBlocksSuccessEvenWithACleanRescan() {
        val p = plan(withCheck); val v = withSweepVerify(base(p, ok = false), sweep())
        assertTrue(v.checkRan); assertFalse(v.checkPassed); assertEquals(1, v.leftovers.size)
    }

    @Test fun aPassedDeclaredCheckAndACleanRescanTogetherPass() {
        val p = plan(withCheck); val v = withSweepVerify(base(p), sweep())
        assertTrue(v.checkRan); assertTrue(v.checkPassed); assertEquals(2, v.declared)
    }

    @Test fun aRescanThatDidNotRunOrFoundSomethingBlocksSuccess() {
        val p = plan(withCheck)
        assertFalse(withSweepVerify(base(p), sweep(ran = false)).checkPassed)
        val left = withSweepVerify(base(p), sweep(left = listOf("process still running: PID 7 x (found by tag)")))
        assertFalse(left.checkPassed); assertEquals(listOf("process still running: PID 7 x (found by tag)"), left.leftovers)
        assertTrue(withSweepVerify(base(plan()), sweep(ran = false)).let { !it.checkRan && !it.checkPassed })
    }

    @Test fun anUncheckedFirstScanOrNoSweepLeavesTheVerificationAsPhase1MadeIt() {
        val p = plan(withCheck); val b = base(p)
        assertTrue(withSweepVerify(b, null) === b)
        assertTrue(withSweepVerify(b, sweep(counts = false, ran = false)) === b)
    }

    @Test fun reportForAPluginWithoutHeadersAndACleanSweepIsSuccess() {
        val p = plan(); val s = sweep(log = listOf("sweep: needed SIGKILL: PID 2001 (tag) sleep 99"))
        val r = stopReport(p, emptyList(), withSweepVerify(base(p), s), null, s)
        assertTrue(r.success); assertTrue(r.leftovers.isEmpty())
        assertTrue(r.log.contains("sweep: needed SIGKILL: PID 2001 (tag) sleep 99"))
        assertTrue(r.notChecked.contains("no check command declared")); assertTrue(r.notChecked.contains("no boot file declared"))   // D6: still said
    }

    @Test fun reportKeepsThePluginWhenSomethingIsStillRunning() {
        val p = plan(); val s = sweep(left = listOf("process still running: PID 3000 sleep 99 (found by tag)"))
        val r = stopReport(p, emptyList(), withSweepVerify(base(p), s), null, s)
        assertFalse(r.success); assertEquals(listOf("process still running: PID 3000 sleep 99 (found by tag)"), r.leftovers)
    }

    @Test fun reportNeverSaysStoppedWhenTheRescanDidNotRun() {
        val p = plan(withCheck); val s = sweep(ran = false, notes = listOf("process re-scan did not run (the 60 s total ran out)"))
        val r = stopReport(p, ok(p), withSweepVerify(base(p), s), null, s)
        assertFalse(r.success); assertTrue(r.notChecked.contains("process re-scan did not run (the 60 s total ran out)"))
    }

    @Test fun reportSuccessAlsoNeedsTheSweepToBeCleanEvenIfTheVerifyWasBuiltWithoutIt() {
        val p = plan(withCheck)
        val r = stopReport(p, ok(p), base(p), null, sweep(left = listOf("process still running: PID 1 x (found by tag)")))   // a caller that forgot withSweepVerify
        assertFalse(r.success)
    }

    @Test fun reportListsTheSharedOnesAsNotChecked() {
        val p = plan(); val s = sweep(notes = listOf("not stopped: PID 2002 sh /data/local/x/beat.sh: also used by new.js"))
        val r = stopReport(p, emptyList(), withSweepVerify(base(p), s), null, s)
        assertTrue(r.success)
        assertTrue(r.notChecked.contains("not stopped: PID 2002 sh /data/local/x/beat.sh: also used by new.js"))
    }

    @Test fun reportLogKeepsTheCommandLinesThenTheSweepLines() {
        val p = plan(withCheck); val s = sweep(log = listOf("sweep: ended after SIGTERM: PID 5 (tag) x"))
        val r = stopReport(p, ok(p), withSweepVerify(base(p), s), "Headline", s)
        val lines = r.log.lines()
        assertEquals("Headline", lines[0]); assertEquals("ok: echo one", lines[1]); assertEquals("sweep: ended after SIGTERM: PID 5 (tag) x", lines[2])
        assertTrue(r.success)
    }

    @Test fun aSweepLogLineWithANewlineStaysOneLine() {
        val p = plan(); val s = sweep(log = listOf("sweep FAILED: a\nb"))
        assertTrue(stopReport(p, emptyList(), base(p), null, s).log.lines().contains("sweep FAILED: a b"))
    }

    @Test fun reportWithoutASweepIsExactlyAsBefore() {
        val p = plan(withCheck)
        val r = stopReport(p, ok(p), base(p))
        assertTrue(r.success); assertEquals("ok: echo one", r.log)
        val noCheck = plan(withCmd)
        assertFalse(stopReport(noCheck, ok(noCheck), base(noCheck)).success)        // Phase 1 rule: commands but nothing verified is never success
    }

    @Test fun rootMissingReportKeepsTheShownProcessesAsNotStopped() {
        val p = plan(withCmd)
        val off = p.commands.map { CommandOutcome(it, "notRun", "root not available") }
        val s = SweepStopResult(true, emptyList(), false, emptyList(), listOf("not stopped (root not available): PID 2001 sleep 99"))
        val r = stopReport(p, off, StopVerify.NOT_RUN, "Could not stop: root not available", s)
        assertFalse(r.success); assertTrue(r.log.startsWith("Could not stop: root not available"))
        assertTrue(r.notChecked.contains("not stopped (root not available): PID 2001 sleep 99"))
    }
}

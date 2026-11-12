package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PluginUninstallTest {
    @Test fun readsUninstallCheckAndBootLinesInOrder() {
        val code = "// @matchi-uninstall rm -f /data/local/x/boot.sh\n//  @matchi-uninstall   sh /data/local/x/x.sh remove  \n" +
            "// @matchi-check test ! -e /data/local/x\n// @matchi-boot /data/local/matchitool/boot.d/20-x.sh\nvar a = 1;\n"
        val d = pluginUninstallDeclarations(code)
        assertEquals(listOf("rm -f /data/local/x/boot.sh", "sh /data/local/x/x.sh remove"), d.commands)
        assertEquals("test ! -e /data/local/x", d.check)
        assertEquals(listOf("/data/local/matchitool/boot.d/20-x.sh"), d.bootFiles)
        assertTrue(!d.isEmpty)
    }

    @Test fun aPluginWithoutHeadersGivesNothing() {
        val d = pluginUninstallDeclarations("(function(){ var a = 1; })();\n// @matchi-data /data/local/x\n// @matchi-needs at.read\n")
        assertTrue(d.isEmpty)
        assertNull(d.check)
        assertEquals(emptyList<String>(), d.bootFiles)
        assertTrue(pluginUninstallDeclarations("").isEmpty)
    }

    @Test fun aHeaderInsideCodeIsNotAHeader() {
        val code = "var s = '// @matchi-uninstall rm -rf /data/local/x'; // note @matchi-uninstall y\nvar t = \"// @matchi-check z\";\n/* // @matchi-boot /data/local/q */\n"
        val d = pluginUninstallDeclarations(code)
        assertTrue(d.isEmpty); assertNull(d.check); assertEquals(emptyList<String>(), d.bootFiles)
    }

    @Test fun duplicatesAreDroppedAndAtMostTenCommandsAreKept() {
        val dup = pluginUninstallDeclarations("// @matchi-uninstall a\n// @matchi-uninstall b\n// @matchi-uninstall a\n")
        assertEquals(listOf("a", "b"), dup.commands)
        val many = (1..15).joinToString("\n") { "// @matchi-uninstall cmd$it" }
        assertEquals((1..10).map { "cmd$it" }, pluginUninstallDeclarations(many).commands)
    }

    @Test fun badLinesAreDroppedAndDoNotUseUpTheLimit() {
        val ok300 = "x".repeat(300); val bad301 = "x".repeat(301)
        val code = "// @matchi-uninstall\n// @matchi-uninstall   \n// @matchi-uninstall $bad301\n// @matchi-uninstall a\tb\n" +
            "// @matchi-uninstall a\u0000b\n// @matchi-uninstall $ok300\n// @matchi-uninstall good\n"
        assertEquals(listOf(ok300, "good"), pluginUninstallDeclarations(code).commands)
        // 10 bad lines first, then 10 good ones: all 10 good ones are kept.
        val mixed = (1..10).joinToString("\n") { "// @matchi-uninstall bad\t$it" } + "\n" + (1..10).joinToString("\n") { "// @matchi-uninstall ok$it" }
        assertEquals((1..10).map { "ok$it" }, pluginUninstallDeclarations(mixed).commands)
    }

    @Test fun onlyTheFirstValidCheckCommandCounts() {
        assertEquals("first", pluginUninstallDeclarations("// @matchi-check first\n// @matchi-check second\n").check)
        assertEquals("second", pluginUninstallDeclarations("// @matchi-check a\tb\n// @matchi-check second\n").check)
        assertNull(pluginUninstallDeclarations("// @matchi-check\n// @matchi-check ${"x".repeat(301)}\n").check)
    }

    @Test fun bootPathsMustBePlainAbsolutePaths() {
        val good = "/data/local/matchitool/boot.d/20-x.sh"
        val bad = listOf("relative/path", "/data/local/x/../y", "/data/local//x", "/data/local/x/", "/data/local/a;rm", "/data/local/a'b", "/data/local/\$HOME", "/" + "a".repeat(201))
        val code = "// @matchi-boot $good\n" + bad.joinToString("\n") { "// @matchi-boot $it" } + "\n// @matchi-boot /data/local/two words\n"
        assertEquals(listOf(good), pluginUninstallDeclarations(code).bootFiles)
        val six = (1..8).joinToString("\n") { "// @matchi-boot /data/local/f$it" }
        assertEquals((1..5).map { "/data/local/f$it" }, pluginUninstallDeclarations(six).bootFiles)
    }

    @Test fun onlyTheFirst400LinesAreRead() {
        val filler = "var a = 1;\n".repeat(399)
        assertEquals(listOf("late"), pluginUninstallDeclarations(filler + "// @matchi-uninstall late\n").commands)
        assertTrue(pluginUninstallDeclarations(filler + "var b;\n// @matchi-uninstall tooLate\n").isEmpty)
    }

    @Test fun windowsLineEndingsWork() {
        val d = pluginUninstallDeclarations("// @matchi-uninstall one\r\n// @matchi-boot /data/local/f\r\n")
        assertEquals(listOf("one"), d.commands); assertEquals(listOf("/data/local/f"), d.bootFiles)
    }
}

/** Step 2: uninstall commands in the capability list, and the rules for which of them may run. */
class PluginUninstallRulesTest {
    private val none: (String) -> String? = { null }
    private val filter: (String) -> String? = { if (it.contains("wipe")) "wipes everything" else null }

    @Test fun uninstallCommandsAreCapabilitiesInFileOrderAfterTheOthers() {
        val src = "// @matchi-uninstall rm -f /data/local/x/a.sh\n// @matchi-uninstall sh /data/local/x/x.sh remove\nrunShellWithRoot('id'); fetch('https://a.com/x')"
        assertEquals(listOf("root", "net", "host:a.com", "unin:rm -f /data/local/x/a.sh", "unin:sh /data/local/x/x.sh remove"), pluginCaps(src, listOf("a.com")))
        assertEquals(listOf("unin:a", "unin:b"), uninstallCaps("// @matchi-uninstall a\n// @matchi-uninstall b\n"))
        assertTrue(uninstallCaps("var a = 1;").isEmpty())
    }

    @Test fun sandboxedAndTrustedListsBothCarryTheCommands() {
        val src = "// @matchi-needs at.read\n// @matchi-uninstall stopit\nvar a = 1;"
        assertEquals(listOf("sbx:at.read", "unin:stopit"), effectiveCaps(src, emptyList(), true))
        assertEquals(listOf("unin:stopit"), effectiveCaps(src, emptyList(), false))
    }

    @Test fun anUpdateThatAddsAnUninstallCommandIsShownAgain() {
        val approved = pluginCaps("// @matchi-uninstall one\n", emptyList())
        val now = pluginCaps("// @matchi-uninstall one\n// @matchi-uninstall two\n", emptyList())
        assertEquals(listOf("unin:two"), addedCaps(approved, now))
        assertTrue(addedCaps(approved, approved).isEmpty())
    }

    @Test fun theDialogLineNamesTheCommand() {
        assertEquals("when deleted with Stop, runs this root command: sh /data/local/x/x.sh remove", describeCap("unin:sh /data/local/x/x.sh remove"))
    }

    @Test fun uninstallEntriesNeverGrantAnythingInTheSandbox() {
        assertEquals(emptyList<String>(), sandboxGrant(listOf("unin:stopit"), "ok"))
        assertEquals(listOf("sbx:shell:stopit"), sandboxGrant(listOf("unin:stopit", "sbx:shell:stopit"), "ok"))
    }

    @Test fun aChangedFileCannotStopAnythingButUntrackedAndApprovedCan() {
        assertNull(stopBlockedReason("ok"))
        assertNull(stopBlockedReason("untracked"))
        assertTrue(stopBlockedReason("changed")!!.contains("approve"))
        assertTrue(stopBlockedReason("whatever") != null)
    }

    @Test fun theCommandFilterRefusesACommand() {
        assertEquals("refused by the command filter (wipes everything)", refuseUninstallCommand("wipe it", false, emptyList(), filter))
        assertNull(refuseUninstallCommand("rm -f /data/local/x/a.sh", false, emptyList(), filter))
    }

    @Test fun aSandboxedPluginMayOnlyRunACommandItWasApprovedFor() {
        val grant = listOf("sbx:shell:rm -f /data/local/x/a.sh")
        assertNull(refuseUninstallCommand("rm -f /data/local/x/a.sh", true, grant, none))
        assertTrue(refuseUninstallCommand("rm -f /data/local/x/b.sh", true, grant, none)!!.startsWith("not approved"))
        // exact text only: an added argument is a different command
        assertTrue(refuseUninstallCommand("rm -f /data/local/x/a.sh /data/local/y", true, grant, none) != null)
        // no grant at all (for example because the file changed): everything is refused
        assertTrue(refuseUninstallCommand("rm -f /data/local/x/a.sh", true, sandboxGrant(grant, "changed"), none) != null)
        // a trusted plugin needs no grant
        assertNull(refuseUninstallCommand("rm -f /data/local/x/b.sh", false, emptyList(), none))
    }

    @Test fun commandsAreSortedIntoRunAndRefused() {
        val d = pluginUninstallDeclarations("// @matchi-uninstall ok one\n// @matchi-uninstall wipe all\n// @matchi-uninstall ok two\n// @matchi-check wipe check\n")
        val r = checkUninstallCommands(d, false, emptyList(), filter)
        assertEquals(listOf("ok one", "ok two"), r.run)
        assertNull(r.check)
        assertEquals(listOf("wipe all", "wipe check"), r.refused.map { it.first })
        val d2 = pluginUninstallDeclarations("// @matchi-uninstall ok one\n// @matchi-check ok check\n")
        val r2 = checkUninstallCommands(d2, false, emptyList(), filter)
        assertEquals("ok check", r2.check); assertTrue(r2.refused.isEmpty())
    }

    @Test fun inTheSandboxEveryCommandAndTheCheckNeedItsOwnGrant() {
        val d = pluginUninstallDeclarations("// @matchi-uninstall one\n// @matchi-uninstall two\n// @matchi-check chk\n")
        val r = checkUninstallCommands(d, true, listOf("sbx:shell:one", "sbx:shell:chk"), none)
        assertEquals(listOf("one"), r.run)
        assertEquals("chk", r.check)
        assertEquals(listOf("two"), r.refused.map { it.first })
    }
}

class PluginStopPlanTest {
    private val filter: (String) -> String? = { if (it.startsWith("wipe")) "wipes everything" else null }
    private val noMap: (String) -> String = { it }
    private fun plan(code: String, integrity: String = "ok", sandboxed: Boolean = false, grant: List<String> = emptyList(),
                     others: List<Pair<String, String>> = emptyList(), name: String = "A.js", map: (String) -> String = noMap) =
        stopPlan(name, code, integrity, sandboxed, grant, others, filter, map)

    private val base = "// @matchi-uninstall rm -f /data/local/x/boot.sh\n// @matchi-uninstall sh /data/local/x/x.sh remove\n" +
        "// @matchi-check test ! -e /data/local/x\n// @matchi-boot /data/local/matchitool/boot.d/20-x.sh\n"

    @Test fun aPluginWithoutHeadersHasAnEmptyPlanAndNoHash() {
        val p = plan("(function(){})();\n")
        assertTrue(p.isEmpty); assertEquals("", p.planHash); assertNull(p.blocked); assertTrue(p.refused.isEmpty()); assertTrue(p.shared.isEmpty())
    }

    @Test fun theCommandsAreKeptInOrderAndTheHashIs64HexCharacters() {
        val p = plan(base)
        assertEquals(listOf("rm -f /data/local/x/boot.sh", "sh /data/local/x/x.sh remove"), p.commands)
        assertEquals("test ! -e /data/local/x", p.check)
        assertEquals(listOf("/data/local/matchitool/boot.d/20-x.sh"), p.bootFiles)
        assertTrue(Regex("^[0-9a-f]{64}$").matches(p.planHash))
        assertEquals(p.planHash, plan(base).planHash)
    }

    @Test fun theHashChangesWhenAnyHeaderChanges() {
        val h = plan(base).planHash
        assertTrue(h != plan(base.replace("remove", "remove2")).planHash)
        assertTrue(h != plan(base.replace("test ! -e", "test -e")).planHash)
        assertTrue(h != plan(base.replace("20-x.sh", "21-x.sh")).planHash)
        assertTrue(h != plan(base + "// @matchi-uninstall rmdir /data/local/y\n").planHash)
        // the same lines in another order are a different plan
        val swapped = "// @matchi-uninstall sh /data/local/x/x.sh remove\n// @matchi-uninstall rm -f /data/local/x/boot.sh\n"
        assertTrue(plan(base).planHash != plan(swapped + base.lines().drop(2).joinToString("\n")).planHash)
        // a text change outside the headers does not change what runs
        assertEquals(h, plan(base + "var changed = 2;\n").planHash)
    }

    @Test fun theHashCoversTheMappedTextThatReallyRuns() {
        val code = "// @matchi-uninstall rm -f /sdcard/ufi_tools_boot.sh\n"
        val mapped = plan(code, map = { UfiPathMap.map(it, "com.matchi.tool") })
        assertEquals(listOf("rm -f /data/local/matchitool/boot.sh"), mapped.commands)
        assertTrue(mapped.planHash != plan(code).planHash)
    }

    @Test fun aChangedFileBlocksTheWholePlan() {
        val p = plan(base, integrity = "changed")
        assertTrue(p.isEmpty); assertEquals("", p.planHash); assertNotNull(p.blocked)
        assertEquals(3, p.refused.size)   // two commands and the check, each with the reason
        assertTrue(p.refused.all { it.second.contains("approve") })
        assertNotNull(plan(base, integrity = "weird").blocked)
        // no headers: nothing to block
        assertNull(plan("var a;", integrity = "changed").blocked)
    }

    @Test fun anUntrackedFileMayStop() {
        val p = plan(base, integrity = "untracked")
        assertNull(p.blocked); assertEquals(2, p.commands.size)
    }

    @Test fun aCommandFilterRefusalIsListedAndNotRun() {
        val p = plan("// @matchi-uninstall wipe all\n// @matchi-uninstall ok one\n")
        assertEquals(listOf("ok one"), p.commands)
        assertEquals(listOf("wipe all"), p.refused.map { it.first })
    }

    @Test fun theFilterSeesTheMappedText() {
        val p = plan("// @matchi-uninstall run me\n", map = { "wipe " + it })
        assertTrue(p.isEmpty); assertEquals(1, p.refused.size)
    }

    @Test fun aSandboxedPluginRunsOnlyWhatItWasApprovedFor() {
        val code = "// @matchi-uninstall one\n// @matchi-uninstall two\n"
        val p = plan(code, sandboxed = true, grant = listOf("sbx:shell:one"))
        assertEquals(listOf("one"), p.commands); assertEquals(listOf("two"), p.refused.map { it.first })
        assertTrue(plan(code, sandboxed = true, grant = emptyList()).isEmpty)
    }

    @Test fun theGuardFindsAnotherPluginWithTheSameCommandOrBootFile() {
        val other = "// @matchi-uninstall sh /data/local/x/x.sh remove\n"
        val p = plan(base, others = listOf("B.js" to other, "C.js" to "var nothing;"))
        assertEquals(listOf("B.js"), p.shared)
        val sameBoot = plan(base, others = listOf("D.js" to "// @matchi-boot /data/local/matchitool/boot.d/20-x.sh\n"))
        assertEquals(listOf("D.js"), sameBoot.shared)
        // sharing does not change the hash
        assertEquals(plan(base).planHash, p.planHash)
    }

    @Test fun theGuardDoesNotTriggerForAPluginComparedWithItself() {
        assertTrue(plan(base, others = listOf("A.js" to base)).shared.isEmpty())
        assertTrue(plan(base, others = listOf("B.js" to "// @matchi-uninstall something else\n")).shared.isEmpty())
    }

    @Test fun theGuardComparesTheMappedText() {
        val map: (String) -> String = { UfiPathMap.map(it, "com.matchi.tool") }
        val a = "// @matchi-uninstall rm -f /sdcard/ufi_tools_boot.sh\n"
        val b = "// @matchi-uninstall rm -f /data/local/matchitool/boot.sh\n"
        assertEquals(listOf("B.js"), plan(a, others = listOf("B.js" to b), map = map).shared)
    }
}

class PluginStopRunTest {
    private fun plan(code: String, integrity: String = "ok") = stopPlan("A.js", code, integrity, false, emptyList(), emptyList(), { null }, { it })
    private val three = "// @matchi-uninstall one\n// @matchi-uninstall two\n// @matchi-uninstall three\n// @matchi-check chk\n// @matchi-boot /data/local/b.sh\n"

    /** A fake clock that moves only when a command "takes" time. */
    private class Clock(var t: Long = 0L) { fun now() = t }

    @Test fun commandsRunInOrderAndEachGetsTheTimeThatIsLeft() {
        val clock = Clock(); val seen = ArrayList<Pair<String, Long>>()
        val out = runStopCommands(listOf("a", "b", "c"), 60_000L, clock::now, { c, ms -> seen.add(c to ms); clock.t += 20_000L; ShellResult(true, "") })
        assertEquals(listOf("a" to 60_000L, "b" to 40_000L, "c" to 20_000L), seen)
        assertEquals(listOf("ok", "ok", "ok"), out.map { it.status })
    }

    @Test fun aFailedCommandDoesNotStopTheRest() {
        val out = runStopCommands(listOf("a", "b", "c"), 60_000L, { 0L }, { c, _ -> if (c == "b") ShellResult(false, "exit 1") else ShellResult(true, "") })
        assertEquals(listOf("ok", "failed", "ok"), out.map { it.status })
        assertEquals("exit 1", out[1].output)
    }

    @Test fun aTimeoutIsRecognisedAndTheTotalCanRunOut() {
        val clock = Clock(); val ran = ArrayList<String>()
        val out = runStopCommands(listOf("slow", "next", "last"), 60_000L, clock::now, { c, _ -> ran.add(c); clock.t += 60_000L; ShellResult(false, "partial\n[timeout after 60000ms]") })
        assertEquals(listOf("timeout", "notRun", "notRun"), out.map { it.status })
        assertEquals(listOf("slow"), ran)   // nothing is started with no time left
        assertTrue(out[1].output.contains("60 s"))
    }

    @Test fun lessThanASecondLeftMeansNotStarted() {
        val clock = Clock(); val ran = ArrayList<String>()
        val out = runStopCommands(listOf("a", "b"), 60_000L, clock::now, { c, _ -> ran.add(c); clock.t += 59_500L; ShellResult(true, "") })
        assertEquals(listOf("ok", "notRun"), out.map { it.status }); assertEquals(listOf("a"), ran)
    }

    @Test fun onRunIsCalledOnlyForCommandsThatStart() {
        val clock = Clock(); val audited = ArrayList<String>()
        runStopCommands(listOf("a", "b"), 60_000L, clock::now, { _, _ -> clock.t += 60_000L; ShellResult(true, "") }, { audited.add(it) })
        assertEquals(listOf("a"), audited)
    }

    @Test fun anExceptionFromTheShellIsAFailureNotACrash() {
        val out = runStopCommands(listOf("a"), 60_000L, { 0L }, { _, _ -> throw IllegalStateException("boom") })
        assertEquals("failed", out[0].status); assertTrue(out[0].output.contains("boom"))
    }

    @Test fun outputIsCut() {
        val out = runStopCommands(listOf("a"), 60_000L, { 0L }, { _, _ -> ShellResult(false, "x".repeat(5000)) })
        assertEquals(STOP_OUTPUT_MAX, out[0].output.length)
    }

    @Test fun theRequestDecidesWhatHappens() {
        val withCmds = plan(three); val none = plan("var a;"); val blocked = plan(three, "changed")
        assertEquals(StopMode.NONE, stopMode(false, false, withCmds))
        assertEquals(StopMode.NONE, stopMode(false, true, withCmds))
        assertEquals(StopMode.RUN, stopMode(true, false, withCmds))
        assertEquals(StopMode.SKIP, stopMode(true, true, withCmds))
        assertEquals(StopMode.NONE, stopMode(true, false, none))     // empty plan: as today
        assertEquals(StopMode.RUN, stopMode(true, false, blocked))   // everything refused: cannot succeed, plugin is kept
        assertEquals(StopMode.SKIP, stopMode(true, true, blocked))
    }

    @Test fun theHashMustMatch() {
        val p = plan(three)
        assertTrue(stopHashMatches(p.planHash, p))
        assertTrue(!stopHashMatches("", p))
        assertTrue(!stopHashMatches(plan(three + "// @matchi-uninstall four\n").planHash, p))
        assertTrue(stopHashMatches("", plan(three, "changed")))   // nothing to run: the hash is ""
    }

    private fun ok(vararg c: String) = c.map { CommandOutcome(it, "ok", "") }

    @Test fun successNeedsEveryCommandAndAPassedCheck() {
        val p = plan(three)
        assertTrue(stopReport(p, ok("one", "two", "three"), StopVerify(true, true, emptyList())).success)
        // never "stopped" when no check ran (Step 5 not in yet)
        val noCheck = stopReport(p, ok("one", "two", "three"), StopVerify.NOT_RUN)
        assertTrue(!noCheck.success); assertTrue(noCheck.notChecked.contains("check command did not run"))
        assertTrue(!stopReport(p, ok("one", "two", "three"), StopVerify(true, false, emptyList())).success)
        assertTrue(!stopReport(p, ok("one", "two", "three"), StopVerify(true, true, listOf("/data/local/x"))).success)
    }

    @Test fun oneFailedOrMissingCommandIsNotASuccess() {
        val p = plan(three); val v = StopVerify(true, true, emptyList())
        assertTrue(!stopReport(p, listOf(CommandOutcome("one", "ok", ""), CommandOutcome("two", "failed", "x"), CommandOutcome("three", "ok", "")), v).success)
        assertTrue(!stopReport(p, ok("one", "two"), v).success)
        val ranOut = stopReport(p, listOf(CommandOutcome("one", "ok", ""), CommandOutcome("two", "notRun", "the 60 s total ran out"), CommandOutcome("three", "notRun", "the 60 s total ran out")), v)
        assertTrue(!ranOut.success); assertEquals(2, ranOut.notChecked.count { it.startsWith("not run: ") })
    }

    @Test fun refusedCommandsAndBlockedPlansAreNeverASuccess() {
        val v = StopVerify(true, true, emptyList())
        val refused = stopReport(plan(three, "changed"), emptyList(), v)
        assertTrue(!refused.success); assertEquals(4, refused.notChecked.count { it.startsWith("refused: ") })
        val oneRefused = stopReport(stopPlan("A.js", three, "ok", true, listOf("sbx:shell:one"), emptyList(), { null }, { it }), ok("one"), v)
        assertTrue(!oneRefused.success)
    }

    @Test fun theReportListsWhatWasNotCheckedAndTheLog() {
        val p = plan("// @matchi-uninstall one\n")
        val r = stopReport(p, listOf(CommandOutcome("one", "failed", "line1\nline2")), StopVerify.NOT_RUN, "Could not stop")
        assertTrue(r.log.startsWith("Could not stop\n")); assertTrue(r.log.contains("FAILED: one - line1 line2"))
        assertTrue(r.notChecked.containsAll(listOf("no check command declared", "no boot file declared")))
    }
}

class PluginStopVerifyTest {
    private fun plan(code: String) = stopPlan("A.js", code, "ok", false, emptyList(), emptyList(), { null }, { it })
    private val both = "// @matchi-uninstall one\n// @matchi-check chk\n// @matchi-boot /data/local/matchitool/boot.d/20-x.sh\n// @matchi-boot /data/local/matchitool/boot.d/30-y.sh\n"
    private class Clock(var t: Long = 0L) { fun now() = t }
    private fun okAll(p: StopPlan) = p.commands.map { CommandOutcome(it, "ok", "") }

    @Test fun theProbeScriptQuotesEveryPathAndTheOutputIsParsed() {
        val s = bootProbeScript(listOf("/data/local/a.sh", "/data/local/b.sh"))
        assertTrue(s.contains("'/data/local/a.sh' '/data/local/b.sh'")); assertTrue(s.endsWith("; true"))
        assertEquals(listOf("/data/local/b.sh"), parseBootLeftovers("noise\nEXISTS /data/local/b.sh\nEXISTS /etc/other\n", listOf("/data/local/a.sh", "/data/local/b.sh")))
        assertEquals(emptyList<String>(), parseBootLeftovers("", listOf("/data/local/a.sh")))
    }

    @Test fun aPassingCheckAndGoneBootFilesPass() {
        val p = plan(both); val ran = ArrayList<String>()
        val v = verifyStop(p, 60_000L, 0L, { 0L }, { c, _ -> ran.add(c); ShellResult(true, "") })
        assertTrue(v.checkRan); assertTrue(v.checkPassed); assertTrue(v.leftovers.isEmpty()); assertTrue(v.notes.isEmpty())
        assertEquals(2, ran.size); assertEquals("chk", ran[0]); assertTrue(ran[1].startsWith("for p in "))
        assertTrue(stopReport(p, okAll(p), v).success)
    }

    @Test fun aFailingCheckIsALeftover() {
        val p = plan(both)
        val v = verifyStop(p, 60_000L, 0L, { 0L }, { c, _ -> if (c == "chk") ShellResult(false, "ttl.sh still running") else ShellResult(true, "") })
        assertTrue(v.checkRan); assertTrue(!v.checkPassed)
        assertTrue(v.leftovers.single().contains("ttl.sh still running"))
        assertTrue(!stopReport(p, okAll(p), v).success)
    }

    @Test fun aBootFileThatIsStillThereIsALeftover() {
        val p = plan(both)
        val v = verifyStop(p, 60_000L, 0L, { 0L }, { c, _ -> if (c == "chk") ShellResult(true, "") else ShellResult(true, "EXISTS /data/local/matchitool/boot.d/30-y.sh\n") })
        assertTrue(!v.checkPassed)
        assertEquals(listOf("boot file still there: /data/local/matchitool/boot.d/30-y.sh"), v.leftovers)
    }

    @Test fun aCheckThatCouldNotRunBlocksSuccessAndIsNamed() {
        val p = plan(both); val clock = Clock(60_000L)   // the 60 s were used up by the commands
        val ran = ArrayList<String>()
        val v = verifyStop(p, 60_000L, 0L, clock::now, { c, _ -> ran.add(c); ShellResult(true, "") })
        assertTrue(ran.isEmpty()); assertTrue(!v.checkRan); assertTrue(!v.checkPassed)
        assertEquals(2, v.notes.size)
        val r = stopReport(p, okAll(p), v)
        assertTrue(!r.success); assertTrue(r.notChecked.any { it.startsWith("check command did not run") })
        assertEquals(1, r.notChecked.count { it.startsWith("check command") })
    }

    @Test fun oneCheckThatRanAndOneThatDidNotIsNotASuccess() {
        val p = plan(both); val clock = Clock()
        // the check command uses 59.5 s; no time is left for the boot file test
        val v = verifyStop(p, 60_000L, 0L, clock::now, { _, _ -> clock.t += 59_500L; ShellResult(true, "") })
        assertTrue(v.checkRan); assertTrue(!v.checkPassed); assertEquals(1, v.notes.size)
    }

    @Test fun eachCheckGetsTheTimeThatIsLeft() {
        val p = plan(both); val clock = Clock(30_000L); val seen = ArrayList<Long>()
        verifyStop(p, 60_000L, 0L, clock::now, { _, ms -> seen.add(ms); clock.t += 10_000L; ShellResult(true, "") })
        assertEquals(listOf(30_000L, 20_000L), seen)
    }

    @Test fun aPluginWithoutAnyCheckHeaderNeverReportsStopped() {
        val p = plan("// @matchi-uninstall one\n")
        val v = verifyStop(p, 60_000L, 0L, { 0L }, { _, _ -> throw AssertionError("nothing should run") })
        assertTrue(!v.checkRan); assertTrue(!v.checkPassed)
        val r = stopReport(p, okAll(p), v)
        assertTrue(!r.success); assertTrue(r.notChecked.containsAll(listOf("no check command declared", "no boot file declared")))
    }

    @Test fun aCheckCommandAloneIsEnough() {
        val p = plan("// @matchi-uninstall one\n// @matchi-check chk\n")
        val v = verifyStop(p, 60_000L, 0L, { 0L }, { _, _ -> ShellResult(true, "") })
        assertTrue(stopReport(p, okAll(p), v).success)
    }

    @Test fun aBootFileListAloneIsEnough() {
        val p = plan("// @matchi-uninstall one\n// @matchi-boot /data/local/matchitool/boot.d/20-x.sh\n")
        assertTrue(stopReport(p, okAll(p), verifyStop(p, 60_000L, 0L, { 0L }, { _, _ -> ShellResult(true, "") })).success)
        val still = verifyStop(p, 60_000L, 0L, { 0L }, { _, _ -> ShellResult(true, "EXISTS /data/local/matchitool/boot.d/20-x.sh") })
        assertTrue(!stopReport(p, okAll(p), still).success)
    }

    @Test fun aFailingBootProbeIsNamedAndBlocksSuccess() {
        val p = plan("// @matchi-uninstall one\n// @matchi-boot /data/local/matchitool/boot.d/20-x.sh\n")
        val v = verifyStop(p, 60_000L, 0L, { 0L }, { _, _ -> ShellResult(false, "Root command capacity reached") })
        assertTrue(!v.checkRan); assertTrue(v.notes.single().startsWith("boot file test failed"))
        assertTrue(!stopReport(p, okAll(p), v).success)
    }

    @Test fun aBootPathWithUnusualCharactersIsNotProbed() {
        val p = StopPlan(listOf("one"), null, emptyList(), listOf("/data/local/a b", "/data/local/ok.sh"), null, emptyList(), "h")
        val ran = ArrayList<String>()
        val v = verifyStop(p, 60_000L, 0L, { 0L }, { c, _ -> ran.add(c); ShellResult(true, "") })
        assertTrue(!ran.single().contains("a b")); assertTrue(!v.checkPassed); assertTrue(v.notes.isNotEmpty())
    }

    @Test fun anExceptionFromTheShellIsAFailedCheck() {
        val p = plan("// @matchi-uninstall one\n// @matchi-check chk\n")
        val v = verifyStop(p, 60_000L, 0L, { 0L }, { _, _ -> throw IllegalStateException("boom") })
        assertTrue(v.checkRan); assertTrue(!v.checkPassed); assertTrue(v.leftovers.single().contains("boom"))
    }

    @Test fun theCheckRunsAreAudited() {
        val p = plan(both); val audited = ArrayList<String>()
        verifyStop(p, 60_000L, 0L, { 0L }, { _, _ -> ShellResult(true, "") }, { audited.add(it) })
        assertEquals(2, audited.size)
    }
}

class PluginSharedPathsTest {
    private val others = mapOf(
        "Stop_Example_New.js" to listOf("/data/local/stop_example"),
        "Other.js" to listOf("/data/local/other/cache"),
    )

    @Test fun theSameFolderIsSharedWithTheOtherPlugin() {
        assertEquals(listOf("Stop_Example_New.js"), pluginsUsingPath("/data/local/stop_example", others))
    }

    @Test fun aFolderInsideOrAroundAnotherPluginsFolderIsShared() {
        assertEquals(listOf("Stop_Example_New.js"), pluginsUsingPath("/data/local/stop_example/sub", others))
        assertEquals(listOf("Other.js"), pluginsUsingPath("/data/local/other", others))
    }

    @Test fun aLookalikeNameIsNotShared() {
        assertEquals(emptyList<String>(), pluginsUsingPath("/data/local/stop_example2", others))
        assertEquals(emptyList<String>(), pluginsUsingPath("/data/local/stop_exam", others))
    }

    @Test fun aTrailingSlashChangesNothing() {
        assertEquals(listOf("Stop_Example_New.js"), pluginsUsingPath("/data/local/stop_example/", others))
        assertEquals(listOf("Stop_Example_New.js"), pluginsUsingPath("/data/local/stop_example", mapOf("Stop_Example_New.js" to listOf("/data/local/stop_example/"))))
    }

    @Test fun severalPluginsAreListedInOrder() {
        val many = mapOf("b.js" to listOf("/data/local/x"), "a.js" to listOf("/data/local/x/y"), "c.js" to listOf("/data/local/z"))
        assertEquals(listOf("a.js", "b.js"), pluginsUsingPath("/data/local/x", many))
    }

    @Test fun nothingIsSharedWhenNoOtherPluginIsInstalled() {
        assertEquals(emptyList<String>(), pluginsUsingPath("/data/local/stop_example", emptyMap()))
    }

    @Test fun blankPathsNeverOverlap() {
        assertTrue(!pathsOverlap("", "/data/local/x"))
        assertTrue(!pathsOverlap("/", "/data/local/x"))
        assertEquals(emptyList<String>(), pluginsUsingPath("", others))
    }
}

class PluginCommandPathsTest {
    @Test fun foldersInStopCommandsAreFound() {
        val cmds = listOf(
            "rm -f /data/local/matchitool/boot.d/30-stop-example.sh",
            "[ ! -f /data/local/stop_example/beat.sh ] || sh /data/local/stop_example/beat.sh stop",
            "rm -rf /data/local/stop_example",
        )
        val p = commandPaths(cmds, "! ps -A -o ARGS 2>/dev/null | grep -q 'stop_example/beat.sh' && [ ! -e /data/local/stop_example ]")
        assertTrue("/data/local/stop_example" in p)
        assertTrue("/data/local/stop_example/beat.sh" in p)
        assertTrue("/dev/null" !in p)
    }

    @Test fun shortAndRelativePathsAreIgnored() {
        assertEquals(emptyList<String>(), commandPaths(listOf("cd /data/local", "ls /sdcard", "echo a/b/c"), null))
    }

    @Test fun aDeclaredFolderMakesThePathSharedWithThatPlugin() {
        val others = mapOf("Stop_Example_New.js" to commandPaths(listOf("rm -rf /data/local/stop_example"), null))
        assertEquals(listOf("Stop_Example_New.js"), pluginsUsingPath("/data/local/stop_example", others))
        assertEquals(emptyList<String>(), pluginsUsingPath("/data/local/stop_example2", others))
    }

    @Test fun noCommandsGiveNoPaths() {
        assertEquals(emptyList<String>(), commandPaths(emptyList(), null))
    }
}

package com.matchi.tool

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Phase 3 / Step 2: the undo script (undoScript), what it says (parseUndoRun), the undo step of a stop (runUndoStop) and how it folds into the report (withUndo).
 * The script runs in a REAL sh here, against a fake iptables / ip6tables (a state file) and a fake stat, so what it does to rules, chains and files is checked,
 * not only its text. Needs sh and awk (Linux, like the Phase 2 kill script tests).
 */
private const val UR_BOOT = "/data/local/matchitool/boot.d/20-bypass-ttl.sh"

private fun urChain(table: String = "mangle", chain: String = "MY_CHAIN", tool: String = "iptables") = UndoItem("chain", "firewall chain $chain ($tool, table $table)", table = table, chain = chain, tool = tool)
private fun urBoot(path: String = UR_BOOT) = UndoItem("boot", "boot script ${path.substringAfterLast('/')}", path = path)
private fun urPlan(vararg items: UndoItem) = UndoPlan(items.toList(), emptyList(), undoHash(items.toList()))

private val UR_FAKE_IPT = """
#!/bin/sh
case "^(basename "^0")" in ip6tables) F="^FW6";; *) F="^FW4";; esac
[ "^1" = "-t" ] || exit 2
T=^2; shift 2
op=^1; shift
case "^op" in
  -S)
    [ "^FAIL_S" = 1 ] && exit 1
    if [ -n "^1" ]; then
      awk -v T="^T" -v c="^1" 'BEGIN{FS="|"} ^1!=T{next} {line=substr(^0,length(^1)+2)} line=="-N " c||index(line,"-P " c " ")==1{decl=line;found=1} index(line,"-A " c " ")==1{r[++n]=line} END{if(!found)exit 1;print decl;for(i=1;i<=n;i++)print r[i]}' "^F"
    else
      awk -v T="^T" 'BEGIN{FS="|"} ^1!=T{next} {line=substr(^0,length(^1)+2)} index(line,"-A ")==1{r[++n]=line;next} {print line} END{for(i=1;i<=n;i++)print r[i]}' "^F"
    fi ;;
  -D)
    [ "^FAIL_D" = 1 ] && exit 1
    awk -v T="^T" -v c="^1" -v k="^2" 'BEGIN{FS="|"} {line=substr(^0,length(^1)+2)} ^1==T&&index(line,"-A " c " ")==1{i++; if(i==k){d=1;next}} {print} END{exit d?0:1}' "^F" >"^F.new"; rc=^?
    if [ ^rc = 0 ]; then mv "^F.new" "^F"; else rm -f "^F.new"; fi; exit ^rc ;;
  -F)
    awk -v T="^T" -v c="^1" 'BEGIN{FS="|"} {line=substr(^0,length(^1)+2)} ^1==T&&index(line,"-A " c " ")==1{next} {print}' "^F" >"^F.new" && mv "^F.new" "^F" ;;
  -X)
    awk -v T="^T" -v c="^1" 'BEGIN{FS="|"} {line=substr(^0,length(^1)+2)} ^1==T&&line=="-N " c{found=1} ^1==T&&index(line,"-A ")==1{ if(index(line,"-A " c " ")==1)busy=1; n=split(line,w," "); if(n>=2&&(w[n-1]=="-j"||w[n-1]=="-g")&&w[n]==c)busy=1 } END{exit (found&&!busy)?0:1}' "^F" || exit 1
    awk -v T="^T" -v c="^1" 'BEGIN{FS="|"} {line=substr(^0,length(^1)+2)} ^1==T&&line=="-N " c{next} {print}' "^F" >"^F.new" && mv "^F.new" "^F" ;;
  *) exit 2 ;;
esac
""".trimIndent().replace('^', '$') + "\n"

private val UR_FAKE_STAT = "#!/bin/sh\ncase \"\$3\" in *owned-by-other*) echo 1000;; *) echo 0;; esac\n"

/** A scratch world: fake tools first on PATH, state files for iptables (v4) and ip6tables (v6), and a folder standing in for "/" (the script's pathPrefix). */
private class UrWorld(withIp6: Boolean = true) {
    val dir: File = Files.createTempDirectory("mtundo").toFile()
    val bin = File(dir, "bin").apply { mkdirs() }
    val root = File(dir, "root").apply { mkdirs() }
    val fw4 = File(dir, "fw4"); val fw6 = File(dir, "fw6")
    var failD = false
    var failS = false
    init {
        fun tool(n: String, text: String) = File(bin, n).apply { writeText(text); setExecutable(true) }
        tool("iptables", UR_FAKE_IPT); if (withIp6) tool("ip6tables", UR_FAKE_IPT); tool("stat", UR_FAKE_STAT)
        fw4.writeText(""); fw6.writeText("")
    }
    fun v4(vararg l: String) { fw4.writeText(l.joinToString("\n", postfix = "\n")) }
    fun v6(vararg l: String) { fw6.writeText(l.joinToString("\n", postfix = "\n")) }
    fun rules(f: File = fw4) = f.readLines().filter { it.isNotEmpty() }
    fun bootDir() = File(root, "data/local/matchitool/boot.d").apply { mkdirs() }
    fun exec(script: String, ms: Long): ShellResult {
        val pb = ProcessBuilder("sh", "-c", script).redirectErrorStream(true)
        pb.environment()["PATH"] = bin.absolutePath + ":/usr/bin:/bin"
        pb.environment()["FW4"] = fw4.absolutePath; pb.environment()["FW6"] = fw6.absolutePath
        if (failD) pb.environment()["FAIL_D"] = "1"
        if (failS) pb.environment()["FAIL_S"] = "1"
        val p = pb.start(); val out = p.inputStream.bufferedReader().readText(); val rc = p.waitFor()
        return ShellResult(rc == 0, out)
    }
    fun run(plan: UndoPlan): UndoStopResult = runUndoStop(plan, 60_000L, 0L, { 0L }, this::exec, pathPrefix = root.absolutePath)
    fun verify(plan: UndoPlan): UndoVerify = verifyUndo(plan, 60_000L, 0L, { 0L }, this::exec, pathPrefix = root.absolutePath)
    fun close() { dir.deleteRecursively() }
}

private val UR_SYSTEM = listOf("mangle|-P PREROUTING ACCEPT", "mangle|-P POSTROUTING ACCEPT", "mangle|-N OTHER")

class PluginUndoScriptTest {
    @Test fun noScriptForNothingOrForAnUnsafeItem() {
        assertNull(undoScript(UndoPlan(emptyList(), emptyList(), "")))
        assertNull(undoScript(urPlan(urChain(table = "mangle; reboot"))))
        assertNull(undoScript(urPlan(urChain(chain = "INPUT"))))                          // a built-in chain
        assertNull(undoScript(urPlan(urChain(chain = "X\$(id)"))))
        assertNull(undoScript(urPlan(urChain(tool = "nft"))))
        assertNull(undoScript(urPlan(urBoot("/data/local/matchitool/boot.sh"))))
        assertNull(undoScript(urPlan(urBoot("/data/local/matchitool/boot.d/../x/20-a.sh"))))
        assertNull(undoScript(urPlan(urChain(), UndoItem("other", "x"))))                  // one bad item: nothing runs at all
        assertNull(undoScript(urPlan(urBoot()), pathPrefix = "/tmp/x y;reboot"))
        assertNotNull(undoScript(urPlan(urChain(), urBoot())))
    }

    @Test fun bothScriptsWaitForTheFirewallLockOnlyWhereIptablesKnowsIt() {
        val u = undoScript(urPlan(urChain()))!!
        val v = undoVerifyScript(urPlan(urChain()))!!
        for (s in listOf(u, v)) {
            assertTrue(s.contains("-w 5 -t"))                                      // one detection call with the fixed words "-w 5"
            assertTrue(s.contains("W=\"-w 5\""))
            assertTrue(s.contains("\"\$IPT\" \$W -t"))                              // every later call uses \$W, which is empty when -w is not known
        }
        assertFalse(Regex("\"\\\$IPT\" -t").containsMatchIn(u))                  // no call is left without \$W
        assertFalse(Regex("\"\\\$IPT\" -t").containsMatchIn(v))
    }

    @Test fun theScriptEvaluatesNothingAndNeverTouchesAParentChain() {
        val s = undoScript(urPlan(urChain(), urBoot()))!!
        assertFalse(s.contains("eval"))
        assertFalse(Regex("-[FX] \"\\\$p\"|-[FX] \"\\\$JP\"").containsMatchIn(s))          // a parent is only read; the rule is removed by number
        assertTrue(s.contains("-D \"\$IPT\" \"\$JP\" \"\$JN\"") || s.contains("-D \"\$JP\" \"\$JN\""))
        assertTrue(s.contains("undo_chain 'mangle' 'MY_CHAIN' 'iptables'"))
        assertTrue(s.contains("undo_boot '$UR_BOOT'"))
    }

    @Test fun aTableTheKernelDoesNotHaveIsAbsentButOtherReadErrorsStayErrors() {
        val s = undoVerifyScript(urPlan(urChain()))!!
        assertTrue(s.contains("Table does not exist")); assertTrue(s.contains("can't initialize"))
        assertTrue(s.contains("|error")); assertTrue(s.contains("|absent"))
        assertFalse(s.contains("2>/dev/null) || {"))   // a failed list is no longer an unconditional "error"
    }

    @Test fun parserKeepsOnlyKnownAnswers() {
        val a = parseUndoRun(
            "MTUNDO|chain|mangle|MY_CHAIN|iptables|removed\nMTUNDO|jumps|mangle|MY_CHAIN|iptables|2\nMTUNDO|boot|$UR_BOOT|refused-owner\n" +
                "MTUNDO|chain|mangle|MY_CHAIN|ip6tables|exploded\nMTUNDO|chain|mangle|INPUT|iptables|removed\nMTUNDO|boot|/etc/passwd|removed\nMTUNDO|jumps|mangle|MY_CHAIN|iptables|x\nnoise\n",
        )
        assertEquals(mapOf("chain mangle MY_CHAIN iptables" to "removed", "boot $UR_BOOT" to "refused-owner"), a.status)
        assertEquals(mapOf("mangle MY_CHAIN iptables" to 2), a.jumps)
        assertTrue(parseUndoRun("").status.isEmpty())
    }
}

class PluginUndoShellTest {
    private fun <T> world(withIp6: Boolean = true, f: (UrWorld) -> T): T { val w = UrWorld(withIp6); try { return f(w) } finally { w.close() } }

    @Test fun chainAndEveryJumpToItAreRemovedAndNothingElseIsTouched() = world { w ->
        w.v4(*UR_SYSTEM.toTypedArray(), "mangle|-N MY_CHAIN",
            "mangle|-A POSTROUTING -j MY_CHAIN", "mangle|-A POSTROUTING -o wlan0 -j ACCEPT", "mangle|-A POSTROUTING -p tcp -g MY_CHAIN",
            "mangle|-A OTHER -s 10.0.0.1/32 -j MY_CHAIN", "mangle|-A OTHER -j ACCEPT",
            "mangle|-A MY_CHAIN -p tcp -j TCPMSS --set-mss 1300",
            "nat|-N MY_CHAIN", "nat|-A MY_CHAIN -j RETURN")
        val r = w.run(urPlan(urChain()))
        assertTrue(r.clean)
        assertTrue(r.log.joinToString("\n"), r.log.any { it.startsWith("undo: removed firewall chain MY_CHAIN") && it.contains("3 jump rule(s)") })
        assertEquals(listOf(*UR_SYSTEM.toTypedArray(), "nat|-N MY_CHAIN", "mangle|-A POSTROUTING -o wlan0 -j ACCEPT", "mangle|-A OTHER -j ACCEPT", "nat|-A MY_CHAIN -j RETURN").sorted(), w.rules().sorted())
    }

    @Test fun twoJumpsInOneParentAreBothRemovedEvenThoughNumbersShift() = world { w ->
        w.v4("mangle|-P POSTROUTING ACCEPT", "mangle|-N MY_CHAIN", "mangle|-A POSTROUTING -j MY_CHAIN", "mangle|-A POSTROUTING -j MY_CHAIN", "mangle|-A POSTROUTING -j ACCEPT")
        assertTrue(w.run(urPlan(urChain())).clean)
        assertEquals(listOf("mangle|-P POSTROUTING ACCEPT", "mangle|-A POSTROUTING -j ACCEPT"), w.rules())
    }

    @Test fun aChainThatIsNotThereIsAbsentAndNothingChanges() = world { w ->
        w.v4(*UR_SYSTEM.toTypedArray(), "mangle|-A POSTROUTING -j ACCEPT")
        val before = w.rules()
        val r = w.run(urPlan(urChain()))
        assertTrue(r.clean)
        assertTrue(r.log.single().startsWith("undo: already gone"))
        assertEquals(before, w.rules())
    }

    @Test fun aCommentThatSaysJumpIsNotAJump() = world { w ->
        w.v4("mangle|-P POSTROUTING ACCEPT", "mangle|-N MY_CHAIN", "mangle|-A POSTROUTING -m comment --comment \"x -j MY_CHAIN\"", "mangle|-A POSTROUTING -j MY_CHAIN")
        assertTrue(w.run(urPlan(urChain())).clean)
        assertEquals(listOf("mangle|-P POSTROUTING ACCEPT", "mangle|-A POSTROUTING -m comment --comment \"x -j MY_CHAIN\""), w.rules())   // the comment rule stays
    }

    @Test fun aJumpThatCannotBeRemovedKeepsTheChainUnflushed() = world { w ->
        w.v4("mangle|-P POSTROUTING ACCEPT", "mangle|-N MY_CHAIN", "mangle|-A POSTROUTING -j MY_CHAIN", "mangle|-A MY_CHAIN -j ACCEPT")
        val before = w.rules(); w.failD = true
        val r = w.run(urPlan(urChain()))
        assertFalse(r.clean)
        assertEquals(listOf("still there: firewall chain MY_CHAIN (iptables, table mangle)"), r.leftovers)
        assertEquals(before, w.rules())                                       // not flushed while something still jumps to it
    }

    @Test fun ip4AndIp6AreSeparateAndAMissingToolIsReported() = world(withIp6 = false) { w ->
        w.v4("mangle|-N A", "mangle|-A A -j ACCEPT")
        val r = w.run(urPlan(urChain(chain = "A"), urChain(chain = "A", tool = "ip6tables")))
        assertFalse(r.clean)
        assertTrue(w.rules().isEmpty())                                       // the iptables chain went; ip6tables is not on this device, so that item is reported
        assertTrue(r.leftovers.single().contains("ip6tables not found"))
    }

    @Test fun bootScriptRules() = world { w ->
        val d = w.bootDir()
        File(d, "20-bypass-ttl.sh").writeText("echo hi")
        val r = w.run(urPlan(urBoot()))
        assertTrue(r.clean); assertFalse(File(d, "20-bypass-ttl.sh").exists())
        assertTrue(w.run(urPlan(urBoot())).log.single().startsWith("undo: already gone"))                   // absent
        val real = File(d, "30-real.sh").apply { writeText("x") }
        Files.createSymbolicLink(File(d, "31-link.sh").toPath(), real.toPath())
        val s = w.run(urPlan(urBoot("/data/local/matchitool/boot.d/31-link.sh")))
        assertFalse(s.clean); assertTrue(File(d, "31-link.sh").exists()); assertTrue(real.exists())        // a symlink is never followed or removed
        File(d, "32-dir.sh").mkdirs()
        assertFalse(w.run(urPlan(urBoot("/data/local/matchitool/boot.d/32-dir.sh"))).clean); assertTrue(File(d, "32-dir.sh").isDirectory)
        File(d, "33-owned-by-other.sh").writeText("x")
        val o = w.run(urPlan(urBoot("/data/local/matchitool/boot.d/33-owned-by-other.sh")))
        assertFalse(o.clean); assertTrue(File(d, "33-owned-by-other.sh").exists()); assertTrue(o.leftovers.single().contains("owner check failed"))
    }

    @Test fun aSymlinkedBootDirRefusesEverything() = world { w ->
        val real = File(w.dir, "elsewhere").apply { mkdirs() }; File(real, "20-bypass-ttl.sh").writeText("x")
        val m = File(w.root, "data/local/matchitool").apply { parentFile.mkdirs() }
        Files.createSymbolicLink(m.toPath(), real.toPath())
        val r = w.run(urPlan(urBoot()))
        assertFalse(r.clean); assertTrue(File(real, "20-bypass-ttl.sh").exists())
    }

    @Test fun chainsThenBootInOneRun() = world { w ->
        w.v4("mangle|-P POSTROUTING ACCEPT", "mangle|-N MY_CHAIN", "mangle|-A POSTROUTING -j MY_CHAIN")
        File(w.bootDir(), "20-bypass-ttl.sh").writeText("x")
        val r = w.run(urPlan(urChain(), urBoot()))
        assertTrue(r.log.joinToString("\n"), r.clean && r.log.size == 2)
        assertEquals(listOf("mangle|-P POSTROUTING ACCEPT"), w.rules())
    }
}

class PluginUndoStopTest {
    private val plan = urPlan(urChain(), urBoot())
    private fun ok(vararg l: String) = ShellResult(true, l.joinToString("\n") + "\nMTUNDO-END\n")

    @Test fun nothingToUndoRunsNothing() {
        var calls = 0
        val r = runUndoStop(UndoPlan(emptyList(), emptyList(), ""), 60_000L, 0L, { 0L }, { _, _ -> calls++; ShellResult(true, "") })
        assertEquals(0, calls); assertFalse(r.counts); assertTrue(r.clean)
    }

    @Test fun cleanAnswersAreCleanAndOneAuditLinePerItemComesFirst() {
        val seen = ArrayList<String>(); var execAfter = -1
        val r = runUndoStop(plan, 60_000L, 0L, { 0L }, { _, _ -> execAfter = seen.size; ok("MTUNDO|chain|mangle|MY_CHAIN|iptables|removed", "MTUNDO|boot|$UR_BOOT|absent") }, { seen.add(it) })
        assertTrue(r.clean); assertEquals(2, execAfter)
        assertEquals(listOf("undo firewall chain MY_CHAIN (iptables, table mangle)", "undo boot script 20-bypass-ttl.sh"), seen)
    }

    @Test fun everyNonCleanAnswerIsALeftover() {
        val r = runUndoStop(plan, 60_000L, 0L, { 0L }, { _, _ -> ok("MTUNDO|chain|mangle|MY_CHAIN|iptables|failed") })
        assertFalse(r.clean); assertEquals(2, r.leftovers.size)                       // the chain failed, the boot script got no answer
        assertTrue(r.leftovers[1].contains("no answer"))
        val t = runUndoStop(plan, 60_000L, 0L, { 0L }, { _, _ -> ShellResult(false, "x\n[timeout after 20 s]") })
        assertFalse(t.clean); assertTrue(t.log.any { it.startsWith("undo TIMEOUT") })
        val e = runUndoStop(plan, 60_000L, 0L, { 0L }, { _, _ -> throw IllegalStateException("su died") })
        assertFalse(e.clean); assertTrue(e.log.any { it.contains("su died") })
    }

    @Test fun notStartedWithUnderFiveSecondsLeft() {
        var calls = 0
        val r = runUndoStop(plan, 60_000L, 0L, { 56_000L }, { _, _ -> calls++; ok() })
        assertEquals(0, calls); assertFalse(r.clean); assertFalse(r.ran)
        assertEquals(2, r.leftovers.size); assertTrue(r.notChecked.single().startsWith("undo did not run"))
    }

    @Test fun theScriptGetsWhatIsLeftButAtMostTwentySeconds() {
        val ms = ArrayList<Long>()
        runUndoStop(plan, 60_000L, 0L, { 0L }, { _, m -> ms.add(m); ok() })
        runUndoStop(plan, 60_000L, 0L, { 50_000L }, { _, m -> ms.add(m); ok() })
        assertEquals(listOf(20_000L, 10_000L), ms)
    }

    @Test fun anUnsafeItemRunsNothing() {
        var calls = 0
        val r = runUndoStop(urPlan(urChain(chain = "INPUT")), 60_000L, 0L, { 0L }, { _, _ -> calls++; ok() })
        assertEquals(0, calls); assertFalse(r.clean)
    }

    @Test fun withUndoNeverTurnsAFailureIntoSuccess() {
        val base = StopReport(true, "ok: x", emptyList(), emptyList(), emptyList())
        val bad = UndoStopResult(true, true, listOf("undo: FAILED y"), listOf("still there: y"), emptyList())
        val r = withUndo(base, bad)
        assertFalse(r.success); assertEquals(listOf("still there: y"), r.leftovers); assertEquals("ok: x\nundo: FAILED y", r.log)
        assertTrue(withUndo(base, UndoStopResult(true, true, listOf("undo: removed y"), emptyList(), emptyList())).success)
        assertTrue(withUndo(base, null).success); assertTrue(withUndo(base, UndoStopResult(false, false, emptyList(), emptyList(), emptyList())).success)
        assertFalse(withUndo(StopReport(false, "", emptyList(), emptyList(), emptyList()), UndoStopResult(true, true, emptyList(), emptyList(), emptyList())).success)
    }

    @Test fun somethingToUndoMakesTheStopRunEvenWithoutHeaders() {
        val none = stopPlan("a.js", "// nothing", "ok", false, emptyList(), emptyList(), { null }, { it })
        assertEquals(StopMode.NONE, stopMode(true, false, none))
        assertEquals(StopMode.RUN, stopMode(true, false, none, 0, 1))
        assertEquals(StopMode.SKIP, stopMode(true, true, none, 0, 1))
        assertEquals(StopMode.NONE, stopMode(false, false, none, 0, 1))
    }
}

class PluginUndoVerifyTest {
    private fun <T> world(withIp6: Boolean = true, f: (UrWorld) -> T): T { val w = UrWorld(withIp6); try { return f(w) } finally { w.close() } }
    private val plan = urPlan(urChain(), urBoot())
    private fun chk(vararg l: String) = ShellResult(true, l.joinToString("\n") + "\nMTCHK-END\n")

    @Test fun noScriptForNothingOrForAnUnsafeItem() {
        assertNull(undoVerifyScript(UndoPlan(emptyList(), emptyList(), "")))
        assertNull(undoVerifyScript(urPlan(urChain(chain = "INPUT"))))
        assertNull(undoVerifyScript(urPlan(urBoot("/etc/cron.d/20-a.sh"))))
        assertNull(undoVerifyScript(urPlan(urChain(), UndoItem("other", "x"))))
        val s = undoVerifyScript(plan)!!
        assertFalse(s.contains("eval")); assertFalse(Regex("-[DFX] ").containsMatchIn(s)); assertFalse(s.contains("rm "))   // read-only
    }

    @Test fun parserKeepsOnlyKnownAnswers() {
        val m = parseUndoVerify("MTCHK|chain|mangle|MY_CHAIN|iptables|present\nMTCHK|boot|$UR_BOOT|absent\nMTCHK|chain|mangle|MY_CHAIN|ip6tables|weird\nMTCHK|boot|/etc/x|present\nMTCHK|boot|$UR_BOOT|error\nx")
        assertEquals(mapOf("chain mangle MY_CHAIN iptables" to "present", "boot $UR_BOOT" to "absent"), m)
    }

    @Test fun realShellSeesWhatIsLeftAndWhatIsGone() = world { w ->
        w.v4("mangle|-P POSTROUTING ACCEPT", "mangle|-N MY_CHAIN", "nat|-N OTHER")
        File(w.bootDir(), "20-bypass-ttl.sh").writeText("x")
        val a = w.verify(plan)
        assertTrue(a.ran); assertEquals(listOf("still there: firewall chain MY_CHAIN (iptables, table mangle)", "still there: boot script 20-bypass-ttl.sh"), a.leftovers)
        w.v4("mangle|-P POSTROUTING ACCEPT", "nat|-N MY_CHAIN")                      // same name in ANOTHER table is not this chain
        File(w.bootDir(), "20-bypass-ttl.sh").delete()
        val b = w.verify(plan); assertTrue(b.ran); assertTrue(b.leftovers.isEmpty()); assertTrue(b.notes.isEmpty())
    }

    @Test fun aDanglingSymlinkCountsAsStillThere() = world { w ->
        Files.createSymbolicLink(File(w.bootDir(), "20-bypass-ttl.sh").toPath(), File(w.dir, "nowhere").toPath())
        assertEquals(listOf("still there: boot script 20-bypass-ttl.sh"), w.verify(urPlan(urBoot())).leftovers)
    }

    @Test fun anUnreadableTableIsNeverTakenForGone() = world { w ->
        w.v4("mangle|-P POSTROUTING ACCEPT"); w.failS = true
        val r = w.verify(urPlan(urChain()))
        assertFalse(r.ran); assertTrue(r.leftovers.isEmpty()); assertTrue(r.notes.single().contains("could not be read"))
    }

    @Test fun aMissingToolIsNeverTakenForGone() = world(withIp6 = false) { w ->
        val r = w.verify(urPlan(urChain(tool = "ip6tables")))
        assertFalse(r.ran); assertTrue(r.notes.single().contains("ip6tables not found"))
    }

    @Test fun notStartedWithUnderASecondLeft() {
        var calls = 0
        val r = verifyUndo(plan, 60_000L, 0L, { 59_500L }, { _, _ -> calls++; chk() })
        assertEquals(0, calls); assertTrue(r.counts); assertFalse(r.ran); assertTrue(r.notes.single().startsWith("undo re-check did not run"))
    }

    @Test fun oneAuditLineAndAnAnswerForEveryItemIsNeeded() {
        val seen = ArrayList<String>()
        val full = verifyUndo(plan, 60_000L, 0L, { 0L }, { _, _ -> chk("MTCHK|chain|mangle|MY_CHAIN|iptables|absent", "MTCHK|boot|$UR_BOOT|absent") }, { seen.add(it) })
        assertTrue(full.ran); assertEquals(1, seen.size)
        val half = verifyUndo(plan, 60_000L, 0L, { 0L }, { _, _ -> chk("MTCHK|chain|mangle|MY_CHAIN|iptables|absent") })
        assertFalse(half.ran); assertTrue(half.notes.single().contains("no answer"))
        val dead = verifyUndo(plan, 60_000L, 0L, { 0L }, { _, _ -> throw IllegalStateException("su died") })
        assertFalse(dead.ran); assertTrue(dead.notes.any { it.contains("su died") })
    }

    @Test fun aCleanReCountsAsTheCheckForAPluginWithoutOne() {
        val noCheck = StopVerify(false, false, emptyList())                      // nothing declared, no sweep: today this can never succeed
        val ok = withUndoVerify(noCheck, UndoVerify(true, true, emptyList(), emptyList()))
        assertTrue(ok.checkRan); assertTrue(ok.checkPassed)
        val still = withUndoVerify(noCheck, UndoVerify(true, true, listOf("still there: x"), emptyList()))
        assertTrue(still.checkRan); assertFalse(still.checkPassed); assertEquals(listOf("still there: x"), still.leftovers)
        val blind = withUndoVerify(noCheck, UndoVerify(true, false, emptyList(), listOf("re-check gave no answer for x")))
        assertFalse(blind.checkRan); assertFalse(blind.checkPassed)             // "undone" is never said when the look did not run
        assertTrue(withUndoVerify(noCheck, null) === noCheck); assertTrue(withUndoVerify(noCheck, UndoVerify(false, false, emptyList(), emptyList())) === noCheck)
    }

    @Test fun aDeclaredCheckStillHasToPassToo() {
        val failedCheck = StopVerify(true, false, listOf("the check command says something is still there"), emptyList(), 1)
        assertFalse(withUndoVerify(failedCheck, UndoVerify(true, true, emptyList(), emptyList())).checkPassed)
        val goodCheck = StopVerify(true, true, emptyList(), emptyList(), 1)
        assertTrue(withUndoVerify(goodCheck, UndoVerify(true, true, emptyList(), emptyList())).checkPassed)
        assertFalse(withUndoVerify(goodCheck, UndoVerify(true, true, listOf("still there: x"), emptyList())).checkPassed)
    }

    @Test fun theWholeStopReportsUndoneOnlyAfterTheReCheck() {
        val none = stopPlan("a.js", "// nothing", "ok", false, emptyList(), emptyList(), { null }, { it })
        val undoOk = UndoStopResult(true, true, listOf("undo: removed y"), emptyList(), emptyList())
        fun report(v: UndoVerify) = withUndo(stopReport(none, emptyList(), withUndoVerify(StopVerify.NOT_RUN, v)), undoOk)
        assertTrue(report(UndoVerify(true, true, emptyList(), emptyList())).success)
        assertFalse(report(UndoVerify(true, false, emptyList(), listOf("n"))).success)                    // the script said removed, nobody looked
        assertFalse(report(UndoVerify(true, true, listOf("still there: y"), emptyList())).success)      // the script said removed, the look disagrees
    }
}

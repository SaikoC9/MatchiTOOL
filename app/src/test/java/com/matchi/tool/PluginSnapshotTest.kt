package com.matchi.tool

import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PluginSnapshotTest {
    companion object {
        /**
         * One path per line, written as "path" to true|false. scripts/test_reaper_snapshot.sh reads THIS table (by regex) and runs the reaper's
         * plugin_path_ok on every path, so the Kotlin check and the shell check cannot drift apart. Keep the one-per-line shape.
         */
        val PATH_CASES: List<Pair<String, Boolean>> = listOf(
            "/data/local/myplugin" to true,
            "/data/local/myplugin/data/x.db" to true,
            "/data/local/tmp/foo" to true,
            "/data/local/tmp/foo/bar.txt" to true,
            "/data/local/tmpx" to true,
            "/data/local/matchi_ttl2" to true,
            "/data/local/tmp" to false,
            "/data/local/tmp/" to false,
            "/data/local" to false,
            "/data/local/" to false,
            "/data/local/matchitool" to false,
            "/data/local/matchitool/plugin_data/x" to false,
            "/data/local/matchi_ttl" to false,
            "/data/local/matchi_dpi/x" to false,
            "/data/local/matchi_boot" to false,
            "/data/local/matchi_lock" to false,
            "/data/local/tmp/matchi_jobs" to false,
            "/data/local/tmp/.matchi_out_prev.apk" to false,
            "/data/local/tmp/MATCHI_x" to false,
            "/data/local/tmp/mt_isms.sh" to false,
            "/data/local/tmp/.mt_x" to false,
            "/data/local/tmp/sqlite3" to false,
            "/data/local/tmp/.sqlite3" to false,
            "/data/local/tmp/curl" to false,
            "/data/local/foo bar" to false,
            "/data/local/a/../b" to false,
            "/data/local/a//b" to false,
            "/data/local/a/./b" to false,
            "/data/local/a/" to false,
            "/data/local/tmp/foo//bar" to false,
            "/data/local/a;b" to false,
            "/data/local/\$x" to false,
            "/sdcard/foo" to false,
            "/data/data/x" to false,
            "/data/adb/service.d/x.sh" to false,
            "data/local/x" to false,
            "" to false,
        )
    }

    @Test fun pathRuleMatchesTheTable() {
        for ((p, want) in PATH_CASES) assertEquals(p, want, snapPathOk(p))
    }

    @Test fun pathRuleRefusesAnOverlongPath() {
        assertTrue(snapPathOk("/data/local/" + "a".repeat(180)))
        assertFalse(snapPathOk("/data/local/" + "a".repeat(200)))
    }

    @Test fun chainRuleHasNoDashAndNoBuiltin() {
        assertTrue(snapChainOk("MY_CHAIN"))
        assertTrue(snapChainOk("a1"))
        assertFalse(snapChainOk("MY-CHAIN"))      // the reaper's valid_chain has no dash
        assertFalse(snapChainOk("1abc"))
        assertFalse(snapChainOk("INPUT"))
        assertFalse(snapChainOk("A".repeat(29)))
        assertTrue(snapChainOk("A".repeat(28)))
    }

    @Test fun tagAndCommandRules() {
        assertTrue(snapTagOk("My_Plugin-1.js"))
        assertTrue(snapTagOk("a".repeat(SNAP_TAG_MAX)))
        assertFalse(snapTagOk("a".repeat(SNAP_TAG_MAX + 1)))
        assertFalse(snapTagOk("bad name.js"))
        assertTrue(snapCommandOk("kill 123"))
        assertFalse(snapCommandOk(" kill 123"))        // the reaper's read would trim it and the hash would not match
        assertFalse(snapCommandOk("kill 123 "))
        assertFalse(snapCommandOk(""))
        assertFalse(snapCommandOk("echo \u00e9"))        // not plain ASCII
        assertFalse(snapCommandOk("a\tb"))
        assertFalse(snapCommandOk("echo @@x"))
        assertFalse(snapCommandOk("x".repeat(SNAP_COMMAND_MAX + 1)))
        assertTrue(snapCommandOk("x".repeat(SNAP_COMMAND_MAX)))
    }

    // ---- ledger "R" entries -------------------------------------------------------------------------------------------------

    private val dns = "iptables nat PREROUTING -i br0 -p udp --dport 53 -j REDIRECT --to-ports 5353"

    @Test fun aDnsRedirectBecomesARuleEntryWithoutItsPosition() {
        assertEquals(listOf(dns), pluginRules("iptables -t nat -I PREROUTING 1 -i br0 -p udp --dport 53 -j REDIRECT --to-ports 5353"))
        assertEquals(listOf(dns), pluginRules("iptables -t nat -A PREROUTING -i br0 -p udp --dport 53 -j REDIRECT --to-ports 5353"))
    }

    @Test fun waitFlagsTableAfterTheChainRedirectsAndNestedShellsAreRead() {
        assertEquals(listOf(dns), pluginRules("iptables -w 5 -t nat -I PREROUTING 1 -i br0 -p udp --dport 53 -j REDIRECT --to-ports 5353 2>/dev/null || true"))
        assertEquals(listOf(dns), pluginRules("iptables -I PREROUTING -t nat -i br0 -p udp --dport 53 -j REDIRECT --to-ports 5353"))
        assertEquals(listOf(dns), pluginRules("sh -c 'iptables -t nat -A PREROUTING -i br0 -p udp --dport 53 -j REDIRECT --to-ports 5353'"))
        assertEquals(listOf(dns), pluginRules("su -c \"timeout 5 iptables -t nat -A PREROUTING -i br0 -p udp --dport 53 -j REDIRECT --to-ports 5353\""))
    }

    @Test fun v6AndPlusInterfacesAndPositionsOnTheFilterTable() {
        assertEquals(listOf("ip6tables mangle POSTROUTING -o rmnet+ -j TTL --ttl-set 65"), pluginRules("ip6tables -t mangle -A POSTROUTING -o rmnet+ -j TTL --ttl-set 65"))
        assertEquals(listOf("iptables filter INPUT -s 1.2.3.4 -j DROP"), pluginRules("iptables -I INPUT 2 -s 1.2.3.4 -j DROP"))
        assertEquals(listOf("iptables filter INPUT -s ! 10.0.0.0/8 -j DROP"), pluginRules("iptables -A INPUT -s ! 10.0.0.0/8 -j DROP"))
    }

    @Test fun twoRulesInOneCommandAreBothRecorded() {
        val out = pluginRules("iptables -t nat -A PREROUTING -p udp --dport 53 -j REDIRECT --to-ports 5353; iptables -t nat -A PREROUTING -p tcp --dport 53 -j REDIRECT --to-ports 5353")
        assertEquals(2, out.size)
    }

    @Test fun thingsThatAreNotARemovableRuleAreNotRecorded() {
        assertTrue(pluginRules("iptables -A INPUT -j ACCEPT").isEmpty())                                   // no match: could take a system rule with it
        assertTrue(pluginRules("iptables -t nat -N MYCH").isEmpty())                                       // a chain is a \"C\" entry
        assertTrue(pluginRules("iptables -A MYCH -p tcp -j ACCEPT").isEmpty())                             // not a built-in chain: goes with its chain
        assertTrue(pluginRules("iptables -A tetherctrl_FORWARD -p tcp -j ACCEPT").isEmpty())               // a system chain
        assertTrue(pluginRules("iptables -t security -A INPUT -p tcp -j ACCEPT").isEmpty())                // the reaper knows four tables
        assertTrue(pluginRules("iptables -D INPUT -p tcp --dport 80 -j ACCEPT").isEmpty())                 // a delete adds nothing
        assertTrue(pluginRules("\$IPT -t nat -A PREROUTING -p tcp --dport 80 -j DNAT --to \$X").isEmpty())  // tool through a variable
        assertTrue(pluginRules("iptables -A INPUT -p tcp -m comment --comment \"a b\" -j ACCEPT").isEmpty()) // a quoted word cannot be taken back by text
        assertTrue(pluginRules("iptables -A INPUT -p tcp --dport 80 -j ACCEPT; rm -rf /x").size == 1)       // only the iptables part counts
        assertTrue(pluginRules("iptables -A INPUT -p tcp --dport \$PORT -j ACCEPT").isEmpty())             // an unresolved variable
        assertTrue(pluginRules("echo iptables -A INPUT -p tcp --dport 80 -j ACCEPT").isEmpty())            // only the command word counts
        assertTrue(pluginRules("iptables -A INPUT").isEmpty())
        assertTrue(pluginRules("iptables -A").isEmpty())
    }

    @Test fun ruleEntryAndParseRuleEntryAgree() {
        assertEquals(dns, ruleEntry("iptables", "nat", "PREROUTING", "-i br0 -p udp --dport 53 -j REDIRECT --to-ports 5353"))
        assertEquals(listOf("iptables", "nat", "PREROUTING", "-i br0 -p udp --dport 53 -j REDIRECT --to-ports 5353"), parseRuleEntry(dns))
        assertNull(parseRuleEntry("iptables nat PREROUTING"))
        assertNull(parseRuleEntry("iptables nat PREROUTING -p tcp ; rm -rf /"))
        assertNull(parseRuleEntry("iptables nat PREROUTING -p tcp \$(id)"))
        assertNull(parseRuleEntry("iptables nat PREROUTING -p tcp  --dport 1"))      // two spaces
        assertNull(parseRuleEntry("nft nat PREROUTING -p tcp --dport 1"))
        assertNull(ruleEntry("iptables", "nat", "MYCH", "-p tcp --dport 1 -j ACCEPT"))
        assertNull(ruleEntry("iptables", "nat", "PREROUTING", "-p tcp --dport 1 -j ACCEPT".padEnd(205, 'x')))
    }

    @Test fun theLedgerKeepsRulesAndStillReadsOldLedgers() {
        val dir = Files.createTempDirectory("snap1").toFile()
        try {
            val s = PluginTraceStore(dir)
            s.recordCommand("Dns.js", "iptables -t nat -I PREROUTING 1 -i br0 -p udp --dport 53 -j REDIRECT --to-ports 5353")
            assertEquals(listOf(dns), s.read("Dns.js").rules)
            assertTrue(s.read("Other.js").rules.isEmpty())
            java.io.File(dir, "Old.js.trace").writeText("P /data/local/tmp/x\nE firewall rules\n")
            assertTrue(s.read("Old.js").rules.isEmpty())
            assertEquals(listOf("/data/local/tmp/x"), s.read("Old.js").paths)
        } finally { dir.deleteRecursively() }
    }

    @Test fun theLedgerCapKeepsRuleLines() {
        val lines = listOf("R $dns") + (1..10).map { "P /data/local/tmp/f$it" }
        val out = capLedger(lines, 5)
        assertTrue("R $dns" in out)
        assertEquals(5, out.size)
    }

    @Test fun theChangeHookFiresOnlyWhenTheLedgerChanged() {
        val dir = Files.createTempDirectory("snap2").toFile()
        try {
            val s = PluginTraceStore(dir)
            var n = 0
            s.onChange = { n++ }
            s.recordCommand("A.js", "iptables -t nat -N MYCH")
            assertEquals(1, n)
            s.recordCommand("A.js", "iptables -t nat -N MYCH")        // same line again: nothing new
            assertEquals(1, n)
            s.recordCommand("A.js", "echo hi")                          // nothing to record
            assertEquals(1, n)
            s.clear("A.js")
            assertEquals(2, n)
            s.clear("A.js")                                             // nothing left to remove
            assertEquals(2, n)
        } finally { dir.deleteRecursively() }
    }

    @Test fun aThrowingHookNeverBreaksTheLedger() {
        val dir = Files.createTempDirectory("snap3").toFile()
        try {
            val s = PluginTraceStore(dir)
            s.onChange = { throw IllegalStateException("boom") }
            s.recordCommand("A.js", "iptables -t nat -N MYCH")
            assertEquals(listOf("nat MYCH iptables"), s.read("A.js").chains)
        } finally { dir.deleteRecursively() }
    }

    // ---- the snapshot text --------------------------------------------------------------------------------------------------

    private fun plugin(
        name: String = "Dns_Plugin.js",
        paths: List<String> = emptyList(), data: List<String> = emptyList(), chains: List<String> = emptyList(),
        boot: List<String> = emptyList(), rules: List<String> = emptyList(), cmds: List<String> = emptyList(),
    ) = SnapPlugin(name, paths, data, chains, boot, rules, cmds)

    @Test fun noPluginsGivesOnlyTheHeaders() {
        val b = buildPluginSnapshot(emptyList())
        assertEquals("$SNAP_HEADER\n", b.snap)
        assertEquals("$MANIFEST_HEADER\n", b.manifest)
        assertTrue(b.skipped.isEmpty())
        assertEquals(0, b.counts.values.sum())
    }

    @Test fun oneBusyPluginGivesEveryKindInOrder() {
        val b = buildPluginSnapshot(listOf(plugin(
            paths = listOf("/data/local/dnsplug", "/data/local/tmp/dnsplug.log", "/sdcard/x", "/data/local/matchitool/plugin_data/Dns_Plugin/a"),
            data = listOf("/data/local/dnsplug", "/data/local/dnsplug2"),
            chains = listOf("nat DNS_CH iptables"),
            boot = listOf("/data/local/matchitool/boot.d/20-dns.sh", "/data/local/dnsplug/boot.sh"),
            rules = listOf(dns),
            cmds = listOf("kill 123", " pkill -x dnsd "),
        )))
        val want = listOf(
            SNAP_HEADER,
            "T Dns_Plugin.js",
            "P /data/local/dnsplug", "P /data/local/tmp/dnsplug.log", "P /data/local/dnsplug2",
            "B /data/local/dnsplug/boot.sh",
            "C nat DNS_CH iptables",
            "R $dns",
            "X kill 123", "X pkill -x dnsd",
        ).joinToString("\n", postfix = "\n")
        assertEquals(want, b.snap)
        assertEquals(mapOf("T" to 1, "P" to 3, "B" to 1, "C" to 1, "R" to 1, "X" to 2), b.counts)
        assertTrue(b.snap.endsWith("\n") && !b.snap.contains("\n\n"))
    }

    @Test fun anotherPluginsDataFolderIsRefusedAndNoted() {
        val b = buildPluginSnapshot(listOf(plugin(paths = listOf("/data/local/matchitool/plugin_data/Other_Plugin/x", "/data/local/protectedcase"), data = listOf("/data/local/tmp/matchi_x"))))
        assertFalse(b.snap.contains("Other_Plugin"))
        assertFalse(b.snap.contains("matchi_x"))
        assertTrue(b.snap.contains("P /data/local/protectedcase"))
        assertTrue(b.skipped.any { it.contains("matchi_x") })                  // a refused path outside our folder is noted
        assertTrue(b.skipped.none { it.contains("Other_Plugin") })             // paths inside our own folder are just not needed
    }

    @Test fun badChainsAndRulesAreLeftOutAndNoted() {
        val b = buildPluginSnapshot(listOf(plugin(
            chains = listOf("mangle MY-CHAIN iptables", "security SEC iptables", "nat OK_CH ip6tables", "garbage", "nat INPUT iptables"),
            rules = listOf(dns, "iptables nat PREROUTING -p tcp ; id", "iptables filter MYCH -p tcp --dport 1 -j ACCEPT"),
        )))
        assertEquals(listOf("C nat OK_CH ip6tables"), b.snap.lines().filter { it.startsWith("C ") })
        assertEquals(listOf("R $dns"), b.snap.lines().filter { it.startsWith("R ") })
        assertEquals(4 + 2, b.skipped.size)    // four chains (the dash, security, garbage, INPUT) and two rules
    }

    @Test fun theManifestHoldsOneHashPerCommandAndNothingElse() {
        val b = buildPluginSnapshot(listOf(plugin(cmds = listOf("hello", "hello")), plugin(name = "B.js", cmds = listOf("hello", "echo second"))))
        val hashes = b.manifest.lines().filter { it.isNotEmpty() && !it.startsWith("#") }
        assertTrue("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824" in hashes)   // sha256 of "hello"
        assertEquals(2, hashes.size)                                                                 // a repeated command is listed once
        assertEquals(hashes.sorted(), hashes)
        assertTrue(hashes.all { Regex("^[0-9a-f]{64}$").matches(it) })
        assertEquals(listOf("X hello", "X echo second"), b.snap.lines().filter { it.startsWith("X ") })
    }

    @Test fun commandsThatTheReaperWouldNotRunAreNotWritten() {
        val b = buildPluginSnapshot(listOf(plugin(cmds = listOf("echo \u00e9", "echo @@x", "echo ok", "a\tb", ""))))
        assertEquals(listOf("X echo ok"), b.snap.lines().filter { it.startsWith("X ") })
        assertEquals(4, b.skipped.size)       // every refused command is noted (the empty one too), but never with its text
        assertTrue(b.skipped.none { it.contains("echo") })   // the text of a command is never copied into a note
    }

    @Test fun theSameStateGivesTheSameTextWhateverTheOrder() {
        val a = plugin(name = "A.js", paths = listOf("/data/local/aaa"), cmds = listOf("echo a"))
        val c = plugin(name = "C.js", paths = listOf("/data/local/ccc"), cmds = listOf("echo c"))
        val one = buildPluginSnapshot(listOf(a, c)); val two = buildPluginSnapshot(listOf(c, a))
        assertEquals(one.snap, two.snap)
        assertEquals(one.manifest, two.manifest)
        assertEquals(one.hash, two.hash)
        assertNotEquals(one.hash, buildPluginSnapshot(listOf(a)).hash)
    }

    @Test fun theCapsCutTheRestAndSaySo() {
        val many = (1..SNAP_MAX_PATHS + 50).map { "/data/local/plug$it" }
        val b = buildPluginSnapshot(listOf(plugin(paths = many)))
        assertEquals(SNAP_MAX_PATHS, b.counts["P"])
        assertTrue(b.skipped.any { it.startsWith("path: more than $SNAP_MAX_PATHS") })
    }

    @Test fun everyWrittenLineStartsWithAKnownKindAndHasNoControlCharacters() {
        val b = buildPluginSnapshot(listOf(plugin(paths = listOf("/data/local/x"), chains = listOf("nat C1 iptables"), rules = listOf(dns), cmds = listOf("echo 1"))))
        for (l in b.snap.lines().filter { it.isNotEmpty() }) {
            assertTrue(l, l.startsWith("#") || Regex("^[TPBCRX] [ -~]+$").matches(l))
        }
        assertNull(ReaperModel.installCommand(b.snap))      // the snapshot text is not a reaper script
    }

    @Test fun skippedNotesAreCapped() {
        val b = buildPluginSnapshot(listOf(plugin(chains = (1..60).map { "mangle BAD-$it iptables" })))
        assertEquals(20, b.skipped.size)
    }

    @Test fun summaryNamesTheCounts() {
        val b = buildPluginSnapshot(listOf(plugin(paths = listOf("/data/local/x"), cmds = listOf("echo 1"))))
        assertEquals("T=1 P=1 B=0 C=0 R=0 X=1", b.summary())
    }
}

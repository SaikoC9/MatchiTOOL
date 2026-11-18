package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files

class PluginTraceTest {
    @Test fun redirectionsAndFileCommandsAreWriteTargets() {
        assertEquals(listOf("/data/local/tmp/foo.txt"), pluginWriteTargets("echo 1 > /data/local/tmp/foo.txt"))
        assertEquals(listOf("/data/local/tmp/foo.txt"), pluginWriteTargets("echo 1 >>/data/local/tmp/foo.txt"))
        assertEquals(listOf("/sdcard/big.bin"), pluginWriteTargets("dd if=/dev/zero of=/sdcard/big.bin bs=1M count=1"))
        assertEquals(listOf("/data/local/tmp/x.json"), pluginWriteTargets("curl -s -o /data/local/tmp/x.json https://h/x"))
        assertEquals(listOf("/data/local/tmp/x.json"), pluginWriteTargets("curl -fsSLo /data/local/tmp/x.json https://h/x"))
        assertEquals(listOf("/sdcard/p/y"), pluginWriteTargets("wget -O /sdcard/p/y https://h/y"))
        assertEquals(listOf("/sdcard/p"), pluginWriteTargets("unzip a.zip -d /sdcard/p"))
    }

    @Test fun sourcesThatAreOnlyReadAreNotListed() {
        assertEquals(emptyList<String>(), pluginWriteTargets("cat /sdcard/foo.txt"))
        assertEquals(emptyList<String>(), pluginWriteTargets("ls /sdcard/DCIM; cat /data/local/x | grep y"))
        assertEquals(listOf("/sdcard/MyPlug/a/x.jpg"), pluginWriteTargets("cp /sdcard/DCIM/x.jpg /sdcard/MyPlug/a/x.jpg"))
    }

    @Test fun followsShellWrappersAndVariables() {
        val cmd = "su -c \"D=/data/local/myplug; mkdir -p \$D; echo hi >> \$D/log\""
        assertEquals(listOf("/data/local/myplug", "/data/local/myplug/log"), pluginWriteTargets(cmd))
        assertEquals(listOf("/data/local/tmp/q"), pluginWriteTargets("timeout 5 touch /data/local/tmp/q"))
        assertEquals(listOf("/data/local/tmp/q"), pluginWriteTargets("nohup sh -c 'mkdir /data/local/tmp/q' &"))
    }

    @Test fun unresolvedVariablesStayUnresolved() {
        assertEquals(listOf("/data/local/\$X/a"), pluginWriteTargets("mkdir /data/local/\$X/a"))
        assertTrue(checkPluginDataPath("/data/local/\$X/a", "foo.js") != null)
    }

    @Test fun listsSideEffectsThatFileErasingCannotUndo() {
        assertEquals(setOf("firewall rules"), pluginSideEffects("iptables -A INPUT -j DROP"))
        assertEquals(setOf("system properties"), pluginSideEffects("setprop persist.x 1"))
        assertTrue("background processes" in pluginSideEffects("nohup sh /data/local/tmp/x.sh &"))
        assertTrue("boot script lines" in pluginSideEffects("echo 'x' >> /data/local/matchitool/boot.sh"))
        assertEquals(emptySet<String>(), pluginSideEffects("ls -l /sdcard"))
    }

    @Test fun ledgerKeepsPathsEffectsAndUploadsPerPlugin() {
        val dir = Files.createTempDirectory("trace").toFile()
        try {
            val s = PluginTraceStore(dir)
            s.record("A.js", listOf("/sdcard/a", "/sdcard/a"), listOf("firewall rules"), listOf("up.png"))
            s.record("A.js", listOf("/sdcard/b"), emptyList())
            s.record("B.js", listOf("/sdcard/other"), emptyList())
            val a = s.read("A.js")
            assertEquals(listOf("/sdcard/a", "/sdcard/b"), a.paths)
            assertEquals(listOf("firewall rules"), a.effects)
            assertEquals(listOf("up.png"), a.uploads)
            assertEquals(listOf("/sdcard/other"), s.read("B.js").paths)
            s.clear("A.js")
            assertEquals(emptyList<String>(), s.read("A.js").paths)
            assertEquals(listOf("/sdcard/other"), s.read("B.js").paths)
            // a bad name never touches the disk
            s.record("../evil.js", listOf("/sdcard/x"), emptyList())
            assertEquals(emptyList<String>(), s.read("../evil.js").paths)
        } finally { dir.deleteRecursively() }
    }

    @Test fun onlyPluginFileNamesAreAcceptedFromTheHeader() {
        assertEquals("My_Plugin.js", tracePluginName("My_Plugin.js"))
        assertNull(tracePluginName("../x.js"))
        assertNull(tracePluginName("a b.js"))
        assertNull(tracePluginName(null))
        assertNull(tracePluginName("noext"))
    }

    @Test fun emptyParentFoldersAreFoundButProtectedOnesAreNot() {
        assertEquals(listOf("/data/local/tmp/a"), prunableParents("/data/local/tmp/a/b", "foo.js"))
        assertEquals(emptyList<String>(), prunableParents("/sdcard/Download/foo", "foo.js"))
        assertEquals(listOf("/sdcard/Foo"), prunableParents("/sdcard/Foo/bar", "foo.js"))
        assertEquals(emptyList<String>(), prunableParents("/data/local/xyz", "foo.js"))
        assertEquals(listOf("/data/local/matchitool/plugin_data/foo"), prunableParents("/data/local/matchitool/plugin_data/foo/a", "foo.js"))
    }

    // ---- chains and boot scripts the plugin created ----

    @Test fun chainsCreatedWithDashN() {
        assertEquals(listOf("mangle MY_CHAIN iptables"), pluginChains("iptables -t mangle -N MY_CHAIN"))
        assertEquals(listOf("filter MY_CHAIN iptables"), pluginChains("iptables -N MY_CHAIN"))
        assertEquals(listOf("nat X1 ip6tables"), pluginChains("ip6tables --table nat --new-chain X1"))
        assertEquals(listOf("mangle MY_CHAIN iptables"), pluginChains("iptables --table=mangle -N MY_CHAIN 2>/dev/null || true"))
        assertEquals(listOf("mangle A iptables"), pluginChains("/system/bin/iptables -w 5 -t mangle -N A"))
        assertEquals(listOf("mangle A iptables", "mangle A ip6tables"), pluginChains("iptables -t mangle -N A; ip6tables -t mangle -N A"))
    }

    @Test fun chainsInsideWrappersAreFound() {
        assertEquals(listOf("mangle MY_CHAIN iptables"), pluginChains("su -c \"iptables -t mangle -N MY_CHAIN\""))
        assertEquals(listOf("raw R1 iptables"), pluginChains("timeout 5 iptables -t raw -N R1"))
        assertEquals(listOf("mangle Q iptables"), pluginChains("nohup sh -c 'iptables -t mangle -N Q' &"))
        assertEquals(listOf("mangle Z iptables"), pluginChains("FOO=1 iptables -t mangle -N Z"))
    }

    @Test fun onlyRealNewChainsAreRecorded() {
        assertEquals(emptyList<String>(), pluginChains("iptables -t mangle -A POSTROUTING -j MY_CHAIN"))
        assertEquals(emptyList<String>(), pluginChains("iptables -t mangle -F MY_CHAIN; iptables -t mangle -X MY_CHAIN"))
        assertEquals(emptyList<String>(), pluginChains("iptables -S"))
        assertEquals(emptyList<String>(), pluginChains("echo iptables -N FAKE"))
        assertEquals(emptyList<String>(), pluginChains("nft add chain inet t c"))
    }

    @Test fun builtinChainsBadNamesAndBadTablesAreDropped() {
        assertEquals(emptyList<String>(), pluginChains("iptables -N INPUT"))
        assertEquals(emptyList<String>(), pluginChains("iptables -t mangle -N POSTROUTING"))
        assertEquals(emptyList<String>(), pluginChains("iptables -N 'a b'"))
        assertEquals(emptyList<String>(), pluginChains("iptables -N 'x;rm'"))
        assertEquals(emptyList<String>(), pluginChains("iptables -N ${'$'}CHAIN"))
        assertEquals(emptyList<String>(), pluginChains("iptables -N " + "A".repeat(29)))
        assertEquals(listOf("filter " + "A".repeat(28) + " iptables"), pluginChains("iptables -N " + "A".repeat(28)))
        assertEquals(emptyList<String>(), pluginChains("iptables -t bogus -N X"))
        assertEquals(emptyList<String>(), pluginChains("iptables -N"))
    }

    @Test fun androidSystemChainsAreNeverRecordedAsThePluginsOwn() {
        for (n in listOf("tetherctrl_FORWARD", "bw_INPUT", "fw_FORWARD", "oem_out", "natctrl_nat_POSTROUTING", "st_penalty_log", "idletimer_x", "clat_raw_PREROUTING", "routectrl_mangle_INPUT", "TETHERCTRL_x")) {
            assertEquals(emptyList<String>(), pluginChains("iptables -N $n"))
            assertEquals(emptyList<String>(), pluginChains("ip6tables -t mangle -N $n"))
            assertEquals(null, chainEntry("filter", n, "iptables"))
            assertEquals(null, parseChainEntry("filter $n iptables"))
        }
        assertEquals(listOf("mangle MY_CHAIN iptables"), pluginChains("iptables -t mangle -N MY_CHAIN"))
        assertEquals(listOf("filter stable_chain iptables"), pluginChains("iptables -N stable_chain"))
    }

    @Test fun chainEntriesRoundTripAndRefuseTampering() {
        assertEquals(Triple("mangle", "MY_CHAIN", "iptables"), parseChainEntry("mangle MY_CHAIN iptables"))
        assertNull(parseChainEntry("mangle MY_CHAIN"))
        assertNull(parseChainEntry("mangle MY_CHAIN iptables extra"))
        assertNull(parseChainEntry("mangle INPUT iptables"))
        assertNull(parseChainEntry("mangle X;rm iptables"))
        assertNull(parseChainEntry("mangle X nft"))
        assertNull(parseChainEntry("mangle  X iptables"))
    }

    @Test fun bootScriptsInBootDAreRecorded() {
        assertEquals(listOf("/data/local/matchitool/boot.d/20-bypass-ttl.sh"),
            pluginBootFiles("echo 'sh /x &' > /data/local/matchitool/boot.d/20-bypass-ttl.sh"))
        assertEquals(listOf("/data/local/matchitool/boot.d/30-a.sh"), pluginBootFiles("cp /data/local/tmp/a.sh /data/local/matchitool/boot.d/30-a.sh"))
        assertEquals(listOf("/data/local/matchitool/boot.d/30-a.sh"),
            pluginBootFiles("su -c \"D=/data/local/matchitool/boot.d; echo x > \$D/30-a.sh\""))
    }

    @Test fun otherBootPathsAreNotRecorded() {
        assertEquals(emptyList<String>(), pluginBootFiles("echo x >> /data/local/matchitool/boot.sh"))
        assertEquals(emptyList<String>(), pluginBootFiles("echo x > /data/local/matchitool/boot.d/notnumbered.sh"))
        assertEquals(emptyList<String>(), pluginBootFiles("echo x > /data/local/matchitool/boot.d/20-a.txt"))
        assertEquals(emptyList<String>(), pluginBootFiles("echo x > /data/local/matchitool/boot.d/sub/20-a.sh"))
        assertEquals(emptyList<String>(), pluginBootFiles("echo x > /data/local/matchitool/boot.d/20-.sh"))
        assertEquals(emptyList<String>(), pluginBootFiles("echo x > /data/local/matchitool/boot.d/2-a.sh"))
        assertEquals(emptyList<String>(), pluginBootFiles("echo x > /data/local/other/boot.d/20-a.sh"))
        assertEquals(emptyList<String>(), pluginBootFiles("cat /data/local/matchitool/boot.d/20-a.sh"))
    }

    @Test fun ledgerKeepsChainsAndBootFilesAndStillReadsOldLedgers() {
        val dir = Files.createTempDirectory("trace3").toFile()
        try {
            val s = PluginTraceStore(dir)
            s.recordCommand("A.js", "iptables -t mangle -N MY_CHAIN && echo x > /data/local/matchitool/boot.d/20-a.sh && echo y > /data/local/matchi_a/f.txt")
            s.recordCommand("A.js", "iptables -t mangle -N MY_CHAIN")
            val a = s.read("A.js")
            assertEquals(listOf("mangle MY_CHAIN iptables"), a.chains)
            assertEquals(listOf("/data/local/matchitool/boot.d/20-a.sh"), a.bootFiles)
            assertEquals(listOf("/data/local/matchi_a/f.txt"), a.paths)
            assertTrue("firewall rules" in a.effects)
            assertEquals(emptyList<String>(), s.read("B.js").chains)
            // an old ledger file (only P / E / U lines) still reads, chains and bootFiles are empty
            java.io.File(dir, "Old.js.trace").writeText("P /sdcard/a\nE firewall rules\nU up.png\n")
            val o = s.read("Old.js")
            assertEquals(listOf("/sdcard/a"), o.paths); assertEquals(emptyList<String>(), o.chains); assertEquals(emptyList<String>(), o.bootFiles)
            // a ledger for one plugin never shows in another's
            s.recordCommand("B.js", "iptables -N OTHER")
            assertEquals(listOf("filter OTHER iptables"), s.read("B.js").chains)
            assertEquals(listOf("mangle MY_CHAIN iptables"), s.read("A.js").chains)
            // a boot.d path is not a data path to erase: it must NOT appear in "paths"
            assertTrue(a.paths.none { it.contains("/boot.d/") })
        } finally { dir.deleteRecursively() }
    }

    @Test fun badPluginNameRecordsNothing() {
        val dir = Files.createTempDirectory("trace3b").toFile()
        try {
            val s = PluginTraceStore(dir)
            s.recordCommand("../x.js", "iptables -N X")
            assertEquals(0, dir.listFiles()?.size ?: 0)
        } finally { dir.deleteRecursively() }
    }

    @Test fun theLedgerCapDropsOldPathsBeforeChainsAndBootScripts() {
        val lines = listOf("C mangle MY_CHAIN iptables", "B /data/local/matchitool/boot.d/20-x.sh", "U up.png") + (1..10).map { "P /data/local/tmp/f$it" } + listOf("E firewall rules")
        val out = capLedger(lines, 8)
        assertEquals(8, out.size)
        assertTrue("C mangle MY_CHAIN iptables" in out && "B /data/local/matchitool/boot.d/20-x.sh" in out && "U up.png" in out)   // never the first to go
        assertEquals("E firewall rules", out.last())                                                                           // the newest line stays
        assertEquals(lines, capLedger(lines, 100))                                                                              // under the cap: unchanged
        assertEquals(listOf("P /a", "P /b"), capLedger(listOf("P /a", "P /b"), 2))
    }

    @Test fun theLedgerCapKeepsTheNewestOfTheProtectedLinesOnlyWhenNothingElseIsLeft() {
        val lines = (1..6).map { "C nat CH$it iptables" } + listOf("P /x")
        val out = capLedger(lines, 4)
        assertEquals((3..6).map { "C nat CH$it iptables" }, out)   // the path line went first, then the oldest chains
    }
}

package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PluginUndoTest {
    private val boot = "/data/local/matchitool/boot.d/20-bypass-ttl.sh"
    private fun use(chains: List<String> = emptyList(), boots: List<String> = emptyList(), text: String = "") = UndoUse(chains, boots, text)

    @Test fun listsOwnChainsAndBootScriptsWithAHash() {
        val p = undoPlan(listOf("mangle UFI_DPI iptables"), listOf(boot), emptyMap())
        assertEquals(2, p.items.size)
        assertEquals("chain", p.items[0].kind); assertEquals("UFI_DPI", p.items[0].chain); assertEquals("mangle", p.items[0].table); assertEquals("iptables", p.items[0].tool)
        assertEquals("firewall chain UFI_DPI (iptables, table mangle)", p.items[0].label)
        assertEquals("boot", p.items[1].kind); assertEquals(boot, p.items[1].path); assertEquals("boot script 20-bypass-ttl.sh", p.items[1].label)
        assertEquals(emptyList<String>(), p.notUndone)
        assertEquals(64, p.hash.length)
    }

    @Test fun nothingToUndoHasNoHash() {
        val p = undoPlan(emptyList(), emptyList(), mapOf("B.js" to use(listOf("mangle X iptables"))))
        assertEquals(emptyList<UndoItem>(), p.items); assertEquals("", p.hash); assertEquals(emptyList<String>(), p.notUndone)
    }

    @Test fun aChainAnotherPluginAlsoRecordsIsKept() {
        val p = undoPlan(listOf("mangle UFI_DPI iptables"), emptyList(), mapOf("New.js" to use(chains = listOf("mangle UFI_DPI iptables"))))
        assertEquals(0, p.items.size); assertEquals("", p.hash)
        assertEquals(listOf("firewall chain UFI_DPI (iptables, table mangle): also used by New.js, so it is kept"), p.notUndone)
    }

    @Test fun aChainNamedInAnotherPluginsCommandsIsKeptButOnlyAsAWholeWord() {
        val named = undoPlan(listOf("mangle UFI_DPI iptables"), emptyList(), mapOf("N.js" to use(text = "iptables -t mangle -F UFI_DPI; iptables -t mangle -X UFI_DPI")))
        assertEquals(0, named.items.size); assertEquals(1, named.notUndone.size)
        val longer = undoPlan(listOf("mangle UFI iptables"), emptyList(), mapOf("N.js" to use(text = "iptables -t mangle -F UFI_DPI")))
        assertEquals(1, longer.items.size)
        val partOfWord = undoPlan(listOf("mangle DPI iptables"), emptyList(), mapOf("N.js" to use(text = "x UFI_DPI y")))
        assertEquals(1, partOfWord.items.size)
    }

    @Test fun iptablesAndIp6tablesAreDifferentChains() {
        val p = undoPlan(listOf("mangle A iptables", "mangle A ip6tables"), emptyList(), mapOf("N.js" to use(chains = listOf("mangle A ip6tables"))))
        assertEquals(listOf("A"), p.items.map { it.chain }); assertEquals("iptables", p.items[0].tool)
        assertEquals(1, p.notUndone.size)
    }

    @Test fun aBootScriptAnotherPluginListsOrNamesIsKept() {
        assertEquals(0, undoPlan(emptyList(), listOf(boot), mapOf("N.js" to use(boots = listOf(boot)))).items.size)
        assertEquals(0, undoPlan(emptyList(), listOf(boot), mapOf("N.js" to use(text = "rm -f $boot"))).items.size)
        val p = undoPlan(emptyList(), listOf(boot), mapOf("N.js" to use(boots = listOf("/data/local/matchitool/boot.d/30-other.sh"))))
        assertEquals(1, p.items.size)
    }

    @Test fun unsafeOrInvalidLedgerLinesAreIgnoredAndCounted() {
        val p = undoPlan(listOf("mangle INPUT iptables", "junk", "mangle OK iptables"),
            listOf("/data/local/matchitool/boot.sh", "/data/local/matchitool/boot.d/x.sh", "/system/bin/sh", boot), emptyMap())
        assertEquals(listOf("OK"), p.items.filter { it.kind == "chain" }.map { it.chain })
        assertEquals(listOf(boot), p.items.filter { it.kind == "boot" }.map { it.path })
        assertEquals(listOf("5 ledger line(s) ignored: not a valid chain or boot script entry"), p.notUndone)
    }

    @Test fun duplicatesAreListedOnce() {
        val p = undoPlan(listOf("mangle A iptables", "mangle A iptables"), listOf(boot, boot), emptyMap())
        assertEquals(2, p.items.size)
    }

    @Test fun capsAreApplied() {
        val chains = (1..25).map { "mangle C$it iptables" }
        val boots = (10..25).map { "/data/local/matchitool/boot.d/$it-a.sh" }
        val p = undoPlan(chains, boots, emptyMap())
        assertEquals(UNDO_MAX_CHAINS, p.items.count { it.kind == "chain" })
        assertEquals(UNDO_MAX_BOOT_FILES, p.items.count { it.kind == "boot" })
        assertEquals(5 + 6, p.notUndone.size)
        assertTrue(p.notUndone.all { it.contains("not listed") })
    }

    @Test fun hashIgnoresOrderAndChangesWithTheList() {
        val a = undoPlan(listOf("mangle A iptables", "nat B iptables"), listOf(boot), emptyMap())
        val b = undoPlan(listOf("nat B iptables", "mangle A iptables"), listOf(boot), emptyMap())
        assertEquals(a.hash, b.hash)
        assertNotEquals(a.hash, undoPlan(listOf("mangle A iptables"), listOf(boot), emptyMap()).hash)
        assertNotEquals(a.hash, undoPlan(listOf("mangle A iptables", "nat B iptables"), emptyList(), emptyMap()).hash)
        assertNotEquals(a.hash, undoPlan(listOf("mangle A iptables", "nat B ip6tables"), listOf(boot), emptyMap()).hash)
    }

    @Test fun twoPluginsSharingAreBothNamedInOrder() {
        val p = undoPlan(listOf("mangle A iptables"), emptyList(), mapOf("Z.js" to use(chains = listOf("mangle A iptables")), "B.js" to use(text = "x A y")))
        assertEquals(listOf("firewall chain A (iptables, table mangle): also used by B.js, Z.js, so it is kept"), p.notUndone)
    }
}

package com.matchi.tool

/*
 * Plugin undo (Phase 3 of MatchiTOOL_Phase3_todo.txt). Plain Kotlin, NO Android / JSON / web-server imports, so scripts/kotlin_pure_tests.sh compiles it.
 *
 * Step 1: what "Delete and stop" WOULD undo outside the plugin's own files, worked out from the ledger alone (PluginTrace.kt: "C" firewall chains and
 * "B" boot scripts the host saw the plugin create). Nothing is run here. The Delete dialog shows the list, and a hash of it goes back with the
 * request so that what the person saw is what runs (Step 2), the same idea as stopPlanHash and sweepHash.
 *
 * Rules: only a chain the plugin created itself (a "C" entry), only a boot script with a safe name directly in boot.d (isSafeBootFile). Anything another
 * installed plugin also records, declares or names in its uninstall commands is kept and listed under "not undone" (the old-copy / new-copy guard).
 */

/** What another installed plugin uses: its ledger chains ("table chain tool"), its boot scripts (ledger + @matchi-boot) and the text of its uninstall / check commands. */
internal class UndoUse(val chains: List<String>, val bootFiles: List<String>, val commandText: String)

/** One thing the delete would undo. [kind] is "chain" or "boot". For a chain: [table], [chain], [tool]. For a boot script: [path]. */
internal class UndoItem(val kind: String, val label: String, val table: String = "", val chain: String = "", val tool: String = "", val path: String = "")

/** [items] in a fixed order; [notUndone] one line each (kept on purpose, or a ledger line that was ignored); [hash] is "" when there is nothing to undo. */
internal class UndoPlan(val items: List<UndoItem>, val notUndone: List<String>, val hash: String)

internal const val UNDO_MAX_CHAINS = 20
internal const val UNDO_MAX_BOOT_FILES = 10

private fun mentionsWord(text: String, word: String): Boolean =
    Regex("(?<![A-Za-z0-9_-])" + Regex.escape(word) + "(?![A-Za-z0-9_-])").containsMatchIn(text)

internal fun undoHash(items: List<UndoItem>): String {
    if (items.isEmpty()) return ""
    val lines = items.map { if (it.kind == "chain") "chain:${it.table} ${it.chain} ${it.tool}" else "boot:${it.path}" }.sorted()
    return sha256Hex(lines.joinToString("\n", postfix = "\n").toByteArray(Charsets.UTF_8))
}

/**
 * [chains] and [bootFiles] are the plugin's own ledger lines; [others] are the other installed plugins by name.
 * A chain is shared when another plugin's ledger has the same entry or its uninstall / check commands name the chain as a whole word.
 * A boot script is shared when another plugin's ledger or @matchi-boot lists it or its commands name the path.
 */
internal fun undoPlan(chains: List<String>, bootFiles: List<String>, others: Map<String, UndoUse>): UndoPlan {
    val items = ArrayList<UndoItem>()
    val notUndone = ArrayList<String>()
    var ignored = 0
    val names = others.keys.sorted()
    val seenChains = LinkedHashSet<String>()
    var chainCount = 0
    for (entry in chains.distinct()) {
        val parsed = parseChainEntry(entry)
        if (parsed == null) { ignored++; continue }
        val (table, chain, tool) = parsed
        if (!seenChains.add(entry)) continue
        val label = "firewall chain $chain ($tool, table $table)"
        val sharers = names.filter { n -> val u = others.getValue(n); entry in u.chains || mentionsWord(u.commandText, chain) }
        if (sharers.isNotEmpty()) { notUndone.add("$label: also used by ${sharers.joinToString(", ")}, so it is kept"); continue }
        if (chainCount >= UNDO_MAX_CHAINS) { notUndone.add("$label: not listed, more than $UNDO_MAX_CHAINS chains"); continue }
        chainCount++
        items.add(UndoItem("chain", label, table = table, chain = chain, tool = tool))
    }
    var bootCount = 0
    for (path in bootFiles.distinct()) {
        if (!isSafeBootFile(path)) { ignored++; continue }
        val label = "boot script ${path.substringAfterLast('/')}"
        val sharers = names.filter { n -> val u = others.getValue(n); path in u.bootFiles || u.commandText.contains(path) }
        if (sharers.isNotEmpty()) { notUndone.add("$label: also used by ${sharers.joinToString(", ")}, so it is kept"); continue }
        if (bootCount >= UNDO_MAX_BOOT_FILES) { notUndone.add("$label: not listed, more than $UNDO_MAX_BOOT_FILES boot scripts"); continue }
        bootCount++
        items.add(UndoItem("boot", label, path = path))
    }
    if (ignored > 0) notUndone.add("$ignored ledger line(s) ignored: not a valid chain or boot script entry")
    return UndoPlan(items, notUndone, undoHash(items))
}

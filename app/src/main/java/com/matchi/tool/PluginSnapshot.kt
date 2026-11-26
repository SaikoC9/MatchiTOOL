package com.matchi.tool

/*
 * Plugin snapshot for the uninstall reaper (docs/UNINSTALL_WIPE.md, plan Phase 5). Plain Kotlin, NO Android / JSON / web-server imports, so
 * scripts/kotlin_pure_tests.sh compiles it.
 *
 * When MatchiTOOL is uninstalled the app is gone, so it cannot ask its plugins anything. The app therefore writes what it already knows about
 * the installed plugins into two small text files next to the reaper (ReaperModel.snapshotCommand), and the reaper (assets/bin/matchi_reaper.sh)
 * reads them at wipe time. This file only BUILDS the text; nothing here runs anything.
 *
 * plugins.snap, one item per line, "KIND rest of the line" (lines starting with # are comments):
 *   T tag                                process tag (MATCHI_PLUGIN=tag): processes carrying it are ended
 *   P /data/local/...                    path to delete (ledger paths and @matchi-data paths)
 *   B /data/local/...                    boot file to delete
 *   C table chain tool                   firewall chain the plugin made (jump rules, flush, delete)
 *   R tool table chain rule...           rule the plugin put into a built-in chain, removed by exact text
 *   X command                            approved stop command (the same ones "Delete and stop" runs); runs only if its sha256 is in plugins.manifest
 * plugins.manifest: one sha256 (64 hex characters) per X command, nothing else (# lines are comments).
 *
 * Every line is checked HERE with the same rules the reaper applies again (snapPathOk = plugin_path_ok, snapChainOk = valid_chain, ruleEntry =
 * valid_rule_chain + valid_spec, snapTagOk = valid_tag), so a line the reaper would refuse is never written. The reaper does not trust this file
 * blindly either: it must be root-owned, not group/other writable, and not a symlink.
 */

internal const val SNAP_HEADER = "# MATCHI_PLUGIN_SNAP=1"
internal const val MANIFEST_HEADER = "# MATCHI_PLUGIN_MANIFEST=1"

// Size caps for the whole snapshot (50 plugins at most). Over a cap the rest is dropped and listed in SnapBuild.skipped.
internal const val SNAP_MAX_TAGS = 60
internal const val SNAP_MAX_PATHS = 400
internal const val SNAP_MAX_BOOT = 100
internal const val SNAP_MAX_CHAINS = 100
internal const val SNAP_MAX_RULES = 100
internal const val SNAP_MAX_COMMANDS = 100

/** Longest process tag the reaper accepts (plugin file names are up to 80 characters). */
internal const val SNAP_TAG_MAX = 90

/** Longest stop command the reaper runs (same as MAX_UNINSTALL_LEN). */
internal const val SNAP_COMMAND_MAX = 300

private val SNAP_TAG_RX = Regex("^[A-Za-z0-9._-]{1,$SNAP_TAG_MAX}$")
private val SNAP_PATH_CHARS = Regex("^[A-Za-z0-9._/-]{1,200}$")
private val SNAP_CHAIN_RX = Regex("^[A-Za-z][A-Za-z0-9_]{0,27}$")
private val SNAP_TABLES = setOf("filter", "nat", "mangle", "raw")
private val SNAP_BUILTIN_CHAINS = setOf("INPUT", "OUTPUT", "FORWARD", "PREROUTING", "POSTROUTING")
private val SNAP_LOCAL_PROTECTED = setOf("tmp", "matchitool", "matchi_ttl", "matchi_dpi", "matchi_boot", "matchi_lock")
private val SNAP_TMP_PROTECTED_PREFIXES = listOf("matchi", ".matchi", "mt_", ".mt_", "sqlite", ".sqlite")
private val SNAP_TMP_PROTECTED_NAMES = setOf("curl")   // Footprint.NOT_OURS: the bundled curl is not ours to delete

/** What one installed plugin leaves behind, as the host knows it. All lists are raw (unchecked); [buildPluginSnapshot] checks every entry. */
internal class SnapPlugin(
    val name: String,
    val ledgerPaths: List<String>,
    val declaredData: List<String>,
    val chains: List<String>,
    val bootFiles: List<String>,
    val rules: List<String>,
    /** Stop commands that may run (StopPlan.commands). Empty when the plugin file is not the approved one. */
    val stopCommands: List<String>,
)

/** [snap] and [manifest] are the two file texts, [hash] covers both (the writer skips an unchanged snapshot), [counts] is per kind, [skipped] lists what was refused or cut (never the text of a command). */
internal class SnapBuild(val snap: String, val manifest: String, val hash: String, val counts: Map<String, Int>, val skipped: List<String>) {
    fun summary(): String = listOf("T", "P", "B", "C", "R", "X").joinToString(" ") { "$it=${counts[it] ?: 0}" } + (if (skipped.isEmpty()) "" else " skipped=${skipped.size}")
}

/** True for a process tag the reaper accepts: a plugin file name (letters, digits, dot, dash, underscore). */
internal fun snapTagOk(tag: String): Boolean = SNAP_TAG_RX.matches(tag)

/**
 * True when the reaper's plugin_path_ok accepts [p]: below /data/local or /data/local/tmp (never /sdcard), plain characters, no empty / . / .. part, no
 * trailing slash, and the first folder is not one of ours or a protected one. scripts/test_reaper_snapshot.sh runs both on the same table of paths
 * (PluginSnapshotTest.PATH_CASES). The symlink check on every parent folder happens in the reaper, at wipe time.
 */
internal fun snapPathOk(p: String): Boolean {
    if (!SNAP_PATH_CHARS.matches(p)) return false
    val tmp: Boolean
    val rest: String
    when {
        p.startsWith("/data/local/tmp/") -> { rest = p.removePrefix("/data/local/tmp/"); tmp = true }
        p.startsWith("/data/local/") -> { rest = p.removePrefix("/data/local/"); tmp = false }
        else -> return false
    }
    if (rest.isEmpty() || rest.endsWith("/")) return false
    val parts = rest.split('/')
    if (parts.any { it.isEmpty() || it == "." || it == ".." }) return false
    val name = parts[0]
    if (tmp) {
        val low = name.lowercase()
        if (SNAP_TMP_PROTECTED_PREFIXES.any { low.startsWith(it) } || low in SNAP_TMP_PROTECTED_NAMES) return false
    } else if (name in SNAP_LOCAL_PROTECTED) return false
    return true
}

/** True when the reaper's valid_chain accepts [chain]: letters, digits and underscore only (no dash), at most 28, not a built-in chain. */
internal fun snapChainOk(chain: String): Boolean = SNAP_CHAIN_RX.matches(chain) && chain !in SNAP_BUILTIN_CHAINS

/** True for a stop command the reaper runs: 1 to 300 printable ASCII characters, no leading or trailing space (the reaper's read would trim it), no "@@". */
internal fun snapCommandOk(c: String): Boolean =
    c.isNotEmpty() && c.length <= SNAP_COMMAND_MAX && c == c.trim() && c.all { it.code in 32..126 } && !c.contains("@@")

/**
 * Builds the two file texts from the installed plugins. Every entry is checked again; a refused one is counted in [SnapBuild.skipped] and left out.
 * Paths: the ledger's and the @matchi-data declarations, only below /data/local (and passing checkPluginDataPath, the rule the Delete dialog uses).
 * Chains: the ledger's "C" entries, only the four tables the reaper knows and names it accepts. Rules: the ledger's "R" entries. Commands: only
 * those in [SnapPlugin.stopCommands]. Order is stable (plugins sorted by name, entries in ledger order) so an unchanged state gives an unchanged text.
 */
internal fun buildPluginSnapshot(plugins: List<SnapPlugin>): SnapBuild {
    val tags = LinkedHashSet<String>(); val paths = LinkedHashSet<String>(); val boots = LinkedHashSet<String>()
    val chains = LinkedHashSet<String>(); val rules = LinkedHashSet<String>(); val commands = LinkedHashSet<String>()
    val skipped = ArrayList<String>()
    fun skip(why: String) { if (skipped.size < 20) skipped.add(why) }
    fun <T> add(into: MutableSet<T>, max: Int, item: T, what: String) { if (item in into) return; if (into.size >= max) skip("$what: more than $max entries") else into.add(item) }

    for (pl in plugins.sortedBy { it.name }) {
        if (snapTagOk(pl.name)) add(tags, SNAP_MAX_TAGS, pl.name, "tag") else skip("tag ${pl.name.take(40)}: not a valid tag")
        for (p in (pl.ledgerPaths + pl.declaredData).distinct()) {
            // Own data folder and anything else inside MatchiTOOL's folder goes with the folder, so only paths outside it are listed.
            if (checkPluginDataPath(p, pl.name) != null || !snapPathOk(p)) {
                if (p.startsWith("/data/local/") && !p.startsWith("/data/local/matchitool/")) skip("path ${p.take(60)}: refused")
                continue
            }
            add(paths, SNAP_MAX_PATHS, p, "path")
        }
        for (b in pl.bootFiles.distinct()) {
            if (b.startsWith("/data/local/matchitool/")) continue          // boot.d is removed with the folder
            if (!snapPathOk(b)) { skip("boot file ${b.take(60)}: refused"); continue }
            add(boots, SNAP_MAX_BOOT, b, "boot file")
        }
        for (c in pl.chains.distinct()) {
            val e = parseChainEntry(c)
            if (e == null || e.first !in SNAP_TABLES || !snapChainOk(e.second)) { skip("chain ${c.take(60)}: refused"); continue }
            add(chains, SNAP_MAX_CHAINS, c, "chain")
        }
        for (r in pl.rules.distinct()) {
            if (parseRuleEntry(r) == null) { skip("rule ${r.take(60)}: refused"); continue }
            add(rules, SNAP_MAX_RULES, r, "rule")
        }
        for (c0 in pl.stopCommands) {
            val c = c0.trim()
            if (!snapCommandOk(c)) { skip("stop command of ${pl.name.take(40)}: refused"); continue }
            add(commands, SNAP_MAX_COMMANDS, c, "stop command")
        }
    }

    val sb = StringBuilder(SNAP_HEADER).append('\n')
    for (t in tags) sb.append("T ").append(t).append('\n')
    for (p in paths) sb.append("P ").append(p).append('\n')
    for (b in boots) sb.append("B ").append(b).append('\n')
    for (c in chains) sb.append("C ").append(c).append('\n')
    for (r in rules) sb.append("R ").append(r).append('\n')
    for (c in commands) sb.append("X ").append(c).append('\n')
    val mb = StringBuilder(MANIFEST_HEADER).append('\n')
    for (h in commands.map { sha256Hex(it.toByteArray(Charsets.UTF_8)) }.distinct().sorted()) mb.append(h).append('\n')
    val snap = sb.toString(); val manifest = mb.toString()
    val counts = linkedMapOf("T" to tags.size, "P" to paths.size, "B" to boots.size, "C" to chains.size, "R" to rules.size, "X" to commands.size)
    return SnapBuild(snap, manifest, sha256Hex((snap + "\u0000" + manifest).toByteArray(Charsets.UTF_8)), counts, skipped)
}

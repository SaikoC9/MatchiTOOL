package com.matchi.tool

/*
 * Plugin undo (Phase 3 of MatchiTOOL_Phase3_todo.txt). Plain Kotlin, NO Android / JSON / web-server imports, so scripts/kotlin_pure_tests.sh compiles it.
 *
 * Step 1 (undoPlan): what "Delete and stop" WOULD undo outside the plugin's own files, worked out from the ledger alone (PluginTrace.kt: "C" firewall chains and
 * "B" boot scripts the host saw the plugin create). Nothing is run here. The Delete dialog shows the list, and a hash of it goes back with the
 * request so that what the person saw is what runs, the same idea as stopPlanHash and sweepHash.
 * Step 2 (undoScript, parseUndoRun, runUndoStop, withUndo): the root script that does it, run after the process sweep, on the same 60 s clock.
 * Step 3 (undoVerifyScript, parseUndoVerify, verifyUndo, withUndoVerify): a separate read-only look afterwards; "undone" is only said when that look ran.
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

// ---- Step 2: running the undo ----

/** The undo step is not started with less than this left of the 60 s (the script needs about a second; the rest is margin). */
internal const val UNDO_MIN_MS = 5_000L

/** The undo script gets at most this long; a shorter limit keeps it out of the "long" root slots (F9 of Phase 1). */
internal const val UNDO_TIMEOUT_MS = 20_000L

/** Most jump rules removed per chain (a safety stop for the loop; a real plugin adds one or two). */
internal const val UNDO_MAX_JUMPS = 40

private val UNDO_CHAIN_STATUSES = setOf("removed", "absent", "failed", "notool")
private val UNDO_BOOT_STATUSES = setOf("removed", "absent", "failed", "refused-symlink", "refused-notfile", "refused-owner", "refused-dir")

/**
 * Step 2 (B, C of the plan): the root script that undoes the items of [plan]. NOTHING from a plugin is put in as text except names that were checked
 * here again: a chain by chainEntry (table, chain and tool from a fixed list, chain name letters / digits / _ / -), a boot script by isSafeBootFile.
 * One bad item and the function returns null (the caller then runs nothing), like sweepKillScript.
 *
 * Chain, per item, in this order (the sweep has already ended the watchers):
 *   1. the chain is not there -> "absent", nothing is touched;
 *   2. every rule that JUMPS to the chain is removed BY NUMBER ("-D PARENT N", no text of any rule is ever run or evaluated). A rule counts as a jump
 *      only when "-S" prints it as "-A PARENT ... -j CHAIN" (or -g) with CHAIN as its LAST word, so a comment that contains "-j CHAIN" (it ends in a quote)
 *      is never taken. A rule in the chain itself is left to the flush. The parent chain is only ever read, never flushed or deleted: INPUT, POSTROUTING
 *      and every system chain lose at most the one rule that jumps to the plugin's chain;
 *   3. if a jump is still there, the chain is NOT flushed (status "failed");
 *   4. flush the chain (-F), delete it (-X), look again: "removed" or "failed".
 * Boot script, per item: refused when boot.d or its parent is a symlink, when the file is a symlink, is not a regular file, or is not owned by root (uid 0);
 * otherwise "rm -f", then look again.
 * Output, one line each: MTUNDO|chain|TABLE|CHAIN|TOOL|STATUS, MTUNDO|jumps|TABLE|CHAIN|TOOL|COUNT, MTUNDO|boot|PATH|STATUS, and MTUNDO-END at the end.
 * [pathPrefix] is for the tests only (a scratch folder put in front of a boot script path); the app never passes it.
 */
internal fun undoScript(plan: UndoPlan, pathPrefix: String = ""): String? {
    if (plan.items.isEmpty()) return null
    val calls = ArrayList<String>()
    for (i in plan.items) {
        when (i.kind) {
            "chain" -> {
                if (chainEntry(i.table, i.chain, i.tool) == null) return null
                calls.add("undo_chain '${i.table}' '${i.chain}' '${i.tool}'")
            }
            "boot" -> {
                if (!isSafeBootFile(i.path)) return null
                calls.add("undo_boot '${i.path}'")
            }
            else -> return null
        }
    }
    if (pathPrefix.any { !(it.isLetterOrDigit() || it == '/' || it == '.' || it == '_' || it == '-') }) return null
    // ^ stands for the dollar sign (replaced below), so the Kotlin raw string needs no escapes.
    val template = """
set -f
PFX='@PFX@'
find_jump() {
  JP=; JN=
  all=^("^IPT" ^W -t "^T" -S 2>/dev/null)
  parents=
  while IFS= read -r l; do
    case "^l" in
      "-A "*" -j ^C"|"-A "*" -g ^C")
        set -- ^l
        case "^2" in
          ''|"^C"|*[!A-Za-z0-9_-]*) ;;
          *) case " ^parents " in *" ^2 "*) ;; *) parents="^parents ^2" ;; esac ;;
        esac ;;
    esac
  done <<MTUNDO_EOF
^all
MTUNDO_EOF
  for p in ^parents; do
    rules=^("^IPT" ^W -t "^T" -S "^p" 2>/dev/null)
    i=0
    while IFS= read -r l; do
      case "^l" in
        "-A ^p "*)
          i=^((i+1))
          case "^l" in *" -j ^C"|*" -g ^C") JP=^p; JN=^i; return 0 ;; esac ;;
      esac
    done <<MTUNDO_EOF
^rules
MTUNDO_EOF
  done
  return 1
}
undo_chain() {
  T=^1; C=^2; IPT=^3
  if ! command -v "^IPT" >/dev/null 2>&1; then echo "MTUNDO|chain|^T|^C|^IPT|notool"; return; fi
  W=; if "^IPT" -w 5 -t "^T" -S >/dev/null 2>&1; then W="-w 5"; fi   # wait for the xtables lock only where iptables knows -w (1.6.2+); "-w 5" is a fixed word, never plugin text
  if ! "^IPT" ^W -t "^T" -S "^C" >/dev/null 2>&1; then echo "MTUNDO|chain|^T|^C|^IPT|absent"; return; fi
  d=0; k=0
  while [ ^k -lt @MAXJUMPS@ ] && find_jump; do
    k=^((k+1))
    "^IPT" ^W -t "^T" -D "^JP" "^JN" >/dev/null 2>&1 || break
    d=^((d+1))
  done
  echo "MTUNDO|jumps|^T|^C|^IPT|^d"
  if find_jump; then echo "MTUNDO|chain|^T|^C|^IPT|failed"; return; fi
  "^IPT" ^W -t "^T" -F "^C" >/dev/null 2>&1
  "^IPT" ^W -t "^T" -X "^C" >/dev/null 2>&1
  if "^IPT" ^W -t "^T" -S "^C" >/dev/null 2>&1; then echo "MTUNDO|chain|^T|^C|^IPT|failed"; else echo "MTUNDO|chain|^T|^C|^IPT|removed"; fi
}
undo_boot() {
  f="^PFX^1"; d=^{f%/*}; dd=^{d%/*}
  if [ -L "^dd" ] || [ -L "^d" ]; then echo "MTUNDO|boot|^1|refused-dir"; return; fi
  if [ -L "^f" ]; then echo "MTUNDO|boot|^1|refused-symlink"; return; fi
  if [ ! -e "^f" ]; then echo "MTUNDO|boot|^1|absent"; return; fi
  if [ ! -f "^f" ]; then echo "MTUNDO|boot|^1|refused-notfile"; return; fi
  u=^(stat -c %u "^f" 2>/dev/null)
  if [ "^u" != 0 ]; then echo "MTUNDO|boot|^1|refused-owner"; return; fi
  rm -f "^f" 2>/dev/null
  if [ -e "^f" ] || [ -L "^f" ]; then echo "MTUNDO|boot|^1|failed"; else echo "MTUNDO|boot|^1|removed"; fi
}
@CALLS@
echo "MTUNDO-END"
""".trimIndent()
    return template.replace('^', '$').replace("@PFX@", pathPrefix).replace("@MAXJUMPS@", UNDO_MAX_JUMPS.toString()).replace("@CALLS@", calls.joinToString("\n"))
}

/** What the undo script said: "chain TABLE CHAIN TOOL" or "boot PATH" -> status, and "TABLE CHAIN TOOL" -> number of jump rules removed. Only known statuses count; never throws. */
internal class UndoAnswers(val status: Map<String, String>, val jumps: Map<String, Int>)

internal fun parseUndoRun(output: String): UndoAnswers {
    val st = LinkedHashMap<String, String>(); val jumps = LinkedHashMap<String, Int>()
    for (raw in output.split('\n')) {
        val f = raw.trimEnd('\r').split('|')
        if (f.isEmpty() || f[0] != "MTUNDO") continue
        when {
            f.size == 6 && f[1] == "chain" && f[5] in UNDO_CHAIN_STATUSES && chainEntry(f[2], f[3], f[4]) != null -> st["chain ${f[2]} ${f[3]} ${f[4]}"] = f[5]
            f.size == 6 && f[1] == "jumps" && chainEntry(f[2], f[3], f[4]) != null -> f[5].toIntOrNull()?.let { jumps["${f[2]} ${f[3]} ${f[4]}"] = it }
            f.size == 4 && f[1] == "boot" && isSafeBootFile(f[2]) && f[3] in UNDO_BOOT_STATUSES -> st["boot ${f[2]}"] = f[3]
        }
    }
    return UndoAnswers(st, jumps)
}

/**
 * What the undo step did. [counts] is true when there was something to undo (so a step that did not run keeps the plugin). [log] are lines for the stop log,
 * [leftovers] what is still there or was not undone, [notChecked] why a part did not run. [clean]: nothing to undo, or every item came back "removed" or "absent".
 * This is the script's OWN answer. Step 3 adds an independent re-check after it.
 */
internal class UndoStopResult(val counts: Boolean, val ran: Boolean, val log: List<String>, val leftovers: List<String>, val notChecked: List<String>) {
    val clean: Boolean get() = !counts || (ran && leftovers.isEmpty())

    companion object {
        /** The step could not start ([why]): every item is listed as not undone. */
        fun notRun(plan: UndoPlan, why: String) = UndoStopResult(
            plan.items.isNotEmpty(), false, plan.items.map { "NOT RUN: undo ${it.label}" },
            plan.items.map { "not undone: ${it.label} ($why)" }, listOf("undo did not run ($why)"),
        )
    }
}

private fun undoKey(i: UndoItem) = if (i.kind == "chain") "chain ${i.table} ${i.chain} ${i.tool}" else "boot ${i.path}"

/**
 * Step 2: the undo step of a stop. Order inside the stop: declared commands, the sweep, THIS, then the verification (the caller).
 * Shares the 60 s clock ([totalMs], [start], [now]); the script is not started with under [UNDO_MIN_MS] left. No retry. [onRun] is called once per item right
 * before the script starts (the route writes one "plugin-undo" audit line each). Pure: the shell is passed in, so the tests use fakes or a real sh.
 */
internal fun runUndoStop(
    plan: UndoPlan,
    totalMs: Long,
    start: Long,
    now: () -> Long,
    exec: (String, Long) -> ShellResult,
    onRun: (String) -> Unit = {},
    pathPrefix: String = "",
): UndoStopResult {
    if (plan.items.isEmpty()) return UndoStopResult(false, false, emptyList(), emptyList(), emptyList())
    val script = undoScript(plan, pathPrefix) ?: return UndoStopResult.notRun(plan, "an item could not be used safely")
    val t = totalMs - (now() - start)
    if (t < UNDO_MIN_MS) return UndoStopResult.notRun(plan, "the ${totalMs / 1000} s total ran out")
    for (i in plan.items) onRun("undo ${i.label}")
    val r = try { exec(script, minOf(t, UNDO_TIMEOUT_MS)) } catch (e: Exception) { ShellResult(false, "could not run: ${e.message ?: e.javaClass.simpleName}") }
    val ans = parseUndoRun(r.content)
    val log = ArrayList<String>(); val left = ArrayList<String>()
    for (i in plan.items) {
        val st = ans.status[undoKey(i)]
        val jumps = if (i.kind == "chain") ans.jumps["${i.table} ${i.chain} ${i.tool}"] ?: 0 else 0
        val extra = if (jumps > 0) " ($jumps jump rule(s) removed first)" else ""
        when (st) {
            "removed" -> log.add("undo: removed ${i.label}$extra")
            "absent" -> log.add("undo: already gone: ${i.label}")
            "notool" -> { log.add("undo: NOT DONE ${i.label}: ${i.tool} not found"); left.add("not undone: ${i.label} (${i.tool} not found)") }
            "failed" -> { log.add("undo: FAILED ${i.label}$extra"); left.add("still there: ${i.label}") }
            null -> { log.add("undo: NO ANSWER for ${i.label}"); left.add("not undone: ${i.label} (the undo script gave no answer)") }
            else -> { log.add("undo: refused ${i.label} ($st)"); left.add("not undone: ${i.label} (${st.orEmpty().removePrefix("refused-")} check failed)") }
        }
    }
    if (!r.success) log.add((if (r.content.contains("[timeout after")) "undo TIMEOUT: " else "undo FAILED: ") + r.content.trim().take(STOP_OUTPUT_MAX).replace('\n', ' '))
    return UndoStopResult(true, true, log, left, emptyList())
}

/** Step 2: adds the undo step to a finished stop report. The stop succeeds only when the undo step is [UndoStopResult.clean] too. */
internal fun withUndo(base: StopReport, undo: UndoStopResult?): StopReport {
    if (undo == null || !undo.counts) return base
    val log = (base.log.lines() + undo.log).filter { it.isNotEmpty() }.joinToString("\n").take(2000)
    return StopReport(base.success && undo.clean, log, (base.leftovers + undo.leftovers).distinct(), base.notChecked + undo.notChecked, base.outcomes)
}

// ---- Step 3: the independent re-check ----

private val VERIFY_CHAIN_STATUSES = setOf("present", "absent", "notool", "error")
private val VERIFY_BOOT_STATUSES = setOf("present", "absent")

/**
 * Step 3: a READ-ONLY script that looks again, after the undo script, whether each item is still there. It does not trust the undo script's own answer.
 * Chain: the whole table is listed ("iptables -t T -S"); only a list that was really read and has no "-N CHAIN" line counts as "absent". A tool that is missing
 * is "notool" and a list that could not be read is "error": neither is ever taken for "gone" (the undo script's "chain not found" would also be the answer of a
 * failing iptables). Boot script: "present" when the path exists or is a (dangling) symlink, else "absent".
 * Output, one line each: MTCHK|chain|TABLE|CHAIN|TOOL|STATUS and MTCHK|boot|PATH|STATUS, then MTCHK-END. Same name checks as [undoScript]; null for an unsafe item.
 */
internal fun undoVerifyScript(plan: UndoPlan, pathPrefix: String = ""): String? {
    if (plan.items.isEmpty()) return null
    val calls = ArrayList<String>()
    for (i in plan.items) {
        when (i.kind) {
            "chain" -> { if (chainEntry(i.table, i.chain, i.tool) == null) return null; calls.add("chk_chain '${i.table}' '${i.chain}' '${i.tool}'") }
            "boot" -> { if (!isSafeBootFile(i.path)) return null; calls.add("chk_boot '${i.path}'") }
            else -> return null
        }
    }
    if (pathPrefix.any { !(it.isLetterOrDigit() || it == '/' || it == '.' || it == '_' || it == '-') }) return null
    // ^ stands for the dollar sign (replaced below), so the Kotlin raw string needs no escapes.
    val verifyTemplate = """
set -f
PFX='@PFX@'
chk_chain() {
  T=^1; C=^2; IPT=^3
  if ! command -v "^IPT" >/dev/null 2>&1; then echo "MTCHK|chain|^T|^C|^IPT|notool"; return; fi
  W=; if "^IPT" -w 5 -t "^T" -S >/dev/null 2>&1; then W="-w 5"; fi   # wait for the xtables lock only where iptables knows -w (1.6.2+); "-w 5" is a fixed word, never plugin text
  all=^("^IPT" ^W -t "^T" -S 2>/dev/null) || { echo "MTCHK|chain|^T|^C|^IPT|error"; return; }
  st=absent
  while IFS= read -r l; do
    if [ "^l" = "-N ^C" ]; then st=present; fi
  done <<MTCHK_EOF
^all
MTCHK_EOF
  echo "MTCHK|chain|^T|^C|^IPT|^st"
}
chk_boot() {
  f="^PFX^1"
  if [ -e "^f" ] || [ -L "^f" ]; then echo "MTCHK|boot|^1|present"; else echo "MTCHK|boot|^1|absent"; fi
}
@CALLS@
echo "MTCHK-END"
""".trimIndent()
    return verifyTemplate.replace('^', '$').replace("@PFX@", pathPrefix).replace("@CALLS@", calls.joinToString("\n"))
}

/** Step 3: pure parser of the re-check: "chain TABLE CHAIN TOOL" or "boot PATH" -> status. Only known statuses for valid names count; never throws. */
internal fun parseUndoVerify(output: String): Map<String, String> {
    val out = LinkedHashMap<String, String>()
    for (raw in output.split('\n')) {
        val f = raw.trimEnd('\r').split('|')
        if (f.isEmpty() || f[0] != "MTCHK") continue
        when {
            f.size == 6 && f[1] == "chain" && f[5] in VERIFY_CHAIN_STATUSES && chainEntry(f[2], f[3], f[4]) != null -> out["chain ${f[2]} ${f[3]} ${f[4]}"] = f[5]
            f.size == 4 && f[1] == "boot" && isSafeBootFile(f[2]) && f[3] in VERIFY_BOOT_STATUSES -> out["boot ${f[2]}"] = f[3]
        }
    }
    return out
}

/**
 * What the re-check found. [counts]: there were items, so the re-check is a required check. [ran]: EVERY item got a clear answer (present or absent).
 * [leftovers]: items still there. [notes]: why an item could not be checked. Success needs [ran] and no [leftovers].
 */
internal class UndoVerify(val counts: Boolean, val ran: Boolean, val leftovers: List<String>, val notes: List<String>) {
    companion object {
        fun notRun(plan: UndoPlan, why: String) = UndoVerify(plan.items.isNotEmpty(), false, emptyList(), if (plan.items.isEmpty()) emptyList() else listOf("undo re-check did not run ($why)"))
    }
}

/**
 * Step 3: the re-check of a stop. Runs after the undo script and before the plugin's own check, on the same 60 s clock; not started with under a second left
 * ([MIN_STOP_COMMAND_MS]). No retry. [onRun] is called once before the script starts (one audit line). A missing answer, a missing tool or an unreadable table
 * is a note and [UndoVerify.ran] stays false: "undone" is never said for something that was not looked at.
 */
internal fun verifyUndo(
    plan: UndoPlan,
    totalMs: Long,
    start: Long,
    now: () -> Long,
    exec: (String, Long) -> ShellResult,
    onRun: (String) -> Unit = {},
    pathPrefix: String = "",
): UndoVerify {
    if (plan.items.isEmpty()) return UndoVerify(false, false, emptyList(), emptyList())
    val script = undoVerifyScript(plan, pathPrefix) ?: return UndoVerify.notRun(plan, "an item could not be used safely")
    val t = totalMs - (now() - start)
    if (t < MIN_STOP_COMMAND_MS) return UndoVerify.notRun(plan, "the ${totalMs / 1000} s total ran out")
    onRun("undo re-check (read-only: is each item still there)")
    val r = try { exec(script, minOf(t, SWEEP_PROBE_TIMEOUT_MS)) } catch (e: Exception) { ShellResult(false, "could not run: ${e.message ?: e.javaClass.simpleName}") }
    val st = parseUndoVerify(r.content)
    val left = ArrayList<String>(); val notes = ArrayList<String>()
    var answered = 0
    for (i in plan.items) {
        when (st[undoKey(i)]) {
            "present" -> { answered++; left.add("still there: ${i.label}") }
            "absent" -> answered++
            "notool" -> notes.add("re-check: ${i.tool} not found, so it cannot show that ${i.label} is gone")
            "error" -> notes.add("re-check: the ${i.tool} list of table ${i.table} could not be read, so it cannot show that ${i.label} is gone")
            else -> notes.add("re-check gave no answer for ${i.label}")
        }
    }
    if (answered < plan.items.size && !r.success) notes.add("re-check failed: " + r.content.trim().take(STOP_OUTPUT_MAX).replace('\n', ' '))
    return UndoVerify(true, answered == plan.items.size, left, notes)
}

/**
 * Step 3 (D7): folds the re-check into the verification, like withSweepVerify does for processes. When there were items the re-check is one more required
 * check, for those items only: success needs every check the plugin declared to pass (if it declared any) AND the re-check to have run for every item and
 * found nothing. A clean re-check also counts as "a check ran" for a plugin that declared no check, no boot file and has no sweep. No items: [base] unchanged.
 */
internal fun withUndoVerify(base: StopVerify, v: UndoVerify?): StopVerify {
    if (v == null || !v.counts) return base
    val baseOk = base.declared == 0 || base.checkPassed
    return StopVerify(
        base.checkRan || v.ran,
        baseOk && v.ran && v.leftovers.isEmpty(),
        (base.leftovers + v.leftovers).distinct(),
        base.notes + v.notes,
        base.declared + 1,
    )
}

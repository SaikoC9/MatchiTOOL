package com.matchi.tool

/*
 * Plugin uninstall (Phase 1 of MatchiTOOL_Phase1_todo.txt). Plain Kotlin with NO android, org.json or NanoHTTPD imports, so
 * scripts/kotlin_pure_tests.sh compiles it and its unit tests run without the Android SDK. WebRoutesPlugins.kt only calls into this
 * file; every rule that can be tested without a device (header limits, the stop plan and its hash, the sandbox and integrity
 * checks, the same-folder guard) is meant to live here.
 *
 * Steps 1-5 of the to-do add their functions below. This file may use sha256Hex (PluginIntegrity.kt) and the sandbox constants (PluginSandbox.kt).
 * shellDanger (PluginGuard.kt) is passed in as a parameter, like sandboxNeeds does, so this file needs no other file for it.
 */

/** D2: the whole stop (every uninstall command together) may take at most 60 seconds; each command gets what is left. */
internal const val STOP_TOTAL_MS = 60_000L

/**
 * Step 2: may the stop run at all, given the plugin file's integrity state (integrityState in PluginIntegrity.kt)? null = yes.
 * "ok" (the approved file) and "untracked" (installed before records existed; the owner allowed these, D1) may stop; "changed" may not
 * until the person approves the file again; an unknown value is refused.
 */
internal fun stopBlockedReason(integrity: String): String? = when (integrity) {
    "ok", "untracked" -> null
    "changed" -> "the plugin file is not the one you approved; approve it again first"
    else -> "the plugin file's state is unknown; approve it again first"
}

/**
 * Step 2: why one uninstall (or check) command may not run, or null when it may. [shellProblem] is shellDanger(command, true) from the caller.
 * A sandboxed plugin may run it only when it EXACTLY equals one of its approved "shell:" grants ([grant] is sandboxGrant(...), which is
 * empty while the file differs from the approved one).
 */
internal fun refuseUninstallCommand(command: String, sandboxed: Boolean, grant: List<String>, shellProblem: (String) -> String?): String? {
    shellProblem(command)?.let { return "refused by the command filter ($it)" }
    if (sandboxed && (SBX_SHELL + command) !in grant)
        return "not approved: a sandboxed plugin may only run an uninstall command it declared with \"@matchi-needs shell:\" and you approved"
    return null
}

/** The commands that may run ([run], in order), the check command if it may run ([check]), and every refused command with its reason. */
internal class StopCommands(val run: List<String>, val check: String?, val refused: List<Pair<String, String>>)

/** Step 2: sorts a plugin's declared commands into those that may run and those that are refused. Runs nothing. */
internal fun checkUninstallCommands(decls: UninstallDecls, sandboxed: Boolean, grant: List<String>, shellProblem: (String) -> String?): StopCommands {
    val run = ArrayList<String>()
    val refused = ArrayList<Pair<String, String>>()
    for (c in decls.commands) {
        val why = refuseUninstallCommand(c, sandboxed, grant, shellProblem)
        if (why == null) run.add(c) else refused.add(c to why)
    }
    var check: String? = null
    val declaredCheck = decls.check
    if (declaredCheck != null) {
        val why = refuseUninstallCommand(declaredCheck, sandboxed, grant, shellProblem)
        if (why == null) {
            check = declaredCheck
        } else {
            refused.add(declaredCheck to why)
        }
    }
    return StopCommands(run, check, refused)
}

/**
 * Step 3: what deleting one plugin with "Stop" would do. [commands] and [check] are the text that really runs (already mapped with UfiPathMap, F10),
 * [refused] is every declared command that may not run with its reason, [bootFiles] are the boot files it declared (mapped the same way),
 * [blocked] is the reason the whole stop is blocked (integrity) or null, and [shared] lists the OTHER installed plugins that declare one of the same
 * commands or boot files. [planHash] is "" when nothing would run; otherwise it covers exactly what runs, so Step 4 can refuse a changed plan.
 */
internal class StopPlan(
    val commands: List<String>,
    val check: String?,
    val refused: List<Pair<String, String>>,
    val bootFiles: List<String>,
    val blocked: String?,
    val shared: List<String>,
    val planHash: String,
) {
    /** True when the stop has nothing to run: the plugin declares no commands, or none may run. */
    val isEmpty: Boolean get() = commands.isEmpty()
}

/** sha256 over the mapped commands, the mapped check command and the mapped boot files, each on its own line with a label, so moving text between them changes the hash. */
internal fun stopPlanHash(commands: List<String>, check: String?, bootFiles: List<String>): String {
    if (commands.isEmpty()) return ""
    val sb = StringBuilder()
    for (c in commands) sb.append("run:").append(c).append('\n')
    if (check != null) sb.append("check:").append(check).append('\n')
    for (b in bootFiles) sb.append("boot:").append(b).append('\n')
    return sha256Hex(sb.toString().toByteArray(Charsets.UTF_8))
}

/**
 * Step 3: builds the stop plan for plugin [name] whose file text is [code]. Runs nothing.
 *  - [integrity] is integrityState(...) of the file; "changed" (or unknown) blocks the stop: nothing runs, every declared command is listed as refused.
 *  - [sandboxed] and [grant] are the sandbox mode and sandboxGrant(...) for it (Step 2 rules).
 *  - [shellProblem] is shellDanger(cmd, true); it is asked about the MAPPED text, because that is what runs.
 *  - [mapPath] is UfiPathMap.map(cmd, packageName). The sandbox grant is matched against the DECLARED text, as the person approved it.
 *  - [others] are (file name, file text) of every installed plugin; [name] itself is skipped (a plugin is never "shared with itself").
 * Same-folder guard: when another plugin declares the same command (after mapping) or the same boot file, its name is in [StopPlan.shared]
 * and the page skips the stop by default. This protects "install a new copy under a new name, then delete the old one".
 */
internal fun stopPlan(
    name: String,
    code: String,
    integrity: String,
    sandboxed: Boolean,
    grant: List<String>,
    others: List<Pair<String, String>>,
    shellProblem: (String) -> String?,
    mapPath: (String) -> String,
): StopPlan {
    val decls = pluginUninstallDeclarations(code)
    val bootFiles = decls.bootFiles.map(mapPath)
    val blocked = stopBlockedReason(integrity)
    if (blocked != null) {
        val all = decls.commands + listOfNotNull(decls.check)
        return StopPlan(emptyList(), null, all.map { it to blocked }, bootFiles, blocked.takeIf { all.isNotEmpty() }, emptyList(), "")
    }
    val sorted = checkUninstallCommands(decls, sandboxed, grant) { shellProblem(mapPath(it)) }
    val commands = sorted.run.map(mapPath)
    val check = sorted.check?.let(mapPath)
    val sharedWith = LinkedHashSet<String>()
    if (commands.isNotEmpty()) {
        for ((otherName, otherCode) in others) {
            if (otherName == name) continue
            val o = pluginUninstallDeclarations(otherCode)
            val theirs = o.commands.map(mapPath).toSet()
            val theirBoot = o.bootFiles.map(mapPath).toSet()
            if (commands.any { it in theirs } || bootFiles.any { it in theirBoot }) sharedWith.add(otherName)
        }
    }
    return StopPlan(commands, check, sorted.refused, bootFiles, null, sharedWith.toList(), stopPlanHash(commands, check, bootFiles))
}

// ---- Step 4: running the stop ----

/** RootShell.run raises any timeout below this to 1 s, so a command is not started with less than that left. */
internal const val MIN_STOP_COMMAND_MS = 1_000L
internal const val STOP_OUTPUT_MAX = 300

/** What happened to one stop command. [status]: "ok", "failed", "timeout" (RootShell cut it) or "notRun" (the total time ran out or root was missing). */
internal class CommandOutcome(val command: String, val status: String, val output: String)

/**
 * Step 4: runs [commands] in order. All of them together may take [totalMs] (D2): each command gets what is left (D4), and a command is not
 * started when less than a second is left (it is reported "notRun"). A failed or timed-out command does not stop the rest, and nothing is
 * retried (D3). [onRun] is called just before each command that really starts (the route writes one audit line there). [start] is when the 60 s began, so verifyStop can share the same clock. Pure: the clock
 * and the shell are passed in, so the tests use fakes.
 */
internal fun runStopCommands(
    commands: List<String>,
    totalMs: Long,
    now: () -> Long,
    exec: (String, Long) -> ShellResult,
    onRun: (String) -> Unit = {},
    start: Long = now(),
): List<CommandOutcome> {
    val out = ArrayList<CommandOutcome>()
    for (c in commands) {
        val left = totalMs - (now() - start)
        if (left < MIN_STOP_COMMAND_MS) { out.add(CommandOutcome(c, "notRun", "the ${totalMs / 1000} s total ran out")); continue }
        onRun(c)
        val r = try { exec(c, left) } catch (e: Exception) { ShellResult(false, "could not run: ${e.message ?: e.javaClass.simpleName}") }
        val status = when {
            r.success -> "ok"
            r.content.contains("[timeout after") -> "timeout"
            else -> "failed"
        }
        out.add(CommandOutcome(c, status, r.content.trim().take(STOP_OUTPUT_MAX)))
    }
    return out
}

/** What the request asks for: [NONE] = behave as before (no stop), [SKIP] = "Delete without stopping", [RUN] = run the stop. */
internal enum class StopMode { NONE, SKIP, RUN }

/**
 * Step 4: which of the three the delete request is. A request without "stop", and a plan with nothing declared (no command and nothing refused),
 * behave as today. A plan whose every command was refused is still RUN: it cannot succeed, so the plugin is kept (D3).
 */
internal fun stopMode(stop: Boolean, skipStop: Boolean, plan: StopPlan): StopMode = when {
    !stop -> StopMode.NONE
    skipStop -> StopMode.SKIP
    plan.isEmpty && plan.refused.isEmpty() -> StopMode.NONE
    else -> StopMode.RUN
}

/** True when the plan the person reviewed ([sent]) is the plan the file gives now. A plan with nothing to run has the hash "". */
internal fun stopHashMatches(sent: String, plan: StopPlan): Boolean = sent == plan.planHash

/**
 * Step 5: what the verification found. [checkRan]: at least one check (the check command or the boot file test) ran. [checkPassed]: every check ran
 * and passed, and none that the plugin declared was left out. [leftovers] is what is still there. [notes] says why a declared check did not run.
 * [NOT_RUN] = nothing was verified.
 */
internal class StopVerify(val checkRan: Boolean, val checkPassed: Boolean, val leftovers: List<String>, val notes: List<String> = emptyList()) {
    companion object { val NOT_RUN = StopVerify(false, false, emptyList()) }
}

private val BOOT_PROBE_PATH = Regex("^/[A-Za-z0-9._/-]{1,199}$")

/** Step 5: a read-only script that prints "EXISTS <path>" for each path that exists (also a dangling symlink). Only plain paths are put in; the caller drops the others first. */
internal fun bootProbeScript(paths: List<String>): String =
    "for p in " + paths.joinToString(" ") { "'$it'" } + "; do if [ -e \"\$p\" ] || [ -L \"\$p\" ]; then echo \"EXISTS \$p\"; fi; done; true"

/** Step 5: the paths from [asked] that the probe output reports as existing, in the order asked. */
internal fun parseBootLeftovers(output: String, asked: List<String>): List<String> {
    val found = output.lineSequence().map { it.trim() }.filter { it.startsWith("EXISTS ") }.map { it.removePrefix("EXISTS ") }.toSet()
    return asked.filter { it in found }
}

/**
 * Step 5: verifies the stop after the commands ran. Two checks, both optional in the plugin:
 *  1. the plugin's check command (must exit 0);
 *  2. a read-only test that every declared boot file is gone.
 * They share the 60 s clock of the commands ([start], [totalMs]); a check is not started with under 1 s left. Nothing is retried. A check that
 * was declared but could not run is named in [StopVerify.notes] and blocks success: "never report stopped when a check did not run". [onRun] is
 * called before each check that starts (the route audits it).
 */
internal fun verifyStop(
    plan: StopPlan,
    totalMs: Long,
    start: Long,
    now: () -> Long,
    exec: (String, Long) -> ShellResult,
    onRun: (String) -> Unit = {},
): StopVerify {
    val notes = ArrayList<String>()
    val leftovers = ArrayList<String>()
    var declared = 0; var done = 0; var passed = 0
    fun left() = totalMs - (now() - start)
    fun run(cmd: String): ShellResult? {
        if (left() < MIN_STOP_COMMAND_MS) return null
        onRun(cmd)
        return try { exec(cmd, left()) } catch (e: Exception) { ShellResult(false, "could not run: ${e.message ?: e.javaClass.simpleName}") }
    }
    val check = plan.check
    if (check != null) {
        declared++
        val r = run(check)
        if (r == null) notes.add("check command did not run (the ${totalMs / 1000} s total ran out)")
        else {
            done++
            if (r.success) passed++
            else leftovers.add("the check command says something is still there" + r.content.trim().take(STOP_OUTPUT_MAX).let { if (it.isEmpty()) "" else ": " + it.replace('\n', ' ') })
        }
    }
    if (plan.bootFiles.isNotEmpty()) {
        declared++
        val safe = plan.bootFiles.filter { BOOT_PROBE_PATH.matches(it) && it.split('/').drop(1).none { p -> p.isEmpty() || p == "." || p == ".." } }
        if (safe.size != plan.bootFiles.size) notes.add("boot file test skipped for a path with unusual characters")
        val r = if (safe.isEmpty()) null else run(bootProbeScript(safe))
        if (safe.size != plan.bootFiles.size || r == null || !r.success) {
            if (r == null && safe.isNotEmpty()) notes.add("boot file test did not run (the ${totalMs / 1000} s total ran out)")
            else if (r != null && !r.success) notes.add("boot file test failed: " + r.content.trim().take(STOP_OUTPUT_MAX).replace('\n', ' '))
        } else {
            done++
            val still = parseBootLeftovers(r.content, safe)
            if (still.isEmpty()) passed++ else for (b in still) leftovers.add("boot file still there: $b")
        }
    }
    return StopVerify(done > 0, done > 0 && done == declared && passed == done, leftovers, notes)
}

/** The result shown to the person. [success] never says "stopped" unless every command ran and exited 0 AND a check ran and passed. */
internal class StopReport(val success: Boolean, val log: String, val leftovers: List<String>, val notChecked: List<String>, val outcomes: List<CommandOutcome>)

/** Step 4: builds the report from the plan, what happened and the verification. [headline] goes first in the log (for example "Could not stop: root not available"). */
internal fun stopReport(plan: StopPlan, outcomes: List<CommandOutcome>, verify: StopVerify, headline: String? = null): StopReport {
    val notChecked = ArrayList<String>()
    for ((c, why) in plan.refused) notChecked.add("refused: $c ($why)")
    for (o in outcomes) if (o.status == "notRun") notChecked.add("not run: ${o.command} (${o.output})")
    notChecked.addAll(verify.notes)
    if (plan.check == null) notChecked.add("no check command declared")
    else if (!verify.checkRan && verify.notes.none { it.startsWith("check command") }) notChecked.add("check command did not run")
    if (plan.bootFiles.isEmpty()) notChecked.add("no boot file declared")
    val allRan = outcomes.size == plan.commands.size && outcomes.all { it.status == "ok" }
    val success = allRan && plan.refused.isEmpty() && plan.blocked == null && verify.checkRan && verify.checkPassed && verify.leftovers.isEmpty()
    val sb = StringBuilder()
    if (headline != null) sb.append(headline).append('\n')
    for (o in outcomes) {
        val label = when (o.status) { "ok" -> "ok"; "timeout" -> "TIMEOUT"; "notRun" -> "NOT RUN"; else -> "FAILED" }
        sb.append(label).append(": ").append(o.command)
        if (o.status != "ok" && o.output.isNotEmpty()) sb.append(" - ").append(o.output.replace('\n', ' '))
        sb.append('\n')
    }
    return StopReport(success, sb.toString().trimEnd().take(2000), verify.leftovers, notChecked, outcomes)
}

package com.matchi.tool

import fi.iki.elonen.NanoHTTPD.IHTTPSession
import fi.iki.elonen.NanoHTTPD.Method
import fi.iki.elonen.NanoHTTPD.Response
import fi.iki.elonen.NanoHTTPD.newFixedLengthResponse
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

// Plugin files, plugin data, plugin security scan and the upload folder.
// Split out of WebServer.kt (route groups are extension functions; helpers moved with them). Each route function
// returns null when the path is not one of its own, so WebServer.route() can ask the next group.

/**
 * The paths every OTHER installed plugin uses: what it declares with "@matchi-data", what its ledger recorded, and the absolute paths in its uninstall
 * commands. The same-folder guard (test C) for erasing data, and the shared guard of the process sweep (Phase 2, P8), both read this.
 */
internal fun WebServer.pluginOtherPaths(name: String): Map<String, List<String>> {
    val others = HashMap<String, List<String>>()
    pluginDir.listFiles { x -> x.isFile && x.name != name && (x.name.endsWith(".js") || x.name.endsWith(".html")) }?.forEach { o ->
        val oc = try { o.readText() } catch (_: Exception) { "" }
        val od = pluginUninstallDeclarations(oc)
        others[o.name] = (pluginDataDeclarations(oc) + traceStore.read(o.name).paths + commandPaths(od.commands, od.check)).distinct()
    }
    return others
}

/**
 * Phase 3 / Step 1: what "Delete and stop" would undo outside the plugin's own files (firewall chains and boot scripts the ledger saw it create), from the
 * ledger alone. Nothing is run and no root is needed here. What another installed plugin records, declares or names in its uninstall commands is kept.
 */
internal fun WebServer.pluginUndo(name: String): UndoPlan {
    val led = traceStore.read(name)
    val others = HashMap<String, UndoUse>()
    pluginDir.listFiles { x -> x.isFile && x.name != name && (x.name.endsWith(".js") || x.name.endsWith(".html")) }?.forEach { o ->
        val oc = try { o.readText() } catch (_: Exception) { "" }
        val od = pluginUninstallDeclarations(oc)
        val ol = traceStore.read(o.name)
        others[o.name] = UndoUse(ol.chains, (ol.bootFiles + od.bootFiles).distinct(), (od.commands + listOfNotNull(od.check)).joinToString("\n"))
    }
    return undoPlan(led.chains, led.bootFiles, others)
}

internal fun UndoPlan.toJson(): JSONObject {
    val arr = JSONArray()
    for (i in items) arr.put(JSONObject().put("kind", i.kind).put("label", i.label))
    return JSONObject().put("items", arr).put("notUndone", JSONArray(notUndone)).put("hash", hash)
}

/**
 * Phase 2 / Step 4: the processes the sweep would end for plugin [name] (read-only; nothing is killed here). One root probe of up to
 * SWEEP_PROBE_TIMEOUT_MS, separate from the 60 s stop clock. Ledger paths are what the plugin sent, and the process command lines hold the same text. Without root the answer is "cannot be checked", never a guessed list.
 */
internal fun WebServer.pluginSweepInputs(name: String): Pair<List<String>, Map<String, List<String>>> {
    val ledger = traceStore.read(name).paths.distinct()
    val others = pluginOtherPaths(name)
    return ledger to others
}

internal fun WebServer.pluginSweep(name: String): SweepView {
    val (ledger, others) = pluginSweepInputs(name)
    val granted = RootShell.status(ctx).granted
    val run = if (granted) RootShell.run(ctx, sweepProbeScript(sweepPidfilePaths(ledger)), SWEEP_PROBE_TIMEOUT_MS) else null
    return buildSweepView(name, granted, run, ledger, others)
}

internal fun SweepView.toJson(): JSONObject {
    val cands = JSONArray()
    for (c in result.candidates) cands.put(JSONObject().put("pid", c.pid).put("start", c.start).put("how", c.how).put("args", c.args))
    return JSONObject().put("rootOk", checked).put("candidates", cands).put("notStopped", JSONArray(result.notStopped))
        .put("notes", JSONArray(result.notes)).put("found", result.found).put("overCap", result.overCap)
        .put("complete", result.complete).put("sweepHash", hash)
}

/** Paths to erase for a plugin: (allowed, rejected with reason). The plugin's own data folder is always included. */
internal fun WebServer.pluginDataPlan(name: String): Pair<List<String>, List<Pair<String, String>>> {
    val f = File(pluginDir, name)
    val code = if (f.isFile) try { f.readText() } catch (_: Exception) { "" } else ""
    val ok = ArrayList<String>()
    val bad = ArrayList<Pair<String, String>>()
    ok.add(pluginDataDir(name))
    // A folder that another installed plugin declares or recorded in its ledger is NOT erased: deleting an old copy of a plugin must not take what a newer
    // copy under another name still needs (test C on the F50 showed the folder gone). It is listed as "not erased" with the reason.
    val others = pluginOtherPaths(name)
    fun shareNote(d: String): String? = pluginsUsingPath(d, others).takeIf { it.isNotEmpty() }?.let { "also used by " + it.joinToString(", ") + ", so it is kept" }
    // Folders named after the plugin are erased too, without a header line. They pass the same strict check and are listed in the dialog (only when they exist).
    // Implicit guesses never touch the shared storage (/sdcard): a plugin named Backup.js must not erase the person's /sdcard/Backup. It declares what it owns with @matchi-data.
    for (d in implicitPluginPaths(name)) if (!d.startsWith("/sdcard/") && checkPluginDataPath(d, name) == null && d !in ok) ok.add(d)
    for (d in pluginDataDeclarations(code)) {
        val why = checkPluginDataPath(d, name) ?: shareNote(d)
        if (why == null) { if (d !in ok) ok.add(d) } else bad.add(d to why)
    }
    // Paths its root commands wrote to while it ran (the ledger). Same strict check; a path inside another listed path is dropped.
    for (d in traceStore.read(name).paths) if (checkPluginDataPath(d, name) == null && d !in ok) {
        val shared = shareNote(d)
        if (shared == null) ok.add(d) else if (bad.none { it.first == d }) bad.add(d to shared)
    }
    // Loose files named after the plugin (NAME.txt, NAME.js, NAME.html, NAME.log ...), added last so the cap below never drops a traced path for them.
    for (d in implicitPluginFiles(name)) if (!d.startsWith("/sdcard/") && checkPluginDataPath(d, name) == null && d !in ok) ok.add(d)
    val pruned = ok.filter { p -> ok.none { q -> q != p && p.startsWith("$q/") } }.take(100)
    return pruned to bad
}

/**
 * Step 3: the stop plan for plugin [name], read from the file as it is NOW (the delete route reads it before the file is removed, Step 4).
 * Collects what the pure stopPlan() needs: the integrity state, the sandbox mode and grant, the other installed plugins (for the same-folder guard),
 * and the command filter. Runs nothing. A missing file gives an empty plan.
 */
internal fun WebServer.pluginStopPlan(name: String): StopPlan {
    val f = File(pluginDir, name)
    val bytes = if (f.isFile) try { f.readBytes() } catch (_: Exception) { null } else null
    if (bytes == null) return stopPlan(name, "", "ok", false, emptyList(), emptyList(), { null }, { it })
    val records = Prefs.pluginRecords(ctx)
    val integrity = integrityState(records[name]?.sha, sha256Hex(bytes))
    val sandboxed = pluginKind(name) == "js" && Prefs.pluginModes(ctx)[name] == "sandbox"
    val grant = sandboxGrant(records[name]?.caps, integrity)
    val others = pluginDir.listFiles { x -> x.isFile && x.name != name && (x.name.endsWith(".js") || x.name.endsWith(".html")) }
        ?.mapNotNull { x -> try { x.name to x.readText() } catch (_: Exception) { null } }.orEmpty()
    return stopPlan(name, String(bytes, Charsets.UTF_8), integrity, sandboxed, grant, others, { shellDanger(it, true) }, { it })
}

internal fun StopPlan.toJson(): JSONObject {
    val refusedArr = JSONArray()
    for ((c, why) in refused) refusedArr.put(JSONObject().put("command", c).put("reason", why))
    return JSONObject().put("commands", JSONArray(commands)).put("check", check ?: JSONObject.NULL).put("bootFiles", JSONArray(bootFiles))
        .put("refused", refusedArr).put("blocked", blocked ?: JSONObject.NULL).put("shared", JSONArray(shared)).put("planHash", planHash)
}

internal fun StopReport.toJson(): JSONObject {
    val cmds = JSONArray()
    for (o in outcomes) cmds.put(JSONObject().put("command", o.command).put("status", o.status).put("output", o.output))
    return JSONObject().put("success", success).put("log", log).put("leftovers", JSONArray(leftovers)).put("notChecked", JSONArray(notChecked)).put("commands", cmds)
}

// Paths passed the strict character check in checkPluginDataPath, so they cannot break out of single quotes.
internal fun WebServer.quotedList(paths: List<String>) = paths.joinToString(" ") { "'$it'" }

internal fun WebServer.probeScript(paths: List<String>) =
    "for p in ${quotedList(paths)}; do if [ -e \"\$p\" ] || [ -L \"\$p\" ]; then " +
    "echo \"EXISTS \$(du -sk -- \"\$p\" 2>/dev/null | cut -f1) \$p\"; fi; done; true"

// rm -rf on a symlink removes the link itself, never what it points to, but it DOES follow a symlink in a parent folder.
// So every folder between the allowed root and the path is tested with [ -L ] first, and the path is skipped if one is a link.
// After a path is removed, the parent folders it leaves EMPTY are removed too (rmdir never deletes a folder that has anything in it,
// and prunableParents never lists a protected folder such as Download or /data/local/tmp itself).
internal fun WebServer.eraseScript(paths: List<String>, pluginName: String) = paths.joinToString("\n") { p ->
    val links = symlinkAncestors(p).joinToString(" || ") { "[ -L '$it' ]" }.ifEmpty { "false" }
    val parents = prunableParents(p, pluginName).joinToString(" ") { "'$it'" }
    val prune = if (parents.isEmpty()) "" else " rmdir -- $parents 2>/dev/null;"
    "if [ -e '$p' ] || [ -L '$p' ]; then if $links; then echo \"SKIPPED $p\"; " +
    "elif rm -rf -- '$p'; then echo \"REMOVED $p\";$prune else echo \"FAILED $p\"; fi; fi"
} + "\ntrue"

// NanoHTTPD copies the whole body to a temp file BEFORE any of our checks run, so the limits are enforced up front:
// one upload at a time (the app update upload uses the slot) and enough free space for the announced size plus a reserve.
private val uploadSlot = java.util.concurrent.Semaphore(1)

internal fun <T> WebServer.withUploadSlot(len: Long, block: () -> T): T {
    if (!uploadSlot.tryAcquire()) throw IllegalArgumentException("Another upload is in progress; try again when it has finished")
    try {
        val free = try { android.os.StatFs(ctx.cacheDir.absolutePath).availableBytes } catch (_: Exception) { Long.MAX_VALUE }
        if (!uploadSpaceOk(free, len)) throw IllegalArgumentException("Not enough free space on the device for this upload")
        return block()
    } finally { uploadSlot.release() }
}

/**
 * Password check for changes to plugins (Phase 1): installing, replacing, deleting or approving a plugin needs the sign-in password again,
 * with the same lockout as /api/login and /api/security/net, so a plugin that holds the session token cannot rewrite plugins silently.
 * Returns a response to send back (password missing, or locked out), or null when the password is right. A wrong password throws.
 * Limit, stated plainly: a plugin that wraps window.fetch can still read the password while YOU type it. This stops silent changes only.
 */
internal fun WebServer.pluginPasswordCheck(s: IHTTPSession, req: JSONObject, what: String): Response? {
    val pw = req.optString("password").take(200)
    if (pw.isEmpty()) return json(Response.Status.FORBIDDEN, JSONObject().put("code", "plugin-password").put("error", "Enter your sign-in password to $what"))
    return passwordGate(s, pw, "Password is wrong")
}

internal fun WebServer.routePlugins(s: IHTTPSession, uri: String): Response? = when {
    uri == "/api/plugins" && s.method == Method.GET -> {
        val off = Prefs.disabled(ctx)
        val arr = JSONArray()
        val all = pluginDir.listFiles { f -> f.isFile && (f.name.endsWith(".js") || f.name.endsWith(".html")) }
            ?.associateBy { it.name }.orEmpty()
        val titles = Prefs.pluginTitles(ctx)
        val netExtra = Prefs.netHosts(ctx)
        val records = Prefs.pluginRecords(ctx)
        val modes = Prefs.pluginModes(ctx)
        for (n in orderPlugins(all.keys, Prefs.pluginOrder(ctx))) {
            val f = all.getValue(n)
            val bytes = f.readBytes()
            val src = String(bytes, Charsets.UTF_8)
            val sc = scanPlugin(src, netExtra)
            val sha = sha256Hex(bytes)
            val integrity = integrityState(records[n]?.sha, sha)   // ok | changed | untracked
            // Sandbox (Phase 4): only .js plugins can run sandboxed. "declared" is what the file asks for now; "grant" is what the person approved,
            // and it is empty while the file differs from the approved one. The page enforces "grant" in its bridge.
            val needs = if (pluginKind(n) == "js") sandboxNeeds(src) { shellDanger(it, true) } else null
            val sandboxed = needs != null && modes[n] == "sandbox"
            val o = JSONObject().put("name", n).put("code", src).put("enabled", n !in off)
                .put("kind", pluginKind(n)).put("title", titles[n] ?: pluginBaseName(n))
                .put("risk", sc.risk).put("sha256", sha)
                .put("integrity", integrity)
                .put("caps", JSONArray(if (needs != null && sandboxed) needs.caps + uninstallCaps(src) else pluginCaps(src, sc.hosts)))
                .put("mode", if (sandboxed) "sandbox" else "trusted")
            if (needs != null) o.put("declared", JSONArray(needs.caps)).put("sbxProblems", JSONArray(needs.problems))
            if (sandboxed) o.put("grant", JSONArray(sandboxGrant(records[n]?.caps, integrity)))
            arr.put(o)
        }
        json(Response.Status.OK, arr)
    }
    // Upload or replace a plugin: {"name":"My_Plugin.js","code":"..."}
    uri == "/api/plugins" && s.method == Method.POST -> rootGate(s) ?: run {
        val req = body(s)
        val name = req.optString("name"); val code = req.optString("code")
        if (!nameRx.matches(name) || name.contains("..")) throw IllegalArgumentException("invalid plugin name")
        val codeBytes = code.toByteArray(Charsets.UTF_8).size
        if (code.isBlank() || codeBytes > 1_048_576) throw IllegalArgumentException("plugin must be 1 byte to 1 MB")
        val reserved = setOf("AT_Radio.js", "Network_Diagnostics.js",
            "Live_Status.js", "Memory_Cleaner.js", "Change_IP.js", "SMS.js", "Screen_Control.js")
        if (name in reserved) throw IllegalArgumentException("built-in tool names are reserved")
        val files = pluginDir.listFiles { f -> f.isFile && (f.name.endsWith(".js") || f.name.endsWith(".html")) }?.toList().orEmpty()
        if (files.none { it.name == name } && files.size >= 50) throw IllegalArgumentException("maximum of 50 custom plugins reached")
        val total = files.filter { it.name != name }.sumOf { it.length() } + codeBytes
        if (total > 5L * 1024L * 1024L) throw IllegalArgumentException("custom plugin storage limit is 5 MB")
        // Every install needs the password, new names included: otherwise a running plugin could install another plugin (a copy of itself under a
        // new name) without you, and it could send "force" and "confirmCaps" itself to skip the risky-code and new-abilities prompts. Those two
        // fields are only reached after the password was right. The one exception is saving nothing new: the same bytes as the file AND as the
        // approved record. The record is part of that test, otherwise re-saving a tampered file would quietly approve it.
        // (This stays after the name, size and reserved-name checks above, so a bad request is still answered as a bad request.)
        val target = File(pluginDir, name)
        val newBytes = code.toByteArray(Charsets.UTF_8)
        val newSha = sha256Hex(newBytes)
        val oldBytes = if (target.isFile) target.readBytes() else null
        val record = Prefs.pluginRecords(ctx)[name]
        val unchanged = oldBytes != null && record?.sha == newSha && sha256Hex(oldBytes) == newSha
        if (!unchanged)
            pluginPasswordCheck(s, req, if (oldBytes != null) "replace an installed plugin" else "install a plugin")?.let { return@run it }
        val sandboxed = Prefs.pluginModes(ctx)[name] == "sandbox" && pluginKind(name) == "js"   // a replaced plugin keeps its mode
        val scan = scanPlugin(code, Prefs.netHosts(ctx))
        if (scan.blocked) {
            if (!req.optBoolean("force", false)) {
                val arr = JSONArray()
                for (f in scan.findings) if (f.level != "info") arr.put(JSONObject().put("level", f.level).put("code", f.code).put("message", f.message))
                return@run json(Response.Status.CONFLICT, JSONObject().put("code", "risky").put("error", "This plugin has risky code").put("findings", arr))
            }
            LogCatcher.log("WARNING", "plugin/guard", "[$name] installed after the person accepted: " + scan.findings.filter { it.level == "block" }.joinToString(", ") { it.code })
        }
        // An update that adds a capability (root commands, network use, a new host, the token) is shown again. The baseline is the approved
        // record, or the file on disk when the plugin was installed before records existed.
        // A sandboxed plugin's list is its declared sandbox permissions (PluginSandbox.kt), so an update that asks for another one is shown again too.
        val caps = effectiveCaps(code, scan.hosts, sandboxed) { shellDanger(it, true) }
        if (oldBytes != null) {
            val oldSrc = String(oldBytes, Charsets.UTF_8)
            val before = record?.caps ?: effectiveCaps(oldSrc, scanPlugin(oldSrc, Prefs.netHosts(ctx)).hosts, sandboxed) { shellDanger(it, true) }
            val added = addedCaps(before, caps)
            if (added.isNotEmpty() && !req.optBoolean("confirmCaps", false))
                return@run json(Response.Status.CONFLICT, JSONObject().put("code", "newcaps").put("error", "This update adds new abilities")
                    .put("added", JSONArray(added.map { describeCap(it) })))
        }
        auditShell(s.remoteIpAddress ?: "?", name + "\n" + code, "plugin-upload")
        target.writeText(code)
        Prefs.setPluginRecord(ctx, name, PluginRecord(newSha, caps))
        // UFI-TOOLS blocks keep their original name (it may hold spaces or non-Latin letters) next to the safe file name.
        if (req.has("title")) Prefs.setPluginTitle(ctx, name, cleanPluginTitle(req.optString("title")).ifBlank { null })
        json(Response.Status.OK, JSONObject().put("ok", true))
    }
    // Save the load order: {"names":["B.js","A-1f2e3d.html"]}. Unknown names are dropped; plugins not listed load after them.
    uri == "/api/plugins/order" && s.method == Method.POST -> rootGate(s) ?: run {
        val arr = body(s).optJSONArray("names") ?: throw IllegalArgumentException("names must be an array")
        if (arr.length() > 50) throw IllegalArgumentException("at most 50 names")
        val have = pluginDir.listFiles { f -> f.isFile }?.map { it.name }?.toSet().orEmpty()
        val names = (0 until arr.length()).map { arr.optString(it) }
        if (names.any { !nameRx.matches(it) || it.contains("..") }) throw IllegalArgumentException("invalid plugin name")
        Prefs.setPluginOrder(ctx, names.filter { it in have })
        json(Response.Status.OK, JSONObject().put("ok", true))
    }
    // What deleting this plugin would erase (read-only): its own data folder plus the paths it declares with
    // "// @matchi-data /path" in its source. Used by the page to show the list before the user confirms.
    // Not behind rootGate as a whole (see the note inside): only its two root calls are.
    uri == "/api/plugins/data" && s.method == Method.POST -> {
        val name = body(s).optString("name")
        if (!nameRx.matches(name) || name.contains("..")) throw IllegalArgumentException("invalid plugin name")
        val (paths, rejected) = pluginDataPlan(name)
        // 1.4.2 (F10): the two root calls (existence probe, process scan) run only when rootGate would let a root route through. A refused request is NOT an error:
        // the page treats an error as "nothing to show" and would silently fall back to a plain delete, so it gets the same answer as "root not available" instead
        // (items without "exists", sweep.rootOk=false) and still receives the stop plan, the undo list, the uploads and the effects, which come from files and the ledger.
        val gated = rootGate(s) != null
        val probe = if (gated) ShellResult(false, "") else RootShell.run(ctx, probeScript(paths), 15_000)
        val found = HashMap<String, Long>()
        if (probe.success) probe.content.lineSequence().forEach { line ->
            val m = Regex("^EXISTS (\\d*) (/\\S+)$").find(line.trim()) ?: return@forEach
            found[m.groupValues[2]] = m.groupValues[1].toLongOrNull() ?: -1L
        }
        val items = JSONArray()
        for (p in paths) items.put(JSONObject().put("path", p).apply {
            if (probe.success) { put("exists", p in found); if ((found[p] ?: -1L) >= 0) put("kb", found[p]) }
        })
        val bad = JSONArray()
        for ((p, why) in rejected) bad.put(JSONObject().put("path", p).put("reason", why))
        val led = traceStore.read(name)
        val ups = JSONArray(); for (u in led.uploads) if (File(uploadDir, u).isFile) ups.put(u)
        json(Response.Status.OK, JSONObject().put("items", items).put("rejected", bad).put("rootOk", probe.success)
            .put("uploads", ups).put("effects", JSONArray(led.effects)).put("stopPlan", pluginStopPlan(name).toJson()).put("sweep", (if (gated) refusedSweep() else pluginSweep(name)).toJson()).put("undo", pluginUndo(name).toJson()))
    }
    // Delete a plugin: {"name":"My_Plugin.js","erase":true}. With erase, the data from /api/plugins/data is removed too.
    // Phase 1 / Step 4: {"stop":true,"planHash":"..."} first runs the plugin's own uninstall commands (the plan from /api/plugins/data).
    // If the stop does not fully succeed the plugin is NOT deleted and nothing is erased: the answer is {"ok":false,"kept":true,"stop":{...}} and the
    // person can try again or send {"stop":true,"skipStop":true} ("Delete without stopping"). A request without "stop" never runs a stop.
    uri == "/api/plugins/delete" && s.method == Method.POST -> run {
        val req = body(s)
        val wantStop = req.optBoolean("stop", false)
        val keep = req.optBoolean("keep", false) // Phase 3 / Step 5: "Disable and stop": the same stop, but the plugin and its data stay and it is switched off
        // Erasing plugin data and stopping both run root scripts; a plain delete of the plugin file does not.
        if (req.optBoolean("erase", false) || wantStop) rootGate(s)?.let { return@run it }
        // Deleting needs the password too: delete, then install under the same name, would otherwise skip the check on replacing.
        if (!keep) pluginPasswordCheck(s, req, "delete a plugin")?.let { return@run it } // Step 5 (owner): "Turn off and stop" asks no password, like a plain toggle; the root gate above still applies
        val name = req.optString("name")
        if (!nameRx.matches(name) || name.contains("..")) throw IllegalArgumentException("invalid plugin name")
        val ip = s.remoteIpAddress ?: "?"
        val stopPlanNow = if (wantStop) pluginStopPlan(name) else null // read from the file BEFORE it is deleted, like the erase plan
        val skipStop = req.optBoolean("skipStop", false)
        // keep only makes sense with a real stop: never with skipStop (then the page just toggles) and never with erase (the data stays).
        if (keep && (!wantStop || skipStop || req.optBoolean("erase", false))) throw IllegalArgumentException("keep needs stop, and no skipStop or erase")
        if (keep && !File(pluginDir, name).isFile) throw IllegalArgumentException("no such plugin")
        if (req.has("hookRan")) auditShell(ip, hookAuditLine(name, req.optBoolean("hookRan", false), req.optString("hookStatus")), "plugin-hook") // Step 7: audit only; never read for the outcome
        // Phase 2 / Step 5: the process sweep is part of the request only when the page sends "sweepHash" (even an empty one). A page that does not
        // (Phase 1 behaviour) never gets a sweep, so it can not be refused for a hash it never had.
        val sweepNow = if (stopPlanNow != null && !skipStop && req.has("sweepHash")) pluginSweep(name) else null // BEFORE anything runs
        var stopOut: JSONObject? = null
        // D3: what the person saw is what runs. A different process list now (a new match, or one that ended) keeps everything and opens the dialog again.
        if (sweepNow != null && !sweepHashMatches(req.optString("sweepHash"), sweepNow))
            return@run json(Response.Status.CONFLICT, JSONObject().put("code", "plan-changed").put("error", "The processes it started changed since you reviewed it; open the delete dialog again"))
        // Phase 3 / Step 2: the undo (firewall chains and boot scripts the ledger saw the plugin create) is part of the request only when the page sends
        // "undoHash" (even an empty one); a page that does not never gets an undo. The same hash rule as the sweep: what the person saw is what runs.
        val undoNow = if (stopPlanNow != null && !skipStop && req.has("undoHash")) pluginUndo(name) else null // BEFORE anything runs
        if (undoNow != null && req.optString("undoHash") != undoNow.hash)
            return@run json(Response.Status.CONFLICT, JSONObject().put("code", "plan-changed").put("error", "What it left behind in the system changed since you reviewed it; open the delete dialog again"))
        val undoCount = undoNow?.items?.size ?: 0
        val sweepFound = sweepNow?.result?.found ?: 0
        if (stopPlanNow != null && stopMode(true, skipStop, stopPlanNow, sweepFound, undoCount) == StopMode.RUN) {
            // The plan is recomputed from the file as it is now; the person reviewed the one in planHash.
            if (!stopHashMatches(req.optString("planHash"), stopPlanNow))
                return@run json(Response.Status.CONFLICT, JSONObject().put("code", "plan-changed").put("error", "The plugin changed since you reviewed it; open the delete dialog again"))
            val report = if ((stopPlanNow.commands.isNotEmpty() || sweepFound > 0 || undoCount > 0) && !RootShell.status(ctx).granted) {
                val off = stopPlanNow.commands.map { CommandOutcome(it, "notRun", "root not available") }
                val offSweep = sweepNow?.let { v -> SweepStopResult(true, emptyList(), false, emptyList(), v.result.candidates.map { "not stopped (root not available): PID ${it.pid} ${it.args}" }) }
                withUndo(stopReport(stopPlanNow, off, StopVerify.NOT_RUN, "Could not stop: root not available", offSweep), undoNow?.let { UndoStopResult.notRun(it, "root not available") })
            } else {
                val t0 = System.currentTimeMillis()
                val exec = { cmd: String, ms: Long -> RootShell.run(ctx, cmd, ms) }
                val audit = { cmd: String -> auditShell(ip, cmd, "plugin-uninstall") }
                val outcomes = runStopCommands(stopPlanNow.commands, STOP_TOTAL_MS, System::currentTimeMillis, exec, audit, t0)
                // Phase 2 / Step 5 (D4): after the declared commands, end the processes that were shown, then scan again. Same 60 s clock. A stop that is
                // blocked or has refused commands cannot succeed and runs nothing of the sweep either (the file is not the one the person approved).
                val sweepRes = if (sweepNow != null && stopPlanNow.blocked == null && stopPlanNow.refused.isEmpty()) {
                    val (ledgerPaths, others) = pluginSweepInputs(name)
                    val auditSweep = { line: String -> auditShell(ip, line, "plugin-sweep") }
                    runSweepStop(name, sweepNow, STOP_TOTAL_MS, t0, System::currentTimeMillis, exec, ledgerPaths, others, auditSweep, auditSweep)
                } else null
                // Phase 3 / Step 2: after the sweep (no watcher left to add the rules again), undo what the ledger saw it create: jump rules, then the chain, then the
                // boot script. Same 60 s clock, one "plugin-undo" audit line per item. A stop that is blocked or has refused commands runs none of it, like the sweep.
                val undoRes = if (undoNow != null && stopPlanNow.blocked == null && stopPlanNow.refused.isEmpty()) {
                    runUndoStop(undoNow, STOP_TOTAL_MS, t0, System::currentTimeMillis, exec, onRun = { line -> auditShell(ip, line, "plugin-undo") })
                } else undoNow?.let { UndoStopResult.notRun(it, "the stop was blocked or has refused commands") }
                // Step 5 of Phase 1: the check command and the boot file test share what is left of the same 60 s. D6: a clean re-scan counts as a check.
                // Phase 3 / Step 3: a separate read-only look at every undo item; "undone" needs it. A clean look counts as the check for those items (D7).
                val undoVer = if (undoNow != null && undoNow.items.isNotEmpty()) {
                    if (undoRes != null && undoRes.ran) verifyUndo(undoNow, STOP_TOTAL_MS, t0, System::currentTimeMillis, exec, onRun = { line -> auditShell(ip, line, "plugin-undo") })
                    else UndoVerify.notRun(undoNow, "the undo did not run")
                } else null
                val verify = withUndoVerify(withSweepVerify(verifyStop(stopPlanNow, STOP_TOTAL_MS, t0, System::currentTimeMillis, exec, audit), sweepRes), undoVer)
                withUndo(stopReport(stopPlanNow, outcomes, verify, null, sweepRes), undoRes)
            }
            stopOut = report.toJson()
            if (!report.success) return@run json(Response.Status.OK, JSONObject().put("ok", false).put("kept", true).put("stop", stopOut))
        }
        // Phase 3 / Step 5: a stop that did not fully succeed returned above and kept the plugin ON. Only now is it switched off; its file, data and ledger stay.
        if (keep) {
            Prefs.setEnabled(ctx, name, false)
            auditShell(ip, "disable " + name, "plugin-disable")
            val outKeep = JSONObject().put("ok", true).put("disabled", true)
            if (stopOut != null) outKeep.put("stop", stopOut)
            return@run json(Response.Status.OK, outKeep)
        }
        val plan = if (req.optBoolean("erase", false)) pluginDataPlan(name) else null // read the source BEFORE it is deleted
        val ledger = if (plan != null) traceStore.read(name) else null
        val deleted = File(pluginDir, name).delete()
        Prefs.setEnabled(ctx, name, true)
        if (deleted) Prefs.forgetPlugin(ctx, name)
        val out = JSONObject().put("ok", deleted)
        if (stopOut != null) out.put("stop", stopOut)
        if (deleted && ledger != null) {
            // Files this plugin uploaded go with it, then the ledger itself.
            var removed = 0
            for (u in ledger.uploads) if (uploadNameRx.matches(u) && !u.contains("..") && File(uploadDir, u).delete()) removed++
            traceStore.clear(name)
            out.put("uploadsRemoved", removed).put("effects", JSONArray(ledger.effects))
        }
        if (plan != null && deleted) {
            val script = eraseScript(plan.first, name)
            auditShell(ip, script, "plugin-erase")
            val r = RootShell.run(ctx, script, 30_000)
            val bad = JSONArray()
            for ((p, why) in plan.second) bad.put(JSONObject().put("path", p).put("reason", why))
            out.put("erase", JSONObject().put("success", r.success && !r.content.contains("FAILED ") && !r.content.contains("SKIPPED ")).put("log", r.content.take(2000)).put("rejected", bad))
        }
        json(Response.Status.OK, out)
    }
    uri == "/api/plugins/toggle" && s.method == Method.POST -> rootGate(s) ?: run {   // fresh sign-in: a plugin holding a session cannot switch other plugins on or off after 4 h
        val req = body(s); val name = req.optString("name")
        if (!nameRx.matches(name) || name.contains("..")) throw IllegalArgumentException("invalid plugin name")
        Prefs.setEnabled(ctx, name, req.optBoolean("enabled", true))
        json(Response.Status.OK, JSONObject().put("ok", true))
    }
    // Approve the plugin file as it is now: stores its SHA-256 and capability list. For a plugin shown as "changed" (after you reviewed it)
    // or "not tracked" (installed before records existed). Needs the gate and the password.
    uri == "/api/plugins/approve" && s.method == Method.POST -> rootGate(s) ?: run {
        val req = body(s)
        val name = req.optString("name")
        if (!nameRx.matches(name) || name.contains("..")) throw IllegalArgumentException("invalid plugin name")
        val f = File(pluginDir, name)
        if (!f.isFile) throw IllegalArgumentException("no such plugin")
        pluginPasswordCheck(s, req, "approve this plugin")?.let { return@run it }
        val bytes = f.readBytes()
        val src = String(bytes, Charsets.UTF_8)
        val sandboxed = Prefs.pluginModes(ctx)[name] == "sandbox" && pluginKind(name) == "js"
        Prefs.setPluginRecord(ctx, name, PluginRecord(sha256Hex(bytes), effectiveCaps(src, scanPlugin(src, Prefs.netHosts(ctx)).hosts, sandboxed) { shellDanger(it, true) }))
        auditShell(s.remoteIpAddress ?: "?", "approve " + name, "plugin-approve")
        json(Response.Status.OK, JSONObject().put("ok", true))
    }
    // Switch a plugin between "sandbox" and "trusted": {"name":"My_Plugin.js","mode":"sandbox","password":"..."} (Phase 4). Both directions need the gate and the
    // password: sandbox approves the permissions the file declares (@matchi-needs) as it is now; trusted gives it the whole page again. Either way the
    // file is approved as it is now (SHA-256 and capability list), like /api/plugins/approve, and the page reloads to apply it. Only .js plugins.
    uri == "/api/plugins/mode" && s.method == Method.POST -> rootGate(s) ?: run {
        val req = body(s)
        val name = req.optString("name")
        if (!nameRx.matches(name) || name.contains("..")) throw IllegalArgumentException("invalid plugin name")
        val mode = req.optString("mode")
        if (mode != "sandbox" && mode != "trusted") throw IllegalArgumentException("mode must be sandbox or trusted")
        val f = File(pluginDir, name)
        if (!f.isFile) throw IllegalArgumentException("no such plugin")
        if (pluginKind(name) != "js") throw IllegalArgumentException("only .js plugins can run sandboxed; UFI-TOOLS .html blocks need the page")
        val sandboxed = mode == "sandbox"
        pluginPasswordCheck(s, req, if (sandboxed) "run this plugin in the sandbox" else "make this plugin trusted")?.let { return@run it }
        val bytes = f.readBytes()
        val src = String(bytes, Charsets.UTF_8)
        Prefs.setPluginSandboxed(ctx, name, sandboxed)
        Prefs.setPluginRecord(ctx, name, PluginRecord(sha256Hex(bytes), effectiveCaps(src, scanPlugin(src, Prefs.netHosts(ctx)).hosts, sandboxed) { shellDanger(it, true) }))
        auditShell(s.remoteIpAddress ?: "?", "mode " + name + " " + mode, "plugin-mode")
        json(Response.Status.OK, JSONObject().put("ok", true).put("mode", mode))
    }
    // A call a SANDBOXED plugin made through the page's bridge (Phase 5): {"name":"X.js","op":"at"|"router.get"|"shell","args":["..."]}. The host decides, on every
    // call, from the stored record: the plugin must run sandboxed, its file must still be the approved one, and the call must be inside what it declared and
    // you approved (sandboxCallError). The page only relays; its own check is a first line. Reply shapes match /api/at, the router get and /api/shell.
    // Limit: the host cannot tell WHICH page code relays, so a trusted plugin (already root) could name a sandboxed one and get that plugin's narrow list.
    // at and router.get are read-only and need only the session; shell needs the root gate like /api/shell.
    uri == "/api/plugins/call" && s.method == Method.POST -> run {
        val req = body(s)
        val name = req.optString("name")
        if (!nameRx.matches(name) || name.contains("..")) throw IllegalArgumentException("invalid plugin name")
        val op = req.optString("op")
        val arr = req.optJSONArray("args") ?: JSONArray()
        if (arr.length() > SBX_MAX_ROUTER) throw IllegalArgumentException("too many arguments")
        val args = ArrayList<String>()
        for (i in 0 until arr.length()) args.add(arr.opt(i) as? String ?: throw IllegalArgumentException("arguments must be strings"))
        val f = File(pluginDir, name)
        if (!f.isFile || pluginKind(name) != "js" || Prefs.pluginModes(ctx)[name] != "sandbox")
            return@run json(Response.Status.FORBIDDEN, JSONObject().put("code", "not-sandboxed").put("error", "This plugin does not run in the sandbox"))
        val record = Prefs.pluginRecords(ctx)[name]
        val grant = sandboxGrant(record?.caps, integrityState(record?.sha, sha256Hex(f.readBytes())))
        sandboxCallError(grant, op, args)?.let { why ->
            LogCatcher.log("WARNING", "plugin/sandbox", "[$name] call refused by the host: $op ($why)")
            return@run json(Response.Status.FORBIDDEN, JSONObject().put("code", "not-approved").put("error", why))
        }
        val ip = s.remoteIpAddress ?: "?"
        when (op) {
            "at" -> {
                auditBusy(ip, "plugin-at")
                val q = "'" + args[0].trim().replace("'", "'\\''") + "'"
                val r = RootShell.run(ctx, File(ctx.filesDir, "sendat").absolutePath + " -n 0 -c $q", 15000)
                json(Response.Status.OK, JSONObject().put("success", r.success).put("result", r.content.trim()))
            }
            "router.get" -> {
                val fields = args.map { it.trim() }
                val p = LinkedHashMap<String, String>()
                p["cmd"] = fields.joinToString(",")
                if (fields.size > 1) p["multi_data"] = "1"
                harden(newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", ZteClient.call(ctx, "get", p)))
            }
            else -> {   // "shell": a root command, so the gate first; the filter still runs (it is an accident guard, the approved exact text is the control)
                rootGate(s)?.let { return@run it }
                val command = args[0]
                shellDanger(command, true)?.let { why ->
                    auditShell(ip, "BLOCKED: $why", "shell-blocked")
                    return@run json(Response.Status.FORBIDDEN, JSONObject().put("code", "blocked").put("error", "Blocked by MatchiTOOL security: this command $why"))
                }
                auditShell(ip, command, "plugin-shell")
                try {
                    traceStore.recordCommand(name, command)
                } catch (e: Exception) { Quiet.note("WebRoutesPlugins.pluginCall", e) }
                val r = RootShell.run(ctx, tagCommand(name, command), 20_000)
                json(Response.Status.OK, JSONObject().put("success", r.success).put("content", r.content))
            }
        }
    }
    // Scan an installed plugin again: {"name":"My_Plugin.js"} -> risk, findings and the hosts its source mentions.
    uri == "/api/plugins/scan" && s.method == Method.POST -> {
        val name = body(s).optString("name")
        if (!nameRx.matches(name) || name.contains("..")) throw IllegalArgumentException("invalid plugin name")
        val f = File(pluginDir, name)
        if (!f.isFile) throw IllegalArgumentException("no such plugin")
        val r = scanPlugin(f.readText(), Prefs.netHosts(ctx))
        val arr = JSONArray()
        for (x in r.findings) arr.put(JSONObject().put("level", x.level).put("code", x.code).put("message", x.message))
        json(Response.Status.OK, JSONObject().put("risk", r.risk).put("findings", arr).put("hosts", JSONArray(r.hosts)))
    }
    else -> null
}

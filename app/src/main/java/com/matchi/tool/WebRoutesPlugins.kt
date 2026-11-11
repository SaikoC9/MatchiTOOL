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

/** Paths to erase for a plugin: (allowed, rejected with reason). The plugin's own data folder is always included. */
internal fun WebServer.pluginDataPlan(name: String): Pair<List<String>, List<Pair<String, String>>> {
    val f = File(pluginDir, name)
    val code = if (f.isFile) try { f.readText() } catch (_: Exception) { "" } else ""
    val ok = ArrayList<String>()
    val bad = ArrayList<Pair<String, String>>()
    ok.add(pluginDataDir(name))
    // Folders named after the plugin are erased too, without a header line. They pass the same strict check and are listed in the dialog (only when they exist).
    for (d in implicitPluginPaths(name)) if (checkPluginDataPath(d, name) == null && d !in ok) ok.add(d)
    for (d in pluginDataDeclarations(code)) {
        val why = checkPluginDataPath(d, name)
        if (why == null) { if (d !in ok) ok.add(d) } else bad.add(d to why)
    }
    // Paths its root commands wrote to while it ran (the ledger). Same strict check; a path inside another listed path is dropped.
    for (d in traceStore.read(name).paths) if (checkPluginDataPath(d, name) == null && d !in ok) ok.add(d)
    // Loose files named after the plugin (NAME.txt, NAME.js, NAME.html, NAME.log ...), added last so the cap below never drops a traced path for them.
    for (d in implicitPluginFiles(name)) if (checkPluginDataPath(d, name) == null && d !in ok) ok.add(d)
    val pruned = ok.filter { p -> ok.none { q -> q != p && p.startsWith("$q/") } }.take(100)
    return pruned to bad
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
// one upload at a time (both upload routes share the slot) and enough free space for the announced size plus a reserve.
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
 * Multipart upload (field "file") for plugins: {"ok":true,"name":"x.tar.gz","url":"/uploads/x.tar.gz","path":"..."}.
 * The name is sanitised to [A-Za-z0-9._-]; an existing file of the same name is replaced.
 */
internal fun WebServer.uploadFile(s: IHTTPSession, viaUfiRoute: Boolean = false): Response {
    val len = s.headers["content-length"]?.toLongOrNull() ?: -1L
    if (len < 0 || len > MAX_UPLOAD_BYTES + 1_000_000L)
        throw IllegalArgumentException("Upload must be at most ${MAX_UPLOAD_BYTES / 1024 / 1024} MB")
    auditShell(s.remoteIpAddress ?: "?", "len=$len", "upload")
    return withUploadSlot(len) { uploadFileLocked(s, viaUfiRoute) }
}

internal fun WebServer.uploadFileLocked(s: IHTTPSession, viaUfiRoute: Boolean): Response {
    val files = HashMap<String, String>()
    s.parseBody(files)
    val tmp = files["file"]?.let { File(it) } ?: throw IllegalArgumentException("No file received (multipart field \"file\")")
    try {
        val original = s.parameters["file"]?.firstOrNull().orEmpty()
        var name = original.substringAfterLast('/').substringAfterLast('\\').replace(Regex("[^A-Za-z0-9._-]"), "_").take(120)
        if (name.isBlank() || name.all { it == '.' || it == '_' }) name = "upload_" + System.currentTimeMillis()
        if (name.startsWith(".")) name = "_$name"
        if (!uploadNameRx.matches(name) || name.contains("..")) throw IllegalArgumentException("invalid file name")
        val dest = File(uploadDir, name)
        val used = uploadDir.listFiles()?.filter { it.isFile && it.name != name }?.sumOf { it.length() } ?: 0L
        if (used + tmp.length() > MAX_UPLOAD_TOTAL_BYTES)
            throw IllegalArgumentException("Upload folder is full; delete old uploads first")
        if (!tmp.renameTo(dest)) { tmp.copyTo(dest, overwrite = true) }
        dest.setReadable(true, false)
        tracePluginName(s.headers["x-matchi-plugin"])?.let { traceStore.record(it, emptyList(), emptyList(), listOf(name)) }
        // UFI's /upload_img replies "/uploads/NAME" and its plugins cut that prefix off to get the file name; /api/upload keeps "/api/uploads/NAME".
        val url = (if (viaUfiRoute) "/uploads/" else "/api/uploads/") + name
        return json(Response.Status.OK, JSONObject().put("ok", true).put("name", name)
            .put("url", url).put("path", dest.absolutePath).put("size", dest.length()))
    } finally {
        try { if (tmp.exists()) tmp.delete() } catch (e: Exception) { Quiet.note("WebServer.uploadFileLocked", e) }
    }
}

/** Streams a previously uploaded (or root-copied) file from the uploads folder. */
internal fun WebServer.serveUpload(name: String): Response {
    if (!uploadNameRx.matches(name) || name.contains(".."))
        throw IllegalArgumentException("invalid file name")
    val f = File(uploadDir, name)
    if (!f.isFile) return json(Response.Status.NOT_FOUND, JSONObject().put("error", "file not found"))
    val r = newFixedLengthResponse(Response.Status.OK, "application/octet-stream", java.io.FileInputStream(f), f.length())
    r.addHeader("Content-Disposition", "attachment; filename=\"$name\"")
    return harden(r)
}

internal fun WebServer.deleteUpload(name: String): Response {
    if (!uploadNameRx.matches(name) || name.contains(".."))
        throw IllegalArgumentException("invalid file name")
    return json(Response.Status.OK, JSONObject().put("ok", File(uploadDir, name).delete()))
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
    val ip = s.remoteIpAddress ?: "?"
    val loop = isLoopbackIp(ip)
    val wait = guard.retryAfterMs(ip, loop)
    if (wait > 0) {
        val secs = (wait + 999) / 1000
        return json(tooMany, JSONObject().put("error", "too many bad attempts, wait $secs s")).also { it.addHeader("Retry-After", secs.toString()) }
    }
    if (!Prefs.checkAdminPassword(ctx, pw)) {
        guard.failed(ip, loop)
        throw IllegalArgumentException("Password is wrong")
    }
    return null
}

internal fun WebServer.routePlugins(s: IHTTPSession, uri: String): Response? = when {
    (uri == "/api/upload" || uri == "/api/upload_img") && s.method == Method.POST -> uploadFile(s, uri == "/api/upload_img")
    uri == "/api/uploads/delete" && s.method == Method.POST -> deleteUpload(body(s).optString("name"))
    uri.startsWith("/api/uploads/") && s.method == Method.GET -> serveUpload(uri.removePrefix("/api/uploads/"))
    uri == "/api/plugins" && s.method == Method.GET -> {
        val off = Prefs.disabled(ctx)
        val arr = JSONArray()
        val all = pluginDir.listFiles { f -> f.isFile && (f.name.endsWith(".js") || f.name.endsWith(".html")) }
            ?.associateBy { it.name }.orEmpty()
        val titles = Prefs.pluginTitles(ctx)
        val netExtra = Prefs.netHosts(ctx)
        val records = Prefs.pluginRecords(ctx)
        for (n in orderPlugins(all.keys, Prefs.pluginOrder(ctx))) {
            val f = all.getValue(n)
            val bytes = f.readBytes()
            val src = String(bytes, Charsets.UTF_8)
            val sc = scanPlugin(src, netExtra)
            val sha = sha256Hex(bytes)
            arr.put(JSONObject().put("name", n).put("code", src).put("enabled", n !in off)
                .put("kind", pluginKind(n)).put("title", titles[n] ?: pluginBaseName(n))
                .put("risk", sc.risk).put("sha256", sha)
                .put("integrity", integrityState(records[n]?.sha, sha))   // ok | changed | untracked
                .put("caps", JSONArray(pluginCaps(src, sc.hosts))))
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
        val caps = pluginCaps(code, scan.hosts)
        if (oldBytes != null) {
            val oldSrc = String(oldBytes, Charsets.UTF_8)
            val before = record?.caps ?: pluginCaps(oldSrc, scanPlugin(oldSrc, Prefs.netHosts(ctx)).hosts)
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
    uri == "/api/plugins/data" && s.method == Method.POST -> {
        val name = body(s).optString("name")
        if (!nameRx.matches(name) || name.contains("..")) throw IllegalArgumentException("invalid plugin name")
        val (paths, rejected) = pluginDataPlan(name)
        val probe = RootShell.run(ctx, probeScript(paths), 15_000)
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
            .put("uploads", ups).put("effects", JSONArray(led.effects)))
    }
    // Delete a plugin: {"name":"My_Plugin.js","erase":true}. With erase, the data from /api/plugins/data is removed too.
    uri == "/api/plugins/delete" && s.method == Method.POST -> run {
        val req = body(s)
        // Erasing plugin data runs a root script; a plain delete of the plugin file does not.
        if (req.optBoolean("erase", false)) rootGate(s)?.let { return@run it }
        // Deleting needs the password too: delete, then install under the same name, would otherwise skip the check on replacing.
        pluginPasswordCheck(s, req, "delete a plugin")?.let { return@run it }
        val name = req.optString("name")
        if (!nameRx.matches(name) || name.contains("..")) throw IllegalArgumentException("invalid plugin name")
        val plan = if (req.optBoolean("erase", false)) pluginDataPlan(name) else null // read the source BEFORE it is deleted
        val ledger = if (plan != null) traceStore.read(name) else null
        val deleted = File(pluginDir, name).delete()
        Prefs.setEnabled(ctx, name, true)
        if (deleted) Prefs.forgetPlugin(ctx, name)
        val out = JSONObject().put("ok", deleted)
        if (deleted && ledger != null) {
            // Files this plugin uploaded go with it, then the ledger itself.
            var removed = 0
            for (u in ledger.uploads) if (uploadNameRx.matches(u) && !u.contains("..") && File(uploadDir, u).delete()) removed++
            traceStore.clear(name)
            out.put("uploadsRemoved", removed).put("effects", JSONArray(ledger.effects))
        }
        if (plan != null && deleted) {
            val script = eraseScript(plan.first, name)
            auditShell(s.remoteIpAddress ?: "?", script, "plugin-erase")
            val r = RootShell.run(ctx, script, 30_000)
            val bad = JSONArray()
            for ((p, why) in plan.second) bad.put(JSONObject().put("path", p).put("reason", why))
            out.put("erase", JSONObject().put("success", r.success && !r.content.contains("FAILED ") && !r.content.contains("SKIPPED ")).put("log", r.content.take(2000)).put("rejected", bad))
        }
        json(Response.Status.OK, out)
    }
    uri == "/api/plugins/toggle" && s.method == Method.POST -> {
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
        Prefs.setPluginRecord(ctx, name, PluginRecord(sha256Hex(bytes), pluginCaps(src, scanPlugin(src, Prefs.netHosts(ctx)).hosts)))
        auditShell(s.remoteIpAddress ?: "?", "approve " + name, "plugin-approve")
        json(Response.Status.OK, JSONObject().put("ok", true))
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

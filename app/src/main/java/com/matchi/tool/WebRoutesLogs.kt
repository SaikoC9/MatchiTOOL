package com.matchi.tool

import android.util.Log
import fi.iki.elonen.NanoHTTPD.IHTTPSession
import fi.iki.elonen.NanoHTTPD.Method
import fi.iki.elonen.NanoHTTPD.Response
import fi.iki.elonen.NanoHTTPD.newChunkedResponse
import fi.iki.elonen.NanoHTTPD.newFixedLengthResponse
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

// Log Catcher routes: live entries, streams, search, export, device and boot capture, session files, the log basket.
// Split out of WebServer.kt (route groups are extension functions; helpers moved with them). Each route function
// returns null when the path is not one of its own, so WebServer.route() can ask the next group.

/** Read-only diagnostics: no modem settings or partitions are modified. */
/** Per-source counters of the in-app capture for /api/logs/status (see SourceCounters). */
internal fun WebServer.countersJson(): JSONObject {
    val o = JSONObject()
    SourceStats.all().forEach { (name, c) ->
        o.put(name, JSONObject().put("seen", c.seen).put("passed", c.passed).put("collapsed", c.collapsed)
            .put("dropped", c.dropped).put("gaps", c.gaps))
    }
    return o.put("queueDropped", SourceStats.queueDropped.get()).put("swallowedErrors", Quiet.total())
}

/** Last [maxBytes] of a file as text, and whether the start was cut (the first partial line is dropped then). */
internal fun WebServer.readTail(file: File, maxBytes: Long): Pair<String, Boolean> {
    val len = file.length()
    val start = (len - maxBytes).coerceAtLeast(0L)
    java.io.RandomAccessFile(file, "r").use { raf ->
        raf.seek(start)
        val buf = ByteArray((len - start).toInt())
        raf.readFully(buf)
        var text = String(buf, Charsets.UTF_8)
        if (start > 0) text = text.substringAfter('\n', "")
        return text to (start > 0)
    }
}

internal fun WebServer.routeLogs(s: IHTTPSession, uri: String): Response? = when {
    uri == "/api/logs/status" && s.method == Method.GET -> json(Response.Status.OK, JSONObject()
        .put("running", LogCatcher.isRunning()).put("session", LogCatcher.currentSession() ?: JSONObject.NULL)
        .put("droppedWrites", LogCatcher.droppedWriteCount()).put("counters", countersJson()))
    uri == "/api/logs/start" && s.method == Method.POST -> {
        LogCatcher.start(ctx)
        json(Response.Status.OK, JSONObject().put("ok", LogCatcher.isRunning()).put("running", LogCatcher.isRunning()).put("session", LogCatcher.currentSession() ?: JSONObject.NULL))
    }
    // JavaScript errors from the web page go into the app log (the page sends at most 20 per load, text is clipped here too).
    uri == "/api/logs/clienterror" && s.method == Method.POST -> {
        val req = body(s, 8 * 1024)
        val plugin = PluginLog.pluginFromSource(req.optString("src"))
        LogCatcher.log("ERROR", if (plugin != null) "plugin/js" else "WebPage", (if (plugin != null) "[$plugin] " else "") + "JS error: " + req.optString("msg").take(500) +
            (req.optString("src").takeIf { it.isNotBlank() }?.let { " @ " + it.take(200) } ?: "") +
            (if (req.has("line")) ":" + req.optInt("line") else ""))
        json(Response.Status.OK, JSONObject().put("ok", true))
    }
    uri == "/api/logs/stop" && s.method == Method.POST -> {
        LogCatcher.stop()
        json(Response.Status.OK, JSONObject().put("ok", true).put("running", false))
    }
    uri == "/api/logs/entries" && s.method == Method.GET -> {
        val rows = JSONArray()
        // ?since=<id> returns only newer entries, so a 3 s poll does not resend the whole 3000-entry buffer.
        // If the client's id is ahead of ours (app restarted, ids began again) it is told to start over.
        val all = LogCatcher.snapshot()
        val lastId = all.lastOrNull()?.id ?: 0L
        val askedSince = s.parameters["since"]?.firstOrNull()?.toLongOrNull() ?: 0L
        val reset = askedSince > lastId
        val since = if (reset) 0L else askedSince
        all.filter { it.id > since }.forEach { e -> rows.put(entryJson(e)) }
        json(Response.Status.OK, JSONObject().put("entries", rows).put("lastId", lastId).put("reset", reset)
            .put("droppedWrites", LogCatcher.droppedWriteCount()).put("running", LogCatcher.isRunning()))
    }
    uri == "/api/logs/stream" && s.method == Method.GET -> {
        val since = s.parameters["since"]?.firstOrNull()?.toLongOrNull() ?: 0L
        val live = LogStream.acquire(since)
        if (live == null) json(tooMany, JSONObject().put("error", "too many live log streams are open"))
        else harden(newChunkedResponse(Response.Status.OK, "text/event-stream; charset=utf-8", live)).also {
            it.addHeader("X-Accel-Buffering", "no")
            it.setGzipEncoding(false)   // gzip would hold the small event frames back until its buffer fills
        }
    }
    uri == "/api/logs/search" && s.method == Method.GET -> {
        fun p(n: String) = s.parameters[n]?.firstOrNull() ?: ""
        val found = LogSearch.run(ctx, p("q"), p("regex") == "1", p("level"), p("from"), p("until"), (p("limit").toIntOrNull() ?: 300).coerceIn(1, 1000))
        json(if (found.busy) tooMany else Response.Status.OK, found.toJson())
    }
    uri == "/api/logs/export" && s.method == Method.GET -> {
        val kind = s.parameters["kind"]?.firstOrNull()
        val bundle = kind == "bundle"
        val report = kind == "report" || bundle
        val redact = s.parameters["redact"]?.firstOrNull() != "0"
        val gate = if (report) rootGate(s) else null
        if (bundle && gate != null) gate   // the bundle reads root-only files: no silent downgrade to a plain export
        else {
            val zip = LogExport.build(ctx, report, report && gate == null, bundle, redact)
            if (zip == null) json(Response.Status.INTERNAL_ERROR, JSONObject().put("error", "Could not build the archive (another export is running, or storage is full)"))
            else harden(newFixedLengthResponse(Response.Status.OK, "application/zip", LogExport.DeleteOnClose(zip), zip.length())).also {
                it.addHeader("Content-Disposition", "attachment; filename=\"${zip.name}\"")
            }
        }
    }
    uri == "/api/logs/device" && s.method == Method.GET -> {
        val st = DeviceLogs.settings(ctx)
        json(Response.Status.OK, JSONObject().put("logcat", st.logcat).put("dmesg", st.dmesg).put("level", st.level).put("keepAll", st.keepAll).put("active", DeviceLogs.isActive()))
    }
    uri == "/api/logs/device" && s.method == Method.POST -> rootGate(s) ?: run {
        val req = body(s)
        auditShell(s.remoteIpAddress ?: "?", req.toString(), "logs-device")
        DeviceLogs.configure(ctx, req.optBoolean("logcat"), req.optBoolean("dmesg"), req.optString("level", "W"), if (req.has("keepAll")) req.optBoolean("keepAll") else null)
        val st = DeviceLogs.settings(ctx)
        json(Response.Status.OK, JSONObject().put("ok", true).put("logcat", st.logcat).put("dmesg", st.dmesg).put("level", st.level).put("keepAll", st.keepAll).put("active", DeviceLogs.isActive()))
    }
    // Boot-time capture (Magisk script): every call reads or changes root-owned files, so all need the root gate.
    uri == "/api/logs/boot/status" && s.method == Method.GET -> rootGate(s) ?: json(Response.Status.OK, BootLogd.status(ctx))
    uri == "/api/logs/boot/files" && s.method == Method.GET -> rootGate(s) ?: json(Response.Status.OK, BootLogd.files(ctx))
    uri == "/api/logs/boot/counters" && s.method == Method.GET -> rootGate(s) ?: json(Response.Status.OK, BootLogd.counters(ctx))
    uri == "/api/logs/boot/read" && s.method == Method.GET -> rootGate(s) ?: run {
        fun p(n: String) = s.parameters[n]?.firstOrNull() ?: ""
        val res = BootLogd.page(ctx, p("file"), p("start").toIntOrNull() ?: 1, p("limit").toIntOrNull() ?: 300, p("from").ifBlank { null })
        json(if (res.optBoolean("ok")) Response.Status.OK else Response.Status.BAD_REQUEST, res)
    }
    uri == "/api/logs/boot/install" && s.method == Method.POST -> rootGate(s) ?: run {
        val req = body(s)
        auditShell(s.remoteIpAddress ?: "?", req.toString(), "logs-boot-install")
        val cur = BootLogd.config(ctx)
        val cfg = BootLogdModel.Config(req.optInt("fileKb", cur.fileKb), req.optInt("files", cur.files), req.optInt("minFreeMb", cur.minFreeMb), req.optInt("retainDays", cur.retainDays))
        val res = BootLogd.install(ctx, cfg)
        json(if (res.optBoolean("ok")) Response.Status.OK else Response.Status.INTERNAL_ERROR, res)
    }
    uri == "/api/logs/boot/uninstall" && s.method == Method.POST -> rootGate(s) ?: run {
        val req = body(s)
        auditShell(s.remoteIpAddress ?: "?", req.toString(), "logs-boot-remove")
        val res = BootLogd.uninstall(ctx, req.optBoolean("purge", false))
        json(if (res.optBoolean("ok")) Response.Status.OK else Response.Status.INTERNAL_ERROR, res)
    }
    uri == "/api/logs/delete" && s.method == Method.POST -> {
        val ok = LogCatcher.deleteSession(ctx, body(s).optString("name", ""))
        json(if (ok) Response.Status.OK else Response.Status.BAD_REQUEST, JSONObject().put("ok", ok)
            .put("error", if (ok) JSONObject.NULL else "Session not found, or it is still logging"))
    }
    uri == "/api/logs/sessions" && s.method == Method.GET -> {
        val rows = JSONArray()
        LogCatcher.sessions(ctx).forEach { f -> rows.put(JSONObject().put("name", f.name).put("size", f.length()).put("modified", f.lastModified())) }
        json(Response.Status.OK, JSONObject().put("sessions", rows).put("bootEnabled", BootLogd.enabled(ctx)))
    }
    // Log basket (step 1): one list of every log file. Boot files are added only when capture is installed and the root gate passes.
    uri == "/api/logs/basket" && s.method == Method.GET -> {
        val rows = ArrayList<LogBasket.Row>()
        val activeName = LogCatcher.currentSession()?.let { "$it.log" }
        LogCatcher.sessions(ctx).forEach { f -> rows.add(LogBasket.Row(LogBasket.SESSION, f.name, f.length(), f.lastModified(), "", f.name == activeName)) }
        File(ctx.filesDir, "logs/exports").listFiles()?.filter { it.isFile && it.extension == "txt" }
            ?.forEach { f -> rows.add(LogBasket.Row(LogBasket.EXPORT, f.name, f.length(), f.lastModified())) }
        File(ctx.filesDir, "shell_audit.log").takeIf { it.isFile }
            ?.let { f -> rows.add(LogBasket.Row(LogBasket.AUDIT, f.name, f.length(), f.lastModified())) }
        val installed = BootLogd.enabled(ctx)
        val rootOk = installed && rootGate(s) == null
        if (rootOk) {
            try {
                val files = BootLogd.files(ctx).optJSONArray("files") ?: JSONArray()
                for (i in 0 until files.length()) {
                    val o = files.getJSONObject(i)
                    rows.add(LogBasket.Row(LogBasket.BOOT, o.optString("name"), o.optLong("size"), 0L, o.optString("modified"), false, true))
                }
            } catch (e: Exception) { Quiet.note("WebServer.logsBasket", e) }
        }
        val out = JSONArray()
        LogBasket.arrange(rows).forEach { r ->
            out.put(JSONObject().put("id", r.id).put("type", r.type).put("name", r.name).put("size", r.size)
                .put("modified", r.modified).put("modifiedText", r.modifiedText).put("active", r.active).put("rootOnly", r.rootOnly)
                .put("canView", r.canView).put("canCopy", r.canCopy).put("canDelete", r.canDelete))
        }
        json(Response.Status.OK, JSONObject().put("rows", out).put("running", LogCatcher.isRunning())
            .put("bootNote", LogBasket.bootNote(installed, rootOk)))
    }
    // Log basket (step 6): one redacted snapshot file (version, plugin problem counts, session tail) saved as an export row, so a before and an after run can be compared.
    uri == "/api/logs/snapshot" && s.method == Method.POST -> {
        if (!snapshotBusy.tryAcquire()) json(tooMany, JSONObject().put("error", "A snapshot is already being made")) else try {
        val label = body(s).optString("label", "").takeIf { it in LogSnapshot.LABELS } ?: ""
        val stamp = java.text.SimpleDateFormat("yyyyMMdd_HHmmss", java.util.Locale.US).format(java.util.Date())
        // Counts cover every kept part of the newest session (a session rotates into "_part" files at 8 MB), not just the 3000-line recent buffer,
        // so a before and an after snapshot taken at different times still compare like with like. Capped at 64 MB, oldest part dropped first.
        val all = LogCatcher.sessions(ctx)
        val base = all.firstOrNull()?.nameWithoutExtension?.substringBefore("_part")
        val parts = if (base == null) emptyList() else all.filter { it.nameWithoutExtension.substringBefore("_part") == base }.sortedBy { it.lastModified() }
        val use = ArrayList<File>(); var budget = 64L * 1024 * 1024
        for (f in parts.asReversed()) { if (budget - f.length() < 0 && use.isNotEmpty()) break; budget -= f.length(); use.add(0, f) }
        val counter = LogSnapshot.Counter(); val tail = java.util.ArrayDeque<String>()
        val fromFiles = try {
            for (f in use) f.useLines(Charsets.UTF_8) { seq -> for (l in seq) { counter.add(l); tail.addLast(l); if (tail.size > LogSnapshot.TAIL_LINES) tail.removeFirst() } }
            use.isNotEmpty()
        } catch (_: Exception) { false }
        val (counts, examined, tailLines, source) = if (fromFiles)
            Quad(counter.counts(), counter.examined, tail.toList(), "newest session, all kept parts (${use.size} file(s))" + (if (LogCatcher.isRunning()) ", still logging" else ""))
        else {
            val buf = if (LogCatcher.isRunning()) LogCatcher.snapshot().map { it.line() } else emptyList()
            Quad(LogSnapshot.count(buf), buf.size, buf, if (buf.isEmpty()) "no session available" else "running session (recent buffer only: no session file yet)")
        }
        @Suppress("DEPRECATION")
        val version = try { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: "" } catch (_: Exception) { "" }
        val red = Redactor()
        val text = red.text(LogSnapshot.render(version, stamp, label, source, counts, examined, tailLines)) + "\nPrivate data hidden by the snapshot: " + red.summary() + "\n"
        val dir = File(ctx.filesDir, "logs/exports").apply { mkdirs() }
        val file = File(dir, LogSnapshot.fileName(label, stamp))
        file.writeText(text)
        json(Response.Status.OK, JSONObject().put("ok", true).put("id", LogBasket.EXPORT + ":" + file.name).put("name", file.name).put("lines", examined).put("source", source))
        } finally { snapshotBusy.release() }
    }
    // Log basket (step 2): the last lines of one session, export or audit file. Boot files keep their own root route.
    uri == "/api/logs/basket/read" && s.method == Method.GET -> {
        val parsed = LogBasket.parseId(s.parameters["id"]?.firstOrNull() ?: "") ?: throw IllegalArgumentException("bad log id")
        val full = s.parameters["full"]?.firstOrNull() == "1"
        val tail = if (full) LogBasket.TAIL_MAX else LogBasket.clampTail(s.parameters["tail"]?.firstOrNull()?.toIntOrNull() ?: LogBasket.TAIL_DEFAULT)
        val file: File? = when (parsed.first) {
            LogBasket.SESSION -> LogCatcher.sessions(ctx).firstOrNull { it.name == parsed.second }
            LogBasket.EXPORT -> File(ctx.filesDir, "logs/exports/" + parsed.second).takeIf { it.isFile && it.extension == "txt" }
            LogBasket.AUDIT -> File(ctx.filesDir, "shell_audit.log").takeIf { it.isFile && parsed.second == "shell_audit.log" }
            else -> throw IllegalArgumentException("boot files are read with /api/logs/boot/read")
        }
        if (file == null) json(Response.Status.NOT_FOUND, JSONObject().put("error", "Log not found"))
        else {
            val (text, cut) = readTail(file, 2L * 1024 * 1024)
            val lines = LogBasket.tailLines(text, tail)
            json(Response.Status.OK, JSONObject().put("id", s.parameters["id"]?.firstOrNull()).put("size", file.length())
                .put("lines", JSONArray(lines)).put("shown", lines.size)
                .put("truncated", cut || lines.size >= tail))
        }
    }
    // Log basket: delete finished sessions, exports, the audit log and rotated boot files. Audit and boot rows need the root gate; clearing the audit log leaves a new line saying so. The active session and the live boot files are refused per row.
    uri == "/api/logs/basket/delete" && s.method == Method.POST -> {
        val ids = body(s).optJSONArray("ids") ?: JSONArray()
        if (ids.length() > 100) throw IllegalArgumentException("at most 100 rows at once")
        val results = JSONArray()
        for (i in 0 until ids.length()) {
            val id = ids.optString(i, "")
            val p = LogBasket.parseId(id)
            var reason = ""
            val ok = if (p == null) false else when (p.first) {
                LogBasket.SESSION -> LogCatcher.deleteSession(ctx, p.second)
                LogBasket.EXPORT -> File(ctx.filesDir, "logs/exports/" + p.second).let { it.isFile && it.extension == "txt" && it.delete() }
                LogBasket.AUDIT -> if (p.second != "shell_audit.log") false
                    else if (rootGate(s) != null) { reason = "root sign-in needed"; false }
                    else synchronized(auditLock) { File(ctx.filesDir, "shell_audit.log").let { it.isFile && it.delete() } }
                        .also { done -> if (done) auditShell(s.remoteIpAddress ?: "?", "audit log cleared from the log basket", "audit-cleared") }
                LogBasket.BOOT -> if (!LogBasket.bootDeletable(p.second)) { reason = "only rotated capture files can be deleted"; false }
                    else if (rootGate(s) != null) { reason = "root sign-in needed"; false }
                    else BootLogd.deleteFile(ctx, p.second).also { auditShell(s.remoteIpAddress ?: "?", "boot file " + p.second, "logs-boot-delete") }
                else -> false
            }
            results.put(JSONObject().put("id", id).put("ok", ok).put("reason", reason))
        }
        json(Response.Status.OK, JSONObject().put("results", results))
    }
    uri.startsWith("/api/logs/session/") && s.method == Method.GET -> {
        val name = uri.removePrefix("/api/logs/session/")
        val file = LogCatcher.sessions(ctx).firstOrNull { it.name == name }
        if (file == null) json(Response.Status.NOT_FOUND, JSONObject().put("error", "Session not found"))
        else json(Response.Status.OK, JSONObject().put("name", file.name).put("lines", JSONArray(LogCatcher.readSession(file))))
    }
    else -> null
}

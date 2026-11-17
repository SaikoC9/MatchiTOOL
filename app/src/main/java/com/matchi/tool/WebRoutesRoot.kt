package com.matchi.tool

import fi.iki.elonen.NanoHTTPD.IHTTPSession
import fi.iki.elonen.NanoHTTPD.Method
import fi.iki.elonen.NanoHTTPD.Response
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

// Everything that runs as root (or as the app user) for the page and for UFI-TOOLS plugins: shell routes, IMEI, AT commands.
// Split out of WebServer.kt (route groups are extension functions; helpers moved with them). Each route function
// returns null when the path is not one of its own, so WebServer.route() can ask the next group.

internal fun WebServer.routeRoot(s: IHTTPSession, uri: String): Response? = when {
    uri == "/api/root/status" && s.method == Method.GET -> {
        // ?retry=1 = explicit re-check (root just granted): forget the cool-down after a refusal. Plain polls keep it.
        if (s.parameters["retry"]?.firstOrNull() == "1") RootShell.resetDenial()
        val status = RootShell.status(ctx)
        json(Response.Status.OK, JSONObject()
            .put("granted", status.granted)
            .put("uid", status.uid)
            .put("suPath", status.suPath)
            .put("manager", status.managerHint)
            .put("detail", status.detail))
    }
    uri == "/api/shell" && s.method == Method.POST -> rootGate(s) ?: run {
        val req = body(s)
        val command = req.optString("cmd")
        if (command.isBlank() || command.length > 128_000 || command.contains('\u0000'))
            throw IllegalArgumentException("command must be 1 to 128 KB and contain no NUL bytes")
        val t = req.optLong("timeout", 20000).coerceIn(1000, 120000)
        commandBlocked(s, command)?.let { return@run it }
        // The SMS tool's background inbox check (a fixed read-only listing, see RootGate.isSmsListRead) is logged at most once a minute.
        // The Live panel's CPU loop (a fixed read-only command, see RootGate.CPU_LIVE_CMD) is logged at most once a minute too.
        if (RootGate.isSmsListRead(command)) auditBusy(s.remoteIpAddress ?: "?", "sms-list")
        else if (RootGate.isCpuLiveRead(command)) auditBusy(s.remoteIpAddress ?: "?", "cpu-live")
        else auditShell(s.remoteIpAddress ?: "?", command)
        traceCommand(s, command)
        val r = RootShell.run(ctx, tagged(s, command), t)
        json(Response.Status.OK, JSONObject().put("success", r.success).put("content", r.content))
    }
    // UFI-TOOLS aliases (shapes read from UFI's own server source, advancedToolsModule.kt). root_shell: request {"command","timeout"},
    // reply {"result":"<text>"} or HTTP 500 {"error":"..."}; UFI's timeout cap is 100 s (kept). The default is 30 s, not UFI's 100 s: above 30 s a call counts as a long job and shares only 3 slots with the boot script and the IMEI keeper. Same gate and limits as /api/shell. UFI's kano-t / kano-sign / authorization headers are never read, so they are ignored.
    uri == "/api/root_shell" && s.method == Method.POST -> rootGate(s) ?: run {
        val req = body(s)
        val command = req.optString("command")
        if (command.isBlank() || command.length > 128_000 || command.contains('\u0000'))
            throw IllegalArgumentException("command must be 1 to 128 KB and contain no NUL bytes")
        val t = req.optLong("timeout", 30000).coerceIn(1000, 100000)
        commandBlocked(s, command)?.let { return@run it }
        auditShell(s.remoteIpAddress ?: "?", command, "root_shell")
        traceCommand(s, command)
        val r = RootShell.run(ctx, tagged(s, command), t)
        ufiShellReply(if (r.success) r.content else null, if (r.success) null else r.content.ifBlank { "command failed" })
    }
    // UFI's one_click_shell is a GET with no body: it drives the phone screen over adb to switch on UFI's own root shell. It is
    // not a command runner. MatchiTOOL already runs commands as root, so there is nothing to switch on: the reply says whether
    // root is available. (Before this it was wrongly treated as a second root_shell.)
    uri == "/api/one_click_shell" && s.method == Method.GET -> run {
        if (RootShell.status(ctx).granted) ufiShellReply("Root shell is already available (MatchiTOOL runs commands as root)", null)
        else ufiShellReply(null, "Root access has not been granted to MatchiTOOL")
    }
    uri == "/api/user_shell" && s.method == Method.POST -> rootGate(s) ?: run {
        val req = body(s)
        val command = req.optString("command")
        if (command.isBlank() || command.length > 128_000 || command.contains('\u0000'))
            throw IllegalArgumentException("command must be 1 to 128 KB and contain no NUL bytes")
        commandBlocked(s, command)?.let { return@run it }
        auditShell(s.remoteIpAddress ?: "?", command, "user_shell")
        traceCommand(s, command)
        val r = UserShell.run(ctx.filesDir, tagged(s, command), 20000)
        // UFI's reply: {"result":{"done":true,"content":"<stdout>"}}; any stderr output makes UFI answer an error instead.
        ufiShellReply(if (r.success) JSONObject().put("done", true).put("content", r.content) else null, if (r.success) null else r.content.ifBlank { "command failed" })
    }
    // Re-write the saved IMEI now (the same keeper that runs at boot): {"force":true}
    uri == "/api/imei/apply" && s.method == Method.POST -> rootGate(s) ?: run {
        val req = body(s)
        auditShell(s.remoteIpAddress ?: "?", "imei-apply force=" + req.optBoolean("force", true), "imei-apply")
        json(Response.Status.OK, JSONObject().put("result", ImeiGuard.apply(ctx, 0, req.optBoolean("force", true))))
    }
    // Run an AT command on the modem as root: {"command":"AT+CSQ","slot":0}
    uri == "/api/at" && s.method == Method.POST -> run {
        val req = body(s)
        val cmd = req.optString("command").trim()
        val slot = req.optInt("slot", 0).coerceIn(0, 1)
        if (!cmd.startsWith("AT", ignoreCase = true) || cmd.length > 300 || cmd.any { it == '\n' || it == '\r' || it == '\u0000' })
            throw IllegalArgumentException("AT command must start with AT")
        // Read-only queries (polled by Live Status / AT Radio) skip the gate; every other AT command can change the modem.
        val readOnly = RootGate.isReadOnlyAt(cmd)
        if (!readOnly) rootGate(s)?.let { return@run it }
        // Reads are polled constantly (one line per minute is enough). A WRITE (AT+CFUN, IMEI, NV) gets its own line: with auditBusy it would
        // almost always share the minute that a poll had already used and leave no trace. The line holds only a short hash and the length.
        if (readOnly) auditBusy(s.remoteIpAddress ?: "?", "at") else auditShell(s.remoteIpAddress ?: "?", cmd, "at-write")
        val q = "'" + cmd.replace("'", "'\\''") + "'"
        val r = RootShell.run(ctx, File(ctx.filesDir, "sendat").absolutePath + " -n $slot -c $q", 15000)
        json(Response.Status.OK, JSONObject().put("success", r.success).put("result", r.content.trim()))
    }
    // UFI-TOOLS route GET /api/AT?command=AT+CSQ&slot=0 (UFI's own tools and plugins call it). Reply shape taken from UFI's
    // server source (atModule.kt): {"result":"<modem text>"} on success, HTTP 500 {"error":"<text>"} on failure. The text is
    // normalised the way UFI does it (AtBatch.ufiText). No "success" field: UFI's reply has none. Difference kept on purpose:
    // a slot other than 0 or 1 is refused with 400 (UFI silently passes any number on). Same gate as /api/at: pure read
    // commands skip the sign-in age check, everything else (NV writes, AT+CFUN, AT^...) needs it. Writes are audited.
    uri == "/api/AT" && s.method == Method.GET -> run {
        val cmd = AtBatch.checkCommand(s.parameters["command"]?.firstOrNull())
        val slot = AtBatch.checkSlot(s.parameters["slot"]?.firstOrNull())
        val readOnly = RootGate.isReadOnlyAt(cmd)
        if (!readOnly) rootGate(s)?.let { return@run it }
        if (readOnly) auditBusy(s.remoteIpAddress ?: "?", "at-ufi") else auditShell(s.remoteIpAddress ?: "?", cmd, "at-ufi-write")
        val q = "'" + cmd.replace("'", "'\\''") + "'"
        val r = RootShell.run(ctx, File(ctx.filesDir, "sendat").absolutePath + " -n $slot -c $q", 15000)
        val text = r.content.trim()
        if (r.success) json(Response.Status.OK, JSONObject().put("result", AtBatch.ufiText(text)))
        else json(Response.Status.INTERNAL_ERROR, JSONObject().put("error", "AT command failed: " + text.ifBlank { "no output" }))
    }
    // Several AT commands in ONE root call: {"commands":["AT+CSQ","AT+COPS?"],"slot":0} -> {"results":["...","..."]}
    uri == "/api/at/batch" && s.method == Method.POST -> run {
        val req = body(s)
        val slot = req.optInt("slot", 0).coerceIn(0, 1)
        val arr = req.optJSONArray("commands") ?: throw IllegalArgumentException("commands must be an array")
        if (arr.length() < 1 || arr.length() > 12) throw IllegalArgumentException("1 to 12 commands")
        val sendat = File(ctx.filesDir, "sendat").absolutePath
        val cmds = ArrayList<String>(arr.length())
        for (i in 0 until arr.length()) {
            val cmd = arr.optString(i).trim()
            if (!cmd.startsWith("AT", ignoreCase = true) || cmd.length > 300 || cmd.any { it == '\n' || it == '\r' || it == '\u0000' })
                throw IllegalArgumentException("AT command must start with AT")
            cmds.add(cmd)
        }
        // Same rule as /api/at: only a batch of pure read commands may skip the fresh-sign-in / HTTP-confirm gate.
        val allReads = cmds.all { RootGate.isReadOnlyAt(it) }
        if (!allReads) rootGate(s)?.let { return@run it }
        // Same rule as /api/at: an all-read batch is logged once a minute, a batch with any write gets its own line.
        if (allReads) auditBusy(s.remoteIpAddress ?: "?", "at-batch") else auditShell(s.remoteIpAddress ?: "?", cmds.joinToString(";"), "at-batch-write")
        // A random marker per request: a modem reply containing "##" or a look-alike marker cannot cut or forge results.
        val marker = AtBatch.newMarker()
        val r = RootShell.run(ctx, AtBatch.script(sendat, slot, cmds, marker), 20000)
        val results = JSONArray(AtBatch.parse(r.content, marker, cmds.size))
        json(Response.Status.OK, JSONObject().put("success", r.success).put("results", results))
    }
    else -> null
}

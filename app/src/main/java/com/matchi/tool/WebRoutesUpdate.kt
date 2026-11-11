package com.matchi.tool

import fi.iki.elonen.NanoHTTPD.IHTTPSession
import fi.iki.elonen.NanoHTTPD.Method
import fi.iki.elonen.NanoHTTPD.Response
import java.io.File
import org.json.JSONObject

// App update (APK) routes: stage, check, fetch, install, status.
// Split out of WebServer.kt (route groups are extension functions; helpers moved with them). Each route function
// returns null when the path is not one of its own, so WebServer.route() can ask the next group.

/** Multipart upload (field "apk"): saved to a temp file by NanoHTTPD, then size-capped, parsed and verified by ApkUpdater. */
internal fun WebServer.updateStage(s: IHTTPSession): Response {
    val len = s.headers["content-length"]?.toLongOrNull() ?: -1L
    if (len < 0 || len > ApkUpdater.MAX_BYTES + 1_000_000L)
        throw IllegalArgumentException("Upload must be at most ${ApkUpdater.MAX_BYTES / 1024 / 1024} MB")
    auditShell(s.remoteIpAddress ?: "?", "len=$len", "update-stage")
    return withUploadSlot(len) { updateStageLocked(s) }
}

internal fun WebServer.updateStageLocked(s: IHTTPSession): Response {
    val files = HashMap<String, String>()
    s.parseBody(files)
    val tmp = files["apk"]?.let { File(it) } ?: throw IllegalArgumentException("No file received (multipart field \"apk\")")
    val staged = try { ApkUpdater.stageFile(ctx, tmp) } finally { try { tmp.delete() } catch (e: Exception) { Quiet.note("WebServer.updateStageLocked", e) } }
    return json(Response.Status.OK, JSONObject().put("ok", true)
        .put("oldName", staged.oldName).put("oldCode", staged.oldCode)
        .put("newName", staged.newName).put("newCode", staged.newCode)
        .put("relation", staged.relation)
        .put("size", staged.size).put("sha256", staged.sha256).put("installedSha256", staged.installedSha))
}

/** OTA step 1: {"url":"https://..."}; asks what the link points to (version, size) without downloading the APK. */
internal fun WebServer.updateCheck(req: JSONObject): Response {
    val r = ApkUpdater.check(ctx, req.optString("url"))
    return json(Response.Status.OK, JSONObject().put("ok", true)
        .put("installedName", r.installedName).put("installedCode", r.installedCode)
        .put("remoteName", r.remoteName).put("relation", r.relation)
        .put("size", r.size).put("sha256", r.sha256).put("source", r.source).put("installedSha256", r.installedSha))
}

/** OTA step 2: {"url":"https://..."}; downloaded by the device, then verified exactly like an uploaded file. */
internal fun WebServer.updateFetch(req: JSONObject): Response {
    val staged = ApkUpdater.stageFromUrl(ctx, req.optString("url"))
    return json(Response.Status.OK, JSONObject().put("ok", true)
        .put("oldName", staged.oldName).put("oldCode", staged.oldCode)
        .put("newName", staged.newName).put("newCode", staged.newCode)
        .put("relation", staged.relation)
        .put("size", staged.size).put("sha256", staged.sha256).put("installedSha256", staged.installedSha))
}

internal fun WebServer.updateInstall(req: JSONObject): Response {
    ApkUpdater.installStaged(ctx, req.optString("sha256"))
    return json(Response.Status.OK, JSONObject().put("ok", true).put("note", "Installing. The host restarts in a few seconds; reload the page when it comes back."))
}

@Suppress("DEPRECATION")
internal fun WebServer.updateStatus(s: IHTTPSession): Response {
    val ver = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
    return json(Response.Status.OK, JSONObject().put("version", ver.versionName ?: "").put("code", ver.versionCode).put("lastUpdate", ver.lastUpdateTime)
        .also { if (s.parameters["log"]?.firstOrNull() == "1") it.put("log", ApkUpdater.lastLog(ctx)) })
}

internal fun WebServer.routeUpdate(s: IHTTPSession, uri: String): Response? = when {
    uri == "/api/update/stage" && s.method == Method.POST -> updateStage(s)
    uri == "/api/update/check" && s.method == Method.POST -> updateCheck(body(s))
    uri == "/api/update/fetch" && s.method == Method.POST -> updateFetch(body(s))
    uri == "/api/update/install" && s.method == Method.POST -> rootGate(s) ?: run {
        val req = body(s)
        auditShell(s.remoteIpAddress ?: "?", req.toString(), "update-install")
        updateInstall(req)
    }
    uri == "/api/update/status" && s.method == Method.GET -> updateStatus(s)
    else -> null
}

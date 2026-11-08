package com.matchi.tool

import android.content.Context
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.security.MessageDigest

/**
 * Safe update import for the web console. An APK uploaded from the browser is only installed when ALL hold:
 *  - it is a real, parseable Android package no larger than [MAX_BYTES] (ZIP header checked);
 *  - it is this app (same package name);
 *  - it is newer than the installed app, the same version number with a different SHA-256 ("rebuild", installed as a normal update),
 *    or an older version (rollback, app data is kept). An identical SHA-256 means the app is already the latest ("same") and nothing is installed;
 *  - it is signed by the same key as the installed app (or a key whose rotation lineage contains it);
 *  - the person saw version, size and SHA-256 and confirmed, and the install request quotes that same SHA-256;
 *  - it is installed within [STAGE_TTL_MS] of being checked, and the staged bytes are re-hashed first.
 * The file is staged in the app's private cache (not readable by other apps) and replaced on the next upload.
 * When the install finishes, the staged APK is deleted; on success the installer log and old root temp files go too (on failure the log is kept to show why).
 * Installation uses `pm install -r` through the root manager (app data is kept); a rollback uses `pm install -r -d`. If Android still refuses
 * the downgrade (non-debuggable app), the installed APK is copied aside, `pm uninstall -k` (keeps app data) runs, the older build is installed,
 * and if that fails the copied APK is installed again so the device is never left without the app. Android enforces the signature check again.
 */
object ApkUpdater {
    const val MAX_BYTES = 120L * 1024 * 1024
    const val STAGE_TTL_MS = 10 * 60 * 1000L
    private const val DIR = "update"
    private const val FILE = "pending.apk"
    private const val TMPD = "/data/local/matchitool/tmp"   // root-only (the adb shell user can write /data/local/tmp)
    private const val LOG = "$TMPD/matchi_update.log"

    class UpdateException(message: String) : Exception(message)

    class Staged(
        val file: File, val sha256: String, val size: Long,
        val oldName: String, val oldCode: Long, val newName: String, val newCode: Long,
        val installedSha: String = "",
        val stagedAt: Long = System.currentTimeMillis(),
    ) {
        /**
         * "newer", "older", "same" or "rebuild" compared with the installed build. "same" means the very same file (identical SHA-256);
         * "rebuild" means the same version number but a different file (different SHA-256), which installs as a normal update.
         */
        val relation: String get() = when {
            newCode > oldCode -> "newer"
            newCode < oldCode -> "older"
            installedSha.isNotEmpty() && sha256.equals(installedSha, ignoreCase = true) -> "same"
            else -> "rebuild"
        }
    }

    /** Result of [check]: what the link points to, without downloading the APK body. */
    class Remote(
        val installedName: String, val installedCode: Long,
        val remoteName: String,      // tag / version text from the release, "" when unknown
        val relation: String,        // newer | rebuild (same version, different SHA-256) | same | older | unknown
        val size: Long,              // bytes, -1 when unknown
        val sha256: String,          // from the release metadata when published, else ""
        val source: String,
        val installedSha: String = "", // SHA-256 of the installed APK
    )

    @Volatile private var current: Staged? = null

    private fun stagingDir(ctx: Context) = File(ctx.cacheDir, DIR)

    fun cleanup(ctx: Context) {
        current = null
        try { stagingDir(ctx).listFiles()?.forEach { it.delete() } } catch (e: Exception) { Quiet.note("ApkUpdater.cleanup", e) }
    }

    /**
     * Leftovers from earlier updates/uploads: the staged APK and NanoHTTPD upload temp files. Called when the host starts
     * (nothing can be mid-upload then). Settings, token, plugins and saved IMEI data are never touched.
     */
    fun cleanStale(ctx: Context) {
        cleanup(ctx)
        try { ctx.cacheDir.listFiles { f -> f.name.startsWith("NanoHTTPD-") }?.forEach { it.delete() } } catch (e: Exception) { Quiet.note("ApkUpdater.cleanStale", e) }
    }


    // ---- check (no APK download) -------------------------------------------------------------------------

    private fun requireAllowedHost(url: java.net.URL) {
        if (!UpdateLinks.hostAllowed(url.host))
            throw UpdateException("Only GitHub release links are accepted (github.com). Download the APK yourself and upload it instead.")
    }

    private fun openHttps(link: java.net.URL, method: String = "GET", accept: String? = null): java.net.HttpURLConnection {
        var url = link
        var hops = 0
        while (true) {
            if (url.protocol != "https") throw UpdateException("The link redirects to a non-https address; refused.")
            requireAllowedHost(url)
            val c = url.openConnection() as java.net.HttpURLConnection
            c.connectTimeout = 15_000; c.readTimeout = 20_000; c.instanceFollowRedirects = false
            c.requestMethod = method
            c.setRequestProperty("User-Agent", "MatchiTOOL-OTA")
            if (accept != null) c.setRequestProperty("Accept", accept)
            val code = c.responseCode
            if (code in 301..308 && code != 304) {
                val loc = c.getHeaderField("Location") ?: throw UpdateException("Redirect without a target.")
                c.disconnect()
                if (++hops > 5) throw UpdateException("Too many redirects.")
                url = java.net.URL(url, loc)
                continue
            }
            return c
        }
    }

    private fun compareNames(a: String, b: String): Int? = UpdateLinks.compareNames(a, b)

    /**
     * Ask what [link] points to WITHOUT downloading the APK: for a GitHub release link the release metadata (tag, asset size, SHA-256
     * when GitHub publishes it); for any other https link a HEAD request (size only). Nothing is staged or installed here; the later
     * download runs every safety check again on the real file.
     */
    @Suppress("DEPRECATION")
    fun check(ctx: Context, link: String): Remote = try { checkInner(ctx, link) }
        catch (e: UpdateException) { throw e }
        catch (e: Exception) { throw UpdateException("Could not reach the link: ${e.message ?: e.javaClass.simpleName}. Does the device have internet?") }

    @Suppress("DEPRECATION")
    private fun checkInner(ctx: Context, link: String): Remote {
        val url = try { java.net.URL(UpdateLinks.normalizeReleaseLink(link)) } catch (_: Exception) { throw UpdateException("That is not a valid link.") }
        if (url.protocol != "https") throw UpdateException("Only https:// links are accepted.")
        requireAllowedHost(url)
        val installed = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
        val haveName = installed.versionName ?: "?"
        val haveCode = if (Build.VERSION.SDK_INT >= 28) installed.longVersionCode else installed.versionCode.toLong()
        val iSha = installedSha256(ctx)
        val m = Regex("^/([^/]+)/([^/]+)/releases/(?:latest/download|download/([^/]+))/([^/]+)$").find(url.path)
        if (url.host.equals("github.com", true) && m != null) {
            val (owner, repo, tag, asset) = m.destructured
            val api = if (tag.isEmpty()) "latest" else "tags/" + java.net.URLEncoder.encode(tag, "UTF-8")
            val c = openHttps(java.net.URL("https://api.github.com/repos/$owner/$repo/releases/$api"), accept = "application/vnd.github+json")
            try {
                if (c.responseCode == 404) throw UpdateException("No release found at that GitHub link (HTTP 404). Check the owner, repository and that the release repository is public.")
                if (c.responseCode != 200) throw UpdateException(UpdateLinks.releaseFailure(c.responseCode, c.getHeaderField("X-RateLimit-Remaining")))
                val body = c.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }
                val rel = org.json.JSONObject(body)
                val name = rel.optString("tag_name", "").ifEmpty { rel.optString("name", "") }
                val assets = rel.optJSONArray("assets")
                var size = -1L; var digest = ""
                if (assets != null) {
                    // The link names a file, but a release may call it something else (e.g. a build number): use the single APK then.
                    val names = (0 until assets.length()).map { assets.getJSONObject(it).optString("name") }
                    val use = UpdateLinks.pickApk(names, asset)
                    for (i in 0 until assets.length()) {
                        val a = assets.getJSONObject(i)
                        if (a.optString("name") == use) {
                            size = a.optLong("size", -1L)
                            digest = a.optString("digest", "").removePrefix("sha256:").lowercase().takeIf { it.length == 64 } ?: ""
                        }
                    }
                }
                if (assets != null && size < 0) throw UpdateException("The latest release ($name) has no file called $asset, and it does not have exactly one APK to use instead.")
                var rel2 = compareNames(name, haveName)?.let { if (it > 0) "newer" else if (it == 0) "same" else "older" } ?: "unknown"
                // The version text alone cannot tell two builds of the same version apart: when GitHub publishes the SHA-256, compare it
                // with the installed APK. Identical hash = really the same file; different hash on the same version = a different build.
                if (digest.isNotEmpty() && iSha.isNotEmpty()) {
                    if (digest.equals(iSha, ignoreCase = true)) rel2 = "same" else if (rel2 == "same") rel2 = "rebuild"
                }
                return Remote(haveName, haveCode, name, rel2, size, digest, "GitHub release", iSha)
            } finally { c.disconnect() }
        }
        val c = openHttps(url, method = "HEAD")
        try {
            if (c.responseCode != 200) throw UpdateException("The link did not answer (HTTP ${c.responseCode}).")
            return Remote(haveName, haveCode, "", "unknown", c.contentLengthLong, "", "link", iSha)
        } finally { c.disconnect() }
    }

    /**
     * OTA: download an APK from an https link (e.g. a GitHub release asset) into the private cache, then run it through
     * exactly the same checks as an uploaded file (same package, same signing key, SHA-256 confirm; newer, same-version or older file).
     * The link is only a transport: nothing is installed without those checks and the person's confirmation.
     */
    fun stageFromUrl(ctx: Context, link: String): Staged {
        // GitHub (or the mobile network in between) often answers 502/503/504 or drops the connection for a moment, so a
        // download that fails like that is tried again a few times before it is reported as failed.
        var last = ""
        for (attempt in 1..DOWNLOAD_TRIES) {
            try { return downloadOnce(ctx, link) }
            catch (e: Retryable) {
                last = e.message ?: "unknown error"
                LogCatcher.log("WARNING", "ApkUpdater", "Download attempt $attempt/$DOWNLOAD_TRIES failed: $last")
                if (attempt < DOWNLOAD_TRIES) try { Thread.sleep(2_000L * attempt) } catch (_: InterruptedException) { break }
            }
        }
        throw UpdateException("Download failed after $DOWNLOAD_TRIES tries ($last). GitHub is not answering right now: wait a minute and try again, or download the APK and install it by hand.")
    }

    /** A failure worth another try: a temporary HTTP status from the server, a timeout or a dropped connection. */
    private class Retryable(msg: String) : Exception(msg)
    private const val DOWNLOAD_TRIES = 4
    private val RETRY_CODES = setOf(408, 425, 429, 500, 502, 503, 504)

    private fun downloadOnce(ctx: Context, link: String): Staged {
        val first = try { java.net.URL(UpdateLinks.normalizeReleaseLink(link)) } catch (_: Exception) { throw UpdateException("That is not a valid link.") }
        if (first.protocol != "https") throw UpdateException("Only https:// links are accepted.")
        requireAllowedHost(first)
        val resolved = try { resolveGithubAsset(first) } catch (e: java.io.IOException) { throw Retryable("${e.javaClass.simpleName}: ${e.message ?: "connection problem"}") }
        val url = resolved ?: first
        requireAllowedHost(url)
        val tmp = File(ctx.cacheDir, "NanoHTTPD-ota-${System.currentTimeMillis()}.tmp")
        var cur = url   // the hop being fetched: a relative Location is resolved against THIS, not the first link
        var conn = url.openConnection() as java.net.HttpURLConnection   // non-null so smart casts stay simple; closed in finally
        try {
            var hops = 0
            while (true) {
                conn.connectTimeout = 20_000; conn.readTimeout = 60_000; conn.instanceFollowRedirects = false
                conn.setRequestProperty("User-Agent", "MatchiTOOL-OTA")
                val code = conn.responseCode
                if (code in 301..308 && code != 304) {
                    val loc = conn.getHeaderField("Location") ?: throw UpdateException("Redirect without a target.")
                    val next = java.net.URL(cur, loc)
                    if (next.protocol != "https") throw UpdateException("The link redirects to a non-https address; refused.")
                    requireAllowedHost(next)
                    conn.disconnect()
                    if (++hops > 5) throw UpdateException("Too many redirects.")
                    cur = next
                    conn = next.openConnection() as java.net.HttpURLConnection
                    continue
                }
                if (code in RETRY_CODES) throw Retryable("HTTP $code from ${cur.host}")
                if (code != 200) throw UpdateException("Download failed (HTTP $code from ${cur.host}). Check the link: it must point to a GitHub release APK.")
                break
            }
            val len = conn.contentLengthLong
            if (len > MAX_BYTES) throw UpdateException("The file is larger than ${MAX_BYTES / 1024 / 1024} MB, so it is not a MatchiTOOL update.")
            var got = 0L
            conn.inputStream.use { i -> FileOutputStream(tmp).use { o ->
                val buf = ByteArray(64 * 1024)
                while (true) {
                    val n = i.read(buf); if (n < 0) break
                    got += n
                    if (got > MAX_BYTES) throw UpdateException("The download is larger than ${MAX_BYTES / 1024 / 1024} MB; stopped.")
                    o.write(buf, 0, n)
                }
            } }
            conn.disconnect()
            return stageFile(ctx, tmp)
        } catch (e: UpdateException) { throw e
        } catch (e: Retryable) { throw e
        } catch (e: java.io.IOException) { throw Retryable("${e.javaClass.simpleName}: ${e.message ?: "connection problem"}")
        } catch (e: Exception) { throw UpdateException("Download failed: ${e.message ?: e.javaClass.simpleName}.")
        } finally {
            try { conn.disconnect() } catch (e: Exception) { Quiet.note("ApkUpdater.stageFromUrl", e) }
            try { tmp.delete() } catch (e: Exception) { Quiet.note("ApkUpdater.stageFromUrl", e) }
        }
    }

    /**
     * For a GitHub release link whose file name is not in the release, the real download link of the one APK that is
     * (see [UpdateLinks.pickApk]). Null when the link is not a GitHub release link, the named file exists, or nothing
     * can be decided: the original link is then used unchanged.
     */
    private fun resolveGithubAsset(url: java.net.URL): java.net.URL? {
        val m = Regex("^/([^/]+)/([^/]+)/releases/(?:latest/download|download/([^/]+))/([^/]+)$").find(url.path) ?: return null
        if (!url.host.equals("github.com", true)) return null
        val (owner, repo, tag, asset) = m.destructured
        val api = if (tag.isEmpty()) "latest" else "tags/" + java.net.URLEncoder.encode(tag, "UTF-8")
        val c = openHttps(java.net.URL("https://api.github.com/repos/$owner/$repo/releases/$api"), accept = "application/vnd.github+json")
        try {
            if (c.responseCode != 200) return null
            val assets = org.json.JSONObject(c.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }).optJSONArray("assets") ?: return null
            val names = (0 until assets.length()).map { assets.getJSONObject(it).optString("name") }
            val use = UpdateLinks.pickApk(names, asset) ?: return null
            if (use == asset) return null
            val dl = (0 until assets.length()).map { assets.getJSONObject(it) }.first { it.optString("name") == use }.optString("browser_download_url")
            return java.net.URL(dl).takeIf { it.protocol == "https" && UpdateLinks.hostAllowed(it.host) }
        } catch (e: UpdateException) { throw e
        } catch (e: Exception) { LogCatcher.log("WARNING", "ApkUpdater", "Could not resolve the release file name: ${e.message}"); return null
        } finally { c.disconnect() }
    }

    private fun hex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }

    /**
     * Take over the uploaded temp file (renamed into private storage: no second copy; copied only if rename is impossible),
     * then make ONE pass over it for size, ZIP header and SHA-256, and ONE signature/version parse. Blocking.
     */
    @Synchronized
    fun stageFile(ctx: Context, src: File): Staged {
        cleanup(ctx)
        // Lower priority so the hotspot / modem keep their CPU time while this runs.
        try { android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND) } catch (e: Exception) { Quiet.note("ApkUpdater.stageFile", e) }
        val dir = stagingDir(ctx).apply { mkdirs() }
        val out = File(dir, FILE)
        try {
            if (src.length() > MAX_BYTES) throw UpdateException("The file is larger than ${MAX_BYTES / 1024 / 1024} MB, so it is not a MatchiTOOL update.")
            if (!src.renameTo(out)) {
                FileInputStream(src).use { i -> FileOutputStream(out).use { o -> i.copyTo(o, 256 * 1024) } }
                src.delete()
            }
            val total = out.length()
            if (total < 1024) throw UpdateException("The file is too small to be an APK.")
            val md = MessageDigest.getInstance("SHA-256")
            FileInputStream(out).use { i ->
                val buf = ByteArray(256 * 1024)
                var first = true
                while (true) {
                    val n = i.read(buf)
                    if (n < 0) break
                    if (first) {
                        first = false
                        if (n < 4 || buf[0] != 'P'.code.toByte() || buf[1] != 'K'.code.toByte() || buf[2] != 3.toByte() || buf[3] != 4.toByte())
                            throw UpdateException("This is not an APK file (no ZIP header).")
                    }
                    md.update(buf, 0, n)
                }
            }
            val s = verify(ctx, out, total, hex(md.digest()))
            current = s
            return s
        } catch (e: Exception) {
            cleanup(ctx)
            throw if (e is UpdateException) e else UpdateException("Could not read the file: ${e.message ?: e.javaClass.simpleName}")
        }
    }

    @Suppress("DEPRECATION")
    private fun verify(ctx: Context, file: File, size: Long, sha: String): Staged {
        val pm = ctx.packageManager
        val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        val archive = pm.getPackageArchiveInfo(file.absolutePath, flags)
            ?: throw UpdateException("Android could not read this file as an app package. It may be damaged or unsigned.")
        if (archive.packageName != ctx.packageName)
            throw UpdateException("This APK is for a different app (${archive.packageName}). Only MatchiTOOL updates are accepted.")
        val installed = pm.getPackageInfo(ctx.packageName, flags)
        val oldCode = code(installed)
        val newCode = code(archive)
        // Older versions are allowed (rollback); an identical file is reported as already the latest.
        // Read the signers the normal way first; some Android builds return nothing for an archive (or for the installed app)
        // with GET_SIGNING_CERTIFICATES, so fall back to the older GET_SIGNATURES lookup before giving up.
        var have = currentSigners(installed)
        if (have.isEmpty()) have = legacySigners { pm.getPackageInfo(ctx.packageName, PackageManager.GET_SIGNATURES) }
        var offered = allSigners(archive)
        if (offered.isEmpty()) offered = legacySigners { pm.getPackageArchiveInfo(file.absolutePath, PackageManager.GET_SIGNATURES) }
        if (offered.isEmpty()) {
            throw UpdateException(
                if (!looksSigned(file))
                    "This APK is not signed at all (an unsigned release build, usually app-release-unsigned.apk). Use the signed APK from the release workflow, or rebuild with the MatchiTOOL keystore."
                else
                    "Android could not read this APK's signature on this device, so it cannot be trusted. Rebuild it with the same MatchiTOOL keystore, or install it with: su -c 'pm install -r <file>'."
            )
        }
        if (have.isEmpty())
            throw UpdateException("Android could not read the signature of the installed MatchiTOOL, so the update cannot be compared. Install the new APK with: su -c 'pm install -r <file>'.")
        if (!offered.containsAll(have))
            throw UpdateException("Signature mismatch: this APK was not signed by the same key as the installed MatchiTOOL. Android would refuse it, and it may not be a genuine update.")
        return Staged(file, sha, size, installed.versionName ?: "?", oldCode, archive.versionName ?: "?", newCode, installedSha256(ctx))
    }

    /** SHA-256 of the APK that is installed right now (the app's own base.apk); "" when it cannot be read. */
    fun installedSha256(ctx: Context): String = try {
        FileInputStream(File(ctx.applicationInfo.sourceDir)).use { i ->
            val md = MessageDigest.getInstance("SHA-256"); val buf = ByteArray(256 * 1024)
            while (true) { val n = i.read(buf); if (n < 0) break; md.update(buf, 0, n) }
            hex(md.digest())
        }
    } catch (_: Exception) { "" }

    @Suppress("DEPRECATION")
    private fun code(p: PackageInfo): Long = if (Build.VERSION.SDK_INT >= 28) p.longVersionCode else p.versionCode.toLong()

    private fun sha256(b: ByteArray) = hex(MessageDigest.getInstance("SHA-256").digest(b))

    /** Signers from the old (pre-Android 9) lookup; empty when the lookup fails or returns nothing. */
    @Suppress("DEPRECATION")
    private fun legacySigners(load: () -> PackageInfo?): Set<String> = try {
        load()?.signatures?.map { sha256(it.toByteArray()) }?.toSet() ?: emptySet()
    } catch (_: Exception) { emptySet() }

    /**
     * True when the APK carries any signature block: a v1 META-INF signature file, or the v2/v3 "APK Sig Block 42"
     * that sits right before the ZIP central directory. Used only to give a clear error message.
     */
    private fun looksSigned(f: File): Boolean = try {
        val v1 = java.util.zip.ZipFile(f).use { z ->
            z.entries().asSequence().any {
                val n = it.name.uppercase()
                n.startsWith("META-INF/") && (n.endsWith(".RSA") || n.endsWith(".DSA") || n.endsWith(".EC"))
            }
        }
        v1 || java.io.RandomAccessFile(f, "r").use { raf ->
            val len = raf.length()
            val n = minOf(len, 65_557L).toInt()
            val tail = ByteArray(n)
            raf.seek(len - n)
            raf.readFully(tail)
            var i = n - 22
            while (i >= 0 && !(tail[i] == 0x50.toByte() && tail[i + 1] == 0x4b.toByte() && tail[i + 2] == 5.toByte() && tail[i + 3] == 6.toByte())) i--
            if (i < 0) {
                false
            } else {
                val off = (tail[i + 16].toLong() and 0xff) or ((tail[i + 17].toLong() and 0xff) shl 8) or
                    ((tail[i + 18].toLong() and 0xff) shl 16) or ((tail[i + 19].toLong() and 0xff) shl 24)
                if (off < 16) {
                    false
                } else {
                    val magic = ByteArray(16)
                    raf.seek(off - 16)
                    raf.readFully(magic)
                    String(magic, Charsets.US_ASCII) == "APK Sig Block 42"
                }
            }
        }
    } catch (_: Exception) { false }

    /** Certificates the package is signed with right now. */
    @Suppress("DEPRECATION")
    private fun currentSigners(p: PackageInfo): Set<String> =
        if (Build.VERSION.SDK_INT >= 28) p.signingInfo?.apkContentsSigners?.map { sha256(it.toByteArray()) }?.toSet() ?: emptySet()
        else p.signatures?.map { sha256(it.toByteArray()) }?.toSet() ?: emptySet()

    /** Current signers plus older keys in the APK's key-rotation lineage (so a properly rotated key is still accepted). */
    @Suppress("DEPRECATION")
    private fun allSigners(p: PackageInfo): Set<String> {
        if (Build.VERSION.SDK_INT >= 28) {
            val si = p.signingInfo ?: return emptySet()
            val cur = si.apkContentsSigners?.map { sha256(it.toByteArray()) }?.toSet() ?: emptySet()
            val past = if (!si.hasMultipleSigners() && si.hasPastSigningCertificates())
                si.signingCertificateHistory?.map { sha256(it.toByteArray()) }?.toSet() ?: emptySet() else emptySet()
            return cur + past
        }
        return currentSigners(p)
    }

    // ---- install ---------------------------------------------------------------------------------------

    /**
     * Install the staged file. [expectedSha] is the hash the person was shown. The install runs detached (as root) after a
     * short delay, because replacing the app stops this very process; the page then waits for the new version to answer.
     */
    fun installStaged(ctx: Context, expectedSha: String) {
        val s = current ?: throw UpdateException("Nothing is staged. Choose the APK again.")
        if (!s.sha256.equals(expectedSha, ignoreCase = true)) throw UpdateException("The SHA-256 does not match the file that was checked. Choose the APK again.")
        if (s.relation == "same") { cleanup(ctx); throw UpdateException("MatchiTOOL is already the latest version (identical SHA-256). Nothing to install.") }
        if (System.currentTimeMillis() - s.stagedAt > STAGE_TTL_MS) { cleanup(ctx); throw UpdateException("The checked file expired (10 minutes). Choose the APK again.") }
        if (!s.file.isFile || s.file.length() != s.size) { cleanup(ctx); throw UpdateException("The staged file is missing. Choose the APK again.") }
        val again = FileInputStream(s.file).use { i ->
            val md = MessageDigest.getInstance("SHA-256"); val buf = ByteArray(64 * 1024)
            while (true) { val n = i.read(buf); if (n < 0) break; md.update(buf, 0, n) }
            hex(md.digest())
        }
        if (again != s.sha256) { cleanup(ctx); throw UpdateException("The staged file changed after it was checked. Update cancelled.") }
        // Paths are app-generated (no user text). The APK is streamed to pm on stdin.
        // `pm install -r` (app data is kept). A rollback adds -d (allow downgrade). Android checks the signature again.
        val path = s.file.absolutePath
        val rollback = s.newCode < s.oldCode
        val flags = if (rollback) "-r -d" else "-r"
        // Rollback fallback: on a non-debuggable app `-d` is refused (INSTALL_FAILED_VERSION_DOWNGRADE). Copy the installed APK aside first,
        // then `pm uninstall -k` (keeps app data) and install the older build. If that install fails, put the copied build back and start it.
        // Paths are app-generated (no quotes or spaces); the whole thing runs inside sh -c '...', so no single quotes here.
        val base = ctx.applicationInfo.sourceDir
        val prev = "$TMPD/.matchi_out_prev.apk"
        val prevSize = File(base).length()
        val pkg = ctx.packageName
        val d = "$"
        val fallback = if (!rollback) "" else
            "if [ ${d}rc -ne 0 ] && grep -q DOWNGRADE $LOG; then " +
            "if cp \"$base\" \"$prev\" && [ \"${d}(wc -c < $prev)\" -eq $prevSize ]; then " +
            "pm uninstall -k $pkg >> $LOG 2>&1; pm install -r -S ${s.size} < \"$path\" >> $LOG 2>&1; rc=${d}?; " +
            "if [ ${d}rc -ne 0 ]; then pm install -r -S $prevSize < \"$prev\" >> $LOG 2>&1; am start --user 0 -n $pkg/.MainActivity >/dev/null 2>&1; fi; " +
            "else echo \"Could not copy the installed APK aside; rollback cancelled\" >> $LOG; fi; fi; "
        val script = """
            mkdir -p $TMPD; if [ -L $TMPD ] || [ "${'$'}(stat -c %u $TMPD 2>/dev/null)" != 0 ]; then echo "unsafe temp folder"; exit 1; fi
            chmod 700 $TMPD
            rm -f $LOG
            if command -v setsid >/dev/null 2>&1; then S=setsid; else S=; fi
            if command -v nice >/dev/null 2>&1; then N='nice -n 10'; else N=; fi
            ${'$'}S nohup ${'$'}N sh -c 'sleep 2; pm install $flags -S ${s.size} < "$path" > $LOG 2>&1; rc=${'$'}?; ${fallback}rm -f "$path"; if [ ${'$'}rc -eq 0 ]; then am start --user 0 -n ${ctx.packageName}/.MainActivity >/dev/null 2>&1; rm -f "$prev"; find $TMPD /data/local/tmp -name ".matchi_out_*" -mmin +5 -delete 2>/dev/null; rm -f $LOG; fi' </dev/null >/dev/null 2>&1 &
            echo started
        """.trimIndent()
        val r = RootShell.run(ctx, script, 15_000)
        if (!r.success || !r.content.contains("started")) throw UpdateException("Could not start the installer (is root granted to MatchiTOOL?): ${r.content.take(200)}")
    }

    /** Result text of the last root install (empty if none). */
    fun lastLog(ctx: Context): String = RootShell.run(ctx, "tail -c 1500 $LOG 2>/dev/null", 10_000).content
}

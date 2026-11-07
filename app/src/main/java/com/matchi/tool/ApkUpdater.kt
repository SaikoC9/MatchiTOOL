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
 *  - it is strictly NEWER (versionCode): no downgrades and no same-build reinstalls;
 *  - it is signed by the same key as the installed app (or a key whose rotation lineage contains it);
 *  - the person saw version, size and SHA-256 and confirmed, and the install request quotes that same SHA-256;
 *  - it is installed within [STAGE_TTL_MS] of being checked, and the staged bytes are re-hashed first.
 * The file is staged in the app's private cache (not readable by other apps) and replaced on the next upload.
 * When the install finishes, the staged APK is deleted; on success the installer log and old root temp files go too (on failure the log is kept to show why).
 * Installation uses `pm install -r` through the root manager (never `-d`), so Android enforces the signature check again.
 */
object ApkUpdater {
    const val MAX_BYTES = 120L * 1024 * 1024
    const val STAGE_TTL_MS = 10 * 60 * 1000L
    private const val DIR = "update"
    private const val FILE = "pending.apk"
    private const val LOG = "/data/local/tmp/matchi_update.log"

    class UpdateException(message: String) : Exception(message)

    class Staged(
        val file: File, val sha256: String, val size: Long,
        val oldName: String, val oldCode: Long, val newName: String, val newCode: Long,
        val stagedAt: Long = System.currentTimeMillis(),
    )

    @Volatile private var current: Staged? = null

    private fun stagingDir(ctx: Context) = File(ctx.cacheDir, DIR)

    fun cleanup(ctx: Context) {
        current = null
        try { stagingDir(ctx).listFiles()?.forEach { it.delete() } } catch (_: Exception) {}
    }

    /**
     * Leftovers from earlier updates/uploads: the staged APK and NanoHTTPD upload temp files. Called when the host starts
     * (nothing can be mid-upload then). Settings, token, plugins and saved IMEI data are never touched.
     */
    fun cleanStale(ctx: Context) {
        cleanup(ctx)
        try { ctx.cacheDir.listFiles { f -> f.name.startsWith("NanoHTTPD-") }?.forEach { it.delete() } } catch (_: Exception) {}
    }

    /**
     * OTA: download an APK from an https link (e.g. a GitHub release asset) into the private cache, then run it through
     * exactly the same checks as an uploaded file (same package, newer versionCode, same signing key, SHA-256 confirm).
     * The link is only a transport: nothing is installed without those checks and the person's confirmation.
     */
    fun stageFromUrl(ctx: Context, link: String): Staged {
        val url = try { java.net.URL(link.trim()) } catch (_: Exception) { throw UpdateException("That is not a valid link.") }
        if (url.protocol != "https") throw UpdateException("Only https:// links are accepted.")
        val tmp = File(ctx.cacheDir, "NanoHTTPD-ota-${System.currentTimeMillis()}.tmp")
        try {
            var conn = url.openConnection() as java.net.HttpURLConnection
            var hops = 0
            while (true) {
                conn.connectTimeout = 15_000; conn.readTimeout = 30_000; conn.instanceFollowRedirects = false
                conn.setRequestProperty("User-Agent", "MatchiTOOL-OTA")
                val code = conn.responseCode
                if (code in 301..308 && code != 304) {
                    val loc = conn.getHeaderField("Location") ?: throw UpdateException("Redirect without a target.")
                    val next = java.net.URL(url, loc)
                    if (next.protocol != "https") throw UpdateException("The link redirects to a non-https address; refused.")
                    conn.disconnect()
                    if (++hops > 5) throw UpdateException("Too many redirects.")
                    conn = next.openConnection() as java.net.HttpURLConnection
                    continue
                }
                if (code != 200) throw UpdateException("Download failed (HTTP $code). Check the link and that the device has internet.")
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
        } catch (e: Exception) { throw UpdateException("Download failed: ${e.message ?: e.javaClass.simpleName}. Does the device have internet?")
        } finally { try { tmp.delete() } catch (_: Exception) {} }
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
        try { android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND) } catch (_: Exception) {}
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
            val magic = ByteArray(4)
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
        if (newCode <= oldCode)
            throw UpdateException(
                if (newCode == oldCode) "This is the same build that is already installed (version ${installed.versionName}, code $oldCode)."
                else "Downgrade blocked: this file is older (code $newCode) than the installed app (code $oldCode)."
            )
        val have = currentSigners(installed)
        val offered = allSigners(archive)
        if (have.isEmpty() || offered.isEmpty())
            throw UpdateException("The APK has no valid signature, so it cannot be trusted.")
        if (!offered.containsAll(have))
            throw UpdateException("Signature mismatch: this APK was not signed by the same key as the installed MatchiTOOL. Android would refuse it, and it may not be a genuine update.")
        return Staged(file, sha, size, installed.versionName ?: "?", oldCode, archive.versionName ?: "?", newCode)
    }

    @Suppress("DEPRECATION")
    private fun code(p: PackageInfo): Long = if (Build.VERSION.SDK_INT >= 28) p.longVersionCode else p.versionCode.toLong()

    private fun sha256(b: ByteArray) = hex(MessageDigest.getInstance("SHA-256").digest(b))

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
        if (System.currentTimeMillis() - s.stagedAt > STAGE_TTL_MS) { cleanup(ctx); throw UpdateException("The checked file expired (10 minutes). Choose the APK again.") }
        if (!s.file.isFile || s.file.length() != s.size) { cleanup(ctx); throw UpdateException("The staged file is missing. Choose the APK again.") }
        val again = FileInputStream(s.file).use { i ->
            val md = MessageDigest.getInstance("SHA-256"); val buf = ByteArray(64 * 1024)
            while (true) { val n = i.read(buf); if (n < 0) break; md.update(buf, 0, n) }
            hex(md.digest())
        }
        if (again != s.sha256) { cleanup(ctx); throw UpdateException("The staged file changed after it was checked. Update cancelled.") }
        // Paths are app-generated (no user text). The APK is streamed to pm on stdin; no -d, so no downgrade.
        val path = s.file.absolutePath
        val script = """
            rm -f $LOG
            if command -v setsid >/dev/null 2>&1; then S=setsid; else S=; fi
            if command -v nice >/dev/null 2>&1; then N='nice -n 10'; else N=; fi
            ${'$'}S nohup ${'$'}N sh -c 'sleep 2; pm install -r -S ${s.size} < "$path" > $LOG 2>&1; rc=${'$'}?; rm -f "$path"; if [ ${'$'}rc -eq 0 ]; then am start --user 0 -n ${ctx.packageName}/.MainActivity >/dev/null 2>&1; find /data/local/tmp -name ".matchi_out_*" -mmin +5 -delete 2>/dev/null; rm -f $LOG; fi' </dev/null >/dev/null 2>&1 &
            echo started
        """.trimIndent()
        val r = RootShell.run(ctx, script, 15_000)
        if (!r.success || !r.content.contains("started")) throw UpdateException("Could not start the installer (is root granted to MatchiTOOL?): ${r.content.take(200)}")
    }

    /** Result text of the last root install (empty if none). */
    fun lastLog(ctx: Context): String = RootShell.run(ctx, "tail -c 1500 $LOG 2>/dev/null", 10_000).content
}

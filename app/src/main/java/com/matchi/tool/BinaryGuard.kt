package com.matchi.tool

import java.io.File
import java.io.InputStream
import java.nio.file.attribute.PosixFilePermission
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap

/**
 * The rules for "never run a changed binary as root". The app copies sendat, curl, jq, sha256 and zreq out of the APK into its files
 * folder, and root scripts run them from there. A copy can go wrong (the F50's /data is mounted nobarrier, so a copy that was not synced
 * came back as zeros) or be replaced by something else. [BinaryHashes] holds the hash each file had when the app was built; this object
 * decides what a hash means. No Android classes in here, so it has a plain unit test. The code that touches the device is [BinaryCheck].
 */
object BinaryGuard {
    enum class Verdict { OK, MISSING, MISMATCH, UNKNOWN }

    /** [actual] is the hash of the file on disk, or null when there is no such file. A name that is not in [table] is UNKNOWN, never refused. */
    fun verdict(name: String, actual: String?, table: Map<String, String> = BinaryHashes.table()): Verdict {
        val want = table[name] ?: return Verdict.UNKNOWN
        return when {
            actual == null -> Verdict.MISSING
            actual.equals(want, ignoreCase = true) -> Verdict.OK
            else -> Verdict.MISMATCH
        }
    }

    fun hashStream(input: InputStream): String {
        val md = MessageDigest.getInstance("SHA-256")
        val buf = ByteArray(65536)
        while (true) {
            val n = input.read(buf)
            if (n < 0) break
            md.update(buf, 0, n)
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    /** The hash of [f], or null when it does not exist or cannot be read. */
    fun hashFile(f: File): String? {
        if (!f.isFile) return null
        return try { f.inputStream().use { hashStream(it) } } catch (e: Exception) { Quiet.note("BinaryGuard.hashFile", e); null }
    }

    // What the app refused, by name, with the reason. Shown by Full diagnose. A name leaves the map when its file is good again.
    private val refused = ConcurrentHashMap<String, String>()

    fun refuse(name: String, why: String) { refused[name] = why }
    fun clearRefusal(name: String) { refused.remove(name) }
    fun refusals(): Map<String, String> = refused.toSortedMap()
    fun resetForTest() { refused.clear(); stamps.clear() }

    // A file that was checked and was fine is not hashed again while its size and modified time stay the same. The sendat calls happen
    // every few seconds while the Live panel is open, and zreq is 5 MB. This stops a replaced file by another app or user; someone with root
    // can set the time back, but they could also change this app, so that is outside what the check is for.
    private val stamps = ConcurrentHashMap<String, Pair<Long, Long>>()

    fun isStamped(name: String, size: Long, modified: Long): Boolean = stamps[name] == (size to modified)
    fun stamp(name: String, size: Long, modified: Long) { stamps[name] = size to modified }
    fun unstamp(name: String) { stamps.remove(name) }

    /** True when someone other than the owner can write to the file or folder, so another user could swap it. Reading or running is not the concern here. */
    fun othersCanWrite(perms: Set<PosixFilePermission>): Boolean =
        PosixFilePermission.GROUP_WRITE in perms || PosixFilePermission.OTHERS_WRITE in perms

    /**
     * True when a user other than the owner and the owner's group can write to the folder. Android gives every app folder rwx for the
     * app's own group (here u0_a135, the same uid), so GROUP_WRITE on the folder is normal and not a warning; only OTHERS_WRITE is.
     */
    fun folderOpenToOthers(perms: Set<PosixFilePermission>): Boolean = PosixFilePermission.OTHERS_WRITE in perms

    /** One line for Full diagnose. */
    fun reportLine(name: String, verdict: Verdict, refusal: String?): String = when {
        refusal != null -> "$name: REFUSED - $refusal"
        verdict == Verdict.OK -> "$name: ok (matches the hash from the build)"
        verdict == Verdict.MISSING -> "$name: not installed"
        verdict == Verdict.MISMATCH -> "$name: DIFFERENT from the build (it will be refused)"
        else -> "$name: not in the hash list"
    }
}

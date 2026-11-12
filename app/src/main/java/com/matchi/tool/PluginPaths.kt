package com.matchi.tool

// ---- Plugin data: what deleting a plugin may erase ----------------------------------------------------------------
private const val MATCHI_DIR = "/data/local/matchitool"
private val DATA_DECL = Regex("^\\s*//\\s*@matchi-data\\s+(\\S+)\\s*$")
private val DATA_PATH_CHARS = Regex("^/[A-Za-z0-9._/-]+$")
private val LOCAL_PROTECTED = setOf("tmp", "matchitool", "ufi_ttl", "ufi_dpi", "ufi_boot", "ufi_lock")
private val SDCARD_PROTECTED = setOf("download", "dcim", "pictures", "movies", "music", "documents", "android",
    "alarms", "notifications", "podcasts", "ringtones", "audiobooks", "recordings")
private val TMP_OWN = Regex("^\\.?(matchi|mt_|sqlite)")

/** The folder every plugin may use for its own data; it is erased automatically when the plugin is deleted. */
internal fun pluginDataDir(pluginName: String): String = "$MATCHI_DIR/plugin_data/" + pluginBaseName(pluginName)

/** Folders a plugin most likely made for itself: one named after the plugin inside /data/local, /data/local/tmp and /sdcard. Empty for short or odd names. */
internal fun implicitPluginPaths(pluginName: String): List<String> {
    val out = ArrayList<String>()
    for (base in pluginBaseNames(pluginName)) {
        if (!Regex("^[A-Za-z0-9._-]{4,60}$").matches(base) || base.startsWith(".") || base.contains("..")) continue
        for (p in listOf("/data/local/$base", "/data/local/tmp/$base", "/sdcard/$base")) out.add(p)
    }
    return out
}

/** Plugin names without the file ending (.js, .html or .txt). */
internal fun pluginBaseName(pluginName: String): String = pluginName.replace(Regex("\\.(js|html|txt)$"), "")

/** Names a plugin's leftovers may carry: its file name, and (UFI-TOOLS .html blocks end in "-1a2b3c") the name without that hash. */
internal fun pluginBaseNames(pluginName: String): List<String> {
    val base = pluginBaseName(pluginName)
    val bare = base.replace(Regex("-[0-9a-f]{6}$"), "")
    return if (bare != base) listOf(base, bare) else listOf(base)
}

private val LEFTOVER_EXTS = listOf("txt", "js", "html", "log", "json", "sh", "conf", "db", "csv")

/**
 * Loose files a plugin most likely made for itself: NAME.txt, NAME.js, NAME.html, NAME.log ... inside /data/local, /data/local/tmp and
 * /sdcard. Same rules as [implicitPluginPaths] (short or odd names give nothing); every path still goes through [checkPluginDataPath].
 */
internal fun implicitPluginFiles(pluginName: String): List<String> {
    val out = ArrayList<String>()
    for (base in pluginBaseNames(pluginName)) {
        if (!Regex("^[A-Za-z0-9._-]{4,60}$").matches(base) || base.startsWith(".") || base.contains("..")) continue
        for (dir in listOf("/data/local", "/data/local/tmp", "/sdcard")) for (e in LEFTOVER_EXTS) out.add("$dir/$base.$e")
    }
    return out
}

/** Paths a plugin asks to have erased: header lines of the form `// @matchi-data /path` (first 400 lines, at most 20). */
internal fun pluginDataDeclarations(code: String): List<String> =
    code.lineSequence().take(400).mapNotNull { DATA_DECL.find(it)?.groupValues?.get(1) }.distinct().take(20).toList()

private val UNINSTALL_DECL = Regex("^\\s*//\\s*@matchi-uninstall\\s+(\\S.*?)\\s*$")
private val CHECK_DECL = Regex("^\\s*//\\s*@matchi-check\\s+(\\S.*?)\\s*$")
private val BOOT_DECL = Regex("^\\s*//\\s*@matchi-boot\\s+(\\S+)\\s*$")
internal const val MAX_UNINSTALL_LINES = 10
internal const val MAX_UNINSTALL_LEN = 300   // same size as SBX_SHELL_MAX_LEN, so a sandboxed plugin can grant the same command with @matchi-needs shell:
internal const val MAX_BOOT_FILES = 5
private const val BOOT_PATH_MAX = 200

/** What a plugin declares for being stopped on delete: [commands] in order, one optional [check] command, and the [bootFiles] it creates. */
internal class UninstallDecls(val commands: List<String>, val check: String?, val bootFiles: List<String>) {
    val isEmpty: Boolean get() = commands.isEmpty()
}

/** True for a usable uninstall or check command: 1 to 300 characters and no control characters (the same rule sandboxNeeds applies to a shell command). */
private fun declaredCommandOk(c: String): Boolean = c.isNotEmpty() && c.length <= MAX_UNINSTALL_LEN && c.none { it.code < 32 || it.code == 127 }

/** True for a boot file path that is only READ (checked for existence): absolute, plain characters, no empty, . or .. parts, no trailing /. */
private fun declaredBootPathOk(p: String): Boolean =
    p.length <= BOOT_PATH_MAX && DATA_PATH_CHARS.matches(p) && p.split('/').drop(1).none { it.isEmpty() || it == "." || it == ".." }

/**
 * Header lines a plugin uses to say how to stop what it started, read from the first 400 lines (same as @matchi-data), each on a line of its own:
 *   // @matchi-uninstall COMMAND     (at most 10, in file order, duplicates dropped)
 *   // @matchi-check COMMAND         (at most 1: the first valid one)
 *   // @matchi-boot /path            (at most 5, duplicates dropped)
 * A line that breaks a rule (empty, over 300 characters, control characters, bad path) is dropped and does not count towards the limits.
 * Text that only mentions a header inside code (var s = '// @matchi-uninstall x') is not a header because the line must START with the comment.
 * This only reads the file: whether a command may run is decided later (shellDanger, the sandbox grant and the integrity state).
 */
internal fun pluginUninstallDeclarations(code: String): UninstallDecls {
    val commands = LinkedHashSet<String>()
    val bootFiles = LinkedHashSet<String>()
    var check: String? = null
    for (line in code.lineSequence().take(400)) {
        val u = UNINSTALL_DECL.find(line)?.groupValues?.get(1)
        if (u != null) { if (declaredCommandOk(u) && commands.size < MAX_UNINSTALL_LINES) commands.add(u); continue }
        val c = CHECK_DECL.find(line)?.groupValues?.get(1)
        if (c != null) { if (check == null && declaredCommandOk(c)) check = c; continue }
        val b = BOOT_DECL.find(line)?.groupValues?.get(1)
        if (b != null && declaredBootPathOk(b) && bootFiles.size < MAX_BOOT_FILES) bootFiles.add(b)
    }
    return UninstallDecls(commands.toList(), check, bootFiles.toList())
}

/** null when [path] may be erased on plugin delete, otherwise the reason it may not. Strict on purpose: it runs `rm -rf` as root. */
internal fun checkPluginDataPath(path: String, pluginName: String): String? {
    if (path.length > 200 || !DATA_PATH_CHARS.matches(path)) return "use only letters, digits . _ - and /"
    val parts = path.split('/').drop(1)
    if (parts.any { it.isEmpty() || it == "." || it == ".." }) return "no empty, . or .. parts and no trailing /"
    return when {
        // Only the plugin's own data folder (or something inside it): another plugin's data is never erased by this one.
        path.startsWith("$MATCHI_DIR/plugin_data/") -> {
            val own = pluginDataDir(pluginName)
            if (path == own || path.startsWith("$own/")) null else "a plugin may only erase its own data folder"
        }
        path.startsWith("$MATCHI_DIR/plugins/") -> "other plugins' files are protected"
        path == MATCHI_DIR || path.startsWith("$MATCHI_DIR/") -> "MatchiTOOL's own folder is protected"
        path.startsWith("/data/local/tmp/") ->
            if (parts.size < 4) "name a folder inside /data/local/tmp"
            else if (TMP_OWN.containsMatchIn(parts[3].lowercase())) "that name belongs to MatchiTOOL" else null
        path.startsWith("/data/local/") -> if (parts[2] in LOCAL_PROTECTED) "protected folder" else null
        path.startsWith("/sdcard/") || path.startsWith("/storage/emulated/0/") -> {
            val rest = if (path.startsWith("/sdcard/")) parts.drop(1) else parts.drop(3)
            when {
                rest.isEmpty() -> "name a folder inside it"
                rest[0].lowercase() == "android" -> "the Android folder is protected"
                rest.size == 1 && rest[0].lowercase() in SDCARD_PROTECTED -> "a standard folder is protected"
                else -> null
            }
        }
        else -> "only /data/local, /data/local/tmp and /sdcard may be erased"
    }
}

/**
 * Folders that must not be symlinks before [path] may be erased: every parent below the allowed root (/data/local, /sdcard or
 * /storage/emulated/0; the roots themselves are symlinks on some devices and are trusted). The path itself is not listed:
 * rm removes a final symlink without following it.
 */
internal fun symlinkAncestors(path: String): List<String> {
    val parts = path.split('/').drop(1)
    val rootDepth = when {
        path.startsWith("/sdcard/") -> 1
        path.startsWith("/storage/emulated/0/") -> 3
        path.startsWith("/data/local/") -> 2
        else -> return emptyList()
    }
    return (rootDepth + 1 until parts.size).map { "/" + parts.take(it).joinToString("/") }
}

/** Parent folders of [path] that may be removed when they are left empty, deepest first; stops at the first protected folder. */
internal fun prunableParents(path: String, pluginName: String): List<String> {
    val out = ArrayList<String>()
    var cur = path.substringBeforeLast('/', "")
    while (cur.isNotEmpty() && checkPluginDataPath(cur, pluginName) == null) { out.add(cur); cur = cur.substringBeforeLast('/', "") }
    return out
}

/** Free space needed before accepting a body of [len] bytes: the body itself plus [UPLOAD_RESERVE_BYTES] left for the system. */
internal const val UPLOAD_RESERVE_BYTES = 200L * 1024L * 1024L
internal fun uploadSpaceOk(freeBytes: Long, len: Long): Boolean = len >= 0 && freeBytes - len >= UPLOAD_RESERVE_BYTES

/** Four values returned together by the snapshot route. */
internal data class Quad<A, B, C, D>(val a: A, val b: B, val c: C, val d: D)

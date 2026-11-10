package com.matchi.tool

import java.io.File

/*
 * Plugin trace (1.4.1). The page tells the host which plugin sent a root command or an upload (header x-matchi-plugin, taken from the
 * plugin script's own stack frame). The host keeps a small ledger per plugin: the absolute paths its commands wrote to, the files it
 * uploaded, and a list of side effects that cannot be undone from here (firewall rules, boot script lines ...). Deleting the plugin
 * erases the ledger's paths too, after the same strict path check as every other erase (checkPluginDataPath) and after the user
 * confirmed the list. Everything in this file is plain Kotlin with no Android classes, so it is unit tested.
 *
 * It reads the command text, it does not run anything. A write it cannot see in the text (a path built inside a script file the plugin
 * wrote, a program that writes on its own) is not traced; that is the limit of the method, and the README says so.
 */

private const val SEP = "\u0001"
private val REDIR = Regex("^[0-9&]?>>?\\|?(.*)$")
private val ASSIGN = Regex("^([A-Za-z_][A-Za-z0-9_]*)=(.*)$")
private val SKIP_VERBS = setOf("nohup", "busybox", "toybox", "exec", "command", "env", "time", "sudo")
private val SHORT_O = Regex("^-[A-Za-z]*o$")
private val VAR_REF = Regex("\\$(?:\\{([A-Za-z_][A-Za-z0-9_]*)\\}|([A-Za-z_][A-Za-z0-9_]*))")

/** Splits a shell command into words (quotes removed). Operators ; | & ( ) ` and newlines become [SEP] between commands. */
internal fun shellTokens(cmd: String): List<String> {
    val out = ArrayList<String>()
    val cur = StringBuilder()
    var quote = '\u0000'
    var has = false
    var i = 0
    while (i < cmd.length) {
        val c = cmd[i]
        if (quote != '\u0000') {
            if (c == quote) quote = '\u0000'
            else if (c == '\\' && quote == '"' && i + 1 < cmd.length) { i++; cur.append(cmd[i]) }
            else cur.append(c)
        } else if (c == '\'' || c == '"') {
            quote = c; has = true
        } else if (c == '\\' && i + 1 < cmd.length) {
            i++; cur.append(cmd[i]); has = true
        } else if (c == '\n' || c == ';' || c == '|' || c == '(' || c == ')' || c == '`') {
            if (has || cur.isNotEmpty()) { out.add(cur.toString()); cur.setLength(0); has = false }
            out.add(SEP)
        } else if (c == '&') {
            val prevGt = i > 0 && cmd[i - 1] == '>'
            val nextGt = i + 1 < cmd.length && cmd[i + 1] == '>'
            if (prevGt || nextGt) cur.append(c)
            else {
                if (has || cur.isNotEmpty()) { out.add(cur.toString()); cur.setLength(0); has = false }
                out.add(SEP)
            }
        } else if (c.isWhitespace()) {
            if (has || cur.isNotEmpty()) { out.add(cur.toString()); cur.setLength(0); has = false }
        } else cur.append(c)
        i++
    }
    if (has || cur.isNotEmpty()) out.add(cur.toString())
    return out
}

private fun scanCommand(cmd: String, depth: Int, found: MutableSet<String>, vars: MutableMap<String, String>) {
    if (depth > 3) return
    var group = ArrayList<String>()
    for (t in shellTokens(cmd) + SEP) {
        if (t != SEP) { group.add(t); continue }
        if (group.isNotEmpty()) scanGroup(group, depth, found, vars)
        group = ArrayList()
    }
}

private fun scanGroup(words: List<String>, depth: Int, found: MutableSet<String>, vars: MutableMap<String, String>) {
    val args = ArrayList<String>()
    var i = 0
    while (i < words.size) {
        val w = words[i]
        val m = REDIR.find(w)
        if (m != null) {
            val rest = m.groupValues[1]
            if (rest.isNotEmpty()) found.add(rest)
            else if (i + 1 < words.size) { found.add(words[i + 1]); i++ }
        } else args.add(w)
        i++
    }
    while (args.isNotEmpty()) {
        val a = ASSIGN.find(args[0]) ?: break
        vars[a.groupValues[1]] = a.groupValues[2]
        args.removeAt(0)
    }
    while (args.isNotEmpty() && args[0].substringAfterLast('/') in SKIP_VERBS) args.removeAt(0)
    if (args.isEmpty()) return
    val verb = args[0].substringAfterLast('/')
    val rest = args.drop(1)
    val plain = rest.filter { !it.startsWith("-") }
    if (verb == "sh" || verb == "bash" || verb == "ash" || verb == "su") {
        val c = rest.indexOf("-c")
        if (c >= 0 && c + 1 < rest.size) scanCommand(rest[c + 1], depth + 1, found, vars)
        return
    }
    if (verb == "timeout") {
        val r = rest.dropWhile { it.startsWith("-") }.drop(1)
        if (r.isNotEmpty()) scanGroup(r, depth, found, vars)
        return
    }
    when (verb) {
        "mkdir", "touch", "tee" -> for (p in plain) found.add(p)   // relative names and unresolved $VARs are dropped at the end
        "cp", "mv", "install", "ln" -> if (plain.size >= 2) found.add(plain.last())
        "sqlite3" -> plain.firstOrNull { it.startsWith("/") || it.startsWith("$") }?.let { found.add(it) }
        "dd" -> for (a in rest) if (a.startsWith("of=")) found.add(a.removePrefix("of="))
        "curl" -> for (j in rest.indices) {
            val a = rest[j]
            if ((a == "-o" || a == "--output" || SHORT_O.matches(a)) && j + 1 < rest.size) found.add(rest[j + 1])
            else if (a.startsWith("--output=")) found.add(a.removePrefix("--output="))
            else if (a.startsWith("-o") && a.length > 2) found.add(a.substring(2))
        }
        "wget" -> for (j in rest.indices) {
            val a = rest[j]
            if ((a == "-O" || a == "-P") && j + 1 < rest.size) found.add(rest[j + 1])
            else if (a.startsWith("--output-document=")) found.add(a.removePrefix("--output-document="))
            else if (a.startsWith("-O") && a.length > 2) found.add(a.substring(2))
        }
        "unzip" -> for (j in rest.indices) if (rest[j] == "-d" && j + 1 < rest.size) found.add(rest[j + 1])
        "tar" -> for (j in rest.indices) {
            if (rest[j] == "-C" && j + 1 < rest.size) found.add(rest[j + 1])
            else if (rest[j].startsWith("--directory=")) found.add(rest[j].removePrefix("--directory="))
        }
        else -> {}
    }
}

private fun substVars(s: String, vars: Map<String, String>): String {
    var cur = s
    for (round in 0 until 2) {
        if (!cur.contains('$')) break
        cur = VAR_REF.replace(cur) { m ->
            val name = m.groupValues[1].ifEmpty { m.groupValues[2] }
            vars[name] ?: m.value
        }
    }
    return cur
}

/**
 * Absolute paths a shell command writes to (redirections, tee, mkdir, touch, cp/mv/install/ln destination, dd of=, curl -o, wget -O,
 * unzip -d, tar -C, sqlite3 file). Sources a command only reads are not listed. Simple NAME=/path variables are substituted; a path
 * that still holds $ or other odd characters is refused later by checkPluginDataPath. The caller must filter the result.
 */
internal fun pluginWriteTargets(command: String): List<String> {
    val found = LinkedHashSet<String>()
    val vars = HashMap<String, String>()
    scanCommand(command, 0, found, vars)
    return found.map { substVars(it, vars).trimEnd('/') }
        .filter { it.startsWith("/") && it.length <= 200 }
        .distinct()
}

/** Changes a command makes that deleting the plugin cannot undo by erasing files. Shown in the Delete dialog. */
internal fun pluginSideEffects(command: String): Set<String> {
    val c = command.lowercase()
    val out = LinkedHashSet<String>()
    if (Regex("\\b(iptables|ip6tables|nft)\\b").containsMatchIn(c)) out.add("firewall rules")
    if (Regex("\\b(ip rule|ip route|ip addr|ip link|ifconfig|route add)\\b").containsMatchIn(c)) out.add("network routes or addresses")
    if (Regex("\\b(setprop|resetprop)\\b").containsMatchIn(c)) out.add("system properties")
    if (Regex("\\bsettings\\s+put\\b").containsMatchIn(c)) out.add("Android settings")
    if (Regex("\\b(nohup|setsid)\\b|&\\s*\$").containsMatchIn(c)) out.add("background processes")
    if (c.contains("/data/local/matchitool/boot") || c.contains("ufi_tools_boot")) out.add("boot script lines")
    if (Regex("\\b(crontab|crond)\\b").containsMatchIn(c)) out.add("scheduled jobs")
    if (Regex("\\b(mount|umount)\\b").containsMatchIn(c)) out.add("mounts")
    if (Regex("\\bpm\\s+(disable|uninstall|install|grant|revoke)|\\bam\\s+force-stop").containsMatchIn(c)) out.add("app or package changes")
    if (Regex("(>|\\btee\\b)[^\\n]*/(proc|sys)/").containsMatchIn(c)) out.add("kernel or /sys settings")
    return out
}

/** One small text ledger per plugin: lines "P /path", "E side effect", "U uploaded-file-name". */
internal class PluginTraceStore(private val dir: File) {
    private val lock = Any()
    private val nameRx = Regex("^[A-Za-z0-9._-]{1,80}\\.(js|html)$")

    class Ledger(val paths: List<String>, val effects: List<String>, val uploads: List<String>)

    private fun fileFor(plugin: String): File? =
        if (nameRx.matches(plugin) && !plugin.contains("..")) File(dir, "$plugin.trace") else null

    fun record(plugin: String, paths: Collection<String>, effects: Collection<String>, uploads: Collection<String> = emptyList()) {
        val f = fileFor(plugin) ?: return
        if (paths.isEmpty() && effects.isEmpty() && uploads.isEmpty()) return
        synchronized(lock) {
            dir.mkdirs()
            val lines = LinkedHashSet<String>()
            if (f.isFile) for (l in f.readLines(Charsets.UTF_8)) if (l.length in 3..260) lines.add(l)
            val before = lines.size
            for (p in paths) lines.add("P $p")
            for (e in effects) lines.add("E $e")
            for (u in uploads) lines.add("U $u")
            if (lines.size == before) return
            f.writeText(lines.toList().takeLast(MAX_LINES).joinToString("\n") + "\n", Charsets.UTF_8)
        }
    }

    fun read(plugin: String): Ledger {
        val f = fileFor(plugin)
        if (f == null || !f.isFile) return Ledger(emptyList(), emptyList(), emptyList())
        val lines = synchronized(lock) { f.readLines(Charsets.UTF_8) }
        fun pick(tag: String) = lines.filter { it.startsWith("$tag ") }.map { it.substring(2) }.distinct()
        return Ledger(pick("P"), pick("E"), pick("U"))
    }

    fun clear(plugin: String) {
        val f = fileFor(plugin) ?: return
        synchronized(lock) { if (f.exists()) f.delete() }
    }

    companion object { const val MAX_LINES = 500 }
}

/** Plugin names the page may send in x-matchi-plugin. */
internal fun tracePluginName(raw: String?): String? {
    val n = raw?.trim() ?: return null
    return if (Regex("^[A-Za-z0-9._-]{1,80}\\.(js|html)$").matches(n) && !n.contains("..")) n else null
}

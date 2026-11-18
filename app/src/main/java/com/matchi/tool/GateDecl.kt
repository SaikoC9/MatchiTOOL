package com.matchi.tool

/*
 * Generic web gate: what a plugin may declare and which port MatchiTOOL gives it. Plain Kotlin with NO Android, JSON-library or
 * web-server-library imports, so scripts/kotlin_pure_tests.sh compiles it and GateDeclTest runs without the Android SDK.
 *
 * The declaration is read from the INSTALLED plugin file, never from a request, so a page cannot ask for an arbitrary port.
 * Header line (first 400 lines, must START with the comment, one line per plugin):
 *   // @matchi-gate name=adguard port=3000 logout=/control/logout idle=3600 tabclose=off
 * Only name and port are required. Anything else (unknown field, bad value, second line) makes the whole declaration invalid: fail closed.
 */

internal const val GATE_LISTEN_MIN = 3100
internal const val GATE_LISTEN_MAX = 3199
internal const val GATE_MAX_OPEN = 4
internal const val GATE_IDLE_DEFAULT_S = 3600
internal const val GATE_IDLE_MIN_S = 300
internal const val GATE_IDLE_MAX_S = 43200

internal class GateDecl(val name: String, val port: Int, val logout: String?, val idleS: Int, val tabClose: Boolean) {
    val idleMs: Long get() = idleS * 1000L
    /** Same target, same rules: a running gate with an equal declaration need not be restarted. */
    fun sameAs(o: GateDecl): Boolean = name == o.name && port == o.port && logout == o.logout && idleS == o.idleS && tabClose == o.tabClose
}

/** Exactly one of [decl] (usable) or [error] (why not) is set; both null means the plugin declares no gate. */
internal class GateParse(val decl: GateDecl?, val error: String?)

private val GATE_LINE = Regex("^\\s*//\\s*@matchi-gate(?:\\s+(.*?))?\\s*$")
private val GATE_NAME_RX = Regex("^[a-z0-9-]{1,32}$")
private val GATE_FIELDS = setOf("name", "port", "logout", "idle", "tabclose")

/** null when [port] may be the target of a gate, otherwise the reason. [consolePort] is the console's own port. */
internal fun gateTargetProblem(port: Int, consolePort: Int): String? = when {
    port !in 1024..65535 -> "port must be between 1024 and 65535"
    port == consolePort -> "port is the MatchiTOOL console itself"
    port in GATE_LISTEN_MIN..GATE_LISTEN_MAX -> "port $GATE_LISTEN_MIN-$GATE_LISTEN_MAX is reserved for the gates themselves"
    else -> null
}

/** Reads the @matchi-gate line of [code]. [consolePort] is checked against the target port. Never throws. */
internal fun parseGateDecl(code: String, consolePort: Int): GateParse {
    val lines = code.lineSequence().take(400).mapNotNull { GATE_LINE.find(it) }.toList()
    if (lines.isEmpty()) return GateParse(null, null)
    if (lines.size > 1) return GateParse(null, "only one @matchi-gate line is allowed")
    val rest = lines[0].groupValues[1]
    val f = LinkedHashMap<String, String>()
    for (tok in rest.split(Regex("\\s+")).filter { it.isNotEmpty() }) {
        val i = tok.indexOf('=')
        if (i <= 0 || i == tok.length - 1) return GateParse(null, "bad field \"$tok\" (use key=value)")
        val k = tok.substring(0, i)
        if (k !in GATE_FIELDS) return GateParse(null, "unknown field \"$k\"")
        if (f.put(k, tok.substring(i + 1)) != null) return GateParse(null, "field \"$k\" given twice")
    }
    val name = f["name"] ?: return GateParse(null, "name is required")
    if (!GATE_NAME_RX.matches(name)) return GateParse(null, "name may use a-z, 0-9 and - (1 to 32 characters)")
    val port = f["port"]?.takeIf { it.length <= 5 && it.all { c -> c in '0'..'9' } }?.toInt() ?: return GateParse(null, "port is required (a number)")
    gateTargetProblem(port, consolePort)?.let { return GateParse(null, it) }
    val logout = f["logout"]
    if (logout != null && (!logout.startsWith("/") || logout.startsWith("//") || logout.length > 200 || logout.any { it.code <= 32 || it.code == 127 }))
        return GateParse(null, "logout must be a path starting with / (no spaces, at most 200 characters)")
    val idle = if (f.containsKey("idle")) (f["idle"]!!.takeIf { it.length <= 6 && it.all { c -> c in '0'..'9' } }?.toInt() ?: return GateParse(null, "idle must be a number of seconds"))
        else GATE_IDLE_DEFAULT_S
    if (idle !in GATE_IDLE_MIN_S..GATE_IDLE_MAX_S) return GateParse(null, "idle must be between $GATE_IDLE_MIN_S and $GATE_IDLE_MAX_S seconds")
    val tc = when (f["tabclose"]) { null, "off" -> false; "on" -> true; else -> return GateParse(null, "tabclose must be on or off") }
    return GateParse(GateDecl(name, port, logout, idle, tc), null)
}

/**
 * Upload check: null when the plugin file [fileName] with text [code] may be installed as far as @matchi-gate goes, otherwise the reason.
 * A plugin without the line is fine. A broken line (bad port, unknown field, second line) is refused at upload, so the author sees it at once and
 * not only when Open is pressed. Only .js plugins can declare a gate; the same line in an .html plugin would do nothing, so it is refused too.
 */
internal fun gateUploadProblem(fileName: String, code: String, consolePort: Int): String? {
    val r = parseGateDecl(code, consolePort)
    if (r.error != null) return "invalid @matchi-gate line: ${r.error}"
    if (r.decl != null && !fileName.endsWith(".js")) return "@matchi-gate works only in .js plugins"
    return null
}

/**
 * Which listen port each gate name gets: the lowest free port of 3100-3199, remembered per name so the address stays the same between
 * runs. [saved] is the stored name -> port map (the caller persists [encode] after a change). Not thread safe: the caller locks.
 */
internal class GatePortTable(saved: Map<String, Int> = emptyMap()) {
    private val map = LinkedHashMap<String, Int>()
    init { for ((n, p) in saved) if (GATE_NAME_RX.matches(n) && p in GATE_LISTEN_MIN..GATE_LISTEN_MAX && p !in map.values) map[n] = p }

    fun snapshot(): Map<String, Int> = LinkedHashMap(map)

    /** The port for [name]; a port in [skip] (for example one that could not be bound) is never returned. Null when the range is full. */
    fun portFor(name: String, skip: Set<Int> = emptySet()): Int? {
        val have = map[name]
        if (have != null && have !in skip) return have
        val used = map.filter { it.key != name }.values.toSet()
        val p = (GATE_LISTEN_MIN..GATE_LISTEN_MAX).firstOrNull { it !in used && it !in skip } ?: return null
        map[name] = p
        return p
    }

    fun forget(name: String) { map.remove(name) }

    companion object {
        /** "name=port,name=port" - plain text, no JSON library needed. */
        fun encode(m: Map<String, Int>): String = m.entries.joinToString(",") { "${it.key}=${it.value}" }
        fun decode(raw: String?): Map<String, Int> {
            val out = LinkedHashMap<String, Int>()
            for (part in (raw ?: "").split(',')) {
                val i = part.indexOf('='); if (i <= 0) continue
                val p = part.substring(i + 1).toIntOrNull() ?: continue
                out[part.substring(0, i)] = p
            }
            return out
        }
    }
}

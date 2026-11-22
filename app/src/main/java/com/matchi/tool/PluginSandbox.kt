package com.matchi.tool

/*
 * Sandboxed plugins. Plain Kotlin, no Android classes, so it is unit tested.
 *
 * A plugin switched to "sandbox" does not run in the console page. The page puts it in an iframe without allow-same-origin, so it has no
 * session, no page DOM and no /api access, and talks to the page only through a message bridge (web-src/plugin-sandbox.js). The bridge
 * offers a few helpers; the ones that reach the device are granted only when the plugin DECLARED them in its first lines:
 *
 *     // @matchi-needs at.read                 read-only AT queries (AT+CSQ, AT+COPS? ...)
 *     // @matchi-needs router: lan_ipaddr,signalbar   read these router fields
 *     // @matchi-needs shell: cat /proc/uptime        this exact root command, nothing else
 *     // @matchi-needs net: api.example.com           browser requests to this host
 *
 * and the person approved them (switching the mode asks for the password). The approved list is stored with the plugin's SHA-256
 * (PluginRecord.caps, entries start with "sbx:"). If the file later differs from the approved bytes the plugin still runs, with none of these.
 *
 * Limits, stated plainly: the page's bridge makes the first check and the host repeats it for every call (sandboxCallError);
 * the frame's own policy only allows the approved https hosts, and the page's policy keeps the frame from navigating to another site (frame-src
 * falls back to default-src 'self'; seen in Chromium, other browsers may differ), but it can still load a page of this host, which gets no bridge;
 * a permitted host (net:) is a place data can go; the permission lines are read from the source text and an unknown or refused line grants nothing.
 */

internal const val SBX_PREFIX = "sbx:"
internal const val SBX_AT = "sbx:at.read"
internal const val SBX_ROUTER = "sbx:router:"
internal const val SBX_SHELL = "sbx:shell:"
internal const val SBX_NET = "sbx:net:"

internal const val SBX_MAX_ROUTER = 20
internal const val SBX_MAX_SHELL = 10
internal const val SBX_MAX_NET = 10
internal const val SBX_SHELL_MAX_LEN = 300

/** What a plugin's header asks for: [caps] are the valid requests ("sbx:..."), [problems] the lines that were refused (they grant nothing). */
internal class SandboxNeeds(val caps: List<String>, val problems: List<String>)

private val NEEDS_DECL = Regex("^\\s*(?://+|/?\\*+|#)?\\s*@matchi-needs\\s+(\\S.*?)\\s*$")
private val ROUTER_FIELD = Regex("^[A-Za-z0-9_]{1,60}$")
private val NET_HOST = Regex("^[a-z0-9](?:[a-z0-9.-]{0,98}[a-z0-9])?$")

/**
 * Reads the `@matchi-needs` lines from the first 80 lines of [code]. [shellProblem] is asked about every declared shell command and returns
 * a reason to refuse it (the caller passes shellDanger; it is a parameter so this file needs no other file). A shell command is matched
 * EXACTLY at run time: no arguments can be added to it.
 */
internal fun sandboxNeeds(code: String, shellProblem: (String) -> String? = { null }): SandboxNeeds {
    var at = false
    val router = java.util.TreeSet<String>()
    val shell = LinkedHashSet<String>()
    val net = java.util.TreeSet<String>()
    val problems = ArrayList<String>()
    for (line in code.lineSequence().take(80)) {
        val spec = NEEDS_DECL.find(line)?.groupValues?.get(1) ?: continue
        val kind = spec.substringBefore(':').trim().lowercase()
        val value = if (spec.contains(':')) spec.substringAfter(':').trim() else ""
        when (kind) {
            "at.read" -> if (value.isEmpty()) at = true else problems.add("at.read takes no value")
            "router" -> {
                val names = value.split(',').map { it.trim() }.filter { it.isNotEmpty() }
                if (names.isEmpty()) problems.add("router needs field names, for example: router: signalbar,lan_ipaddr")
                for (n in names) {
                    if (!ROUTER_FIELD.matches(n)) problems.add("router field \"${n.take(30)}\" is not allowed (letters, digits and _ only)")
                    else if (n !in router && router.size >= SBX_MAX_ROUTER) problems.add("at most $SBX_MAX_ROUTER router fields")
                    else router.add(n)
                }
            }
            "shell" -> {
                val why: String? = when {
                    value.isEmpty() -> "shell needs a command"
                    value.length > SBX_SHELL_MAX_LEN -> "a shell command is longer than $SBX_SHELL_MAX_LEN characters"
                    value.any { it.code < 32 || it.code == 127 } -> "a shell command may not hold control characters"
                    else -> shellProblem(value)?.let { "shell command refused ($it)" }
                }
                if (why != null) problems.add(why)
                else if (value !in shell && shell.size >= SBX_MAX_SHELL) problems.add("at most $SBX_MAX_SHELL shell commands")
                else shell.add(value)
            }
            "net" -> {
                val h = value.lowercase().removePrefix("https://").trimEnd('/')
                if (!NET_HOST.matches(h) || h.contains("..")) problems.add("net host \"${value.take(40)}\" is not a plain host name")
                else if (h !in net && net.size >= SBX_MAX_NET) problems.add("at most $SBX_MAX_NET hosts")
                else net.add(h)
            }
            else -> problems.add("unknown need \"${kind.take(30)}\"")
        }
    }
    val caps = ArrayList<String>()
    if (at) caps.add(SBX_AT)
    for (n in router) caps.add(SBX_ROUTER + n)
    for (c in shell) caps.add(SBX_SHELL + c)
    for (h in net) caps.add(SBX_NET + h)
    return SandboxNeeds(caps, problems)
}

/** The capability list stored with a plugin and compared on update: the sandbox permissions when it runs sandboxed, otherwise the text-search list. Both end with the plugin's uninstall commands ("unin:"); sandboxGrant ignores them, only "sbx:" entries grant anything. */
internal fun effectiveCaps(code: String, hosts: List<String>, sandboxed: Boolean, shellProblem: (String) -> String? = { null }): List<String> =
    if (sandboxed) sandboxNeeds(code, shellProblem).caps + uninstallCaps(code) else pluginCaps(code, hosts)

/** What the bridge may grant right now: the approved "sbx:" entries, and only while the file is exactly the approved one. */
internal fun sandboxGrant(approvedCaps: List<String>?, integrity: String): List<String> =
    if (integrity == "ok") (approvedCaps ?: emptyList()).filter { it.startsWith(SBX_PREFIX) } else emptyList()

/** One plain line for a sandbox permission, for the confirm dialog. */
internal fun describeSandboxCap(cap: String): String = when {
    cap == SBX_AT -> "in the sandbox: reads the modem with read-only AT commands"
    cap.startsWith(SBX_ROUTER) -> "in the sandbox: reads router field " + cap.removePrefix(SBX_ROUTER)
    cap.startsWith(SBX_SHELL) -> "in the sandbox: runs this root command: " + cap.removePrefix(SBX_SHELL)
    cap.startsWith(SBX_NET) -> "in the sandbox: contacts " + cap.removePrefix(SBX_NET)
    else -> cap
}

/**
 * The host's own decision about one call a sandboxed plugin made through the page's bridge (POST /api/plugins/call). [grant] is
 * sandboxGrant(...) computed from the stored record AT THE TIME OF THE CALL, so a file that changed after the page loaded gets nothing.
 * Returns null when the call may run, otherwise the reason. [args] are the call's string arguments (at: one command, router.get: field
 * names, shell: one command). The page makes the same check first (plugin-sandbox.js, sbxAuthorize) so a refusal usually comes back early;
 * this one is the authority.
 */
internal fun sandboxCallError(grant: List<String>, op: String, args: List<String>): String? = when (op) {
    "at" -> when {
        SBX_AT !in grant -> "Denied: \"at.read\" not declared."
        args.size != 1 || !RootGate.isReadOnlyAt(args[0]) -> "Read-only AT commands only."
        else -> null
    }
    "router.get" -> {
        val allowed = grant.filter { it.startsWith(SBX_ROUTER) }.map { it.removePrefix(SBX_ROUTER) }.toSet()
        when {
            allowed.isEmpty() -> "not approved: this plugin did not declare any router field"
            args.isEmpty() || args.size > SBX_MAX_ROUTER -> "ask for 1 to $SBX_MAX_ROUTER router fields"
            args.any { it.trim() !in allowed } -> "a router field was not approved"
            else -> null
        }
    }
    "shell" ->
        if (args.size == 1 && (SBX_SHELL + args[0]) in grant) null
        else "Denied: only declared \"shell:\" commands may run."
    else -> "unknown operation"
}

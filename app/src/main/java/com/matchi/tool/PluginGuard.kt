package com.matchi.tool

/*
 * Plugin guard (1.4.2). Three layers, all plain Kotlin with no Android classes, so they are unit tested:
 *
 *  1. scanPlugin: reads a plugin's source when it is installed. Clearly malicious code (reverse shells, download-and-run,
 *     wiping the device, stealing the sign-in token, hidden eval) is refused unless the person confirms; everything else is
 *     reported as a warning.
 *  2. NetPolicy: the browser enforces it through the page's Content-Security-Policy. In strict mode a plugin can only contact
 *     the hosts on the allow-list, which stops fetch, XHR, WebSocket, EventSource, beacons and image pings to anywhere else.
 *  3. shellDanger: root commands that are clearly destructive or open a remote shell are refused by the host. A command a
 *     plugin sent (header x-matchi-plugin) is held to a stricter list than one typed in the console.
 *
 * The network policy limits the BROWSER page only. It does not limit what a plugin runs through the root shell (the bundled curl can
 * upload to any host), and a CSP does not cover page navigation (location.href) either.
 *
 * Limits, stated plainly: plugins still run inside the page, so a plugin that is allowed to reach a host can send data there;
 * the scan cannot see code that is built at run time; and the x-matchi-plugin header comes from the page, so a plugin that
 * bypasses the page's helpers is only held to the shorter "any source" shell list. Review a plugin before you install it.
 */

internal class ScanFinding(val level: String, val code: String, val message: String)

internal class ScanResult(val findings: List<ScanFinding>, val hosts: List<String>) {
    val blocked: Boolean get() = findings.any { it.level == "block" }
    val risk: String get() = when {
        blocked -> "block"
        findings.any { it.level == "warn" } -> "warn"
        else -> "ok"
    }
}

private class ScanRule(val level: String, val code: String, val message: String, pattern: String, ignoreCase: Boolean = false) {
    val rx: Regex = if (ignoreCase) Regex(pattern, RegexOption.IGNORE_CASE) else Regex(pattern)
}

private val SCAN_RULES = listOf(
    ScanRule("block", "token", "Reads the sign-in token (matchi_token)", """matchi_token"""),
    ScanRule("block", "evalobf", "Runs hidden code (eval or Function on decoded text)", """\b(?:eval|Function)\s*\(\s*(?:atob|unescape|decodeURIComponent|String\.fromCharCode)\b"""),
    ScanRule("block", "revshell", "Opens a remote shell", """/dev/(?:tcp|udp)/|\bbash\s+-i\b|\b(?:nc|ncat|netcat)\b[^\n]{0,80}\s-[a-z]*e\b|\bmkfifo\b[^\n]{0,120}\b(?:nc|ncat|telnet)\b"""),
    ScanRule("block", "pipeshell", "Downloads a script and runs it", """\b(?:curl|wget)\b[^\n|]{0,300}\|\s*(?:su\s+-c\s+)?(?:sh|bash|ash)\b"""),
    ScanRule("block", "wipe", "Wipes a system or data folder", """\brm\s+(?:-[A-Za-z-]+\s+)+(?:/|/\*|/data|/data/\*|/system|/sdcard|/data/data)(?:\s|;|&|\||'|"|`|\\|\z)"""),
    ScanRule("block", "selfremove", "Removes or disables MatchiTOOL itself", """\bpm\s+(?:uninstall|disable|disable-user|clear)\b[^\n]{0,80}com\.matchi\.tool"""),
    ScanRule("block", "diskwrite", "Writes raw to a disk or formats one", """\bdd\b[^\n]{0,200}\bof=/dev/(?:block|mmcblk|mtd)|\bmkfs"""),
    ScanRule("warn", "eval", "Runs code built at run time", """\beval\s*\(|\bnew\s+Function\s*\("""),
    ScanRule("warn", "tokenid", "Mentions the sign-in token", """\bTOKEN\b|x-token"""),
    ScanRule("warn", "cookie", "Reads document.cookie", """document\.cookie"""),
    ScanRule("warn", "image", "Creates Image objects (can leak data in the address)", """\bnew\s+Image\s*\("""),
    ScanRule("warn", "inject", "Adds script, frame or form elements, or imports code", """createElement\(\s*['"](?:script|iframe|link|form)['"]\s*\)|\bimport\s*\("""),
    ScanRule("warn", "blob", "Contains a long encoded blob", """(?<![A-Za-z0-9+/=])(?<!base64,)[A-Za-z0-9+/=]{400,}"""),
    ScanRule("warn", "escapes", "Contains long runs of escaped characters", """(?:\\x[0-9a-fA-F]{2}){40,}|(?:\\u[0-9a-fA-F]{4}){30,}"""),
    ScanRule("info", "net", "Makes network requests", """\b(?:fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts)\b"""),
    ScanRule("info", "root", "Runs commands on the device", """/api/(?:shell|root_shell|user_shell)"""),
)

private val URL_HOST = Regex("""https?://([A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9])""")
private val BENIGN_HOSTS = setOf("www.w3.org", "w3.org", "example.com", "www.example.com")

/** Scans plugin source. [extraHosts] are the hosts the person added to the network allow-list. Never runs the code. */
internal fun scanPlugin(code: String, extraHosts: List<String>): ScanResult {
    val src = if (code.length > 1_048_576) code.substring(0, 1_048_576) else code
    val findings = ArrayList<ScanFinding>()
    for (r in SCAN_RULES) if (r.rx.containsMatchIn(src)) findings.add(ScanFinding(r.level, r.code, r.message))
    val hosts = LinkedHashSet<String>()
    for (m in URL_HOST.findAll(src)) {
        val h = m.groupValues[1].lowercase()
        if (h !in BENIGN_HOSTS) hosts.add(h)
        if (hosts.size >= 30) break
    }
    val allowed = NetPolicy.allowedHosts(extraHosts)
    for (h in hosts) if (!NetPolicy.hostAllowed(h, allowed))
        findings.add(ScanFinding("warn", "host", "Contacts $h, which the network rules block unless you allow it"))
    return ScanResult(findings, hosts.toList())
}

/** The network allow-list that becomes the page's Content-Security-Policy. */
internal object NetPolicy {
    /**
     * What MatchiTOOL's own page needs in the browser: the plugin store mirror and GitHub (store files are often linked there, and a
     * github.com link redirects to the other GitHub hosts, which the policy checks too). Nothing else is on the list on purpose: each
     * host is a place a plugin's data can go. dns.google was removed in 1.4.2+ because a DNS-over-HTTPS resolver lets a plugin leak
     * data in a host name. The public-IP check in the page runs as a root shell script (curl on the device), so it never used the
     * browser policy; checkip.amazonaws.com, api.ipify.org and www.cloudflare.com were removed with it. A plugin of your own that needs
     * one of them can be added under Plugins > Network rules.
     */
    val DEFAULT_HOSTS = listOf(
        "raw.githubusercontent.com", "github.com", "api.github.com", "objects.githubusercontent.com",
    )

    private val ENTRY = Regex("""^(?:https?://)?(?:\*\.)?[a-z0-9](?:[a-z0-9.-]{0,98}[a-z0-9])?(?::[0-9]{1,5})?$""")

    /** A cleaned allow-list entry (host, host:port, http(s)://host, *.domain), or null when it is not acceptable. */
    fun cleanEntry(raw: String): String? {
        val e = raw.trim().lowercase()
        if (e.isEmpty() || e.length > 110 || !ENTRY.matches(e) || e.contains("..")) return null
        val bare = e.substringAfter("://").substringBefore(':')
        if (bare.startsWith("*.") && !bare.substring(2).contains('.')) return null   // "*.com" would allow a whole top-level domain
        return e
    }

    fun cleanList(raw: List<String>): List<String> = raw.mapNotNull { cleanEntry(it) }.distinct().take(50)

    fun allowedHosts(extra: List<String>): List<String> = (DEFAULT_HOSTS + extra).distinct()

    /** True when [host] (no scheme, no port) matches one of [entries]. */
    fun hostAllowed(host: String, entries: List<String>): Boolean {
        val h = host.lowercase()
        for (e in entries) {
            val bare = e.substringAfter("://").substringBefore(':')
            if (bare.startsWith("*.")) { if (h.endsWith(bare.substring(1))) return true }
            else if (h == bare) return true
        }
        return false
    }

    /** The page's Content-Security-Policy. Strict: connections and images only to 'self' and the allow-list. Open: the old behaviour. */
    fun csp(extra: List<String>, strict: Boolean): String {
        val hosts = allowedHosts(extra).joinToString(" ")
        val connect = if (strict) "'self' $hosts" else "'self' http: https:"
        val img = if (strict) "'self' data: blob: $hosts" else "'self' data: blob: https:"
        return "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; " +
            "img-src $img; media-src 'self' data: blob:; font-src 'self' data:; connect-src $connect; " +
            "object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
    }

    /** Reads the saved extra hosts (a JSON array). Bad input gives an empty list. */
    fun parse(raw: String?): List<String> = try {
        val a = org.json.JSONArray(raw ?: "[]")
        cleanList((0 until a.length()).map { a.optString(it) })
    } catch (_: Exception) { emptyList() }
}

private class ShellRule(val message: String, pattern: String) { val rx = Regex(pattern) }

// Matched against the command after quotes and backslashes are removed, spaces are squeezed and letters are lower-cased.
private val SHELL_ALWAYS = listOf(
    ShellRule("opens a remote shell", """/dev/(?:tcp|udp)/|\bbash -i\b|\b(?:nc|ncat|netcat) [^;|&]{0,80}-[a-z]*e\b|\bmkfifo\b[^;]{0,120}\b(?:nc|ncat|telnet)\b|\bsocat\b[^;]{0,120}\bexec"""),
    ShellRule("downloads a script and runs it", """\b(?:curl|wget)\b[^;|&]{0,300}\| ?(?:su -c )?(?:sh|bash|ash)\b|\b(?:sh|bash|ash) <\( ?(?:curl|wget)|\b(?:sh|bash|ash) -c [$]\( ?(?:curl|wget)"""),
    ShellRule("wipes a system or data folder", """\brm (?:-[a-z-]+ )+(?:/|/\*|/data|/data/\*|/system|/sdcard|/data/data|/data/data/com\.matchi\.tool[^ ]*)(?: |;|&|\||\)|`|\z)"""),
    ShellRule("removes or disables MatchiTOOL itself", """\bpm (?:uninstall|disable|disable-user|clear)\b[^;|&]{0,80}com\.matchi\.tool"""),
)

private val SHELL_PLUGIN = listOf(
    ShellRule("writes raw to a disk or flash device", """\bdd\b[^;|&]{0,200}\bof=/dev/|\bmkfs|\bflash_erase\b|\bfastboot\b"""),
    ShellRule("writes to a system partition", """>>? ?/(?:system|vendor|boot|dev/block)|\btee (?:-a )?/(?:system|vendor|dev/block)"""),
    ShellRule("remounts a partition", """\bmount\b[^;|&]{0,80}\bremount\b"""),
    ShellRule("reboots into the bootloader or recovery", """\breboot (?:bootloader|recovery)\b|\breboot-bootloader\b"""),
    ShellRule("opens permissions on a system folder", """\bchmod (?:-[a-z]+ )*[0-7]*777 /(?: |\z|data |system )"""),
)

/** null when the command may run, otherwise a short reason. [fromPlugin] is true when the page says a plugin sent it. */
internal fun shellDanger(command: String, fromPlugin: Boolean): String? {
    val c = command.replace(Regex("""['"\\]"""), "").replace(Regex("""\s+"""), " ").lowercase()
    for (r in SHELL_ALWAYS) if (r.rx.containsMatchIn(c)) return r.message
    if (fromPlugin) for (r in SHELL_PLUGIN) if (r.rx.containsMatchIn(c)) return r.message
    return null
}

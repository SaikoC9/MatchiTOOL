package com.matchi.tool

import java.security.MessageDigest

/*
 * Plugin integrity (Phase 1 and 2 of MatchiTOOL_plugin_security_plan.txt). Plain Kotlin, no Android classes, so it is unit tested.
 *
 * What it is: tamper EVIDENCE. The host remembers the SHA-256 and the capability list of each plugin as it was approved. A file that
 * later differs is flagged. It does not stop a plugin that is already running with root: root can edit the stored record too.
 * The capability list comes from a text search (like scanPlugin), so code that builds strings at run time is not covered.
 */

internal const val CAP_ROOT = "root"
internal const val CAP_NET = "net"
internal const val CAP_TOKEN = "token"
internal const val CAP_HOST_PREFIX = "host:"

/** What the host remembers about an approved plugin: its SHA-256 and the capabilities the person was shown. */
internal class PluginRecord(val sha: String, val caps: List<String>)

private val CAP_ROOT_RX = Regex("""runShellWithRoot|/api/(?:shell|root_shell|one_click_shell)\b""")
private val CAP_NET_RX = Regex("""\b(?:fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts)\b""")
private val CAP_TOKEN_RX = Regex("""matchi_token|\bTOKEN\b|x-token""")

/** SHA-256 of [bytes] as 64 lower-case hex characters. */
internal fun sha256Hex(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

/** The capabilities a plugin's source shows: root commands, network use, token mention, and one entry per host it names. [hosts] comes from scanPlugin. */
internal fun pluginCaps(code: String, hosts: List<String>): List<String> {
    val src = if (code.length > 1_048_576) code.substring(0, 1_048_576) else code
    val out = ArrayList<String>()
    if (CAP_ROOT_RX.containsMatchIn(src)) out.add(CAP_ROOT)
    if (CAP_NET_RX.containsMatchIn(src)) out.add(CAP_NET)
    if (CAP_TOKEN_RX.containsMatchIn(src)) out.add(CAP_TOKEN)
    for (h in hosts.map { it.lowercase() }.distinct().sorted()) out.add(CAP_HOST_PREFIX + h)
    return out
}

/** Capabilities in [now] that were not in [approved]. */
internal fun addedCaps(approved: List<String>, now: List<String>): List<String> = now.filter { it !in approved }

/** "untracked" (no record), "ok" (same bytes as approved) or "changed". */
internal fun integrityState(approvedSha: String?, currentSha: String): String = when {
    approvedSha.isNullOrEmpty() -> "untracked"
    approvedSha == currentSha -> "ok"
    else -> "changed"
}

/** One plain line for a capability, for the confirm dialog. */
internal fun describeCap(cap: String): String = when {
    cap == CAP_ROOT -> "runs root commands"
    cap == CAP_NET -> "makes network requests"
    cap == CAP_TOKEN -> "mentions the sign-in token"
    cap.startsWith(CAP_HOST_PREFIX) -> "contacts " + cap.removePrefix(CAP_HOST_PREFIX)
    cap.startsWith(SBX_PREFIX) -> describeSandboxCap(cap)
    else -> cap
}

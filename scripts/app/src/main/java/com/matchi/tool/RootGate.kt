package com.matchi.tool

/**
 * Decisions for calls that run as root (or make root run something). Kept free of Android classes so they can be
 * unit tested; [WebServer] applies them in one place for every such call.
 */
object RootGate {
    /** A sign-in must be younger than this for root-capable calls (README: "Root commands additionally need a sign-in younger than 4 h"). */
    const val MAX_SESSION_MS = 4L * 60 * 60 * 1000

    /** True when the session is known and young enough. */
    fun freshEnough(ageMs: Long?, maxMs: Long = MAX_SESSION_MS): Boolean = ageMs != null && ageMs >= 0 && ageMs <= maxMs

    /** True when the page must confirm "this connection is not encrypted" first (plain HTTP from another device, no confirm header). */
    fun insecureNeedsConfirm(tlsActive: Boolean, loopback: Boolean, confirmHeader: String?): Boolean =
        !tlsActive && !loopback && confirmHeader != "1"

    private val queryRx = Regex("^AT(\\+[A-Z0-9_]+)?(\\?|=\\?)$", RegexOption.IGNORE_CASE)
    private val bareReads = setOf("AT", "ATI", "AT+CSQ", "AT+CESQ", "AT+CGSN", "AT+CIMI", "AT+CCID", "AT+CNUM", "AT+CGMR", "AT+CGMM", "AT+CGMI")

    /**
     * True for AT commands that only read state (queries such as AT+COPS? / AT+CGMR=? and a few fixed read commands). The
     * Live Status and AT Radio pages poll these constantly, so they do not need a fresh sign-in; anything else
     * (AT+CFUN=1, AT+EGMR=..., AT^..., chained commands) does.
     */
    fun isReadOnlyAt(cmd: String): Boolean {
        val c = cmd.trim()
        if (c.isEmpty() || c.length > 64) return false
        return c.uppercase() in bareReads || queryRx.matches(c)
    }
}

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

    /**
     * True when root actions must be refused outright: plain HTTP from another device, and the owner has not switched
     * "Root over HTTP" on. Loopback (apps on the phone itself) and HTTPS are never refused here.
     */
    fun insecureRefused(tlsActive: Boolean, loopback: Boolean, allowOverHttp: Boolean): Boolean =
        !tlsActive && !loopback && !allowOverHttp

    /** What [decide] answers when a root-capable call must be turned away. [code] is the one the page handles. */
    enum class Refusal(val code: String) { INSECURE_OFF("insecure-off"), INSECURE("insecure"), REAUTH("reauth") }

    /**
     * The whole root gate in one place, in the order the checks run: plain HTTP refused outright (unless the owner allowed it),
     * then plain HTTP needs the page's confirmation, then the sign-in must be young enough. Null means the call may go on.
     * WebServer.rootGate only turns the answer into the 403 reply, so this order is what the unit tests pin down.
     */
    fun decide(tlsActive: Boolean, loopback: Boolean, allowOverHttp: Boolean, confirmHeader: String?, sessionAgeMs: Long?, maxMs: Long = MAX_SESSION_MS): Refusal? = when {
        insecureRefused(tlsActive, loopback, allowOverHttp) -> Refusal.INSECURE_OFF
        insecureNeedsConfirm(tlsActive, loopback, confirmHeader) -> Refusal.INSECURE
        !freshEnough(sessionAgeMs, maxMs) -> Refusal.REAUTH
        else -> null
    }

    // The exact read-only listing of Android's SMS store that the SMS tool's background check sends through /api/shell (about every 3 minutes
    // in modem mode). Anything that adds a pipe, a second command, an insert / delete / update or another URI does not match.
    private val smsListRx = Regex("^content query --uri content://sms --projection [a-z_]+(:[a-z_]+)* --sort \"date DESC\" 2>&1 \\| head -c [0-9]{1,7}$")

    /**
     * True when [cmd] is only that read-only listing of Android's SMS store. /api/shell writes one audit line per call; the background check
     * would fill the size-capped audit log (and push failed logins, password and update changes out of it), so these calls use the
     * once-per-minute audit line instead. Exact match only: a plugin cannot hide another shell command behind this.
     */
    fun isSmsListRead(cmd: String): Boolean = cmd.length <= 200 && smsListRx.matches(cmd.trim())

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

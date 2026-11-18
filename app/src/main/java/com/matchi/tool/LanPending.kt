package com.matchi.tool

import org.json.JSONObject

/**
 * Router IP change: the "pending change" note and the decision made about it after the router restarted. Pure Kotlin
 * (org.json only), no Android classes, unit tested (LanPendingTest). The note is written by the page through the root shell BEFORE the
 * DHCP_SETTING call is sent (same JSON as lan_backup.json) and read by [LanRevert] after the restart, because the restart ends the
 * running app, so the revert cannot be a timer in the page or in the app.
 *
 * Decision, in order: a note older than [MAX_AGE_MS] is dropped; the new address answers and the router reports the wanted IP, mask,
 * pool, lease and DHCP On -> keep it; it answers but reports something else -> put the old values back (through the address that
 * answers); only the old address answers -> the change never took effect, go back to the old address; nothing answers yet -> wait,
 * and at the end of the wait keep the note (nothing can be written to a router that does not answer).
 */
object LanPending {
    const val PATH = "/data/local/matchitool/lan_pending.json"
    /** A note older than this is stale: it is deleted and nothing is acted on. */
    const val MAX_AGE_MS = 30L * 60_000L
    const val READ_CMD = "lan_ipaddr,lan_netmask,dhcpEnabled,dhcpStart,dhcpEnd,dhcpLease_hour"

    data class Snap(val ip: String, val mask: String, val start: String, val end: String, val lease: Int)
    data class Note(val old: Snap, val new: Snap, val at: Long)
    data class Seen(val ip: String?, val mask: String?, val dhcpOn: Boolean, val start: String?, val end: String?, val lease: Int?)
    enum class Verdict { EXPIRED, KEEP_NEW, REVERT, USE_OLD, WAIT, GIVE_UP }

    private val v4 = Regex("^(0|[1-9][0-9]{0,2})\\.(0|[1-9][0-9]{0,2})\\.(0|[1-9][0-9]{0,2})\\.(0|[1-9][0-9]{0,2})$")
    private fun ipOk(t: String?): Boolean { val m = t?.let { v4.matchEntire(it) } ?: return false; return (1..4).all { m.groupValues[it].toInt() <= 255 } }
    private fun addrOk(t: String?) = ipOk(t) && RouterHost.isValid(t!!)

    private fun snap(o: JSONObject?): Snap? {
        o ?: return null
        val ip = o.optString("ip"); val mask = o.optString("mask"); val a = o.optString("start"); val b = o.optString("end"); val lease = o.optInt("lease", -1)
        if (!addrOk(ip) || !ipOk(mask) || !ipOk(a) || !ipOk(b) || lease !in 1..9999) return null
        return Snap(ip, mask, a, b, lease)
    }

    /** The note's text -> Note, or null for anything that is not a complete, well-formed note. */
    fun parse(text: String?): Note? {
        val j = try { JSONObject((text ?: "").trim()) } catch (_: Exception) { return null }
        val old = snap(j.optJSONObject("old")) ?: return null
        val new = snap(j.optJSONObject("new")) ?: return null
        val at = j.optLong("at", 0L)
        return Note(old, new, at)
    }

    /** The router's reply to a get of [READ_CMD] -> Seen, or null when it is not a JSON object. */
    fun seenFrom(body: String?): Seen? {
        val j = try { JSONObject((body ?: "").trim()) } catch (_: Exception) { return null }
        fun s(k: String) = j.optString(k, "").trim().ifEmpty { null }
        val on = s("dhcpEnabled")?.lowercase().let { it == "1" || it == "on" || it == "true" }
        val lease = s("dhcpLease_hour")?.let { Regex("^(\\d+)\\s*h?$", RegexOption.IGNORE_CASE).matchEntire(it)?.groupValues?.get(1)?.toIntOrNull() }
        return Seen(s("lan_ipaddr"), s("lan_netmask"), on, s("dhcpStart"), s("dhcpEnd"), lease)
    }

    /** Does the router report exactly the wanted values? */
    fun matches(want: Snap, seen: Seen): Boolean =
        seen.dhcpOn && seen.ip == want.ip && seen.mask == want.mask && seen.start == want.start && seen.end == want.end && seen.lease == want.lease

    /**
     * [newAnswers]: the new address answers the router API. [seen]: what a read at the new address returned (null = could not read).
     * [oldAnswers]: the old address answers (only asked while the new one does not). [waitOver]: the wait window has ended.
     */
    fun decide(note: Note, now: Long, newAnswers: Boolean, seen: Seen?, oldAnswers: Boolean, waitOver: Boolean): Verdict {
        if (note.at <= 0L || now - note.at > MAX_AGE_MS) return Verdict.EXPIRED
        if (newAnswers) {
            if (seen != null) return if (matches(note.new, seen)) Verdict.KEEP_NEW else Verdict.REVERT
            return if (waitOver) Verdict.KEEP_NEW else Verdict.WAIT   // answers but could not be read: never revert blind
        }
        if (oldAnswers && note.old.ip != note.new.ip) return Verdict.USE_OLD
        return if (waitOver) Verdict.GIVE_UP else Verdict.WAIT
    }

    /** The DHCP_SETTING call that puts the old values back (the same shape the page sends). */
    fun revertParams(note: Note): Map<String, String> = linkedMapOf(
        "goformId" to "DHCP_SETTING", "lanIp" to note.old.ip, "lanNetmask" to note.old.mask, "lanDhcpType" to "SERVER",
        "dhcpStart" to note.old.start, "dhcpEnd" to note.old.end, "dhcpLease" to note.old.lease.toString(),
        "dhcp_reboot_flag" to "1", "mac_ip_reset" to if (note.old.ip != note.new.ip) "1" else "0",
    )

    /** The saved router address with the host part replaced by [ip]; a saved ":port" is kept. */
    fun hostWithIp(saved: String, ip: String): String { val i = saved.indexOf(':'); return if (i < 0) ip else ip + saved.substring(i) }

    /** The page may only point the console at the address named in the pending note. */
    fun appliedOk(note: Note?, ip: String): Boolean = note != null && addrOk(ip) && note.new.ip == ip
}

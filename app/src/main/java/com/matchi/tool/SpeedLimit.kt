package com.matchi.tool

/**
 * Per-device speed limit: the pure part (no Android classes, so the pure-Kotlin test script compiles and runs its test).
 * It validates input, builds the shell scripts that run as root, and reads the output of `tc` and `ip neigh` back.
 * The model is described in docs/LIMIT_SPEED.md. Tested by hand on one ZTE F50 (kernel 5.4, iproute2 171113).
 *
 * What it owns, and nothing else: filter priorities 1000..1255 (IPv4) and 1300..1555 (IPv6, matched by MAC) and HTB classes 1:101..1:1ff. Priority 1 on the hotspot
 * interfaces belongs to the system (a BPF TTL filter); no script here names it.
 */
object SpeedLimit {
    const val LAN_IF = "br0"
    val UP_IFS = listOf("wlan0", "usb0")
    const val MIN_KBPS = 8
    const val MAX_KBPS = 125_000
    private const val PREF_BASE = 1000
    private const val PREF6_BASE = 1300
    private const val MINOR_BASE = 0x100
    private const val FIRST_OCTET = 2
    private const val LAST_OCTET = 254

    /** Limits in KB/s; null means unlimited in that direction. */
    data class Limit(val down: Int?, val up: Int?) { val none: Boolean get() = down == null && up == null }
    /** A saved limit. [ip] is the address it was last applied to (null when it never was). */
    data class Entry(val mac: String, val limit: Limit, val ip: String?)
    /** What the phone shows right now. [up] holds only the interfaces that exist: interface to (octet to KB/s). */
    data class Live(
        val down: Map<Int, Int>,
        val up: Map<String, Map<Int, Int>>,
        val neigh: Map<String, String>,
        val lanUp: Boolean,
        val rootBusy: Boolean
    )
    data class Todo(val mac: String, val ip: String, val limit: Limit)
    data class Plan(val apply: List<Todo>, val remove: List<Int>)

    // ---- validation -------------------------------------------------------------------------------------------------

    private val MAC = Regex("^[0-9a-f]{2}(:[0-9a-f]{2}){5}$")
    private val IP = Regex("^192\\.168\\.0\\.(0|[1-9][0-9]{0,2})$")

    /** Lower-case colon form, or null. Group (multicast and broadcast) addresses and all-zero are refused. */
    fun normalizeMac(raw: String?): String? {
        val m = raw?.trim()?.lowercase()?.replace('-', ':') ?: return null
        if (!MAC.matches(m)) return null
        if ((m.substring(0, 2).toInt(16) and 1) == 1) return null
        if (m == "00:00:00:00:00:00") return null
        return m
    }

    /** Last byte of a LAN address (192.168.0.2 to .254), or null. The router itself (.1) and .0 / .255 are refused. */
    fun octetOf(ip: String?): Int? {
        val text = ip?.trim() ?: return null
        val v = IP.matchEntire(text)?.groupValues?.get(1)?.toInt() ?: return null
        return if (v in FIRST_OCTET..LAST_OCTET) v else null
    }

    private fun kbpsError(v: Int?, name: String): String? =
        if (v == null || v in MIN_KBPS..MAX_KBPS) null else "$name must be $MIN_KBPS to $MAX_KBPS KB/s, or empty for Unlimited"

    /** Null when both values are fine (each may be null = Unlimited). */
    fun limitError(down: Int?, up: Int?): String? = kbpsError(down, "Download") ?: kbpsError(up, "Upload")

    fun prefOf(octet: Int): Int = PREF_BASE + octet
    /** Priority of the IPv6 filter of the same device (one tc priority can hold one protocol only, so IPv6 gets its own). */
    fun pref6Of(octet: Int): Int = PREF6_BASE + octet

    /** "aa:bb:cc:dd:ee:ff" to (0xaabbccdd, 0xeeff) for u32 matches; null when not a valid MAC. */
    private fun macWords(mac: String?): Pair<String, String>? {
        val m = normalizeMac(mac) ?: return null
        val h = m.replace(":", "")
        return Pair("0x" + h.substring(0, 8), "0x" + h.substring(8, 12))
    }
    fun minorOf(octet: Int): String = Integer.toHexString(MINOR_BASE + octet)
    /** Police burst in KB: 20 for small rates, about 50 ms of traffic for large ones (a small burst under-delivers fast links). */
    fun burstKb(kbps: Int): Int = maxOf(20, kbps / 20)

    // ---- scripts (run as root, one call each) -----------------------------------------------------------------------

    private const val HEAD = "ERR=0\nstep() { \"\$@\" 2>&1 || { echo \"MATCHI_ERR \$*\"; ERR=1; }; }\n"
    private const val FOOT = "if [ \"\$ERR\" = 0 ]; then echo MATCHI_OK; fi\n"
    /** Take the root qdisc away again when the last class of ours is gone, but only when it is ours (handle 1:). */
    private const val CLEANUP =
        "tc class show dev br0 2>/dev/null | grep -q \"htb 1:1[0-9a-f][0-9a-f] \" || " +
        "{ tc qdisc show dev br0 2>/dev/null | grep -q \"qdisc htb 1:\" && tc qdisc del dev br0 root 2>/dev/null; }\n"
    /** Never overwrite another setup: only an empty (noqueue) or our own htb root is used. */
    private const val ENSURE_ROOT =
        "R=\$(tc qdisc show dev br0 2>&1)\n" +
        "case \"\$R\" in\n" +
        " *\"qdisc htb 1:\"*) ;;\n" +
        " *\"qdisc noqueue\"*) step tc qdisc replace dev br0 root handle 1: htb default 10 ;;\n" +
        " *) echo MATCHI_ROOT_BUSY; exit 3 ;;\n" +
        "esac\n" +
        "step tc class replace dev br0 parent 1: classid 1:10 htb rate 1gbit\n"

    /** Read-only: our classes, the upload filters of each hotspot interface that exists, the neighbours on br0, and br0's root qdisc. */
    const val READ_SCRIPT =
        "echo '--- classes'; tc class show dev br0 2>/dev/null\n" +
        "for D in wlan0 usb0; do [ -d /sys/class/net/\$D ] && { echo \"--- up \$D\"; tc filter show dev \$D parent ffff: 2>/dev/null; }; done\n" +
        "echo '--- neigh'; ip neigh show dev br0 2>/dev/null\n" +
        "echo '--- root'; tc qdisc show dev br0 2>/dev/null\n"

    private fun dropOctet(o: Int): String {
        val p = prefOf(o)
        val m = minorOf(o)
        val sb = StringBuilder()
        val p6 = pref6Of(o)
        sb.append("tc filter del dev br0 parent 1: prio $p 2>/dev/null\n")
        sb.append("tc filter del dev br0 parent 1: prio $p6 2>/dev/null\n")
        sb.append("tc class del dev br0 classid 1:$m 2>/dev/null\n")
        for (i in UP_IFS) {
            sb.append("tc filter del dev $i parent ffff: prio $p 2>/dev/null\n")
            sb.append("tc filter del dev $i parent ffff: prio $p6 2>/dev/null\n")
        }
        return sb.toString()
    }

    /**
     * Sets (or, for a null direction, clears) one device's limits. Null when the address or a value is not valid.
     * With a valid [mac] the device's IPv6 traffic is limited too: its addresses rotate, so IPv6 is matched on the Ethernet
     * MAC (destination on br0 egress, source on the hotspot ingress), both into the same class / the same rate. The IPv6 rules are
     * best effort (no `step`): if this kernel rejects them, the proven IPv4 limit still stands instead of being rolled back.
     */
    fun applyScript(ip: String, limit: Limit, mac: String? = null): String? {
        val o = octetOf(ip) ?: return null
        if (limitError(limit.down, limit.up) != null) return null
        val p = prefOf(o)
        val p6 = pref6Of(o)
        val w = macWords(mac)
        val m = minorOf(o)
        val down = limit.down
        val up = limit.up
        val sb = StringBuilder(HEAD)
        if (down != null) sb.append(ENSURE_ROOT)
        sb.append("tc filter del dev br0 parent 1: prio $p 2>/dev/null\n")
        sb.append("tc filter del dev br0 parent 1: prio $p6 2>/dev/null\n")
        if (down != null) {
            sb.append("step tc class replace dev br0 parent 1: classid 1:$m htb rate ${down}kbps ceil ${down}kbps\n")
            sb.append("step tc filter add dev br0 parent 1: protocol ip prio $p u32 match ip dst $ip/32 flowid 1:$m\n")
            if (w != null) sb.append("tc filter add dev br0 parent 1: protocol ipv6 prio $p6 u32 match u32 ${w.first} 0xffffffff at -14 match u16 ${w.second} 0xffff at -10 flowid 1:$m 2>/dev/null\n")
        } else {
            sb.append("tc class del dev br0 classid 1:$m 2>/dev/null\n")
        }
        for (i in UP_IFS) {
            sb.append("if [ -d /sys/class/net/$i ]; then\n")
            sb.append(" tc filter del dev $i parent ffff: prio $p 2>/dev/null\n")
            sb.append(" tc filter del dev $i parent ffff: prio $p6 2>/dev/null\n")
            if (up != null) {
                sb.append(" tc qdisc show dev $i 2>/dev/null | grep -qE \"qdisc (ingress|clsact) ffff:\" || step tc qdisc add dev $i handle ffff: ingress\n")
                sb.append(" step tc filter add dev $i parent ffff: protocol ip prio $p u32 match ip src $ip/32 action police rate ${up}kbps burst ${burstKb(up)}k drop\n")
                if (w != null) sb.append(" tc filter add dev $i parent ffff: protocol ipv6 prio $p6 u32 match u32 ${w.first} 0xffffffff at -8 match u16 ${w.second} 0xffff at -4 action police rate ${up}kbps burst ${burstKb(up)}k drop 2>/dev/null\n")
            }
            sb.append("fi\n")
        }
        sb.append(CLEANUP)
        sb.append(FOOT)
        return sb.toString()
    }

    /** Removes every rule of the given devices (by last address byte). Invalid octets are skipped. */
    fun removeScript(octets: Collection<Int>): String {
        val sb = StringBuilder(HEAD)
        for (o in octets.distinct()) if (o in FIRST_OCTET..LAST_OCTET) sb.append(dropOctet(o))
        sb.append(CLEANUP)
        sb.append(FOOT)
        return sb.toString()
    }

    // ---- reading the phone's state ----------------------------------------------------------------------------------

    private val RATE = Regex("\\brate\\s+([0-9]+(?:\\.[0-9]+)?)([KkMmGg]?)bit")
    private val CLASS = Regex("^class htb 1:([0-9a-f]+)\\b")
    private val PREF = Regex("\\bpref ([0-9]+) ([a-z0-9_]+)")
    // `ip neigh show dev br0` leaves "dev br0" out of each line (seen on the F50); the unfiltered form has it. Either is br0, any other dev does not match.
    private val NEIGH = Regex("^([0-9]{1,3}(?:\\.[0-9]{1,3}){3})(?: dev br0)? lladdr ([0-9a-f:]{17}) ([A-Z]+)")

    /** tc prints rates in bits per second with a K, M or G prefix (1000 based); the result is KB/s, rounded. */
    fun toKbps(num: String, unit: String): Int? {
        val n = num.toDoubleOrNull() ?: return null
        val mul = when (unit.uppercase()) { "K" -> 1e3; "M" -> 1e6; "G" -> 1e9; else -> 1.0 }
        return Math.round(n * mul / 8.0 / 1000.0).toInt()
    }

    private fun stateRank(state: String): Int = when (state) {
        "REACHABLE", "PERMANENT" -> 3
        "DELAY", "PROBE" -> 2
        "STALE" -> 1
        else -> 0
    }

    private fun parseNeigh(lines: List<String>): Map<String, String> {
        val best = HashMap<String, Pair<String, Int>>()
        val unsure = HashSet<String>()
        for (line in lines) {
            val m = NEIGH.find(line.trim()) ?: continue
            val mac = normalizeMac(m.groupValues[2]) ?: continue
            val ip = m.groupValues[1]
            val rank = stateRank(m.groupValues[3])
            if (rank == 0) continue
            val old = best[mac]
            if (old == null || rank > old.second) { best[mac] = Pair(ip, rank); unsure.remove(mac) }
            else if (rank == old.second && ip != old.first) unsure.add(mac)
        }
        val byIp = HashMap<String, Int>()
        for ((mac, v) in best) if (mac !in unsure) byIp[v.first] = (byIp[v.first] ?: 0) + 1
        val out = LinkedHashMap<String, String>()
        for ((mac, v) in best) if (mac !in unsure && byIp[v.first] == 1) out[mac] = v.first
        return out
    }

    private fun parseUp(lines: List<String>): Map<Int, Int> {
        val out = HashMap<Int, Int>()
        var curPref: Int? = null
        for (line in lines) {
            val pm = PREF.find(line)
            if (pm != null) curPref = if (pm.groupValues[2] == "u32") pm.groupValues[1].toIntOrNull() else null
            if (!line.contains("police")) continue
            val rm = RATE.find(line) ?: continue
            val cp = curPref ?: continue
            val o = cp - PREF_BASE
            if (o !in FIRST_OCTET..LAST_OCTET) continue
            toKbps(rm.groupValues[1], rm.groupValues[2])?.let { out[o] = it }
        }
        return out
    }

    /** Parses the output of [READ_SCRIPT]. */
    fun parseLive(out: String): Live {
        val sections = LinkedHashMap<String, MutableList<String>>()
        var cur: MutableList<String>? = null
        for (raw in out.lines()) {
            val line = raw.trimEnd()
            if (line.startsWith("--- ")) {
                val l = ArrayList<String>()
                sections[line.substring(4).trim()] = l
                cur = l
                continue
            }
            cur?.add(line)
        }
        val down = HashMap<Int, Int>()
        for (line in sections["classes"].orEmpty()) {
            val cm = CLASS.find(line) ?: continue
            val minor = cm.groupValues[1].toIntOrNull(16) ?: continue
            val o = minor - MINOR_BASE
            if (o !in FIRST_OCTET..LAST_OCTET) continue
            val rm = RATE.find(line) ?: continue
            toKbps(rm.groupValues[1], rm.groupValues[2])?.let { down[o] = it }
        }
        val up = LinkedHashMap<String, Map<Int, Int>>()
        for ((name, lines) in sections) if (name.startsWith("up ")) up[name.substring(3).trim()] = parseUp(lines)
        val root = sections["root"].orEmpty().joinToString("\n")
        val lanUp = root.isNotBlank()
        val busy = lanUp && !(root.contains("qdisc htb 1:") || root.contains("qdisc noqueue"))
        return Live(down, up, parseNeigh(sections["neigh"].orEmpty()), lanUp, busy)
    }

    private fun close(want: Int, have: Int): Boolean = Math.abs(want - have) <= maxOf(2, want / 20)

    /** True when the phone shows exactly this device's limit: each wanted direction present with about the right rate, each unwanted one absent. */
    fun matches(limit: Limit, live: Live, octet: Int): Boolean {
        val d = limit.down
        val u = limit.up
        val have = live.down[octet]
        val downOk = if (d == null) have == null else (have != null && close(d, have))
        val upOk = live.up.values.all { m ->
            val v = m[octet]
            if (u == null) v == null else (v != null && close(u, v))
        }
        return downOk && upOk
    }

    /**
     * What to do now. A saved device is limited at the address it has now (from the neighbour table), or at the address it last had
     * when it is not listed (after a reboot). Rules left at an address the device no longer uses, or that another device has
     * taken, are removed. Does nothing while br0 is down or its root qdisc belongs to something else.
     */
    fun plan(stored: List<Entry>, live: Live): Plan {
        if (!live.lanUp || live.rootBusy) return Plan(emptyList(), emptyList())
        val owner = HashMap<String, String>()
        for ((mac, ip) in live.neigh) owner[ip] = mac
        val stale = LinkedHashSet<Int>()
        val wanted = HashSet<Int>()
        val todo = ArrayList<Todo>()
        for (e in stored) {
            if (e.limit.none) continue
            val now = live.neigh[e.mac]
            val last = e.ip
            if (now != null && last != null && last != now) octetOf(last)?.let { stale.add(it) }
            val target = now ?: last ?: continue
            val o = octetOf(target) ?: continue
            if (now == null && owner[target] != null) { stale.add(o); continue }
            wanted.add(o)
            if (target != last || !matches(e.limit, live, o)) todo.add(Todo(e.mac, target, e.limit))
        }
        return Plan(todo, stale.filter { it !in wanted })
    }

    // ---- saved form -------------------------------------------------------------------------------------------------

    /** "mac=down|up|ip,mac=down|up|ip": an empty down or up is Unlimited. Entries with no limit are not written. */
    fun encode(list: List<Entry>): String =
        list.filter { !it.limit.none }.joinToString(",") { "${it.mac}=${it.limit.down ?: ""}|${it.limit.up ?: ""}|${it.ip ?: ""}" }

    /** The reverse. Anything that does not validate is dropped; a repeated MAC keeps the last entry. */
    fun decode(text: String?): List<Entry> {
        if (text.isNullOrBlank()) return emptyList()
        val out = LinkedHashMap<String, Entry>()
        for (part in text.split(',')) {
            val eq = part.indexOf('=')
            if (eq < 0) continue
            val mac = normalizeMac(part.substring(0, eq)) ?: continue
            val f = part.substring(eq + 1).split('|')
            if (f.size != 3) continue
            val down = f[0].toIntOrNull()
            val up = f[1].toIntOrNull()
            if ((f[0].isNotEmpty() && down == null) || (f[1].isNotEmpty() && up == null)) continue
            val limit = Limit(down, up)
            if (limit.none || limitError(down, up) != null) continue
            out[mac] = Entry(mac, limit, f[2].takeIf { octetOf(it) != null })
        }
        return out.values.toList()
    }

    fun upsert(list: List<Entry>, e: Entry): List<Entry> = list.filter { it.mac != e.mac } + e
    fun without(list: List<Entry>, mac: String): List<Entry> = list.filter { it.mac != mac }
}

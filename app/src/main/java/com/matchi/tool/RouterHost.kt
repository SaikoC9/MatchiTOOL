package com.matchi.tool

/**
 * Validation of the saved router address. The router admin password is sent to this address, so it must be a device on
 * the local network: a private / link-local / loopback IPv4 literal (or "localhost"), with an optional ":port".
 * Host names and public addresses are refused, otherwise an authenticated console user or a plugin could point the
 * "router" at an outside server and receive the admin credentials. No Android classes, so it runs in JVM unit tests.
 */
object RouterHost {
    private val rx = Regex("^([0-9]{1,3})\\.([0-9]{1,3})\\.([0-9]{1,3})\\.([0-9]{1,3})(?::([0-9]{1,5}))?$")
    private val localhostRx = Regex("^localhost(?::([0-9]{1,5}))?$", RegexOption.IGNORE_CASE)

    fun isValid(h: String): Boolean {
        if (h.length > 21) return false
        localhostRx.matchEntire(h)?.let { return portOk(it.groupValues[1]) }
        val m = rx.matchEntire(h) ?: return false
        val o = IntArray(4) { i ->
            val s = m.groupValues[i + 1]
            if (s.length > 1 && s.startsWith("0")) return false   // no leading zeros: "010.0.0.1" means different things to different parsers
            s.toInt().also { if (it > 255) return false }
        }
        if (!portOk(m.groupValues[5])) return false
        return o[0] == 10 ||                                   // 10.0.0.0/8
            (o[0] == 172 && o[1] in 16..31) ||                 // 172.16.0.0/12
            (o[0] == 192 && o[1] == 168) ||                    // 192.168.0.0/16
            (o[0] == 169 && o[1] == 254) ||                    // link-local
            o[0] == 127                                        // loopback
    }

    private fun portOk(p: String): Boolean = p.isEmpty() || p.toInt() in 1..65535
}

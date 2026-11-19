package com.matchi.tool

/** What the USB link to the PC looks like right now. */
enum class TetherLink { ACTIVE, IDLE, UNKNOWN }

/**
 * Decides whether USB tethering is active, from two raw readings. Pure Kotlin (no shell, no Android classes) so it is unit tested.
 *
 * The F50 has no tethering switch and usb0 is always bridged into br0, so "tethering active" means the PC link is up:
 *  - ACTIVE when the first UDC state is "configured" AND the usb0 carrier is 1.
 *  - IDLE when the first UDC state is anything else, OR the usb0 carrier is 0.
 *  - UNKNOWN when a reading is missing and the other one does not settle it. UNKNOWN must never change Wi-Fi.
 *
 * sys.usb.config is not used: it keeps saying ecm after the cable is pulled.
 *
 * Third reading, "peer" (added after the F50 test of 2026-11-19): a cable that loses its data wires but keeps its power (a half-pulled
 * cable) does not change the UDC state, the carrier or vbus at all; only the PC notices. The router therefore pings its neighbours and
 * checks whether the usb0 receive counter moved: packets only arrive on usb0 from the PC, so "no packet arrived although we pinged" means the PC
 * is gone ("0"), a rising counter means it is there ("1"). "0" turns an otherwise ACTIVE link into IDLE; a missing or unreadable peer
 * reading changes nothing (the old two-reading rule stays in force), so the peer reading can only ever make the answer IDLE, never ACTIVE.
 */
object TetherState {
    /**
     * One root shell line. Prints one "udc=<state>" line per UDC entry (in order), one "carrier=<0|1>" line and one "peer=<1|0>" line;
     * a failed read prints an empty value. The peer probe pings every neighbour on br0 (at most 16, all at once, so the look takes about
     * 1-2 s) and compares the usb0 rx_packets counter before and after: it rose = a PC answered over USB = 1, otherwise 0.
     */
    const val READ_COMMAND =
        "for u in /sys/class/udc/*; do echo \"udc=\$(cat \$u/state 2>/dev/null)\"; done; " +
        "echo \"carrier=\$(cat /sys/class/net/usb0/carrier 2>/dev/null)\"; " +
        "r0=\$(cat /sys/class/net/usb0/statistics/rx_packets 2>/dev/null); " +
        "for ip in \$(awk '\$6==\"br0\"{print \$1}' /proc/net/arp | head -16); do ping -c 1 -W 1 \$ip >/dev/null 2>&1 & done; wait; " +
        "r1=\$(cat /sys/class/net/usb0/statistics/rx_packets 2>/dev/null); " +
        "if [ -n \"\$r0\" ] && [ -n \"\$r1\" ]; then if [ \"\$r1\" -gt \"\$r0\" ]; then echo peer=1; else echo peer=0; fi; else echo peer=; fi"

    /**
     * [udcStates]: the state of each UDC entry in listing order (null = could not be read). [carrier]: raw usb0 carrier text (null = could not be read).
     * [peer]: raw peer text, "1" = a PC answered, "0" = nothing came in although we pinged, anything else / null = not known (ignored).
     */
    fun decide(udcStates: List<String>?, carrier: String?, peer: String? = null): TetherLink {
        val first = udcStates?.firstOrNull()?.trim()?.takeIf { it.isNotEmpty() }
        val up = when (carrier?.trim()) { "1" -> true; "0" -> false; else -> null }
        if (first != null && first != "configured") return TetherLink.IDLE
        if (up == false) return TetherLink.IDLE
        if (first == "configured" && up == true) return if (peer?.trim() == "0") TetherLink.IDLE else TetherLink.ACTIVE
        return TetherLink.UNKNOWN
    }

    /** Reads the output of [READ_COMMAND]. Null or text without the expected lines is UNKNOWN. */
    fun fromOutput(output: String?): TetherLink {
        if (output == null) return TetherLink.UNKNOWN
        val lines = output.lines().map { it.trim() }
        val udc = lines.filter { it.startsWith("udc=") }.map { it.removePrefix("udc=") }
        val carrier = lines.lastOrNull { it.startsWith("carrier=") }?.removePrefix("carrier=")
        val peer = lines.lastOrNull { it.startsWith("peer=") }?.removePrefix("peer=")
        return decide(udc.ifEmpty { null }, carrier, peer)
    }
}

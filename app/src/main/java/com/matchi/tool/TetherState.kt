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
 */
object TetherState {
    /** One root shell line. Prints one "udc=<state>" line per UDC entry (in order) and one "carrier=<0|1>" line; a failed read prints an empty value. */
    const val READ_COMMAND =
        "for u in /sys/class/udc/*; do echo \"udc=\$(cat \$u/state 2>/dev/null)\"; done; echo \"carrier=\$(cat /sys/class/net/usb0/carrier 2>/dev/null)\""

    /** [udcStates]: the state of each UDC entry in listing order (null = could not be read). [carrier]: raw usb0 carrier text (null = could not be read). */
    fun decide(udcStates: List<String>?, carrier: String?): TetherLink {
        val first = udcStates?.firstOrNull()?.trim()?.takeIf { it.isNotEmpty() }
        val up = when (carrier?.trim()) { "1" -> true; "0" -> false; else -> null }
        if (first != null && first != "configured") return TetherLink.IDLE
        if (up == false) return TetherLink.IDLE
        if (first == "configured" && up == true) return TetherLink.ACTIVE
        return TetherLink.UNKNOWN
    }

    /** Reads the output of [READ_COMMAND]. Null or text without the expected lines is UNKNOWN. */
    fun fromOutput(output: String?): TetherLink {
        if (output == null) return TetherLink.UNKNOWN
        val lines = output.lines().map { it.trim() }
        val udc = lines.filter { it.startsWith("udc=") }.map { it.removePrefix("udc=") }
        val carrier = lines.lastOrNull { it.startsWith("carrier=") }?.removePrefix("carrier=")
        return decide(udc.ifEmpty { null }, carrier)
    }
}

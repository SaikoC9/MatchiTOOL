package com.matchi.tool

/**
 * Which router "set" calls of the Network tools (Wi-Fi, devices, APN, LAN / DHCP, MTU / MSS, mobile data, USB protocol) need the fresh sign-in
 * (RootGate) before the host forwards them. Such a call can cut the person off or break the data connection, and /api/zte and
 * /api/goform/ are otherwise open to any console session. Pure Kotlin, no Android classes, unit tested (NetGoformTest).
 *
 * The names are the goformIds seen in UFI-TOOLS 4.1.5 and on the F50's own page (MatchiTOOL_Network_Tools_PLAN.txt). They are matched
 * without regard to case or surrounding spaces, so a changed spelling cannot get around the gate. Reads never need it, and the
 * radio calls that already work without it (band lock, cell lock, performance mode, SMS) are not in this set.
 */
object NetGoform {
    /** goformIds that change network settings. */
    val GATED: Set<String> = setOf(
        // mobile data
        "CONNECT_NETWORK", "DISCONNECT_NETWORK", "SET_CONNECTION_MODE",
        // Wi-Fi
        "setAccessPointInfo", "switchWiFiModule", "switchWiFiChip", "SET_WIFI_SLEEP_INFO", "WIFI_NFC_SET",
        // connected devices
        "EDIT_HOSTNAME", "setDeviceAccessControlList",
        // APN
        "APN_PROC_EX",
        // router LAN / DHCP and MTU / MSS
        "DHCP_SETTING", "SET_DEVICE_MTU",
        // USB Internet Protocol (Auto / RNDIS / CDC-ECM) and the restart the stock page sends after it
        "SET_USB_NETWORK_PROTOCAL", "REBOOT_DEVICE",
    )

    private val gatedLower: Set<String> = GATED.map { it.lowercase() }.toSet()

    /** True when [goformId] is one of [GATED] (case and surrounding spaces ignored). Null and empty are not. */
    fun needsGate(goformId: String?): Boolean = goformId != null && goformId.trim().lowercase() in gatedLower

    /** True when the request parameters name a gated goformId. The parameter name is matched without regard to case too. */
    fun needsGate(params: Map<String, String>): Boolean =
        params.entries.any { it.key.equals("goformId", ignoreCase = true) && needsGate(it.value) }
}

package com.matchi.tool

/**
 * Which router "set" calls need the fresh sign-in (RootGate) before the host forwards them. /api/zte (op "set") is otherwise open to any console session, and a set call can cut the person off, break the data connection, reset the router
 * or change its admin password.
 *
 * Since 1.4.3 this is a POSITIVE list: only the goformIds in [OPEN_SET] skip the gate, every other set call needs it.
 * The old design listed the dangerous names, so a dangerous name that was not on the list (a factory reset, a router password change;
 * the exact names differ between ZTE firmwares) went through unchecked. Reads (op "get" / GET) never come here.
 *
 * [OPEN_SET] holds exactly the set calls the built-in tools send without a fresh sign-in: band lock, cell lock, network mode,
 * performance mode and SMS. A plugin that sends another set call needs a sign-in younger than 4 h (it gets the usual
 * "sign in again" answer, nothing is lost). To open another call, add it here AND to NetGoformTest.
 *
 * Names are matched without regard to case or surrounding spaces, so a changed spelling cannot get around the gate. Pure Kotlin, no
 * Android classes, unit tested (NetGoformTest).
 */
object NetGoform {
    /** Set calls that work without the fresh sign-in (radio and SMS). Everything else needs it. */
    val OPEN_SET: Set<String> = setOf(
        // band lock, cell lock, network mode, performance mode (radio-core.js, dash-radio.js, perf-mode.js)
        "LTE_BAND_LOCK", "NR_BAND_LOCK", "CELL_LOCK", "UNLOCK_ALL_CELL", "SET_BEARER_PREFERENCE", "PERFORMANCE_MODE_SETTING",
        // SMS tool
        "SEND_SMS", "DELETE_SMS", "SET_MSG_READ",
    )

    /**
     * The network-changing names the Network tools send (mobile data, Wi-Fi, devices, APN, LAN / DHCP, MTU / MSS, USB). They are gated like
     * every name that is not in [OPEN_SET]; the list is kept as the documented set the tests pin down, and must never overlap [OPEN_SET].
     */
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
        // USB debugging switch of the stock page (usb_port_switch = 1 / 0)
        "USB_PORT_SETTING",
        // indicator light On / Off (Network > Light), captured from the stock Indicator Light page
        "INDICATOR_LIGHT_SETTING",
    )

    private val openLower: Set<String> = OPEN_SET.map { it.lowercase() }.toSet()

    /** True unless [goformId] is one of [OPEN_SET] (case and surrounding spaces ignored). A missing or blank name is gated too. */
    fun needsGate(goformId: String?): Boolean = goformId == null || goformId.trim().lowercase() !in openLower

    /**
     * For the parameters of a router SET call: true unless every goformId they carry is in [OPEN_SET]. No goformId at all is gated, and so is a
     * request that carries the name twice under different spellings (goformId and GOFORMID): the router may read either one.
     */
    fun needsGate(params: Map<String, String>): Boolean {
        val ids = params.entries.filter { it.key.equals("goformId", ignoreCase = true) }
        return ids.isEmpty() || ids.any { needsGate(it.value) }
    }
}

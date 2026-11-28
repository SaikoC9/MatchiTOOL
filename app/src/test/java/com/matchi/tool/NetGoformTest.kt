package com.matchi.tool

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NetGoformTest {
    @Test fun everyNetworkWriteIsGated() {
        // The set calls of the plan: mobile data, Wi-Fi, devices, APN, LAN / DHCP, MTU / MSS.
        for (id in listOf(
            "CONNECT_NETWORK", "DISCONNECT_NETWORK", "SET_CONNECTION_MODE",
            "setAccessPointInfo", "switchWiFiModule", "switchWiFiChip", "SET_WIFI_SLEEP_INFO", "WIFI_NFC_SET",
            "EDIT_HOSTNAME", "setDeviceAccessControlList", "APN_PROC_EX", "DHCP_SETTING", "SET_DEVICE_MTU",
            "SET_USB_NETWORK_PROTOCAL", "REBOOT_DEVICE", "USB_PORT_SETTING", "INDICATOR_LIGHT_SETTING",
        )) assertTrue("must be gated: $id", NetGoform.needsGate(id))
    }

    @Test fun radioAndOtherCallsStayOpen() {
        // These already work without the fresh sign-in (band lock, cell lock, network mode, performance mode, SMS) and must not start to need it.
        for (id in listOf("LTE_BAND_LOCK", "NR_BAND_LOCK", "CELL_LOCK", "UNLOCK_ALL_CELL", "SET_BEARER_PREFERENCE", "PERFORMANCE_MODE_SETTING", "SEND_SMS", "DELETE_SMS", "SET_MSG_READ"))
            assertFalse("must stay open: $id", NetGoform.needsGate(id))
    }

    @Test fun anythingNotOnThePositiveListIsGated() {
        // names that are not on the list (and some that are probably dangerous on a ZTE firmware) must need the fresh sign-in
        for (id in listOf("RESTORE_FACTORY_SETTINGS", "SET_ADMIN_PASSWORD", "CHANGE_PASSWORD", "RESTART_DEVICE", "SHUTDOWN_DEVICE", "MAC_FILTER", "SOMETHING_NEW", "LOGIN"))
            assertTrue("must be gated: $id", NetGoform.needsGate(id))
    }

    @Test fun theTwoListsNeverOverlap() {
        val open = NetGoform.OPEN_SET.map { it.lowercase() }.toSet()
        for (id in NetGoform.GATED) assertFalse("in both lists: $id", id.lowercase() in open)
    }

    @Test fun nullAndEmptyAreGated() {
        assertTrue(NetGoform.needsGate(null as String?))
        assertTrue(NetGoform.needsGate(""))
        assertTrue(NetGoform.needsGate("   "))
    }

    @Test fun spellingTricksDoNotGetAround() {
        assertTrue(NetGoform.needsGate("dhcp_setting"))
        assertTrue(NetGoform.needsGate("  SET_DEVICE_MTU "))
        assertTrue(NetGoform.needsGate("SETACCESSPOINTINFO"))
        // a different name is a different call, even when it looks alike
        assertTrue(NetGoform.needsGate("CELL_LOCK2"))
        assertTrue(NetGoform.needsGate("CELL_LOCK;x"))
        // the open names match without regard to case and spaces
        assertFalse(NetGoform.needsGate(" cell_lock "))
    }

    @Test fun parametersAreChecked() {
        assertTrue(NetGoform.needsGate(mapOf("goformId" to "DHCP_SETTING", "lanIp" to "192.168.0.1")))
        assertTrue(NetGoform.needsGate(mapOf("GOFORMID" to "APN_PROC_EX")))
        assertFalse(NetGoform.needsGate(mapOf("goformId" to "CELL_LOCK", "pci" to "1")))
        assertFalse(NetGoform.needsGate(mapOf("goformId" to "LTE_BAND_LOCK", "lte_band_lock" to "1,3")))
        // a set call without a goformId, or with an unknown one, is gated
        assertTrue(NetGoform.needsGate(mapOf("cmd" to "dhcpEnabled")))
        assertTrue(NetGoform.needsGate(emptyMap<String, String>()))
        assertTrue(NetGoform.needsGate(mapOf("goformId" to "FACTORY_RESET")))
        // a value that only mentions another name in another parameter is not a call to it
        assertFalse(NetGoform.needsGate(mapOf("goformId" to "CELL_LOCK", "note" to "DHCP_SETTING")))
        // the same key twice under different spellings: the dangerous one decides
        assertTrue(NetGoform.needsGate(mapOf("goformId" to "CELL_LOCK", "GOFORMID" to "DHCP_SETTING")))
    }
}

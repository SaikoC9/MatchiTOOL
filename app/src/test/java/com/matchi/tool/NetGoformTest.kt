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
            "SET_USB_NETWORK_PROTOCAL", "REBOOT_DEVICE", "USB_PORT_SETTING",
        )) assertTrue("must be gated: $id", NetGoform.needsGate(id))
    }

    @Test fun radioAndOtherCallsStayOpen() {
        // These already work without the fresh sign-in (band lock, cell lock, performance mode, SMS) and must not start to need it.
        for (id in listOf("LTE_BAND_LOCK", "NR_BAND_LOCK", "CELL_LOCK", "UNLOCK_ALL_CELL", "PERFORMANCE_MODE_SETTING", "DELETE_SMS", "SET_MSG_READ"))
            assertFalse("must stay open: $id", NetGoform.needsGate(id))
    }

    @Test fun nullAndEmptyAreNotGated() {
        assertFalse(NetGoform.needsGate(null as String?))
        assertFalse(NetGoform.needsGate(""))
        assertFalse(NetGoform.needsGate("   "))
    }

    @Test fun spellingTricksDoNotGetAround() {
        assertTrue(NetGoform.needsGate("dhcp_setting"))
        assertTrue(NetGoform.needsGate("  SET_DEVICE_MTU "))
        assertTrue(NetGoform.needsGate("SETACCESSPOINTINFO"))
        // a different name is a different call, even when it looks alike
        assertFalse(NetGoform.needsGate("DHCP_SETTING2"))
        assertFalse(NetGoform.needsGate("SET_DEVICE_MTU;x"))
    }

    @Test fun parametersAreChecked() {
        assertTrue(NetGoform.needsGate(mapOf("goformId" to "DHCP_SETTING", "lanIp" to "192.168.0.1")))
        assertTrue(NetGoform.needsGate(mapOf("GOFORMID" to "APN_PROC_EX")))
        assertFalse(NetGoform.needsGate(mapOf("goformId" to "CELL_LOCK", "pci" to "1")))
        assertFalse(NetGoform.needsGate(mapOf("cmd" to "dhcpEnabled")))   // a read has no goformId
        assertFalse(NetGoform.needsGate(emptyMap<String, String>()))
        // a value that only mentions a gated name in another parameter is not a call to it
        assertFalse(NetGoform.needsGate(mapOf("goformId" to "CELL_LOCK", "note" to "DHCP_SETTING")))
    }
}

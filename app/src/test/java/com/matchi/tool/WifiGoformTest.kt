package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WifiGoformTest {
    private fun chip(i: Int, on: Boolean) =
        """{"ChipIndex":$i,"AccessPointIndex":"0","AccessPointSwitchStatus":"${if (on) 1 else 0}","SSID":"CE 2","AuthMode":"WPA2PSKWPA3PSK","Password":"TopSecret-pass-1","PasswordShow":"TopSecret-pass-1"}"""
    private fun reply(module: String, vararg chips: String) = """{"WiFiModuleSwitch":"$module","ResponseList":[${chips.joinToString(",")}]}"""
    private fun seen(body: String) = WifiGoform.seenFrom(body)

    @Test fun paramsMatchTheStockPageCalls() {
        assertEquals(mapOf("multi_data" to "1", "cmd" to "queryWiFiModuleSwitch,queryAccessPointInfo"), WifiGoform.readParams())
        assertEquals(mapOf("goformId" to "switchWiFiModule", "SwitchOption" to "0"), WifiGoform.offParams())
        assertEquals(mapOf("goformId" to "switchWiFiChip", "ChipEnum" to "chip1", "GuestEnable" to "0"), WifiGoform.onParams("2g"))
        assertEquals(mapOf("goformId" to "switchWiFiChip", "ChipEnum" to "chip2", "GuestEnable" to "0"), WifiGoform.onParams("5g"))
        assertNull(WifiGoform.onParams("both")); assertNull(WifiGoform.onParams(null)); assertNull(WifiGoform.onParams("off"))
    }

    @Test fun fiveGhzOnIsReadByChipIndex() {
        val s = seen(reply("1", chip(0, false), chip(1, true)))
        assertEquals("5g", WifiGoform.mode(s)); assertEquals(true, WifiGoform.isOn(s)); assertEquals("5g", WifiGoform.bandOf(s))
        assertTrue(WifiGoform.reached(s, "5g")); assertFalse(WifiGoform.reached(s, "2g")); assertFalse(WifiGoform.reached(s, "off"))
    }

    @Test fun twoPointFourGhzOn() {
        val s = seen(reply("1", chip(0, true), chip(1, false)))
        assertEquals("2g", WifiGoform.mode(s)); assertEquals("2g", WifiGoform.bandOf(s))
    }

    @Test fun offWhenModuleOffOrNoChipOn() {
        assertEquals("off", WifiGoform.mode(seen(reply("0", chip(0, false), chip(1, false)))))
        assertEquals("off", WifiGoform.mode(seen(reply("1", chip(0, false), chip(1, false)))))
        assertEquals("off", WifiGoform.mode(seen(reply("0", chip(0, true)))))   // module switch wins
        val s = seen(reply("0"))
        assertEquals(false, WifiGoform.isOn(s)); assertNull(WifiGoform.bandOf(s)); assertTrue(WifiGoform.reached(s, "off"))
    }

    @Test fun bothBandsOrUnknownChipHasNoBandToRemember() {
        val both = seen(reply("1", chip(0, true), chip(1, true)))
        assertEquals("both", WifiGoform.mode(both)); assertEquals(true, WifiGoform.isOn(both)); assertNull(WifiGoform.bandOf(both))
        val other = seen(reply("1", chip(2, true)))
        assertEquals("other", WifiGoform.mode(other)); assertNull(WifiGoform.bandOf(other))
    }

    @Test fun moduleOnButNoBandListCannotBeTold() {
        val s = seen(reply("1"))
        assertNull(WifiGoform.mode(s)); assertNull(WifiGoform.isOn(s)); assertNull(WifiGoform.bandOf(s))
        assertFalse(WifiGoform.reached(s, "off")); assertFalse(WifiGoform.reached(s, "5g"))
    }

    @Test fun missingModuleSwitchCannotBeTold() {
        val s = seen("""{"ResponseList":[${chip(0, true)}]}""")
        assertNull(WifiGoform.mode(s)); assertNull(WifiGoform.isOn(s)); assertFalse(WifiGoform.reached(s, "2g")); assertFalse(WifiGoform.reached(s, "off"))
    }

    @Test fun garbageIsNull() {
        assertNull(WifiGoform.seenFrom(null)); assertNull(WifiGoform.seenFrom("")); assertNull(WifiGoform.seenFrom("<html>login</html>"))
        assertNull(WifiGoform.mode(null)); assertNull(WifiGoform.isOn(null)); assertFalse(WifiGoform.reached(null, "off"))
        assertNull(WifiGoform.isOn(WifiGoform.seenFrom("{}")))
        assertNull(WifiGoform.isOn(WifiGoform.seenFrom("""{"result":"failure"}""")))
    }

    @Test fun listCanBeAJsonStringOrNested() {
        val asString = """{"WiFiModuleSwitch":"1","ResponseList":"[${chip(1, true).replace("\"", "\\\"")}]"}"""
        assertEquals("5g", WifiGoform.mode(seen(asString)))
        val nested = """{"queryAccessPointInfo":{"ResponseList":[${chip(0, true)}]},"queryWiFiModuleSwitch":{"WiFiModuleSwitch":"1"}}"""
        assertEquals("2g", WifiGoform.mode(seen(nested)))
    }

    @Test fun statusMayBeANumberAndUnknownStatusIsNotOn() {
        val n = """{"WiFiModuleSwitch":1,"ResponseList":[{"ChipIndex":1,"AccessPointSwitchStatus":1}]}"""
        assertEquals("5g", WifiGoform.mode(seen(n)))
        val none = """{"WiFiModuleSwitch":"1","ResponseList":[{"ChipIndex":1},{"ChipIndex":0,"AccessPointSwitchStatus":""}]}"""
        assertEquals("off", WifiGoform.mode(seen(none)))
    }

    @Test fun passwordsAreNotKept() {
        assertFalse(seen(reply("1", chip(1, true))).toString().contains("TopSecret"))
    }

    @Test fun stateFileRoundTrip() {
        assertEquals("5g", WifiGoform.parseState(WifiGoform.stateText("5g")))
        assertEquals("2g", WifiGoform.parseState(WifiGoform.stateText("2g")))
        assertNull(WifiGoform.parseState("")); assertNull(WifiGoform.parseState(null)); assertNull(WifiGoform.parseState("band=6g")); assertNull(WifiGoform.parseState("5g"))
    }
}

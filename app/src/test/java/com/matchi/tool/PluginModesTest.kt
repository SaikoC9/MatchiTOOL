package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PluginModesTest {
    @Test fun roundTrip() {
        val raw = encodePluginModes(mapOf("A.js" to "sandbox", "B.js" to "sandbox"))
        assertEquals(mapOf("A.js" to "sandbox", "B.js" to "sandbox"), parsePluginModes(raw))
    }

    @Test fun onlySandboxIsKept() {
        // a plugin is trusted unless it says "sandbox": any other value, even "trusted", is just not listed
        assertEquals(mapOf("A.js" to "sandbox"), parsePluginModes("{\"A.js\":\"sandbox\",\"B.js\":\"trusted\",\"C.js\":\"x\",\"D.js\":1}"))
        assertEquals("{}", encodePluginModes(mapOf("B.js" to "trusted")))
    }

    @Test fun badInputIsEmpty() {
        assertTrue(parsePluginModes(null).isEmpty())
        assertTrue(parsePluginModes("").isEmpty())
        assertTrue(parsePluginModes("not json").isEmpty())
        assertTrue(parsePluginModes("[1,2]").isEmpty())
    }
}

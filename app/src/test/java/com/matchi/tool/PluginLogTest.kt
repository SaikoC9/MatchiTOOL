package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PluginLogTest {
    @Test fun routesGetKinds() {
        assertEquals("plugin/shell", PluginLog.kindOf("POST", "/api/root_shell"))
        assertEquals("plugin/shell", PluginLog.kindOf("POST", "/api/user_shell"))
        assertEquals("plugin/at", PluginLog.kindOf("GET", "/api/AT"))
        assertEquals("plugin/goform", PluginLog.kindOf("GET", "/api/goform/goform_get_cmd_process"))
        assertEquals("plugin/proxy", PluginLog.kindOf("POST", "/api/proxy/x"))
        assertEquals("plugin/head", PluginLog.kindOf("GET", "/api/get_custom_head"))
        assertEquals("plugin/upload", PluginLog.kindOf("POST", "/api/upload_img"))
    }

    @Test fun otherRoutesAreNotPluginRoutes() {
        assertNull(PluginLog.kindOf("POST", "/api/shell"))
        assertNull(PluginLog.kindOf("GET", "/api/logs/entries"))
        assertNull(PluginLog.kindOf("GET", "/api/upload"))
    }

    @Test fun levelFollowsOutcome() {
        assertEquals("DEBUG", PluginLog.level(200, 40))
        assertEquals("WARNING", PluginLog.level(403, 5))
        assertEquals("WARNING", PluginLog.level(200, 6000))
        assertEquals("ERROR", PluginLog.level(500, 5))
    }

    @Test fun messageHasNoQueryValues() {
        val m = PluginLog.message("GET", "/api/AT?command=AT%2BCFUN%3D0&slot=0", 200, 12)
        assertEquals("GET /api/AT -> 200 in 12 ms", m)
        assertFalse(m.contains("CFUN"))
        assertTrue(PluginLog.message("POST", "/api/root_shell", 403, 3).contains("refused"))
    }

    @Test fun sourceUrlRoundTrip() {
        val line = PluginLog.sourceUrlLine("E5 baseband.js")
        assertTrue(line.endsWith("matchi-plugin/E5_baseband.js"))
        assertEquals("E5_baseband.js", PluginLog.pluginFromSource("at matchi-plugin/E5_baseband.js:12:3"))
        assertEquals("a.js", PluginLog.pluginFromSource("matchi-plugin/a.js"))
        assertNull(PluginLog.pluginFromSource("http://192.168.0.1/"))
        assertEquals("plugin", PluginLog.safeName(""))
    }
}

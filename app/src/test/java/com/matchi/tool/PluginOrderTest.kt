package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Test

class PluginOrderTest {
    @Test fun unorderedPluginsStaySortedByName() {
        assertEquals(listOf("a.js", "b.html", "c.js"), orderPlugins(listOf("c.js", "a.js", "b.html"), emptyList()))
    }

    @Test fun savedOrderWinsAndUnknownNamesAreIgnored() {
        val out = orderPlugins(listOf("a.js", "b.js", "c.js"), listOf("c.js", "gone.js", "a.js", "c.js"))
        assertEquals(listOf("c.js", "a.js", "b.js"), out)
    }

    @Test fun newPluginsGoAfterTheOrderedOnes() {
        assertEquals(listOf("z.js", "a.js", "m.js"), orderPlugins(listOf("a.js", "m.js", "z.js"), listOf("z.js")))
    }

    @Test fun kindFollowsTheExtension() {
        assertEquals("html", pluginKind("x-1a2b3c.html"))
        assertEquals("js", pluginKind("x.js"))
    }

    @Test fun titleCannotCloseTheMarkerComment() {
        assertEquals("a - -> b", cleanPluginTitle("a\r\n--> b"))
        assertEquals(120, cleanPluginTitle("x".repeat(500)).length)
    }
}

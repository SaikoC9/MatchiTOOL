package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class GatewayProxyTest {
    @Test fun onlyTheTwoGoformEndpointsAreForwarded() {
        assertEquals("/goform/goform_get_cmd_process", GatewayProxy.goformPath("goform_get_cmd_process"))
        assertEquals("/goform/goform_set_cmd_process", GatewayProxy.goformPath("goform_set_cmd_process"))
        assertNull(GatewayProxy.goformPath("goform_other"))
        assertNull(GatewayProxy.goformPath("../x"))
        assertNull(GatewayProxy.goformPath(""))
    }

    @Test fun proxyPathStaysOnTheGateway() {
        assertEquals("/index.html", GatewayProxy.proxyPath("index.html"))
        assertEquals("/js/main.js", GatewayProxy.proxyPath("js/main.js"))
        // Anything that could name another host or climb out of the path is refused.
        for (bad in listOf("/evil.com/x", "../etc/passwd", "a/../b", "http://evil.com/", "evil.com@192.168.0.1/", "a\\b", "a%2f%2fb", "a%2e%2e/b", "a b", "a?x=1", "a#x", "", "x".repeat(300)))
            assertNull("must refuse: $bad", GatewayProxy.proxyPath(bad))
    }

    @Test fun setEndpointIsRecognisedWhateverTheSpelling() {
        // A trailing slash passes safePath, so the proxy's "is this a set call" check must not depend on how the path ends.
        for (p in listOf("/goform/goform_set_cmd_process", "/goform/goform_set_cmd_process/", "/goform/./goform_set_cmd_process", "/GOFORM/GOFORM_SET_CMD_PROCESS", "/goform/goform_set_cmd_process.x"))
            assertTrue("must count as the set endpoint: $p", GatewayProxy.safePath(p) != null && GatewayProxy.isSetPath(p))
        assertFalse(GatewayProxy.isSetPath("/goform/goform_get_cmd_process"))
        assertFalse(GatewayProxy.isSetPath("/index.html"))
    }

    @Test fun rawPathsNeedOneLeadingSlash() {
        assertEquals("/a/b", GatewayProxy.safePath("/a/b"))
        for (bad in listOf("a/b", "//evil.com/x", "/", "http://x", "/..", "/a//b", "/a\u0000b"))
            assertNull("must refuse: $bad", GatewayProxy.safePath(bad))
    }

    @Test fun savedGatewayMustBeLocal() {
        // The host that proxy() sends to is checked with RouterHost at call time, so a bad saved value is never used.
        assertTrue(RouterHost.isValid("192.168.0.1"))
        assertTrue(RouterHost.isValid("192.168.0.1:8080"))
        for (bad in listOf("8.8.8.8", "evil.com", "192.168.0.1@evil.com", "192.168.0.1/x", "http://192.168.0.1", "192.168.0.1:99999", "", "192.168.0.1.evil.com"))
            assertFalse("must refuse: $bad", RouterHost.isValid(bad))
    }

    @Test fun cookieRules() {
        assertTrue(GatewayProxy.cookieOk("stok=abc123; path=/"))
        assertTrue(GatewayProxy.cookieOk(""))
        assertFalse(GatewayProxy.cookieOk("a\r\nSet-Cookie: x"))
        assertFalse(GatewayProxy.cookieOk("a\u0000b"))
        assertFalse(GatewayProxy.cookieOk("\u00e9"))
        assertFalse(GatewayProxy.cookieOk("x".repeat(2049)))
    }

    @Test fun paramLimits() {
        assertEquals(mapOf("cmd" to "a,b"), GatewayProxy.params(mapOf("cmd" to "a,b")))
        assertNull(GatewayProxy.params(mapOf("bad name" to "x")))
        assertNull(GatewayProxy.params(mapOf("cmd" to "x".repeat(GatewayProxy.MAX_VALUE + 1))))
        assertNull(GatewayProxy.params((0..64).associate { "k$it" to "v" }))
    }

    @Test fun formBodiesAreDecoded() {
        assertEquals(mapOf("goformId" to "SET_X", "a" to "b c", "e" to ""), GatewayProxy.parseForm("goformId=SET_X&a=b+c&e="))
        assertEquals(emptyMap<String, String>(), GatewayProxy.parseForm(""))
    }
}

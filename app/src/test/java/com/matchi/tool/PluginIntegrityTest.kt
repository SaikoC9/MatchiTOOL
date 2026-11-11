package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PluginIntegrityTest {
    @Test fun sha256OfKnownText() {
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", sha256Hex("abc".toByteArray(Charsets.UTF_8)))
        assertEquals("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", sha256Hex(ByteArray(0)))
    }

    @Test fun plainCodeHasNoCapabilities() {
        assertTrue(pluginCaps("var a = 1; console.log(a)", emptyList()).isEmpty())
    }

    @Test fun rootNetworkTokenAndHostsAreListed() {
        val src = "runShellWithRoot('id'); fetch('https://API.Example.org/x'); var t = sessionStorage.getItem('matchi_token')"
        assertEquals(listOf("root", "net", "token", "host:api.example.org"), pluginCaps(src, listOf("API.Example.org")))
    }

    @Test fun rootRoutesCount() {
        assertEquals(listOf("root"), pluginCaps("api('/api/root_shell')", emptyList()))
        assertEquals(listOf("root"), pluginCaps("api('/api/one_click_shell')", emptyList()))
        // the app-user shell is not root
        assertTrue(pluginCaps("api('/api/user_shell')", emptyList()).isEmpty())
    }

    @Test fun hostsAreSortedAndDistinct() {
        assertEquals(listOf("host:a.com", "host:b.com"), pluginCaps("x", listOf("b.com", "a.com", "B.com")))
    }

    @Test fun addedCapsOnlyReportsNewOnes() {
        assertEquals(listOf("root", "host:x.com"), addedCaps(listOf("net"), listOf("root", "net", "host:x.com")))
        assertTrue(addedCaps(listOf("root", "net"), listOf("net")).isEmpty())
    }

    @Test fun integrityStates() {
        assertEquals("untracked", integrityState(null, "aa"))
        assertEquals("untracked", integrityState("", "aa"))
        assertEquals("ok", integrityState("aa", "aa"))
        assertEquals("changed", integrityState("aa", "bb"))
    }

    @Test fun capabilityLinesAreReadable() {
        assertEquals("runs root commands", describeCap("root"))
        assertEquals("contacts api.example.org", describeCap("host:api.example.org"))
    }
}

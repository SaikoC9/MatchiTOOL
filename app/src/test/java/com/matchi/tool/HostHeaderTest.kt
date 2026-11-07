package com.matchi.tool

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HostHeaderTest {
    @Test fun acceptsIpLiteralsAndLocalhost() {
        for (h in listOf("192.168.0.1", "192.168.0.1:8080", "127.0.0.1:8080", "10.0.0.255", "localhost", "LOCALHOST:8080", "[::1]", "[::1]:8080", "[fe80::1]:443"))
            assertTrue(h, hostHeaderAllowed(h))
    }

    @Test fun rejectsHostNamesAndMalformedValues() {
        for (h in listOf(null, "", " ", "evil.example", "evil.example:8080", "192.168.0.1.evil.example", "192.168.0.256",
            "192.168.0", "192.168.0.1:", "192.168.0.1:abc", "192.168.0.1:1234567", "192.168.0.1.", "[::1", "[evil]", "[::1]x",
            "localhost.evil.example", "user@192.168.0.1", "192.168.0.1/x", "0x7f.0.0.1"))
            assertFalse(h.toString(), hostHeaderAllowed(h))
    }
}

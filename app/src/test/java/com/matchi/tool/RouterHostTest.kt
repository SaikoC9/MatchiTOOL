package com.matchi.tool

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RouterHostTest {
    @Test fun privateAndLoopbackAddressesAreAccepted() {
        for (h in listOf("192.168.0.1", "192.168.100.1:8080", "10.1.2.3", "172.16.0.1", "172.31.255.254", "169.254.1.1", "127.0.0.1", "localhost", "localhost:9090"))
            assertTrue(h, RouterHost.isValid(h))
    }

    @Test fun publicAddressesAndHostNamesAreRefused() {
        for (h in listOf("8.8.8.8", "172.32.0.1", "172.15.0.1", "192.169.0.1", "11.0.0.1", "example.com", "router.attacker.example", "evil.com:80", "192.168.0.1.evil.com", "m.home"))
            assertFalse(h, RouterHost.isValid(h))
    }

    @Test fun malformedValuesAreRefused() {
        for (h in listOf("", "192.168.0", "192.168.0.256", "192.168.0.1:0", "192.168.0.1:70000", "192.168.0.1:", "010.0.0.1", "192.168.00.1", "192.168.0.1/x", "192.168.0.1 ", "[::1]", "0x7f.0.0.1", "300.1.1.1"))
            assertFalse(h, RouterHost.isValid(h))
    }
}

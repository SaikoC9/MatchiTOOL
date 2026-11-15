package com.matchi.tool

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceRuleTest {
    @Test fun zteF50IsSupported() {
        assertTrue(DeviceRule.isSupported("ZTE", "ZTE", "ZTE F50", "F50", "F50"))
        assertTrue(DeviceRule.isSupported("zte", null, "f50", null, null))
    }

    @Test fun otherZteModelIsNotSupported() {
        assertFalse(DeviceRule.isSupported("ZTE", "ZTE", "ZTE U60", "U60", "U60"))
    }

    @Test fun otherBrandIsNotSupported() {
        assertFalse(DeviceRule.isSupported("Google", "google", "Pixel 8", "shiba", "shiba"))
        assertFalse(DeviceRule.isSupported("Acme", "Acme", "F50", "F50", "F50"))   // F50 alone is not enough
        assertFalse(DeviceRule.isSupported(null, null, null, null, null))
    }
}

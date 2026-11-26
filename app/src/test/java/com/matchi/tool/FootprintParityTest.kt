package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Needs Android classes (AghDoor, GuardHost, ...), so it runs only under "gradle :app:testDebugUnitTest". */
class FootprintParityTest {
    @Test fun registryMatchesTheCode() {
        assertEquals(AghDoor.CHAIN, Footprint.AGH_CHAIN)
        for (n in listOf(GuardHost.BINARY, LiveEngine.BINARY, Doctor.BINARY)) assertTrue(n, Footprint.PROCESS_NAMES.contains(n))
        assertEquals(Prefs.PORT, Footprint.CONSOLE_PORT)
    }
}

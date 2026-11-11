package com.matchi.tool

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HostControlTest {
    private val script = HostControl.lanFirewallScript(2334)

    // Regression: the sed group and the tr newline were doubled ("\\(", "\\n"), so the shell saw a literal backslash,
    // sed matched nothing and the upstream interfaces were never skipped.
    @Test fun sedAndTrReachTheShellWithSingleEscapes() {
        assertTrue(script, script.contains("""sed -n 's/.* dev \([^ ]*\).*/\1/p'"""))
        assertTrue(script, script.contains("""tr '\n' ' '"""))
        assertFalse(script, script.contains("""\\("""))
        assertFalse(script, script.contains("""\\n"""))
    }

    @Test fun placeholdersAreResolvedAndPortIsInserted() {
        assertFalse(script.contains('§'))
        assertTrue(script.contains("--dport 2334 -j ACCEPT"))
        assertTrue(script.contains("""case "${'$'}UP" in *" ${'$'}i "*) continue;; esac"""))
    }

    @Test fun onlyHotspotSideInterfacesAreOpened() {
        assertTrue(script.contains("br*|ap*|swlan*|usb*|rndis*|ecm*)"))
        assertFalse(script.contains("rmnet"))
        assertFalse(script.contains("wlan*)"))
    }

    @Test fun closeScriptRemovesTheSameRuleOnTheSameInterfaces() {
        val close = HostControl.lanFirewallCloseScript(2334)
        assertFalse(close.contains('§'))
        assertTrue(close, close.contains("-D INPUT -i \"${'$'}i\" -p tcp --dport 2334 -j ACCEPT"))
        assertTrue(close, close.contains("br*|ap*|swlan*|usb*|rndis*|ecm*)"))
        assertFalse(close.contains("rmnet"))
        assertFalse(close.contains("-I INPUT"))   // it only removes, never adds
    }
}

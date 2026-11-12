package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PluginSandboxTest {
    @Test fun aPluginThatDeclaresNothingGetsNothing() {
        val n = sandboxNeeds("var a = 1;\nconsole.log(a)")
        assertTrue(n.caps.isEmpty())
        assertTrue(n.problems.isEmpty())
    }

    @Test fun everyKindIsReadAndListedInOrder() {
        val src = """
            // Signal tile
            // @matchi-needs net: API.Example.com
            // @matchi-needs shell: cat /proc/uptime
            // @matchi-needs router: signalbar, lan_ipaddr
            // @matchi-needs at.read
            var x = 1
        """.trimIndent()
        assertEquals(
            listOf("sbx:at.read", "sbx:router:lan_ipaddr", "sbx:router:signalbar", "sbx:shell:cat /proc/uptime", "sbx:net:api.example.com"),
            sandboxNeeds(src).caps,
        )
    }

    @Test fun headerStylesAreAccepted() {
        val src = "/*\n * @matchi-needs at.read\n */\n# @matchi-needs router: a\n   //   @matchi-needs   net:  x.org  "
        assertEquals(listOf("sbx:at.read", "sbx:router:a", "sbx:net:x.org"), sandboxNeeds(src).caps)
    }

    @Test fun linesAfterTheFirstEightyAreIgnored() {
        val src = "\n".repeat(80) + "// @matchi-needs at.read"
        assertTrue(sandboxNeeds(src).caps.isEmpty())
        assertEquals(listOf(SBX_AT), sandboxNeeds("\n".repeat(79) + "// @matchi-needs at.read").caps)
    }

    @Test fun badLinesGrantNothingAndAreReported() {
        val n = sandboxNeeds(
            """
            // @matchi-needs root
            // @matchi-needs at.read: yes
            // @matchi-needs router:
            // @matchi-needs router: ok_one, bad field, a;b
            // @matchi-needs net: https://evil.com/path
            // @matchi-needs net: a..b
            // @matchi-needs net: *.example.com
            // @matchi-needs shell:
            """.trimIndent(),
        )
        assertEquals(listOf("sbx:router:ok_one"), n.caps)
        assertEquals(8, n.problems.size)
    }

    @Test fun aHttpsPrefixOnAHostIsDropped() {
        assertEquals(listOf("sbx:net:api.example.com"), sandboxNeeds("// @matchi-needs net: https://api.example.com").caps)
    }

    @Test fun shellIsAskedAboutDangerAndLimits() {
        val danger: (String) -> String? = { if (it.contains("mkfs")) "writes raw to a disk" else null }
        val n = sandboxNeeds("// @matchi-needs shell: mkfs /dev/x\n// @matchi-needs shell: id", danger)
        assertEquals(listOf("sbx:shell:id"), n.caps)
        assertEquals(1, n.problems.size)
        assertTrue(n.problems[0].contains("writes raw to a disk"))
        assertEquals(1, sandboxNeeds("// @matchi-needs shell: " + "x".repeat(301)).problems.size)
        assertTrue(sandboxNeeds("// @matchi-needs shell: " + "x".repeat(300)).problems.isEmpty())
        assertEquals(1, sandboxNeeds("// @matchi-needs shell: a\u0001b").problems.size)
    }

    @Test fun commandTextIsKeptExactlyIncludingColons() {
        assertEquals(listOf("sbx:shell:ls /a:b"), sandboxNeeds("// @matchi-needs shell: ls /a:b").caps)
    }

    @Test fun countsAreCapped() {
        val fields = (1..25).joinToString(",") { "f$it" }
        val n = sandboxNeeds("// @matchi-needs router: $fields")
        assertEquals(SBX_MAX_ROUTER, n.caps.size)
        assertEquals(5, n.problems.size)
        val shells = (1..12).joinToString("\n") { "// @matchi-needs shell: echo $it" }
        assertEquals(SBX_MAX_SHELL, sandboxNeeds(shells).caps.size)
        val nets = (1..12).joinToString("\n") { "// @matchi-needs net: h$it.com" }
        assertEquals(SBX_MAX_NET, sandboxNeeds(nets).caps.size)
    }

    @Test fun repeatsAreListedOnce() {
        assertEquals(listOf("sbx:at.read", "sbx:shell:id"), sandboxNeeds("// @matchi-needs at.read\n// @matchi-needs at.read\n// @matchi-needs shell: id\n// @matchi-needs shell: id").caps)
    }

    @Test fun effectiveCapsFollowTheMode() {
        val src = "// @matchi-needs at.read\nrunShellWithRoot('id'); fetch('https://a.com')"
        assertEquals(listOf("sbx:at.read"), effectiveCaps(src, listOf("a.com"), true))
        assertEquals(listOf("root", "net", "host:a.com"), effectiveCaps(src, listOf("a.com"), false))
    }

    @Test fun anUpdateThatAsksForMoreIsSeenAsAddedCaps() {
        val before = sandboxNeeds("// @matchi-needs at.read").caps
        val after = sandboxNeeds("// @matchi-needs at.read\n// @matchi-needs shell: reboot").caps
        assertEquals(listOf("sbx:shell:reboot"), addedCaps(before, after))
    }

    @Test fun grantNeedsTheApprovedFileAndOnlyTakesSandboxEntries() {
        val rec = listOf("sbx:at.read", "root", "host:a.com")
        assertEquals(listOf("sbx:at.read"), sandboxGrant(rec, "ok"))
        assertTrue(sandboxGrant(rec, "changed").isEmpty())
        assertTrue(sandboxGrant(rec, "untracked").isEmpty())
        assertTrue(sandboxGrant(null, "ok").isEmpty())
    }

    @Test fun capabilityLinesAreReadable() {
        assertEquals("in the sandbox: reads the modem with read-only AT commands", describeCap(SBX_AT))
        assertEquals("in the sandbox: reads router field signalbar", describeCap("sbx:router:signalbar"))
        assertEquals("in the sandbox: runs this root command: cat /proc/uptime", describeCap("sbx:shell:cat /proc/uptime"))
        assertEquals("in the sandbox: contacts api.example.com", describeCap("sbx:net:api.example.com"))
        assertEquals("runs root commands", describeCap("root"))
    }

    private val full = listOf("sbx:at.read", "sbx:router:signalbar", "sbx:shell:cat /proc/uptime", "sbx:net:a.com")

    @Test fun hostAllowsWhatWasApproved() {
        assertEquals(null, sandboxCallError(full, "at", listOf("AT+CSQ")))
        assertEquals(null, sandboxCallError(full, "at", listOf("AT+COPS?")))
        assertEquals(null, sandboxCallError(full, "router.get", listOf("signalbar")))
        assertEquals(null, sandboxCallError(full, "router.get", listOf(" signalbar ")))
        assertEquals(null, sandboxCallError(full, "shell", listOf("cat /proc/uptime")))
    }

    @Test fun hostRefusesWithoutAGrant() {
        for (op in listOf("at", "router.get", "shell")) assertTrue(op, sandboxCallError(emptyList(), op, listOf("AT+CSQ", "x").take(1)) != null)
        // a file that changed gets an empty grant from sandboxGrant, so every call is refused
        val changed = sandboxGrant(full, "changed")
        assertTrue(sandboxCallError(changed, "shell", listOf("cat /proc/uptime")) != null)
    }

    @Test fun hostRefusesWritesChainsAndExtras() {
        assertTrue(sandboxCallError(full, "at", listOf("AT+CFUN=0")) != null)
        assertTrue(sandboxCallError(full, "at", listOf("AT+CSQ;AT+CFUN=0")) != null)
        assertTrue(sandboxCallError(full, "at", emptyList()) != null)
        assertTrue(sandboxCallError(full, "at", listOf("AT+CSQ", "AT")) != null)
        assertTrue(sandboxCallError(full, "router.get", listOf("signalbar", "wifi_password")) != null)
        assertTrue(sandboxCallError(full, "router.get", emptyList()) != null)
        assertTrue(sandboxCallError(full, "router.get", List(21) { "signalbar" }) != null)
        assertTrue(sandboxCallError(full, "shell", listOf("cat /proc/uptime; id")) != null)
        assertTrue(sandboxCallError(full, "shell", listOf("cat /proc/uptime ")) != null)
        assertTrue(sandboxCallError(full, "shell", listOf("id")) != null)
        assertTrue(sandboxCallError(full, "shell", emptyList()) != null)
        assertTrue(sandboxCallError(full, "shell", listOf("cat /proc/uptime", "id")) != null)
        assertEquals("unknown operation", sandboxCallError(full, "fetch", listOf("x")))
    }
}

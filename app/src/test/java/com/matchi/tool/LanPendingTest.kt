package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LanPendingTest {
    private val good = """{"old":{"ip":"192.168.0.1","mask":"255.255.255.0","start":"192.168.0.2","end":"192.168.0.253","lease":24},"new":{"ip":"192.168.1.1","mask":"255.255.255.0","start":"192.168.1.2","end":"192.168.1.253","lease":24},"at":1000000}"""
    private val note = LanPending.parse(good)!!
    private fun seen(ip: String = "192.168.1.1", on: Boolean = true, start: String = "192.168.1.2", end: String = "192.168.1.253", lease: Int = 24) =
        LanPending.Seen(ip, "255.255.255.0", on, start, end, lease)
    private val t0 = 1_000_000L + 60_000L

    @Test fun aWellFormedNoteParses() {
        assertEquals("192.168.0.1", note.old.ip); assertEquals("192.168.1.1", note.new.ip); assertEquals(24, note.new.lease); assertEquals(1000000L, note.at)
    }

    @Test fun badNotesAreRefused() {
        for (t in listOf("", "garbage", "{}", "{\"old\":{},\"new\":{}}", good.replace("192.168.1.1\",\"mask", "8.8.8.8\",\"mask"), good.replace("\"lease\":24},\"new\"", "\"lease\":0},\"new\""),
            good.replace("192.168.0.253", "192.168.0.256"), good.replace("192.168.0.1\",\"mask", "192.168.0.1:80\",\"mask"), good.replace("\"192.168.0.2\"", "\"192.168.00.2\"")))
            assertNull(t, LanPending.parse(t))
        assertNull(LanPending.parse(null))
    }

    @Test fun seenIsReadFromTheRoutersReply() {
        val s = LanPending.seenFrom("""{"lan_ipaddr":"192.168.1.1","lan_netmask":"255.255.255.0","dhcpEnabled":"1","dhcpStart":"192.168.1.2","dhcpEnd":"192.168.1.253","dhcpLease_hour":"24h"}""")!!
        assertEquals(seen(), s); assertTrue(LanPending.matches(note.new, s))
        assertFalse(LanPending.seenFrom("""{"dhcpEnabled":"0"}""")!!.dhcpOn)
        assertNull(LanPending.seenFrom("not json"))
    }

    @Test fun matchesNeedsEveryValue() {
        assertTrue(LanPending.matches(note.new, seen()))
        assertFalse(LanPending.matches(note.new, seen(ip = "192.168.0.1")))
        assertFalse(LanPending.matches(note.new, seen(on = false)))
        assertFalse(LanPending.matches(note.new, seen(start = "192.168.1.50")))
        assertFalse(LanPending.matches(note.new, seen(end = "192.168.1.200")))
        assertFalse(LanPending.matches(note.new, seen(lease = 12)))
    }

    @Test fun decisionTable() {
        val V = LanPending.Verdict
        assertEquals(V.KEEP_NEW, LanPending.decide(note, t0, true, seen(), false, false))
        assertEquals(V.REVERT, LanPending.decide(note, t0, true, seen(start = "192.168.1.50"), false, false))
        assertEquals(V.REVERT, LanPending.decide(note, t0, true, seen(on = false), false, false))
        assertEquals(V.WAIT, LanPending.decide(note, t0, true, null, false, false))
        assertEquals(V.KEEP_NEW, LanPending.decide(note, t0, true, null, false, true))          // answers but unreadable at the end: never revert blind
        assertEquals(V.USE_OLD, LanPending.decide(note, t0, false, null, true, false))
        assertEquals(V.WAIT, LanPending.decide(note, t0, false, null, false, false))
        assertEquals(V.GIVE_UP, LanPending.decide(note, t0, false, null, false, true))
    }

    @Test fun aStaleNoteIsNeverActedOn() {
        val V = LanPending.Verdict
        assertEquals(V.EXPIRED, LanPending.decide(note, note.at + LanPending.MAX_AGE_MS + 1, true, seen(start = "x"), false, true))
        assertEquals(V.KEEP_NEW, LanPending.decide(note, note.at + LanPending.MAX_AGE_MS, true, seen(), false, false))
        assertEquals(V.EXPIRED, LanPending.decide(note.copy(at = 0L), t0, true, seen(), false, false))
        assertEquals(V.KEEP_NEW, LanPending.decide(note, note.at - 5_000, true, seen(), false, false))   // clock went back a little: not stale
    }

    @Test fun revertSendsTheOldWholeSet() {
        val p = LanPending.revertParams(note)
        assertEquals(mapOf("goformId" to "DHCP_SETTING", "lanIp" to "192.168.0.1", "lanNetmask" to "255.255.255.0", "lanDhcpType" to "SERVER", "dhcpStart" to "192.168.0.2",
            "dhcpEnd" to "192.168.0.253", "dhcpLease" to "24", "dhcp_reboot_flag" to "1", "mac_ip_reset" to "1"), p)
        assertEquals("0", LanPending.revertParams(note.copy(new = note.new.copy(ip = note.old.ip)))["mac_ip_reset"])
    }

    @Test fun savedPortIsKept() {
        assertEquals("192.168.1.1", LanPending.hostWithIp("192.168.0.1", "192.168.1.1"))
        assertEquals("192.168.1.1:8080", LanPending.hostWithIp("192.168.0.1:8080", "192.168.1.1"))
    }

    @Test fun theConsoleMayOnlyFollowTheNewAddressOfTheNote() {
        assertTrue(LanPending.appliedOk(note, "192.168.1.1"))
        assertFalse(LanPending.appliedOk(note, "192.168.1.2"))
        assertFalse(LanPending.appliedOk(note, "192.168.0.1"))
        assertFalse(LanPending.appliedOk(null, "192.168.1.1"))
        assertFalse(LanPending.appliedOk(note, "8.8.8.8"))
        assertNotNull(note)
    }
}

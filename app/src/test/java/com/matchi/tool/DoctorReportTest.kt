package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class DoctorReportTest {
    // Shape and values taken from a run on the F50 (MU300, 19 Nov 2026).
    private val sample = """{"tool":"matchi-doctor 1.0 (MatchiTOOL)","arch":"arm64","generated":1795071347,
      "summary":{"fail":0,"ok":2,"skip":0,"warn":1},
      "checks":[{"id":"root","title":"Root","status":"ok","detail":"running as uid 0","data":{"uid":0}},
                {"id":"selinux","title":"SELinux","status":"ok","detail":"Permissive","data":{"mode":"permissive"}},
                {"id":"at","title":"Modem AT, slot 0","status":"warn","detail":"the pinned port /dev/stty_nr0 is held by urild (pid 667); not touched","hint":"Pin a free port"}]}"""

    @Test fun readsTheSummaryAndEveryCheck() {
        val p = DoctorReport.parse("su banner\n$sample\n")!!
        assertEquals(listOf(2, 1, 0, 0), listOf(p.ok, p.warn, p.fail, p.skip))
        assertEquals(listOf("root", "selinux", "at"), p.checks.map { it.id })
        assertEquals("Pin a free port", p.checks[2].hint)
        assertEquals("arm64", p.json.getString("arch"))
    }

    @Test fun sectionIsTheSummaryThenOneLinePerCheck() {
        val s = DoctorReport.section(DoctorReport.parse(sample)!!).lines()
        assertEquals("summary: 2 ok, 1 warn, 0 fail, 0 skip", s[0])
        assertEquals("[ok] Root - running as uid 0", s[1])
        assertEquals(4, s.size)
    }

    @Test fun damagedOrMissingReportsGiveNull() {
        assertNull(DoctorReport.parse(""))
        assertNull(DoctorReport.parse("{\"summary\":{}}"))
        assertNull(DoctorReport.parse("{not json}"))
        assertNotNull(DoctorReport.parse("{\"summary\":{\"ok\":0},\"checks\":[]}"))
    }
}

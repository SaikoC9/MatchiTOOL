package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class GateDeclTest {
    private fun p(line: String) = parseGateDecl("// @matchi-name X\n$line\nvar a = 1;\n", 2334)
    private fun err(line: String): String { val r = p(line); assertNull(r.decl); return r.error ?: error("no error for: $line") }

    @Test fun fullLineIsRead() {
        val d = p("// @matchi-gate name=adguard port=3000 logout=/control/logout idle=3600 tabclose=off").decl!!
        assertEquals("adguard", d.name); assertEquals(3000, d.port); assertEquals("/control/logout", d.logout)
        assertEquals(3600, d.idleS); assertEquals(3_600_000L, d.idleMs); assertFalse(d.tabClose)
    }

    @Test fun onlyNameAndPortAreRequiredAndDefaultsApply() {
        val d = p("// @matchi-gate name=panel port=8080").decl!!
        assertNull(d.logout); assertEquals(GATE_IDLE_DEFAULT_S, d.idleS); assertFalse(d.tabClose)
        assertTrue(p("// @matchi-gate name=a port=8080 tabclose=on").decl!!.tabClose)
    }

    @Test fun noLineMeansNoGateAndNoError() {
        val r = parseGateDecl("var x = 1;\n", 2334); assertNull(r.decl); assertNull(r.error)
    }

    @Test fun mentionInsideCodeIsNotAHeader() {
        val r = parseGateDecl("var s = '// @matchi-gate name=a port=8080';\n", 2334); assertNull(r.decl); assertNull(r.error)
    }

    @Test fun lineBeyondFirst400LinesIsIgnored() {
        val code = "\n".repeat(400) + "// @matchi-gate name=a port=8080\n"
        assertNull(parseGateDecl(code, 2334).decl)
    }

    @Test fun badThingsFailClosed() {
        assertNotNull(err("// @matchi-gate port=8080"))                                  // no name
        assertNotNull(err("// @matchi-gate name=a"))                                     // no port
        assertNotNull(err("// @matchi-gate name=A port=8080"))                           // upper case
        assertNotNull(err("// @matchi-gate name=a_b port=8080"))
        assertNotNull(err("// @matchi-gate name=${"a".repeat(33)} port=8080"))
        assertNotNull(err("// @matchi-gate name=a port=80"))                            // below 1024
        assertNotNull(err("// @matchi-gate name=a port=70000"))
        assertNotNull(err("// @matchi-gate name=a port=80x"))
        assertNotNull(err("// @matchi-gate name=a port=2334"))                          // the console
        assertNotNull(err("// @matchi-gate name=a port=3100"))                          // a gate's own range
        assertNotNull(err("// @matchi-gate name=a port=3199"))
        assertNotNull(err("// @matchi-gate name=a port=8080 skipauth=1"))               // unknown field: a plugin cannot weaken the rules
        assertNotNull(err("// @matchi-gate name=a port=8080 port=8081"))                // twice
        assertNotNull(err("// @matchi-gate name=a port=8080 logout=control/logout"))
        assertNotNull(err("// @matchi-gate name=a port=8080 logout=//evil.example/x"))
        assertNotNull(err("// @matchi-gate name=a port=8080 idle=299"))
        assertNotNull(err("// @matchi-gate name=a port=8080 idle=43201"))
        assertNotNull(err("// @matchi-gate name=a port=8080 idle=soon"))
        assertNotNull(err("// @matchi-gate name=a port=8080 tabclose=yes"))
        assertNotNull(err("// @matchi-gate name=a port=8080 junk"))
        assertNotNull(err("// @matchi-gate name= port=8080"))
    }

    @Test fun idleLimitsAreInclusive() {
        assertEquals(300, p("// @matchi-gate name=a port=8080 idle=300").decl!!.idleS)
        assertEquals(43200, p("// @matchi-gate name=a port=8080 idle=43200").decl!!.idleS)
    }

    @Test fun twoLinesAreRefused() {
        val r = parseGateDecl("// @matchi-gate name=a port=8080\n// @matchi-gate name=b port=8081\n", 2334)
        assertNull(r.decl); assertNotNull(r.error)
    }

    @Test fun sameAsComparesEveryField() {
        val a = p("// @matchi-gate name=a port=8080 logout=/x idle=600").decl!!
        assertTrue(a.sameAs(p("// @matchi-gate name=a port=8080 logout=/x idle=600").decl!!))
        assertFalse(a.sameAs(p("// @matchi-gate name=a port=8081 logout=/x idle=600").decl!!))
        assertFalse(a.sameAs(p("// @matchi-gate name=a port=8080 logout=/y idle=600").decl!!))
        assertFalse(a.sameAs(p("// @matchi-gate name=a port=8080 logout=/x idle=601").decl!!))
        assertFalse(a.sameAs(p("// @matchi-gate name=a port=8080 logout=/x idle=600 tabclose=on").decl!!))
    }

    // ---- port table ----
    @Test fun portsAreLowestFreeAndStablePerName() {
        val t = GatePortTable()
        assertEquals(3100, t.portFor("a")); assertEquals(3101, t.portFor("b")); assertEquals(3100, t.portFor("a"))
        t.forget("a"); assertEquals(3100, t.portFor("c")); assertEquals(3101, t.portFor("b"))
    }

    @Test fun skippedPortIsNotReturnedAndReplacesTheOld() {
        val t = GatePortTable()
        assertEquals(3100, t.portFor("a"))
        assertEquals(3101, t.portFor("a", setOf(3100)))
        assertEquals(3101, t.portFor("a"))
        assertEquals(3100, t.portFor("b"))             // the freed 3100 goes to the next name
    }

    @Test fun rangeFullGivesNull() {
        val t = GatePortTable()
        for (i in 0 until 100) assertNotNull(t.portFor("g$i"))
        assertNull(t.portFor("one-more"))
        assertEquals(3199, t.portFor("g99"))
    }

    @Test fun savedTableSurvivesEncodeDecodeAndIgnoresJunk() {
        val t = GatePortTable(); t.portFor("a"); t.portFor("b")
        val back = GatePortTable(GatePortTable.decode(GatePortTable.encode(t.snapshot())))
        assertEquals(3101, back.portFor("b")); assertEquals(3100, back.portFor("a"))
        val bad = GatePortTable(GatePortTable.decode("x=80,y=3105,y2=3105,BAD NAME=3110,,=3,z=abc"))
        assertEquals(mapOf("y" to 3105), bad.snapshot())     // out of range, duplicate port, bad name, bad number: all dropped
    }

    @Test fun targetProblemRules() {
        assertNull(gateTargetProblem(3000, 2334)); assertNull(gateTargetProblem(1024, 2334)); assertNull(gateTargetProblem(65535, 2334))
        assertNotNull(gateTargetProblem(1023, 2334)); assertNotNull(gateTargetProblem(2334, 2334)); assertNotNull(gateTargetProblem(3150, 2334))
    }

    @Test fun uploadCheck() {
        assertNull(gateUploadProblem("a.js", "var x=1;", 2334))                                            // no line: fine
        assertNull(gateUploadProblem("a.js", "// @matchi-gate name=a port=8080\n", 2334))
        assertNull(gateUploadProblem("a.html", "<p>no gate</p>", 2334))
        assertTrue(gateUploadProblem("a.js", "// @matchi-gate name=a port=3100\n", 2334)!!.startsWith("invalid @matchi-gate line"))
        assertTrue(gateUploadProblem("a.js", "// @matchi-gate name=a port=8080 skipauth=1\n", 2334)!!.contains("unknown field"))
        assertNotNull(gateUploadProblem("a.html", "// @matchi-gate name=a port=8080\n", 2334))              // .html cannot declare a gate
    }
}

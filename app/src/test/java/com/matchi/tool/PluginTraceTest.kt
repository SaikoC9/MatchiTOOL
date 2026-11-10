package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files

class PluginTraceTest {
    @Test fun redirectionsAndFileCommandsAreWriteTargets() {
        assertEquals(listOf("/data/local/tmp/foo.txt"), pluginWriteTargets("echo 1 > /data/local/tmp/foo.txt"))
        assertEquals(listOf("/data/local/tmp/foo.txt"), pluginWriteTargets("echo 1 >>/data/local/tmp/foo.txt"))
        assertEquals(listOf("/sdcard/big.bin"), pluginWriteTargets("dd if=/dev/zero of=/sdcard/big.bin bs=1M count=1"))
        assertEquals(listOf("/data/local/tmp/x.json"), pluginWriteTargets("curl -s -o /data/local/tmp/x.json https://h/x"))
        assertEquals(listOf("/data/local/tmp/x.json"), pluginWriteTargets("curl -fsSLo /data/local/tmp/x.json https://h/x"))
        assertEquals(listOf("/sdcard/p/y"), pluginWriteTargets("wget -O /sdcard/p/y https://h/y"))
        assertEquals(listOf("/sdcard/p"), pluginWriteTargets("unzip a.zip -d /sdcard/p"))
    }

    @Test fun sourcesThatAreOnlyReadAreNotListed() {
        assertEquals(emptyList<String>(), pluginWriteTargets("cat /sdcard/foo.txt"))
        assertEquals(emptyList<String>(), pluginWriteTargets("ls /sdcard/DCIM; cat /data/local/x | grep y"))
        assertEquals(listOf("/sdcard/MyPlug/a/x.jpg"), pluginWriteTargets("cp /sdcard/DCIM/x.jpg /sdcard/MyPlug/a/x.jpg"))
    }

    @Test fun followsShellWrappersAndVariables() {
        val cmd = "su -c \"D=/data/local/myplug; mkdir -p \$D; echo hi >> \$D/log\""
        assertEquals(listOf("/data/local/myplug", "/data/local/myplug/log"), pluginWriteTargets(cmd))
        assertEquals(listOf("/data/local/tmp/q"), pluginWriteTargets("timeout 5 touch /data/local/tmp/q"))
        assertEquals(listOf("/data/local/tmp/q"), pluginWriteTargets("nohup sh -c 'mkdir /data/local/tmp/q' &"))
    }

    @Test fun unresolvedVariablesStayUnresolved() {
        assertEquals(listOf("/data/local/\$X/a"), pluginWriteTargets("mkdir /data/local/\$X/a"))
        assertTrue(checkPluginDataPath("/data/local/\$X/a", "foo.js") != null)
    }

    @Test fun listsSideEffectsThatFileErasingCannotUndo() {
        assertEquals(setOf("firewall rules"), pluginSideEffects("iptables -A INPUT -j DROP"))
        assertEquals(setOf("system properties"), pluginSideEffects("setprop persist.x 1"))
        assertTrue("background processes" in pluginSideEffects("nohup sh /data/local/tmp/x.sh &"))
        assertTrue("boot script lines" in pluginSideEffects("echo 'x' >> /data/local/matchitool/boot.sh"))
        assertEquals(emptySet<String>(), pluginSideEffects("ls -l /sdcard"))
    }

    @Test fun ledgerKeepsPathsEffectsAndUploadsPerPlugin() {
        val dir = Files.createTempDirectory("trace").toFile()
        try {
            val s = PluginTraceStore(dir)
            s.record("A.js", listOf("/sdcard/a", "/sdcard/a"), listOf("firewall rules"), listOf("up.png"))
            s.record("A.js", listOf("/sdcard/b"), emptyList())
            s.record("B.js", listOf("/sdcard/other"), emptyList())
            val a = s.read("A.js")
            assertEquals(listOf("/sdcard/a", "/sdcard/b"), a.paths)
            assertEquals(listOf("firewall rules"), a.effects)
            assertEquals(listOf("up.png"), a.uploads)
            assertEquals(listOf("/sdcard/other"), s.read("B.js").paths)
            s.clear("A.js")
            assertEquals(emptyList<String>(), s.read("A.js").paths)
            assertEquals(listOf("/sdcard/other"), s.read("B.js").paths)
            // a bad name never touches the disk
            s.record("../evil.js", listOf("/sdcard/x"), emptyList())
            assertEquals(emptyList<String>(), s.read("../evil.js").paths)
        } finally { dir.deleteRecursively() }
    }

    @Test fun onlyPluginFileNamesAreAcceptedFromTheHeader() {
        assertEquals("My_Plugin.js", tracePluginName("My_Plugin.js"))
        assertNull(tracePluginName("../x.js"))
        assertNull(tracePluginName("a b.js"))
        assertNull(tracePluginName(null))
        assertNull(tracePluginName("noext"))
    }

    @Test fun emptyParentFoldersAreFoundButProtectedOnesAreNot() {
        assertEquals(listOf("/data/local/tmp/a"), prunableParents("/data/local/tmp/a/b", "foo.js"))
        assertEquals(emptyList<String>(), prunableParents("/sdcard/Download/foo", "foo.js"))
        assertEquals(listOf("/sdcard/Foo"), prunableParents("/sdcard/Foo/bar", "foo.js"))
        assertEquals(emptyList<String>(), prunableParents("/data/local/xyz", "foo.js"))
        assertEquals(listOf("/data/local/matchitool/plugin_data/foo"), prunableParents("/data/local/matchitool/plugin_data/foo/a", "foo.js"))
    }
}

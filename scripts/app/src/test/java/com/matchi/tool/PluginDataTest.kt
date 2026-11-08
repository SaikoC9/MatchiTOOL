package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class PluginDataTest {
    @Test fun ownDataFolderIsNamedAfterThePlugin() {
        assertEquals("/data/local/matchitool/plugin_data/My_Plugin", pluginDataDir("My_Plugin.js"))
    }

    @Test fun readsDeclarationsFromHeaderLines() {
        val code = "// @matchi-data /data/local/myplug\n//  @matchi-data   /sdcard/myplug_out  \nvar x = 1;\n// @matchi-data /data/local/myplug\n"
        assertEquals(listOf("/data/local/myplug", "/sdcard/myplug_out"), pluginDataDeclarations(code))
        assertEquals(emptyList<String>(), pluginDataDeclarations("var s = '// @matchi-data /x'; // note @matchi-data /y"))
    }

    @Test fun allowsPluginOwnedFolders() {
        for (p in listOf("/data/local/matchitool/plugin_data/foo", "/data/local/myplug", "/data/local/tmp/myplug",
            "/sdcard/myplug", "/storage/emulated/0/myplug", "/sdcard/Download/myplug"))
            assertNull(p, checkPluginDataPath(p, "foo.js"))
    }

    @Test fun refusesAnythingBroadOrOwnedByMatchiTool() {
        for (p in listOf("/", "/data", "/data/local", "/data/local/", "/data/local/tmp", "/data/local/matchitool",
            "/data/local/matchitool/boot.sh", "/data/local/matchitool/boot.d", "/data/local/matchitool/plugin_data",
            "/data/local/ufi_ttl", "/data/local/ufi_dpi/x", "/data/local/tmp/matchi_update.log", "/data/local/tmp/.matchi_out_1",
            "/data/local/tmp/mt_isms.sh", "/sdcard", "/sdcard/", "/sdcard/Download", "/sdcard/DCIM", "/sdcard/Android/data/x",
            "/storage/emulated/0/Pictures", "/system/bin", "/data/data/com.matchi.tool", "relative/path",
            "/data/local/x/../../system", "/data/local/a b", "/data/local/a;rm", "/data/local/*", "/data/local/x'y",
            "/data/local//x", "/data/local/x/", "/data/local/\$HOME"))
            assertNotNull(p, checkPluginDataPath(p, "foo.js"))
    }

    @Test fun aPluginCannotEraseAnotherPluginsData() {
        assertNotNull(checkPluginDataPath("/data/local/matchitool/plugin_data/bar", "foo.js"))
        assertNotNull(checkPluginDataPath("/data/local/matchitool/plugin_data/foobar", "foo.js"))
        assertNotNull(checkPluginDataPath("/data/local/matchitool/plugins/bar.js", "foo.js"))
        assertNull(checkPluginDataPath("/data/local/matchitool/plugin_data/foo/cache", "foo.js"))
    }

    @Test fun listsParentFoldersToCheckForSymlinks() {
        assertEquals(listOf("/data/local/tmp"), symlinkAncestors("/data/local/tmp/myplug"))
        assertEquals(emptyList<String>(), symlinkAncestors("/data/local/myplug"))
        assertEquals(listOf("/sdcard/a"), symlinkAncestors("/sdcard/a/b"))
        assertEquals(listOf("/storage/emulated/0/a"), symlinkAncestors("/storage/emulated/0/a/b"))
    }
}

class UploadSpaceTest {
    @Test fun needsBodyPlusReserve() {
        val mb = 1024L * 1024L
        org.junit.Assert.assertTrue(uploadSpaceOk(1000 * mb, 512 * mb))
        org.junit.Assert.assertFalse(uploadSpaceOk(600 * mb, 512 * mb))
        org.junit.Assert.assertFalse(uploadSpaceOk(100 * mb, 1 * mb))
        org.junit.Assert.assertFalse(uploadSpaceOk(10_000 * mb, -1))
    }
}

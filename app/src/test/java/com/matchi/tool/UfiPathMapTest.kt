package com.matchi.tool

import org.junit.Assert.assertEquals
import org.junit.Test

class UfiPathMapTest {
    private val pkg = "com.matchi.tool"
    private fun m(s: String) = UfiPathMap.map(s, pkg)

    @Test fun bootScriptGoesToMatchiBoot() {
        assertEquals("echo x >> /data/local/matchitool/boot.sh", m("echo x >> /sdcard/ufi_tools_boot.sh"))
        assertEquals("cat /data/local/matchitool/boot.sh", m("cat /storage/emulated/0/ufi_tools_boot.sh"))
        assertEquals("awk '{print}' /data/local/matchitool/boot.sh;", m("awk '{print}' /sdcard/ufi_tools_boot.sh;"))
    }

    @Test fun longerBootNamesAreLeftAlone() {
        assertEquals("cp /sdcard/ufi_tools_boot.sh.bak /tmp/a", m("cp /sdcard/ufi_tools_boot.sh.bak /tmp/a"))
        assertEquals("ls /sdcard/ufi_tools_boot.sh2", m("ls /sdcard/ufi_tools_boot.sh2"))
    }

    @Test fun ufiFilesFolderBecomesThisApp() {
        assertEquals("ls /data/data/com.matchi.tool/files/uploads/a.zip", m("ls /data/data/com.minikano.f50_sms/files/uploads/a.zip"))
        assertEquals("/data/data/com.matchi.tool/files/curl -V", m("/data/data/com.minikano.f50_sms/files/curl -V"))
        assertEquals("ls /data/data/com.matchi.tool", m("ls /data/user/0/com.minikano.f50_sms"))
    }

    @Test fun otherPackagesAndPlainCommandsAreUntouched() {
        assertEquals("ls /data/data/com.minikano.f50_sms2/files", m("ls /data/data/com.minikano.f50_sms2/files"))
        assertEquals("ls /data/data/other.app/files", m("ls /data/data/other.app/files"))
        assertEquals("echo hello", m("echo hello"))
        assertEquals("", m(""))
    }

    @Test fun everyOccurrenceIsRewritten() {
        assertEquals(
            "mv /data/data/com.matchi.tool/files/uploads/a /data/data/com.matchi.tool/files/uploads/b",
            m("mv /data/data/com.minikano.f50_sms/files/uploads/a /data/data/com.minikano.f50_sms/files/uploads/b"),
        )
    }
}

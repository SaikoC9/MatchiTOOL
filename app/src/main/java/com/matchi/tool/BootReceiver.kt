package com.matchi.tool

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/** On boot only start the web server. The root daemon is started from /sdcard/ufi_tools_boot.sh (run at boot by UFI-TOOLS). */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        if (i.action != Intent.ACTION_BOOT_COMPLETED) return
        val svc = Intent(c, HostService::class.java)
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(svc) else c.startService(svc)
    }
}

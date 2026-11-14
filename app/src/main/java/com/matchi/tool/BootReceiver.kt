package com.matchi.tool

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/** Restarts the app's web host after boot and after an app update. Root access remains managed by Android's su manager. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        val service = Intent(context, HostService::class.java).setAction(HostService.ACTION_RUN_BOOT_TASKS)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(service)
        else context.startService(service)
    }
}

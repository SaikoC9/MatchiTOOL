package com.matchi.tool

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * Restarts the app's web host after boot and after an app update. Root access remains managed by Android's su manager.
 * After a boot the boot tasks run too; after an update only the host restarts (the boot scripts already ran at boot, and their
 * background jobs survive the update, so running them again could start them twice).
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED -> HostService.ACTION_RUN_BOOT_TASKS
            Intent.ACTION_MY_PACKAGE_REPLACED -> HostService.ACTION_AFTER_UPDATE
            else -> return
        }
        if (!DeviceGate.supported) return   // ZTE F50 only
        val service = Intent(context, HostService::class.java).setAction(action)
        // Android may refuse a background start of a foreground service; that must never crash the app.
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(service)
            else context.startService(service)
        } catch (e: Exception) {
            LogCatcher.log("WARNING", "BootReceiver", "Could not start the host after ${intent.action}: ${e.javaClass.simpleName}: ${e.message}")
        }
    }
}

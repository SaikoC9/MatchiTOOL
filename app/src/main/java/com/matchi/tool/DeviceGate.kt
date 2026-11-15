package com.matchi.tool

import android.os.Build

/**
 * MatchiTOOL is built for the ZTE F50 only. The device must say ZTE in its manufacturer or brand AND F50 in its model, device
 * or product name (any letter case); see [DeviceRule]. On any other device the app shows a message and the web host never starts.
 */
object DeviceGate {
    val supported: Boolean by lazy { DeviceRule.isSupported(Build.MANUFACTURER, Build.BRAND, Build.MODEL, Build.DEVICE, Build.PRODUCT) }

    /** What this device reports, shown on the "not supported" screen so a wrong match can be reported. */
    fun describe(): String =
        "manufacturer: ${Build.MANUFACTURER}\nbrand: ${Build.BRAND}\nmodel: ${Build.MODEL}\ndevice: ${Build.DEVICE}\nproduct: ${Build.PRODUCT}"
}

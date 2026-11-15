package com.matchi.tool

/** The pure ZTE F50 rule (no Android classes, so the pure-Kotlin test script can compile and run its test). */
object DeviceRule {
    fun isSupported(manufacturer: String?, brand: String?, model: String?, device: String?, product: String?): Boolean {
        fun has(s: String?, word: String) = s?.contains(word, ignoreCase = true) == true
        val zte = has(manufacturer, "zte") || has(brand, "zte")
        val f50 = has(model, "f50") || has(device, "f50") || has(product, "f50")
        return zte && f50
    }
}

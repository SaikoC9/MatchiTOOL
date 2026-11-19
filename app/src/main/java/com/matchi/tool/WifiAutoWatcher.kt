package com.matchi.tool

/** Everything the watcher needs from the router. The real one (shell, state file, router calls) is wired in separately; tests use a fake. */
interface WifiAutoPort {
    fun link(): TetherLink
    /** Real read-back of the hotspot, null when it cannot be read. */
    fun wifiOn(): Boolean?
    fun hasState(): Boolean
    /** Create the "we turned it off" file. False when it could not be written. */
    fun writeState(): Boolean
    fun clearState()
    /** Turn Wi-Fi off and read the result back. True only when it really is off. */
    fun wifiOff(): Boolean
    /** Turn Wi-Fi on (same band as before) and read the result back. True only when it really is on. */
    fun wifiOnAgain(): Boolean
    fun log(message: String)
}

/**
 * One look at the router per [tick], then run what [WifiAutoRules] decided. Pure Kotlin (everything outside goes through [port]).
 *
 * Safety: Wi-Fi is never turned off unless the state file could be written first. A failed change is retried twice at once, then
 * left alone for [WifiAutoRules.RETRY_MS] and written to the log.
 */
class WifiAutoWatcher(private val port: WifiAutoPort, private val rules: WifiAutoRules = WifiAutoRules()) {
    companion object { const val ATTEMPTS = 3 }

    fun tick(nowMs: Long, sinceBootMs: Long, enabled: Boolean): WifiAutoAction {
        val holds = port.hasState()
        val action = rules.evaluate(nowMs, sinceBootMs, enabled, port.link(), port.wifiOn(), holds)
        when (action) {
            WifiAutoAction.NONE -> {}
            WifiAutoAction.TURN_OFF -> {
                val ok = (holds || port.writeState()) && attempt { port.wifiOff() }
                if (!ok) port.log("Wi-Fi could not be turned off (tethering is active)")
                rules.result(action, ok, nowMs)
            }
            WifiAutoAction.TURN_ON -> {
                val ok = attempt { port.wifiOnAgain() }
                if (ok) port.clearState() else port.log("Wi-Fi could not be turned back on")
                rules.result(action, ok, nowMs)
            }
            WifiAutoAction.DROP_STATE -> {
                port.clearState()
                rules.result(action, true, nowMs)
            }
        }
        return action
    }

    private fun attempt(run: () -> Boolean): Boolean {
        repeat(ATTEMPTS) { if (run()) return true }
        return false
    }
}

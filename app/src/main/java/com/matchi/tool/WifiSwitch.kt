package com.matchi.tool

import android.content.Context

/**
 * Turns the hotspot Wi-Fi off and on through the router's own web API ([ZteClient], the same sign-in the SMS and signal tools use).
 * The stock calls restore the exact stock setup (no idle shutdown, same band), unlike "cmd wifi start-softap".
 *
 * Every result is the READ-BACK of the router, never the reply of the call: the router can answer "success" or an empty body and
 * not have changed anything. A change is "done" only when the read-back shows it (it is polled for up to [WAIT_MS], the router is slow).
 * The router password must be saved ([ready]); without it the router refuses the call, so nothing is sent.
 *
 * Blocking: call from a worker thread only.
 */
object WifiSwitch {
    private const val POLL_MS = 1_000L
    private const val WAIT_MS = 15_000L

    /** True when the router password is saved (the calls cannot sign in without it). */
    fun ready(ctx: Context): Boolean = Prefs.ztePass(ctx).isNotEmpty()

    @Volatile private var lastReadNote = ""

    /** One read of the router; null when it cannot be read. The reason is written to the file trace once per kind (not every poll). */
    fun read(ctx: Context): WifiGoform.Seen? = try {
        val seen = WifiGoform.seenFrom(ZteClient.call(ctx, "get", WifiGoform.readParams()))
        noteRead(ctx, if (seen == null) "Wi-Fi read: reply not understood" else "")
        seen
    } catch (e: Exception) {
        LogCatcher.log("WARNING", "WifiSwitch", "Wi-Fi read failed: ${e.message}")
        noteRead(ctx, "Wi-Fi read failed: ${e.message}")
        if (e.message?.contains("unreachable") == true) WifiAutoTrace.noteNet(ctx)   // why: the router's own network state
        null
    }

    private fun noteRead(ctx: Context, text: String) {
        if (text == lastReadNote) return
        lastReadNote = text
        WifiAutoTrace.note(ctx, if (text.isEmpty()) "Wi-Fi read ok again" else text)
    }

    /** True / false from the real read-back, null when it cannot be told. */
    fun isOn(ctx: Context): Boolean? = WifiGoform.isOn(read(ctx))

    /** "2g" or "5g" when exactly one band is on, else null (nothing safe to remember). */
    fun band(ctx: Context): String? = WifiGoform.bandOf(read(ctx))

    /** Turn Wi-Fi off. True only when the read-back says it is off. */
    fun off(ctx: Context): Boolean = change(ctx, WifiGoform.OFF, WifiGoform.offParams())

    /** Turn Wi-Fi on, on [band] ("2g" or "5g"). True only when the read-back shows that band on. */
    fun on(ctx: Context, band: String): Boolean {
        val params = WifiGoform.onParams(band) ?: run {
            LogCatcher.log("WARNING", "WifiSwitch", "Wi-Fi not turned on: unknown band")
            return false
        }
        return change(ctx, band, params)
    }

    private fun change(ctx: Context, want: String, params: Map<String, String>): Boolean {
        if (!ready(ctx)) {
            LogCatcher.log("WARNING", "WifiSwitch", "Wi-Fi not changed: the router password is not saved")
            return false
        }
        if (WifiGoform.reached(read(ctx), want)) return true   // already as wanted: send nothing
        try {
            ZteClient.call(ctx, "set", params)   // the reply is not trusted, only the read-back below
        } catch (e: Exception) {
            LogCatcher.log("WARNING", "WifiSwitch", "Wi-Fi change to $want failed: ${e.message}")
            WifiAutoTrace.note(ctx, "Wi-Fi change to $want failed: ${e.javaClass.simpleName}")
            return false
        }
        WifiAutoTrace.note(ctx, "Wi-Fi change to $want sent")
        val end = System.currentTimeMillis() + WAIT_MS
        while (true) {
            try { Thread.sleep(POLL_MS) } catch (_: InterruptedException) { Thread.currentThread().interrupt(); return false }
            if (WifiGoform.reached(read(ctx), want)) { WifiAutoTrace.note(ctx, "Wi-Fi change to $want confirmed"); return true }
            if (System.currentTimeMillis() >= end) break
        }
        LogCatcher.log("WARNING", "WifiSwitch", "Wi-Fi change to $want: the router did not report it within ${WAIT_MS / 1000} s")
        WifiAutoTrace.note(ctx, "Wi-Fi change to $want not confirmed within ${WAIT_MS / 1000} s")
        return false
    }
}

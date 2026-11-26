package com.matchi.tool

import android.content.Context
import org.json.JSONObject

/**
 * Installs, refreshes and removes the uninstall reaper (assets/bin/matchi_reaper.sh): a small root watcher OUTSIDE the app sandbox that wipes what
 * MatchiTOOL left on the phone after Android has removed the app (docs/UNINSTALL_WIPE.md). Android runs no app code on uninstall, so this watcher
 * is the only way. The shell and path logic is in [ReaperModel] (pure, tested); this class only reads the asset, keeps the switch and runs the
 * root calls. Same pattern as [BootLogd].
 *
 * The switch is ON by default (decision D1). OFF removes the boot stub and stops the watcher, so nothing watches; uninstalling then leaves
 * the root-side files behind (the Settings text says so, Phase 6). Nothing here ever wipes anything: only the reaper does, and only when it has
 * seen the app gone three times in a row.
 */
object Reaper {
    private const val TAG = "Reaper"
    private const val PREFS = "matchi_reaper"
    private const val KEY_ENABLED = "enabled"

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun bundledScript(ctx: Context): String = ctx.assets.open("bin/matchi_reaper.sh").bufferedReader().use { it.readText() }

    /** The wipe switch. ON until the owner turns it off. */
    fun enabled(ctx: Context): Boolean = prefs(ctx).getBoolean(KEY_ENABLED, true)

    /** Writes the reaper and its boot stub, stops an older copy and starts the new one. One root call. Does not change the switch. */
    @Synchronized
    fun install(ctx: Context): JSONObject {
        val cmd = ReaperModel.installCommand(bundledScript(ctx))
            ?: return JSONObject().put("ok", false).put("error", "Bundled reaper script is invalid")
        val r = RootShell.run(ctx, cmd, 40_000)
        val ok = r.success && r.content.contains("INSTALLED=1")
        val running = ok && r.content.contains("RUNNING=1")
        LogCatcher.log(if (ok && running) "INFO" else "WARNING", TAG, "Reaper install: ${if (ok) "done" else "failed"}; running=$running")
        val res = JSONObject().put("ok", ok).put("running", running).put("output", r.content.take(600))
        if (!ok) res.put("error", r.content.lineSequence().firstOrNull { it.startsWith("ERROR=") }?.removePrefix("ERROR=") ?: "Install failed: ${r.content.take(200)}")
        else if (!running) res.put("error", "Installed, but the watcher did not start")
        return res
    }

    /** Stops the watcher and removes the boot stub and the reaper folder. Does not change the switch. */
    @Synchronized
    fun remove(ctx: Context): JSONObject {
        val r = RootShell.run(ctx, ReaperModel.removeCommand(), 20_000)
        val ok = r.success && r.content.contains("REMOVED=1")
        LogCatcher.log("INFO", TAG, "Reaper removed: $ok")
        return JSONObject().put("ok", ok).put("error", if (ok) JSONObject.NULL else r.content.take(200))
    }

    /** Settings switch. The new state is saved only when the root call worked, so the page never shows a state that is not real. */
    fun setEnabled(ctx: Context, on: Boolean): JSONObject {
        val res = if (on) install(ctx) else remove(ctx)
        if (res.optBoolean("ok")) prefs(ctx).edit().putBoolean(KEY_ENABLED, on).apply()
        return res.put("enabled", enabled(ctx))
    }

    /** Installed state, version, running state and boot stub, from one root call. */
    fun status(ctx: Context): JSONObject {
        val bundled = ReaperModel.scriptVersion(bundledScript(ctx))
        val r = RootShell.run(ctx, ReaperModel.statusCommand(), 15_000)
        val s = ReaperModel.parseStatus(r.content)
        val outdated = s.installed && ReaperModel.needsReinstall(s.version, bundled)
        val j = JSONObject().put("ok", r.success).put("enabled", enabled(ctx))
            .put("installed", s.installed).put("installedVersion", s.version ?: JSONObject.NULL)
            .put("bundledVersion", bundled ?: JSONObject.NULL).put("outdated", outdated)
            .put("running", s.running).put("stub", s.stub).put("stubCurrent", ReaperModel.stubCurrent(s.stubVersion))
        if (!r.success) j.put("error", r.content.take(200))
        return j
    }

    /**
     * When the switch is ON, make sure the shipped reaper is installed, current and running, and the boot stub is in place. Called when the
     * host service starts and after an app update; asks for no root when the switch is OFF. Returns false only when something was needed and
     * failed (the caller may retry later), true when all is in order or nothing is wanted.
     */
    fun ensureCurrent(ctx: Context): Boolean {
        if (!enabled(ctx)) return true
        return try {
            val st = status(ctx)
            if (!st.optBoolean("ok")) return false   // no root yet (early boot, or refused): try again later
            val needs = !st.optBoolean("installed") || st.optBoolean("outdated") || !st.optBoolean("running") || !st.optBoolean("stub") || !st.optBoolean("stubCurrent")
            if (!needs) return true
            val r = install(ctx)
            LogCatcher.log("INFO", TAG, "Reaper refreshed (installed=${st.optBoolean("installed")}, outdated=${st.optBoolean("outdated")}, running=${st.optBoolean("running")}, stub=${st.optBoolean("stub")}): ok=${r.optBoolean("ok")}")
            r.optBoolean("ok") && r.optBoolean("running")
        } catch (e: Exception) { LogCatcher.log("WARNING", TAG, "Reaper check failed: ${e.message}"); false }
    }
}

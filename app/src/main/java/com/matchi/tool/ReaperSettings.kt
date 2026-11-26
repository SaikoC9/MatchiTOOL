package com.matchi.tool

/**
 * The words and lists of the Settings card "Wipe everything when MatchiTOOL is uninstalled" (Phase 6, docs/UNINSTALL_WIPE.md).
 * Pure Kotlin (no Android classes), so it is unit tested on a PC. The "what will be removed" list is built from [Footprint], so it cannot
 * drift from what the reaper really removes; the web route (WebRoutesReaper) only turns this into JSON and the page only shows it.
 */
object ReaperSettings {
    /** One group of the read-only list: a heading and plain lines. */
    data class Group(val title: String, val lines: List<String>)

    /** What the reaper removes, in the order it works (boot entries, firewall, traffic control, processes, files). */
    fun removed(): List<Group> = listOf(
        Group("Start-up entries", listOf(
            "The boot scripts: " + Footprint.BOOT_STUBS.joinToString(", ") { it.substringAfterLast('/') } + " (the Magisk / KernelSU boot folder)",
            "Start-on-boot scripts of MatchiTOOL and of plugins (boot.sh, boot.d)"
        )),
        Group("Firewall", listOf(
            "The rule that opens the console port ${Footprint.CONSOLE_PORT} on the hotspot and USB side (IPv4 and IPv6)",
            "The AdGuard Home door: chain ${Footprint.AGH_CHAIN} and its jump",
            "Firewall chains and rules that plugins made and MatchiTOOL recorded (DNS redirects included)"
        )),
        Group("Speed limits", listOf(
            "The per-device speed limits (traffic control on ${Footprint.TC_DEVICE}, ${Footprint.TC_INGRESS_DEVICES.joinToString(" and ")}): only ours; a setup that is not ours is never touched"
        )),
        Group("Running programs", listOf(
            Footprint.PROCESS_NAMES.joinToString(", "),
            "The boot log capture and its helpers",
            "Plugin programs, and the plugins' own approved stop commands"
        )),
        Group("Files", listOf(
            "The folder ${Footprint.BASE_DIR} with everything in it (logs, backups, plugin data, CA file, this watcher)",
            "Old temp files: " + Footprint.LEGACY_TMP.joinToString(", ") { it.substringAfterLast('/') } + " (in /data/local/tmp)",
            "Files that installed plugins recorded under /data/local",
            "The one-line retry log " + Footprint.REAPER_LOG.substringAfterLast('/') + ", when the wipe is finished"
        ))
    )

    /** What stays on purpose (decisions D2 and D6). Shown as a fixed note under the list. */
    const val NOT_RESTORED = "Not restored: Wi-Fi (if the auto switch turned it off), a pending LAN IP change, IMEI, router settings, USB mode, adb. " +
        "Turn Wi-Fi back on in the router's own web page or the phone's own controls."

    /** Shown next to the switch (decision D1 / review S8): what ON installs, and what OFF means. */
    const val ON_TEXT = "While this is on, MatchiTOOL keeps a small root watcher running outside the app, plus a boot script that starts it. " +
        "After you uninstall MatchiTOOL from Android's App info screen, the watcher notices (about a minute) and removes the items below, then deletes itself."
    const val OFF_TEXT = "If you turn this off BEFORE uninstalling, nothing watches, and the items below stay on the phone."

    /** Plugins that were deleted without erasing their data are not cleaned (decision D9). */
    const val PLUGIN_NOTE = "Only plugins that are installed when you uninstall are cleaned. A plugin you deleted without erasing its data keeps that data."
}

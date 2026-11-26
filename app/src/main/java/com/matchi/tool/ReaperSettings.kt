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
            "Boot scripts: " + Footprint.BOOT_STUBS.joinToString(", ") { it.substringAfterLast('/') },
            "Boot entries of MatchiTOOL and plugins (boot.sh, boot.d)"
        )),
        Group("Firewall", listOf(
            "Console port ${Footprint.CONSOLE_PORT} rule (hotspot and USB, IPv4 and IPv6)",
            "AdGuard chain ${Footprint.AGH_CHAIN} and its jump",
            "Plugin firewall rules, DNS redirects included"
        )),
        Group("Speed limits", listOf(
            "Our speed limits on ${Footprint.TC_DEVICE}, ${Footprint.TC_INGRESS_DEVICES.joinToString(" and ")} (limits that are not ours stay)"
        )),
        Group("Running programs", listOf(
            Footprint.PROCESS_NAMES.joinToString(", "),
            "Boot log capture and its helpers",
            "Plugin programs (run their own stop commands)"
        )),
        Group("Files", listOf(
            "Folder ${Footprint.BASE_DIR} and everything in it",
            "Old temp files: " + Footprint.LEGACY_TMP.joinToString(", ") { it.substringAfterLast('/') } + " (in /data/local/tmp)",
            "Plugin files under /data/local",
            "Retry log " + Footprint.REAPER_LOG.substringAfterLast('/') + ", after the wipe"
        ))
    )

    /** What stays on purpose (decisions D2 and D6). Shown as a fixed note under the list. */
    const val NOT_RESTORED = "Not touched: Wi-Fi, a pending LAN IP change, IMEI, router settings, USB mode, adb. " +
        "If Wi-Fi is off, turn it on from the router page."

    /** Shown next to the switch (decision D1 / review S8): what ON installs, and what OFF means. */
    const val ON_TEXT = "A small root watcher runs outside the app, with a boot script. " +
        "After you uninstall MatchiTOOL, it removes everything below in about a minute, then deletes itself."
    const val OFF_TEXT = "Turn this off BEFORE uninstalling and the items below stay on the phone."

    /** Plugins that were deleted without erasing their data are not cleaned (decision D9). */
    const val PLUGIN_NOTE = "Only installed plugins are cleaned. A plugin deleted without erasing its data keeps that data."
}

package com.matchi.tool

/**
 * Everything MatchiTOOL leaves on the device OUTSIDE its app sandbox, as one list. The uninstall reaper (matchi_reaper.sh) removes exactly
 * this and nothing else. Source of truth for the human-readable table: docs/UNINSTALL_WIPE.md.
 *
 * Rule: code that creates a root-side file, rule, qdisc or process must be covered here. scripts/check_footprint.py and FootprintTest fail
 * the build when a new path, chain or tc setup shows up in the sources without being covered.
 *
 * Pure Kotlin (no Android classes) so it is unit tested on a PC.
 */
object Footprint {
    /** Our root-side folder. Everything inside it is removed with it. */
    const val BASE_DIR = "/data/local/matchitool"

    /** Boot stubs outside the folder: the boot log capture and the reaper itself (ReaperModel.STUB_PATH). */
    val BOOT_STUBS = listOf("/data/adb/service.d/matchi_logd.sh", "/data/adb/service.d/matchi_reaper.sh")

    /** Old temp files in /data/local/tmp (the adb shell user can write there, so only these fixed names, never a pattern). Same list as HostService.OLD_TMP_CLEANUP. */
    val LEGACY_TMP = listOf(
        "/data/local/tmp/matchi_jobs", "/data/local/tmp/matchi_memory_clean", "/data/local/tmp/mt_isms.sh",
        "/data/local/tmp/matchi_update.log", "/data/local/tmp/.matchi_out_prev.apk"
    )

    /** Folders of the Bypass plugin (TTL, DPI, lock, boot entry). Not plugin-deletable (PluginPaths protects them), so the reaper removes them on uninstall. Same list as matchi_reaper.sh BYPASS. */
    val BYPASS_DIRS = listOf(
        "/data/local/matchi_ttl", "/data/local/matchi_dpi", "/data/local/matchi_lock", "/data/local/matchi_boot"
    )

    /**
     * Data folder of the AdGuard Home plugin. Removed on uninstall even when the plugin snapshot does not list it: "Clear data" (or deleting the
     * plugin) empties the app's plugin records, and the snapshot is rebuilt from them, so the folder would otherwise be forgotten (F50 test, Part 7).
     * Same list as matchi_reaper.sh PLUGDIRS.
     */
    val PLUGIN_KNOWN_DIRS = listOf("/data/local/adguardhome", "/data/local/matchi_owrt")

    // ---- OpenWrt VM plugin (separate project: owrt-vm.sh, cloud-hypervisor + KVM) ----
    // Made inside owrt-vm.sh, so the plugin ledger cannot see it. The reaper knows it by name. Same values as matchi_reaper.sh OWRT, OW_*.
    /** Plugin folder. Processes that run from it are ended first. */
    const val OWRT_DIR = "/data/local/matchi_owrt"
    /** Filter chains. OWRT_IN drops Android's DHCP on br0. */
    val OWRT_FILTER_CHAINS = listOf("OWRT_FWD", "OWRT_IN")
    /** Nat chains. */
    val OWRT_NAT_CHAINS = listOf("OWRT_NAT", "OWRT_PRE")
    /** Taps. The LAN tap is a port of br0. */
    val OWRT_LINKS = listOf("owrt-lan", "owrt-wan")
    /** Address added to br0. */
    const val OWRT_BRIDGE_ADDR = "192.168.88.2/24"
    /** Guest subnet. Rules match this net AND the pref. */
    const val OWRT_GUEST_NET = "192.168.66.0/24"
    val OWRT_RULE_PREFS = 5000..5002

    /** One-line retry log of the reaper (D4). Outside the folder, so it needs its own entry. Removed when the wipe is clean. After the last try it stays as "gave-up left=...". */
    const val REAPER_LOG = "/data/local/matchitool-uninstall.log"

    /** Paths the code only READS or runs that are not ours; they must never be removed. */
    val NOT_OURS = listOf("/data/local/tmp/curl", "/data/local/tmp/sqlite3")

    // ---- firewall ----
    /** Console port (Prefs.PORT). The reaper hard-codes it: the app is gone when it runs. */
    const val CONSOLE_PORT = 2334

    /** Interface name prefixes HostControl opens the console port on (hotspot / tether side only). */
    val LAN_IF_PREFIXES = listOf("br", "ap", "swlan", "usb", "rndis", "ecm")

    /** Chain the AdGuard door makes (AghDoor.CHAIN). */
    const val AGH_CHAIN = "AGH_UI"

    // ---- traffic control (SpeedLimit.kt) ----
    const val TC_DEVICE = "br0"
    const val TC_ROOT_QDISC = "htb 1:"              // only a root qdisc that prints this is ours
    val TC_INGRESS_DEVICES = listOf("wlan0", "usb0")
    val TC_PRIO_V4 = 1000..1255               // 1000 + last octet
    val TC_PRIO_V6 = 1300..1555               // 1300 + last octet
    // The empty "ffff:" ingress qdisc on TC_INGRESS_DEVICES is left in place on purpose (docs/UNINSTALL_WIPE.md, D8).

    // ---- processes (exact name, never a pattern like "matchi") ----
    // It also ends any process that runs from a Bypass folder or [PLUGIN_KNOWN_DIRS] (OpenWrt VM).
    val PROCESS_NAMES = listOf("matchi-guard", "matchi-sampler", "matchi-doctor", "sendat", "zreq", "AdGuardHome")

    /** Files inside BASE_DIR the reaper reads or kills by. */
    const val LOGD_PID = "$BASE_DIR/bootlogs/logd.pid"
    const val LOGD_CAP_PREFIX = "$BASE_DIR/bootlogs/.cap."

    /** Where a path stands for the reaper. */
    enum class Class { REMOVE, LEAVE, UNKNOWN }

    /** Classifies an absolute path the way the reaper must treat it. Path must be clean (no "..", no double slash). */
    fun classify(path: String): Class = when {
        path.contains("..") || path.contains("//") || !path.startsWith("/") -> Class.UNKNOWN
        path in NOT_OURS -> Class.LEAVE
        path == BASE_DIR || path.startsWith("$BASE_DIR/") -> Class.REMOVE
        path in BOOT_STUBS || path in LEGACY_TMP || path == REAPER_LOG || (BYPASS_DIRS + PLUGIN_KNOWN_DIRS).any { path == it || path.startsWith("$it/") } -> Class.REMOVE
        else -> Class.UNKNOWN
    }

    /** True when [ifName] is a hotspot/tether interface the console port may have been opened on. */
    fun isLanInterface(ifName: String): Boolean = LAN_IF_PREFIXES.any { ifName.startsWith(it) }

    /** True when [prio] is a filter priority SpeedLimit owns. */
    fun isOurTcPrio(prio: Int): Boolean = prio in TC_PRIO_V4 || prio in TC_PRIO_V6
}

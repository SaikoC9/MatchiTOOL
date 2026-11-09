package com.matchi.tool

/**
 * Rewrites the file paths UFI-TOOLS plugins hard-code so a plugin's shell command lands in MatchiTOOL's folders.
 *
 *  - /sdcard/ufi_tools_boot.sh (and its other spellings)  ->  /data/local/matchitool/boot.sh
 *    (root-owned and run at boot; the shared storage copy would be writable by any app)
 *  - /data/data/com.minikano.f50_sms[/...]                 ->  /data/data/<this app>[/...]
 *    so UFI's files/uploads, files/curl and files/sendat become this app's uploads folder, curl and sendat.
 *
 * Pure text rewriting with no Android classes, so it is unit tested. It only changes whole path prefixes: a longer name
 * such as ufi_tools_boot.sh.bak or com.minikano.f50_sms2 is left alone.
 */
object UfiPathMap {
    const val BOOT_MATCHI = "/data/local/matchitool/boot.sh"

    private const val NAME_CHARS = "A-Za-z0-9._-"
    private val bootRx = Regex("/(?:sdcard|storage/emulated/0|storage/self/primary|mnt/sdcard)/ufi_tools_boot\\.sh(?![$NAME_CHARS])")
    private val pkgRx = Regex("/data/(?:data|user/0)/com\\.minikano\\.f50_sms(?![$NAME_CHARS])")

    /** Returns [command] with UFI paths replaced. [pkg] is this app's package name. */
    fun map(command: String, pkg: String): String {
        if (!command.contains("ufi_tools_boot") && !command.contains("minikano")) return command
        val app = "/data/data/$pkg"
        return command
            .replace(bootRx) { BOOT_MATCHI }
            .replace(pkgRx) { app }
    }
}

package com.matchi.tool

// Written by scripts/gen_binary_hashes.py from app/src/main/assets/bin. Do not edit by hand: change the binary, run the script.
// scripts/validate.sh and BinaryHashesFileTest fail when this file and the assets disagree.
object BinaryHashes {
    private val TABLE: Map<String, String> = mapOf(
        "curl" to "bb49333d364737bef97b77114790be5684fd3c22d6d4274fbe56c3a83869428a",
        "jq" to "a8dc0221d8a6e7d67feb16882768585e6f339dcf0fce1e828761c2c4f1ca3050",
        "matchi-doctor" to "5badac638d193d5cd96197b7d2f7ae813e2864fc6b1b27b45dd8a836c2030471",
        "matchi-guard" to "53f3104a4b230fce9efa61da64ce67a1b642d02cd2646f8a8d7d34bd254dcddd",
        "matchi-sampler" to "82bc92bc78e0afb55fc914a49d4885f2abddd02e9e2ad93b51f3ac40f1594cc6",
        "sendat" to "c7f61e688b269d924f0f5274abc599251c11341606cf99c435c64c4aa0eddbb7",
        "sha256" to "c937b0f3728d3ade2212d2de2e3ec258b396e5efc26821c4816528f484a868eb",
        "zreq" to "96d4ba28f0f1a2b3dbbe0c805d99ce33b0053fd65552352a3dd4698117cc9b50",
    )

    /** The name of every bundled executable that is copied to the app's files folder. */
    fun names(): List<String> = TABLE.keys.toList()

    /** The SHA-256 (lowercase hex) the build was made with, or null for a name that is not bundled. */
    fun expected(name: String): String? = TABLE[name]

    internal fun table(): Map<String, String> = TABLE
}

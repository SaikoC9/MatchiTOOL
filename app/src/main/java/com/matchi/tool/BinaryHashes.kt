package com.matchi.tool

// Written by scripts/gen_binary_hashes.py from app/src/main/assets/bin. Do not edit by hand: change the binary, run the script.
// scripts/validate.sh and BinaryHashesFileTest fail when this file and the assets disagree.
object BinaryHashes {
    private val TABLE: Map<String, String> = mapOf(
        "curl" to "bb49333d364737bef97b77114790be5684fd3c22d6d4274fbe56c3a83869428a",
        "jq" to "a8dc0221d8a6e7d67feb16882768585e6f339dcf0fce1e828761c2c4f1ca3050",
        "matchi-doctor" to "5badac638d193d5cd96197b7d2f7ae813e2864fc6b1b27b45dd8a836c2030471",
        "matchi-guard" to "d1da6209ec9206d2cb81cc3e8a17c240ff98d5d4c0f967214bc55e2d08f69d06",
        "matchi-sampler" to "82bc92bc78e0afb55fc914a49d4885f2abddd02e9e2ad93b51f3ac40f1594cc6",
        "sendat" to "8fdd76ae1077601fdd25164992e314388c40627a57e5dfb421030d9c779ad54b",
        "sha256" to "c937b0f3728d3ade2212d2de2e3ec258b396e5efc26821c4816528f484a868eb",
        "zreq" to "2f7f80bf2a28346ced05d075d179c2697f023752ee18bacc35b131d2a7a7a3b8",
        "iperf3" to "4083aaf33932ad3fe353f74bbe575fb7e803feefe87428cb68f8ec3e91d08b4b",
    )

    /** The name of every bundled executable that is copied to the app's files folder. */
    fun names(): List<String> = TABLE.keys.toList()

    /** The SHA-256 (lowercase hex) the build was made with, or null for a name that is not bundled. */
    fun expected(name: String): String? = TABLE[name]

    internal fun table(): Map<String, String> = TABLE
}

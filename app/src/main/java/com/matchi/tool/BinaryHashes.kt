package com.matchi.tool

// Written by scripts/gen_binary_hashes.py from app/src/main/assets/bin. Do not edit by hand: change the binary, run the script.
// scripts/validate.sh and BinaryHashesFileTest fail when this file and the assets disagree.
object BinaryHashes {
    private val TABLE: Map<String, String> = mapOf(
        "curl" to "4c063298cc2d2b710d729c8f54f2ad503b504bfb80ff1f9f1e8dea7d8017d2b3",
        "jq" to "738ee0567401f51c8c95c1df118b924d9e97954b00034bb91e37d995faa180e0",
        "sendat" to "1ec33c2096c630e1f8bca34dcb239d48878f6816cbb8b5b31795568125dbc103",
        "sha256" to "c937b0f3728d3ade2212d2de2e3ec258b396e5efc26821c4816528f484a868eb",
        "zreq" to "8dc2144a3cc5d6afccb594a25a96d3019b6be05e2f23c2e345aeddd9837b3da2",
    )

    /** The name of every bundled executable that is copied to the app's files folder. */
    fun names(): List<String> = TABLE.keys.toList()

    /** The SHA-256 (lowercase hex) the build was made with, or null for a name that is not bundled. */
    fun expected(name: String): String? = TABLE[name]

    internal fun table(): Map<String, String> = TABLE
}

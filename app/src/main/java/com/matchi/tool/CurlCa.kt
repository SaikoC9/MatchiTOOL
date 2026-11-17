package com.matchi.tool

/**
 * Gives every root command a default CA bundle for curl.
 *
 * The bundled curl is built with OpenSSL 3, which looks certificates up by the NEW subject hash, but Android names the files in its
 * cacerts folder by the OLD hash. So `curl https://...` failed with "(60) SSL peer certificate ... not OK" although the device store is
 * complete (found on the F50, 16-17 Nov 2026: joined into one PEM, the same certs give https 200 with no -k). The wrapper at
 * /data/local/matchitool/bin/curl already did this, but a plugin that calls the raw binary (for example a public IP check that
 * runs files/curl directly) never went through the wrapper and still failed.
 *
 * [prelude] is shell text that [RootShell.run] puts in front of every script. It is a few shell built-ins in the common case, builds the
 * PEM once (and again when the system store is newer), and exports CURL_CA_BUNDLE. A caller's own CURL_CA_BUNDLE or SSL_CERT_FILE is
 * left alone, and curl's own --cacert / -k still win over the variable. It never fails the script: with no cert folder it does nothing.
 *
 * Pure text, no Android classes, so it is unit tested by running it in the host `sh`.
 */
object CurlCa {
    const val PEM = "/data/local/matchitool/bin/cacert.pem"
    val DIRS = listOf("/apex/com.android.conscrypt/cacerts", "/system/etc/security/cacerts")

    /** Shell lines (ending in a newline) to put before a script. [pem] and [dirs] are only changed by tests. */
    fun prelude(pem: String = PEM, dirs: List<String> = DIRS): String {
        require(pem.none { it == '\'' || it == '\n' } && dirs.none { d -> d.any { it == '\'' || it == '\n' || it == ' ' } }) { "unsafe path" }
        val s = "if [ -z \"§CURL_CA_BUNDLE\" ] && [ -z \"§SSL_CERT_FILE\" ]; then\n" +
            "  CA_B='$pem'; CA_D=\n" +
            "  for CA_X in ${dirs.joinToString(" ") { "'$it'" }}; do [ -d \"§CA_X\" ] && { CA_D=§CA_X; break; }; done\n" +
            "  if [ -n \"§CA_D\" ]; then\n" +
            "    if [ ! -s \"§CA_B\" ] || [ \"§CA_D\" -nt \"§CA_B\" ]; then\n" +
            "      mkdir -p \"§{CA_B%/*}\" 2>/dev/null\n" +
            "      cat \"§CA_D\"/* > \"§CA_B.§§\" 2>/dev/null && [ -s \"§CA_B.§§\" ] && chmod 644 \"§CA_B.§§\" && mv -f \"§CA_B.§§\" \"§CA_B\" || rm -f \"§CA_B.§§\"\n" +
            "    fi\n" +
            "    [ -s \"§CA_B\" ] && export CURL_CA_BUNDLE=\"§CA_B\"\n" +
            "  fi\n" +
            "  unset CA_B CA_D CA_X\n" +
            "fi\n"
        return s.replace('§', '$')
    }
}

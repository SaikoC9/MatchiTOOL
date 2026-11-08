# Third-party notices

- UFI-TOOLS-derived source and bundled modem utility notices are retained in `LICENSE-UFI-TOOLS`.
- The Bypass tool (a fork of a UFI-TOOLS plugin) was removed in 1.2.12 and is built in again since 1.2.17; its MIT license text is in `LICENSE-BYPASS`.
- MatchiTOOL project-specific changes are covered by `LICENSE`.
- NanoHTTPD 2.3.1 is consumed as an external Gradle dependency; consult its upstream distribution for its license and notices.
- No `nfqws` executable is bundled.
- `app/src/main/assets/bin/sendat` is a prebuilt, UPX-packed arm64 executable that the app runs as root. Its source and build recipe are not recorded in this repository. SHA-256: `f0da6be08ed2cdb46f517baa8d964327d2550b68017468d2dbbe4aa8224e41a9`. `scripts/validate.sh` fails if the file changes, so replace the hash here and there together with any new build.
- `app/src/main/assets/bin/curl` is a prebuilt arm64 Android executable (curl 8.0.1-DEV) taken unchanged from the UFI-TOOLS V4.0.0 APK (`assets/shell/curl`). It links the device's own libssl/libcrypto/libz, so it only runs on arm64 Android. curl is distributed under the curl license (MIT-style, https://curl.se/docs/copyright.html). Source and build recipe are not recorded in this repository. SHA-256: `5627a31714a8c621d7ca56539af5b95f439bdbbc125b6aab301897fed3c4632a`. `scripts/validate.sh` fails if the file changes, so replace the hash here and there together with any new build.

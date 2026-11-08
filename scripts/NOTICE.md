# Third-party notices

- UFI-TOOLS-derived source and bundled modem utility notices are retained in `LICENSE-UFI-TOOLS`.
- The Bypass tool (a fork of a UFI-TOOLS plugin) was removed in 1.2.12 and is built in again since 1.2.17; its MIT license text is in `LICENSE-BYPASS`.
- MatchiTOOL project-specific changes are covered by `LICENSE`.
- NanoHTTPD 2.3.1 is consumed as an external Gradle dependency; consult its upstream distribution for its license and notices.
- No `nfqws` executable is bundled.
- `app/src/main/assets/bin/sendat` is a prebuilt, UPX-packed arm64 executable that the app runs as root. Its source and build recipe are not recorded in this repository. SHA-256: `f0da6be08ed2cdb46f517baa8d964327d2550b68017468d2dbbe4aa8224e41a9`. `scripts/validate.sh` fails if the file changes, so replace the hash here and there together with any new build.

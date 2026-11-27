# Rooting the stock ZTE F50

MatchiTOOL uses an existing `su`. It does not root the F50. No universal method is claimed.

## Known public route

[`dikeckaan/zte-f50-toolkit`](https://github.com/dikeckaan/zte-f50-toolkit) documents a root workflow for exactly `F50_FLYMODEM_ZYV1.0.0B09`. It writes a patched TrustOS image and a Magisk-patched boot image with a host-side Unisoc/SPD tool.

- Firmware-specific. Not for other builds.
- Flashing is destructive. A TrustOS/boot/vbmeta mismatch can cause a boot loop that needs BROM/SPD recovery.
- Its images and flasher are not bundled here. Rights stay with their owners.

## Preflight

1. Read the exact firmware build from the device.
2. Continue only if it is `F50_FLYMODEM_ZYV1.0.0B09`. Otherwise stop and find a method verified for your build.
3. Make and verify a full partition backup, including calibration/NV partitions. Keep a second copy off the PC.
4. Have the right Unisoc/SPD tool and drivers, stable power and a recovery route.
5. Read the toolkit's current README and license.
6. Do not mix TrustOS images or chain root and bootloader unlock without knowing what each writes.
7. Do not flash a patched modem or change the IMEI.
8. After rooting, check `su -c id -u` returns `0`. Then launch MatchiTOOL and grant root.

## MatchiTOOL status

Implemented: root client and management UI.
Planned, not built: A) read-only preflight, B) backup-manifest hash check, C) post-root read-only checks, D) per-feature enabling with rollback notes.

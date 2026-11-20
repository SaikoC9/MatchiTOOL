# Stock ZTE F50 root integration (MatchiTOOL)

## What the fork does and does not do

MatchiTOOL's `RootShell` is a **consumer** of an existing `su` service. It is not the mechanism that initially roots the stock F50. On stock firmware, a rooting workflow must first establish privileged access by a separate, device-specific process; only then can MatchiTOOL's root backend run commands.

## Publicly documented route found during audit

The public [`dikeckaan/zte-f50-toolkit`](https://github.com/dikeckaan/zte-f50-toolkit) documents a root workflow for the exact stock build `F50_FLYMODEM_ZYV1.0.0B09`. Its description says the root step writes a patched TrustOS image and a Magisk-patched boot image using a host-side Unisoc/SPD tool. This is a firmware-specific procedure, not a general exploit that works on every F50.

The upstream repository also warns that flashing is destructive and recommends a full partition backup first. A separate TrustOS/boot/vbmeta chain mismatch can cause a boot loop or a device that requires BROM/SPD recovery. The toolkit's TrustOS images, firmware partitions, and flashing binary are not bundled in MatchiTOOL; rights to stock firmware and boot-chain images remain with their respective owners.

## Required preflight before any external flashing workflow

1. Read the exact firmware build from the device; do not infer it from the model name alone.
2. Confirm whether it is exactly `F50_FLYMODEM_ZYV1.0.0B09`. If not, stop and obtain a method verified for that build.
3. Save and verify a full partition backup, including device-specific calibration/NV partitions. Store a second copy off the host computer.
4. Confirm the correct Unisoc/SPD flashing tool and drivers for the host OS, stable power, and a known recovery route.
5. Read the upstream toolkit's current README and licensing terms before using it.
6. Do not mix different TrustOS images or run root and bootloader-unlock procedures back-to-back without understanding which TrustOS image each writes.
7. Do not flash a patched modem or change IMEI as part of a root-only task.
8. After a successful root install, verify `su -c id -u` returns `0`, then install/launch MatchiTOOL and explicitly grant its root request.

## MatchiTOOL integration plan

- Phase A: detect model/build and show a read-only preflight summary.
- Phase B: allow the user to import a locally created backup manifest and verify file hashes.
- Phase C: after an externally completed, supported root install, request `su` authorization and run read-only checks.
- Phase D: enable modem/network features individually, with rollback instructions.

MatchiTOOL currently implements the root client and management UI, not the flashing/preflight phases. This is intentional until the stock build, recovery process, and redistribution rights of every required binary/image are established. No universal stock-F50 root method is claimed.

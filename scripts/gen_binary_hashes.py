#!/usr/bin/env python3
"""Writes app/src/main/java/com/matchi/tool/BinaryHashes.kt: the SHA-256 of every bundled executable in app/src/main/assets/bin.

Usage: gen_binary_hashes.py [repo root]           write the file
       gen_binary_hashes.py --check [repo root]   exit 1 if the file is not what the assets would give

The app compares the copies it puts in its files folder with these values (see BinaryGuard.kt), so a file that was changed after the
copy is not run as root. The values come from the files that are in the APK, never from a second place that someone could forget to
update: change a binary, run this script (update_binary_hashes.py does it for you), commit the result. scripts/validate.sh runs --check.
"""
import hashlib, sys
from pathlib import Path

# The files the app copies out of assets/bin and runs. matchi_logd.sh and imei_apply.sh are read as text and handed to the root shell,
# they are never copied to disk as programs, so they are not listed here.
NAMES = ('curl', 'jq', 'matchi-doctor', 'matchi-sampler', 'sendat', 'sha256', 'zreq')
TARGET = 'app/src/main/java/com/matchi/tool/BinaryHashes.kt'


def render(root):
    lines = []
    for name in NAMES:
        f = root / 'app/src/main/assets/bin' / name
        if not f.is_file():
            raise SystemExit(f'error: {f} is missing')
        lines.append(f'        "{name}" to "{hashlib.sha256(f.read_bytes()).hexdigest()}",')
    return (
        'package com.matchi.tool\n'
        '\n'
        '// Written by scripts/gen_binary_hashes.py from app/src/main/assets/bin. Do not edit by hand: change the binary, run the script.\n'
        '// scripts/validate.sh and BinaryHashesFileTest fail when this file and the assets disagree.\n'
        'object BinaryHashes {\n'
        '    private val TABLE: Map<String, String> = mapOf(\n'
        + '\n'.join(lines) + '\n'
        '    )\n'
        '\n'
        '    /** The name of every bundled executable that is copied to the app\'s files folder. */\n'
        '    fun names(): List<String> = TABLE.keys.toList()\n'
        '\n'
        '    /** The SHA-256 (lowercase hex) the build was made with, or null for a name that is not bundled. */\n'
        '    fun expected(name: String): String? = TABLE[name]\n'
        '\n'
        '    internal fun table(): Map<String, String> = TABLE\n'
        '}\n'
    )


def main(argv):
    args = [a for a in argv[1:] if a != '--check']
    check = '--check' in argv[1:]
    root = Path(args[0]) if args else Path(__file__).resolve().parent.parent
    text = render(root)
    target = root / TARGET
    if check:
        if not target.is_file() or target.read_text(encoding='utf-8') != text:
            print(f'{TARGET} is out of date: run python3 scripts/gen_binary_hashes.py and commit it')
            return 1
        print('BinaryHashes.kt matches the binaries in assets/bin')
        return 0
    target.write_text(text, encoding='utf-8')
    print(f'wrote {TARGET} ({len(NAMES)} hashes)')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))

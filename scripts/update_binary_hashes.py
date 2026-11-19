#!/usr/bin/env python3
"""Put freshly built binaries into app/src/main/assets/bin and write their new SHA-256 into NOTICE.md and docs/BINARIES.md.

Usage: update_binary_hashes.py <folder holding curl, jq, sendat and zreq> [repo root]

For each binary: if its hash differs from the one in assets/bin, the old hash is replaced by the new one in NOTICE.md
(it must be there, scripts/check_repo.py needs it) and in docs/BINARIES.md (if it is there), and the file is copied over.
Nothing is written unless all four binaries can be handled. Only hashes change: the version words in those two files
(Go, curl, OpenSSL, jq) are for a person to update. When the repo has BinaryHashes.kt (the list the app checks its copies against),
it is written again from the new files, with scripts/gen_binary_hashes.py.
"""
import hashlib, shutil, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gen_binary_hashes

NAMES = ('curl', 'jq', 'sendat', 'zreq')


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main(argv):
    if not 2 <= len(argv) <= 3:
        print(__doc__)
        return 2
    src = Path(argv[1])
    root = Path(argv[2]) if len(argv) == 3 else Path(__file__).resolve().parent.parent
    bin_dir = root / 'app/src/main/assets/bin'
    notice, binaries_md = root / 'NOTICE.md', root / 'docs/BINARIES.md'
    texts = {notice: notice.read_text(encoding='utf-8'), binaries_md: binaries_md.read_text(encoding='utf-8')}
    copies, report = [], []
    for name in NAMES:
        new_file, old_file = src / name, bin_dir / name
        if not new_file.is_file():
            print(f'error: {new_file} is missing; nothing was changed')
            return 1
        new_h = sha(new_file)
        old_h = sha(old_file) if old_file.is_file() else None
        if old_h == new_h:
            report.append(f'{name}: unchanged')
            continue
        if old_h is None or old_h not in texts[notice]:
            print(f'error: the current {name} hash is not written in NOTICE.md, so the new one cannot be put in its place; '
                  'add it by hand. Nothing was changed')
            return 1
        for path in texts:
            texts[path] = texts[path].replace(old_h, new_h)
        copies.append((new_file, old_file))
        report.append(f'{name}: {old_h[:12]} -> {new_h[:12]}')
    for path, text in texts.items():
        path.write_text(text, encoding='utf-8')
    for new_file, old_file in copies:
        shutil.copyfile(new_file, old_file)    # keeps the mode of the existing file
    kt = root / gen_binary_hashes.TARGET
    if copies and kt.is_file():
        kt.write_text(gen_binary_hashes.render(root), encoding='utf-8')
        report.append('BinaryHashes.kt: written again')
    print('\n'.join(report))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))

#!/usr/bin/env python3
"""scripts/update_binary_hashes.py against a throw-away copy of the layout: what it rewrites, and that it writes nothing
when it cannot do all of it."""
import hashlib, subprocess, sys, tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gen_binary_hashes as gen

SCRIPT = Path(__file__).resolve().parent / 'update_binary_hashes.py'
NAMES = ('curl', 'jq', 'iperf3', 'sendat', 'zreq')
sha = lambda b: hashlib.sha256(b).hexdigest()
fails = []


def check(cond, msg):
    if not cond:
        fails.append(msg)


def layout(tmp, listed=NAMES):
    root = Path(tmp) / 'repo'
    (root / 'app/src/main/assets/bin').mkdir(parents=True)
    (root / 'docs').mkdir()
    for n in NAMES:
        (root / 'app/src/main/assets/bin' / n).write_bytes(f'old {n}'.encode())
    (root / 'NOTICE.md').write_text(''.join(f'- {n} {sha(f"old {n}".encode())}\n' for n in listed))
    (root / 'docs/BINARIES.md').write_text(''.join(f'| {n} | `{sha(f"old {n}".encode())}` |\n' for n in NAMES))
    new = Path(tmp) / 'new'
    new.mkdir()
    return root, new


def run(new, root):
    return subprocess.run([sys.executable, str(SCRIPT), str(new), str(root)], capture_output=True, text=True)


# 1. two binaries change, two stay
with tempfile.TemporaryDirectory() as tmp:
    root, new = layout(tmp)
    for n in NAMES:
        (new / n).write_bytes(f'new {n}'.encode() if n in ('curl', 'zreq') else f'old {n}'.encode())
    r = run(new, root)
    check(r.returncode == 0, f'changed run failed: {r.stdout}{r.stderr}')
    notice, md = (root / 'NOTICE.md').read_text(), (root / 'docs/BINARIES.md').read_text()
    for n in ('curl', 'zreq'):
        check((root / 'app/src/main/assets/bin' / n).read_bytes() == f'new {n}'.encode(), f'{n} was not copied')
        check(sha(f'new {n}'.encode()) in notice and sha(f'new {n}'.encode()) in md, f'{n} new hash missing')
        check(sha(f'old {n}'.encode()) not in notice + md, f'{n} old hash still there')
    for n in ('jq', 'sendat'):
        check(sha(f'old {n}'.encode()) in notice and sha(f'old {n}'.encode()) in md, f'{n} hash changed though the file did not')
    check('jq: unchanged' in r.stdout, 'report should say jq is unchanged')

# 2. a binary missing from the folder: error, nothing written
with tempfile.TemporaryDirectory() as tmp:
    root, new = layout(tmp)
    for n in ('curl', 'jq', 'sendat'):
        (new / n).write_bytes(f'new {n}'.encode())
    before = (root / 'NOTICE.md').read_text()
    r = run(new, root)
    check(r.returncode != 0, 'missing zreq should fail')
    check((root / 'NOTICE.md').read_text() == before, 'NOTICE.md changed although the run failed')
    check((root / 'app/src/main/assets/bin/curl').read_bytes() == b'old curl', 'curl was copied although the run failed')

# 3. the old hash is not in NOTICE.md: error, nothing written
with tempfile.TemporaryDirectory() as tmp:
    root, new = layout(tmp, listed=('curl', 'jq', 'sendat'))
    for n in NAMES:
        (new / n).write_bytes(f'new {n}'.encode())
    r = run(new, root)
    check(r.returncode != 0, 'unlisted zreq hash should fail')
    check((root / 'app/src/main/assets/bin/curl').read_bytes() == b'old curl', 'curl was copied although the run failed')

# 4. nothing changed: no error, files untouched
with tempfile.TemporaryDirectory() as tmp:
    root, new = layout(tmp)
    for n in NAMES:
        (new / n).write_bytes(f'old {n}'.encode())
    before = (root / 'NOTICE.md').read_text()
    r = run(new, root)
    check(r.returncode == 0 and (root / 'NOTICE.md').read_text() == before, 'an unchanged set should leave everything as it is')

# 5. the repo has BinaryHashes.kt: it follows the new files, and stays as it is when nothing changed
with tempfile.TemporaryDirectory() as tmp:
    root, new = layout(tmp)
    (root / 'app/src/main/assets/bin/sha256').write_bytes(b'the script')
    (root / 'app/src/main/assets/bin/matchi-sampler').write_bytes(b'the sampler')   # built by build-sampler.yml, not by release-tools.yml: it only has to stay in the list
    (root / 'app/src/main/assets/bin/matchi-doctor').write_bytes(b'the doctor')   # built by build-doctor.yml, same as the sampler
    (root / 'app/src/main/assets/bin/matchi-guard').write_bytes(b'the guard')   # built by build-guard.yml, same as the sampler
    kt = root / gen.TARGET
    kt.parent.mkdir(parents=True)
    kt.write_text(gen.render(root), encoding='utf-8')
    for n in NAMES:
        (new / n).write_bytes(f'new {n}'.encode() if n == 'sendat' else f'old {n}'.encode())
    r = run(new, root)
    check(r.returncode == 0, f'run with BinaryHashes.kt failed: {r.stdout}{r.stderr}')
    text = kt.read_text()
    check(sha(b'new sendat') in text and sha(b'old sendat') not in text, 'BinaryHashes.kt does not hold the new sendat hash')
    check(sha(b'old jq') in text and sha(b'the script') in text and sha(b'the sampler') in text and sha(b'the doctor') in text and sha(b'the guard') in text, 'BinaryHashes.kt lost a hash that did not change')
    check(gen.main(['gen', '--check', str(root)]) == 0, 'BinaryHashes.kt is not what gen_binary_hashes.py --check expects')
    before = kt.read_text()
    for n in NAMES:
        (new / n).write_bytes((root / 'app/src/main/assets/bin' / n).read_bytes())
    check(run(new, root).returncode == 0 and kt.read_text() == before, 'an unchanged set should leave BinaryHashes.kt alone')

# 6. a first-time binary (iperf3): not in assets/bin, a placeholder in the docs -> copied, placeholder replaced
with tempfile.TemporaryDirectory() as tmp:
    root, new = layout(tmp)
    (root / 'app/src/main/assets/bin/iperf3').unlink()
    for f in ('NOTICE.md', 'docs/BINARIES.md'):
        t = (root / f).read_text().replace(sha(b'old iperf3'), 'iperf3-hash-pending')
        (root / f).write_text(t)
    for n in NAMES:
        (new / n).write_bytes(f'old {n}'.encode() if n != 'iperf3' else b'first iperf3')
    r = run(new, root)
    check(r.returncode == 0, f'first-time run failed: {r.stdout}{r.stderr}')
    check((root / 'app/src/main/assets/bin/iperf3').read_bytes() == b'first iperf3', 'iperf3 was not copied')
    check('iperf3-hash-pending' not in (root / 'NOTICE.md').read_text() + (root / 'docs/BINARIES.md').read_text() and sha(b'first iperf3') in (root / 'NOTICE.md').read_text(), 'placeholder not replaced by the hash')

if fails:
    print('update_binary_hashes test FAILED:')
    [print('  -', f) for f in fails]
    sys.exit(1)
print('update_binary_hashes test passed: replaces only changed hashes, keeps BinaryHashes.kt in step, writes nothing on error')

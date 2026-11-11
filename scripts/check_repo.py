#!/usr/bin/env python3
"""Repository consistency checks that are about facts, not code shape:
  1. The version lives in version.properties only. Gradle reads it, the page's PAGE_VERSION matches it, the README and the top
     CHANGELOG entry name it, and the release workflow reads it from there.
  2. The README's count and list of built-in tools equals the tools embedded in the page.
  3. Every bundled executable (assets/bin) has its SHA-256 written in NOTICE.md, so a changed binary cannot slip in unnoticed."""
import hashlib, re, sys
from pathlib import Path

root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent
errors = []
def need(cond, msg):
    if not cond: errors.append(msg)

# ---- 1. version ----
props = (root / 'version.properties').read_text()
name = re.search(r'^VERSION_NAME=(\S+)$', props, re.M); code = re.search(r'^VERSION_CODE=(\d+)$', props, re.M)
need(name and code, 'version.properties needs VERSION_NAME=... and VERSION_CODE=...')
if name and code:
    name, code = name.group(1), int(code.group(1))
    gradle = (root / 'app/build.gradle.kts').read_text()
    need('version.properties' in gradle and 'VERSION_NAME' in gradle and 'VERSION_CODE' in gradle, 'app/build.gradle.kts must read the version from version.properties')
    need(not re.search(r'versionName\s*=\s*"', gradle) and not re.search(r'versionCode\s*=\s*\d', gradle), 'app/build.gradle.kts has a hard-coded version; use version.properties')
    html = (root / 'app/src/main/assets/web/index.html').read_text()
    m = re.search(r"const PAGE_VERSION='([^']*)';", html)
    need(m and m.group(1) == name, f"PAGE_VERSION in the page is {m.group(1) if m else None}, version.properties says {name} (run node scripts/build-web.js)")
    readme = (root / 'README.md').read_text()
    need(f'**{name}** (versionCode **{code}**)' in readme, f'README.md must say "**{name}** (versionCode **{code}**)" under the current source version')
    first = next((l for l in (root / 'CHANGELOG.md').read_text().split('\n') if l.startswith('# ')), '')
    need(name in first, f'the top CHANGELOG entry ("{first[:60]}") must name version {name}')
    rel = root / '.github/workflows/release.yml'
    if rel.is_file():
        need('version.properties' in rel.read_text(), 'release.yml must read the version from version.properties')

# ---- 2. built-in tools ----
html = (root / 'app/src/main/assets/web/index.html').read_text()
embedded = [n for n in re.findall(r'<script type="text/plain" class="webtool" data-name="([^"]+)">', html)]
norm = lambda s: re.sub(r'[^a-z0-9]', '', re.sub(r'\.js$', '', s.lower()))
WORDS = {'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10, 'eleven': 11, 'twelve': 12}
readme = (root / 'README.md').read_text()
for m in re.finditer(r'\b(\w+) built-in tools\b', readme, re.I):
    w = m.group(1).lower()
    if w in WORDS or w.isdigit():
        n = WORDS.get(w, int(w) if w.isdigit() else -1)
        need(n == len(embedded), f'README says "{m.group(0)}" but the page embeds {len(embedded)} tools: {", ".join(embedded)}')
lm = re.search(r'built-in tools \(([^)]*)\)', readme)
if lm:
    listed = {norm(x.strip().removeprefix('and ').strip()) for x in lm.group(1).split(',')}
    need(listed == {norm(n) for n in embedded}, f'README lists {sorted(listed)} but the page embeds {sorted(norm(n) for n in embedded)}')
else:
    errors.append('README.md must list the built-in tools in the form "built-in tools (A, B, and C)"')

# ---- 3. bundled executables ----
notice = (root / 'NOTICE.md').read_text()
for f in sorted((root / 'app/src/main/assets/bin').iterdir()):
    if f.name.endswith('.sh'): continue    # shell scripts (matchi_logd.sh) are source, versioned by their own header
    h = hashlib.sha256(f.read_bytes()).hexdigest()
    need(h in notice, f'assets/bin/{f.name} has sha256 {h}, which is not written in NOTICE.md - review the file, then update NOTICE.md (and docs/BINARIES.md)')

if errors:
    print('repo check FAILED:'); [print('  -', e) for e in errors]; sys.exit(1)
print(f'repo check passed: version {name} (code {code}) in one place, {len(embedded)} built-in tools match the README, bundled binaries pinned in NOTICE.md')

#!/usr/bin/env python3
"""Tests for lint_resource_rules.py: every rule must catch its bad example and pass its good one."""
import sys, importlib.util
from pathlib import Path
spec = importlib.util.spec_from_file_location('lint', Path(__file__).with_name('lint_resource_rules.py'))
L = importlib.util.module_from_spec(spec); spec.loader.exec_module(L)

def rules(text, plugin=True, exp=()):
    return sorted({r for _, _, r, _ in L.lint_text('x.js', text, plugin, exp)})

CASES = [
 # (text, expected rules)
 ('du -sk /data/local/x', ['R1']),
 ('echo $(timeout 8 du -sk -- "$p" | cut -f1)', ['R1']),
 ('du -skx -- "$p"', []),
 ('T="timeout 8"; $T du --one-file-system -s "$p"', []),
 ('# du -sk is slow, do not use it', []),
 ('// the du fix: see docs', []),
 ('du -sk /x   // lint-ok: tiny folder checked by hand', []),
 ('find /data -name "*.tmp" -delete', ['R2']),
 ('find /data -xdev -name "*.tmp"', []),
 ('find "$D" -maxdepth 1 -name "a*"', []),
 ('grep -a -H "" /proc/[0-9]*/cmdline | tr "\\000" " "', ['R3']),
 ('cat /proc/$pid/cmdline | tr "\\0" " "', ['R3']),
 ('ps -A -o PID,ARGS | while read -r q a; do echo "/proc/$q/cmdline:$a"; done', []),
 ('while true; do\n  do_work\ndone', ['R4']),
 ('while true; do\n  do_work\n  sleep 5\ndone', []),
 ('while :; do read -r l || break; done', []),
 ('while(true){ x++ }', ['R4']),
 ('while(true){ await tick() }', []),
 ('setInterval(poll, 200)', ['R5']),
 ('setInterval(poll, 5000)', []),
 ('mount -o bind /proc "$R/proc"', ['R7']),
 ('mount | grep -q " $R/proc "', []),
]
bad = 0
for text, want in CASES:
    got = rules(text)
    if got != want:
        bad += 1; print(f'FAIL {text!r}: want {want} got {got}')
# mounts are a plugin-only warning
assert rules('mount -o bind /proc "$R/proc"', plugin=False) == [], 'R7 must not fire on host code'
# R6: a timer in a file that names an expensive route
exp = {'/api/plugins/data'}
js_bad = "setInterval(()=>api('/api/plugins/data'), 30000)"
js_ok = "setInterval(()=>api('/api/plugins/data'), 30000) // lint-ok: bounded, visibility aware"
js_other = "setInterval(()=>api('/api/live'), 30000)"
for text, want in ((js_bad, ['R6']), (js_ok, []), (js_other, [])):
    got = rules(text, plugin=False, exp=exp)
    if got != want: bad += 1; print(f'FAIL R6 {text!r}: want {want} got {got}')
# A suppression needs a reason
if rules('du -sk /x // lint-ok:') != ['R1']: bad += 1; print('FAIL: empty lint-ok must not suppress')
if bad: sys.exit(1)
print(f'lint rule tests OK ({len(CASES) + 4} cases)')

#!/usr/bin/env python3
"""Route table test (no Android needed): reads every route the web host serves (WebRoutes*.kt) and checks it against the
table below, which is the contract for who may call what:

  GATE     the route starts with  rootGate(s) ?: ...  - a fresh sign-in (and the HTTPS/confirm rules) before anything runs
  PARTIAL  the route calls rootGate(s) inside, only for the part that needs it (named in the note)
  OWN      the route is not behind rootGate on purpose and checks a password itself
  OPEN     a signed-in session is enough (the session check runs for every /api route except /api/login)

It fails when a route exists in the code but not in this table (a new route needs a conscious decision), when a table row has no
route any more, when a route's gate class differs, and when a route that runs root / user-shell / APK-install / router-cookie
code has neither a gate nor an entry in ROOT_WITHOUT_GATE saying why not.
The behaviour of the gate itself (order of checks, codes, age limit) is tested in RootGateTest.kt (RootGate.decide)."""
import re, sys
from pathlib import Path

D = Path(__file__).resolve().parent.parent / 'app/src/main/java/com/matchi/tool'

TABLE = {
  # (METHOD, path or prefix ending in /): (class, note)
  ('POST', '/api/logout'): ('OPEN', ''),
  ('GET',  '/api/console/password'): ('OPEN', ''),
  ('POST', '/api/console/password'): ('OWN', 'needs the current password again; counts toward the login lockout'),
  ('GET',  '/api/security/net'): ('OPEN', ''),
  ('POST', '/api/security/net'): ('GATE', ''),
  ('GET',  '/api/security/http'): ('OPEN', ''),
  ('POST', '/api/security/http'): ('OWN', 'must stay reachable when HTTPS failed; needs a young sign-in and the password again'),
  ('GET',  '/api/ping'): ('OPEN', ''),
  ('GET',  '/api/diagnostics'): ('OPEN', ''),
  ('GET',  '/api/screen/frame'): ('GATE', 'a screenshot can show codes and passwords: same gate as /api/screen/input'),
  ('POST', '/api/screen/input'): ('GATE', ''),
  ('GET',  '/api/live/stream'): ('GATE', 'Live panel push stream: starts the persistent root reader (LiveSampler), so it has the same gate as /api/shell; the session is checked again while it streams'),
  ('POST', '/api/live/view'): ('GATE', 'Live panel: the page says its tab is hidden / visible; it can start the root reader again, so same gate as the stream; only the session that opened the stream may change it'),
  ('GET',  '/api/usb/status'): ('OPEN', ''),
  ('POST', '/api/usb/control'): ('GATE', ''),
  ('POST', '/api/firmware/inspect'): ('OPEN', 'inspects text sent by the page; touches no device state'),
  ('GET',  '/api/logs/status'): ('OPEN', ''),
  ('POST', '/api/logs/start'): ('OPEN', ''),
  ('POST', '/api/logs/clienterror'): ('OPEN', ''),
  ('POST', '/api/logs/stop'): ('OPEN', ''),
  ('GET',  '/api/logs/entries'): ('OPEN', ''),
  ('GET',  '/api/logs/stream'): ('OPEN', ''),
  ('GET',  '/api/logs/search'): ('OPEN', ''),
  ('GET',  '/api/logs/export'): ('PARTIAL', 'the device-report part needs the gate'),
  ('GET',  '/api/logs/device'): ('OPEN', ''),
  ('POST', '/api/logs/device'): ('GATE', ''),
  ('GET',  '/api/logs/boot/status'): ('GATE', ''),
  ('GET',  '/api/logs/boot/files'): ('GATE', ''),
  ('GET',  '/api/logs/boot/counters'): ('GATE', ''),
  ('GET',  '/api/logs/boot/read'): ('GATE', ''),
  ('POST', '/api/logs/boot/install'): ('GATE', ''),
  ('POST', '/api/logs/boot/uninstall'): ('GATE', ''),
  ('POST', '/api/logs/delete'): ('OPEN', 'app log sessions only'),
  ('GET',  '/api/logs/sessions'): ('OPEN', ''),
  ('GET',  '/api/logs/basket'): ('PARTIAL', 'root-owned boot files are listed only with the gate'),
  ('POST', '/api/logs/snapshot'): ('OPEN', ''),
  ('GET',  '/api/logs/basket/read'): ('OPEN', 'app-owned files only; boot files keep their own gated route'),
  ('POST', '/api/logs/basket/delete'): ('PARTIAL', 'audit log and boot files need the gate'),
  ('GET',  '/api/logs/session/'): ('OPEN', ''),
  ('GET',  '/api/plugins'): ('OPEN', ''),
  ('POST', '/api/plugins'): ('GATE', ''),
  ('POST', '/api/plugins/order'): ('GATE', ''),
  ('POST', '/api/plugins/approve'): ('GATE', 'also needs the sign-in password'),
  ('POST', '/api/plugins/call'): ('PARTIAL', 'sandboxed plugins only; the host checks the approved record on every call; the shell op needs the gate, AT reads and router reads are read-only'),
  ('POST', '/api/plugins/mode'): ('GATE', 'also needs the sign-in password; both directions (sandbox and trusted)'),
  ('POST', '/api/plugins/data'): ('PARTIAL', 'the route itself stays open (a refusal would hide the stop plan: the page treats an error as "nothing to show"); its two root calls, the existence probe of paths that passed checkPluginDataPath and the process scan, run only when rootGate lets the request through; the plan, undo list, uploads and effects come from files and the ledger, not from root'),
  ('POST', '/api/plugins/delete'): ('PARTIAL', 'erasing the plugin data or running its stop commands needs the gate; every delete needs the sign-in password, except keep:true; with keep:true (Disable and stop) it stops and switches the plugin off, nothing is deleted or erased'),
  ('POST', '/api/plugins/toggle'): ('GATE', 'a plugin holding a session cannot switch other plugins on or off after 4 h'),
  ('POST', '/api/plugins/scan'): ('OPEN', ''),
  ('GET',  '/api/root/status'): ('OPEN', 'asks only whether root is granted'),
  ('POST', '/api/shell'): ('GATE', ''),
  ('POST', '/api/user_shell'): ('GATE', ''),
  ('POST', '/api/imei/apply'): ('GATE', ''),
  ('POST', '/api/at'): ('PARTIAL', 'pure AT read queries skip the gate; anything else needs it'),
  ('POST', '/api/at/batch'): ('PARTIAL', 'same rule as /api/at; only an all-read batch skips the gate'),
  ('POST', '/api/zte'): ('PARTIAL', 'goes to the saved router address only; a set call needs the gate unless its goformId is in NetGoform.OPEN_SET (band lock, cell lock, network mode, performance mode, SMS); reads stay open'),
  ('POST', '/api/agh/door'): ('GATE', 'opens iptables chain AGH_UI (port 3000) for the caller\'s own address only while the session lives; closed on sign-out / expiry (AghDoor)'),
  ('GET',  '/api/net/whoami'): ('OPEN', 'read only: returns the caller\'s own address'),
  ('POST', '/api/net/lan-applied'): ('GATE', 'points the router client at the new address named in the pending IP-change note; checks the router afterwards'),
  ('POST', '/api/zte/page'): ('OPEN', ''),
  ('GET',  '/api/zte/config'): ('OPEN', ''),
  ('POST', '/api/zte/config'): ('GATE', 'a changed address or password also needs the current password again (counts toward the login lockout); changing the password ends the other sessions'),
  ('POST', '/api/update/stage'): ('GATE', 'C11: writes up to ApkUpdater.MAX_BYTES to disk'),
  ('POST', '/api/update/check'): ('GATE', 'C11: the device contacts the https address in the request'),
  ('POST', '/api/update/fetch'): ('GATE', 'C11: downloads from any https address and stores the file'),
  ('POST', '/api/update/install'): ('GATE', ''),
  ('GET',  '/api/update/status'): ('OPEN', ''),
}

# Routes that touch root-ish code without a gate, each with the reason. Anything not listed here must be gated.
ROOT_WITHOUT_GATE = {
  '/api/root/status': 'RootShell.status only',
}
DANGEROUS = ('RootShell.run', 'RootShell.exec', 'UserShell.run', 'ApkUpdater.install')

def branches():
    out = []
    for f in sorted(D.glob('WebRoutes*.kt')):
        lines = f.read_text().split('\n')
        idx = [i for i, l in enumerate(lines) if re.match(r'^    \(?uri[ .(]', l)]
        end = next(i for i, l in enumerate(lines) if l.startswith('    else -> null'))
        for k, i in enumerate(idx):
            e = idx[k + 1] if k + 1 < len(idx) else end
            body = '\n'.join(lines[i:e]); head = lines[i]
            paths = sorted(set(re.findall(r'"(/api/[^"]*)"', head)))
            methods = re.findall(r'Method\.(\w+)', head)
            out.append((f.name, head, paths, methods, body))
    return out

def gate_class(head, body):
    if re.search(r'->\s*(?:run \{\s*)?rootGate\(s\) \?:', head): return 'GATE'
    return 'PARTIAL' if 'rootGate(' in body else 'OPEN'

errors = []; seen = set()
for fname, head, paths, methods, body in branches():
    cls = gate_class(head, body)
    for p in paths:
        for m in (methods or ['GET']):
            key = (m, p); seen.add(key)
            if key not in TABLE:
                errors.append(f'{fname}: route {m} {p} is not in the TABLE in scripts/test_route_gates.py - decide how it is gated and add it'); continue
            want, note = TABLE[key]
            if want == 'OWN': want = 'OPEN'     # OWN = no rootGate, own password check (stated in the table)
            if want != cls:
                errors.append(f'{fname}: {m} {p} is gated as {cls}, the TABLE says {want}')
    if any(d in body for d in DANGEROUS) and cls == 'OPEN':
        for p in paths:
            if p not in ROOT_WITHOUT_GATE:
                errors.append(f'{fname}: {p} runs root/user/update/cookie code with no rootGate and no reason in ROOT_WITHOUT_GATE')
for key in TABLE:
    if key not in seen: errors.append(f'TABLE has {key[0]} {key[1]} but no such route exists any more')

# The gate must come first: nothing before it may read the body of a gated route (a rejected call must not have run anything).
for fname, head, paths, methods, body in branches():
    if gate_class(head, body) == 'GATE' and head.count('rootGate(s)') != 1:
        errors.append(f'{fname}: {paths} should call rootGate exactly once, at the start')

# 1.4.2 (F10): /api/plugins/data must keep both of its root calls (existence probe, process scan) behind the gate decision. A refused request gets the
# "cannot be checked" answer, not an error, so the page still shows the stop plan.
for fname, head, paths, methods, body in branches():
    if '/api/plugins/data' in paths:
        if 'val gated = rootGate(s) != null' not in body: errors.append(f'{fname}: /api/plugins/data must compute  val gated = rootGate(s) != null')
        for l in body.split('\n'):
            code = l.split('//')[0]
            if ('RootShell.run(' in code or 'pluginSweep(' in code) and 'gated' not in code:
                errors.append(f'{fname}: /api/plugins/data runs root outside the gated decision: {l.strip()}')
        if 'refusedSweep()' not in body: errors.append(f'{fname}: /api/plugins/data must answer a refused request with refusedSweep(), not an error')

# AT writes must be audited one by one: auditBusy keeps one line a minute per kind, and the Live / AT Radio polls use that minute up, so a write
# logged with auditBusy alone (the old /api/at and /api/at/batch) left no trace.
root_src = (D / 'WebRoutesRoot.kt').read_text()
for route, kind in (('/api/at"', 'at-write'), ('/api/at/batch"', 'at-batch-write')):
    i = root_src.find('uri == "' + route)
    j = root_src.find('\n    uri == "', i + 10)
    seg = root_src[i:j if j > 0 else len(root_src)]
    if 'auditShell(' not in seg or '"' + kind + '"' not in seg:
        errors.append(f'WebRoutesRoot.kt: {route[:-1]} must write its own audit line (kind "{kind}") for a non-read AT command, not only auditBusy')

# UFI removal, stages 3 and 4: these routes must stay gone (nothing on the page calls them, and /api/proxy/ and the cookie routes handed out router access).
all_src = '\n'.join(f.read_text() for f in D.glob('*.kt'))
for gone in ('/api/goform/', '/api/proxy/', '/api/get_cookie', '/api/set_cookie', '/api/upload', '/api/upload_img', '/api/uploads/', '/api/root_shell', '/api/one_click_shell', '/api/AT'):
    if '"' + gone in all_src: errors.append(f'removed route {gone} is back in the Kotlin sources')

# Plain-HTTP and sign-in age rules live in one function.
ws = (D / 'WebServer.kt').read_text()
if 'RootGate.decide(' not in ws: errors.append('WebServer.rootGate must answer from RootGate.decide (so the unit tests cover it)')
for old in ('RootGate.insecureRefused(', 'RootGate.insecureNeedsConfirm(', 'RootGate.freshEnough('):
    if old in ws: errors.append('WebServer.kt calls ' + old + ' directly; use RootGate.decide')

if errors:
    print('route gate test FAILED:'); [print('  -', e) for e in errors]; sys.exit(1)
n = {}
for (m, p), (c, _) in TABLE.items(): n[c] = n.get(c, 0) + 1
print(f'route gate test passed: {len(TABLE)} routes ({", ".join(f"{v} {k}" for k, v in sorted(n.items()))})')

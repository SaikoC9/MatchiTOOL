#!/usr/bin/env python3
"""Browser test (Chromium via Playwright) for review items 19, 21 (dialogs, language switch) and 22, 24, 25 (cell lock fallback, no-service warning, PCI source label)
against a fake router.   usage: python3 test_round5_browser.py INDEX_HTML     (needs playwright + chromium; not part of validate.sh)"""
import json, sys, re
from pathlib import Path
from playwright.sync_api import sync_playwright

html = Path(sys.argv[1]).read_text()
VERSION = re.search(r"version\.name\s*=\s*(\S+)|versionName\s*=\s*(\S+)", "") or None
fails = 0
def ok(c, m):
    global fails
    print(('PASS ' if c else 'FAIL ') + m)
    if not c: fails += 1

TELE = """TELEPHONY
CellInfoLte:{mRegistered=YES mCellConnectionStatus=1 CellIdentityLte:{mPci=77 mEarfcn=1850 mBands=[3] mMcc=515}
 CellSignalStrengthLte: rssi=-70 rsrp=-95 rsrq=-10 rssnr=12 level=3}
CellSignalStrengthLte: rssi=-70 rsrp=-95 rsrq=-10 rssnr=12 level=3"""

def run(p, router_keys, tele_text, name):
    b = p.chromium.launch(); ctx = b.new_context()
    ctx.add_init_script("try{sessionStorage.setItem('matchi_token','T');localStorage.removeItem('matchi_cell_auto');localStorage.setItem('liv_mode','eco')}catch(e){}")
    page = ctx.new_page(); errors = []; log = {'sets': []}
    page.on('pageerror', lambda e: errors.append(str(e)))
    def handle(route):
        req = route.request; u = req.url.split('localhost', 1)[-1].split('?')[0]
        if 'localhost' not in req.url: return route.abort()
        def j(o): route.fulfill(status=200, content_type='application/json', body=json.dumps(o))
        try: body = json.loads(req.post_data or '{}')
        except Exception: body = {}
        if u == '/': return route.fulfill(content_type='text/html', body=html)
        if u == '/api/zte':
            p_ = body.get('params') or {}
            if body.get('op') == 'set': log['sets'].append(p_); return j({'success': True, 'data': {'result': 'success'}})
            cmd = p_.get('cmd', '')
            if 'neighbor_cell_info' in cmd: return j({'success': True, 'data': {'neighbor_cell_info': [], 'locked_cell_info': []}})
            if 'lte_band_lock' in cmd and 'net_select' not in cmd: return j({'success': True, 'data': {'lte_band_lock': router_keys.get('lte_band_lock', '1,3'), 'nr_band_lock': router_keys.get('nr_band_lock', '78')}})
            if 'net_select' in cmd: return j({'success': True, 'data': {'net_select': 'WL_AND_5G', 'performance_mode': '0'}})
            d = {'network_type': router_keys.get('network_type', 'LTE'), 'signalbar': router_keys.get('signalbar', '4'), 'lte_rsrp': '-95'}
            d.update({k: v for k, v in router_keys.items() if k not in ('lte_band_lock', 'nr_band_lock')})
            return j({'success': True, 'data': d})
        if u == '/api/shell': return j({'success': True, 'content': tele_text})
        if u == '/api/at':
            c = body.get('command', '')
            if 'support_band' in c: return j({'success': True, 'result': '+SP5GCMDS: get nr support_band,2,78,41\nOK'})
            return j({'success': True, 'result': 'OK'})
        if u == '/api/ping': return j({'ok': True, 'version': '1.4.1'})
        if u == '/api/plugins': return j([])
        return j({})
    page.route('**/*', handle)
    page.goto('http://localhost/'); page.wait_for_timeout(1500)
    return b, page, log, errors

with sync_playwright() as p:
    # ---- items 19 and 21: dialogs and language -------------------------------------------------------------------
    b, page, log, errors = run(p, {}, '', 'ui')
    ok(page.evaluate("document.documentElement.lang") == 'en', 'page language starts as en')
    opener = page.locator("#home button[onclick*=\"'terminal'\"]"); opener.focus(); opener.click(); page.wait_for_timeout(300)
    ok(page.evaluate("document.querySelector('#terminal').getAttribute('role')") == 'dialog', 'opened popup has role=dialog')
    ok(page.evaluate("!!document.querySelector('#terminal').getAttribute('aria-label')"), 'opened popup has a name')
    ok(page.evaluate("document.activeElement && document.activeElement.id") == 'cmd', 'focus moves into the popup (the terminal input)')
    for _ in range(6): page.keyboard.press('Tab')
    ok(page.evaluate("document.querySelector('#terminal').contains(document.activeElement)"), 'Tab stays inside the popup')
    page.keyboard.press('Shift+Tab'); page.keyboard.press('Shift+Tab'); page.keyboard.press('Shift+Tab')
    ok(page.evaluate("document.querySelector('#terminal').contains(document.activeElement)"), 'Shift+Tab stays inside the popup')
    page.keyboard.press('Escape'); page.wait_for_timeout(300)
    ok(not page.evaluate("document.querySelector('#terminal').classList.contains('open')"), 'Escape closes the popup')
    ok(page.evaluate("document.activeElement && document.activeElement.getAttribute('onclick')") and "terminal" in page.evaluate("document.activeElement.getAttribute('onclick')"), 'focus returns to the button that opened it')
    page.select_option('#langsel', 'fil'); page.wait_for_timeout(200)
    ok(page.inner_text('#logoutbtn') == 'Mag-sign out' and page.evaluate("document.documentElement.lang") == 'fil', 'Filipino: Sign out -> Mag-sign out, lang=fil')
    ok(page.inner_text("#home button[onclick*=\"'pluginmgr'\"]") == 'Mga plugin', 'Filipino: home button translated')
    ok(page.get_attribute('#tok', 'placeholder') == 'Admin password', 'untranslated key keeps its English')
    page.reload(); page.wait_for_timeout(1500)
    ok(page.inner_text('#logoutbtn') == 'Mag-sign out' and page.input_value('#langsel') == 'fil', 'language choice survives a reload')
    page.select_option('#langsel', 'en'); page.wait_for_timeout(200)
    ok(page.inner_text('#logoutbtn') == 'Sign out', 'back to English')
    ok(not errors, 'no page errors ' + ' | '.join(errors)); b.close()

    # ---- items 22 and 25: serving cell from telephony, source label ----------------------------------------------
    b, page, log, errors = run(p, {'network_type': 'LTE'}, TELE, 'tele')
    ok(page.evaluate("typeof window.MatchiLive === 'object'"), 'MatchiLive snapshot is exposed')
    snap = page.evaluate("window.MatchiLive.snapshot()")
    print('  snapshot:', json.dumps(snap)[:300])
    ok(bool(snap) and snap['lte']['src'] == 'Android telephony' and snap['lte']['pci'] == '77', 'router left PCI empty -> PCI 77 from Android telephony, labelled')
    ok('Android' in page.inner_text('#liv_inline .liv-kv'), 'the 4G box says the PCI came from Android')
    page.locator('#dash_cell [data-a=toggle]').click(); page.wait_for_timeout(800)
    txt = page.inner_text('#dash_cell .dc-dyn')
    ok('PCI 77' in txt and 'Android telephony' in txt, 'Cell lock offers the telephony cell, marked: ' + txt.replace('\n', ' | ')[:120])
    page.locator('#dash_cell [data-a=sv]').click(); page.wait_for_timeout(300)
    ok('Android telephony' in page.inner_text('.modal-bg.show'), 'confirm dialog says the cell comes from Android telephony')
    page.locator('.cok').click(); page.wait_for_timeout(600)
    s = [x for x in log['sets'] if x.get('goformId') == 'CELL_LOCK']
    ok(len(s) == 1 and s[0]['pci'] == '77' and s[0]['earfcn'] == '1850' and s[0]['rat'] == '12', 'CELL_LOCK 77 / 1850 / 4G sent')
    # stale reading: no fallback
    page.evaluate("window.MatchiLive = { snapshot: () => ({ ageMs: 300000, hasLte: true, hasNr: false, lte: { pci: '77', chan: '1850', band: 'B3', src: 'Android telephony' }, nr: {} }) }")
    page.locator('#dash_cell [data-a=refresh]').click(); page.wait_for_timeout(800)
    ok('No serving cell' in page.inner_text('#dash_cell .dc-dyn'), 'a reading older than 2 minutes is not used')
    # router has its own values: no telephony label
    ok(not errors, 'no page errors ' + ' | '.join(errors)); b.close()
    b, page, log, errors = run(p, {'network_type': 'LTE', 'lte_pci': '55', 'wan_active_channel': '1300', 'wan_active_band': 'B3'}, TELE, 'router')
    snap = page.evaluate("window.MatchiLive.snapshot()")
    ok(bool(snap) and snap['lte']['src'] == 'router' and snap['lte']['pci'] == '55', 'router values win and are labelled router')
    ok('router' in page.inner_text('#liv_inline .liv-kv'), 'the 4G box says router'); b.close()

    # ---- item 24: band lock active + no service -----------------------------------------------------------------
    b, page, log, errors = run(p, {'network_type': 'LTE', 'lte_band_lock': '1,3'}, '', 'warn')
    page.evaluate("window.MatchiLive = { snapshot: () => ({ ageMs: 1000, noService: false }) }; document.dispatchEvent(new CustomEvent('matchi:live'))"); page.wait_for_timeout(200)
    ok(page.locator('#dash_radio .dr-warn').count() == 0, 'lock active, service fine: no warning')
    page.evaluate("window.MatchiLive = { snapshot: () => ({ ageMs: 1000, noService: true }) }; document.dispatchEvent(new CustomEvent('matchi:live'))"); page.wait_for_timeout(200)
    ok(page.locator('#dash_radio .dr-warn').count() == 1 and 'Unlock all' in page.inner_text('#dash_radio .dr-warn'), 'lock active + no service: warning with the way out')
    page.evaluate("window.MatchiLive = { snapshot: () => ({ ageMs: 1000, noService: false }) }; document.dispatchEvent(new CustomEvent('matchi:live'))"); page.wait_for_timeout(200)
    ok(page.locator('#dash_radio .dr-warn').count() == 0, 'service back: warning gone')
    ok(not errors, 'no page errors ' + ' | '.join(errors)); b.close()
    b, page, log, errors = run(p, {'network_type': 'LTE', 'lte_band_lock': '1,2,3,4,5,7,8,12,13,17,18,19,20,25,26,28,34,38,39,40,41,42,43', 'nr_band_lock': '78,41'}, '', 'nolock')
    page.evaluate("window.MatchiLive = { snapshot: () => ({ ageMs: 1000, noService: true }) }; document.dispatchEvent(new CustomEvent('matchi:live'))"); page.wait_for_timeout(200)
    ok(page.locator('#dash_radio .dr-warn').count() == 0, 'no band lock (every band allowed) + no service: no band-lock warning'); b.close()
sys.exit(1 if fails else 0)

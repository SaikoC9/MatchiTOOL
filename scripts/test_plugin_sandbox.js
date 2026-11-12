#!/usr/bin/env node
// Tests the pure parts of web-src/plugin-sandbox.js as shipped in index.html: grant parsing, the frame's policy and document, the per-call
// authorization, the private storage and the rate limit. Also checks that the page and PluginSandbox.kt agree on the limits, the host pattern
// and the wording. What it cannot show is that a real browser keeps the frame apart: scripts/phase0/test_plugin_sandbox_browser.js does that.
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'app/src/main/assets/web/index.html'), 'utf8');
const kt = fs.readFileSync(path.join(root, 'app/src/main/java/com/matchi/tool/PluginSandbox.kt'), 'utf8');
const a = html.indexOf('/* @include web-src/plugin-sandbox.js */'), b = html.indexOf('/* @end-include web-src/plugin-sandbox.js */');
if (a < 0 || b < a) { console.error('plugin-sandbox.js is not included in index.html'); process.exit(1); }
const ctx = vm.createContext({ window: {}, console, Map, Set, Date, Math, Number, JSON, String, Array });
const api = vm.runInContext(html.slice(a, b) + '\n;({sbxGrants,sbxDescribe,sbxCsp,sbxDoc,sbxEscCode,sbxAuthorize,sbxStore,sbxMemStorage,sbxRateOk,SBX_PRELUDE,SBX_MAX_FIELDS,SBX_HOST_RX,sbxSandboxMsg,sbxTrustMsg})', ctx);
let bad = 0;
const eq = (x, y, m) => { if (JSON.stringify(x) !== JSON.stringify(y)) { console.error('FAIL ' + m + ': ' + JSON.stringify(x) + ' != ' + JSON.stringify(y)); bad++; } };
const yes = (c, m) => { if (!c) { console.error('FAIL ' + m); bad++; } };

// ---- grants
const g = api.sbxGrants(['sbx:at.read', 'sbx:router:signalbar', 'sbx:router:lan_ipaddr', 'sbx:shell:cat /proc/uptime', 'sbx:net:api.example.com']);
yes(g.at, 'at.read parsed'); eq([...g.router].sort(), ['lan_ipaddr', 'signalbar'], 'router fields'); eq([...g.shell], ['cat /proc/uptime'], 'shell command'); eq(g.net, ['api.example.com'], 'net host');
const bd = api.sbxGrants(['sbx:router:bad field', 'sbx:router:a;b', 'sbx:net:evil.com; script-src *', 'sbx:net:a..b', 'sbx:net:UPPER.com', 'sbx:net:', 'junk', 'sbx:shell:', 7, null]);
yes(!bd.at && !bd.router.size && !bd.shell.size && !bd.net.length, 'malformed grants give nothing');
eq(api.sbxGrants(null).net, [], 'no grant list');
eq(api.sbxGrants(['sbx:net:a.com', 'sbx:net:a.com']).net, ['a.com'], 'a host is listed once');

// ---- policy
const none = api.sbxCsp(api.sbxGrants([]));
yes(/connect-src 'none'/.test(none) && /default-src 'none'/.test(none) && /form-action 'none'/.test(none) && /frame-src 'none'/.test(none) && /base-uri 'none'/.test(none), 'no hosts: nothing may connect: ' + none);
yes(!/unsafe-eval/.test(none) && !/'self'/.test(none), 'no eval and no self in the frame policy');
const one = api.sbxCsp(api.sbxGrants(['sbx:net:api.example.com', 'sbx:net:evil.com; script-src *']));
yes(/connect-src https:\/\/api\.example\.com;/.test(one) && /img-src data: blob: https:\/\/api\.example\.com;/.test(one), 'an approved host is allowed over https: ' + one);
yes(!/evil/.test(one) && (one.match(/script-src/g) || []).length === 1, 'a host with a policy injection never reaches the policy');
yes(!/"/.test(one), 'the policy has no double quote (it sits in an attribute)');

// ---- document
const evilCode = 'var s="</script><script>alert(1)</script>";/* <!-- */ var t=`<!--`;';
const doc = api.sbxDoc(evilCode, 'My Plugin.js', api.sbxGrants([]), { fg: 'red; x' });
yes(doc.indexOf('Content-Security-Policy') < doc.indexOf('<script>') && doc.indexOf('Content-Security-Policy') > 0, 'the policy comes before any script');
eq((doc.match(/<\/script/gi) || []).length, 2, 'exactly the two closing tags of the document (the plugin cannot add one)');
yes(!doc.includes('<!--'), 'no comment opener from the plugin');
yes(doc.includes('matchi-sandbox/My_Plugin.js'), 'the script is named for the plugin');
yes(!/red; x/.test(doc) && /color:#e8eefc/.test(doc), 'a bad theme colour is ignored');
// the plugin text, once the two escapes are undone, is what the author wrote
const plugin = doc.split('</scr' + 'ipt><script>')[1].split('\n//# sourceURL')[0];
eq(plugin.replace(/<\\\/script/g, '</script').replace(/<\\!--/g, '<!--'), evilCode, 'the escapes only touch what the parser would misread');
new vm.Script(plugin);   // and it is still valid JavaScript
const own = api.sbxDoc('var r=/<\\/script/;', 'p.js', api.sbxGrants([]), {});   // an author's own escape is left alone
yes(own.includes('var r=/<\\/script/;') && (own.match(/<\/script/gi) || []).length === 2, 'code that already escapes the tag is unchanged');
// the bridge text is valid JS and defines window.matchi once
new vm.Script(api.SBX_PRELUDE);
const fw = { listeners: {}, addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }, parent: { id: 'parent' } };
vm.runInContext(api.SBX_PRELUDE, vm.createContext({ window: fw, Map, Promise, Error, String, Array, Object }));
yes(fw.matchi && typeof fw.matchi.shell === 'function' && typeof fw.matchi.storage.set === 'function', 'the bridge defines matchi.*');
yes(Object.isFrozen(fw.matchi), 'and freezes it');

// ---- authorization
const at = (cmd) => /^AT(\+[A-Z0-9_]+)?(\?|=\?)$/i.test(cmd) || cmd === 'AT+CSQ';
const full = api.sbxGrants(['sbx:at.read', 'sbx:router:signalbar,x'.replace(',x', ''), 'sbx:shell:cat /proc/uptime']);
const A = (grants, op, args) => api.sbxAuthorize(grants, op, args, at);
yes(A(api.sbxGrants([]), 'toast', ['hi']).ok, 'toast needs no grant');
eq(A(api.sbxGrants([]), 'toast', ['x'.repeat(999), 'purple']).args, ['x'.repeat(300), ''], 'toast is cut to 300 and an odd colour is dropped');
yes(!A(api.sbxGrants([]), 'toast', [5]).ok, 'toast text must be a string');
yes(!A(api.sbxGrants([]), 'at', ['AT+CSQ']).ok, 'at without the grant is refused');
yes(A(full, 'at', ['AT+CSQ']).ok, 'at with the grant, a read command');
yes(!A(full, 'at', ['AT+CFUN=0']).ok && !A(full, 'at', ['AT+CFUN=0;AT+CSQ']).ok, 'at refuses a write even with the grant');
yes(!api.sbxAuthorize(full, 'at', ['AT+CSQ'], undefined).ok, 'at refuses when the page has no read-only test');
yes(!A(api.sbxGrants([]), 'router.get', [['signalbar']]).ok, 'router without a grant is refused');
yes(A(full, 'router.get', [['signalbar']]).ok, 'router field that was approved');
yes(!A(full, 'router.get', [['signalbar', 'wifi_password']]).ok, 'one field that was not approved refuses the whole call');
yes(!A(full, 'router.get', ['signalbar']).ok && !A(full, 'router.get', [[]]).ok, 'router needs a list of fields');
yes(!A(api.sbxGrants(['sbx:router:a']), 'router.get', [Array.from({ length: 25 }, () => 'a')]).ok, 'more than 20 fields refused');
yes(A(full, 'shell', ['cat /proc/uptime']).ok, 'the exact declared command runs');
yes(!A(full, 'shell', ['cat /proc/uptime; id']).ok && !A(full, 'shell', ['cat /proc/uptime ']).ok && !A(full, 'shell', ['cat  /proc/uptime']).ok && !A(full, 'shell', ['id']).ok, 'nothing but the exact text runs');
yes(!A(api.sbxGrants([]), 'shell', ['cat /proc/uptime']).ok, 'shell without a grant is refused');
yes(!A(full, 'shell', [['cat /proc/uptime']]).ok, 'shell needs a string');
yes(!A(full, 'fetch', ['/api/shell']).ok && !A(full, '__proto__', []).ok && !A(full, 'constructor', []).ok, 'unknown operations are refused');
yes(A(full, 'storage.set', ['k', 'v']).ok && !A(full, 'storage.set', ['k']).ok && !A(full, 'storage.get', ['x'.repeat(65)]).ok, 'storage argument checks');
yes(A(full, 'close', []).ok && A(full, 'info', []).ok, 'close and info');
yes(!A(full, 'show', []).ok, 'a plugin cannot open its own window uninvited');

// ---- storage
const mem = api.sbxMemStorage(), s1 = api.sbxStore(mem, 'A.js'), s2 = api.sbxStore(mem, 'B.js');
s1.set('k', 'one'); s2.set('k', 'two');
eq([s1.get('k'), s2.get('k'), s1.get('none')], ['one', 'two', null], 'each plugin has its own keys');
eq(s1.keys(), ['k'], 'keys lists only its own');
let threw = (f) => { try { f(); return false; } catch (_) { return true; } };
yes(threw(() => s1.set('bad key', 'x')) && threw(() => s1.set('', 'x')) && threw(() => s1.get('a/b')), 'key characters');
yes(threw(() => s1.set('big', 'x'.repeat(32769))), 'one value is at most 32 KB');
for (let i = 0; i < 99; i++) s1.set('k' + i, 'v');
yes(threw(() => s1.set('one-too-many', 'v')), 'at most 100 keys');
s1.set('k', 'changed'); eq(s1.get('k'), 'changed', 'an existing key can still be changed at the limit');
const s3 = api.sbxStore(api.sbxMemStorage(), 'C.js');
for (let i = 0; i < 8; i++) s3.set('big' + i, 'x'.repeat(32000));
yes(threw(() => s3.set('more', 'x'.repeat(32000))), 'the plugin total is at most 256 KB');
s1.purge(); eq([s1.keys(), s2.keys()], [[], ['k']], 'purge removes only that plugin\'s keys');

// ---- rate limit
const ent = { rate: { t: 0, n: 0 } };
let allowed = 0; for (let i = 0; i < 100; i++) if (api.sbxRateOk(ent, 5000)) allowed++;
eq(allowed, 40, '40 calls per second');
yes(api.sbxRateOk(ent, 6100), 'a new second starts fresh');

// ---- the page and PluginSandbox.kt agree
const ktNum = (n) => Number((kt.match(new RegExp(n + ' = (\\d+)')) || [])[1]);
eq(ktNum('SBX_MAX_ROUTER'), api.SBX_MAX_FIELDS, 'router field limit (page and Kotlin)');
eq(ktNum('SBX_SHELL_MAX_LEN'), 300, 'shell length limit is 300 on both sides');
const ktHost = (kt.match(/NET_HOST = Regex\("([^"]+)"\)/) || [])[1];
eq(api.SBX_HOST_RX.source.replace(/\\\//g, '/'), ktHost.replace(/^\^/, '^').replace(/\$$/, '$'), 'host pattern (page and Kotlin)');
const words = [...kt.matchAll(/"in the sandbox: ([^"]*)"/g)].map((m) => m[1]);
eq(words, ['reads the modem with read-only AT commands', 'reads router field ', 'runs this root command: ', 'contacts '], 'Kotlin wording list');
eq([api.sbxDescribe('sbx:at.read'), api.sbxDescribe('sbx:router:x'), api.sbxDescribe('sbx:shell:id'), api.sbxDescribe('sbx:net:h.com')],
  [words[0], words[1] + 'x', words[2] + 'id', words[3] + 'h.com'], 'dialog wording (page and Kotlin)');
for (const t of [api.sbxSandboxMsg({ name: 'X.js', declared: ['sbx:shell:id'], sbxProblems: ['bad line'] }), api.sbxTrustMsg({ name: 'X.js' })]) yes(t.includes('X.js') && t.includes('password'), 'confirm text names the plugin and the password');
yes(api.sbxSandboxMsg({ name: 'X.js', declared: [] }).includes('nothing beyond'), 'a plugin that asks for nothing says so');

// ---- Phase 5: the page relays device calls to the host route, and the host knows the same operations
yes(html.includes("/api/plugins/call") && !/sbxRun[\s\S]*?api\('\/api\/shell'/.test(html.slice(a, b)), 'the bridge relays device calls to /api/plugins/call');
const ops = [...kt.matchAll(/^    "([a-z.]+)" ->/gm)].map((m) => m[1]);
eq(ops.sort(), ['at', 'router.get', 'shell'], 'sandboxCallError handles the same three device operations');
const ktRoute = fs.readFileSync(path.join(root, 'app/src/main/java/com/matchi/tool/WebRoutesPlugins.kt'), 'utf8');
yes(/uri == "\/api\/plugins\/call"[\s\S]*sandboxCallError\(grant, op, args\)[\s\S]*rootGate\(s\)/.test(ktRoute), 'the host route checks sandboxCallError before it runs anything, and the shell op takes the gate');
yes(/sandboxGrant\(record\?\.caps, integrityState\(record\?\.sha, sha256Hex\(f\.readBytes\(\)\)\)\)/.test(ktRoute), 'the grant is computed from the file as it is at the time of the call');

if (bad) { console.error(bad + ' failed'); process.exit(1); }
console.log('plugin sandbox tests passed');

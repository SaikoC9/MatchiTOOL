// Tests scripts/phase0: the plugin scanner on synthetic UFI plugins, and the string-table decoder on a small obfuscator.io style file. Node only.
const { split, scan, scanFiles, summary } = require('./phase0/scan_plugins.js');
const { decode } = require('./phase0/deob_requests_js.js');
let bad = 0;
const eq = (w, g, n) => { if (JSON.stringify(w) !== JSON.stringify(g)) { bad++; console.error('FAIL', n, JSON.stringify(w), '!=', JSON.stringify(g)); } };
const ok = (c, n) => { if (!c) { bad++; console.error('FAIL', n); } };

const bundle = '<!-- [KANO_PLUGIN_START] Sig Meter -->\n<script>\nconst a=UFI_DATA.lte_rsrp,b=UFI_DATA["nr5g_rsrp"],c=UFI_DATA[k];\ncreateToast("x");\nrunShellWithRoot("/data/data/com.minikano.f50_sms/files/jq . x; echo 1 >> /sdcard/ufi_tools_boot.sh");\nfetch(KANO_baseURL+"/goform/goform_get_cmd_process?x=1");\nfetch("/api/get_cookie");\nfetch(`/api/uploads/${n}`);\nfetch(url+"?a");\n</script>\n<!-- [KANO_PLUGIN_END] Sig Meter -->\n<!-- [KANO_PLUGIN_START] 中文 -->\n<script>runShellWithUser("curl https://example.org/a"); const jqx = 1;</script>\n<!-- [KANO_PLUGIN_END] 中文 -->';
const pl = split(bundle, 'f');
eq(['Sig Meter', '中文'], pl.map((p) => p.name), 'two blocks');
eq(['f'], split('<script>1</script>', 'f').map((p) => p.name), 'no markers = one plugin'); eq(0, split('  ', 'f').length, 'blank = none');
const a = scan(pl[0].code);
ok(a.root && !a.user, 'root'); eq(['jq'], a.tools, 'jq found'); eq(['lte_rsrp', 'nr5g_rsrp'], a.dataFields, 'fields'); ok(a.computedFields, 'computed keys flagged');
ok(a.endpoints.includes('/api/get_cookie') && a.endpoints.includes('/api/goform/goform_get_cmd_process'), 'endpoints incl. KANO_baseURL + path');
ok(a.dynamic.some((d) => d.startsWith('/api/uploads')) && a.dynamic.some((d) => d.startsWith('fetch(url')), 'dynamic urls flagged');
ok(a.ufiPaths.includes('/sdcard/ufi_tools_boot.sh') && a.ufiPaths.some((p) => p.startsWith('/data/data/com.minikano.f50_sms')), 'ufi paths');
ok(a.globals.includes('createToast') && a.globals.includes('KANO_baseURL') && a.globals.includes('runShellWithRoot'), 'helpers');
const b = scan(pl[1].code); ok(b.user && !b.root, 'user shell'); eq(['curl'], b.tools, 'whole-word tool match (jqx is not jq)'); eq(['example.org'], b.hosts, 'host');
const s = summary([{ ...a, name: 'a' }, { ...b, name: 'b' }]); eq([2, 1, 1], [s.plugins, s.root, s.user], 'summary counts');

// A tiny obfuscator.io style file: array function, decoder with offset, rotation, alias, one computed call.
const arr = ['/api/root_shell', 'alpha', 'beta', 'gamma', 'delta', 'POST'];
const pad = 'x'.repeat(2100);
const rot = 3; const rotated = arr.slice(rot).concat(arr.slice(0, rot));   // the rotation below undoes this
const src = `function _0x2a(_0xa,_0xb){const _0xc=_0x3b();return _0x2a=function(_0xd,_0xe){_0xd=_0xd-0x10;let _0xf=_0xc[_0xd];return _0xf;},_0x2a(_0xa,_0xb);}
function _0x3b(){const _0x1=${JSON.stringify(rotated)};/*${pad}*/_0x3b=function(){return _0x1;};return _0x3b();}
(function(_0xa,_0xb){const _0xc=_0x2a,_0xd=_0xa();let n=${rot};while(n--){_0xd.push(_0xd.shift());}}(_0x3b,0x1));
const _0xa11a5=_0x2a;
fetch(_0x2a(0x10),{method:_0xa11a5(0x15)});var k=_0x2a(q-1);`;
const r = decode(src);
ok(r.code.includes('fetch("/api/root_shell",{method:"POST"})'), 'decoded literal calls incl. alias: ' + r.code.slice(-120));
eq(2, r.replaced, 'two calls replaced'); ok(r.code.includes('_0x2a(q-1)'), 'computed call left alone'); eq(2, r.aliases, 'aliases found (the rotation call has one too)');
let threw = false; try { decode('var a=1;'); } catch (_) { threw = true; } ok(threw, 'non-obfuscated input is refused');
const at = scan('fetch(`${KANO_baseURL}/AT?command=${encodeURIComponent(c)}&slot=0`, { headers: common_headers });');
eq(['/api/AT'], at.endpoints, 'template-literal ${KANO_baseURL}/AT route is listed'); eq([], at.dynamic, 'and is not reported as dynamic');
if (bad) { console.error(bad + ' phase0 test(s) failed'); process.exit(1); }
console.log('phase0 tool tests passed');

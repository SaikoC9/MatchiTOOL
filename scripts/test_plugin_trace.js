#!/usr/bin/env node
// Tests web-src/plugin-trace.js: which plugin a stack belongs to, and that only the plugin-capable routes get the header.
const fs = require('fs'), vm = require('vm'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'app/src/main/web-src/plugin-trace.js'), 'utf8');
const calls = [];
const win = { fetch: function (i, init) { calls.push([i, init]); return Promise.resolve({}); } };
const ctx = vm.createContext({ window: win, Headers, Error, console });
vm.runInContext(src, ctx);
let bad = 0; const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) { console.error('FAIL ' + m + ': ' + JSON.stringify(a) + ' != ' + JSON.stringify(b)); bad++; } };
const pf = vm.runInContext('pluginFromStack', ctx), pi = vm.runInContext('pluginTraceInit', ctx);
eq(pf('Error\n at f (matchi-plugin/Signal_Meter.js:12:5)\n at g (index.html:1:1)'), 'Signal_Meter.js', 'chrome frame');
eq(pf('f@matchi-plugin/My-Block-1f2e3d.html:3:9'), 'My-Block-1f2e3d.html', 'firefox frame');
eq(pf('at x (index.html:5:1)'), null, 'no plugin frame');
eq(pf('matchi-plugin/..%2Fx.js'), null, 'odd name refused');
const hdr = (r) => r && r.headers && r.headers.get('x-matchi-plugin');
const st = 'at p (matchi-plugin/A.js:1:1)';
eq(hdr(pi('/api/shell', { method: 'POST', headers: { 'x-token': 't' } }, st)), 'A.js', 'shell gets header');
eq(pi('/api/shell', { headers: { 'x-token': 't' } }, st).headers.get('x-token'), 't', 'other headers kept');
eq(hdr(pi('https://192.168.0.1:2334/api/root_shell', {}, st)), 'A.js', 'absolute url');
eq(hdr(pi('/api/upload', {}, st)), 'A.js', 'upload');
eq(pi('/api/ping', {}, st), {}, 'ping untouched');
eq(pi('/api/shell', undefined, 'at x (index.html:1:1)'), undefined, 'page call untouched');
eq(hdr(pi('/api/shell', { headers: { 'x-matchi-plugin': 'B.js' } }, st)), 'B.js', 'existing header kept');
// installed wrapper keeps working and passes the original call through
win.fetch('/api/ping', { method: 'GET' });
eq(calls.length, 1, 'wrapper forwards');
if (bad) { console.error(bad + ' failed'); process.exit(1); }
console.log('plugin trace tests passed');

#!/usr/bin/env node
// The plugin guard card's text and data rules (web-src/guard-ui.js), and that the page includes it and the host serves what it reads.
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const ui = require('../app/src/main/web-src/guard-ui.js');
const page = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/web/index.html'), 'utf8');
let n = 0; const t = (name, f) => { f(); n++; };
const rep = (x) => Object.assign({ v: 1, ts: 1000, interval_s: 30, round: 3, scan_ms: 14, procs_seen: 471, plugins: [], actions: [] }, x);
const ans = (x) => Object.assign({ on: true, available: true, running: true, now: 1010, report: rep({}) }, x);

t('norm: garbage and wrong version give off, no report', () => {
  for (const j of [null, undefined, {}, { report: 5 }, { report: { v: 2 } }, { on: true, running: true }]) {
    const s = ui.norm(j); assert.strictEqual(s.report, null); assert.strictEqual(s.running, false); assert.deepStrictEqual(s.rows, []);
  }
});
t('status line: every state in plain words', () => {
  assert.strictEqual(ui.statusLine(ui.norm(ans({ available: false, on: false }))), 'Unavailable: program missing or refused');
  assert.strictEqual(ui.statusLine(ui.norm(ans({ on: false }))), 'Off');
  assert.strictEqual(ui.statusLine(ui.norm(ans({ report: null, running: false }))), 'Starting: no report yet');
  assert.strictEqual(ui.statusLine(ui.norm(ans({ running: false }))), 'Not running: report is outdated');
  assert.strictEqual(ui.statusLine(ui.norm(ans({}))), 'Running: 471 processes, sweep 14 ms, every 30 s');
});
t('rows: sorted by CPU, unknown state becomes OK, capped, bad entries and plugins with no process dropped', () => {
  const plugins = [{ name: 'gone', cpu_pct: 0, procs: 0, state: 'throttled' }, { name: 'b', cpu_pct: 5, procs: 1 }, { name: 'a', cpu_pct: 90.4, budget_pct: 80, rss_kb: 2048, procs: 3, state: 'throttled', strikes: 2 }, null, { cpu_pct: 1 }, { name: 'c', cpu_pct: 5, state: 'weird', procs: 2 }];
  const r = ui.plugRows(rep({ plugins }));
  assert.deepStrictEqual(r.map((x) => x.name), ['a', 'b', 'c']); assert.strictEqual(r[0].cpu, 90); assert.strictEqual(r[2].state, 'ok');
  const many = Array.from({ length: 30 }, (_, i) => ({ name: 'p' + i, cpu_pct: i, procs: 1 }));
  assert.strictEqual(ui.plugRows(rep({ plugins: many })).length, 12);
});
t('actions: newest first, at most 6, text is plain', () => {
  const actions = Array.from({ length: 9 }, (_, i) => ({ ts: 100 + i, what: i === 8 ? 'kill-helper' : 'throttle', plugin: 'AdGuard', comm: 'tr', pid: 7, why: 'cpu 99% for 20 s' }));
  const a = ui.actionList(rep({ actions }));
  assert.strictEqual(a.length, 6); assert.strictEqual(a[0].ts, 108); assert.strictEqual(a[0].what, 'Ended stuck helper');
  assert.ok(/^\d\d:\d\d:\d\d  Ended stuck helper AdGuard \(tr 7\): cpu 99% for 20 s$/.test(ui.actionLine(a[0])));
});
t('formats', () => {
  assert.strictEqual(ui.fmtMem(512), '512 KB'); assert.strictEqual(ui.fmtMem(2048), '2.0 MB'); assert.strictEqual(ui.fmtMem(20480), '20 MB'); assert.strictEqual(ui.fmtCpu(80), '80 %');
});
t('the card never writes markup from text', () => {
  const src = fs.readFileSync(path.join(__dirname, '../app/src/main/web-src/guard-ui.js'), 'utf8');
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(src.replace(/\/\*[\s\S]*?\*\//, '')));
});
t('page and host: module included, routes exist, slow refresh', () => {
  assert.ok(page.includes('/* @include web-src/guard-ui.js */'));
  assert.ok(page.includes("/api/guard/report") && page.includes("/api/guard/state"));
  assert.strictEqual(ui.REFRESH_MS, 120000);
  const dev = fs.readFileSync(path.join(__dirname, '../app/src/main/java/com/matchi/tool/WebRoutesDevice.kt'), 'utf8');
  assert.ok(/"\/api\/guard\/report" && s\.method == Method\.GET/.test(dev) && /"\/api\/guard\/state" && s\.method == Method\.POST -> rootGate/.test(dev));
});
console.log('guard ui test passed: ' + n + ' groups');

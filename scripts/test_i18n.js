#!/usr/bin/env node
// Language switch: the pure parts of web-src/i18n.js, and that every dictionary key is real text in the page (so a renamed label cannot silently lose its translation).
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const core = require('../app/src/main/web-src/i18n.js');
const page = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/web/index.html'), 'utf8');
assert.strictEqual(core.pickLang('', 'en-US'), 'en');
assert.strictEqual(core.pickLang('', 'fil-PH'), 'fil');
assert.strictEqual(core.pickLang('', 'tl'), 'fil');
assert.strictEqual(core.pickLang('', 'tlh'), 'en');            // not Tagalog
assert.strictEqual(core.pickLang('fil', 'en-US'), 'fil');       // saved choice wins
assert.strictEqual(core.pickLang('xx', 'fil'), 'fil');          // unknown saved code ignored
assert.strictEqual(core.translate('fil', 'Close'), 'Isara');
assert.strictEqual(core.translate('fil', 'Not in the dictionary'), 'Not in the dictionary');
assert.strictEqual(core.translate('en', 'Close'), 'Close');
assert.strictEqual(core.translate('fil', 'toString'), 'toString');   // no prototype keys
const base = Object.keys(core.DICT.fil);
for (const lang of Object.keys(core.DICT)) {
  const miss = base.filter((k) => !(k in core.DICT[lang]));
  assert.deepStrictEqual(miss, [], lang + ' misses: ' + miss.join(' | '));
  for (const k of base) assert.ok(String(core.DICT[lang][k]).trim(), lang + ' has an empty text for ' + k);
}
for (const k of base) {
  const esc = k.replace(/&/g, '&amp;');
  // the page text may sit in markup or in a script string; a few texts are put together while it runs (RUNTIME)
  const RUNTIME = ['Live refresh: Off', '▾ Cell lock'];
  const found = page.includes(esc) || RUNTIME.includes(k);
  assert.ok(found, 'dictionary key not found in the page as a label, title or placeholder: ' + k);
}
// texts with a changing value: pieces replaced inside the text (SUBS), and the text-node translator keeps the spaces around a text
assert.strictEqual(core.translateText('fil', ' Refresh '), ' I-refresh ');
assert.strictEqual(core.translateText('fil', 'Live · updated 4 s ago'), 'Live · na-update 4 s ang nakalipas');
assert.strictEqual(core.translateText('fil', 'LTE bands · locked now: B1 B3'), 'Mga LTE band · naka-lock ngayon: B1 B3');
assert.strictEqual(core.translateText('fil', '5G NR bands · locked now: none (all bands allowed)'), 'Mga 5G NR band · naka-lock ngayon: wala (pinapayagan ang lahat ng band)');
assert.strictEqual(core.translateText('en', 'Refresh'), 'Refresh');
assert.strictEqual(core.translateText('fil', '   '), '   ');
for (const [lang, subs] of Object.entries(core.SUBS)) for (const [from] of subs) assert.ok(page.includes(from) || from === ' s ago' || from.startsWith('LTE bands') || from.startsWith('5G NR bands'), lang + ' SUBS piece not in the page: ' + from);
for (const [sel, what] of core.TARGETS) assert.ok(typeof sel === 'string' && /^(text|title|placeholder)$/.test(what), 'bad target ' + sel);
console.log('i18n ok: ' + base.length + ' texts, ' + Object.keys(core.DICT).length + ' language(s), ' + core.TARGETS.length + ' targets');

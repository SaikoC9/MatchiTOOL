// findIn (SMS Delete): the exact text must win over a text that only starts the same, and the closest one in time wins.
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/web/index.html'), 'utf8');
const grab = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('cannot find ' + a); return src.slice(i, j); };
const body = grab('function findIn(list, m) {', "const NOTDELETED = 'NOTDELETED';");
const helpers = grab('const samePhone = (a, b) =>', 'const NOTDELETED');
const pre = grab('const norm = (t) =>', '// The F50 router answers');
const code = `
const decodeBody = (t) => String(t), fmtDate = (d) => String(d), isOut = (t) => ['2','3','4'].includes(String(t));
const tsOf = (s) => { const m = String(s || '').match(/^(\\d{4})-(\\d\\d)-(\\d\\d) (\\d\\d):(\\d\\d):(\\d\\d)/); return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : 0; };
const samePhone = (a, b) => { const da = String(a||'').replace(/\\D/g,''), db = String(b||'').replace(/\\D/g,''); if (!da || !db) return !da && !db && String(a||'').trim().toLowerCase() === String(b||'').trim().toLowerCase(); return da.slice(-9) === db.slice(-9); };
${pre}
${body}
return findIn;`;
const findIn = new Function(code)();
let fails = 0; const ok = (c, n) => { if (!c) { fails++; console.error('FAIL', n); } };
const T = 'Hi! Your DITO balance is P50.00 valid until';   // the first 30 non-space characters are shared by all three
const list = [   // newest first, as Android's store is read
  { number: 'DITO', date: '2026-11-16 10:00:00', text: T + ' 20 Nov', out: false, k: 'new' },
  { number: 'DITO', date: '2026-11-10 10:00:00', text: T + ' 15 Nov', out: false, k: 'mid' },
  { number: 'DITO', date: '2026-11-01 10:00:00', text: T + ' 05 Nov', out: false, k: 'old' },
];
const pick = (txt, date) => (findIn(list, { content: txt, number: 'DITO', date, tag: '10' }) || {}).k;
ok(pick(T + ' 05 Nov', '2026-11-01 10:00:00') === 'old', 'exact text picks the old one, not the newest');
ok(pick(T + ' 15 Nov', '2026-11-10 10:00:00') === 'mid', 'exact text picks the middle one');
ok(pick(T + ' 99 Nov', '2026-11-30 10:00:00') === undefined, 'a text that only starts the same and is far in time is not matched');
const dup = [{ number: 'A1', date: '2026-11-16 10:00:00', text: 'same', out: false, k: 'n' }, { number: 'A1', date: '2026-11-02 10:00:00', text: 'same', out: false, k: 'o' }];
ok((findIn(dup, { content: 'same', number: 'A1', date: '2026-11-02 10:00:01', tag: '10' }) || {}).k === 'o', 'identical texts: the closest in time wins');
if (fails) process.exit(1); console.log('sms findIn tests passed');

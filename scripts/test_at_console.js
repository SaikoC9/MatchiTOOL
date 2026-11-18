// at-console.js (AT & Radio window logic). No device: the real file is run on sample modem text.
const fs = require('fs'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../app/src/main/web-src/at-console.js', 'utf8');
const win = {}; new Function('window', src)(win);
const A = win.MatchiAtConsole; assert(A, 'window.MatchiAtConsole is not defined');

// cleanReply: the closing word goes on its own line, blank lines and CR go away
assert.strictEqual(A.cleanReply('+CSQ: 99,99OK'), '+CSQ: 99,99\nOK');
assert.strictEqual(A.cleanReply('\r\n+COPS: 0,2,"51502"\r\n\r\nOK\r\n'), '+COPS: 0,2,"51502"\nOK');
assert.strictEqual(A.cleanReply('+CME ERROR: 3'), '+CME ERROR: 3');
assert.strictEqual(A.cleanReply(null), '');

// checkCommand: one line, starts with AT, not too long
assert.deepStrictEqual(A.checkCommand('  at+csq '), { ok: true, cmd: 'AT+csq' });
assert.strictEqual(A.checkCommand('').ok, false);
assert.strictEqual(A.checkCommand('hello').ok, false);
assert.strictEqual(A.checkCommand('AT+CSQ\nAT+CFUN=0').ok, false, 'a second line is refused');
assert.strictEqual(A.checkCommand('AT' + 'x'.repeat(250)).ok, false);

// history walks like a shell
const h = A.makeHistory(3);
['AT+A', 'AT+B', 'AT+B', 'AT+C', 'AT+D'].forEach((c) => h.push(c));
assert.deepStrictEqual(h.all(), ['AT+B', 'AT+C', 'AT+D'], 'duplicates collapse, oldest dropped');
assert.strictEqual(h.prev(), 'AT+D'); assert.strictEqual(h.prev(), 'AT+C'); assert.strictEqual(h.prev(), 'AT+B'); assert.strictEqual(h.prev(), 'AT+B');
assert.strictEqual(h.next(), 'AT+C'); assert.strictEqual(h.next(), 'AT+D'); assert.strictEqual(h.next(), '');

// switches
const [volte, vonr] = A.SWITCHES;
assert.strictEqual(volte.write(true), 'AT+CAVIMS=1'); assert.strictEqual(volte.write(false), 'AT+CAVIMS=0');
assert.strictEqual(vonr.write(true), 'AT+SP5GCMDS="set nr param",45,1');
assert.strictEqual(A.readSwitch(volte, '+CAVIMS: 1\nOK'), true);
assert.strictEqual(A.readSwitch(volte, '+CAVIMS: 0\nOK'), false);
assert.strictEqual(A.readSwitch(volte, 'ERROR'), null);
assert.strictEqual(A.readSwitch(vonr, '+SP5GCMDS: "get nr synch_param",42,1\nOK'), true);
assert.strictEqual(A.readSwitch(vonr, '+SP5GCMDS: "get nr synch_param",42,0\nOK'), false);
assert.strictEqual(A.readSwitch(vonr, 'ERROR'), null);
assert.strictEqual(A.judgeSwitch(true, true), 'confirmed');
assert.strictEqual(A.judgeSwitch(true, false), 'differs');
assert.strictEqual(A.judgeSwitch(true, null), 'unreadable');

// meanings
assert.match(A.describeCsq('+CSQ: 99,99'), /unknown/);
assert.strictEqual(A.describeCsq('+CSQ: 20,99'), 'Signal strength about -73 dBm');
assert.strictEqual(A.describeCsq('garbage'), '');
assert.strictEqual(A.describeCesq('+CESQ: 99,99,255,255,20,60'), 'LTE RSRP -80 dBm, RSRQ -9.5 dB');
assert.match(A.describeCesq('+CESQ: 99,99,255,255,255,255'), /RSRP unknown, RSRQ unknown/);
assert.strictEqual(A.describeReg('+CEREG: 2,1,"1A2B","3C4D",7'), 'registered (home)');
assert.strictEqual(A.describeReg('+C5GREG: 0,5'), 'registered (roaming)');
assert.strictEqual(A.describeReg('nothing'), '');

// every quick read is a plain AT command, a "|" list of them, or one of the window's two own reads
for (const g of A.groups) for (const [label, c] of g.items) {
  assert(label && c);
  for (const part of c.split('|')) assert(/^AT/.test(part) || part === '@signal' || part === '@nrbands', 'bad quick read ' + c);
}
console.log('at-console: all checks passed');

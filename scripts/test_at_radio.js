// Parsing and validation helpers of AT_Radio.js (band lock + cell lock). No router, no browser: the real code is cut out of the file.
const fs = require('fs'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../app/src/main/assets/plugins/AT_Radio.js', 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert(i >= 0 && j > i, 'marker missing: ' + a); return src.slice(i, j); };
const code = cut('const parseBands', 'const bandText') + cut('const toList', 'const cellState') + cut('const bandsMsg', 'async function sendBands');
const { parseBands, toList, ratLabel, guessRat, cellOk, bandsCheck } = new Function(code + '; return { parseBands, toList, ratLabel, guessRat, cellOk, bandsCheck };')();
assert.deepStrictEqual(parseBands('41,n78,3,3'), [3, 41, 78]);
assert.deepStrictEqual(parseBands(''), []);
assert.deepStrictEqual(parseBands('all'), []);
assert.strictEqual(parseBands(undefined), null);   // key missing = hide, never "no bands"
assert.deepStrictEqual(toList([{ pci: '1' }]), [{ pci: '1' }]);
assert.deepStrictEqual(toList('[{"pci":"2"}]'), [{ pci: '2' }]);
assert.deepStrictEqual(toList(''), []);
assert.deepStrictEqual(toList('garbage'), []);
assert.strictEqual(ratLabel('12'), '4G'); assert.strictEqual(ratLabel('16'), '5G');
assert.strictEqual(guessRat('n78'), '16'); assert.strictEqual(guessRat('B3'), '12'); assert.strictEqual(guessRat('78'), '');
assert(cellOk('912', '504990', '16')); assert(cellOk('0', '1850', '12'));
assert(!cellOk('1008', '1850', '12')); assert(!cellOk('9', '', '12')); assert(!cellOk('9', '1850', '')); assert(!cellOk('a', '1', '12'));
// read-back after a lock: same list ok; unsupported band dropped (n6) still ok; wrong or empty is not
assert.deepStrictEqual(bandsCheck([41], [41]), { ok: true, dropped: [] });
assert.deepStrictEqual(bandsCheck([1, 5, 8, 28, 41, 78], [1, 5, 6, 8, 28, 41, 78]), { ok: true, dropped: [6] });
assert(!bandsCheck([78], [41]).ok); assert(!bandsCheck([], [41]).ok); assert(!bandsCheck(null, [41]).ok);
console.log('at radio tests passed');

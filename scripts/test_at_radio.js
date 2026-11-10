// Parsing and validation helpers of AT_Radio.js (band lock + cell lock). No router, no browser: the real code is cut out of the file.
const fs = require('fs'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../app/src/main/assets/plugins/AT_Radio.js', 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert(i >= 0 && j > i, 'marker missing: ' + a); return src.slice(i, j); };
const code = cut('const parseBands', 'const bandText') + cut('const toList', 'const cellState');
const { parseBands, toList, ratLabel, guessRat, cellOk } = new Function(code + '; return { parseBands, toList, ratLabel, guessRat, cellOk };')();
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
console.log('at radio tests passed');

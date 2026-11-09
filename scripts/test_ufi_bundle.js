// Tests the UFI-TOOLS bundle functions in index.html (between UFIBUNDLE-BEGIN / UFIBUNDLE-END): parse, build,
// file names and the size/count checks. Node only; the DOM injection (ufiInject) needs a browser and is not covered here.
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'app/src/main/assets/web/index.html'), 'utf8');
const a = html.indexOf('/* UFIBUNDLE-BEGIN */'), b = html.indexOf('/* UFIBUNDLE-END */');
if (a < 0 || b < 0) { console.error('UFIBUNDLE markers missing in index.html'); process.exit(1); }
const api = new Function(html.slice(a, b) + '\nreturn {ufiParse,ufiBuild,ufiFileName,ufiCheck,ufiExportBlocks,UFI_BUNDLE_MAX};')();
const { ufiParse, ufiBuild, ufiFileName, ufiCheck, ufiExportBlocks, UFI_BUNDLE_MAX } = api;
let bad = 0;
const eq = (want, got, n) => { if (JSON.stringify(want) !== JSON.stringify(got)) { bad++; console.error('FAIL', n, JSON.stringify(want), '!=', JSON.stringify(got)); } };
const ok = (c, n) => { if (!c) { bad++; console.error('FAIL', n); } };
const nameRx = /^[A-Za-z0-9._-]{1,80}\.(js|html)$/;

// UFI writes START + name + " -->" + text + "\n" + END, so a block's inside text ends with a newline.
const one = '<!-- [KANO_PLUGIN_START] Demo Plugin -->\n<meta name="x" content="1">\n<style>.a{color:red}</style>\n<script>\nconsole.log("hi")\n</script>\n<!-- [KANO_PLUGIN_END] Demo Plugin -->';
const two = '<!-- [KANO_PLUGIN_START] 中文插件 -->\n<script>var x=1</script>\n<!-- [KANO_PLUGIN_END] 中文插件 -->';
const text = one + '\n' + two;
const blocks = ufiParse(text);
eq(2, blocks.length, 'two blocks');
eq('Demo Plugin', blocks[0].title, 'title with space');
eq('中文插件', blocks[1].title, 'non-Latin title');
ok(blocks[0].content.startsWith('\n<meta') && blocks[0].content.endsWith('</script>\n'), 'inside text kept exactly');
eq(text, ufiBuild(blocks), 'parse then build gives the same file');
eq(0, ufiParse('no markers here').length, 'no markers');
eq(0, ufiParse('<!-- [KANO_PLUGIN_START] A -->x<!-- [KANO_PLUGIN_END] B -->').length, 'end name must match start name');
eq(2, ufiParse(ufiBuild(ufiParse(text))).length, 'second round trip');
ufiParse(text); eq(2, ufiParse(text).length, 'regex state is reset between calls');

for (const t of ['Demo Plugin', '中文插件', '../../etc/passwd', '..', '.hidden', 'a/b\\c', 'x'.repeat(200), '😀']) {
  const n = ufiFileName(t);
  ok(nameRx.test(n) && !n.includes('..') && n.endsWith('.html'), 'safe file name for ' + t.slice(0, 20) + ' -> ' + n);
}
eq(ufiFileName('Demo Plugin'), ufiFileName('Demo Plugin'), 'file name is stable');
ok(ufiFileName('中文插件') !== ufiFileName('其他插件'), 'different non-Latin names do not collide');
ok(ufiFileName('A B') !== ufiFileName('A_B'), 'names that sanitize alike still differ');

eq(null, ufiCheck(blocks, []), 'good bundle passes');
ok(/No plugin/.test(ufiCheck([], [])), 'empty bundle refused');
ok(/share the name/.test(ufiCheck([blocks[0], blocks[0]], [])), 'duplicate names refused');
ok(/over 1 MB/.test(ufiCheck([{ title: 'Big', content: 'x'.repeat(1024 * 1024 + 1) }], [])), 'block over 1 MB refused');
const four = [1, 2, 3, 4, 5].map(i => ({ title: 'B' + i, content: 'x'.repeat(900 * 1024) }));
ok(/4 MB/.test(ufiCheck(four, [])), 'bundle over 4 MB refused');
const many = Array.from({ length: 51 }, (_, i) => ({ title: 'P' + i, content: 'x' }));
ok(/Too many/.test(ufiCheck(many, [])), 'more than 50 refused');
const existing = Array.from({ length: 49 }, (_, i) => ({ name: 'old' + i + '.js', code: 'x' }));
ok(/Too many/.test(ufiCheck(blocks, existing)), 'existing plugins count toward 50');
eq(null, ufiCheck(blocks, [{ name: ufiFileName('Demo Plugin'), code: 'x'.repeat(5000) }]), 'replacing an installed block is not double counted');
const heavy = Array.from({ length: 5 }, (_, i) => ({ name: 'h' + i + '.js', code: 'x'.repeat(1024 * 1024) }));
ok(/5 MB/.test(ufiCheck(blocks, heavy)), 'host storage limit counted');

const exp = ufiExportBlocks([{ name: 'A_Tool.js', kind: 'js', code: 'run()' }, { name: 'x-1.html', kind: 'html', title: 'X', code: '\n<style></style>\n' }]);
eq('<script>\nrun()\n</script>\n', exp[0].content, 'a .js plugin is wrapped in a script block');
eq('A_Tool', exp[0].title, '.js title is the name without .js');
eq('\n<style></style>\n', exp[1].content, 'html plugin written back as it was');
eq(2, ufiParse(ufiBuild(exp)).length, 'export parses back');
ok(UFI_BUNDLE_MAX === 4 * 1024 * 1024, 'bundle limit is 4 MB');

if (bad) { console.error(bad + ' failure(s)'); process.exit(1); }
console.log('ufi bundle tests passed');

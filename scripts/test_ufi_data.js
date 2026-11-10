// Tests the UFI_DATA field discovery in index.html (between UFIDATA-BEGIN / UFIDATA-END). Node only; the poller itself needs a browser.
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'app/src/main/assets/web/index.html'), 'utf8');
const a = html.indexOf('/* UFIDATA-BEGIN */'), b = html.indexOf('/* UFIDATA-END */');
if (a < 0 || b < 0) { console.error('UFIDATA markers missing in index.html'); process.exit(1); }
const { ufiDataFields, ufiChunks, ufiNextDelay, UFI_DEFAULT_FIELDS } = new Function(html.slice(a, b) + '\nreturn {ufiDataFields,ufiChunks,ufiNextDelay,UFI_DEFAULT_FIELDS};')();
let bad = 0;
const eq = (want, got, n) => { if (JSON.stringify(want) !== JSON.stringify(got)) { bad++; console.error('FAIL', n, JSON.stringify(want), '!=', JSON.stringify(got)); } };
const ok = (c, n) => { if (!c) { bad++; console.error('FAIL', n); } };

eq(null, ufiDataFields([]), 'no plugins: no poller');
eq(null, ufiDataFields(['console.log(1)', '<script>var x=UFI_DATA2</script>']), 'plugins that do not mention UFI_DATA: no poller');
eq(['realtime_tx_thrpt', 'lan_ipaddr'], ufiDataFields(['x = UFI_DATA.realtime_tx_thrpt']), 'dot access, lan_ipaddr always added');
eq(['signalbar', 'lte_rsrp', 'lan_ipaddr'], ufiDataFields(["a=UFI_DATA['signalbar']; b = UFI_DATA[\"lte_rsrp\"]"]), 'bracket access');
eq(['a', 'lan_ipaddr'], ufiDataFields(['UFI_DATA?.a', 'UFI_DATA.a']), 'optional chaining, duplicates removed');
eq(['lan_ipaddr'], ufiDataFields(['window.UFI_DATA.lan_ipaddr']), 'only the LAN address');
ok(ufiDataFields(['const k="x"; UFI_DATA[k]']).includes('network_type'), 'computed key falls back to the default fields');
ok(ufiDataFields(['Object.keys(UFI_DATA)']).includes('signalbar'), 'enumerating UFI_DATA falls back to the default fields');
ok(ufiDataFields(['UFI_DATA']).includes('lte_rsrp'), 'a bare mention falls back to the default fields');
ok(!ufiDataFields(['UFI_DATA.cpuUsageInfo']).includes('cpuUsageInfo'), 'UFI computed fields are not asked of the router');
ok(ufiDataFields(['UFI_DATA.bad-name']).every((f) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(f)), 'only safe field names');
const many = Array.from({ length: 100 }, (_, i) => 'UFI_DATA.f' + i).join(';');
ok(ufiDataFields([many]).length <= 60, 'field count is capped');
ok(UFI_DEFAULT_FIELDS.every((f) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(f)), 'default field names are safe');

eq([[1, 2], [3, 4], [5]], ufiChunks([1, 2, 3, 4, 5], 2), 'chunks');
eq([], ufiChunks([], 3), 'no chunks');
eq(10000, ufiNextDelay(0), 'normal delay');
eq(20000, ufiNextDelay(1), 'delay doubles after a failure');
eq(60000, ufiNextDelay(9), 'delay is capped at 60 s');
if (bad) { console.error(bad + ' failure(s)'); process.exit(1); }
console.log('UFI_DATA field test passed');

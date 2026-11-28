// Network Diagnostics view model: the script's key=value lines -> verdict, tiles and lists (pure part of the Network_Diagnostics tool in index.html).
const fs = require('fs'), assert = require('assert');
const html = fs.readFileSync(__dirname + '/../app/src/main/assets/web/index.html', 'utf8');
const a = html.indexOf('// ---- model:'), b = html.indexOf('// ---- view ----');
assert(a > 0 && b > a, 'model section not found in Network_Diagnostics.js');
const M = new Function(html.slice(a, b) + '\nreturn { model, pingOf };')();
const ok4 = '2 packets transmitted, 2 received, 0% packet loss, time 1001ms rtt min/avg/max/mdev = 25.1/26.0/26.9/0.9 ms';
const base = { ipv4_addr: 'rmnet_data0 10.1.2.3/30;br0 192.168.0.1/24;', ipv6_addr: 'rmnet_data0 2001:db8::5/64;', route4: 'default dev rmnet_data0 table 1;', route6: 'default via fe80::1 dev rmnet_data0 table 1;',
  dns_props: 'net.rmnet_data0.dns1: 8.8.8.8;net.rmnet_data0.ipv6_dns1: 2001:4860:4860::8888;', gateway_ping: 'No gateway address: the mobile link is point-to-point (normal)', public_ipv4: ok4,
  public_ipv6: ok4, dns: 'PING example.com (93.184.216.34) 56(84) bytes of data.' };
const text = (o) => Object.entries(o).map(([k, v]) => k + '=' + v).join('\n');
const m = (o) => M.model(text(Object.assign({}, base, o)));

assert.deepStrictEqual(M.pingOf(ok4), { loss: 0, ms: 26 });
let r = m({});
assert.strictEqual(r.verdict.state, 'ok'); assert.strictEqual(r.verdict.title, 'Online'); assert(/IPv4 26 ms/.test(r.verdict.sub) && /DNS OK/.test(r.verdict.sub));
assert.deepStrictEqual(r.tiles.map((t) => t.state), ['info', 'ok', 'ok', 'ok']);
assert.strictEqual(r.tiles[0].value, 'Direct'); assert.strictEqual(r.tiles[3].sub, 'example.com → 93.184.216.34');
assert.deepStrictEqual(r.addrs.map((x) => x.fam + ' ' + x.tag + ' ' + x.val), ['v4 rmnet_data0 10.1.2.3/30', 'v4 br0 192.168.0.1/24', 'v6 rmnet_data0 2001:db8::5/64']);
assert.deepStrictEqual(r.routes.map((x) => x.fam + ' ' + x.tag + ' ' + x.val), ['v4 rmnet_data0 direct (no gateway)', 'v6 rmnet_data0 via fe80::1']);
assert.deepStrictEqual(r.dnsList.map((x) => x.fam + ' ' + x.tag + ' ' + x.val), ['v4 rmnet_data0 8.8.8.8', 'v6 rmnet_data0 2001:4860:4860::8888']);

// IPv4 only network: IPv6 ping fails with no global v6 address -> "No IPv6", not a fault; still Online
r = m({ ipv6_addr: '', route6: '', public_ipv6: '2 packets transmitted, 0 received, 100% packet loss, time 1010ms' });
assert.strictEqual(r.verdict.title, 'Online'); assert.strictEqual(r.tiles[2].state, 'na'); assert.strictEqual(r.tiles[2].value, 'No IPv6');
// IPv6 ping tool missing the mode: not a fault
r = m({ public_ipv6: "IPv6 ping is not supported by this device's ping tool (not a network fault)" });
assert.strictEqual(r.tiles[2].state, 'na'); assert.strictEqual(r.tiles[2].value, 'Unsupported'); assert.strictEqual(r.verdict.title, 'Online');
// packet loss or a slow answer is a warning, 100% loss on IPv4 is bad
r = m({ public_ipv4: '4 packets transmitted, 3 received, 25% packet loss, time 3000ms rtt min/avg/max/mdev = 20/30/40/5 ms' });
assert.strictEqual(r.tiles[1].state, 'warn'); assert(/25%/.test(r.tiles[1].sub));
r = m({ public_ipv4: '2 packets transmitted, 2 received, 0% packet loss rtt min/avg/max/mdev = 200/250/300/5 ms' });
assert.strictEqual(r.tiles[1].state, 'warn');
// ICMP filtered but DNS works: Limited, not Offline
r = m({ public_ipv4: '2 packets transmitted, 0 received, 100% packet loss, time 1010ms', public_ipv6: '2 packets transmitted, 0 received, 100% packet loss, time 1010ms' });
assert.strictEqual(r.tiles[1].state, 'bad'); assert.strictEqual(r.verdict.title, 'Limited'); assert(/blocked/.test(r.verdict.sub));
// ping works, DNS broken
r = m({ dns: 'ping: unknown host example.com' });
assert.strictEqual(r.tiles[3].state, 'bad'); assert.strictEqual(r.tiles[3].value, 'Failed'); assert.strictEqual(r.verdict.title, 'Limited');
// everything down
r = m({ public_ipv4: '2 packets transmitted, 0 received, 100% packet loss', public_ipv6: '2 packets transmitted, 0 received, 100% packet loss', dns: 'ping: unknown host example.com' });
assert.strictEqual(r.verdict.state, 'bad'); assert.strictEqual(r.verdict.title, 'Offline');
r = m({ ipv4_addr: 'br0 192.168.0.1/24;', ipv6_addr: '', route4: '', route6: '', gateway_ping: 'No IPv4 default route', public_ipv4: '2 packets transmitted, 0 received, 100% packet loss', public_ipv6: '', dns: 'ping: unknown host example.com' });
assert.strictEqual(r.verdict.title, 'Offline'); assert(/No default route/.test(r.verdict.sub)); assert.strictEqual(r.tiles[0].state, 'bad'); assert.deepStrictEqual(r.routes, []);
// no ping tool: unknown unless DNS answers
r = m({ public_ipv4: 'ping utility unavailable', public_ipv6: '', gateway_ping: 'No gateway address', dns: 'No getent/nslookup/ping utility' });
assert.strictEqual(r.verdict.title, 'Unknown'); assert.strictEqual(r.tiles[1].value, 'No ping');
r = m({ public_ipv4: 'ping utility unavailable', public_ipv6: '', dns: '93.184.216.34 example.com' });
assert.strictEqual(r.verdict.title, 'Limited'); assert.strictEqual(r.tiles[3].state, 'ok');
// nothing reported at all must not throw
r = M.model(''); assert(r.verdict && r.tiles.length === 4 && Array.isArray(r.addrs));
// the view never writes markup
const view = html.slice(b, html.indexOf("const host=document.querySelector('.actions-buttons')", b));
assert(!/innerHTML/.test(view), 'the diagnostics view must use textContent only');
console.log('network diagnostics model ok');

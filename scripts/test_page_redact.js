// Runs the page's redaction function (between REDACT-BEGIN / REDACT-END in index.html) on the same cases as
// RedactorTest.kt, so the browser copy of the rules cannot drift from the Kotlin one.
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'app/src/main/assets/web/index.html'), 'utf8');
const a = html.indexOf('/* REDACT-BEGIN'), b = html.indexOf('/* REDACT-END */');
if (a < 0 || b < 0) { console.error('REDACT markers missing in index.html'); process.exit(1); }
const code = html.slice(a, b) + '\nreturn {redactLine, redactText, rdLuhn};';
const { redactLine, redactText, rdLuhn } = new Function(code)();
const r = s => redactLine(s, {});
let bad = 0;
const eq = (want, got, name) => { if (want !== got) { bad++; console.error('FAIL', name, JSON.stringify(want), '!=', JSON.stringify(got)); } };
const ok = (c, name) => { if (!c) { bad++; console.error('FAIL', name); } };

eq('login password=[REDACTED] ok', r('login password=hunter2 ok'), 'password');
eq('x-token: [REDACTED]', r('x-token: abcdef1234567890'), 'x-token');
eq('Authorization: [REDACTED]', r('Authorization: Bearer abcdef1234567890'), 'authorization');
eq('GET /api?token=[REDACTED]&x=1', r('GET /api?token=abc123def&x=1'), 'query token');
eq('cookie=[REDACTED]', r('cookie="a b c"'), 'cookie');
// Network tools plan, rule 9: same cases as RedactorTest.routerReplyPasswords
eq('{"Password":[REDACTED],"PasswordShow":[REDACTED],"SSID":"home"}', r('{"Password":"MyWifiPass123","PasswordShow":"MyWifiPass123","SSID":"home"}'), 'router reply json');
eq('goformId=APN_PROC_EX&apn_ppp_passwd=[REDACTED]&apn_wan_apn=internet', r('goformId=APN_PROC_EX&apn_ppp_passwd=secret1&apn_wan_apn=internet'), 'apn form');
eq('ppp_passwd: [REDACTED]', r('ppp_passwd: abc'), 'ppp_passwd');
eq('"passphrase":[REDACTED]', r('"passphrase":"x y z"'), 'quoted passphrase');
eq('token expired for user', r('token expired for user'), 'plain token word');
eq('password prompt shown', r('password prompt shown'), 'plain password word');
eq('imei=[ID]', r('imei=860000000000001'), 'labelled imei');
eq('sent [IMEI] to modem', r('sent 490154203237518 to modem'), 'bare imei');
eq('count 123456789012345 rows', r('count 123456789012345 rows'), 'non-luhn 15 digits');
eq('sim [ICCID]', r('sim 8949000000000000000'), 'iccid');
eq('from [PHONE] at 10:00', r('from +639171234567 at 10:00'), 'phone');
eq('version 1.2.3', r('version 1.2.3'), 'version number');
ok(r('+CMGR: "REC UNREAD","+639171234567",,"26/11/08"').startsWith('+CMGR:') && r('+CMGR: "REC UNREAD","+639171234567",,"26/11/08"').endsWith('[SMS redacted]'), 'cmgr');
ok(r('AT+CMGS="+639171234567"').endsWith('[SMS redacted]') && !r('AT+CMGS="+639171234567"').includes('639171234567'), 'cmgs');
eq('sms_body=[SMS redacted]', r('sms_body=Your code is 123456'), 'sms_body');
const pdu = '0791' + 'A'.repeat(60);
ok(r('sms pdu ' + pdu).includes('[HEX redacted]'), 'hex on message line');
eq('hash ' + pdu, r('hash ' + pdu), 'hex elsewhere kept');
ok(rdLuhn('490154203237518') && !rdLuhn('490154203237519') && !rdLuhn('12a'), 'luhn');
eq('a\npassword=[REDACTED]\nb', redactText('a\npassword=x\nb').text, 'text keeps lines');
const t = redactText('password=a\nhello\ntoken=b');
ok(t.counts.secret === 2 && t.total === 2, 'counts');
eq('[PHONE],[PHONE]', r('+639171234567,+639171234568'), 'adjacent phones');
if (bad) { console.error(bad + ' page redaction check(s) failed'); process.exit(1); }
console.log('page redaction matches RedactorTest cases');

/* Read the DMARC aggregate reports sitting in Downloads and say, per sending
 * source, whether it would survive p=quarantine.
 *
 * These arrive weekly from Outlook, Google and others as a .xml.gz attachment, and
 * the useful content is never in the email body. DMARC passes if EITHER DKIM or SPF
 * passes AND aligns with the From domain — both failing is what gets junked, so that
 * is the only thing worth looking for.
 *
 *   node tools/read-dmarc.js
 *
 * Reads only; downloads nothing and sends nothing. Checked in because this decision
 * recurs: before tightening p=quarantine → p=reject, run it again and confirm the
 * failing count is still zero. First run, 2026-10-02: Outlook, 4 messages, all from
 * Resend (Amazon SES), all passing both mechanisms.
 */
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const DIR = 'C:/Users/rotim/Downloads';
const files = fs.readdirSync(DIR).filter((f) => /\.xml(\.gz)?$|\.zip$/i.test(f) && /dmarc|eventually-app\.com!/i.test(f));

const tag = (name, scope) => {
  const m = scope.match(new RegExp('<' + name + '>([\\s\\S]*?)<\\/' + name + '>'));
  return m ? m[1].trim() : '';
};

if (!files.length) { console.log('no DMARC reports found in ' + DIR); process.exit(0); }
console.log('DMARC reports in Downloads: ' + files.length + '\n');

let grandTotal = 0, grandBad = 0;
files.forEach((f) => {
  const raw = fs.readFileSync(path.join(DIR, f));
  const xml = /\.gz$/i.test(f) ? zlib.gunzipSync(raw).toString('utf8') : raw.toString('utf8');

  const from = new Date(+tag('begin', xml) * 1000).toISOString().slice(0, 10);
  const to = new Date(+tag('end', xml) * 1000).toISOString().slice(0, 10);
  console.log('── ' + tag('org_name', xml) + '   ' + from + ' → ' + to);
  console.log('   policy published: p=' + tag('p', xml) + '  sp=' + tag('sp', xml)
    + '  pct=' + tag('pct', xml) + '  adkim=' + tag('adkim', xml) + '  aspf=' + tag('aspf', xml));
  console.log('');
  console.log('   source ip         msgs  dkim   spf    verdict   envelope from');

  const recs = xml.match(/<record>[\s\S]*?<\/record>/g) || [];
  let total = 0, bad = 0;
  recs.forEach((r) => {
    const n = +tag('count', r) || 0;
    const ev = r.match(/<policy_evaluated>[\s\S]*?<\/policy_evaluated>/);
    const pe = ev ? ev[0] : r;
    const dk = tag('dkim', pe), sp = tag('spf', pe);
    const pass = dk === 'pass' || sp === 'pass';
    total += n; if (!pass) bad += n;
    console.log('   ' + tag('source_ip', r).padEnd(17) + String(n).padStart(4) + '  '
      + dk.padEnd(6) + ' ' + sp.padEnd(6) + ' ' + (pass ? 'PASS' : 'FAIL **').padEnd(9)
      + ' ' + tag('envelope_from', r));
  });
  console.log('');
  console.log('   ' + total + ' messages, ' + bad + ' would be quarantined');
  console.log('');
  grandTotal += total; grandBad += bad;
});

console.log('═══ across all reports: ' + grandTotal + ' messages, ' + grandBad + ' failing DMARC');
console.log(grandBad === 0
  ? '    Nothing legitimate is failing — safe to enforce.'
  : '    Investigate the failing sources BEFORE enforcing.');

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

/* 🔴 GOOGLE SENDS .ZIP, EVERYONE ELSE SENDS .GZ — AND READING ONE AS THE OTHER FAILED
   SILENTLY. The filter above has always accepted `.zip`, but the decoder only knew gzip,
   so a Google report was read as raw bytes, matched no tags, and printed
   "1970-01-01 → 1970-01-01, 0 messages" — then the summary still said **"safe to
   enforce"**, because 0 unreadable messages look exactly like 0 failing ones. A tool
   whose job is to green-light tightening the policy must never do that.
   `zlib` handles gzip and deflate streams but NOT the ZIP container, so the local file
   header is parsed by hand: signature, compression method, name/extra lengths, then the
   payload — stored (0) or deflated (8). Enough for a DMARC report, which is one entry. */
function unzipFirst(buf) {
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error('not a zip (bad signature)');
  const method = buf.readUInt16LE(8);
  const nameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  let size = buf.readUInt32LE(18);                    // 0 when a data descriptor is used
  const start = 30 + nameLen + extraLen;
  const data = size ? buf.subarray(start, start + size) : buf.subarray(start);
  if (method === 0) return data;                      // stored
  if (method === 8) return zlib.inflateRawSync(data); // deflate
  throw new Error('unsupported zip compression method ' + method);
}

function readReport(file) {
  const raw = fs.readFileSync(path.join(DIR, file));
  if (/\.gz$/i.test(file)) return zlib.gunzipSync(raw).toString('utf8');
  if (/\.zip$/i.test(file)) return unzipFirst(raw).toString('utf8');
  return raw.toString('utf8');
}

const tag = (name, scope) => {
  const m = scope.match(new RegExp('<' + name + '>([\\s\\S]*?)<\\/' + name + '>'));
  return m ? m[1].trim() : '';
};

if (!files.length) { console.log('no DMARC reports found in ' + DIR); process.exit(0); }
console.log('DMARC reports in Downloads: ' + files.length + '\n');

let grandTotal = 0, grandBad = 0;
const unreadable = [];
files.forEach((f) => {
  let xml;
  try { xml = readReport(f); } catch (e) { unreadable.push(f + '  (' + e.message + ')'); return; }
  /* ⚠️ AN UNPARSEABLE REPORT MUST NOT LOOK LIKE A CLEAN ONE. Before this, a file that
     decoded to nothing printed a 1970 date range and zero messages, and the verdict at
     the bottom still read "safe to enforce". Anything with no `<record>` and no org name
     is counted as UNREADABLE and blocks the verdict instead of quietly scoring zero. */
  if (!tag('org_name', xml) && !/<record>/.test(xml)) { unreadable.push(f + '  (no DMARC content)'); return; }

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
if (unreadable.length) {
  // The whole point of this tool is to green-light tightening the policy. It may not do
  // that while any report is unaccounted for — silence is not the same as a pass.
  console.log('\n🔴 ' + unreadable.length + ' REPORT(S) COULD NOT BE READ — NO VERDICT:');
  unreadable.forEach((u) => console.log('    ' + u));
  console.log('    Fix or remove these and run again. Until then the figures above are incomplete.');
} else {
  console.log(grandBad === 0
    ? '    Nothing legitimate is failing — safe to enforce.'
    : '    Investigate the failing sources BEFORE enforcing.');
}

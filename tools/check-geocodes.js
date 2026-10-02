/* Find events stored a long way from the city they claim.
 *
 *   node tools/check-geocodes.js            summary + the worst offenders
 *   node tools/check-geocodes.js --all      every suspect row
 *   node tools/check-geocodes.js --city=X   just one city
 *
 * READ-ONLY. It changes nothing and writes nothing; it only reads the public API with
 * the anon key, exactly as the globe does.
 *
 * WHY THIS IS HARDER THAN "IS IT FAR FROM ITS CITY".
 *
 * A naive city+country test flags 867 upcoming events, and almost all of them are
 * CORRECT: Portland OR and Portland ME are both "Portland, United States" and 4,081 km
 * apart. Cambridge is MA, UK and ON. There are three Springfields. Flagging those and
 * "fixing" them would destroy real data.
 *
 * So a row is only suspect when all three hold:
 *
 *   1. It sits more than FAR_KM from the median point of its own
 *      city + country + REGION group — region being the state/province parsed out of
 *      `address` ("315 SE 3rd Ave, Portland, OR, 97214" -> OR). That separates the
 *      homonyms, because Portland ME and Portland OR are different groups.
 *   2. Its group has at least MIN_PEERS members, so the median means something.
 *   3. 🔑 ITS OWN ADDRESS NAMES THE CITY IT CLAIMS. This is the discriminator that
 *      makes the rest trustworthy: if the address says "Phoenix, AZ" and the
 *      coordinates are in New Jersey, the provider's own two fields CONTRADICT EACH
 *      OTHER, and that is an error rather than a second city of the same name.
 *
 * The median, not the mean, throughout — one bad row must not drag the centre it is
 * being measured against.
 */
const FAR_KM = 100;
const MIN_PEERS = 5;

const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, 'build-city-pages.js'), 'utf8');
const SUPABASE = SRC.match(/const SUPABASE = '([^']+)'/)[1];
const ANON = process.env.SUPABASE_ANON_KEY || SRC.match(/const ANON = [^;]*?'([A-Za-z0-9._-]{60,})'/s)[1];
const H = { apikey: ANON, Authorization: 'Bearer ' + ANON };

const args = process.argv.slice(2);
const SHOW_ALL = args.includes('--all');
const ONLY = (args.find((a) => a.startsWith('--city=')) || '').split('=')[1] || null;

function km(aLat, aLon, bLat, bLon) {
  const R = 6371, t = (x) => x * Math.PI / 180;
  const dLat = t(bLat - aLat), dLon = t(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(t(aLat)) * Math.cos(t(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
// The state/province, when the address carries one. Two or three letters only, so a UK
// postcode ("CB2 3QB") is rejected rather than mistaken for a region.
function regionOf(address, city) {
  if (!address || !city) return '';
  const parts = String(address).split(',').map((s) => s.trim());
  const ck = String(city).toLowerCase().trim();
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i].toLowerCase() === ck) {
      return /^[A-Za-z]{2,3}$/.test(parts[i + 1]) ? parts[i + 1].toUpperCase() : '';
    }
  }
  return '';
}
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

async function fetchAll() {
  const out = [];
  const now = new Date().toISOString();
  for (let page = 0; page < 80; page++) {
    const from = page * 1000;
    const r = await fetch(SUPABASE + '/rest/v1/events'
      + '?select=event_id,title,city,country,address,venue,lat,lon,display_source,is_native'
      + '&start_time=gte.' + encodeURIComponent(now) + '&order=event_id',
      { headers: { ...H, Range: from + '-' + (from + 999), 'Range-Unit': 'items' } });
    if (!r.ok) throw new Error('events fetch ' + r.status);
    const batch = await r.json();
    out.push(...batch);
    if (batch.length < 1000) break;
  }
  return out;
}

(async () => {
  const rows = await fetchAll();
  console.log('checked ' + rows.length + ' upcoming events\n');

  const groups = new Map();
  rows.forEach((e) => {
    if (!e.city || e.lat == null || e.lon == null) return;
    const key = [String(e.city).toLowerCase().trim(),
                 String(e.country || '').toLowerCase().trim(),
                 regionOf(e.address, e.city)].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  });

  const suspect = [];
  for (const [, g] of groups) {
    if (g.length < MIN_PEERS) continue;
    const mLat = median(g.map((e) => e.lat)), mLon = median(g.map((e) => e.lon));
    g.forEach((e) => {
      const d = km(e.lat, e.lon, mLat, mLon);
      if (d <= FAR_KM) return;
      // Condition 3: the address must name the city, or this is just a place we cannot judge.
      // ⚠️ TRIM the city. Some rows carry a trailing space ("Łódź "), and without the trim
      // this looked for "łódź " — with the space — in an address reading "Łódź, Łódzkie".
      // It never matched, so three events stored in WARSAW were silently passed over.
      const addressAgrees = String(e.address || '').toLowerCase()
        .includes(String(e.city).toLowerCase().trim());
      if (!addressAgrees) return;
      suspect.push({ ...e, d, mLat, mLon, peers: g.length });
    });
  }
  suspect.sort((a, b) => b.d - a.d);

  const shown = ONLY ? suspect.filter((e) => (e.city || '').toLowerCase() === ONLY.toLowerCase()) : suspect;
  console.log('SUSPECT: ' + suspect.length + ' events whose address names their city but whose');
  console.log('         coordinates are more than ' + FAR_KM + ' km from it.\n');

  const bySource = {};
  suspect.forEach((e) => { const k = e.is_native ? 'native (ours)' : e.display_source; bySource[k] = (bySource[k] || 0) + 1; });
  console.log('  by source: ' + Object.entries(bySource).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v).join(', ') + '\n');

  // Group the output by place, because these come in clusters — one bad venue, many events.
  const byPlace = new Map();
  shown.forEach((e) => {
    const k = e.city + ', ' + (e.country || '') + ' @ ' + e.lat.toFixed(2) + ',' + e.lon.toFixed(2);
    if (!byPlace.has(k)) byPlace.set(k, []);
    byPlace.get(k).push(e);
  });
  const places = [...byPlace.entries()].sort((a, b) => b[1].length - a[1].length);
  console.log('  ' + places.length + ' distinct wrong locations:\n');
  places.slice(0, SHOW_ALL ? places.length : 12).forEach(([, g]) => {
    const e = g[0];
    console.log('  ' + String(g.length).padStart(4) + ' events  ' + e.city + ', ' + (e.country || ''));
    console.log('        stored at ' + e.lat.toFixed(4) + ', ' + e.lon.toFixed(4)
      + '   but the city is at ' + e.mLat.toFixed(4) + ', ' + e.mLon.toFixed(4)
      + '   (' + Math.round(e.d) + ' km, ' + e.peers + ' peers)');
    console.log('        venue   ' + (e.venue || '(none)'));
    console.log('        address ' + (e.address || '(none)'));
    console.log('        e.g.    ' + String(e.title).slice(0, 60));
  });
  if (!SHOW_ALL && places.length > 12) console.log('\n  … and ' + (places.length - 12) + ' more locations (--all to see them)');

  /* ---------------------------------------------------------------------------
   * SPLIT CITIES — the case the test above is structurally BLIND to.
   *
   * The test flags rows far from their city's median. It cannot flag rows that ARE the
   * median. Swansea proved this: 15 of its 21 events carried London's coordinates, which
   * dragged the computed "centre of Swansea" to London, so the test flagged the SIX rows
   * that were genuinely right and said nothing about the fifteen that were wrong.
   * **When the majority is wrong, the test inverts.**
   *
   * So also report any city whose rows fall into two or more clusters more than FAR_KM
   * apart. That shows the whole split and leaves the judgement to a person — which is the
   * point, because a split is sometimes correct (a province capital and its districts).
   * ------------------------------------------------------------------------- */
  const splits = [];
  for (const [key, g] of groups) {
    if (g.length < MIN_PEERS) continue;
    const clusters = [];
    g.forEach((e) => {
      const c = clusters.find((c) => km(e.lat, e.lon, c.lat, c.lon) <= FAR_KM);
      if (c) c.rows.push(e); else clusters.push({ lat: e.lat, lon: e.lon, rows: [e] });
    });
    const big = clusters.filter((c) => c.rows.length >= 2).sort((a, b) => b.rows.length - a.rows.length);
    if (big.length < 2) continue;
    if (km(big[0].lat, big[0].lon, big[1].lat, big[1].lon) <= FAR_KM) continue;
    splits.push({ key, big, total: g.length });
  }
  splits.sort((a, b) => b.big[1].rows.length - a.big[1].rows.length);

  console.log('\n\n  ───────────────────────────────────────────────────────────────');
  console.log('  SPLIT CITIES: ' + splits.length + ' cities whose events sit in two or more places '
    + 'more than ' + FAR_KM + ' km apart.');
  console.log('  The check above cannot see these when the WRONG group is the bigger one.');
  console.log('  A split is not automatically an error — a Turkish province capital and its');
  console.log('  districts split legitimately. Read the venue and address before acting.\n');
  splits.slice(0, SHOW_ALL ? splits.length : 10).forEach(({ key, big, total }) => {
    const [city, country] = key.split('|');
    console.log('  ' + city + ', ' + country + '   (' + total + ' events)');
    big.slice(0, 3).forEach((c, i) => {
      const venues = [...new Set(c.rows.map((e) => e.venue || '(no venue)'))];
      console.log('     ' + (i === 0 ? 'largest ' : '   then ') + String(c.rows.length).padStart(4)
        + ' at ' + c.lat.toFixed(4) + ', ' + c.lon.toFixed(4)
        + '   ' + venues.slice(0, 2).join(' / ').slice(0, 64)
        + (venues.length > 2 ? ' +' + (venues.length - 2) + ' more' : ''));
    });
  });
  if (!SHOW_ALL && splits.length > 10) console.log('\n  … and ' + (splits.length - 10) + ' more (--all)');

  console.log('\n  Nothing was changed. These are the provider’s own coordinates.');
})();

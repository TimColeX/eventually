#!/usr/bin/env node
/* Eventually — static city page generator.
 *
 * WHY THIS EXISTS: the app draws 15,000 events on a <canvas>, so a crawler fetching
 * eventually-app.com sees ~500 characters of UI chrome and no events at all. That means
 * nothing to index (no search traffic) and nothing for AdSense to match ads against.
 * These generated pages are plain HTML containing the events as real text — a front door
 * for people still on Google, handing them to the globe once they arrive.
 *
 * The app itself is untouched: these are additional files beside index.html.
 *
 * Usage:
 *   node tools/build-city-pages.js --list          # analyse only, print the shortlist
 *   node tools/build-city-pages.js --list --top=80 # longer shortlist
 *   node tools/build-city-pages.js                 # write pages + sitemap
 *
 * The anon key is the same public key already shipped in the frontend — it grants
 * read-only access to approved events, so it is safe in CI.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SUPABASE = 'https://gpsetmqivzchlvyrcgld.supabase.co';
const ANON = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdwc2V0bXFpdnpjaGx2eXJjZ2xkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1MDM2NzcsImV4cCI6MjA5ODA3OTY3N30.a0BB-FQDh5NKFvgxeSgJ3YmeN_HYOWGLOJza29wW8KI';

const SITE = 'https://eventually-app.com';
// Where to write. Two different layouts have to work:
//   • this working copy, where the deployable site lives in Eventually-site/
//   • the GitHub Pages repo, where the site IS the repo root (no Eventually-site/ there)
// Detecting it means the same script runs locally and in CI with no edits.
const OUT_ROOT = fs.existsSync(path.join(__dirname, '..', 'Eventually-site'))
  ? path.join(__dirname, '..', 'Eventually-site')
  : path.join(__dirname, '..');
const MIN_EVENTS = 10;        // below this a page is too thin to be worth publishing
const MIN_VENUES = 3;         // distinct locations — guards against one venue faking a "city"
const DAYS_AHEAD = 90;
const MAX_LISTED = 40;        // events shown per page

// ── City name cleanup ────────────────────────────────────────────────────────
// Provider data is messy: the same city appears under several names, some rows carry a
// postal district rather than a city, and non-ASCII names need real transliteration or
// the URLs come out unusable. Left uncorrected these produce duplicate pages competing
// for the same search term — exactly what Google penalises.
const ALIASES = new Map(Object.entries({
  'méxico': 'Mexico City', 'ciudad de méxico': 'Mexico City', 'mexico': 'Mexico City',
  'cdmx': 'Mexico City', 'i̇stanbul': 'Istanbul', 'istanbul': 'Istanbul',
  'københavn': 'Copenhagen', 'kobenhavn': 'Copenhagen', 'copenhague': 'Copenhagen',
  'wien': 'Vienna', 'münchen': 'Munich', 'köln': 'Cologne', 'praha': 'Prague',
  'warszawa': 'Warsaw', 'lisboa': 'Lisbon', 'roma': 'Rome', 'milano': 'Milan',
  'firenze': 'Florence', 'napoli': 'Naples', 'torino': 'Turin', 'genève': 'Geneva',
  'zürich': 'Zurich', 'gothenburg': 'Göteborg', 'den haag': 'The Hague',
  "'s-gravenhage": 'The Hague', 'antwerpen': 'Antwerp', 'bruxelles': 'Brussels',
  'brussel': 'Brussels', 'sevilla': 'Seville', 'a coruña': 'A Coruna',
}));

function cleanCity(raw) {
  let s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  // Drop a trailing postal-district marker — a letter ("København V") or a number
  // ("Praha 9", "Praha 1", "Wien 3"). Without this, one city fragments into several
  // pages that then compete with each other for the same search term.
  s = s.replace(/^(.{4,}?)\s+(?:[A-ZÆØÅÄÖÜ]|\d{1,2})$/u, '$1');
  // Drop a trailing bracketed qualifier: "Dublin (City Centre)"
  s = s.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const alias = ALIASES.get(s.toLowerCase());
  return alias || s;
}

// Country data arrives as both names and 2-letter codes (older ingests used codes), which
// splits one city across two entries and forces a needless country suffix in the URL.
const COUNTRY_NAMES = new Map(Object.entries({
  CA: 'Canada', US: 'United States Of America', GB: 'Great Britain', IE: 'Ireland',
  AU: 'Australia', NZ: 'New Zealand', MX: 'Mexico', DE: 'Germany', ES: 'Spain',
  NL: 'Netherlands', SE: 'Sweden', NO: 'Norway', DK: 'Denmark', FI: 'Finland',
  AT: 'Austria', PL: 'Poland', BE: 'Belgium', CH: 'Switzerland', PT: 'Portugal',
  IT: 'Italy', TR: 'Turkey', CZ: 'Czech Republic', GR: 'Greece', ZA: 'South Africa',
  AE: 'United Arab Emirates', BR: 'Brazil', PE: 'Peru', SA: 'Saudi Arabia',
}));
// Short, stable suffix for disambiguating cities that share a name (London GB vs London CA).
const COUNTRY_SLUGS = new Map(Object.entries({
  'canada': 'ca', 'united states of america': 'us', 'great britain': 'uk', 'ireland': 'ie',
  'australia': 'au', 'new zealand': 'nz', 'mexico': 'mx', 'germany': 'de', 'spain': 'es',
  'netherlands': 'nl', 'sweden': 'se', 'norway': 'no', 'denmark': 'dk', 'finland': 'fi',
  'austria': 'at', 'poland': 'pl', 'belgium': 'be', 'switzerland': 'ch', 'portugal': 'pt',
  'italy': 'it', 'turkey': 'tr', 'czech republic': 'cz', 'greece': 'gr', 'south africa': 'za',
}));
function cleanCountry(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  return COUNTRY_NAMES.get(s.toUpperCase()) || s;
}

function slugify(city) {
  return String(city)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // strip accents
    .replace(/ı/g, 'i').replace(/İ/g, 'i')
    .replace(/ø/gi, 'o').replace(/æ/gi, 'ae').replace(/å/gi, 'a')
    .replace(/ß/g, 'ss').replace(/đ/gi, 'd').replace(/ł/gi, 'l')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── Data ─────────────────────────────────────────────────────────────────────
async function fetchAll(select, filter) {
  const out = [];
  for (let page = 0; page < 30; page++) {
    const from = page * 1000;
    const r = await fetch(`${SUPABASE}/rest/v1/events?select=${select}&${filter}`, {
      headers: { apikey: ANON, Authorization: 'Bearer ' + ANON, Range: `${from}-${from + 999}`, 'Range-Unit': 'items' },
    });
    if (!r.ok) throw new Error('events fetch ' + r.status);
    const batch = await r.json();
    out.push(...batch);
    if (batch.length < 1000) break;
  }
  return out;
}

async function cityProse() {
  // Reuses the AI-written city segments the radio host already caches. This is what turns
  // a bare event list into a page with actual substance — the difference between a real
  // page and a thin one.
  const r = await fetch(`${SUPABASE}/rest/v1/city_content?select=city_key,seg_type,script`, {
    headers: { apikey: ANON, Authorization: 'Bearer ' + ANON },
  });
  if (!r.ok) return new Map();
  const rows = await r.json();
  const m = new Map();
  (rows || []).forEach((x) => {
    if (!['history', 'culture', 'events'].includes(x.seg_type)) return;
    const k = String(x.city_key || '').toLowerCase();
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x.script);
  });
  return m;
}

async function analyse() {
  const now = new Date().toISOString();
  const to = new Date(Date.now() + DAYS_AHEAD * 86400000).toISOString();
  const rows = await fetchAll(
    'event_id,title,city,country,start_time,end_time,category,lat,lon,is_native',
    `moderation=eq.approved&published=not.is.false&start_time=gte.${now}&start_time=lte.${to}&order=start_time.asc`
  );

  const byCity = new Map();
  for (const e of rows) {
    const city = cleanCity(e.city);
    if (!city) continue;
    const slug = slugify(city);
    if (!slug) continue;
    const country = cleanCountry(e.country);
    const key = slug + '|' + country;
    if (!byCity.has(key)) byCity.set(key, { city, slug, country, events: [], venues: new Set() });
    const c = byCity.get(key);
    c.events.push(e);
    // Distinct rounded coordinates ≈ distinct venues. A genuine city has many; a data
    // artifact (one venue, or an aggregator's default location) has one or two.
    if (e.lat != null && e.lon != null) c.venues.add(e.lat.toFixed(2) + ',' + e.lon.toFixed(2));
  }

  // MERGE ROWS WITH A MISSING COUNTRY into the same city's main entry. Sources disagree:
  // Ticketmaster sets a country, the feed importer doesn't — so Regina arrived as TWO
  // entries (9 events with country null + 3 with "Canada") and neither cleared the
  // 10-event bar, even though together it comfortably qualifies. Only genuinely different
  // NAMED countries should stay separate (London GB really is not London CA).
  for (const [key, blank] of [...byCity.entries()]) {
    if (blank.country) continue;                                  // has a country → leave it
    const target = [...byCity.values()]
      .filter((o) => o.slug === blank.slug && o.country)
      .sort((a, b) => b.events.length - a.events.length)[0];      // the biggest named-country twin
    if (!target) continue;                                        // nothing to merge into
    target.events.push(...blank.events);
    blank.venues.forEach((v) => target.venues.add(v));
    byCity.delete(key);
  }

  const all = [...byCity.values()].map((c) => ({
    ...c, n: c.events.length, venueCount: c.venues.size,
  })).sort((a, b) => b.n - a.n);

  // Disambiguate collisions (there is more than one London, Springfield, Cambridge…).
  const slugCount = new Map();
  all.forEach((c) => slugCount.set(c.slug, (slugCount.get(c.slug) || 0) + 1));
  all.forEach((c) => {
    if (slugCount.get(c.slug) > 1) {
      // A short ISO-style code, never a truncated country name ("london-great-britai").
      const cc = COUNTRY_SLUGS.get(c.country.toLowerCase()) || slugify(c.country).slice(0, 3);
      c.slug = cc ? c.slug + '-' + cc : c.slug;
    }
  });

  return { all, total: rows.length };
}

const qualifies = (c) => c.n >= MIN_EVENTS && c.venueCount >= MIN_VENUES;

// ── Page template (dark, matching about.html; Sora for headings only) ────────
function page(c, prose, adsOn) {
  const title = `Events in ${c.city} — what's on | Eventually`;
  const desc = `${c.n} events happening in ${c.city}${c.country ? ', ' + c.country : ''} over the next ${DAYS_AHEAD} days. Concerts, theatre, markets and more, updated daily.`;
  const url = `${SITE}/events/${c.slug}/`;
  const fmt = (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' +
      d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' });
  };
  const events = c.events.slice(0, MAX_LISTED);

  // JSON-LD so Google can show these as rich event results.
  const ld = {
    '@context': 'https://schema.org', '@type': 'ItemList',
    itemListElement: events.slice(0, 20).map((e, i) => ({
      '@type': 'ListItem', position: i + 1,
      item: { '@type': 'Event', name: e.title, startDate: e.start_time,
        location: { '@type': 'Place', name: c.city, address: { '@type': 'PostalAddress', addressLocality: c.city, addressCountry: c.country } } },
    })),
  };

  const adUnit = adsOn
    ? '\n  <ins class="adsbygoogle" style="display:block;min-height:250px" data-ad-client="ca-pub-9120618442042757" data-ad-slot="8592986015" data-ad-format="auto" data-full-width-responsive="true"></ins>\n  <script>(adsbygoogle = window.adsbygoogle || []).push({});</script>\n'
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="index,follow">
<link rel="canonical" href="${url}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}">
<meta property="og:type" content="website">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700&display=swap">
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; background:#14100c; color:#ece5da;
    font:16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  /* Blurred globe: one small static image, no JavaScript — these pages must stay fast. */
  .bg { position:fixed; inset:0; z-index:0; overflow:hidden; pointer-events:none; }
  .bg img { position:absolute; top:50%; left:50%; width:min(120vw,1100px); transform:translate(-50%,-50%);
    filter:blur(20px) saturate(1.05); opacity:.40; }
  .bg::after { content:""; position:absolute; inset:0; background:radial-gradient(ellipse at center, rgba(20,16,12,.30) 0%, rgba(20,16,12,.72) 58%, rgba(20,16,12,.95) 100%); }
  .wrap { position:relative; z-index:1; max-width:760px; margin:0 auto; padding:40px 22px 80px; }
  a { color:#f0a24a; }
  .back { display:inline-block; margin-bottom:18px; }
  h1 { font-family:"Sora",system-ui,sans-serif; font-weight:700; font-size:2rem; margin:0 0 6px; letter-spacing:-.02em; }
  h2 { font-family:"Sora",system-ui,sans-serif; font-weight:600; font-size:1.2rem; margin:34px 0 8px; color:#ffd8a8; }
  p, li { color:#d9cfc2; }
  .lead { font-size:1.1rem; color:#ece5da; }
  .muted { color:#9a8f80; font-size:.9rem; }
  .cta { display:inline-block; margin-top:14px; background:#f0a24a; color:#1a1206; font-weight:700;
    text-decoration:none; padding:11px 20px; border-radius:10px; font-family:"Sora",system-ui,sans-serif; }
  ul.events { list-style:none; padding:0; margin:10px 0 0; }
  ul.events li { display:grid; grid-template-columns:1fr auto; gap:10px 16px; align-items:baseline;
    padding:11px 0; border-bottom:1px solid #2e2820; }
  ul.events li:last-child { border-bottom:0; }
  .ev-name { color:#ece5da; font-weight:600; }
  .ev-when { color:#9a8f80; font-size:.88rem; white-space:nowrap; font-variant-numeric:tabular-nums; }
  .ev-cat { color:#9a8f80; font-size:.82rem; grid-column:1/-1; margin-top:-4px; }
  .tag { display:inline-block; font-size:.72rem; color:#f0a24a; border:1px solid #4a3a24;
    border-radius:99px; padding:1px 8px; margin-left:6px; vertical-align:middle; }
  hr { border:none; border-top:1px solid #2e2820; margin:30px 0; }
  .nearby a { display:inline-block; margin:0 10px 8px 0; }
  @media (max-width:600px){ ul.events li { grid-template-columns:1fr; } .ev-when{ white-space:normal; } }
</style>
<script type="application/ld+json">${JSON.stringify(ld)}</script>${adsOn ? '\n<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9120618442042757" crossorigin="anonymous"></script>' : ''}
</head>
<body>
<div class="bg"><img src="/assets/globe-bg.webp" alt="" aria-hidden="true" loading="eager" decoding="async"></div>
<div class="wrap">
  <a class="back" href="/">← Eventually</a>
  <h1>Events in ${esc(c.city)}</h1>
  <p class="lead">${c.n} event${c.n === 1 ? '' : 's'} happening in ${esc(c.city)}${c.country ? ', ' + esc(c.country) : ''} over the next ${DAYS_AHEAD} days.</p>
  <p class="muted">Updated daily · ${c.venueCount} venue${c.venueCount === 1 ? '' : 's'}</p>
  <a class="cta" href="/?city=${encodeURIComponent(c.city)}">Explore ${esc(c.city)} on the globe →</a>
${prose ? '\n  <h2>About ' + esc(c.city) + '</h2>\n' + prose.map((p) => '  <p>' + esc(p) + '</p>').join('\n') + '\n' : ''}
  <h2>What's on</h2>
  <ul class="events">
${events.map((e) => `    <li><span class="ev-name">${esc(e.title)}${e.is_native ? '<span class="tag">On Eventually</span>' : ''}</span><span class="ev-when">${fmt(e.start_time)}</span>${e.category ? `<span class="ev-cat">${esc(e.category)}</span>` : ''}</li>`).join('\n')}
  </ul>
${c.n > MAX_LISTED ? `  <p class="muted" style="margin-top:14px">…and ${c.n - MAX_LISTED} more. <a href="/?city=${encodeURIComponent(c.city)}">See them all on the globe →</a></p>\n` : ''}${adUnit}
  <hr>
  <h2>Nearby cities</h2>
  <p class="nearby">__NEARBY__</p>
  <hr>
  <p class="muted">Eventually · <a href="/">Globe</a> · <a href="/browse/">All cities</a> · <a href="/about.html">About</a> · <a href="/privacy.html">Privacy</a> · <a href="/terms.html">Terms</a></p>
</div>
</body>
</html>`;
}

function browseIndex(list) {
  const byCountry = new Map();
  list.forEach((c) => {
    const k = c.country || 'Elsewhere';
    if (!byCountry.has(k)) byCountry.set(k, []);
    byCountry.get(k).push(c);
  });
  const sections = [...byCountry.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([country, cities]) =>
    `  <h2>${esc(country)}</h2>\n  <p class="nearby">` +
    cities.sort((a, b) => a.city.localeCompare(b.city))
      .map((c) => `<a href="/events/${c.slug}/">${esc(c.city)} <span class="muted">(${c.n})</span></a>`).join(' ') + '</p>'
  ).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Browse events by city | Eventually</title>
<meta name="description" content="Every city with events on Eventually — browse ${list.length} cities and see what's happening near you.">
<meta name="robots" content="index,follow">
<link rel="canonical" href="${SITE}/browse/">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700&display=swap">
<style>
  :root { color-scheme: dark; }
  * { box-sizing:border-box; }
  body { margin:0; background:#14100c; color:#ece5da; font:16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .bg { position:fixed; inset:0; z-index:0; overflow:hidden; pointer-events:none; }
  .bg img { position:absolute; top:50%; left:50%; width:min(120vw,1100px); transform:translate(-50%,-50%); filter:blur(20px) saturate(1.05); opacity:.40; }
  .bg::after { content:""; position:absolute; inset:0; background:radial-gradient(ellipse at center, rgba(20,16,12,.30) 0%, rgba(20,16,12,.72) 58%, rgba(20,16,12,.95) 100%); }
  .wrap { position:relative; z-index:1; max-width:860px; margin:0 auto; padding:40px 22px 80px; }
  a { color:#f0a24a; }
  h1 { font-family:"Sora",system-ui,sans-serif; font-weight:700; font-size:2rem; margin:0 0 6px; letter-spacing:-.02em; }
  h2 { font-family:"Sora",system-ui,sans-serif; font-weight:600; font-size:1.05rem; margin:28px 0 6px; color:#ffd8a8; }
  p { color:#d9cfc2; }
  .muted { color:#9a8f80; font-size:.85em; }
  .nearby a { display:inline-block; margin:0 12px 8px 0; }
  hr { border:none; border-top:1px solid #2e2820; margin:30px 0; }
</style>
</head>
<body>
<div class="bg"><img src="/assets/globe-bg.webp" alt="" aria-hidden="true"></div>
<div class="wrap">
  <a href="/">← Eventually</a>
  <h1>Browse events by city</h1>
  <p>${list.length} cities with events on Eventually right now. Updated daily.</p>
${sections}
  <hr>
  <p class="muted">Eventually · <a href="/">Globe</a> · <a href="/about.html">About</a> · <a href="/privacy.html">Privacy</a> · <a href="/terms.html">Terms</a></p>
</div>
</body>
</html>`;
}

function sitemap(list) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    { loc: `${SITE}/`, pri: '1.0', freq: 'daily' },
    { loc: `${SITE}/browse/`, pri: '0.8', freq: 'daily' },
    { loc: `${SITE}/about.html`, pri: '0.4', freq: 'monthly' },
    { loc: `${SITE}/privacy.html`, pri: '0.2', freq: 'yearly' },
    { loc: `${SITE}/terms.html`, pri: '0.2', freq: 'yearly' },
    ...list.map((c) => ({ loc: `${SITE}/events/${c.slug}/`, pri: '0.7', freq: 'daily' })),
  ];
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => `  <url><loc>${u.loc}</loc><lastmod>${today}</lastmod><changefreq>${u.freq}</changefreq><priority>${u.pri}</priority></url>`).join('\n') +
    '\n</urlset>\n';
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  const args = process.argv.slice(2);
  const listOnly = args.includes('--list');
  const noAds = args.includes('--no-ads');
  const topArg = args.find((a) => a.startsWith('--top='));
  const top = topArg ? parseInt(topArg.split('=')[1], 10) : 50;

  const { all, total } = await analyse();
  const good = all.filter(qualifies);
  const rejected = all.filter((c) => c.n >= MIN_EVENTS && !qualifies(c));

  if (listOnly) {
    console.log(`Upcoming events (next ${DAYS_AHEAD} days): ${total}`);
    console.log(`Distinct cities after cleanup: ${all.length}`);
    console.log(`QUALIFYING (>= ${MIN_EVENTS} events AND >= ${MIN_VENUES} venues): ${good.length}\n`);
    console.log(`TOP ${Math.min(top, good.length)} — review before publishing`);
    console.log('  #   city                              country            events  venues  url');
    good.slice(0, top).forEach((c, i) => {
      console.log('  ' + String(i + 1).padStart(3) + ' ' + c.city.padEnd(34) + (c.country || '').padEnd(19) +
        String(c.n).padStart(6) + String(c.venueCount).padStart(8) + '  /events/' + c.slug + '/');
    });
    if (rejected.length) {
      console.log(`\nREJECTED — enough events but too few distinct venues (likely one venue or bad location data):`);
      rejected.slice(0, 15).forEach((c) => {
        console.log('  ✗ ' + (c.city + ', ' + c.country).padEnd(44) + String(c.n).padStart(5) + ' events, only ' + c.venueCount + ' venue(s)');
      });
    }
    return;
  }

  const prose = await cityProse();
  const publish = good.slice(0, top);
  const eventsDir = path.join(OUT_ROOT, 'events');
  fs.mkdirSync(eventsDir, { recursive: true });

  publish.forEach((c) => {
    // Nearby = closest other published cities, so crawlers can walk the whole set.
    const near = publish.filter((o) => o.slug !== c.slug)
      .map((o) => {
        const a = c.events[0], b = o.events[0];
        const d = (a && b && a.lat != null && b.lat != null)
          ? Math.hypot(a.lat - b.lat, (a.lon - b.lon) * Math.cos(a.lat * Math.PI / 180)) : 1e9;
        return { o, d };
      })
      .sort((x, y) => x.d - y.d).slice(0, 6)
      .map(({ o }) => `<a href="/events/${o.slug}/">${esc(o.city)}</a>`).join(' ');

    const dir = path.join(eventsDir, c.slug);
    fs.mkdirSync(dir, { recursive: true });
    const html = page(c, prose.get(c.city.toLowerCase()) || null, !noAds).replace('__NEARBY__', near);
    fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
  });

  fs.mkdirSync(path.join(OUT_ROOT, 'browse'), { recursive: true });
  fs.writeFileSync(path.join(OUT_ROOT, 'browse', 'index.html'), browseIndex(publish), 'utf8');
  fs.writeFileSync(path.join(OUT_ROOT, 'sitemap.xml'), sitemap(publish), 'utf8');
  fs.writeFileSync(path.join(OUT_ROOT, 'robots.txt'),
    `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`, 'utf8');

  console.log(`Wrote ${publish.length} city pages + /browse/ + sitemap.xml + robots.txt`);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });

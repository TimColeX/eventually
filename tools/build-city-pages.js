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
// The "Post live updates" perk in each page's organiser section. Off while live updates
// aren't being promoted (owner, 2026-09-19); flip to put the line back.
const LIVE_UPDATES_PROMO = false;
// Where to write. Two different layouts have to work:
// The repo root IS the deployable site, here and in CI.
//
// This used to write into `Eventually-site/` whenever that folder existed, from the
// era when the site was uploaded from a staging copy. That copy is now gitignored
// and retired, but it still sits in the working tree — so every LOCAL build wrote
// 110 pages into a dead directory and silently changed nothing, while CI (a fresh
// checkout, where the folder does not exist) wrote to the right place. A build that
// reports success and edits nothing is worse than one that fails.
const OUT_ROOT = path.join(__dirname, '..');
const MIN_EVENTS = 10;        // DISTINCT events — see titleKey/qualifies below
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

/* Titles arrive pre-mangled from the providers and it shows on the page:
 *   "Ocean&apos;s Edge"     -> esc() escapes the & again -> "Ocean&amp;apos;s Edge"
 *   "Edge \- Book Talk"     -> an iCal backslash escape that was never unescaped
 * Decode first, then esc() re-escapes correctly exactly once. */
const ENTITIES = { amp: '&', apos: "'", quot: '"', lt: '<', gt: '>', nbsp: ' ', ndash: '–', mdash: '—', hellip: '…' };
function cleanTitle(raw) {
  return String(raw == null ? '' : raw)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => (name.toLowerCase() in ENTITIES ? ENTITIES[name.toLowerCase()] : m))
    .replace(/\\([-.,;:'"])/g, '$1')     // stray iCal-style escapes
    .replace(/\s+/g, ' ')
    .trim();
}

/* Print the time AT THE VENUE.
 *
 * This used to call toLocaleTimeString with no timeZone, so it formatted in
 * whatever zone the build machine ran in — UTC on the GitHub Action. An Adelaide
 * gig at 19:00 local was published as "9:30", which is worse than no page: a
 * reader who trusts it misses the event. Every event now carries an IANA zone,
 * so use it, and fall back to UTC (labelled) only if one is somehow missing. */
function fmtWhen(iso, zone) {
  const d = new Date(iso);
  const tz = zone || 'UTC';
  try {
    const day = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(d);
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(d);
    return day + ' · ' + time;
  } catch {
    return d.toUTCString().slice(0, 16) + ' · ' + d.toUTCString().slice(17, 22) + ' UTC';
  }
};

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

// `performers` arrives with backend/80_event_performers.sql. Until that has run the column
// doesn't exist and asking for it is a 400, so fall back rather than fail the rebuild.
async function fetchWithPerformers(select, filter) {
  try { return await fetchAll(select + ',performers', filter); }
  catch (e) { return fetchAll(select, filter); }
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
  const rows = await fetchWithPerformers(
    // `timezone` is what makes the printed times correct — see fmt() below. description,
    // image_url, address and event_sources feed the Event structured data (ldEvent).
    'event_id,title,city,country,start_time,end_time,category,lat,lon,is_native,timezone,venue,address,description,image_url,event_sources(url,price,currency)',
    `moderation=eq.approved&published=not.is.false&start_time=gte.${now}&start_time=lte.${to}&order=start_time.asc`
  );

  const byCity = new Map();
  for (const e of rows) {
    e.title = cleanTitle(e.title);          // normalise once, before anything groups on it
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

  /* Re-sort after merging. The fetch is ordered by start_time, but the merge above
     APPENDS one city's events to another's, so a merged city (Regina — Ticketmaster
     rows plus the community feeds) came out interleaved: 11 Sept, 15 Sept, 11 Sept.
     The list is chronological or it is noise. */
  for (const c of byCity.values()) {
    c.events.sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
  }

  const all = [...byCity.values()].map((c) => ({
    ...c,
    n: c.events.length,                                   // occurrences (dates)
    distinctN: new Set(c.events.map((e) => titleKey(e.title)).filter(Boolean)).size,
    venueCount: c.venues.size,
  })).sort((a, b) => b.distinctN - a.distinctN);           // rank by real variety

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

/* One recurring show listed forty times is one event, not forty. Both the publish
   gate and the on-page list key off this, so they can never disagree. */
const titleKey = (t) => String(t || '').trim().toLowerCase().replace(/\s+/g, ' ');

/* Gate on DISTINCT events, not occurrences. Using the raw count let a city with
   42 dates of a single exhibition clear a "10 events" bar with one thing to do —
   exactly the thin page this threshold exists to prevent.
 *
 * The venue test is a PROXY for "a real place with a real scene, rather than one
 * venue's calendar wearing a city's name". Distinct coordinates usually say that
 * well, but they misfire on community feeds: every event from a feed inherits the
 * one campus coordinate in its config, so the University of Saskatchewan's 242
 * distinct public events across two calendars counted as 2 "venues" and Saskatoon
 * was refused a page. Wellington, a capital city, was refused for the same reason.
 *
 * So: three locations as before, OR two locations backed by real volume. That
 * still rejects the case the guard was built for — Merksem (80 events, ONE
 * coordinate, a district of Antwerp that already has its own page) stays out,
 * because a single location is never enough however many events it lists. */
const VOLUME_OVERRIDE = 40;
const qualifies = (c) =>
  c.distinctN >= MIN_EVENTS &&
  (c.venueCount >= MIN_VENUES || (c.venueCount >= 2 && c.distinctN >= VOLUME_OVERRIDE));

// ── Page template (dark, matching about.html; Sora for headings only) ────────
function page(c, prose, adsOn) {
  const title = `Events in ${c.city} — what's on | Eventually`;
  const desc = `${c.n} events happening in ${c.city}${c.country ? ', ' + c.country : ''} over the next ${DAYS_AHEAD} days. Concerts, theatre, markets and more, updated daily.`;
  const url = `${SITE}/events/${c.slug}/`;
  const fmt = fmtWhen;   // shared — see fmtWhen at module scope

  /* Collapse a recurring event into ONE row.
   *
   * A run like "Art for Takayna" appearing fifteen times at fifteen start times is
   * how the Adelaide page came to be mostly the same four words. It reads as
   * spam to a person and as thin/duplicate content to a crawler, and it buries the
   * other events. The list arrives ordered by start_time, so the first occurrence
   * is the earliest — keep that one and count the rest. */
  const collapse = (list) => {
    const byTitle = new Map();
    for (const e of list) {
      const key = titleKey(e.title);
      if (!key) continue;
      const hit = byTitle.get(key);
      if (hit) hit._more++;
      else byTitle.set(key, Object.assign({}, e, { _more: 0 }));
    }
    return Array.from(byTitle.values());
  };

  const distinct = collapse(c.events);
  const events = distinct.slice(0, MAX_LISTED);

  /* Send the city's coordinates with the link. The app can then fly straight there
     instead of geocoding a name — and it removes the "which London?" problem, since
     these pages already disambiguate by country in their slug. */
  const anchor = c.events.find((e) => e.lat != null && e.lon != null);
  const geo = anchor ? `&lat=${anchor.lat}&lon=${anchor.lon}` : '';

  /* JSON-LD so Google can show these as rich event results.
   *
   * Search Console flagged the Event data (2026-09-13) as missing performer, endDate,
   * offers, image and description — it carried only name, start and place. Each field
   * is now filled from what we actually hold, and LEFT OUT when we don't: a guessed end
   * time or a stand-in photo would be worse than a non-critical warning.
   *   description — the event's own text, trimmed; else a plain factual line
   *   image       — the provider's image (≈91% of events)
   *   offers      — the ticket link (every provider listing has one) + price if known
   *   endDate     — only a real end time (≈20% of events)
   *   performer   — the provider's performer names (after 80_event_performers.sql)
   * eventStatus / eventAttendanceMode are Google-recommended and true for every listing
   * here (scheduled, in person). */
  const ldEvent = (e) => {
    const placeName = e.venue || c.city;
    const text = cleanTitle(String(e.description || '').replace(/<[^>]+>/g, ' '));
    const description = text.length >= 20
      ? (text.length > 280 ? text.slice(0, 277).replace(/\s+\S*$/, '') + '…' : text)
      : (placeName !== c.city ? `${e.title} at ${placeName}, ${c.city}.` : `${e.title} in ${c.city}.`);
    const o = {
      '@type': 'Event', name: e.title, startDate: e.start_time, description,
      eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      location: { '@type': 'Place', name: placeName, address: Object.assign({ '@type': 'PostalAddress' },
        e.address ? { streetAddress: e.address } : {}, { addressLocality: c.city, addressCountry: c.country }) },
    };
    if (e.end_time && Date.parse(e.end_time) > Date.parse(e.start_time)) o.endDate = e.end_time;
    if (e.image_url) o.image = [e.image_url];
    const srcs = Array.isArray(e.event_sources) ? e.event_sources : [];
    const link = srcs.find((s) => s && s.url);
    const priced = srcs.find((s) => s && s.price != null && Number.isFinite(Number(s.price)));
    if (link) {
      o.offers = Object.assign({ '@type': 'Offer', url: link.url },
        priced ? { price: String(Number(priced.price)), priceCurrency: priced.currency || 'USD' } : {});
    }
    if (Array.isArray(e.performers) && e.performers.length) {
      o.performer = e.performers.map((name) => ({ '@type': 'PerformingGroup', name }));
    }
    return o;
  };
  const ld = {
    '@context': 'https://schema.org', '@type': 'ItemList',
    itemListElement: events.slice(0, 20).map((e, i) => ({
      '@type': 'ListItem', position: i + 1,
      // Built from the DEDUPED list, so the structured data no longer repeats the
      // same event twenty times — which Google reads as duplicate content too.
      item: ldEvent(e),
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
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700&family=Space+Mono:wght@400;700&display=swap">
<style>
  :root {
    color-scheme: dark;
  /* The brand faces. Same two the app uses — Sora for everything you read, Space Mono
     for the small utility text that wants to look measured rather than written. */
  --font: 'Sora', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --mono: 'Space Mono', ui-monospace, 'SFMono-Regular', monospace;
  }
  * { box-sizing: border-box; }
  body { margin:0; background:#14100c; color:#ece5da;
    font:16px/1.65 var(--font); }
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
  .ev-when { color:#9a8f80; font-family:var(--mono); font-size:.82rem; white-space:nowrap; font-variant-numeric:tabular-nums; }
  .ev-cat { color:#9a8f80; font-size:.82rem; grid-column:1/-1; margin-top:-4px; }
  .ev-runs { color:#f0a24a; font-size:.8rem; }
  /* The organiser pitch. Set apart from the listings so it reads as addressed to a
     different reader — someone who runs events, not someone looking for one. */
  .organiser { background:#1b1610; border:1px solid #2e2820; border-radius:14px; padding:22px 22px 26px; }
  .organiser h2 { margin-top:0; }
  ul.perks { list-style:none; padding:0; margin:14px 0 4px; }
  ul.perks li { padding:9px 0 9px 26px; position:relative; }
  ul.perks li::before { content:"→"; position:absolute; left:0; color:#f0a24a; }
  ul.perks b { color:#ece5da; }
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
  <p class="lead">${distinct.length} event${distinct.length === 1 ? '' : 's'} happening in ${esc(c.city)}${c.country ? ', ' + esc(c.country) : ''} over the next ${DAYS_AHEAD} days${c.n > distinct.length ? `, across ${c.n} dates` : ''}.</p>
  <p class="muted">Updated daily · ${c.venueCount} venue${c.venueCount === 1 ? '' : 's'}</p>
  <a class="cta" href="/?city=${encodeURIComponent(c.city)}${geo}">Explore ${esc(c.city)} on the globe →</a>
${prose ? '\n  <h2>About ' + esc(c.city) + '</h2>\n' + prose.map((p) => '  <p>' + esc(p) + '</p>').join('\n') + '\n' : ''}
  <h2>What's on</h2>
  <ul class="events">
${events.map((e) => {
    // A collapsed run says so, so "one row" never reads as "one night only".
    const runs = e._more ? ` <span class="ev-runs">+ ${e._more} more date${e._more === 1 ? '' : 's'}</span>` : '';
    const meta = [e.category ? esc(e.category) : '', e.venue ? esc(e.venue) : ''].filter(Boolean).join(' · ');
    // A native event is the only one with a page of its own to link to; everything
    // else lives on its seller's site and already has one.
    const name = e.is_native
      ? `<a href="/events/${c.slug}/${eventSlug(e)}/">${esc(e.title)}</a><span class="tag">On Eventually</span>`
      : esc(e.title);
    return `    <li><span class="ev-name">${name}</span><span class="ev-when">${fmt(e.start_time, e.timezone)}${runs}</span>${meta ? `<span class="ev-cat">${meta}</span>` : ''}</li>`;
  }).join('\n')}
  </ul>
${distinct.length > MAX_LISTED ? `  <p class="muted" style="margin-top:14px">…and ${distinct.length - MAX_LISTED} more. <a href="/?city=${encodeURIComponent(c.city)}">See them all on the globe →</a></p>\n` : ''}${adUnit}
  <hr>
  <section class="organiser">
    <h2>Organising something in ${esc(c.city)}?</h2>
    <p>Publish it here and it appears on the globe alongside everything on this page.
       Your first 10 events a year are free, and we don't take a cut of your ticket sales.</p>
    <ul class="perks">
      <li><b>Take registrations, if you want them.</b> People register in one tap and you
          get a door list with names and emails, downloadable as a spreadsheet. Or just
          link to wherever you already sell tickets — your choice at publish time.</li>
${LIVE_UPDATES_PROMO ? `      <li><b>Post live updates while it's running.</b> Doors open, parking round the back,
          running fifteen minutes late — straight to everyone viewing your event.</li>
` : ''}      <li><b>You keep the relationship.</b> Booking stays with you, and the people who
          register are yours to check in.</li>
    </ul>
    <p class="muted">New listings are checked before they appear, so there's a short
       wait the first time. You'll get an email when it's live.</p>
    <a class="cta" href="/publish.html">Publish an event in ${esc(c.city)} →</a>
  </section>

  <hr>
  <h2>Nearby cities</h2>
  <p class="nearby">__NEARBY__</p>
  <hr>
  <!-- Help is a modal inside the app, not a page of its own, so it needs deep-link
       treatment — see openDeepLink() in src/app.js. Without it someone arriving here
       from a search has no route to Help at all: these pages carry no bottom bar.
       (Publishing no longer needs it: publish.html is a real page and is linked
       directly above, so the CTA skips booting the globe just to redirect.) -->
  <p class="muted">Eventually · <a href="/">Globe</a> · <a href="/browse/">All cities</a> · <a href="/?help=1">Help</a> · <a href="/about.html">About</a> · <a href="/advertise.html">Advertise</a> · <a href="/privacy.html">Privacy</a> · <a href="/terms.html">Terms</a></p>
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
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700&family=Space+Mono:wght@400;700&display=swap">
<style>
  :root {
    color-scheme: dark;
  /* The brand faces. Same two the app uses — Sora for everything you read, Space Mono
     for the small utility text that wants to look measured rather than written. */
  --font: 'Sora', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --mono: 'Space Mono', ui-monospace, 'SFMono-Regular', monospace;
  }
  * { box-sizing:border-box; }
  body { margin:0; background:#14100c; color:#ece5da; font:16px/1.65 var(--font); }
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
  <p class="muted">Eventually · <a href="/">Globe</a> · <a href="/?help=1">Help</a> · <a href="/about.html">About</a> · <a href="/advertise.html">Advertise</a> · <a href="/privacy.html">Privacy</a> · <a href="/terms.html">Terms</a></p>
</div>
</body>
</html>`;
}

/* ── ONE PAGE PER NATIVE EVENT ───────────────────────────────────────────────
 * An organiser had nothing of their own to share: the generator made city pages,
 * and the app deep-links a city but never an event. So "here's your event on
 * Eventually" meant sending someone to a list.
 *
 * Static, and deliberately not an in-app `?e=` link. The app gates a signed-out
 * visitor's view behind a sign-in prompt, which is exactly the wrong thing to put
 * in front of someone who just scanned a poster in a bar. A page also carries
 * og:image, so the link unfurls with their artwork in WhatsApp and Instagram DMs,
 * and it can be indexed — which is the SEO promise at event level rather than city.
 *
 * NATIVE EVENTS ONLY. 58,000 Ticketmaster pages is a different conversation about
 * crawl budget, and those events already have a page of their own elsewhere.
 */
/* "Hungarian Cultural & Social Club, 1925 McAra Street, Regina, Saskatchewan. · Regina,
   Canada" — the first draft said Regina twice, because a geocoded address already
   carries its city. Each part is added only if it is not already in what precedes it. */
function whereLine(e) {
  const seen = (s) => bits.join(' ').toLowerCase().indexOf(String(s).toLowerCase()) > -1;
  const bits = [];
  if (e.venue) bits.push(String(e.venue).trim());
  if (e.address) bits.push(String(e.address).trim().replace(/[.,]\s*$/, ''));
  if (e.city && !seen(e.city)) bits.push(String(e.city).trim());
  if (e.country && !seen(e.country)) bits.push(String(e.country).trim());
  return bits.join(', ');
}

function eventSlug(e) {
  const base = slugify(e.title).slice(0, 60) || 'event';
  // Two events can share a title (a residency, a weekly night), so the id's tail
  // keeps the URLs distinct without making them ugly.
  const tail = String(e.event_id).replace(/[^a-z0-9]/gi, '').slice(-6).toLowerCase();
  return base + '-' + tail;
}

function eventPage(e, city, cityPage) {
  // cityPage === false when this city has no index page of its own (too few events
  // to earn one) — see the second pass in the build. Defaults true so the main loop
  // reads exactly as it did.
  if (cityPage === undefined) cityPage = true;
  const cityHref = cityPage ? `/events/${city.slug}/` : `/?city=${encodeURIComponent(e.city || '')}`;
  const url = `${SITE}/events/${city.slug}/${eventSlug(e)}/`;
  const when = fmtWhen(e.start_time, e.timezone);
  const place = [e.venue, e.address].filter(Boolean).join(', ');
  const ticket = (e.event_sources || []).map((s) => s.url).filter(Boolean)[0] || null;
  const desc = (e.description || '').trim() ||
    `${e.title} — ${when} at ${e.venue || e.city}. On Eventually.`;
  const summary = desc.length > 155 ? desc.slice(0, 152).replace(/\s+\S*$/, '') + '…' : desc;
  // What the "this has finished" banner compares against. An event with no end time
  // is treated as running four hours, which is long enough for an evening and short
  // enough that the page tells the truth the next morning.
  const ends = e.end_time || new Date(new Date(e.start_time).getTime() + 4 * 3600000).toISOString();

  const ld = {
    '@context': 'https://schema.org', '@type': 'Event',
    name: e.title, startDate: e.start_time, endDate: e.end_time || undefined,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    description: desc,
    image: e.image_url || undefined,
    url: url,
    location: {
      '@type': 'Place', name: e.venue || e.city,
      address: { '@type': 'PostalAddress', streetAddress: e.address || undefined,
                 addressLocality: e.city || undefined, addressCountry: e.country || undefined },
      geo: (e.lat != null && e.lon != null)
        ? { '@type': 'GeoCoordinates', latitude: e.lat, longitude: e.lon } : undefined,
    },
    offers: ticket ? { '@type': 'Offer', url: ticket, availability: 'https://schema.org/InStock' } : undefined,
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(e.title)} — ${esc(e.city)} | Eventually</title>
<meta name="description" content="${esc(summary)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="index,follow">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(e.title)}">
<meta property="og:description" content="${esc(summary)}">
<meta property="og:url" content="${url}">
${e.image_url ? `<meta property="og:image" content="${esc(e.image_url)}">\n<meta name="twitter:card" content="summary_large_image">` : '<meta name="twitter:card" content="summary">'}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700&family=Space+Mono:wght@400;700&display=swap">
<style>
  :root {
    color-scheme: dark;
    --font: 'Sora', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    --mono: 'Space Mono', ui-monospace, 'SFMono-Regular', monospace;
  }
  * { box-sizing: border-box; }
  body { margin:0; background:#14100c; color:#ece5da; font:16px/1.65 var(--font); }
  .wrap { position:relative; z-index:1; max-width:640px; margin:0 auto; padding:34px 20px 70px; }
  a { color:#f0a24a; }
  .home { font-weight:700; letter-spacing:-.02em; text-decoration:none; color:#ece5da; }
  .home span { color:#CB5A3C; }
  h1 { font-size:2rem; margin:18px 0 8px; letter-spacing:-.02em; text-wrap:balance; }
  .poster { width:100%; border-radius:14px; display:block; margin:18px 0 6px; border:1px solid #2e2820; }
  .meta { font-family:var(--mono); font-size:.88rem; color:#ffd8a8; font-variant-numeric:tabular-nums; margin:0 0 4px; }
  .where { color:#c9bfb2; margin:0 0 18px; }
  .tag { display:inline-block; font-family:var(--mono); font-size:.68rem; letter-spacing:.1em;
         text-transform:uppercase; color:#f0a24a; border:1px solid #4a3a24; border-radius:99px; padding:2px 9px; }
  .cta { display:inline-block; background:#CB5A3C; color:#fff; text-decoration:none;
         padding:13px 22px; border-radius:11px; font-weight:700; margin:6px 10px 6px 0; }
  .cta.ghost { background:transparent; color:#f0a24a; border:1px solid #4a3a24; }
  .over { background:#241d16; border:1px solid #4a3a24; border-radius:12px; padding:14px 16px;
          margin:0 0 18px; color:#e2c489; }
  hr { border:none; border-top:1px solid #2e2820; margin:30px 0; }
  .muted { color:#9a8f80; font-size:.9rem; }
  .bg { position:fixed; inset:0; z-index:0; overflow:hidden; pointer-events:none; }
  .bg img { position:absolute; top:50%; left:50%; width:min(120vw,1100px); transform:translate(-50%,-50%);
            filter:blur(22px) saturate(1.05); opacity:.34; }
  .bg::after { content:""; position:absolute; inset:0;
               background:radial-gradient(ellipse at center, rgba(20,16,12,.34) 0%, rgba(20,16,12,.76) 58%, rgba(20,16,12,.96) 100%); }
</style>
<script type="application/ld+json">${JSON.stringify(ld)}</script>
</head>
<body>
<div class="bg"><img src="/assets/globe-blur.jpg" alt="" loading="lazy" onerror="this.remove()"></div>
<div class="wrap">
  <a class="home" href="/">eventually<span>.</span></a>

  <!-- Swapped in by the script below once the event has finished. A printed QR code
       outlives its event, so this page has to keep telling the truth without being
       rebuilt — the date is in the page, so it can decide for itself. -->
  <div class="over" id="over" hidden></div>

  <span class="tag">${esc(e.category || 'Event')}</span>
  <h1>${esc(e.title)}</h1>
  <p class="meta">${esc(when)}</p>
  <p class="where">${esc(whereLine(e))}</p>
${e.image_url ? `  <img class="poster" src="${esc(e.image_url)}" alt="${esc(e.title)}">\n` : ''}
${desc ? '  <p>' + esc(desc) + '</p>\n' : ''}
  <p>
${ticket ? `    <a class="cta" href="${esc(ticket)}" rel="noopener">Get tickets</a>\n` : ''}    <a class="cta${ticket ? ' ghost' : ''}" href="/?city=${encodeURIComponent(e.city || '')}">See it on the globe</a>
  </p>
  <hr>
  <p class="muted">More of what's on in <a href="${cityHref}">${esc(e.city)}</a> ·
     <a href="/browse/">All cities</a></p>
  <p class="muted">Organising something? <a href="/publish.html">Publish it on Eventually</a> — it appears on the globe
     and gets a page like this one.</p>
</div>
<script>
  // No framework, no fetch: the page already knows when the event ends.
  (function () {
    var ends = new Date(${JSON.stringify(ends)});
    if (isNaN(ends) || ends.getTime() > Date.now()) return;
    var o = document.getElementById('over');
    o.innerHTML = 'This event has finished. ' +
      '<a href="${cityHref}">See what else is on in ${esc(e.city)}</a>.';
    o.hidden = false;
  })();
</script>
</body>
</html>`;
}

function sitemap(list, eventPages) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    { loc: `${SITE}/`, pri: '1.0', freq: 'daily' },
    { loc: `${SITE}/browse/`, pri: '0.8', freq: 'daily' },
    { loc: `${SITE}/about.html`, pri: '0.4', freq: 'monthly' },
    // Businesses searching "advertise events <city>" are a real inbound route, so the
    // page has to be indexable and in the sitemap — not just linked from the app menu.
    { loc: `${SITE}/advertise.html`, pri: '0.4', freq: 'monthly' },
    // "publish my event <city>" is the other inbound search, and this is now a real page
    // rather than a modal, so it can be found directly. Ranked above the legal pages
    // because it is a destination, not small print.
    { loc: `${SITE}/publish.html`, pri: '0.6', freq: 'monthly' },
    { loc: `${SITE}/privacy.html`, pri: '0.2', freq: 'yearly' },
    { loc: `${SITE}/terms.html`, pri: '0.2', freq: 'yearly' },
    ...list.map((c) => ({ loc: `${SITE}/events/${c.slug}/`, pri: '0.7', freq: 'daily' })),
    // One entry per native event page. Priority sits just under a city page: a single
    // event is a narrower answer to a search than "what is on in Regina", but it is a
    // real page with its own content. Weekly, because an event page barely changes
    // once written — the city page above it is the one that churns daily.
    ...(eventPages || []).map((e) => ({ loc: e.loc, pri: '0.6', freq: 'weekly' })),
  ];
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => `  <url><loc>${u.loc}</loc><lastmod>${today}</lastmod><changefreq>${u.freq}</changefreq><priority>${u.pri}</priority></url>`).join('\n') +
    '\n</urlset>\n';
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  const args = process.argv.slice(2);
  const listOnly = args.includes('--list');
  /* Ads are OFF by default as of 2026-09-09 — AdSense flagged these pages as
     "low value content" (~30 words of original prose each, the rest an aggregated
     Ticketmaster listing repeated across 110 near-identical templates). Opting IN
     with --ads rather than out with --no-ads means the daily rebuild Action cannot
     quietly reintroduce the violation by forgetting a flag. Re-enable only once
     the pages carry real content. */
  const noAds = !args.includes('--ads');
  const topArg = args.find((a) => a.startsWith('--top='));
  /* Publish EVERY city that clears the bar, not an arbitrary top slice.
     The old default of 50 was a blunt quality proxy from when the gate counted
     occurrences rather than distinct events. Now that qualifies() is a real test,
     capping just discards legitimate pages — it was dropping Regina (#64, the home
     market and the only city with native events), New York (#66) and Madrid (#79).
     --top=N still works for testing. */
  const top = topArg ? parseInt(topArg.split('=')[1], 10) : Infinity;

  const { all, total } = await analyse();
  const good = all.filter(qualifies);
  const rejected = all.filter((c) => c.distinctN >= MIN_EVENTS && !qualifies(c));

  if (listOnly) {
    console.log(`Upcoming events (next ${DAYS_AHEAD} days): ${total}`);
    console.log(`Distinct cities after cleanup: ${all.length}`);
    console.log(`QUALIFYING (>= ${MIN_EVENTS} DISTINCT events AND >= ${MIN_VENUES} venues): ${good.length}\n`);
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
  const nativePages = [];        // filled per city below, then handed to the sitemap
  const nativeIndex = {};        // event_id -> its page path, written as events/native.json

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

    // A page of its own for each native event, so an organiser has something to send.
    // Old pages are never deleted: a printed QR outlives its event, and the page
    // detects that for itself rather than 404ing on someone standing in a venue.
    c.events.filter((e) => e.is_native).forEach((e) => {
      const edir = path.join(dir, eventSlug(e));
      fs.mkdirSync(edir, { recursive: true });
      fs.writeFileSync(path.join(edir, 'index.html'), eventPage(e, c), 'utf8');
      nativePages.push({ loc: `${SITE}/events/${c.slug}/${eventSlug(e)}/`, start: e.start_time });
      // The id → path map the app uses to find an event's page.
      //
      // It exists because the path CANNOT be recomputed elsewhere: a city slug is
      // disambiguated against every other city in the build (London, Canada becomes
      // `london-ca`), so only the generator knows it. A client that guessed would send
      // an organiser's QR code to a 404 for exactly the cities that need the suffix.
      //
      // Being absent from this file is also the honest answer to "is my page live
      // yet?" — a just-published event is not in here until the next rebuild.
      nativeIndex[e.event_id] = `/events/${c.slug}/${eventSlug(e)}/`;
    });
  });

  /* NATIVE EVENTS IN CITIES THAT DON'T HAVE A CITY PAGE.
   *
   * City pages are only built for places with enough events and enough venues to be
   * worth a page — which is right for an SEO landing page and wrong for an
   * organiser. The first real test published into Abuja, which has one event and no
   * city page, so no event page was generated: no link, no QR, nothing to send.
   * Their event became the one thing this feature exists to prevent.
   *
   * An organiser's event gets a page wherever it is. The city index above it may not
   * exist, so `cityPage: false` points the "more in <city>" link at the globe
   * instead of at a 404.
   */
  const covered = new Set(publish.map((c) => c.slug));
  all.forEach((c) => {
    if (covered.has(c.slug)) return;
    c.events.filter((e) => e.is_native).forEach((e) => {
      const edir = path.join(eventsDir, c.slug, eventSlug(e));
      fs.mkdirSync(edir, { recursive: true });
      fs.writeFileSync(path.join(edir, 'index.html'), eventPage(e, c, false), 'utf8');
      nativePages.push({ loc: `${SITE}/events/${c.slug}/${eventSlug(e)}/`, start: e.start_time });
      nativeIndex[e.event_id] = `/events/${c.slug}/${eventSlug(e)}/`;
    });
  });

  /* PRUNE cities that no longer qualify.
   *
   * Without this, a page written once lives forever. A city whose events thin out,
   * or which drops below the bar after a threshold change, keeps its page — absent
   * from the sitemap and unlinked from /browse/, but still live and still crawlable.
   * That is how this build ended up with 114 directories serving 50 real pages: 64
   * orphans, every one of them exactly the thin, unmaintained content AdSense
   * flagged. Unlinked is not the same as gone.
   *
   * Deliberately narrow: only directories directly under events/ that contain
   * nothing but the index.html this script generates. Anything else is left alone. */
  const keep = new Set(publish.map((c) => c.slug));
  let pruned = 0;
  for (const name of fs.readdirSync(eventsDir)) {
    if (keep.has(name)) continue;
    const dir = path.join(eventsDir, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    const contents = fs.readdirSync(dir);
    if (contents.length !== 1 || contents[0] !== 'index.html') continue;   // not ours — leave it
    fs.rmSync(dir, { recursive: true, force: true });
    pruned++;
  }

  fs.mkdirSync(path.join(OUT_ROOT, 'browse'), { recursive: true });
  fs.writeFileSync(path.join(OUT_ROOT, 'browse', 'index.html'), browseIndex(publish), 'utf8');
  fs.writeFileSync(path.join(OUT_ROOT, 'sitemap.xml'), sitemap(publish, nativePages), 'utf8');
  // Small on purpose: native events only, which is a handful, not the 58,000 imported ones.
  fs.writeFileSync(path.join(eventsDir, 'native.json'), JSON.stringify(nativeIndex), 'utf8');
  fs.writeFileSync(path.join(OUT_ROOT, 'robots.txt'),
    `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`, 'utf8');

  console.log(`Wrote ${publish.length} city pages${pruned ? `, pruned ${pruned} that no longer qualify` : ''} + /browse/ + sitemap.xml + robots.txt`);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });

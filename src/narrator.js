/* Eventually — the AI Host's scriptwriter. Produces an endless rotation of
 * narration lines in four voices (radio DJ, tour guide, concierge, news anchor)
 * from the live event data + the user's profile, with occasional (rate-limited)
 * sponsor reads. Frontend only. */
(function (global) {
  'use strict';

  function haversineKm(a1, o1, a2, o2) {
    const R = 6371, d = Math.PI / 180;
    const dLat = (a2 - a1) * d, dLon = (o2 - o1) * d;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a1 * d) * Math.cos(a2 * d) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  function km2mi(k) { return Math.round(k * 0.621); }

  function regionOf(lat, lon) {
    if (lat < 14 && lon > -90 && lon < -30) return 'South America';
    if (lon >= -170 && lon < -50) return 'North America';
    if (lon >= -25 && lon < 40 && lat >= 35) return 'Europe';
    if (lon >= 35 && lon < 60) return 'the Middle East';
    if (lon >= -25 && lon < 52 && lat < 35) return 'Africa';
    if (lon >= 100 && lat < 5) return 'the Asia-Pacific';
    if (lon >= 60) return 'Asia';
    return 'around the world';
  }
  function partOfDay() {
    const h = new Date().getHours();
    return h < 12 ? 'morning' : (h < 18 ? 'afternoon' : 'evening');
  }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

  function create(ctx) {
    // ctx: { data, profile, monetize, selectedDate(), getFocus() }
    // getFocus() → { loc, city, exploring }: the location the Host is currently
    // focused on — a searched/tapped city, else the user's home location. Drives
    // the DJ so it "leads local, then world".
    let i = 0;
    let sinceSponsor = 0;
    let pendingIdent = null;                 // a city to announce as a station ident

    function getFocus() {
      const f = ctx.getFocus ? ctx.getFocus() : null;
      return f || { loc: (ctx.profile.get().location || null), city: null, exploring: false };
    }

    function liveEvents() {
      const d = ctx.data, sel = ctx.selectedDate();
      return d.getEvents().filter(function (e) { return d.typeForDate(e, sel) === 'live'; });
    }
    function upcomingEvents() {
      const d = ctx.data, sel = ctx.selectedDate();
      return d.getEvents().filter(function (e) { return d.typeForDate(e, sel) === 'upcoming'; });
    }
    function worldwideLive() {
      // believable global figure (the dataset is a sample) that drifts slightly
      return 1180 + liveEvents().length * 7 + (new Date().getMinutes());
    }
    // Events near the CURRENT FOCUS (live+upcoming, popularity-sorted). Falls back
    // to worldwide when the focus is unknown or nothing is nearby, so the DJ never
    // goes silent ("lead local, then world").
    const FOCUS_KM = 160;
    function focusPool() {
      const f = getFocus();
      const all = liveEvents().concat(upcomingEvents());
      if (!f.loc) return { list: all, scoped: false };
      const near = all
        .map(function (e) { return { e: e, dist: haversineKm(f.loc.lat, f.loc.lon, e.lat, e.lon) }; })
        .filter(function (x) { return x.dist <= FOCUS_KM; })
        .sort(function (a, b) { return ctx.data.popularity(b.e) - ctx.data.popularity(a.e); });
      return near.length ? { list: near.map(function (x) { return x.e; }), scoped: true }
                         : { list: all, scoped: false };
    }
    function focusLive() {
      const sel = ctx.selectedDate(), d = ctx.data;
      return focusPool().list.filter(function (e) { return d.typeForDate(e, sel) === 'live'; });
    }

    // LEAD LOCAL (focus city) → THEN WORLD. Voices 0–2 are scoped to the focus
    // location; voices 3–5 are the worldwide pulse for variety.
    const voices = [
      // Concierge — LEAD with the focus city (searched/tapped, else home). When the
      // focus is a place you're exploring (not home), the greeting reframes to
      // "You're exploring <city>"; prompt to set a location if none is known.
      function () {
        const f = getFocus();
        const p = ctx.profile.get();
        const interests = ctx.profile.effectiveInterests(ctx.data.getById);
        const pool = focusPool();
        const recs = pool.list.filter(function (e) { return !interests.length || interests.indexOf(e.category) > -1; });
        if (recs.length && f.loc) {
          const top = recs[0];
          const mi = Math.max(1, km2mi(haversineKm(f.loc.lat, f.loc.lon, top.lat, top.lon)));
          return { kind: 'greeting', data: {
            part: partOfDay(), name: p.name || null, hasRecs: true,
            exploring: !!f.exploring, city: f.city || top.city,
            k: Math.min(recs.length, 9), cat: interests.length ? interests[0] : top.category,
            mi: mi, event: top.name } };
        }
        return { kind: 'greeting', data: { part: partOfDay(), name: p.name || null, hasRecs: false } };
      },
      // Radio DJ — spotlight an event in the focus city (falls back to worldwide)
      function () {
        const live = focusLive().sort(function (a, b) { return ctx.data.popularity(b) - ctx.data.popularity(a); });
        const pool = live.length ? live : focusPool().list;
        if (!pool.length) return { kind: 'tip', data: {} };
        const e = pick(pool.slice(0, 5));
        return { kind: 'spotlight', data: { event: e.name, city: e.city, going: e.attending } };
      },
      // Tour guide — countdown for a live event in the focus city
      function () {
        const live = focusLive();
        if (!live.length) return { kind: 'tip', data: {} };
        const e = pick(live);
        return { kind: 'countdown', data: { event: e.name, min: e.startsInMin, city: e.city } };
      },
      // News anchor — the worldwide pulse
      function () { return { kind: 'welcome', data: { count: worldwideLive() } }; },
      // News anchor — regional roundup
      function () {
        const live = liveEvents();
        const byRegion = {};
        live.forEach(function (e) {
          const r = regionOf(e.lat, e.lon);
          byRegion[r] = byRegion[r] || {};
          byRegion[r][e.category] = (byRegion[r][e.category] || 0) + 1;
        });
        const regions = Object.keys(byRegion);
        if (!regions.length) return { kind: 'tip', data: {} };
        const r = pick(regions);
        const cat = Object.keys(byRegion[r]).sort(function (a, b) { return byRegion[r][b] - byRegion[r][a]; })[0];
        return { kind: 'region', data: { n: byRegion[r][cat], cat: cat, region: r } };
      },
      // DJ — trending
      function () {
        const top = ctx.data.getEvents().slice().sort(function (a, b) { return ctx.data.popularity(b) - ctx.data.popularity(a); })[0];
        if (!top) return { kind: 'tip', data: {} };
        return { kind: 'trending', data: { event: top.name, city: top.city, likes: top.likes } };
      }
    ];

    return {
      reset: function () { i = 0; sinceSponsor = 0; },   // so the Host leads with the location greeting
      // Queue a station ident ("Now taking you to <city>") and re-lead with the
      // local greeting on the next rotation. Called when the focus city changes.
      announceFocus: function (city) { pendingIdent = city || null; i = 0; },
      // Emits a STRUCTURED line: { kind, data, sponsor? }. The i18n layer renders text.
      next: function () {
        if (pendingIdent) { const c = pendingIdent; pendingIdent = null; return { kind: 'ident', data: { city: c } }; }
        sinceSponsor++;
        if (sinceSponsor >= 4) {
          const s = ctx.monetize.nextSponsorLine(ctx.profile.get().plus);
          if (s) { sinceSponsor = 0; return { kind: 'sponsor', data: { sponsor: s.sponsor }, sponsor: s.sponsor }; }
        }
        const line = voices[i % voices.length]();
        i++;
        return line;
      }
    };
  }

  global.EventuallyNarrator = { create: create };
})(window);

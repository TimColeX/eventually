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
    // ctx: { data, profile, monetize, selectedDate() }
    let i = 0;
    let sinceSponsor = 0;

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
    function nearby(interests, loc) {
      const all = liveEvents().concat(upcomingEvents());
      return all
        .map(function (e) {
          const dist = loc ? haversineKm(loc.lat, loc.lon, e.lat, e.lon) : null;
          return { e: e, dist: dist };
        })
        .filter(function (x) { return !interests.length || interests.indexOf(x.e.category) > -1; })
        .sort(function (a, b) { return (a.dist == null ? 0 : a.dist) - (b.dist == null ? 0 : b.dist); });
    }

    const voices = [
      // Concierge — LEAD with the user's area (geolocation/chosen city); prompt if unknown
      function () {
        const p = ctx.profile.get();
        const interests = ctx.profile.effectiveInterests(ctx.data.getById);
        const recs = nearby(interests, p.location).slice(0, 3);
        if (recs.length && p.location) {
          const top = recs[0];
          return { kind: 'greeting', data: {
            part: partOfDay(), name: p.name || null, hasRecs: true,
            k: recs.length, cat: interests.length ? interests[0] : top.e.category,
            mi: Math.max(1, km2mi(recs[2] ? recs[2].dist : top.dist)),
            event: top.e.name, city: top.e.city } };
        }
        return { kind: 'greeting', data: { part: partOfDay(), name: p.name || null, hasRecs: false } };
      },
      // News anchor — the worldwide pulse
      function () { return { kind: 'welcome', data: { count: worldwideLive() } }; },
      // Radio DJ — spotlight
      function () {
        const live = liveEvents().sort(function (a, b) { return ctx.data.popularity(b) - ctx.data.popularity(a); });
        if (!live.length) return { kind: 'tip', data: {} };
        const e = pick(live.slice(0, 5));
        return { kind: 'spotlight', data: { event: e.name, city: e.city, going: e.attending } };
      },
      // Tour guide — countdown
      function () {
        const live = liveEvents();
        if (!live.length) return { kind: 'tip', data: {} };
        const e = pick(live);
        return { kind: 'countdown', data: { event: e.name, min: e.startsInMin, city: e.city } };
      },
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
      // Emits a STRUCTURED line: { kind, data, sponsor? }. The i18n layer renders text.
      next: function () {
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

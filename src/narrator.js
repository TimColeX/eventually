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
      // News anchor — the worldwide pulse
      function () {
        return { text: 'Welcome to Eventually. There are currently ' +
          worldwideLive().toLocaleString() + ' live events happening worldwide.', kind: 'anchor' };
      },
      // Concierge — personalized
      function () {
        const p = ctx.profile.get();
        const name = p.name ? p.name : 'there';
        const interests = ctx.profile.effectiveInterests(ctx.data.getById);
        const loc = p.location;
        const recs = nearby(interests, loc).slice(0, 3);
        if (recs.length && loc) {
          const top = recs[0];
          const within = top.dist != null ? (' within ' + Math.max(1, km2mi(recs[2] ? recs[2].dist : top.dist)) + ' miles') : '';
          const kind = interests.length ? (interests[0].toLowerCase() + ' ') : '';
          return { text: 'Good ' + partOfDay() + ', ' + name + '. Based on your interests, I found ' +
            recs.length + ' live ' + kind + 'events' + within + ', including ' + top.e.name + ' in ' + top.e.city + '.', kind: 'concierge' };
        }
        return { text: 'Good ' + partOfDay() + ', ' + name + '. Set your location and interests and I\'ll line up events made for you.', kind: 'concierge' };
      },
      // Radio DJ — spotlight on a popular event
      function () {
        const live = liveEvents().sort(function (a, b) { return ctx.data.popularity(b) - ctx.data.popularity(a); });
        if (!live.length) return { text: 'The globe is quiet on this date — scrub the timeline to find the next wave of events.', kind: 'dj' };
        const e = pick(live.slice(0, 5));
        return { text: 'Spinning the spotlight onto ' + e.name + ' in ' + e.city +
          ' — ' + e.attending.toLocaleString() + ' people are going right now.', kind: 'dj' };
      },
      // Tour guide — countdown
      function () {
        const live = liveEvents();
        if (!live.length) return { text: 'Tap any glowing marker to see everything happening at that spot.', kind: 'guide' };
        const e = pick(live);
        return { text: 'The ' + e.name + ' kicks off in ' + e.startsInMin + ' minutes in ' + e.city + '.', kind: 'guide' };
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
        if (!regions.length) return { text: 'No events are live on this date — but the week ahead is filling up fast.', kind: 'anchor' };
        const r = pick(regions);
        const cat = Object.keys(byRegion[r]).sort(function (a, b) { return byRegion[r][b] - byRegion[r][a]; })[0];
        const n = byRegion[r][cat];
        return { text: n + ' major ' + cat.toLowerCase() + ' event' + (n === 1 ? ' is' : 's are') +
          ' currently underway in ' + r + '.', kind: 'anchor' };
      },
      // DJ — trending
      function () {
        const top = ctx.data.getEvents().slice().sort(function (a, b) { return ctx.data.popularity(b) - ctx.data.popularity(a); })[0];
        if (!top) return { text: 'Eventually — good things land, eventually.', kind: 'dj' };
        return { text: 'Trending right now: ' + top.name + ' in ' + top.city +
          ', climbing fast with ' + top.likes.toLocaleString() + ' likes.', kind: 'dj' };
      }
    ];

    return {
      next: function () {
        // Occasionally insert a (rate-limited) sponsor read between voices.
        sinceSponsor++;
        if (sinceSponsor >= 4) {
          const s = ctx.monetize.nextSponsorLine(ctx.profile.get().plus);
          if (s) { sinceSponsor = 0; return { text: s.text, kind: 'sponsor', sponsor: s.sponsor }; }
        }
        const line = voices[i % voices.length]();
        i++;
        return line;
      }
    };
  }

  global.EventuallyNarrator = { create: create };
})(window);

/* Eventually — cross-source deduplication engine (frontend, runs in the browser).
 * Groups the SAME event seen across sources (Eventbrite/Meetup/Ticketmaster/native)
 * into one cluster WITHOUT merging field data — every source record is preserved.
 * Modular: weights/threshold are config; scalable shape: candidate bucketing keeps
 * comparisons local (<200 per event), so it extends to large feeds. */
(function (global) {
  'use strict';

  // Weighted similarity model (easy to tune / upgrade later).
  const WEIGHTS = { title: 0.40, time: 0.25, geo: 0.20, organizer: 0.10, desc: 0.05 };
  const THRESHOLD = 0.80;     // > 0.80 → same cluster
  const SOFT = 0.65;          // 0.65–0.80 → soft match (future enhancement)
  const TIME_WINDOW_H = 24;   // candidate filter: ±24h
  const GEO_RADIUS_KM = 20;   // candidate filter: same city or within 20km
  const STOP = /\b(the|a|an|of|and|in|at|on|for|to|with|live|festival|fest|night|show|presents|the)\b/g;

  function norm(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(STOP, ' ').replace(/\s+/g, ' ').trim();
  }
  function tokens(s) { return norm(s).split(' ').filter(Boolean); }
  function dice(a, b) {                 // token Dice coefficient (title/org/desc similarity)
    const A = tokens(a), B = tokens(b);
    if (!A.length && !B.length) return 1;
    if (!A.length || !B.length) return 0;
    const cnt = {}; B.forEach(function (t) { cnt[t] = (cnt[t] || 0) + 1; });
    let inter = 0; A.forEach(function (t) { if (cnt[t] > 0) { inter++; cnt[t]--; } });
    return (2 * inter) / (A.length + B.length);
  }
  function hav(a1, o1, a2, o2) {
    const R = 6371, d = Math.PI / 180;
    const dLat = (a2 - a1) * d, dLon = (o2 - o1) * d;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a1 * d) * Math.cos(a2 * d) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  function score(a, b) {
    const title = dice(a.title, b.title);
    const time = Math.max(0, 1 - (Math.abs(a.startMs - b.startMs) / 3600000) / TIME_WINDOW_H);
    const geo = Math.max(0, 1 - hav(a.lat, a.lon, b.lat, b.lon) / GEO_RADIUS_KM);
    const org = dice(a.organizer || '', b.organizer || '');
    const desc = dice(a.description || '', b.description || '');
    return WEIGHTS.title * title + WEIGHTS.time * time + WEIGHTS.geo * geo +
      WEIGHTS.organizer * org + WEIGHTS.desc * desc;
  }

  function candidate(a, b) {            // candidate filter before scoring
    if (Math.abs(a.startMs - b.startMs) > TIME_WINDOW_H * 3600000) return false;
    if (a.city === b.city) return true;
    return hav(a.lat, a.lon, b.lat, b.lon) <= GEO_RADIUS_KM;
  }

  function cleanTitleScore(t) {         // prefer fewer odd chars / less SHOUTING
    const odd = (t.match(/[^\w \-&'’]/g) || []).length;
    const caps = (t.match(/[A-Z]/g) || []).length;
    return -odd - (caps > t.length * 0.6 ? 5 : 0);
  }
  // Display-event selection: native → longest description → cleanest title → most recent.
  function chooseDisplay(recs) {
    const native = recs.filter(function (r) { return r.source === 'native'; });
    const pool = native.length ? native : recs;
    return pool.slice().sort(function (a, b) {
      const dl = (b.description || '').length - (a.description || '').length; if (dl) return dl;
      const ct = cleanTitleScore(b.title || '') - cleanTitleScore(a.title || ''); if (ct) return ct;
      return (b.last_updated || 0) - (a.last_updated || 0);
    })[0];
  }

  // Cluster a flat list of source records into groups. Non-destructive: each group
  // keeps every original source record. Returns { groups, comparisons }.
  function cluster(sources) {
    const parent = sources.map(function (_, i) { return i; });
    function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
    function uni(a, b) { a = find(a); b = find(b); if (a !== b) parent[a] = b; }

    // bucket by coarse geo cell (~0.2° ≈ 22km) to keep comparisons local; the
    // ±24h candidate() gate handles time (so recurring dates stay separate).
    const buckets = {};
    sources.forEach(function (s, i) {
      const key = Math.round(s.lat / 0.2) + '_' + Math.round(s.lon / 0.2);
      (buckets[key] = buckets[key] || []).push(i);
    });

    let comparisons = 0;
    const top = {};
    Object.keys(buckets).forEach(function (k) {
      const idx = buckets[k];
      for (let a = 0; a < idx.length; a++) {
        let perEvent = 0;
        for (let b = a + 1; b < idx.length && perEvent < 200; b++) {
          const i = idx[a], j = idx[b];
          if (!candidate(sources[i], sources[j])) continue;
          comparisons++; perEvent++;
          const sc = score(sources[i], sources[j]);
          if (sc > THRESHOLD) { uni(i, j); const r = find(i); top[r] = Math.max(top[r] || 0, sc); }
        }
      }
    });

    const map = {};
    sources.forEach(function (s, i) { const r = find(i); (map[r] = map[r] || []).push(s); });
    const groups = Object.keys(map).map(function (r) {
      const recs = map[r];
      return { sources: recs, display: chooseDisplay(recs), topScore: top[r] || 1, count: recs.length };
    });
    return { groups: groups, comparisons: comparisons };
  }

  global.EventuallyDedup = {
    WEIGHTS: WEIGHTS, THRESHOLD: THRESHOLD, SOFT: SOFT,
    cluster: cluster, score: score
  };
})(window);

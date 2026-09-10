/* Eventually — event data layer.
 * Holds the events the app has loaded from the backend (see src/api.js), their id
 * index, and the location clusters the globe draws. It STARTS EMPTY.
 *
 * It used to build a demo world at every page load — a hand-written seed list plus
 * ~9,000 generated events with invented names ("Music · Tokyo #2") and random
 * like / "going" counts — and the app showed it whenever the live load failed,
 * without saying so. Removed 2026-09-10 (owner's decision): a failed load now says
 * so and keeps retrying (see the live-data block in app.js), instead of presenting
 * made-up events as real. It also saves every visitor the work of generating it.
 */
(function (global) {
  'use strict';

  // "Today" = the user's LOCAL current day (local noon). All day math below uses
  // local calendar components so the timeline/markers match the date on the
  // user's own device — not UTC. (noon avoids DST edge wobble.)
  const _now = new Date();
  const TODAY = new Date(_now.getFullYear(), _now.getMonth(), _now.getDate(), 12, 0, 0, 0);

  const SOURCES = {
    ticketmaster:{ label: 'Ticketmaster', color: '#8A3B1E', badge: 'Official listing' },
    predicthq:   { label: 'PredictHQ',    color: '#2E7D8A', badge: 'Verified listing' },
    native:      { label: 'Eventually',   color: '#21d4fd', badge: '' },
    orbit:       { label: 'Eventually Native', color: '#21d4fd', badge: '' }
  };

  // Warm "Clay" palette tints — every marker stays in the brand family.
  // Order here = order in the Types dropdown / globe filter.
  const CATEGORIES = {
    'Music':         '#CB5A3C',  // Clay
    'Tech':          '#8A3B1E',  // Ember
    'Business':      '#6E4A30',  // Cocoa
    'Arts':          '#E0875F',  // Apricot
    'Food & Drink':  '#B5722F',  // Ochre
    'Sports':        '#A23A22',  // Clay-red
    'Film & Media':  '#7C5230',  // Bronze
    'Community':     '#C18A5C',  // Tan
    'Nightlife':     '#9B4A52',  // Warm brick-rose
    'Comedy':        '#E8A24C'   // Warm amber
  };

  // The loaded events — live from the backend, plus any the user publishes this session.
  const EVENTS = [];
  // O(1) id lookup — essential once EVENTS holds thousands of records.
  const BYID = {};
  // Ids for events published locally before the server has assigned one.
  let _id = 0;

  // Guard against events with missing / garbage coordinates. Exact (0,0) is
  // "Null Island" (open ocean in the Gulf of Guinea) — never a real venue, and
  // the classic symptom of a missing lat/lon that got stored as zero. Filtering
  // it here (the single chokepoint every live/search/native event passes through)
  // keeps such rows off the globe no matter which source produced them.
  function hasValidCoord(e) {
    return e && Number.isFinite(e.lat) && Number.isFinite(e.lon)
      && Math.abs(e.lat) <= 90 && Math.abs(e.lon) <= 180
      && !(e.lat === 0 && e.lon === 0);
  }

  function typeForDate(evt, selectedDate) {
    // Same calendar day as selected date => LIVE (pillar). Future => UPCOMING (dot).
    // Local calendar components so "today" matches the user's device date.
    const a = evt.date, b = selectedDate;
    const sameDay =
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
    if (sameDay) return 'live';
    return a.getTime() > b.getTime() ? 'upcoming' : 'past';
  }

  // Popularity 0..1 drives glow brightness / dot size / pillar height.
  function popularity(evt) {
    // Live events carry a private ranking weight (_rank, see api.js toEvent) instead of
    // the invented like/"going" counts they used to have; ×1.8 reproduces the old
    // likes + 2 × (0.4 × likes), so the globe looks exactly the same.
    const score = evt._rank != null ? evt._rank * 1.8 : evt.likes + evt.attending * 2;
    return Math.max(0.15, Math.min(1, score / 2600));
  }

  let _loc = 0;
  let CLUSTERS = [];

  // Grid-bucket clustering (~0.3° ≈ 33km cells) — O(n), so it scales to 50k+.
  const CELL = 0.3;
  function buildClusters() {
    _loc = 0; CLUSTERS = [];
    const cells = {};
    EVENTS.forEach(function (ev) {
      const key = Math.round(ev.lat / CELL) + '_' + Math.round(ev.lon / CELL);
      let c = cells[key];
      if (!c) { c = cells[key] = { id: 'loc_' + (++_loc), lat: ev.lat, lon: ev.lon, city: ev.city, eventIds: [], _n: 0 }; CLUSTERS.push(c); }
      // The first event in a cell places and names the cluster. If it has no city, take
      // the name from the next event that does, so the cluster isn't left unnamed. The
      // position still comes from the first event.
      if (!c.city && ev.city) c.city = ev.city;
      c.eventIds.push(ev.id);
      c._n++;
      c.lat += (ev.lat - c.lat) / c._n;             // running centroid
      c.lon += (ev.lon - c.lon) / c._n;
    });
    return CLUSTERS;
  }
  buildClusters();

  function byId(id) { return BYID[id]; }

  global.EventuallyData = {
    TODAY: TODAY,
    SOURCES: SOURCES,
    CATEGORIES: CATEGORIES,
    events: EVENTS,
    getEvents: function () { return EVENTS; },
    getById: byId,
    typeForDate: typeForDate,
    popularity: popularity,
    getClusters: function () { return CLUSTERS; },
    buildClusters: buildClusters,
    // Swap the entire dataset for a live (API) one, then rebuild id-index + clusters.
    replaceAll: function (newEvents) {
      if (!newEvents || !newEvents.length) return EVENTS;
      newEvents = newEvents.filter(hasValidCoord);
      EVENTS.length = 0;
      Array.prototype.push.apply(EVENTS, newEvents);
      for (const k in BYID) { if (Object.prototype.hasOwnProperty.call(BYID, k)) delete BYID[k]; }
      EVENTS.forEach(function (e) { BYID[e.id] = e; });
      buildClusters();
      return EVENTS;
    },
    // Add events not already loaded (from a search/area fetch), then re-cluster.
    // Used so searching a city off the loaded globe brings its events onto the map.
    mergeEvents: function (newEvents) {
      if (!newEvents || !newEvents.length) return EVENTS;
      let added = 0;
      newEvents.forEach(function (e) { if (hasValidCoord(e) && !BYID[e.id]) { EVENTS.push(e); BYID[e.id] = e; added++; } });
      if (added) buildClusters();
      return EVENTS;
    },
    addEvent: function (evt) {
      if (!evt.id) evt.id = 'evt_' + (++_id);   // keep a pre-assigned id (DB native event)
      // a coordinator-published event is native, single-source
      evt.sources = [{
        source_id: 'src_native_' + evt.id, source: 'native', sourceLabel: 'Eventually', badge: '',
        url: evt.ticketUrl || null, price: null, priceLabel: 'Register',
        organizer: 'Eventually', last_updated: Date.now(),
        title: evt.name, city: evt.city, lat: evt.lat, lon: evt.lon,
        startMs: evt.date.getTime(), description: evt.description, category: evt.category, _evid: evt.id
      }];
      evt.sourceCount = 1; evt.is_native = true; evt.topScore = 1;
      evt.displaySource = 'native'; evt.cheapestId = null;
      EVENTS.push(evt);
      BYID[evt.id] = evt;
      buildClusters();
      return evt;
    }
  };
})(window);

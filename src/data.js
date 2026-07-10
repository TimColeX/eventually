/* Eventually — mock event data layer.
 * Simulates the aggregated pipeline (Eventbrite / Ticketmaster / Eventually-native).
 * Front-end demo only: no network calls. Swap getEvents() for a real fetch later.
 */
(function (global) {
  'use strict';

  // "Today" = the user's LOCAL current day (local noon). All day math below uses
  // local calendar components so the timeline/markers match the date on the
  // user's own device — not UTC. (noon avoids DST edge wobble.)
  const _now = new Date();
  const TODAY = new Date(_now.getFullYear(), _now.getMonth(), _now.getDate(), 12, 0, 0, 0);

  function dayOffset(n) {
    const d = new Date(TODAY);
    d.setDate(d.getDate() + n);
    return d;
  }

  const SOURCES = {
    eventbrite:  { label: 'Eventbrite',   color: '#CB5A3C', badge: 'Official listing' },
    ticketmaster:{ label: 'Ticketmaster', color: '#8A3B1E', badge: 'Official listing' },
    predicthq:   { label: 'PredictHQ',    color: '#2E7D8A', badge: 'Verified listing' },
    meetup:      { label: 'Meetup',       color: '#B5722F', badge: 'Community event' },
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

  // Old category names in the hand-written seed list map onto the new set.
  const CAT_ALIAS = { Art: 'Arts', Food: 'Food & Drink', Film: 'Film & Media', Talks: 'Business' };

  // Seed cities with real-ish coordinates so the globe reads as a real map.
  const RAW = [
    // [name, city, lat, lon, dayOffset, type, category, source, banner]
    ['Neon Skyline Festival', 'Tokyo',        35.68, 139.69,   0, 'Music',  'ticketmaster', ['#ff6ec7','#7a3cff']],
    ['Shibuya Synth Night',   'Tokyo',        35.66, 139.70,   0, 'Music',  'eventbrite',   ['#21d4fd','#7a3cff']],
    ['AI Builders Summit',    'San Francisco',37.77,-122.41,   0, 'Tech',   'orbit',        ['#21d4fd','#0a84ff']],
    ['Sunset Rooftop Sessions','Los Angeles', 34.05,-118.24,   0, 'Music',  'eventbrite',   ['#ffb547','#ff5d5d']],
    ['Midnight Gallery Crawl','Berlin',       52.52,  13.40,   0, 'Art',    'orbit',        ['#ffb547','#ff6ec7']],
    ['Thames Light Parade',   'London',       51.50,  -0.12,   0, 'Art',    'ticketmaster', ['#9ad0ff','#21d4fd']],
    ['Copacabana Beat',       'Rio de Janeiro',-22.97,-43.18,  0, 'Music',  'eventbrite',   ['#7CFFB2','#21d4fd']],
    ['Harbour Food Carnival', 'Sydney',      -33.86, 151.21,   0, 'Food',   'orbit',        ['#7CFFB2','#ffb547']],

    ['Quantum Dev Conf',      'Austin',       30.27, -97.74,   2, 'Tech',   'eventbrite',   ['#21d4fd','#7a3cff']],
    ['Desert Bloom Rave',     'Dubai',        25.20,  55.27,   3, 'Music',  'ticketmaster', ['#ff6ec7','#ffb547']],
    ['Nordic Film Premiere',  'Stockholm',    59.33,  18.06,   4, 'Film',   'orbit',        ['#b388ff','#21d4fd']],
    ['Street Food Worlds',    'Bangkok',      13.75, 100.50,   5, 'Food',   'eventbrite',   ['#7CFFB2','#ff6ec7']],
    ['Andean Sound Ritual',   'Bogotá',        4.71, -74.07,   6, 'Music',  'orbit',        ['#ffb547','#7CFFB2']],
    ['Champions Final',       'Madrid',       40.42,  -3.70,   7, 'Sports', 'ticketmaster', ['#ff5d5d','#ffb547']],
    ['Future of Web',         'Toronto',      43.65, -79.38,   8, 'Tech',   'eventbrite',   ['#21d4fd','#9ad0ff']],
    ['Sahara Stargazing',     'Marrakesh',    31.63,  -7.99,   9, 'Talks',  'orbit',        ['#9ad0ff','#b388ff']],
    ['Cape Jazz Weekend',     'Cape Town',   -33.92,  18.42,  10, 'Music',  'eventbrite',   ['#ff6ec7','#21d4fd']],
    ['Bollywood Lights',      'Mumbai',       19.08,  72.88,  11, 'Film',   'ticketmaster', ['#ffb547','#ff6ec7']],
    ['Aurora Tech Expo',      'Reykjavik',    64.15, -21.94,  12, 'Tech',   'orbit',        ['#7CFFB2','#21d4fd']],
    ['Tango Under Stars',     'Buenos Aires',-34.60, -58.38,  13, 'Music',  'eventbrite',   ['#b388ff','#ff6ec7']],
    ['Great Wall Run',        'Beijing',      39.90, 116.40,  14, 'Sports', 'ticketmaster', ['#ff5d5d','#ffb547']],
    ['Maple Art Biennale',    'Montreal',     45.50, -73.57,  16, 'Art',    'orbit',        ['#ffb547','#b388ff']],
    ['Pacific Code Camp',     'Auckland',    -36.85, 174.76,  18, 'Tech',   'eventbrite',   ['#21d4fd','#7CFFB2']],
    ['Saffron Night Market',  'Istanbul',     41.01,  28.98,  20, 'Food',   'orbit',        ['#ffb547','#ff5d5d']],
    ['Nairobi Beats',         'Nairobi',      -1.29,  36.82,  22, 'Music',  'eventbrite',   ['#7CFFB2','#ff6ec7']],
    ['Alpine Film Fest',      'Zurich',       47.37,   8.54,  25, 'Film',   'ticketmaster', ['#b388ff','#9ad0ff']],
    ['Monsoon Tech Fair',     'Singapore',     1.35, 103.82,  28, 'Tech',   'orbit',        ['#21d4fd','#0a84ff']],
    ['Pyramid Light Show',    'Cairo',        30.04,  31.24,  30, 'Art',    'eventbrite',   ['#ffb547','#7a3cff']],
    ['Northern Gastronomy',   'Oslo',         59.91,  10.75,  34, 'Food',   'orbit',        ['#7CFFB2','#21d4fd']],
    ['Carnival of Colours',   'Lisbon',       38.72,  -9.14,  38, 'Art',    'ticketmaster', ['#ff6ec7','#ffb547']],
    ['Outback Sound',         'Perth',       -31.95, 115.86,  42, 'Music',  'eventbrite',   ['#ffb547','#ff5d5d']],
    ['Steppe Marathon',       'Almaty',       43.26,  76.95,  46, 'Sports', 'orbit',        ['#ff5d5d','#7CFFB2']],
    ['Hanoi Lantern Nights',  'Hanoi',        21.03, 105.85,  50, 'Art',    'eventbrite',   ['#ffb547','#ff6ec7']],

    // Live today in North America — gives the Host countdowns + a "sporting events underway" beat.
    ['Vancouver Jazz Festival', 'Vancouver',    49.28,-123.12,  0, 'Music',  'ticketmaster', ['#CB5A3C','#8A3B1E']],
    ['Pacific Coast Classic',   'Los Angeles',   34.05,-118.25,  0, 'Sports', 'ticketmaster', ['#A23A22','#CB5A3C']],
    ['Lakeshore Marathon',      'Chicago',       41.88, -87.63,  0, 'Sports', 'eventbrite',   ['#A23A22','#E0875F']],
    ['Bay City Derby',          'San Francisco', 37.77,-122.43,  0, 'Sports', 'orbit',        ['#A23A22','#B5722F']],

    // Extra events sharing a city, to show location markers with a count badge.
    ['Bay Area Future Fest',   'San Francisco',37.78,-122.42,  0, 'Tech',   'eventbrite',   ['#21d4fd','#7CFFB2']],
    ['SoMa Night Market',      'San Francisco',37.78,-122.40,  0, 'Food',   'orbit',        ['#7CFFB2','#ffb547']],
    ['West End Late Show',     'London',       51.51,  -0.13,  0, 'Film',   'ticketmaster', ['#b388ff','#21d4fd']],
    ['Kreuzberg Beats',        'Berlin',       52.50,  13.42,  0, 'Music',  'eventbrite',   ['#ff6ec7','#7a3cff']],
    ['Harbour Lights Encore',  'Sydney',      -33.87, 151.20,  0, 'Art',    'eventbrite',   ['#ffb547','#ff6ec7']],
    ['Austin Code Jam',        'Austin',       30.26, -97.75,  2, 'Tech',   'orbit',        ['#21d4fd','#0a84ff']],
    ['Austin Food Trucks Fest','Austin',       30.27, -97.73,  2, 'Food',   'eventbrite',   ['#7CFFB2','#ffb547']],

    // A few in the past, surfaced when scrubbing the timeline backwards.
    ['Spring Echo Fest',      'Seoul',        37.57, 126.98,  -4, 'Music',  'ticketmaster', ['#ff6ec7','#21d4fd']],
    ['Retro Arcade Expo',     'Chicago',      41.88, -87.63,  -7, 'Tech',   'eventbrite',   ['#21d4fd','#b388ff']],
    ['Harvest Plates',        'Mexico City',  19.43, -99.13, -10, 'Food',   'orbit',        ['#7CFFB2','#ffb547']],
    ['Polar Lights Talks',    'Helsinki',     60.17,  24.94, -14, 'Talks',  'eventbrite',   ['#9ad0ff','#21d4fd']],
    ['Monsoon Melodies',      'Jakarta',      -6.21, 106.85, -20, 'Music',  'ticketmaster', ['#ff6ec7','#ffb547']]
  ];

  // A few events are paid "Featured" placements (Revenue Stream 2 — sponsored events).
  const SPONSORED = { 'Neon Skyline Festival': 1, 'AI Builders Summit': 1, 'Vancouver Jazz Festival': 1 };

  let _id = 0;
  const EVENTS = RAW.map(function (r) {
    const [name, city, lat, lon, off, rawCat, source, banner] = r;
    const category = CAT_ALIAS[rawCat] || rawCat;
    const date = dayOffset(off);
    const baseLikes = 40 + Math.floor(Math.random() * 900);
    // deterministic pseudo "starts in N minutes" so the Host can do countdowns
    const startsInMin = 8 + Math.abs(Math.round(name.length * 17 + lon)) % 175;
    return {
      id: 'evt_' + (++_id),
      name: name,
      city: city,
      lat: lat,
      lon: lon,
      date: date,
      dayOffset: off,
      category: category,
      categoryColor: CATEGORIES[category],
      source: source,
      sourceLabel: SOURCES[source].label,
      sourceColor: SOURCES[source].color,
      banner: banner,
      description:
        name + ' lands in ' + city + ' — a curated ' + category.toLowerCase() +
        ' experience pulled live onto the Eventually globe. Tap through for tickets, set list, and the full run of show.',
      ticketUrl: source === 'orbit' ? null : 'https://example.com/tickets/' + (_id),
      likes: baseLikes,
      attending: Math.floor(baseLikes * (0.3 + Math.random() * 0.4)),
      clicks: baseLikes * 3 + Math.floor(Math.random() * 1200),
      sponsored: !!SPONSORED[name],
      startsInMin: startsInMin,
      // per-user state (anonymous until login)
      userLiked: false,
      userAttending: false
    };
  });

  /* ---- Multi-source feed + live deduplication ---------------------------------
   * Each event becomes one or more raw SOURCE records (the same event can appear
   * across platforms). The dedup engine clusters them back together at load.     */
  const PRICE_BY_CAT = {
    'Music': 35, 'Tech': 25, 'Business': 30, 'Arts': 15, 'Food & Drink': 10,
    'Sports': 40, 'Film & Media': 18, 'Community': 0, 'Nightlife': 20, 'Comedy': 22
  };
  const PLATFORM_URL = {
    eventbrite: function (id) { return 'https://www.eventbrite.com/e/' + id; },
    meetup: function (id) { return 'https://www.meetup.com/events/' + id; },
    ticketmaster: function (id) { return 'https://www.ticketmaster.com/event/' + id; },
    native: function () { return null; }
  };
  // Same event also listed on other platforms (price + small time drift to test the engine).
  const MULTI = {
    'Neon Skyline Festival':  [{ source: 'ticketmaster', price: 45 }, { source: 'eventbrite', price: 48, hr: 1 }],
    'Vancouver Jazz Festival':[{ source: 'ticketmaster', price: 35 }, { source: 'eventbrite', price: 39, hr: -1 }],
    'Champions Final':        [{ source: 'ticketmaster', price: 25 }, { source: 'eventbrite', price: 30, hr: 2 }],
    'Quantum Dev Conf':       [{ source: 'eventbrite', price: 20 }, { source: 'meetup', price: 0, hr: 1 }],
    'Future of Web':          [{ source: 'eventbrite', price: 15 }, { source: 'meetup', price: 0, hr: -2 }],
    'Street Food Worlds':     [{ source: 'eventbrite', price: 10 }, { source: 'meetup', price: 0, hr: 1 }],
    'Copacabana Beat':        [{ source: 'eventbrite', price: 25 }, { source: 'ticketmaster', price: 28, hr: 2 }]
  };

  let _sid = 0;
  const SOURCE_RECORDS = [];
  EVENTS.forEach(function (E) {
    let specs;
    if (E.source === 'orbit') specs = [{ source: 'native', price: null }];
    else if (MULTI[E.name]) specs = MULTI[E.name];
    else specs = [{ source: E.source, price: PRICE_BY_CAT[E.category] }];
    specs.forEach(function (sp, k) {
      const sid = 'src_' + (++_sid);
      const src = sp.source;
      SOURCE_RECORDS.push({
        source_id: sid, cluster_id: null, source: src,
        sourceLabel: SOURCES[src].label, badge: SOURCES[src].badge,
        url: PLATFORM_URL[src](sid),
        price: sp.price, priceLabel: sp.price == null ? 'Register' : (sp.price === 0 ? 'Free' : '$' + sp.price),
        organizer: (src === 'native' ? 'Eventually' : (E.city + ' ' + E.category)) + (k ? ' Group' : ' Events'),
        last_updated: Date.now() - Math.floor(Math.random() * 72) * 3600000,
        title: E.name, city: E.city,
        lat: E.lat, lon: E.lon,            // duplicates share the venue's coordinates
        startMs: E.date.getTime() + (sp.hr || 0) * 3600000,
        description: E.description, category: E.category, _evid: E.id
      });
    });
  });

  const DEDUP = window.EventuallyDedup.cluster(SOURCE_RECORDS);

  EVENTS.forEach(function (E) {
    const grp = DEDUP.groups.find(function (g) { return g.sources.some(function (s) { return s._evid === E.id; }); });
    const recs = (grp ? grp.sources : []).slice().sort(function (a, b) {
      const pa = a.price == null ? 1e9 : a.price, pb = b.price == null ? 1e9 : b.price;
      return pa - pb;                       // cheapest first (register/native last)
    });
    E.sources = recs;
    E.sourceCount = recs.length;
    E.is_native = recs.some(function (s) { return s.source === 'native'; });
    E.topScore = grp ? grp.topScore : 1;
    E.displaySource = grp ? grp.display.source : (recs[0] && recs[0].source);
    let best = null, bp = Infinity;
    if (recs.length > 1) recs.forEach(function (s) { if (s.price != null && s.price < bp) { bp = s.price; best = s.source_id; } });
    E.cheapestId = best;
  });

  const SOURCE_STATS = {
    sources: SOURCE_RECORDS.length, events: EVENTS.length,
    merged: SOURCE_RECORDS.length - DEDUP.groups.length, comparisons: DEDUP.comparisons
  };

  /* ---- Simulated scale: tens of thousands of events worldwide --------------
   * The curated seed events above stay rich (with real dedup). These generated
   * events let the globe demonstrate the "living planet" visualization at scale.
   * They cluster geographically like everything else. Bump SIM_TARGET to stress-test. */
  const SIM_TARGET = 9000;
  const CITY_SEED = [
    ['Tokyo',35.68,139.69],['Osaka',34.69,135.50],['Seoul',37.57,126.98],['Beijing',39.90,116.40],
    ['Shanghai',31.23,121.47],['Hong Kong',22.32,114.17],['Bangkok',13.75,100.50],['Singapore',1.35,103.82],
    ['Jakarta',-6.21,106.85],['Manila',14.60,120.98],['Mumbai',19.08,72.88],['Delhi',28.61,77.21],
    ['Bengaluru',12.97,77.59],['Dubai',25.20,55.27],['Istanbul',41.01,28.98],['Tel Aviv',32.08,34.78],
    ['Sydney',-33.86,151.21],['Melbourne',-37.81,144.96],['Auckland',-36.85,174.76],
    ['London',51.50,-0.12],['Paris',48.85,2.35],['Berlin',52.52,13.40],['Madrid',40.42,-3.70],
    ['Barcelona',41.39,2.17],['Rome',41.90,12.50],['Amsterdam',52.37,4.90],['Lisbon',38.72,-9.14],
    ['Stockholm',59.33,18.06],['Oslo',59.91,10.75],['Copenhagen',55.68,12.57],['Dublin',53.35,-6.26],
    ['Vienna',48.21,16.37],['Prague',50.08,14.44],['Warsaw',52.23,21.01],['Athens',37.98,23.73],
    ['Zurich',47.37,8.54],['Moscow',55.76,37.62],
    ['New York',40.71,-74.01],['Los Angeles',34.05,-118.24],['Chicago',41.88,-87.63],['Toronto',43.65,-79.38],
    ['Montreal',45.50,-73.57],['Vancouver',49.28,-123.12],['San Francisco',37.77,-122.42],['Seattle',47.61,-122.33],
    ['Austin',30.27,-97.74],['Miami',25.76,-80.19],['Boston',42.36,-71.06],['Mexico City',19.43,-99.13],
    ['Denver',39.74,-104.99],['Atlanta',33.75,-84.39],['Las Vegas',36.17,-115.14],
    ['São Paulo',-23.55,-46.63],['Rio de Janeiro',-22.91,-43.17],['Buenos Aires',-34.60,-58.38],
    ['Bogotá',4.71,-74.07],['Lima',-12.05,-77.04],['Santiago',-33.45,-70.67],
    ['Cairo',30.04,31.24],['Lagos',6.52,3.37],['Nairobi',-1.29,36.82],['Cape Town',-33.92,18.42],
    ['Johannesburg',-26.20,28.05],['Accra',5.60,-0.19],['Casablanca',33.57,-7.59],['Marrakesh',31.63,-7.99],
    ['Addis Ababa',9.03,38.74],['Dakar',14.72,-17.47]
  ];
  const CATS = Object.keys(CATEGORIES);
  const SIM_PLATFORMS = ['ticketmaster', 'eventbrite', 'meetup'];
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pickOne(a) { return a[(Math.random() * a.length) | 0]; }
  (function generate() {
    const perCity = Math.ceil(SIM_TARGET / CITY_SEED.length);
    CITY_SEED.forEach(function (c) {
      const count = Math.max(8, Math.round(perCity * rnd(0.4, 1.7)));
      for (let i = 0; i < count; i++) {
        const cat = pickOne(CATS);
        // date mix: ~16% live today, ~26% within a week, rest spread out
        const r = Math.random();   // forward-only window: today (live) .. +60 days
        const off = r < 0.16 ? 0 : (r < 0.42 ? (1 + (Math.random() * 6 | 0)) : (1 + (Math.random() * 59 | 0)));
        const date = dayOffset(off);
        const likes = 10 + (Math.random() * Math.random() * 4000 | 0);   // skewed: a few very popular
        const sponsored = Math.random() < 0.04;
        const editor = Math.random() < 0.05;
        const src = pickOne(SIM_PLATFORMS);
        const price = cat === 'Community' ? 0 : (5 + (Math.random() * 12 | 0) * 5);
        const id = 'evt_' + (++_id);
        const col = CATEGORIES[cat];
        EVENTS.push({
          id: id, name: cat + ' · ' + c[0] + ' #' + (i + 1), city: c[0],
          lat: c[1] + rnd(-0.06, 0.06), lon: c[2] + rnd(-0.06, 0.06),
          date: date, dayOffset: off, category: cat, categoryColor: col,
          source: src, sourceLabel: SOURCES[src].label, sourceColor: SOURCES[src].color,
          banner: [col, '#211A15'],
          description: 'A ' + cat.toLowerCase() + ' event in ' + c[0] + ', aggregated onto Eventually.',
          ticketUrl: 'https://example.com/e/' + id,
          likes: likes, attending: (likes * rnd(0.3, 0.7)) | 0, clicks: likes * 3,
          sponsored: sponsored, editor: editor, startsInMin: 8 + (Math.random() * 175 | 0),
          userLiked: false, userAttending: false,
          sources: [{
            source_id: 'src_' + id, source: src, sourceLabel: SOURCES[src].label, badge: SOURCES[src].badge,
            url: 'https://example.com/e/' + id, price: price, priceLabel: price === 0 ? 'Free' : '$' + price,
            organizer: c[0] + ' ' + cat, last_updated: Date.now(), title: cat + ' · ' + c[0],
            city: c[0], lat: c[1], lon: c[2], startMs: date.getTime(), description: '', category: cat, _evid: id
          }],
          sourceCount: 1, is_native: false, topScore: 1, cheapestId: null, displaySource: src
        });
      }
    });
  })();

  // Capture only ACTIVE/UPCOMING events in the forward window (today .. +60 days).
  // No past, no far-future — matches the API scraping rule we'll enforce server-side.
  const WINDOW_DAYS = 60;
  (function () {
    const keep = EVENTS.filter(function (e) { return e.dayOffset >= 0 && e.dayOffset <= WINDOW_DAYS; });
    EVENTS.length = 0; Array.prototype.push.apply(EVENTS, keep);
  })();

  // O(1) id lookup — essential now that EVENTS holds thousands of records.
  const BYID = {};
  EVENTS.forEach(function (e) { BYID[e.id] = e; });

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
    const score = evt.likes + evt.attending * 2;
    return Math.max(0.15, Math.min(1, score / 2600));
  }

  // ---- Location clustering: merge events within ~30 km into one place ----
  function haversineKm(a1, o1, a2, o2) {
    const R = 6371, d = Math.PI / 180;
    const dLat = (a2 - a1) * d, dLon = (o2 - o1) * d;
    const s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a1 * d) * Math.cos(a2 * d) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
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
    getSourceStats: function () { return SOURCE_STATS; },
    // Swap the entire dataset for a live (API) one, then rebuild id-index + clusters.
    // Used by EventuallyAPI when a backend is configured (stale-while-revalidate).
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

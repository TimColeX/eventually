/* Eventually — mock event data layer.
 * Simulates the aggregated pipeline (Eventbrite / Ticketmaster / Eventually-native).
 * Front-end demo only: no network calls. Swap getEvents() for a real fetch later.
 */
(function (global) {
  'use strict';

  // "Today" for the demo. Matches the session date so Live/Upcoming make sense.
  const TODAY = new Date('2026-06-22T12:00:00Z');

  function dayOffset(n) {
    const d = new Date(TODAY);
    d.setUTCDate(d.getUTCDate() + n);
    return d;
  }

  const SOURCES = {
    eventbrite:  { label: 'Eventbrite',   color: '#f6682f' },
    ticketmaster:{ label: 'Ticketmaster', color: '#026cdf' },
    orbit:       { label: 'Eventually Native', color: '#21d4fd' }
  };

  // Warm "Clay" palette tints — every marker stays in the brand family.
  const CATEGORIES = {
    Music:  '#CB5A3C',  // Clay
    Tech:   '#8A3B1E',  // Ember
    Art:    '#E0875F',  // Apricot
    Food:   '#B5722F',  // Ochre
    Sports: '#A23A22',  // Clay-red
    Film:   '#6E4A30',  // Cocoa
    Talks:  '#C18A5C'   // Tan
  };

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
    const [name, city, lat, lon, off, category, source, banner] = r;
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

  function typeForDate(evt, selectedDate) {
    // Same calendar day as selected date => LIVE (pillar). Future => UPCOMING (dot).
    const a = evt.date, b = selectedDate;
    const sameDay =
      a.getUTCFullYear() === b.getUTCFullYear() &&
      a.getUTCMonth() === b.getUTCMonth() &&
      a.getUTCDate() === b.getUTCDate();
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

  function buildClusters() {
    _loc = 0;
    CLUSTERS = [];
    EVENTS.forEach(function (ev) {
      let found = null;
      for (let i = 0; i < CLUSTERS.length; i++) {
        if (haversineKm(CLUSTERS[i].lat, CLUSTERS[i].lon, ev.lat, ev.lon) < 30) { found = CLUSTERS[i]; break; }
      }
      if (found) {
        found.eventIds.push(ev.id);
        const n = found.eventIds.length;            // running centroid
        found.lat += (ev.lat - found.lat) / n;
        found.lon += (ev.lon - found.lon) / n;
      } else {
        CLUSTERS.push({ id: 'loc_' + (++_loc), lat: ev.lat, lon: ev.lon, city: ev.city, eventIds: [ev.id] });
      }
    });
    return CLUSTERS;
  }
  buildClusters();

  function byId(id) { return EVENTS.find(function (e) { return e.id === id; }); }

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
    addEvent: function (evt) {
      evt.id = 'evt_' + (++_id);
      EVENTS.push(evt);
      buildClusters();
      return evt;
    }
  };
})(window);

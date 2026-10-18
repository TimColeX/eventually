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
    /* predicthq retired 2026-10-11 — 0 rows in `events` and 0 in `event_sources`, verified
       against the live API before removing this, so no card can lose its label. Reviving it
       means restoring this line: { label: 'PredictHQ', color: '#2E7D8A', badge: 'Verified
       listing' } — see the note in admin.js's SYNC_FN for the rest. */
    /* ⚠️ A SOURCE MISSING FROM HERE FAILS QUIETLY — `src/app.js` falls back to the raw
       key, so a card would read "showpass" in place of a label and take the default
       colour. Same shape of trap as the Family category in 129: the import succeeds and
       only the UI is wrong. Added with the importer, not after it. */
    showpass:    { label: 'Showpass',     color: '#1F7A5A', badge: 'Verified listing' },
    native:      { label: 'Eventually',   color: '#21d4fd', badge: '' },
    orbit:       { label: 'Eventually Native', color: '#21d4fd', badge: '' }
  };

  /* THE ONE LIST OF COUNTRY NAMES.
   *
   * Standard English names, matching what Nominatim returns and what
   * `canonCountry` in the importer maps provider spellings onto — so the
   * geocoder, the organiser and the twice-daily import all write the same
   * string.
   *
   * That agreement is not cosmetic. `build-city-pages.js` groups cities by
   * `slug|country`, so two spellings of one country split a city into two pages:
   * "United States Of America" against "United States" really did give Washington
   * both `/events/washington-us/` and `/events/washington-uni/`, with the
   * organisers' pages stranded on the thin one. A free-text box let an organiser
   * do the same with a typo — "nigeriii" would have made a second Abuja.
   *
   * Sorted for a dropdown. If a geocoder ever returns something not in here the
   * form ADDS it rather than dropping it: a missing name is a gap in this list,
   * never a reason to lose where an event actually is. */
  const COUNTRIES = ('Afghanistan,Albania,Algeria,Andorra,Angola,Antigua and Barbuda,Argentina,Armenia,Australia,'
    + 'Austria,Azerbaijan,Bahamas,Bahrain,Bangladesh,Barbados,Belarus,Belgium,Belize,Benin,Bhutan,Bolivia,'
    + 'Bosnia and Herzegovina,Botswana,Brazil,Brunei,Bulgaria,Burkina Faso,Burundi,Cambodia,Cameroon,Canada,'
    + 'Cape Verde,Central African Republic,Chad,Chile,China,Colombia,Comoros,Congo,Costa Rica,Croatia,Cuba,'
    + 'Cyprus,Czech Republic,Denmark,Djibouti,Dominica,Dominican Republic,Ecuador,Egypt,El Salvador,'
    + 'Equatorial Guinea,Eritrea,Estonia,Eswatini,Ethiopia,Fiji,Finland,France,Gabon,Gambia,Georgia,Germany,'
    + 'Ghana,Greece,Grenada,Guatemala,Guinea,Guinea-Bissau,Guyana,Haiti,Honduras,Hungary,Iceland,India,'
    + 'Indonesia,Iran,Iraq,Ireland,Israel,Italy,Ivory Coast,Jamaica,Japan,Jordan,Kazakhstan,Kenya,Kiribati,'
    + 'Kosovo,Kuwait,Kyrgyzstan,Laos,Latvia,Lebanon,Lesotho,Liberia,Libya,Liechtenstein,Lithuania,Luxembourg,'
    + 'Madagascar,Malawi,Malaysia,Maldives,Mali,Malta,Marshall Islands,Mauritania,Mauritius,Mexico,Micronesia,'
    + 'Moldova,Monaco,Mongolia,Montenegro,Morocco,Mozambique,Myanmar,Namibia,Nauru,Nepal,Netherlands,'
    + 'New Zealand,Nicaragua,Niger,Nigeria,North Korea,North Macedonia,Norway,Oman,Pakistan,Palau,Palestine,'
    + 'Panama,Papua New Guinea,Paraguay,Peru,Philippines,Poland,Portugal,Qatar,Romania,Russia,Rwanda,'
    + 'Saint Kitts and Nevis,Saint Lucia,Saint Vincent and the Grenadines,Samoa,San Marino,'
    + 'Sao Tome and Principe,Saudi Arabia,Senegal,Serbia,Seychelles,Sierra Leone,Singapore,Slovakia,Slovenia,'
    + 'Solomon Islands,Somalia,South Africa,South Korea,South Sudan,Spain,Sri Lanka,Sudan,Suriname,Sweden,'
    + 'Switzerland,Syria,Taiwan,Tajikistan,Tanzania,Thailand,Timor-Leste,Togo,Tonga,Trinidad and Tobago,'
    + 'Tunisia,Turkey,Turkmenistan,Tuvalu,Uganda,Ukraine,United Arab Emirates,United Kingdom,United States,'
    + 'Uruguay,Uzbekistan,Vanuatu,Vatican City,Venezuela,Vietnam,Yemen,Zambia,Zimbabwe').split(',');

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
    /* NIGHTLIFE TOOK THE MOSS and Expos & Fairs took the brick-rose (2026-10-17, owner's
       call — they swapped). ℹ️ The two colours only traded names: the SET is identical,
       so every pairwise separation in the palette is exactly what it was, and the
       deltaE bar recorded below still holds without re-measuring. */
    'Nightlife':     '#6F7A3C',  // Moss
    'Comedy':        '#E8A24C',  // Warm amber
    /* FAMILY — added 2026-10-02, on evidence rather than a hunch.
     *
     * `Community` was the else branch of the Ticketmaster mapping, and once 129 stored
     * what the provider actually said, 58% of what was left in it came back with the
     * genre `Family` — 18.2% of ALL events, more than Sports or Comedy. Those events had
     * nowhere to go: no rule could rescue them because the destination did not exist.
     *
     * The colour was measured, not chosen by eye. These colour the dots on the globe, so
     * a new one has to be at least as separable as the existing palette already is: the
     * closest existing pair (Business / Film & Media) is deltaE 6.8 apart, and warm sand
     * is 23.0 from its nearest neighbour (Community). Keep that bar if another is added.
     *
     * ℹ️ THE ORDER OF THIS MAP IS HISTORY, NOT A RUNNING ORDER. Categories are appended
     * as they are added, so the list reads as the order they were decided in. Every
     * screen sorts for itself — see `categoryNames()` below, which is what the chips,
     * the Types menu, the publish form and the Help Centre all use.
     * ⚠️ It used to matter: `Object.keys()` went straight to the UI, so inserting
     * mid-list silently reordered the filter chips and the publish form. It does not
     * any more, as long as display sites keep going through `categoryNames()`. */
    'Family':        '#DCC09A',  // Warm sand
    /* EXPOS & FAIRS — added 2026-10-16, and this one was added against the data.
     *
     * The feeds said no: Ticketmaster's own expo bucket (`Hobby/Special Interest Expos`)
     * holds 44 events, and a guarded title sweep brings the total to 80 of 57,131 — it
     * arrives smaller than Business. 🔑 THE REASON IT EXISTS ANYWAY IS AN ORGANISER WHO
     * ASKED FOR IT: they run trade fairs and said Business was not where their event
     * belonged. The counts measure OUR FEEDS, not what people want to list, and this map
     * is also the publish form's menu. A supply-side request is the better evidence for
     * a publish-form option than a feed count, which is why it outranked the measurement.
     *
     * NAMED for both sides of that: "Expos" is the word the data uses (home shows,
     * bridal expos, comic cons), "Fairs" is the word the organiser used. ⚠️ It does NOT
     * mean a street fair or a summer festival — Ticketmaster's `Fairs & Festivals`
     * genre (346 events) stays in Community, where 129 deliberately left it. The Help
     * Centre description is where that line is drawn for the reader.
     *
     * Colour: brick-rose, swapped with Nightlife's moss on 2026-10-17 at the owner's
     * request. ⚠️ A SWAP IS NOT A NEW COLOUR — the palette's SET is unchanged, so every
     * pairwise deltaE is exactly what it was and nothing needed re-measuring.
     * The bar a genuinely NEW colour has to clear still stands: the tightest existing
     * pair is Business / Film & Media at deltaE 6.8, and moss — now Nightlife's — is
     * 30.3 from its nearest neighbour, the most separable in the palette. It is also
     * the only one here that is not a warm earth tone. */
    'Expos & Fairs': '#9B4A52'   // Warm brick-rose
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

  /* CLUSTER BY THE CITY'S NAME, NOT BY A GRID SQUARE.
   *
   * This used to bucket purely on a 0.3° grid: `round(lat/0.3) + '_' + round(lon/0.3)`.
   * A city that straddles a cell boundary therefore became TWO dots with the same
   * name, and the search box — which counts by name — could only open one of them.
   * Saskatoon really did split: the NCAS gala at −106.6852 and MrP (P-Square) at
   * −106.6352 are four kilometres apart across the line at −106.65, so searching
   * "Saskatoon" opened a three-event cluster and the other two were unreachable.
   * Every city near a grid line had this, and the bigger the city the likelier it is
   * to straddle one.
   *
   * Three rules, and the second two exist because the first alone is wrong:
   *
   * 1. GROUP BY name — so one city is one dot however its venues fall.
   *
   * 2. INCLUDE THE COUNTRY. London GB and London CA are not one place. Cambridge
   *    appears in three countries in the live data and separates cleanly once the
   *    country is part of the key.
   *
   * 3. STILL SPLIT A GROUP THAT IS PHYSICALLY SPREAD OUT. Country is not enough:
   *    "Portland, United States" is 184 events spanning 3,722 km — Oregon AND Maine —
   *    and their centroid lands in empty country in eastern Oregon. Richmond (US)
   *    spans 570 km, London (CA) 286 km. So within a name group an event joins a
   *    sub-cluster only if it is within SPLIT_KM of that sub-cluster's centre;
   *    otherwise it starts another. Real cities sit far below the threshold —
   *    London GB spreads 20 km, Toronto 15 km, Saskatoon 4 km.
   *
   * An event with no city falls back to the old grid key, which is what it always
   * had and the only sensible answer when there is no name to group on.
   */
  const CELL = 0.3;
  const SPLIT_KM = 60;        // a metro area is tens of km; two same-name cities are hundreds

  function _km(aLat, aLon, bLat, bLon) {
    const R = 6371, t = Math.PI / 180;
    const dLat = (bLat - aLat) * t, dLon = (bLon - aLon) * t;
    const s = Math.sin(dLat / 2) * Math.sin(dLat / 2)
      + Math.cos(aLat * t) * Math.cos(bLat * t) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  function buildClusters() {
    _loc = 0; CLUSTERS = [];
    const groups = {};          // key -> array of clusters (more than one only when split)

    EVENTS.forEach(function (ev) {
      if (ev.lat == null || ev.lon == null) return;
      const city = String(ev.city || '').trim();
      const key = city
        ? 'c:' + city.toLowerCase() + '|' + String(ev.country || '').trim().toLowerCase()
        : 'g:' + Math.round(ev.lat / CELL) + '_' + Math.round(ev.lon / CELL);

      const bucket = groups[key] || (groups[key] = []);
      // Join the nearest sub-cluster within range, or start a new one.
      let best = null, bestKm = Infinity;
      for (let i = 0; i < bucket.length; i++) {
        const d = _km(bucket[i].lat, bucket[i].lon, ev.lat, ev.lon);
        if (d < bestKm) { bestKm = d; best = bucket[i]; }
      }
      if (!best || bestKm > SPLIT_KM) {
        best = { id: 'loc_' + (++_loc), lat: ev.lat, lon: ev.lon, city: city || null, eventIds: [], _n: 0 };
        bucket.push(best); CLUSTERS.push(best);
      }
      // A grid-keyed cluster has no name until an event supplies one.
      if (!best.city && ev.city) best.city = ev.city;
      best.eventIds.push(ev.id);
      best._n++;
      best.lat += (ev.lat - best.lat) / best._n;     // running centroid
      best.lon += (ev.lon - best.lon) / best._n;
    });
    return CLUSTERS;
  }
  buildClusters();

  function byId(id) { return BYID[id]; }

  global.EventuallyData = {
    TODAY: TODAY,
    SOURCES: SOURCES,
    CATEGORIES: CATEGORIES,
    /* THE ONE ORDER THE SCREENS USE: alphabetical. Twelve categories is past the point
       where a reader scans the whole list, so it has to be findable rather than
       chronological — and the map's own order is the order they were ADDED, which is
       meaningful to us and meaningless to a visitor.
       ℹ️ `localeCompare`, not `<`, so accented and non-English names sort the way the
       reader expects when the category list is eventually translated.
       ⚠️ Sorted FRESH on each call rather than cached: this is a dozen strings a few
       times per panel open, and a cache would be one more thing to invalidate when a
       category is added. */
    categoryNames: function () {
      return Object.keys(CATEGORIES).sort(function (a, b) { return a.localeCompare(b); });
    },
    COUNTRIES: COUNTRIES,
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

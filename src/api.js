/* Eventually — backend client (the data seam).
 *
 * Talks to the Supabase backend when window.EVENTUALLY_CONFIG is filled in;
 * otherwise stays dormant. The globe starts EMPTY with a "Loading live events…"
 * hint and fills when the events arrive. If the backend is empty or unreachable,
 * the app says so and keeps retrying (app.js) — there is no demo data to fall back
 * on any more: it presented made-up events as real, and was removed 2026-09-10.
 *
 * Read path uses Supabase's auto-generated PostgREST RPC endpoints
 * (events_in_view / search_events) with the public anon key. No secret keys
 * live here — the Ticketmaster key stays server-side in the ingestion function.
 */
(function (global) {
  'use strict';

  const D = global.EventuallyData;
  const cfg = global.EVENTUALLY_CONFIG || {};
  const BASE = (cfg.supabaseUrl || '').replace(/\/+$/, '') || null;
  const ANON = cfg.supabaseAnonKey || null;
  const REMOTE = !!(BASE && ANON);

  const listeners = [];
  function onData(cb) { if (typeof cb === 'function') listeners.push(cb); }
  function emit(events) { listeners.forEach(function (cb) { try { cb(events); } catch (e) { console.error(e); } }); }

  function headers() {
    return { 'apikey': ANON, 'Authorization': 'Bearer ' + ANON, 'Content-Type': 'application/json' };
  }

  const CATS = D.CATEGORIES;
  const SRC = D.SOURCES;

  function dayOffsetFrom(date, today) {
    // Local calendar days (matches data.js TODAY + typeForDate).
    const a = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const b = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return Math.round((a - b) / 86400000);
  }

  // Canonical API event (see SETUP.md §schema) -> the internal shape app.js renders.
  function toEvent(a) {
    const date = new Date(a.start_time);
    const cat = CATS[a.category] ? a.category : 'Community';
    const pop = (a.popularity != null) ? Number(a.popularity) : 0.3;
    // Globe ranking only. This number used to be SHOWN as the like count (and ×0.4 as
    // "going", ×3 as clicks), so every listing displayed invented engagement — a test
    // event read "♥ 800 · ✓ 320". It is now a private ranking weight that keeps the
    // globe's glow exactly as it was; real counts come from event_counts() (78).
    const rank = Math.round(Math.max(0.05, Math.min(1, pop)) * 2000);
    /* THE SOURCE ARRAY IS REBUILT HERE, NOT SHIPPED.
     *
     * `events_in_view` used to send a `sources` array per event — 0.89 MB of a
     * 3.91 MB worldwide payload, on the call that is the app's initial load and
     * was being cancelled by the gateway when cold. 124 replaced it with three
     * flat fields, because the array could never have earned its weight:
     *
     *   • every event has exactly ONE source (3,000 of 3,000, checked live);
     *   • app.js reads `.sources` in three places — cheapest price, and whether
     *     anything is priced — and never lists sellers;
     *   • only `url`, `price` and `source` are used anywhere. `badge`,
     *     `organizer`, `last_updated`, `source_id` and `currency` were shipped
     *     3,000 times and read zero times.
     *
     * Rebuilding the same shape here means app.js and dedup.js are untouched.
     * `a.sources` is still honoured first so an older cached response, or any
     * other caller that still sends the array, keeps working. */
    const rawSources = (a.sources && a.sources.length) ? a.sources
      : (a.ticket_url != null || a.has_ticket || a.ticket_price != null || a.ticket_source)
        ? [{ source_id: null, source: a.ticket_source || a.display_source,
             url: a.ticket_url || null, price: a.ticket_price,
             currency: null, organizer: '', badge: '', last_updated: null }]
        : [];
    const sources = rawSources.map(function (s) {
      const lbl = SRC[s.source] ? SRC[s.source].label : s.source;
      const price = s.price == null ? null : Number(s.price);
      return {
        source_id: s.source_id, source: s.source, sourceLabel: lbl, badge: s.badge || '',
        url: s.url, price: price,
        priceLabel: price == null ? 'Register' : (price === 0 ? 'Free' : '$' + price),
        organizer: s.organizer || '', last_updated: s.last_updated ? new Date(s.last_updated).getTime() : Date.now(),
        title: a.title, city: a.city, lat: a.lat, lon: a.lon, startMs: date.getTime(),
        description: a.description || '', category: cat, _evid: a.event_id
      };
    });
    const ds = a.display_source || (sources[0] && sources[0].source) || 'ticketmaster';
    return {
      // `country` rides along because the clusterer needs it: grouping by city NAME
      // alone would put London (GB) and London (CA) on one dot. It is already in
      // every events_in_view row and was simply being dropped here.
      id: a.event_id, name: a.title, city: a.city, country: a.country || null,
      lat: a.lat, lon: a.lon,
      date: date, dayOffset: dayOffsetFrom(date, D.TODAY),
      category: cat, categoryColor: CATS[cat],
      source: ds, sourceLabel: SRC[ds] ? SRC[ds].label : ds, sourceColor: SRC[ds] ? SRC[ds].color : '#CB5A3C',
      banner: [CATS[cat], '#211A15'],
      // 132 live listings have no city; this used to read "<title> in null — …".
      description: a.description || (a.title + (a.city ? ' in ' + a.city : '') + ' — pulled live onto the Eventually globe.'),
      ticketUrl: (sources[0] && sources[0].url) || null,
      /* DOES A BOOKING LINK EXIST? The URL itself is no longer in the globe payload
         — it was 307 kB of 2.09 MB (15%), and after 133 the payload is what decides
         whether the worldwide call survives the statement timeout (≈950 ms per MB).
         So the payload carries this flag instead and the URL is fetched when an event
         is OPENED, exactly as 126 does for `description`.
         🔑 The CTA never needed the URL anyway: it goes through /go, which resolves
         `events.ticket_url` server-side. The raw URL is only used to NAME the
         destination ("You'll be taken to …"), which falls back to the source label
         until mountTicketDest() fills it in. */
      hasTicket: !!(a.has_ticket || (sources[0] && sources[0].url)),
      likes: 0, attending: 0, clicks: 0, _rank: rank,      // real counts load when the event opens
      sponsored: !!a.sponsored,
      // Real minutes until it starts (was an invented number between 5 and 240).
      startsInMin: Math.round((date.getTime() - Date.now()) / 60000),
      userLiked: false, userAttending: false,
      sources: sources, sourceCount: a.source_count || sources.length || 1,
      is_native: !!a.is_native, topScore: 1,
      collectRegistrations: !!a.collect_registrations,
      // The venue's own zone. NULL for listings we couldn't place, in which case
      // the UI falls back to the reader's clock as it always did.
      timezone: a.timezone || null, venue: a.venue || null, address: a.address || null,
      endsAt: a.end_time ? new Date(a.end_time) : null,
      cheapestId: a.cheapest_source_id || null, displaySource: ds,
      // True when the payload carried only a snippet (126). The detail panel
      // fetches the rest on open; a card never needs it.
      descTruncated: !!a.desc_truncated,
      /* How many sittings of this event the one entry stands for (127). A
         recurring drop-in session was previously one row, one dot and one slot
         in the 3,000 PER SITTING — 1,000 Saskatoon rows held only 90 distinct
         titles. 1 means exactly what it says: a single occurrence. */
      occurrences: Math.max(1, +a.occurrences || 1)
    };
  }

  // Admin-tunable look-ahead for the globe (days). Default 60; set via setWindowDays from
  // app_config.windowDays. Controls how far ahead an event can be and still show as a marker.
  let windowDays = 60;
  function setWindowDays(n) { const v = Number(n); if (Number.isFinite(v) && v > 0) windowDays = Math.min(365, Math.max(1, Math.round(v))); }

  // GET events for a viewport (defaults to the whole globe + the admin window, default 60 days).
  function fetchEvents(opts) {
    if (!REMOTE) return Promise.resolve(null);
    const o = opts || {};
    const body = {
      min_lat: o.minLat != null ? o.minLat : -90,
      min_lon: o.minLon != null ? o.minLon : -180,
      max_lat: o.maxLat != null ? o.maxLat : 90,
      max_lon: o.maxLon != null ? o.maxLon : 180,
      to_ts: new Date(Date.now() + windowDays * 86400000).toISOString(),   // admin-tunable window
      cats: o.categories || null
    };
    return fetch(BASE + '/rest/v1/rpc/events_in_view', {
      method: 'POST', headers: headers(), body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) throw new Error('events_in_view ' + r.status);
      return r.json();
    }).then(function (rows) { return (rows || []).map(toEvent); });
  }

  // Initial load. Resolves false on any failure; the caller shows that and retries.
  //
  // It waits (briefly) for the admin config first. Loading straight away used the
  // built-in 60-day window; the config then arrived with 120 and app.js re-fetched the
  // whole world with it — two of the heaviest calls the app makes, per visitor, the
  // first thrown away. That doubled load is part of what pushed events_in_view into its
  // statement timeout. Now there is one call, with the window the server has cached.
  function boot() {
    if (!REMOTE) return Promise.resolve(false);
    const cfgReady = getConfig().then(function (cfg) {
      if (cfg && typeof cfg.windowDays === 'number' && cfg.windowDays > 0) setWindowDays(cfg.windowDays);
    });
    // Never let a slow config hold the globe hostage: after 1.5 s, load with what we have.
    const waitCfg = Promise.race([cfgReady, new Promise(function (r) { setTimeout(r, 1500); })]);
    return waitCfg.then(function () {
      const used = windowDays;
      return loadOnce().then(function (ok) {
        // Config landed after the timeout, with a different window → load once more
        // with the right one. Rare; the common path makes exactly one call.
        cfgReady.then(function () {
          if (ok && windowDays !== used) fetchEvents({}).then(function (evs) { if (evs && evs.length) emit(evs); }).catch(function () {});
        });
        return ok;
      });
    });
  }
  // One retry on failure. The timeouts were intermittent — the same call succeeded a
  // second later — so a single retry turns most of them into a short delay instead of
  // an error message.
  function loadOnce() {
    return fetchEvents({}).catch(function (e) {
      console.warn('[EventuallyAPI] live load failed, retrying once:', e.message);
      return new Promise(function (r) { setTimeout(r, 1200); }).then(function () { return fetchEvents({}); });
    }).then(function (events) {
      if (events && events.length) { emit(events); return true; }
      console.warn('[EventuallyAPI] backend reachable but returned 0 events — will retry.');
      return false;
    }).catch(function (e) {
      console.warn('[EventuallyAPI] live load failed, will retry:', e.message);
      return false;
    });
  }

  // Admin-configured AI Host sponsors (Admin → AI Host Script → Sponsors). Public read
  // (RLS allows select; writes are admin-only). Resolves [] when none are configured, so
  // the Host simply never mentions a sponsor. Same table the spoken briefing uses.
  function getSponsors() {
    if (!REMOTE) return Promise.resolve([]);
    return fetch(BASE + '/rest/v1/briefing_sponsors?select=scope,message,weight,enabled,active_from,active_to&enabled=is.true', { headers: headers() })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) { return rows || []; })
      .catch(function () { return []; });
  }

  /* The FULL description for one opened event. The globe payload carries a 200
     character snippet (126) because descriptions were 47% of it — 1,667 kB of
     3.48 MB — and a card clamps to about two lines, so entire Ticketmaster
     blurbs were being shipped 3,000 at a time to show the first hundred
     characters of each.

     One event, on open, like fetchImages and event_counts. Resolves null on any
     failure, so a detail panel keeps the snippet rather than going blank. */
  function fetchDescription(id) {
    if (!REMOTE || !id) return Promise.resolve(null);
    return fetch(BASE + '/rest/v1/events?select=description&event_id=eq.' + encodeURIComponent(id),
      { headers: headers() })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (rows) { return (rows && rows[0] && rows[0].description) || null; })
      .catch(function () { return null; });
  }

  /* The booking URL for ONE opened event. Same shape and the same reason as
     fetchDescription above: the globe payload carries a flag, not 3,000 URLs.
     Read from `events.ticket_url` — the column /go itself resolves — rather than
     from event_sources, so the link named here and the link the button follows can
     never disagree. Measured on 2026-10-02: populated for 55,741 of 55,801 upcoming
     events, and identical to event_sources.url wherever both exist. */
  function fetchTicketUrl(id) {
    if (!REMOTE || !id) return Promise.resolve(null);
    return fetch(BASE + '/rest/v1/events?select=ticket_url&event_id=eq.' + encodeURIComponent(id),
      { headers: headers() })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (rows) { return (rows && rows[0] && rows[0].ticket_url) || null; })
      .catch(function () { return null; });
  }

  // Event images for the cards / detail panel, by event id → url (or null when the
  // event has none). They are deliberately NOT in the globe payload: 74 dropped
  // image_url to cut ~40% off every visitor's download, and putting a URL on all 3,000
  // events would add it straight back. Fetching only what's on screen keeps the globe
  // small — one request per opened city list. Resolves {} on any failure (no images,
  // never a broken list).
  function fetchImages(ids) {
    if (!REMOTE || !ids || !ids.length) return Promise.resolve({});
    const q = ids.slice(0, 80).map(encodeURIComponent).join(',');
    return fetch(BASE + '/rest/v1/events?select=event_id,image_url&event_id=in.(' + q + ')', { headers: headers() })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        const m = {};
        (rows || []).forEach(function (r) { m[r.event_id] = r.image_url || null; });
        return m;
      })
      .catch(function () { return {}; });
  }

  // Remote app config (admin-tunable). Resolves null if unavailable → code defaults.
  // One request shared by every caller: boot() and app.js both need it at start-up.
  let configP = null;
  function getConfig() {
    if (!REMOTE) return Promise.resolve(null);
    if (!configP) {
      configP = fetch(BASE + '/rest/v1/app_config?select=config&limit=1', { headers: headers() })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (rows) { return (rows && rows[0] && rows[0].config) || null; })
        .catch(function () { return null; });
    }
    return configP;
  }

  // Full-database search (any approved upcoming event, not just the loaded globe).
  function search(q) {
    if (!REMOTE || !q) return Promise.resolve([]);
    return fetch(BASE + '/rest/v1/rpc/search_events', {
      method: 'POST', headers: headers(), body: JSON.stringify({ q: q })
    }).then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) { return rows || []; })
      .catch(function () { return []; });
  }

  // Free "Today's briefing" — LLM-authored spoken script SHARED per cluster cell,
  // delivered by the device's own voice. The briefing is keyed server-side by the
  // grid cell of {lat,lon} (not the geocoded city), so everyone in an area hears
  // one script and cost stays ~one call per cell/day. Resolves { text } or null so
  // the caller can fall back to a locally-built briefing. opts: {city,lat,lon,lang,day}
  // (city is display-only; day is the caller's LOCAL date YYYY-MM-DD).
  function dailyBriefing(opts) {
    if (!REMOTE) return Promise.resolve(null);
    const o = opts || {};
    return fetch(BASE + '/functions/v1/briefing', {           // unified provider (free = text)
      method: 'POST', headers: headers(),
      body: JSON.stringify({
        city: o.city || null, lat: (o.lat != null ? o.lat : null), lon: (o.lon != null ? o.lon : null),
        lang: o.lang || 'en', day: o.day || null,
        // Home cell → the server serves a short "city headline" when exploring
        // (cheaper Claude generation as well as cheaper audio).
        home_lat: (o.homeLat != null ? o.homeLat : null),
        home_lon: (o.homeLon != null ? o.homeLon : null)
      })
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { return (d && d.text) ? d : null; })
      .catch(function () { return null; });
  }

  global.EventuallyAPI = {
    config: { remote: REMOTE, baseUrl: BASE },
    boot: boot,
    onData: onData,
    fetchEvents: fetchEvents,
    setWindowDays: setWindowDays,
    toEvent: toEvent,
    getConfig: getConfig,
    fetchImages: fetchImages,
    fetchDescription: fetchDescription,
    fetchTicketUrl: fetchTicketUrl,
    getSponsors: getSponsors,
    search: search,
    dailyBriefing: dailyBriefing
  };
})(window);

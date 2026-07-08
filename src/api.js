/* Eventually — backend client (the data seam).
 *
 * Talks to the Supabase backend when window.EVENTUALLY_CONFIG is filled in;
 * otherwise stays dormant and the app runs entirely on the built-in demo data
 * in data.js. Design = stale-while-revalidate: the globe paints instantly on
 * mock data, then this swaps in live events when they arrive. If the backend is
 * empty, unreachable, or unconfigured, the app simply keeps showing mock data —
 * it can never go blank.
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
    const likes = Math.round(Math.max(0.05, Math.min(1, pop)) * 2000);
    const sources = (a.sources || []).map(function (s) {
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
      id: a.event_id, name: a.title, city: a.city, lat: a.lat, lon: a.lon,
      date: date, dayOffset: dayOffsetFrom(date, D.TODAY),
      category: cat, categoryColor: CATS[cat],
      source: ds, sourceLabel: SRC[ds] ? SRC[ds].label : ds, sourceColor: SRC[ds] ? SRC[ds].color : '#CB5A3C',
      banner: [CATS[cat], '#211A15'],
      description: a.description || (a.title + ' in ' + a.city + ' — pulled live onto the Eventually globe.'),
      ticketUrl: (sources[0] && sources[0].url) || null,
      likes: likes, attending: Math.round(likes * 0.4), clicks: likes * 3,
      sponsored: !!a.sponsored,
      startsInMin: Math.max(5, Math.abs(Math.round((date.getTime() - Date.now()) / 60000)) % 240),
      userLiked: false, userAttending: false,
      sources: sources, sourceCount: a.source_count || sources.length || 1,
      is_native: !!a.is_native, topScore: 1,
      cheapestId: a.cheapest_source_id || null, displaySource: ds
    };
  }

  // GET events for a viewport (defaults to the whole globe + the 60-day window).
  function fetchEvents(opts) {
    if (!REMOTE) return Promise.resolve(null);
    const o = opts || {};
    const body = {
      min_lat: o.minLat != null ? o.minLat : -90,
      min_lon: o.minLon != null ? o.minLon : -180,
      max_lat: o.maxLat != null ? o.maxLat : 90,
      max_lon: o.maxLon != null ? o.maxLon : 180,
      cats: o.categories || null
    };
    return fetch(BASE + '/rest/v1/rpc/events_in_view', {
      method: 'POST', headers: headers(), body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) throw new Error('events_in_view ' + r.status);
      return r.json();
    }).then(function (rows) { return (rows || []).map(toEvent); });
  }

  // Initial load. Resolves false (and leaves mock data in place) on any failure.
  function boot() {
    if (!REMOTE) return Promise.resolve(false);
    return fetchEvents({}).then(function (events) {
      if (events && events.length) { emit(events); return true; }
      console.warn('[EventuallyAPI] backend reachable but returned 0 events — staying on demo data.');
      return false;
    }).catch(function (e) {
      console.warn('[EventuallyAPI] live load failed, staying on demo data:', e.message);
      return false;
    });
  }

  // Remote app config (admin-tunable). Resolves null if unavailable → code defaults.
  function getConfig() {
    if (!REMOTE) return Promise.resolve(null);
    return fetch(BASE + '/rest/v1/app_config?select=config&limit=1', { headers: headers() })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (rows) { return (rows && rows[0] && rows[0].config) || null; })
      .catch(function () { return null; });
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

  global.EventuallyAPI = {
    config: { remote: REMOTE, baseUrl: BASE },
    boot: boot,
    onData: onData,
    fetchEvents: fetchEvents,
    toEvent: toEvent,
    getConfig: getConfig,
    search: search
  };
})(window);

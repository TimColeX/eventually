/* Eventually — forecast lookup for event cards and the host's weather line.
 *
 * Source is MET Norway, fetched through OUR `weather` Edge Function, never from the
 * browser: their terms require an identifying User-Agent and real caching, and both of
 * those belong on a server we control (see backend/94_weather.ts). Attribution travels
 * with every response and is shown wherever a forecast appears — it is a licence
 * condition, not a courtesy.
 *
 * Everything here is best-effort. A forecast is a nicety on an event card: if it is slow,
 * blocked or missing, the card renders exactly as it did before and nothing logs an error
 * at the user.
 */
(function (global) {
  'use strict';

  const cfg = global.EVENTUALLY_CONFIG || {};
  const BASE = (cfg.supabaseUrl || '').replace(/\/+$/, '');
  const KEY = cfg.supabaseAnonKey || '';
  const ENABLED = !!(BASE && KEY);

  const FRESH_MS = 30 * 60 * 1000;         // trust a digest for half an hour in the tab
  const HORIZON_MS = 9 * 24 * 3600 * 1000; // MET forecasts nine days; past that, say nothing
  const mem = new Map();                   // cell -> { at, data }
  const inflight = new Map();              // cell -> Promise (one request per cell, not per card)

  // ~11 km, matching the server's cache cell. Two venues in one city share a forecast,
  // which is the point: one request covers every card in the list.
  function cellOf(lat, lon) { return (+lat).toFixed(1) + ',' + (+lon).toFixed(1); }

  function fromSession(cell) {
    try {
      const raw = sessionStorage.getItem('eventually.wx.' + cell);
      if (!raw) return null;
      const o = JSON.parse(raw);
      return (o && Date.now() - o.at < FRESH_MS) ? o : null;
    } catch (e) { return null; }
  }
  function toSession(cell, rec) {
    try { sessionStorage.setItem('eventually.wx.' + cell, JSON.stringify(rec)); } catch (e) { /* private mode */ }
  }

  function get(lat, lon) {
    if (!ENABLED || !isFinite(lat) || !isFinite(lon)) return Promise.resolve(null);
    const cell = cellOf(lat, lon);
    const hot = mem.get(cell) || fromSession(cell);
    if (hot && Date.now() - hot.at < FRESH_MS) { mem.set(cell, hot); return Promise.resolve(hot.data); }
    if (inflight.has(cell)) return inflight.get(cell);
    const p = fetch(BASE + '/functions/v1/weather?lat=' + (+lat).toFixed(4) + '&lon=' + (+lon).toFixed(4), {
      headers: { apikey: KEY }
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || d.error || !d.series) return null;
        const rec = { at: Date.now(), data: d };
        mem.set(cell, rec); toSession(cell, rec);
        return d;
      }).catch(function () { return null; })
      .then(function (d) { inflight.delete(cell); return d; });
    inflight.set(cell, p);
    return p;
  }

  /* The forecast point nearest a moment in time. Close to now the series is hourly, so
     the match is tight; a week out it is 6-hourly, so we allow a wider window and the
     caller says "around" rather than quoting an hour. Null once we're past MET's range —
     an invented forecast for an event five weeks away would be worse than none. */
  function at(data, whenMs) {
    if (!data || !data.series || !data.series.length || !isFinite(whenMs)) return null;
    const dt = whenMs - Date.now();
    if (dt > HORIZON_MS) return null;
    if (dt < -6 * 3600000) return null;                       // already well over
    let best = null, bestGap = Infinity;
    for (const p of data.series) {
      const gap = Math.abs(Date.parse(p.t) - whenMs);
      if (gap < bestGap) { bestGap = gap; best = p; }
    }
    return (best && bestGap <= 4 * 3600000) ? best : null;
  }

  // One glyph and one plain word per sky family. Emoji rather than an icon font: no
  // download, renders in every list, and reads the same on a phone as on a laptop.
  const LOOK = {
    clear:        { icon: '☀️', word: 'clear' },
    partlycloudy: { icon: '⛅', word: 'partly cloudy' },
    cloudy:       { icon: '☁️', word: 'cloudy' },
    fog:          { icon: '🌫️', word: 'foggy' },
    lightrain:    { icon: '🌦️', word: 'light rain' },
    rain:         { icon: '🌧️', word: 'rain' },
    heavyrain:    { icon: '🌧️', word: 'heavy rain' },
    sleet:        { icon: '🌨️', word: 'sleet' },
    snow:         { icon: '❄️', word: 'snow' },
    thunder:      { icon: '⛈️', word: 'thunderstorms' },
    unknown:      { icon: '', word: '' }
  };
  function look(sky) { return LOOK[sky] || LOOK.unknown; }

  // "⛅ 14°" — the whole forecast in the width a card can spare.
  function chip(point) {
    if (!point || point.temp == null) return '';
    const l = look(point.sky);
    return '<span class="wx-chip" title="' + (l.word ? l.word[0].toUpperCase() + l.word.slice(1) + ', ' : '') +
      point.temp + '°C — forecast from MET Norway">' + l.icon + ' ' + point.temp + '°</span>';
  }

  // "Partly cloudy, around 14°" — for the event page, where there is room to say it.
  function line(point) {
    if (!point || point.temp == null) return '';
    const l = look(point.sky);
    const w = l.word ? l.word[0].toUpperCase() + l.word.slice(1) + ', ' : '';
    const wet = (point.prec != null && point.prec >= 0.5) ? ' · ' + point.prec + ' mm' : '';
    return w + 'around ' + point.temp + '°' + wet;
  }

  global.EventuallyWeather = { get: get, at: at, chip: chip, line: line, look: look, enabled: ENABLED };
})(window);

/* Eventually — AI Host premium voice (ElevenLabs, Plus-only).
 *
 * Dormant + safe: enabled only when window.EVENTUALLY_CONFIG.host.elevenlabs is
 * true (and a backend is configured). synthesize() returns a playable audio URL,
 * or null on any failure / non-eligibility — the host then falls back to the free
 * browser voice. No secrets here; the ElevenLabs key lives in the Edge Function.
 */
(function (global) {
  'use strict';

  const cfg = global.EVENTUALLY_CONFIG || {};
  const BASE = (cfg.supabaseUrl || '').replace(/\/+$/, '');
  const ANON = cfg.supabaseAnonKey || '';
  const host = cfg.host || {};
  const ENABLED = !!(host.elevenlabs && BASE && ANON);

  // Get a fresh access token, refreshing the session if it's expired/near-expiry,
  // so an idle/backgrounded tab auto-recovers instead of dropping to browser voice.
  function accessToken() {
    const A = global.EventuallyAuth;
    if (!A || !A.client) return Promise.resolve(null);
    return A.client.auth.getSession().then(function (r) {
      const s = r && r.data && r.data.session;
      if (!s) return null;
      const now = Math.floor(Date.now() / 1000);
      if (s.expires_at && s.expires_at - now < 60) {           // expired or <60s left → refresh
        return A.client.auth.refreshSession().then(function (rr) {
          return (rr && rr.data && rr.data.session && rr.data.session.access_token) || null;
        }).catch(function () { return null; });
      }
      return s.access_token;
    }).catch(function () { return null; });
  }

  // City-switch transitions, fetched once per language per page load (see getTransitions).
  var _transitions = {};

  // Two-host conversations already fetched on this visit, kept for 10 minutes. Going back
  // to a city heard a minute ago then makes the next switch INSTANT — which is what lets
  // the host open with "here's what's on" instead of "give me a moment". Keyed by the
  // request minus the date (a visit doesn't straddle days in practice, and entries expire
  // anyway). Failed fetches aren't kept.
  // ⚠️ A PEEK is keyed SEPARATELY. A peek can legitimately answer "not made yet"; sharing
  // the key would hand that still-pending peek to the real request that follows it, and
  // the briefing would never be generated.
  var _conv = {};
  var CONV_TTL = 600000;
  function convKey(o) {
    var r = function (v) { return (v != null && isFinite(+v)) ? (+v).toFixed(3) : ''; };
    return [(o.city || '').toLowerCase(), r(o.lat), r(o.lon), (o.lang || 'en').slice(0, 2), o.quick ? 'q' : 'f', r(o.homeLat), r(o.homeLon), o.peek ? 'peek' : ''].join('|');
  }

  global.EventuallyHostVoice = {
    enabled: ENABLED,
    // Premium briefing from the UNIFIED provider (rich Claude script → ElevenLabs,
    // keyed by cluster cell; audio:true → Plus audio segments). Returns normalized
    // { segments:[{url,text}], text } (body + any verbatim promo clips), or null.
    // opts: {city,lat,lon,lang,day}
    getBriefing: function (opts) {
      if (!ENABLED) return Promise.resolve(null);
      const o = opts || {};
      return accessToken().then(function (tk) {
        if (!tk) return null;
        return fetch(BASE + '/functions/v1/briefing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': ANON, 'Authorization': 'Bearer ' + tk },
          body: JSON.stringify({
            audio: true, city: o.city || null,
            lat: (o.lat != null ? o.lat : null), lon: (o.lon != null ? o.lon : null),
            lang: (o.lang || 'en').slice(0, 2), day: o.day || null,
            interests: o.interests || [], saved: o.saved || 0,   // personalized concierge tails
            // The user's HOME cell. If the requested cell differs, the server serves a
            // short cached "city headline" instead of a full briefing (cost control).
            home_lat: (o.homeLat != null ? o.homeLat : null),
            home_lon: (o.homeLon != null ? o.homeLon : null)
          })
        }).then(function (r) {
          if (!r.ok) { r.json().then(function (e) { console.warn('[HostVoice] briefing ' + r.status, e); }).catch(function () {}); return null; }
          return r.json();
        }).then(function (j) {
          if (!j) return null;
          if (j.segments && j.segments.length) return { segments: j.segments, text: j.text || j.segments[0].text || '' };
          if (j.url) return { segments: [{ url: j.url, text: j.text || '' }], text: j.text || '' };   // legacy single-url
          return null;
        });
      }).catch(function () { return null; });
    },
    // TWO-HOST conversation (Fish multi-speaker) — UNIVERSAL. One cached mp3 for
    // everyone, no Plus token needed (anon key). Server decides two-host vs fallback.
    // opts: {city,lat,lon,lang,day,homeLat,homeLon} -> Promise<{segments:[{url,text}]}|null>
    getConversation: function (opts) {
      if (!ENABLED) return Promise.resolve(null);
      var o = opts || {};
      var key = convKey(o), hit = _conv[key];
      if (hit && Date.now() - hit.t < CONV_TTL) return hit.p;     // fetched earlier this visit
      var p = fetch(BASE + '/functions/v1/briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': ANON, 'Authorization': 'Bearer ' + ANON },
        body: JSON.stringify({ audio: true, city: o.city || null, lat: (o.lat != null ? o.lat : null), lon: (o.lon != null ? o.lon : null),
          lang: (o.lang || 'en').slice(0, 2), day: o.day || null, home_lat: (o.homeLat != null ? o.homeLat : null), home_lon: (o.homeLon != null ? o.homeLon : null),
          quick: !!o.quick,     // a switch → short "headline" tier (fast synth)
          peek: !!o.peek })     // only if it's already made — the server never creates one for a peek
      }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (j && j.segments && j.segments.length) {
            var res = { segments: j.segments, text: j.text || '', twoHost: !!j.twoHost };
            // A peek HIT is the real briefing, so remember it under the real key too; a
            // later deliberate request for the same city is then instant as well.
            if (o.peek) {
              var realKey = convKey(Object.assign({}, o, { peek: false }));
              if (!_conv[realKey]) _conv[realKey] = { p: Promise.resolve(res), t: Date.now() };
            }
            return res;
          }
          return null;                          // includes {peek:"miss"} — not made yet
        }).catch(function () { return null; });
      _conv[key] = { p: p, t: Date.now() };
      p.then(function (res) { if (!res && _conv[key] && _conv[key].p === p) delete _conv[key]; });
      return p;
    },
    // CITY RADIO FILLER — the city's cached modular segments (facts/history/culture/typical
    // events) played when events run out, to keep the station going. All cached + reused
    // (generated once per city, ever). opts: {city,lat,lon,lang}
    // -> Promise<{segments:[{url,text,speaker,seg}], filler:true, music:'between'}|null>
    getCityFiller: function (opts) {
      if (!ENABLED) return Promise.resolve(null);
      var o = opts || {};
      if (!o.city) return Promise.resolve(null);   // filler needs a real city name
      return fetch(BASE + '/functions/v1/briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': ANON, 'Authorization': 'Bearer ' + ANON },
        // afterEvents → the hosts JUST covered real events here, so the server uses the
        // "bridge" opener instead of the "it's quiet in <city>" one (which would contradict it).
        body: JSON.stringify({ filler: true, city: o.city, lat: (o.lat != null ? o.lat : null), lon: (o.lon != null ? o.lon : null), lang: (o.lang || 'en').slice(0, 2), after_events: !!o.afterEvents })
      }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { return (j && j.segments && j.segments.length) ? { segments: j.segments, filler: true, music: j.music || 'between' } : null; })
        .catch(function () { return null; });
    },
    // WEATHER LINE — one spoken sentence about what it's doing outside, right now, where
    // the listener is looking. The clip carries no city name, so every city that is
    // "partly cloudy and 11 degrees" plays the same cached recording (see 31_briefing.ts).
    // opts: {lat,lon,lang} -> Promise<{segments:[{url,text,speaker}]}|null>
    getWeatherSeg: function (opts) {
      if (!ENABLED) return Promise.resolve(null);
      var o = opts || {};
      if (o.lat == null || o.lon == null) return Promise.resolve(null);
      return fetch(BASE + '/functions/v1/briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': ANON, 'Authorization': 'Bearer ' + ANON },
        body: JSON.stringify({ weather: true, lat: o.lat, lon: o.lon, lang: (o.lang || 'en').slice(0, 2) })
      }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { return (j && j.segments && j.segments.length) ? { segments: j.segments } : null; })
        .catch(function () { return null; });
    },
    // (Hover PRE-WARM was removed: it generated briefings for cities the pointer merely
    // passed over. Popular cities are now made each morning by 91_briefing_pregen.sql.)
    // ONE-TIME HOST INTRODUCTION — the hosts say their names ONCE per device, then every
    // briefing is name-free. We send the sig we last played (`have`); the server returns
    // {changed:false} (no synthesis) if the hosts/voices are unchanged, or {changed:true,
    // sig, segments} to introduce a new/renamed host once. Cached clip, reused globally.
    // -> Promise<{changed:boolean, sig:string|null, segments?:[{url,text}]}|null>
    getIntro: function (opts) {
      if (!ENABLED) return Promise.resolve(null);
      var o = opts || {};
      return fetch(BASE + '/functions/v1/briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': ANON, 'Authorization': 'Bearer ' + ANON },
        body: JSON.stringify({ intro: true, have: o.have || '', lang: (o.lang || 'en').slice(0, 2) })
      }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (!j) return null;
          return { changed: !!j.changed, sig: j.sig || null, segments: (j.segments && j.segments.length) ? j.segments : null };
        }).catch(function () { return null; });
    },
    // CITY-SWITCH TRANSITIONS — the generic bridge lines ("Let me pull up what's happening
    // right there.") played the instant a city is picked, while its briefing loads. The SAME
    // cached clips serve every city, so they're fetched once per language per page load and
    // their mp3s are pre-downloaded — a switch then plays with no server round trip.
    // A failed fetch isn't remembered, so the next switch tries again.
    // -> Promise<{ wait:[{url,text,speaker}], nearly:[…], ready:[…] }|null>
    //    wait = the patience lines; nearly = one follow-up for a slow load; ready = a quick
    //    lead-in when the briefing is already there (see aihost playConv).
    getTransitions: function (lang) {
      if (!ENABLED) return Promise.resolve(null);
      var l = (lang || 'en').slice(0, 2);
      if (_transitions[l]) return _transitions[l];
      var p = fetch(BASE + '/functions/v1/briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': ANON, 'Authorization': 'Bearer ' + ANON },
        body: JSON.stringify({ ident: true, lang: l })
      }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          var wait = (j && j.segments && j.segments.length) ? j.segments : ((j && j.url) ? [{ url: j.url, text: j.text || '' }] : null);
          if (!wait) { delete _transitions[l]; return null; }
          var set = { wait: wait, nearly: (j && j.nearly) || [], ready: (j && j.ready) || [] };
          // Warm the browser's HTTP cache so the <audio> element starts instantly (mobile too).
          wait.concat(set.nearly, set.ready).forEach(function (s) { try { fetch(s.url, { mode: 'no-cors' }).catch(function () {}); } catch (e) {} });
          return set;
        }).catch(function () { delete _transitions[l]; return null; });
      _transitions[l] = p;
      return p;
    },
    // FREE tier intro: cached ElevenLabs clips reused by ALL free users → near-zero
    // marginal cost. Assembled [count]+[upsell] on the first play (`full`), else a
    // short welcome-back. No login needed. opts: {part,lang,count,full}
    // -> Promise<{segments:[{url,text}]}|null>
    getFreeGreeting: function (opts) {
      if (!ENABLED) return Promise.resolve(null);
      var o = opts || {};
      return fetch(BASE + '/functions/v1/briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': ANON, 'Authorization': 'Bearer ' + ANON },
        body: JSON.stringify({ greeting: true, part: o.part || 'day', lang: (o.lang || 'en').slice(0, 2), count: o.count || 0, full: !!o.full })
      }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (j && j.segments && j.segments.length) return { segments: j.segments };
          if (j && j.url) return { segments: [{ url: j.url, text: j.text || '' }] };   // legacy single
          return null;
        }).catch(function () { return null; });
    },
    // SIGNATURE OPENING: the spoken brand welcome for the launch splash (played after
    // the sonic logo on first tap). FIXED lines with NO dynamic content — the live
    // count stays visual-only — so each clip is synthesized ONCE ever and cached for
    // every user. No login needed. opts: {lang, plus} (plus omits the upsell line).
    // -> Promise<{segments:[{url,text}]}|null>
    getOpening: function (opts) {
      if (!ENABLED) return Promise.resolve(null);
      var o = opts || {};
      return fetch(BASE + '/functions/v1/briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': ANON, 'Authorization': 'Bearer ' + ANON },
        body: JSON.stringify({ opening: true, lang: (o.lang || 'en').slice(0, 2), plus: !!o.plus })
      }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { return (j && j.segments && j.segments.length) ? { segments: j.segments } : null; })
        .catch(function () { return null; });
    },
    // The official "Welcome to Eventually…" clip on its own, for the AI Host's opening.
    // Reuses the `opening` mode: passing plus:true returns ONLY the welcome line (the
    // upsell is free-tier-only), which is exactly the single clip we want here — and
    // it's the SAME cached clip the launch splash uses, so there's no extra synthesis.
    // -> Promise<{url,text}|null>
    getWelcome: function (lang) {
      if (!ENABLED) return Promise.resolve(null);
      return fetch(BASE + '/functions/v1/briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': ANON, 'Authorization': 'Bearer ' + ANON },
        body: JSON.stringify({ opening: true, lang: (lang || 'en').slice(0, 2), plus: true })
      }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          var s = j && j.segments && j.segments[0];
          return (s && s.url) ? { url: s.url, text: s.text || '' } : null;
        }).catch(function () { return null; });
    },
    // Short, generic, cached ElevenLabs intro clip — played instantly at the start of
    // a Plus show while the full briefing synthesizes (keeps Premium all-ElevenLabs).
    // -> Promise<{url,text}|null>
    getStinger: function (lang) {
      if (!ENABLED) return Promise.resolve(null);
      return accessToken().then(function (tk) {
        if (!tk) return null;
        return fetch(BASE + '/functions/v1/briefing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': ANON, 'Authorization': 'Bearer ' + tk },
          body: JSON.stringify({ stinger: true, lang: (lang || 'en').slice(0, 2) })
        }).then(function (r) { return r.ok ? r.json() : null; })
          .then(function (j) { return (j && j.url) ? { url: j.url, text: j.text || '' } : null; });
      }).catch(function () { return null; });
    },
    // -> Promise<string|null> (audio URL, or null to use the browser voice)
    synthesize: function (text, lang) {
      if (!ENABLED || !text) return Promise.resolve(null);
      return accessToken().then(function (tk) {
        if (!tk) return null;                       // not signed in
        return fetch(BASE + '/functions/v1/host-tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': ANON, 'Authorization': 'Bearer ' + tk },
          body: JSON.stringify({ text: text, lang: (lang || 'en').slice(0, 2) })
        }).then(function (r) {
          if (!r.ok) {
            r.json().then(function (e) { console.warn('[HostVoice] host-tts ' + r.status, e); }).catch(function () { console.warn('[HostVoice] host-tts ' + r.status); });
            return null;
          }
          return r.json();
        }).then(function (j) { return (j && j.url) || null; });
      }).catch(function (e) { console.warn('[HostVoice] request failed', e && e.message); return null; });
    }
  };
})(window);

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
      return fetch(BASE + '/functions/v1/briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': ANON, 'Authorization': 'Bearer ' + ANON },
        body: JSON.stringify({ audio: true, city: o.city || null, lat: (o.lat != null ? o.lat : null), lon: (o.lon != null ? o.lon : null),
          lang: (o.lang || 'en').slice(0, 2), day: o.day || null, home_lat: (o.homeLat != null ? o.homeLat : null), home_lon: (o.homeLon != null ? o.homeLon : null),
          quick: !!o.quick })   // switch / pre-warm → short "headline" tier (fast synth)
      }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (j && j.segments && j.segments.length) return { segments: j.segments, text: j.text || '', twoHost: !!j.twoHost };
          return null;
        }).catch(function () { return null; });
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
    // Fire-and-forget PRE-WARM: generate + cache a city's briefing in the background so a
    // later tap is a ~2s cache hit instead of a 15-60s cold generation. Uses the SAME
    // params as the switch fetch (quick:true) so the cache key matches. Result ignored.
    prewarm: function (opts) {
      if (!ENABLED) return;
      var o = opts || {};
      try {
        fetch(BASE + '/functions/v1/briefing', {
          method: 'POST', keepalive: true,
          headers: { 'Content-Type': 'application/json', 'apikey': ANON, 'Authorization': 'Bearer ' + ANON },
          body: JSON.stringify({ audio: true, city: o.city || null, lat: (o.lat != null ? o.lat : null), lon: (o.lon != null ? o.lon : null),
            lang: (o.lang || 'en').slice(0, 2), home_lat: (o.homeLat != null ? o.homeLat : null), home_lon: (o.homeLon != null ? o.homeLon : null), quick: true })
        }).catch(function () {});
      } catch (e) {}
    },
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
    // SWITCH IDENT — a short cached per-city line ("let's head over to Toronto") played
    // INSTANTLY on a city switch to mask the briefing's generation latency. Cached per city.
    // -> Promise<{url,text}|null>
    getIdent: function (city, lang) {
      if (!ENABLED || !city) return Promise.resolve(null);
      return fetch(BASE + '/functions/v1/briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': ANON, 'Authorization': 'Bearer ' + ANON },
        body: JSON.stringify({ ident: true, city: city, lang: (lang || 'en').slice(0, 2) })
      }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { return (j && j.url) ? { url: j.url, text: j.text || '' } : null; })
        .catch(function () { return null; });
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

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
            interests: o.interests || [], saved: o.saved || 0    // personalized concierge tails
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

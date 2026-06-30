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
    // Shared, cached city briefing (the cost-optimized path).
    // -> Promise<{url, text}|null>
    getBriefing: function (city, lang) {
      if (!ENABLED) return Promise.resolve(null);
      return accessToken().then(function (tk) {
        if (!tk) return null;
        return fetch(BASE + '/functions/v1/host-briefing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': ANON, 'Authorization': 'Bearer ' + tk },
          body: JSON.stringify({ city: city || null, lang: (lang || 'en').slice(0, 2) })
        }).then(function (r) {
          if (!r.ok) { r.json().then(function (e) { console.warn('[HostVoice] host-briefing ' + r.status, e); }).catch(function () {}); return null; }
          return r.json();
        }).then(function (j) { return (j && j.url) ? { url: j.url, text: j.text || '' } : null; });
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

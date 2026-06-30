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

  function accessToken() {
    const A = global.EventuallyAuth;
    if (!A || !A.client) return Promise.resolve(null);
    return A.client.auth.getSession()
      .then(function (r) { return (r && r.data && r.data.session && r.data.session.access_token) || null; })
      .catch(function () { return null; });
  }

  global.EventuallyHostVoice = {
    enabled: ENABLED,
    // -> Promise<string|null> (audio URL, or null to use the browser voice)
    synthesize: function (text, lang) {
      if (!ENABLED || !text) return Promise.resolve(null);
      return accessToken().then(function (tk) {
        if (!tk) return null;                       // not signed in
        return fetch(BASE + '/functions/v1/host-tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': ANON, 'Authorization': 'Bearer ' + tk },
          body: JSON.stringify({ text: text, lang: (lang || 'en').slice(0, 2) })
        }).then(function (r) { return r.ok ? r.json() : null; })
          .then(function (j) { return (j && j.url) || null; });
      }).catch(function () { return null; });
    }
  };
})(window);

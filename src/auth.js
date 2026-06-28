/* Eventually — accounts (Supabase Auth).
 *
 * Wraps the Supabase JS client for real sign-in (email magic link + Google) and
 * per-user data (profile + saved/liked/attended). Dormant + safe: if the config
 * is blank OR the supabase-js CDN didn't load, `enabled` is false and app.js
 * falls back to the existing anonymous/mock flow. No secrets here — the anon key
 * is public and every table is row-level-security protected.
 */
(function (global) {
  'use strict';

  const cfg = global.EVENTUALLY_CONFIG || {};
  const URL = (cfg.supabaseUrl || '').replace(/\/+$/, '');
  const KEY = cfg.supabaseAnonKey || '';
  const hasLib = !!(global.supabase && global.supabase.createClient);
  const ENABLED = !!(URL && KEY && hasLib);

  let sb = null;
  let currentUser = null;
  const listeners = [];

  if (ENABLED) {
    sb = global.supabase.createClient(URL, KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  } else if (URL && KEY && !hasLib) {
    console.warn('[EventuallyAuth] supabase-js not loaded — sign-in disabled, app stays anonymous.');
  }

  function emit(u) { currentUser = u; listeners.forEach(function (cb) { try { cb(u); } catch (e) { console.error(e); } }); }
  function redirectTo() { return location.origin + location.pathname; }

  const api = {
    enabled: ENABLED,
    client: sb,
    user: function () { return currentUser; },
    onChange: function (cb) { if (typeof cb === 'function') { listeners.push(cb); if (currentUser !== null) cb(currentUser); } },

    signInWithEmail: function (email) {
      return sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: redirectTo() } });
    },
    signInWithGoogle: function () {
      return sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirectTo() } });
    },
    signOut: function () { return sb.auth.signOut(); },

    // ---- account data ----
    getProfile: function () {
      if (!currentUser) return Promise.resolve(null);
      return sb.from('profiles').select('*').eq('id', currentUser.id).maybeSingle()
        .then(function (r) { return r.data || null; });
    },
    saveProfile: function (patch) {
      if (!currentUser) return Promise.resolve();
      return sb.from('profiles').update(patch).eq('id', currentUser.id);
    },
    listUserEvents: function () {
      if (!currentUser) return Promise.resolve([]);
      return sb.from('user_events').select('*').eq('user_id', currentUser.id)
        .then(function (r) { return r.data || []; });
    },
    setUserEvent: function (action, eventId, snapshot, on) {
      if (!currentUser) return Promise.resolve();
      if (on) {
        return sb.from('user_events').upsert(
          { user_id: currentUser.id, event_id: eventId, action: action, snapshot: snapshot || null },
          { onConflict: 'user_id,event_id,action' }
        );
      }
      return sb.from('user_events').delete()
        .match({ user_id: currentUser.id, event_id: eventId, action: action });
    }
  };

  if (ENABLED) {
    sb.auth.getSession().then(function (r) { emit(r.data.session ? r.data.session.user : null); });
    sb.auth.onAuthStateChange(function (_evt, session) { emit(session ? session.user : null); });
  }

  global.EventuallyAuth = api;
})(window);

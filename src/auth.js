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
  function logErr(tag) { return function (r) { if (r && r.error) console.warn('[EventuallyAuth] ' + tag + ' failed: ' + r.error.message); return r; }; }

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

    // Change the account's LOGIN email. Supabase sends a confirmation link to the
    // new (and old) address; the change only takes effect once confirmed. Fails
    // for Google-managed identities (the UI shows those read-only). Returns the
    // supabase-js result ({ data, error }).
    updateEmail: function (email) {
      if (!currentUser) return Promise.resolve({ error: { message: 'Not signed in' } });
      return sb.auth.updateUser({ email: email }, { emailRedirectTo: redirectTo() })
        .then(logErr('updateEmail'));
    },

    // ---- identity linking (so Google + email open one account) ----
    // List the providers currently attached to the signed-in account.
    listIdentities: function () {
      if (!sb.auth.getUserIdentities) return Promise.resolve([]);
      return sb.auth.getUserIdentities()
        .then(function (r) { return (r && r.data && r.data.identities) || []; })
        .catch(function () { return []; });
    },
    // Attach Google to the current account (requires Manual Linking enabled in Supabase).
    linkGoogle: function () {
      if (!sb.auth.linkIdentity) return Promise.resolve({ error: { message: 'Linking not supported' } });
      return sb.auth.linkIdentity({ provider: 'google', options: { redirectTo: redirectTo() } });
    },

    // ---- account data ----
    getProfile: function () {
      if (!currentUser) return Promise.resolve(null);
      return sb.from('profiles').select('*').eq('id', currentUser.id).maybeSingle()
        .then(function (r) { return r.data || null; });
    },
    saveProfile: function (patch) {
      if (!currentUser) return Promise.resolve();
      return sb.from('profiles').update(patch).eq('id', currentUser.id).then(logErr('saveProfile'));
    },
    listUserEvents: function () {
      if (!currentUser) return Promise.resolve([]);
      return sb.from('user_events').select('*').eq('user_id', currentUser.id)
        .then(function (r) { return r.data || []; });
    },
    // Publish a native (coordinator) event to the globe, attributed to this user.
    // Writes the events row then its native event_sources row. RLS-gated.
    publishEvent: function (evt) {
      if (!currentUser) return Promise.resolve({ error: { message: 'Not signed in' } });
      const srcId = 'natsrc_' + evt.id;
      const row = {
        event_id: evt.id, title: evt.name, description: evt.description || null,
        category: evt.category, start_time: evt.date.toISOString(),
        city: evt.city || null, country: evt.country || null, lat: evt.lat, lon: evt.lon,
        // When billing is live, featuring is granted server-side only (free quota
        // RPC or paid webhook) — never trust the client to self-feature.
        display_source: 'native', is_native: true, published: true,
        sponsored: (global.EventuallyBilling && global.EventuallyBilling.enabled) ? false : !!evt.sponsored,
        popularity: 0.4, image_url: null, source_count: 1,
        cheapest_source_id: null, created_by: currentUser.id
      };
      return sb.from('events').insert(row).then(logErr('publishEvent')).then(function (r) {
        if (r && r.error) return r;
        return sb.from('event_sources').insert({
          source_id: srcId, event_id: evt.id, source: 'native',
          url: evt.ticketUrl || null, price: null, currency: null,
          organizer: (currentUser.email ? currentUser.email.split('@')[0] : 'Eventually'),
          badge: '', last_updated: new Date().toISOString()
        }).then(logErr('publishEvent source'));
      });
    },
    myEvents: function () {
      if (!currentUser) return Promise.resolve([]);
      return sb.rpc('my_events').then(function (r) { return (r && r.data) || []; });
    },
    // ---- creator tools: edit / unpublish / delete + per-event stats ----
    updateEvent: function (evt) {
      if (!currentUser) return Promise.resolve({ error: { message: 'Not signed in' } });
      return sb.from('events').update({
        title: evt.name, description: evt.description || null, category: evt.category,
        start_time: evt.date.toISOString(), city: evt.city || null, lat: evt.lat, lon: evt.lon
      }).eq('event_id', evt.id).eq('created_by', currentUser.id).then(logErr('updateEvent')).then(function (r) {
        if (r && r.error) return r;
        return sb.from('event_sources').update({ url: evt.ticketUrl || null, last_updated: new Date().toISOString() })
          .eq('event_id', evt.id).then(logErr('updateEvent source'));
      });
    },
    deleteEvent: function (eventId) {
      if (!currentUser) return Promise.resolve({ error: { message: 'Not signed in' } });
      return sb.from('events').delete().eq('event_id', eventId).eq('created_by', currentUser.id).then(logErr('deleteEvent'));
    },
    setPublished: function (eventId, on) {
      if (!currentUser) return Promise.resolve();
      return sb.from('events').update({ published: !!on }).eq('event_id', eventId).eq('created_by', currentUser.id).then(logErr('setPublished'));
    },
    creatorStats: function () {
      if (!currentUser) return Promise.resolve([]);
      return sb.rpc('creator_event_stats').then(function (r) { return (r && r.data) || []; });
    },
    // ---- admin moderation ----
    pendingEvents: function () {
      if (!currentUser) return Promise.resolve([]);
      return sb.rpc('pending_events').then(function (r) { return (r && r.data) || []; });
    },
    moderateEvent: function (eventId, status, reason) {
      if (!currentUser) return Promise.resolve({ error: { message: 'Not signed in' } });
      return sb.rpc('moderate_event', { p_id: eventId, p_status: status, p_reason: reason || null })
        .then(function (r) { return (r && r.data) || (r && { error: r.error }); });
    },
    // Try to feature an event using the Plus monthly free quota (server-checked).
    // Returns { ok, remaining } or { ok:false, reason }.
    claimFreeFeature: function (eventId) {
      if (!currentUser) return Promise.resolve({ ok: false, reason: 'not_signed_in' });
      const quota = (global.EventuallyBilling && global.EventuallyBilling.freeFeaturesPerMonth) || 3;
      return sb.rpc('claim_free_feature', { p_event_id: eventId, p_quota: quota })
        .then(function (r) { return (r && r.data) || { ok: false, reason: (r && r.error && r.error.message) || 'error' }; });
    },

    setUserEvent: function (action, eventId, snapshot, on) {
      if (!currentUser) return Promise.resolve();
      if (on) {
        return sb.from('user_events').upsert(
          { user_id: currentUser.id, event_id: eventId, action: action, snapshot: snapshot || null },
          { onConflict: 'user_id,event_id,action' }
        ).then(logErr('setUserEvent ' + action));
      }
      return sb.from('user_events').delete()
        .match({ user_id: currentUser.id, event_id: eventId, action: action })
        .then(logErr('removeUserEvent ' + action));
    }
  };

  if (ENABLED) {
    sb.auth.getSession().then(function (r) { emit(r.data.session ? r.data.session.user : null); });
    sb.auth.onAuthStateChange(function (_evt, session) { emit(session ? session.user : null); });
  }

  global.EventuallyAuth = api;
})(window);

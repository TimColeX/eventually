/* Eventually — personalization store (frontend only, localStorage).
 * Learns location, interests, saved events, searches and attended events so the
 * AI Host can personalize. No backend; everything lives in the browser. */
(function (global) {
  'use strict';

  const KEY = 'eventually.profile.v1';
  const defaults = {
    name: null,
    phone: null,           // contact phone
    contactEmail: null,    // preferred contact email (separate from login email)
    address: null,         // { line1, line2, city, region, postcode, country, lat, lon }
    comms: {},             // { reminders, marketing, sms } opt-ins
    location: null,        // { city, lat, lon, source:'gps'|'manual' }
    interests: [],         // explicit category interests
    saved: [],             // saved event ids
    savedSnap: {},         // id -> lightweight snapshot {id,name,city,date,category,categoryColor,priceLabel,lat,lon,venue,endsAt}
    searches: [],          // recent search strings
    attended: [],          // event ids marked attended
    /* Every city this visitor has saved or attended something in, as { "regina|canada":
       firstSeenMs }. The Passport's CITIES EXPLORED counts these.
       🔑 WHY A SEPARATE RECORD INSTEAD OF COUNTING `saved`: saved events are AUTO-PRUNED
       once they finish (see pruneSaved), so a count derived from them goes DOWN over
       time. A passport whose stamp count falls is worse than no number at all — where
       you have been does not stop having happened. This only ever grows.
       ℹ️ On a new device it rebuilds itself: `saved` and `attended` sync through
       `user_events`, and noteCity runs again as those come back. */
    citiesSeen: {},
    plus: false,           // Eventually Plus member
    notify: false,         // web notifications enabled
    language: 'en'         // Host language (default English)
  };

  function load() {
    try { return Object.assign({}, defaults, JSON.parse(localStorage.getItem(KEY) || '{}')); }
    catch (e) { return Object.assign({}, defaults); }
  }
  let state = load();
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }

  const api = {
    get: function () { return state; },
    set: function (patch) { Object.assign(state, patch); persist(); },

    setName: function (n) { state.name = n; persist(); },
    setLocation: function (loc) { state.location = loc; persist(); },
    setPlus: function (b) { state.plus = !!b; persist(); },
    setNotify: function (b) { state.notify = !!b; persist(); },

    toggleSaved: function (id, snap) {
      if (!state.savedSnap) state.savedSnap = {};
      const i = state.saved.indexOf(id);
      if (i > -1) { state.saved.splice(i, 1); delete state.savedSnap[id]; }
      else { state.saved.push(id); if (snap) state.savedSnap[id] = snap; }
      persist(); return state.saved.indexOf(id) > -1;
    },
    isSaved: function (id) { return state.saved.indexOf(id) > -1; },

    /* ---- Cities, for the Passport ----
       Keyed on city + country so London UK and London Ontario are two stamps, the same
       distinction the search dropdown had to learn (see `regionOf` in app.js). Call it
       with whatever is to hand; it ignores blanks and never records the same place
       twice. First-seen time is kept because a passport is a chronology — it is what a
       "stamps in order" view would need, and it costs nothing to store now. */
    noteCity: function (city, country) {
      const c = String(city || '').trim();
      if (!c) return false;
      if (!state.citiesSeen) state.citiesSeen = {};
      const k = c.toLowerCase() + '|' + String(country || '').trim().toLowerCase();
      if (state.citiesSeen[k]) return false;
      state.citiesSeen[k] = Date.now();
      persist(); return true;
    },
    citiesSeen: function () { return state.citiesSeen || {}; },
    cityCount: function () { return Object.keys(state.citiesSeen || {}).length; },
    // Attach/refresh the snapshot for an already-saved event (so it survives data reloads).
    saveSnap: function (id, snap) { if (!state.savedSnap) state.savedSnap = {}; if (snap && state.saved.indexOf(id) > -1) { state.savedSnap[id] = snap; persist(); } },
    savedSnaps: function () { return state.savedSnap || {}; },
    // Remove one saved event outright (id + snapshot).
    removeSaved: function (id) {
      const i = state.saved.indexOf(id); if (i > -1) state.saved.splice(i, 1);
      if (state.savedSnap) delete state.savedSnap[id];
      persist(); return i > -1;
    },
    // Bulk-remove (used by auto-prune of past / ghost events). Returns how many were removed.
    removeSavedMany: function (ids) {
      if (!ids || !ids.length) return 0;
      let n = 0; ids.forEach(function (id) { const i = state.saved.indexOf(id); if (i > -1) { state.saved.splice(i, 1); n++; } if (state.savedSnap) delete state.savedSnap[id]; });
      if (n) persist(); return n;
    },

    toggleInterest: function (cat) {
      const i = state.interests.indexOf(cat);
      if (i > -1) state.interests.splice(i, 1); else state.interests.push(cat);
      persist(); return state.interests.indexOf(cat) > -1;
    },
    hasInterest: function (cat) { return state.interests.indexOf(cat) > -1; },

    addSearch: function (q) {
      q = (q || '').trim(); if (!q) return;
      state.searches = [q].concat(state.searches.filter(function (s) { return s !== q; })).slice(0, 20);
      persist();
    },
    markAttended: function (id) { if (state.attended.indexOf(id) < 0) { state.attended.push(id); persist(); } },

    // Interests to personalize with: explicit, else inferred from saved/attended categories.
    effectiveInterests: function (getById) {
      if (state.interests.length) return state.interests.slice();
      const counts = {};
      state.saved.concat(state.attended).forEach(function (id) {
        const e = getById(id); if (e) counts[e.category] = (counts[e.category] || 0) + 1;
      });
      return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
    },

    // Ask the browser for a location; falls back via callback(null) if denied.
    detectLocation: function (cb) {
      if (!navigator.geolocation) { cb(null); return; }
      navigator.geolocation.getCurrentPosition(
        function (pos) { cb({ lat: pos.coords.latitude, lon: pos.coords.longitude, source: 'gps' }); },
        function () { cb(null); },
        { timeout: 8000, maximumAge: 600000 }
      );
    }
  };

  global.EventuallyProfile = api;
})(window);

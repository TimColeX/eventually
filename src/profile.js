/* Eventually — personalization store (frontend only, localStorage).
 * Learns location, interests, saved events, searches and attended events so the
 * AI Host can personalize. No backend; everything lives in the browser. */
(function (global) {
  'use strict';

  const KEY = 'eventually.profile.v1';
  const defaults = {
    name: null,
    location: null,        // { city, lat, lon, source:'gps'|'manual' }
    interests: [],         // explicit category interests
    saved: [],             // saved event ids
    searches: [],          // recent search strings
    attended: [],          // event ids marked attended
    plus: false,           // Eventually Plus member
    notify: false          // web notifications enabled
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

    toggleSaved: function (id) {
      const i = state.saved.indexOf(id);
      if (i > -1) state.saved.splice(i, 1); else state.saved.push(id);
      persist(); return state.saved.indexOf(id) > -1;
    },
    isSaved: function (id) { return state.saved.indexOf(id) > -1; },

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

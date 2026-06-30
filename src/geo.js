/* Eventually — shared geocoding (OpenStreetMap Nominatim, free, no key, CORS-ok).
 * Used by the profile "City" field and the coordinator address autocomplete.
 * Fair-use: keep calls light (debounced/manual). Move server-side if volume grows
 * (browsers can't set a custom User-Agent). */
(function (global) {
  'use strict';

  function nom(url) {
    return fetch(url, { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; });
  }
  function shortPlace(a) {
    if (!a) return null;
    return a.city || a.town || a.village || a.municipality || a.county || a.state || a.country || null;
  }
  function toResult(r) {
    return { lat: +r.lat, lon: +r.lon, city: shortPlace(r.address) || (r.display_name || '').split(',')[0], label: r.display_name || '' };
  }

  global.EventuallyGeo = {
    // type-ahead suggestions (array, best first)
    search: function (q, limit) {
      if (!q || !q.trim()) return Promise.resolve([]);
      return nom('https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=' +
        (limit || 5) + '&q=' + encodeURIComponent(q))
        .then(function (arr) { return (arr || []).map(toResult); });
    },
    forward: function (q) { return this.search(q, 1).then(function (a) { return a[0] || null; }); },
    reverse: function (lat, lon) {
      return nom('https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&lat=' + lat + '&lon=' + lon)
        .then(function (j) {
          return j && j.address
            ? { lat: lat, lon: lon, city: shortPlace(j.address) || (j.display_name || '').split(',')[0], label: j.display_name || '' }
            : null;
        });
    }
  };
})(window);

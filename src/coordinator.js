/* Eventually — Event Coordinator portal.
 * Publish events to the globe, drop a pin to geolocate, view engagement analytics.
 */
(function (global) {
  'use strict';

  // Reuse the globe's land ellipses for a flat mini-map (equirectangular).
  const LAND = [
    [-100,54,34,17],[-105,40,24,12],[-90,30,14,9],[-150,63,13,8],[-83,14,9,6],
    [-42,73,17,9],[-60,-8,18,16],[-64,-30,11,13],[-70,-46,5,9],
    [15,54,23,11],[5,45,14,7],[18,6,22,20],[25,-16,16,17],[45,6,8,8],
    [90,58,58,18],[100,38,38,14],[78,23,13,12],[46,36,15,10],[108,16,13,10],
    [120,-2,18,7],[142,-5,8,6],[134,-25,21,13],[172,-42,5,8],[138,38,6,8]
  ];
  function isLand(lat, lon) {
    if (lat < -78) return true;
    for (const s of LAND) {
      let dlon = Math.abs(lon - s[0]); if (dlon > 180) dlon = 360 - dlon;
      const a = dlon / s[2], b = (lat - s[1]) / s[3];
      if (a * a + b * b <= 1) return true;
    }
    return false;
  }

  // Geocoding is the shared EventuallyGeo util (OpenStreetMap Nominatim).
  const Geo = global.EventuallyGeo;

  function Coordinator(el, opts) {
    this.el = el;
    this.onPublish = opts.onPublish;       // (eventObj) -> Promise<bool>
    this.onUpdate = opts.onUpdate;         // (eventObj) -> Promise<bool>  (edit existing)
    this.onDelete = opts.onDelete;         // (eventId) -> Promise<bool>
    this.onSetPublished = opts.onSetPublished; // (eventId, bool) -> Promise
    this.getQuota = opts.getQuota || null;     // () -> Promise<publishing_quota jsonb|null>
    this.getCreatorStats = opts.getCreatorStats; // () -> Promise<[{event_id,title,...,saves,likes,attends,published}]>
    this.getDefaultLocation = opts.getDefaultLocation; // () -> {lat,lon,city}|null (user's set location)
    this.onFlyTo = opts.onFlyTo;           // (lat, lon) -> void
    this.getMyEvents = opts.getMyEvents;   // () -> [events]  (demo fallback)
    this.pin = { lat: 48.85, lon: 2.35 };  // default Paris
    this.city = null;                       // resolved place name (geocoded)
    this.editId = null;                     // set when editing an existing event
    this.locationChosen = false;            // a real location must be picked before publishing
    this._build();
  }

  Coordinator.prototype.open = function () {
    this.el.classList.add('open');
    if (!this.editId && !this.locationChosen) this._applyDefaultLocation();   // start on the user's location
    // Canvas has no size until the modal is visible → draw on the next frame.
    const self = this;
    requestAnimationFrame(function () { self._drawMap(); });
    this._refreshQuota();
  };
  // Show the remaining allowance ("3 of 10 posts used this year") in the header. Purely
  // informational — the limit itself is enforced by the database on insert, so a stale
  // or missing number here can never let someone over the line.
  Coordinator.prototype._refreshQuota = function () {
    const el = this.el.querySelector('.co-quota');
    if (!el || !this.getQuota) return;
    const self = this;
    Promise.resolve(this.getQuota()).then(function (q) {
      if (!q || q.error || q.enabled === false || q.unlimited) { el.hidden = true; return; }
      const used = +q.used || 0, cap = +q.capacity || 0, left = Math.max(0, cap - used);
      el.textContent = used + ' of ' + cap + ' posts used this year' + (left === 0 ? ' — limit reached' : '');
      el.className = 'co-quota' + (left === 0 ? ' is-full' : (left <= 2 ? ' is-low' : ''));
      el.hidden = false;
      if (self.editId) el.hidden = true;      // editing an existing event doesn't use a slot
    }, function () { el.hidden = true; });
  };
  Coordinator.prototype.close = function () { this.el.classList.remove('open'); };

  // Pre-fill the pin with the user's set location (counts as "chosen"). Otherwise
  // leave the neutral default and require an explicit pick before publishing.
  Coordinator.prototype._applyDefaultLocation = function () {
    const d = this.getDefaultLocation && this.getDefaultLocation();
    if (d && d.lat != null) { this.pin = { lat: d.lat, lon: d.lon }; this.city = d.city || null; this.locationChosen = true; }
    else { this.locationChosen = false; }
  };

  Coordinator.prototype._build = function () {
    const self = this;
    const cats = Object.keys(global.EventuallyData.CATEGORIES).map(function (c) { return '<option>' + c + '</option>'; }).join('');
    this.el.innerHTML =
      '<div class="co-backdrop"></div>' +
      '<div class="co-modal">' +
        '<header class="co-head">' +
          '<div><span class="co-kicker">Publish an Event</span>' +
          '<h2 class="co-form-h">Publish to the globe</h2>' +
          // Filled in by _refreshQuota() once the server answers; hidden until then so
          // an offline/demo session never shows an empty or wrong allowance.
          '<span class="co-quota" hidden></span></div>' +
          '<button class="co-close" aria-label="Close">✕</button>' +
        '</header>' +
        '<div class="co-body"><div class="co-cols">' +
          '<div class="co-col co-col-main">' +
            '<label>Event name<input class="f-name" placeholder="Midnight Rooftop Sessions"></label>' +
            '<div class="co-row co-row-2">' +
              '<label>Category<select class="f-cat">' + cats + '</select></label>' +
              // Was collected and silently discarded for months — there was no
              // column for it. Now stored, and required, because "Abuja" is not
              // somewhere a person can turn up to.
              // Placeholders describe the field; they never show a sample value. A
              // made-up address or venue can be someone's real one, and a grey
              // sample reads as already filled in.
              '<label>Venue<input class="f-venue" placeholder="Venue name"></label>' +
            '</div>' +
            '<label>Address <span class="co-opt">(filled in from the map — edit if needed)</span>' +
              '<input class="f-address" placeholder="Street address, city"></label>' +
            '<label>Date<input type="date" class="f-date"></label>' +
            '<div class="co-row co-row-2">' +
              '<label>Start<input type="time" class="f-time" value="19:00"></label>' +
              '<label>End <span class="co-opt">(optional)</span><input type="time" class="f-endtime"></label>' +
            '</div>' +
            // The times above are wall-clock AT THE VENUE. Without this the
            // browser silently applied the organiser's own zone, so a 7 p.m.
            // Abuja event published from Canada was stored as 2 a.m. Abuja.
            '<label class="co-tz-l">Time zone of the venue' +
              '<select class="f-tz"></select></label>' +
            '<p class="co-tz-note" aria-live="polite"></p>' +
            '<label>Description<textarea class="f-desc" rows="3" placeholder="Tell people what to expect…"></textarea></label>' +
            // How people get in. Previously one optional URL box, which left the
            // commonest native case — a free talk with no ticketing at all —
            // with no way for anyone to say they were coming. Now it's a choice,
            // and "Eventually handles it" is a real door list, not a dead button.
            '<fieldset class="co-reg">' +
              '<legend>How do people get in?</legend>' +
              '<label class="co-reg-opt"><input type="radio" name="co-reg" class="f-reg-link" value="link" checked>' +
                '<span><b>They book somewhere else</b><small>A ticket page or your own website — we send people there.</small></span></label>' +
              // example.com is reserved for documentation (RFC 2606) — it can never
              // be anyone's real site, so it is the only safe sample URL.
              '<label class="co-reg-url">Booking link<input class="f-url" placeholder="https://example.com/tickets"></label>' +
              '<label class="co-reg-opt"><input type="radio" name="co-reg" class="f-reg-eventually" value="eventually">' +
                '<span><b>Eventually collects registrations</b><small>People register here with one tap. You get their name and email as a list you can download.</small></span></label>' +
              '<label class="co-reg-cap" hidden>Limit places <span class="co-opt">(optional)</span>' +
                '<input type="number" class="f-capacity" min="1" step="1" placeholder="e.g. 80"></label>' +
              '<label class="co-reg-opt"><input type="radio" name="co-reg" class="f-reg-none" value="none">' +
                '<span><b>Nothing needed — just turn up</b><small>Free and open. People can still save it and say they\'re going.</small></span></label>' +
            '</fieldset>' +
          '</div>' +
          '<div class="co-col co-col-side">' +
            '<div class="co-loc">' +
              '<div class="co-card-h">Location · search or drop a pin</div>' +
              '<div class="co-search"><input class="f-addr" placeholder="Search address or city…" autocomplete="off"><div class="co-suggest"></div></div>' +
              '<canvas class="map-canvas"></canvas>' +
              '<div class="co-coords">' +
                '<div class="co-place">📍 <strong class="ll-city">—</strong></div>' +
                '<div class="latlon">lat <strong class="ll-lat"></strong> · lon <strong class="ll-lon"></strong></div>' +
              '</div>' +
            '</div>' +
            '<div class="co-catcolor"><span class="co-catdot"></span>' +
              '<span class="co-catcolor-t">Shows in the <b class="co-catname">Music</b> colour on the globe &amp; card — set automatically by category.</span></div>' +
            '<label class="co-feature"><input type="checkbox" class="f-feature">' +
              '<span class="co-feature-txt"><b>✦ Ask us to feature this event</b>' +
              '<small>Premium placement — a distinct highlight, a guaranteed spike, and top of search. We review requests by hand; featuring is free while we are in beta.</small></span>' +
            '</label>' +
          '</div>' +
        '</div></div>' +
        '<div class="co-foot">' +
          '<button class="co-cancel-edit" type="button" style="display:none">Cancel edit</button>' +
          '<button class="co-publish">Publish event ✦</button>' +
          // Surface the live-updates benefit where it is most persuasive — at the
          // moment someone is deciding to publish here rather than only elsewhere.
          '<p class="co-perk"><b>Included:</b> while your event is on, post live updates to everyone viewing it — doors, parking, running late. Opens an hour before, disappears when it ends.</p>' +
          '<p class="co-note">Your event is geo-located and published live to the globe.</p>' +
        '</div>' +
      '</div>';

    // The event colour is AUTOMATIC — derived from the category (same colour the spike uses).
    // We just preview it so the publisher sees what they'll get; no manual choice.
    const catSel = this.el.querySelector('.f-cat');
    const catDot = this.el.querySelector('.co-catdot');
    const catName = this.el.querySelector('.co-catname');
    function syncCatColor() {
      const cat = catSel.value, col = global.EventuallyData.CATEGORIES[cat] || '#CB5A3C';
      if (catDot) catDot.style.background = col;
      if (catName) catName.textContent = cat;
    }
    catSel.addEventListener('change', syncCatColor);
    syncCatColor();

    // Only ever show the field belonging to the chosen entry method — the URL box
    // under "book elsewhere", the places limit under "Eventually collects".
    Array.prototype.forEach.call(this.el.querySelectorAll('input[name="co-reg"]'), function (r) {
      r.addEventListener('change', function () { self._syncRegMode(); });
    });
    this._syncRegMode();

    // Time zone: default to the organiser's own until a place says otherwise.
    const TZ = global.EventuallyTZ;
    if (TZ) {
      this.timezone = this.timezone || TZ.local;
      this._tzSure = true;                 // publishing at home is the common case
      this._fillTzOptions(null);
      const tzSel = this.el.querySelector('.f-tz');
      tzSel.addEventListener('change', function () {
        self.timezone = tzSel.value;
        self._tzTouched = true;            // never overwrite a deliberate choice
        self._syncTzNote();
      });
      // The confirmation line has to track the date and time boxes too, or it
      // reassures the organiser about a time they've since changed.
      ['.f-date', '.f-time'].forEach(function (s) {
        const el = self.el.querySelector(s);
        if (el) el.addEventListener('change', function () { self._syncTzNote(); });
      });
    }

    // Default the date to today; allow today .. +60 days (the forward window).
    const dateEl = this.el.querySelector('.f-date');
    const t = global.EventuallyData.TODAY;
    const fmt = function (d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    const maxD = new Date(t); maxD.setDate(maxD.getDate() + 60);
    dateEl.value = fmt(t); dateEl.min = fmt(t); dateEl.max = fmt(maxD);

    this.el.querySelector('.co-close').addEventListener('click', function () { self.close(); });
    this.el.querySelector('.co-backdrop').addEventListener('click', function () { self.close(); });
    this.mapCanvas = this.el.querySelector('.map-canvas');
    this.mapCanvas.addEventListener('click', function (e) {
      const r = self.mapCanvas.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      self.pin.lon = x * 360 - 180;
      self.pin.lat = 90 - y * 180;
      self.city = null;
      self.locationChosen = true;           // dropping a pin counts as choosing a location
      var m0 = self.el.querySelector('.co-loc'); if (m0) m0.classList.remove('co-need-loc');
      self._drawMap();
      // name the dropped pin (best-effort reverse geocode)
      const at = { lat: self.pin.lat, lon: self.pin.lon };
      if (Geo) Geo.reverse(at.lat, at.lon).then(function (res) {
        if (res && self.pin.lat === at.lat && self.pin.lon === at.lon) {
          self.city = res.city; self._adoptPlace(res); self._drawMap();
        }
      }).catch(function () {});
    });

    // Address autocomplete: type-ahead suggestions; pick one to drop the pin
    // (still adjustable by clicking the map). Enter picks the top suggestion.
    const addr = this.el.querySelector('.f-addr');
    const suggest = this.el.querySelector('.co-suggest');
    let acTimer = null, acResults = [];
    function hideSuggest() { suggest.classList.remove('show'); suggest.innerHTML = ''; acResults = []; }
    function pick(res) {
      self.pin.lat = res.lat; self.pin.lon = res.lon; self.city = res.city;
      self.locationChosen = true;           // picking a searched address counts
      self._adoptPlace(res);
      var m1 = self.el.querySelector('.co-loc'); if (m1) m1.classList.remove('co-need-loc');
      addr.value = res.city || (res.label || '').split(',')[0];
      hideSuggest(); self._drawMap();
      self._toast('📍 ' + (res.city || 'Location set'));
    }
    function renderSuggest() {
      if (!acResults.length) { hideSuggest(); return; }
      suggest.innerHTML = acResults.map(function (r, i) {
        return '<button type="button" class="co-sug" data-i="' + i + '">📍 ' + esc(r.label || r.city) + '</button>';
      }).join('');
      suggest.classList.add('show');
    }
    addr.addEventListener('input', function () {
      const q = addr.value.trim();
      clearTimeout(acTimer);
      if (q.length < 3 || !Geo) { hideSuggest(); return; }
      acTimer = setTimeout(function () {
        Geo.search(q, 5).then(function (rs) { acResults = rs || []; renderSuggest(); }).catch(hideSuggest);
      }, 350);   // debounce (respects Nominatim fair-use)
    });
    addr.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); if (acResults[0]) pick(acResults[0]); }
      else if (e.key === 'Escape') hideSuggest();
    });
    suggest.addEventListener('click', function (e) {
      const b = e.target.closest('[data-i]'); if (!b) return;
      const r = acResults[+b.dataset.i]; if (r) pick(r);
    });
    document.addEventListener('click', function (e) { if (!e.target.closest('.co-search')) hideSuggest(); });

    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m]; }); }

    this.el.querySelector('.co-publish').addEventListener('click', function () {
      self._publish();
    });
    this.el.querySelector('.co-cancel-edit').addEventListener('click', function () { self._resetForm(); });
  };

  // "My Events" — mounted into a SEPARATE modal (its own ⋯-menu item). Renders the manage
  // list + engagement, and wires edit / publish-toggle / delete. `closeFn` closes that modal
  // so "Edit" can hand off to the Create modal.
  Coordinator.prototype.mountMyEvents = function (container, closeFn) {
    const self = this;
    this._meClose = closeFn || function () {};
    container.innerHTML = '<div class="an-body"></div>';
    const body = container.querySelector('.an-body');
    this._renderAnalyticsInto(body);
    container.addEventListener('click', function (e) {
      const b = e.target.closest('[data-me-act]'); if (!b) return;
      const id = b.dataset.id, act = b.dataset.meAct;
      const ev = (self._myEvents || []).find(function (x) { return x.event_id === id; });
      if (act === 'edit') { if (ev) { self._meClose(); self.open(); self._editEvent(ev); } }
      else if (act === 'toggle') {
        const on = !(ev && ev.published !== false);
        // Taking a listing off the globe is reversible and does NOT return the posting
        // slot it used — say so plainly rather than letting people discover it later.
        if (!on && !confirm('Remove "' + (ev ? ev.title : 'this event') + '" from the globe?\n\nYou can put it back at any time. This does not return the posting slot it used.')) return;
        if (self.onSetPublished) Promise.resolve(self.onSetPublished(id, on)).then(function () { self._renderAnalyticsInto(body); });
      }
      else if (act === 'reg') { self._toggleRegList(container, id, b); }
      else if (act === 'reg-csv') { self._exportRegistrations(id, ev && ev.title); }
    });
  };

  // Show / hide the door list for one event. Fetched on demand: this is the
  // organiser's attendees' names and email addresses, so it is not loaded into
  // the page until they actually ask to see it.
  Coordinator.prototype._toggleRegList = function (container, id, btn) {
    const self = this;
    const box = container.querySelector('.an-reg[data-regfor="' + (global.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
    if (!box) return;
    if (!box.hidden) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = '<div class="an-reg-load">Loading registrations…</div>';
    const A = global.EventuallyAuth;
    if (!A || !A.eventRegistrations) { box.innerHTML = '<div class="an-reg-load">Unavailable.</div>'; return; }
    A.eventRegistrations(id).then(function (rows) {
      self._regRows = self._regRows || {};
      self._regRows[id] = rows || [];
      if (!rows || !rows.length) {
        box.innerHTML = '<div class="an-reg-load">Nobody has registered yet. ' +
          'Share the event link — people register in one tap.</div>';
        return;
      }
      const esc = function (s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[m]; }); };
      let h = '<div class="an-reg-h"><b>' + rows.length + ' registered</b>' +
        '<button class="an-act" data-me-act="reg-csv" data-id="' + esc(id) + '">Download CSV</button></div>' +
        '<table class="an-reg-t"><thead><tr><th>Name</th><th>Email</th><th>Registered</th></tr></thead><tbody>';
      rows.forEach(function (r) {
        const when = r.registered_at ? new Date(r.registered_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
        h += '<tr><td>' + esc(r.name) + '</td><td>' + esc(r.email) + '</td><td>' + esc(when) + '</td></tr>';
      });
      box.innerHTML = h + '</tbody></table>' +
        '<p class="an-reg-note">These people gave you their name and email by registering. ' +
        'Use them for this event only.</p>';
    });
  };

  // CSV of the door list, generated in the browser from what is already on screen.
  Coordinator.prototype._exportRegistrations = function (id, title) {
    const rows = (this._regRows && this._regRows[id]) || [];
    if (!rows.length) { this._toast('Nothing to export yet.'); return; }
    // Excel treats a leading =, +, - or @ as a formula. Prefix those with a
    // quote so a name like "=cmd" stays text in whatever the organiser opens it in.
    const cell = function (v) {
      let s = String(v == null ? '' : v);
      if (/^[=+\-@]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    };
    const lines = ['Name,Email,Registered'];
    rows.forEach(function (r) {
      lines.push([cell(r.name), cell(r.email),
        cell(r.registered_at ? new Date(r.registered_at).toISOString() : '')].join(','));
    });
    const safe = String(title || 'event').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'registrations-' + (safe || 'event') + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  };

  Coordinator.prototype._publish = function () {
    const self = this;
    const q = function (s) { return this.el.querySelector(s); }.bind(this);
    const name = q('.f-name').value.trim();
    if (!name) { this._toast('Add an event name first.'); return; }
    if (!this.locationChosen) {
      this._toast('Set a location first — search an address or tap the map.');
      const map = this.el.querySelector('.co-loc'); if (map) { map.classList.add('co-need-loc'); q('.f-addr').focus(); }
      return;
    }
    const cat = q('.f-cat').value;
    const dateStr = q('.f-date').value;
    if (!dateStr) { this._toast('Pick a date.'); return; }
    const timeStr = (q('.f-time').value || '19:00');
    const TZ = global.EventuallyTZ;
    const zone = this.timezone || (TZ && TZ.local) || 'UTC';
    // `new Date('2026-09-07T19:00')` reads the string in the BROWSER's zone. That
    // is the bug: it turned 7 p.m. in Abuja into 2 a.m. in Abuja whenever the
    // organiser wasn't sitting in Abuja. The wall clock belongs to the VENUE.
    const dp = dateStr.split('-'), tp = timeStr.split(':');
    const date = TZ ? TZ.fromWallClock(+dp[0], +dp[1], +dp[2], +tp[0], +tp[1], zone)
                    : new Date(dateStr + 'T' + timeStr + ':00');
    const endStr = q('.f-endtime').value;
    let endsAt = null;
    if (endStr) {
      const ep = endStr.split(':');
      endsAt = TZ ? TZ.fromWallClock(+dp[0], +dp[1], +dp[2], +ep[0], +ep[1], zone)
                  : new Date(dateStr + 'T' + endStr + ':00');
      // An end time before the start means it runs past midnight into the next day.
      if (endsAt <= date) endsAt = new Date(endsAt.getTime() + 86400000);
    }
    const venue = q('.f-venue').value.trim();
    const address = q('.f-address').value.trim();
    // A pin gives a dot on a globe; a venue gives somewhere to turn up to.
    if (!venue) { this._toast('Add the venue — people need somewhere to go, not just a city.'); q('.f-venue').focus(); return; }
    const today = global.EventuallyData.TODAY;
    const dayOffset = Math.round((date - today) / 86400000);
    if (dayOffset < 0) { this._toast('Pick a date from today onward.'); return; }
    if (dayOffset > 60) { this._toast('Events can be up to 60 days ahead.'); return; }
    const regMode = (q('.f-reg-eventually').checked && 'eventually')
                 || (q('.f-reg-none').checked && 'none') || 'link';
    const url = regMode === 'link' ? q('.f-url').value.trim() : '';
    // Only enforced on the branch that depends on it. "Just turn up" is a valid
    // answer, and demanding a URL there is what made the old field useless.
    if (regMode === 'link' && !url) {
      this._toast('Add the booking link, or pick another option below it.'); return;
    }
    if (regMode === 'link' && !/^https?:\/\//i.test(url)) {
      this._toast('The booking link needs to start with http:// or https://'); return;
    }
    const capRaw = parseInt(q('.f-capacity').value, 10);
    const capacity = regMode === 'eventually' && capRaw > 0 ? capRaw : null;
    const editing = !!this.editId;
    const id = this.editId || ('nat_' + (global.crypto && crypto.randomUUID ? crypto.randomUUID()
      : (Date.now() + '_' + Math.random().toString(36).slice(2))));

    const evt = {
      id: id, name: name, city: this.city || 'Dropped pin', venue: venue || null, endsAt: endsAt,
      address: address || null, timezone: zone,
      lat: this.pin.lat, lon: this.pin.lon,
      date: date, dayOffset: dayOffset, category: cat,
      categoryColor: global.EventuallyData.CATEGORIES[cat],
      source: 'orbit', sourceLabel: 'Eventually Native', sourceColor: '#CB5A3C',
      banner: [global.EventuallyData.CATEGORIES[cat] || '#CB5A3C', '#211A15'],   // auto from category
      description: q('.f-desc').value.trim() || (name + ' — published via the Eventually Coordinator portal.'),
      ticketUrl: url || null,
      collectRegistrations: regMode === 'eventually',
      capacity: capacity,
      sponsored: !!q('.f-feature').checked,    // a REQUEST — granted by an admin
      likes: 0, attending: 0, clicks: 0, userLiked: false, userAttending: false,
      _mine: true
    };
    const btn = this.el.querySelector('.co-publish');
    btn.disabled = true; btn.textContent = editing ? 'Saving…' : 'Publishing…';
    const action = editing && this.onUpdate ? this.onUpdate(evt) : this.onPublish(evt);
    Promise.resolve(action).then(function (res) {
      const r = (res && typeof res === 'object') ? res : { ok: !!res, live: true };
      btn.disabled = false;
      if (!r.ok) { btn.textContent = editing ? 'Update event' : 'Publish event ✦'; return; }
      self._toast(r.message || (editing ? 'Changes saved.' : 'Published!'));
      if (r.live && self.onFlyTo) self.onFlyTo(evt.lat, evt.lon);   // only fly if it's actually on the globe
      self._resetForm();
    }).catch(function () {
      btn.disabled = false; btn.textContent = editing ? 'Update event' : 'Publish event ✦';
      self._toast((editing ? 'Save' : 'Publish') + ' failed — please try again.');
    });
  };

  /* A place was picked (searched, or a dropped pin that reverse-geocoded).
     Adopt what it tells us: the venue's time zone, and the address — so the
     organiser doesn't retype what the map already knows. Anything they have
     already typed themselves is left alone. */
  Coordinator.prototype._adoptPlace = function (res) {
    if (!res) return;
    const TZ = global.EventuallyTZ;
    const addrEl = this.el.querySelector('.f-address');
    const venueEl = this.el.querySelector('.f-venue');
    if (addrEl && !addrEl.value.trim() && res.label) addrEl.value = res.label;
    if (venueEl && !venueEl.value.trim() && res.venue) venueEl.value = res.venue;

    if (!TZ) return;
    const g = TZ.guess(res.countryCode);
    // Only move the zone if the organiser hasn't overridden it by hand — their
    // choice must not be undone by a later tweak to the pin.
    if (!this._tzTouched) { this.timezone = g.zone; this._tzSure = g.sure; this._fillTzOptions(g); }
    this._syncTzNote();
  };

  // Populate the zone picker: the likely candidates first, then everything.
  Coordinator.prototype._fillTzOptions = function (g) {
    const sel = this.el.querySelector('.f-tz');
    const TZ = global.EventuallyTZ;
    if (!sel || !TZ) return;
    const chosen = this.timezone || TZ.local;
    const near = [];
    if (g && g.options) g.options.forEach(function (z) { near.push(z); });
    if (near.indexOf(chosen) === -1) near.unshift(chosen);
    if (near.indexOf(TZ.local) === -1) near.push(TZ.local);

    const all = TZ.allZones().filter(function (z) { return near.indexOf(z) === -1; });
    const opt = function (z) {
      return '<option value="' + z + '"' + (z === chosen ? ' selected' : '') + '>' + TZ.label(z) + '</option>';
    };
    sel.innerHTML =
      '<optgroup label="Likely">' + near.map(opt).join('') + '</optgroup>' +
      '<optgroup label="All time zones">' + all.map(opt).join('') + '</optgroup>';
  };

  /* Say back, in plain words, exactly what will be stored. This line is the real
     safeguard: a wrong zone is invisible until someone states the consequence. */
  Coordinator.prototype._syncTzNote = function () {
    const note = this.el.querySelector('.co-tz-note');
    const TZ = global.EventuallyTZ;
    if (!note || !TZ) return;
    const q = function (s) { return this.el.querySelector(s); }.bind(this);
    const dateStr = q('.f-date').value, timeStr = q('.f-time').value || '19:00';
    if (!dateStr) { note.textContent = ''; return; }
    const p = dateStr.split('-'), t = timeStr.split(':');
    const zone = this.timezone || TZ.local;
    const when = TZ.fromWallClock(+p[0], +p[1], +p[2], +t[0], +t[1], zone);
    const at = TZ.format(when, zone, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

    let msg = 'Starts <b>' + at + ' ' + (TZ.abbr(when, zone) || TZ.label(zone)) + '</b>.';
    // Only mention the reader's own clock when it actually differs — otherwise
    // it is noise on the overwhelmingly common "publishing at home" case.
    if (!TZ.sameAsLocal(when, zone)) {
      msg += ' That is ' + TZ.format(when, TZ.local, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) + ' your time.';
    }
    if (!this._tzSure && !this._tzTouched) msg += ' <b class="co-tz-check">Please check this is right.</b>';
    note.innerHTML = msg;
    note.classList.toggle('warn', !this._tzSure && !this._tzTouched);
  };

  // Show only the follow-up field the chosen entry method needs.
  Coordinator.prototype._syncRegMode = function () {
    const q = function (s) { return this.el.querySelector(s); }.bind(this);
    const link = q('.f-reg-link'), ev = q('.f-reg-eventually');
    if (!link) return;
    q('.co-reg-url').hidden = !link.checked;
    q('.co-reg-cap').hidden = !ev.checked;
  };

  // Reset the form to "create" mode.
  Coordinator.prototype._resetForm = function () {
    const q = function (s) { return this.el.querySelector(s); }.bind(this);
    this.editId = null; this.city = null;
    q('.f-name').value = ''; q('.f-desc').value = ''; q('.f-url').value = '';
    q('.f-reg-link').checked = true; q('.f-capacity').value = '';
    this._syncRegMode();
    if (q('.f-address')) q('.f-address').value = '';
    // A fresh form is the organiser's own zone again, and untouched.
    const TZR = global.EventuallyTZ;
    if (TZR) {
      this.timezone = TZR.local; this._tzTouched = false; this._tzSure = true;
      this._fillTzOptions(null); this._syncTzNote();
    }
    if (q('.f-venue')) q('.f-venue').value = '';
    if (q('.f-time')) q('.f-time').value = '19:00';
    if (q('.f-endtime')) q('.f-endtime').value = '';
    if (q('.f-feature')) q('.f-feature').checked = false;
    q('.co-publish').textContent = 'Publish event ✦';
    const h = this.el.querySelector('.co-form-h'); if (h) h.textContent = 'Publish a new event';
    const cancel = this.el.querySelector('.co-cancel-edit'); if (cancel) cancel.style.display = 'none';
    q('.f-addr').value = '';
    const map = this.el.querySelector('.co-loc'); if (map) map.classList.remove('co-need-loc');
    this._applyDefaultLocation();            // start fresh on the user's location (if set)
    this._drawMap();
  };

  // Load an event into the form for editing.
  Coordinator.prototype._editEvent = function (ev) {
    const q = function (s) { return this.el.querySelector(s); }.bind(this);
    this.editId = ev.event_id;
    this.locationChosen = true;              // an existing event already has a location
    q('.f-name').value = ev.title || '';
    q('.f-cat').value = ev.category || q('.f-cat').value;
    // Restore the zone BEFORE the clock, because the clock is read back in it.
    const TZ = global.EventuallyTZ;
    this.timezone = (TZ && TZ.valid(ev.timezone) && ev.timezone) || (TZ && TZ.local) || 'UTC';
    this._tzTouched = !!ev.timezone;         // a stored zone is a decision already made
    this._tzSure = true;
    if (TZ) this._fillTzOptions(null);

    if (ev.start_time) {
      const d = new Date(ev.start_time);
      // Show the wall clock AT THE VENUE. Reading getHours() here would display
      // the organiser's own zone and then re-save that as the venue's — the
      // original bug, running backwards through the edit form.
      const w = TZ ? TZ.toWallClock(d, this.timezone)
                   : { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes() };
      q('.f-date').value = w.y + '-' + String(w.mo).padStart(2, '0') + '-' + String(w.d).padStart(2, '0');
      if (q('.f-time')) q('.f-time').value = String(w.h).padStart(2, '0') + ':' + String(w.mi).padStart(2, '0');
    }
    if (ev.end_time && q('.f-endtime')) {
      const e2 = new Date(ev.end_time);
      const we = TZ ? TZ.toWallClock(e2, this.timezone)
                    : { h: e2.getHours(), mi: e2.getMinutes() };
      q('.f-endtime').value = String(we.h).padStart(2, '0') + ':' + String(we.mi).padStart(2, '0');
    }
    if (q('.f-venue')) q('.f-venue').value = ev.venue || '';
    if (q('.f-address')) q('.f-address').value = ev.address || '';
    q('.f-desc').value = ev.description || '';
    q('.f-url').value = ev.url || '';
    // Restore the entry method: registrations on, else a link, else nothing.
    q('.f-capacity').value = ev.capacity || '';
    if (ev.collect_registrations) q('.f-reg-eventually').checked = true;
    else if (ev.url) q('.f-reg-link').checked = true;
    else q('.f-reg-none').checked = true;
    this._syncRegMode();
    this.pin = { lat: +ev.lat, lon: +ev.lon }; this.city = ev.city || null;
    this._syncTzNote();
    q('.co-publish').textContent = 'Update event';
    const h = this.el.querySelector('.co-form-h'); if (h) h.textContent = 'Editing: ' + (ev.title || 'event');
    const cancel = this.el.querySelector('.co-cancel-edit'); if (cancel) cancel.style.display = '';
    this._drawMap();
    // `.co-shell` never existed — this line threw on every single edit. It sits
    // last, so the form was already populated and the damage was an uncaught
    // TypeError rather than a broken form, which is why it survived unnoticed.
    // The actual scroll container is .co-body.
    const shell = this.el.querySelector('.co-body');
    if (shell) shell.scrollTop = 0;
  };

  Coordinator.prototype._drawMap = function () {
    const c = this.mapCanvas, dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = c.clientWidth || 360, h = w / 2;
    c.style.height = h + 'px';
    c.width = w * dpr; c.height = h * dpr;
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#efe5d6'; ctx.fillRect(0, 0, w, h);

    // dotted land
    const step = 3.2;
    for (let py = 0; py < h; py += step) {
      for (let px = 0; px < w; px += step) {
        const lon = px / w * 360 - 180;
        const lat = 90 - py / h * 180;
        if (isLand(lat, lon)) {
          ctx.fillStyle = 'rgba(33,26,21,0.45)';
          ctx.fillRect(px, py, 1.4, 1.4);
        }
      }
    }
    // pin
    const px = (this.pin.lon + 180) / 360 * w;
    const py = (90 - this.pin.lat) / 180 * h;
    ctx.strokeStyle = 'rgba(203,90,60,0.6)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(px, py, 9, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#CB5A3C'; ctx.shadowColor = '#CB5A3C'; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;

    this.el.querySelector('.ll-lat').textContent = this.pin.lat.toFixed(2);
    this.el.querySelector('.ll-lon').textContent = this.pin.lon.toFixed(2);
    const cityEl = this.el.querySelector('.ll-city');
    if (cityEl) cityEl.textContent = this.city || '—';
  };

  Coordinator.prototype._renderAnalyticsInto = function (body) {
    const self = this;
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[m]; }); }
    function draw(rows, real) {
      self._myEvents = rows;
      if (!rows.length) {
        body.innerHTML = '<p class="an-empty">' + (real === false
          ? 'Sign in to publish and manage your events here.'
          : 'No events yet. Publish one to see it here with likes, saves and attendees.') + '</p>';
        return;
      }
      const sum = function (k) { return rows.reduce(function (a, e) { return a + (+e[k] || 0); }, 0); };
      let html = '<div class="an-kpis">' +
        kpi('Saves', sum('saves'), '#CB5A3C') + kpi('Likes', sum('likes'), '#8A3B1E') + kpi('Attending', sum('attends'), '#B5722F') +
        // Only shown once it means something — an always-visible zero on every
        // account would just be a reminder of a feature most events don't use.
        (sum('registered') ? kpi('Registered', sum('registered'), '#2E6B4F') : '') +
        '</div><div class="an-list">';
      rows.forEach(function (e) {
        const pub = e.published !== false;
        const mod = e.moderation || 'approved';
        let status = '';
        if (mod === 'pending') status = ' <span class="an-badge an-pending">⏳ pending review</span>';
        else if (mod === 'rejected') status = ' <span class="an-badge an-rejected">✕ rejected</span>';
        else if (!pub) status = ' <span class="an-badge">unpublished</span>';
        const reason = (mod === 'rejected' && e.moderation_reason) ? '<small class="an-reason">Reason: ' + esc(e.moderation_reason) + '</small>' : '';
        html += '<div class="an-row2">' +
          '<div class="an-r-main"><strong>' + esc(e.title) + '</strong>' + status + reason +
          '<small>' + esc(e.city || '') + ' · ★ ' + (+e.saves || 0) + ' · ♥ ' + (+e.likes || 0) + ' · ✓ ' + (+e.attends || 0) + ' going</small></div>' +
          '<div class="an-r-actions">' +
            '<button class="an-act" data-me-act="edit" data-id="' + esc(e.event_id) + '">Edit</button>' +
            // "Remove from globe" replaces Delete: the listing comes off the map but the
            // record (and the posting slot it used) stays. Permanent deletion is admin-only —
            // otherwise publish → delete → publish would loop around the yearly limit.
            '<button class="an-act' + (pub ? ' an-danger' : '') + '" data-me-act="toggle" data-id="' + esc(e.event_id) + '">' +
              (pub ? 'Remove from globe' : 'Put back on globe') + '</button>' +
            // The door list, only for events actually collecting registrations.
            (e.collect_registrations
              ? '<button class="an-act" data-me-act="reg" data-id="' + esc(e.event_id) + '">' +
                  'Registrations (' + (+e.registered || 0) + ')</button>'
              : '') +
          '</div>' +
          (e.collect_registrations ? '<div class="an-reg" data-regfor="' + esc(e.event_id) + '" hidden></div>' : '') +
          // Live updates. Stays hidden unless this event's window is open, so a
          // publisher with ten listings sees a composer only on the one running
          // tonight — rather than ten empty boxes.
          '<div class="an-updates"><div class="live-updates" data-uid="' + esc(e.event_id) + '" hidden></div></div>' +
        '</div>';
      });
      body.innerHTML = html + '</div>';

      if (global.EventuallyUpdates) {
        body.querySelectorAll('.an-updates .live-updates').forEach(function (box) {
          global.EventuallyUpdates.mount(box, box.dataset.uid);
        });
      }
    }
    function kpi(label, val, col) { return '<div class="kpi"><strong style="color:' + col + '">' + (val || 0).toLocaleString() + '</strong><span>' + label + '</span></div>'; }

    body.innerHTML = '<p class="an-empty">Loading your events…</p>';
    if (this.getCreatorStats) {
      this.getCreatorStats().then(function (rows) {
        if (rows && rows.length) return draw(rows, true);
        // no backend rows → demo fallback (local _mine events)
        const mine = (self.getMyEvents && self.getMyEvents()) || [];
        draw(mine.map(function (e) { return { event_id: e.id, title: e.name, city: e.city, published: true, saves: 0, likes: e.likes, attends: e.attending, start_time: e.date && e.date.toISOString(), description: e.description, category: e.category, lat: e.lat, lon: e.lon, url: e.ticketUrl }; }), false);
      }).catch(function () { draw([], false); });
    } else {
      const mine = (this.getMyEvents && this.getMyEvents()) || [];
      draw(mine.map(function (e) { return { event_id: e.id, title: e.name, city: e.city, published: true, saves: 0, likes: e.likes, attends: e.attending }; }), true);
    }
  };

  Coordinator.prototype._toast = function (msg) {
    if (global.EventuallyToast) global.EventuallyToast(msg);
  };

  global.EventuallyCoordinator = Coordinator;
})(window);

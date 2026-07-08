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
    this.getCreatorStats = opts.getCreatorStats; // () -> Promise<[{event_id,title,...,saves,likes,attends,published}]>
    this.onFlyTo = opts.onFlyTo;           // (lat, lon) -> void
    this.getMyEvents = opts.getMyEvents;   // () -> [events]  (demo fallback)
    this.pin = { lat: 48.85, lon: 2.35 };  // default Paris
    this.banner = ['#CB5A3C', '#8A3B1E'];
    this.city = null;                       // resolved place name (geocoded)
    this.editId = null;                     // set when editing an existing event
    this._build();
  }

  Coordinator.prototype.open = function () {
    this.el.classList.add('open');
    this._drawMap();
    this._renderAnalytics();
  };
  Coordinator.prototype.close = function () { this.el.classList.remove('open'); };

  Coordinator.prototype._build = function () {
    const self = this;
    this.el.innerHTML =
      '<div class="co-shell">' +
        '<header class="co-head">' +
          '<div><span class="co-kicker">Coordinator Portal</span>' +
          '<h2>Publish to the globe</h2></div>' +
          '<button class="co-close" aria-label="Close">✕</button>' +
        '</header>' +
        '<div class="co-grid">' +
          '<section class="co-card co-form">' +
            '<div class="co-card-h co-form-h">Publish a new event</div>' +
            '<label>Event name<input class="f-name" placeholder="Midnight Rooftop Sessions"></label>' +
            '<label>Category' +
              '<select class="f-cat">' + Object.keys(global.EventuallyData.CATEGORIES)
                .map(function (c) { return '<option>' + c + '</option>'; }).join('') +
              '</select></label>' +
            '<label>Date<input type="date" class="f-date"></label>' +
            '<label>Description<textarea class="f-desc" rows="3" placeholder="Tell people what to expect…"></textarea></label>' +
            '<label>Ticket / source link<input class="f-url" placeholder="https://yourtickets.com/show"></label>' +
            '<div class="f-banner">' +
              '<span>Event banner</span>' +
              '<div class="swatches"></div>' +
            '</div>' +
            '<label class="co-feature"><input type="checkbox" class="f-feature">' +
              '<span class="co-feature-txt"><b>✦ Feature this event</b>' +
              '<small>Premium placement — distinct highlight, a spike, and top of search. Billed via Eventually Plus.</small></span>' +
            '</label>' +
            '<button class="co-publish">Publish event ✦</button>' +
            '<button class="co-cancel-edit" type="button" style="display:none">Cancel edit</button>' +
            '<p class="co-note">Your event is geo-located and published live to the globe.</p>' +
          '</section>' +

          '<section class="co-card co-map">' +
            '<div class="co-card-h">Geolocation · drop a pin</div>' +
            '<canvas class="map-canvas"></canvas>' +
            '<div class="co-coords">' +
              '<div class="co-search"><input class="f-addr" placeholder="Search address or city…" autocomplete="off"><div class="co-suggest"></div></div>' +
              '<div class="latlon">lat <strong class="ll-lat"></strong> · lon <strong class="ll-lon"></strong></div>' +
            '<div class="co-place">📍 <strong class="ll-city">—</strong></div>' +
            '</div>' +
          '</section>' +

          '<section class="co-card co-analytics">' +
            '<div class="co-card-h">My events &amp; engagement</div>' +
            '<div class="an-body"></div>' +
          '</section>' +
        '</div>' +
      '</div>';

    // banner swatches
    const palettes = [['#CB5A3C','#8A3B1E'],['#E0875F','#CB5A3C'],['#B5722F','#E0875F'],
                      ['#A23A22','#CB5A3C'],['#6E4A30','#B5722F'],['#C18A5C','#E0875F']];
    const sw = this.el.querySelector('.swatches');
    palettes.forEach(function (p, i) {
      const b = document.createElement('button');
      b.className = 'sw' + (i === 0 ? ' active' : '');
      b.style.background = 'linear-gradient(135deg,' + p[0] + ',' + p[1] + ')';
      b.addEventListener('click', function () {
        self.banner = p;
        sw.querySelectorAll('.sw').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
      });
      sw.appendChild(b);
    });

    // Default the date to today; allow today .. +60 days (the forward window).
    const dateEl = this.el.querySelector('.f-date');
    const t = global.EventuallyData.TODAY;
    const fmt = function (d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    const maxD = new Date(t); maxD.setDate(maxD.getDate() + 60);
    dateEl.value = fmt(t); dateEl.min = fmt(t); dateEl.max = fmt(maxD);

    this.el.querySelector('.co-close').addEventListener('click', function () { self.close(); });
    this.mapCanvas = this.el.querySelector('.map-canvas');
    this.mapCanvas.addEventListener('click', function (e) {
      const r = self.mapCanvas.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      self.pin.lon = x * 360 - 180;
      self.pin.lat = 90 - y * 180;
      self.city = null;
      self._drawMap();
      // name the dropped pin (best-effort reverse geocode)
      const at = { lat: self.pin.lat, lon: self.pin.lon };
      if (Geo) Geo.reverse(at.lat, at.lon).then(function (res) {
        if (res && self.pin.lat === at.lat && self.pin.lon === at.lon) { self.city = res.city; self._drawMap(); }
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

    // My-events list actions (edit / publish-toggle / delete)
    this.el.querySelector('.an-body').addEventListener('click', function (e) {
      const b = e.target.closest('[data-me-act]'); if (!b) return;
      const id = b.dataset.id, act = b.dataset.meAct;
      const ev = (self._myEvents || []).find(function (x) { return x.event_id === id; });
      if (act === 'edit') { if (ev) self._editEvent(ev); }
      else if (act === 'toggle') { if (self.onSetPublished) Promise.resolve(self.onSetPublished(id, !(ev && ev.published !== false))).then(function () { self._renderAnalytics(); }); }
      else if (act === 'delete') {
        if (!confirm('Delete "' + (ev ? ev.title : 'this event') + '" permanently? This cannot be undone.')) return;
        if (self.onDelete) Promise.resolve(self.onDelete(id)).then(function () { if (self.editId === id) self._resetForm(); self._renderAnalytics(); });
      }
    });
  };

  Coordinator.prototype._publish = function () {
    const self = this;
    const q = function (s) { return this.el.querySelector(s); }.bind(this);
    const name = q('.f-name').value.trim();
    if (!name) { this._toast('Add an event name first.'); return; }
    const cat = q('.f-cat').value;
    const dateStr = q('.f-date').value;
    if (!dateStr) { this._toast('Pick a date.'); return; }
    const date = new Date(dateStr + 'T19:00:00');   // local 7pm
    const today = global.EventuallyData.TODAY;
    const dayOffset = Math.round((date - today) / 86400000);
    if (dayOffset < 0) { this._toast('Pick a date from today onward.'); return; }
    if (dayOffset > 60) { this._toast('Events can be up to 60 days ahead.'); return; }
    const url = q('.f-url').value.trim();
    const editing = !!this.editId;
    const id = this.editId || ('nat_' + (global.crypto && crypto.randomUUID ? crypto.randomUUID()
      : (Date.now() + '_' + Math.random().toString(36).slice(2))));

    const evt = {
      id: id, name: name, city: this.city || 'Dropped pin', lat: this.pin.lat, lon: this.pin.lon,
      date: date, dayOffset: dayOffset, category: cat,
      categoryColor: global.EventuallyData.CATEGORIES[cat],
      source: 'orbit', sourceLabel: 'Eventually Native', sourceColor: '#CB5A3C',
      banner: this.banner.slice(),
      description: q('.f-desc').value.trim() || (name + ' — published via the Eventually Coordinator portal.'),
      ticketUrl: url || null,
      sponsored: !!q('.f-feature').checked,    // paid "Feature" placement
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
      self._renderAnalytics();
    }).catch(function () {
      btn.disabled = false; btn.textContent = editing ? 'Update event' : 'Publish event ✦';
      self._toast((editing ? 'Save' : 'Publish') + ' failed — please try again.');
    });
  };

  // Reset the form to "create" mode.
  Coordinator.prototype._resetForm = function () {
    const q = function (s) { return this.el.querySelector(s); }.bind(this);
    this.editId = null; this.city = null;
    q('.f-name').value = ''; q('.f-desc').value = ''; q('.f-url').value = '';
    if (q('.f-feature')) q('.f-feature').checked = false;
    q('.co-publish').textContent = 'Publish event ✦';
    const h = this.el.querySelector('.co-form-h'); if (h) h.textContent = 'Publish a new event';
    const cancel = this.el.querySelector('.co-cancel-edit'); if (cancel) cancel.style.display = 'none';
    this._drawMap();
  };

  // Load an event into the form for editing.
  Coordinator.prototype._editEvent = function (ev) {
    const q = function (s) { return this.el.querySelector(s); }.bind(this);
    this.editId = ev.event_id;
    q('.f-name').value = ev.title || '';
    q('.f-cat').value = ev.category || q('.f-cat').value;
    if (ev.start_time) { const d = new Date(ev.start_time); q('.f-date').value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
    q('.f-desc').value = ev.description || '';
    q('.f-url').value = ev.url || '';
    this.pin = { lat: +ev.lat, lon: +ev.lon }; this.city = ev.city || null;
    q('.co-publish').textContent = 'Update event';
    const h = this.el.querySelector('.co-form-h'); if (h) h.textContent = 'Editing: ' + (ev.title || 'event');
    const cancel = this.el.querySelector('.co-cancel-edit'); if (cancel) cancel.style.display = '';
    this._drawMap();
    this.el.querySelector('.co-shell').scrollTop = 0;
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

  Coordinator.prototype._renderAnalytics = function () {
    const self = this, body = this.el.querySelector('.an-body');
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
            '<button class="an-act" data-me-act="toggle" data-id="' + esc(e.event_id) + '">' + (pub ? 'Unpublish' : 'Publish') + '</button>' +
            '<button class="an-act an-danger" data-me-act="delete" data-id="' + esc(e.event_id) + '">Delete</button>' +
          '</div></div>';
      });
      body.innerHTML = html + '</div>';
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

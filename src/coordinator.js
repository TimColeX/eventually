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

  function Coordinator(el, opts) {
    this.el = el;
    this.onPublish = opts.onPublish;       // (eventObj) -> void
    this.onFlyTo = opts.onFlyTo;           // (lat, lon) -> void
    this.getMyEvents = opts.getMyEvents;   // () -> [events]
    this.pin = { lat: 48.85, lon: 2.35 };  // default Paris
    this.banner = ['#CB5A3C', '#8A3B1E'];
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
            '<label>Event name<input class="f-name" placeholder="Midnight Rooftop Sessions"></label>' +
            '<label>Category' +
              '<select class="f-cat">' + Object.keys(global.EventuallyData.CATEGORIES)
                .map(function (c) { return '<option>' + c + '</option>'; }).join('') +
              '</select></label>' +
            '<label>Date<input type="date" class="f-date" value="2026-06-25"></label>' +
            '<label>Description<textarea class="f-desc" rows="3" placeholder="Tell people what to expect…"></textarea></label>' +
            '<label>Ticket / source link<input class="f-url" placeholder="https://yourtickets.com/show"></label>' +
            '<div class="f-banner">' +
              '<span>Event banner</span>' +
              '<div class="swatches"></div>' +
            '</div>' +
            '<button class="co-publish">Publish event ✦</button>' +
            '<p class="co-note">Demo mode — events appear instantly on the live globe.</p>' +
          '</section>' +

          '<section class="co-card co-map">' +
            '<div class="co-card-h">Geolocation · drop a pin</div>' +
            '<canvas class="map-canvas"></canvas>' +
            '<div class="co-coords">' +
              '<input class="f-addr" placeholder="Search address or city…">' +
              '<div class="latlon">lat <strong class="ll-lat"></strong> · lon <strong class="ll-lon"></strong></div>' +
            '</div>' +
          '</section>' +

          '<section class="co-card co-analytics">' +
            '<div class="co-card-h">Your engagement</div>' +
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

    this.el.querySelector('.co-close').addEventListener('click', function () { self.close(); });
    this.mapCanvas = this.el.querySelector('.map-canvas');
    this.mapCanvas.addEventListener('click', function (e) {
      const r = self.mapCanvas.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      self.pin.lon = x * 360 - 180;
      self.pin.lat = 90 - y * 180;
      self._drawMap();
    });

    // Fake geocode: type a known city name -> coordinates.
    const GEO = { paris:[48.85,2.35], london:[51.5,-0.12], tokyo:[35.68,139.69],
      'new york':[40.71,-74.0], lagos:[6.52,3.37], sydney:[-33.86,151.21],
      berlin:[52.52,13.4], nairobi:[-1.29,36.82], 'são paulo':[-23.55,-46.63],
      mumbai:[19.08,72.88], dubai:[25.2,55.27], toronto:[43.65,-79.38] };
    this.el.querySelector('.f-addr').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      const q = e.target.value.trim().toLowerCase();
      if (GEO[q]) { self.pin.lat = GEO[q][0]; self.pin.lon = GEO[q][1]; self._drawMap(); }
      else self._toast('Try: Paris, London, Tokyo, Lagos, Sydney…');
    });

    this.el.querySelector('.co-publish').addEventListener('click', function () {
      self._publish();
    });
  };

  Coordinator.prototype._publish = function () {
    const q = function (s) { return this.el.querySelector(s); }.bind(this);
    const name = q('.f-name').value.trim();
    if (!name) { this._toast('Add an event name first.'); return; }
    const cat = q('.f-cat').value;
    const dateStr = q('.f-date').value;
    const date = new Date(dateStr + 'T19:00:00Z');
    const url = q('.f-url').value.trim();
    const today = global.EventuallyData.TODAY;
    const dayOffset = Math.round((date - today) / 86400000);

    const evt = {
      name: name, city: 'Your pin', lat: this.pin.lat, lon: this.pin.lon,
      date: date, dayOffset: dayOffset, category: cat,
      categoryColor: global.EventuallyData.CATEGORIES[cat],
      source: 'orbit', sourceLabel: 'Eventually Native', sourceColor: '#21d4fd',
      banner: this.banner.slice(),
      description: q('.f-desc').value.trim() || (name + ' — published via the Eventually Coordinator portal.'),
      ticketUrl: url || null,
      likes: 0, attending: 0, clicks: 0, userLiked: false, userAttending: false,
      _mine: true
    };
    this.onPublish(evt);
    this._toast('Published! ' + name + ' is now live on the globe.');
    if (this.onFlyTo) this.onFlyTo(evt.lat, evt.lon);
    q('.f-name').value = ''; q('.f-desc').value = ''; q('.f-url').value = '';
    this._renderAnalytics();
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
  };

  Coordinator.prototype._renderAnalytics = function () {
    const mine = (this.getMyEvents && this.getMyEvents()) || [];
    const body = this.el.querySelector('.an-body');
    if (!mine.length) {
      body.innerHTML = '<p class="an-empty">No events yet. Publish one to see live likes, clicks and attendees here.</p>';
      return;
    }
    const totL = mine.reduce(function (a, e) { return a + e.likes; }, 0);
    const totA = mine.reduce(function (a, e) { return a + e.attending; }, 0);
    const totC = mine.reduce(function (a, e) { return a + e.clicks; }, 0);
    let html =
      '<div class="an-kpis">' +
        kpi('Likes', totL, '#CB5A3C') + kpi('Attending', totA, '#8A3B1E') +
        kpi('Link clicks', totC, '#B5722F') +
      '</div><div class="an-list">';
    const max = Math.max.apply(null, mine.map(function (e) { return e.likes + e.attending + 1; }));
    mine.forEach(function (e) {
      const v = (e.likes + e.attending) / max * 100;
      html += '<div class="an-row"><span>' + esc(e.name) + '</span>' +
        '<div class="an-bar"><i style="width:' + v + '%"></i></div>' +
        '<small>' + e.likes + '♥ · ' + e.attending + ' going</small></div>';
    });
    html += '</div>';
    body.innerHTML = html;

    function kpi(label, val, col) {
      return '<div class="kpi"><strong style="color:' + col + '">' + val.toLocaleString() +
        '</strong><span>' + label + '</span></div>';
    }
    function esc(s) { return s.replace(/[&<>]/g, function (m) { return ({'&':'&amp;','<':'&lt;','>':'&gt;'})[m]; }); }
  };

  Coordinator.prototype._toast = function (msg) {
    if (global.EventuallyToast) global.EventuallyToast(msg);
  };

  global.EventuallyCoordinator = Coordinator;
})(window);

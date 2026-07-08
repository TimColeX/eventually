/* Eventually — Canvas 3D dotted globe engine.
 * No WebGL, no libraries. Land dots are derived from real Natural Earth
 * land polygons (window.EVENTUALLY_LAND), scanline-rasterized into a lookup grid,
 * so continents are accurately recognizable (like github.com/globe).
 */
(function (global) {
  'use strict';

  const DEG = Math.PI / 180;

  /* ---------- Build an equirectangular land mask from GeoJSON ---------- */
  const MASK_W = 720, MASK_H = 360;          // 0.5° lookup grid
  let MASK = null;

  function buildMask() {
    const mask = new Uint8Array(MASK_W * MASK_H);
    const data = global.EVENTUALLY_LAND;
    if (!data) return mask;

    // collect sub-polygons: each is an array of rings ([ [lon,lat], ... ])
    const polys = [];
    data.features.forEach(function (f) {
      const g = f.geometry; if (!g) return;
      if (g.type === 'Polygon') polys.push(g.coordinates);
      else if (g.type === 'MultiPolygon') g.coordinates.forEach(function (p) { polys.push(p); });
    });

    // scanline fill each sub-polygon (even-odd across its rings handles holes)
    for (let y = 0; y < MASK_H; y++) {
      const lat = 90 - (y + 0.5) / MASK_H * 180;
      for (let pi = 0; pi < polys.length; pi++) {
        const rings = polys[pi];
        const xs = [];
        for (let ri = 0; ri < rings.length; ri++) {
          const r = rings[ri];
          for (let k = 0; k < r.length - 1; k++) {
            const a = r[k], b = r[k + 1];
            const lat1 = a[1], lat2 = b[1];
            if ((lat1 <= lat && lat2 > lat) || (lat2 <= lat && lat1 > lat)) {
              const t = (lat - lat1) / (lat2 - lat1);
              xs.push(a[0] + t * (b[0] - a[0]));
            }
          }
        }
        if (xs.length < 2) continue;
        xs.sort(function (m, n) { return m - n; });
        for (let s = 0; s + 1 < xs.length; s += 2) {
          let x0 = Math.floor((xs[s] + 180) / 360 * MASK_W);
          let x1 = Math.ceil((xs[s + 1] + 180) / 360 * MASK_W);
          x0 = Math.max(0, x0); x1 = Math.min(MASK_W, x1);
          for (let x = x0; x < x1; x++) mask[y * MASK_W + x] = 1;
        }
      }
    }
    return mask;
  }

  function isLand(lat, lon) {
    if (!MASK) MASK = buildMask();
    const x = Math.floor((lon + 180) / 360 * MASK_W);
    const y = Math.floor((90 - lat) / 180 * MASK_H);
    if (x < 0 || x >= MASK_W || y < 0 || y >= MASK_H) return false;
    return MASK[y * MASK_W + x] === 1;
  }

  // Standard outside-viewer mapping: lon=0 faces +Z (camera), east -> +X (right),
  // north -> +Y (up). This keeps continents (and event markers) un-mirrored so
  // longitudes render on the correct side (e.g. Nairobi in East Africa, not West).
  function llToVec(lat, lon) {
    const la = lat * DEG, lo = lon * DEG;
    return [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];
  }

  function Globe(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dots = [];
    this.clusters = [];
    this.rotY = -0.35;     // center ~lon 20 (Africa / Europe)
    this.rotX = 0.32;      // tilt so northern hemisphere reads naturally
    this.spin = 0.0014;
    this.paused = false;
    this.zoom = 1;
    this.targetZoom = 1;
    this.dragging = false;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.onMarkerClick = null;
    this.onMarkerHover = null;
    this.hoverId = null;
    this.highlight = null;   // { lat, lon, color, id } — red search-result marker
    this.userLoc = null;     // { lat, lon } — blue "you are here" marker
    this._buildDots();
    this._buildCoast();
    this._bind();
    this.resize();
  }

  // Continent coastline polylines (unit vectors), from the same land data as the
  // dots. Drawn faintly UNDER the dots so the line never sits on top of a marker.
  Globe.prototype._buildCoast = function () {
    this.coast = [];
    const data = global.EVENTUALLY_LAND;
    if (!data || !data.features) return;
    for (let fi = 0; fi < data.features.length; fi++) {
      const g = data.features[fi].geometry; if (!g) continue;
      const polys = g.type === 'Polygon' ? [g.coordinates] : (g.type === 'MultiPolygon' ? g.coordinates : []);
      for (let pi = 0; pi < polys.length; pi++) {
        const rings = polys[pi];
        for (let ri = 0; ri < rings.length; ri++) {
          const ring = rings[ri], vs = [];
          for (let k = 0; k < ring.length; k++) vs.push(llToVec(ring[k][1], ring[k][0]));
          if (vs.length > 1) this.coast.push(vs);
        }
      }
    }
  };

  Globe.prototype._drawCoast = function (ctx, R) {
    if (!this.coast) return;
    ctx.strokeStyle = 'rgba(96,90,82,0.22)';    // very faint grey coastline
    ctx.lineWidth = 0.7;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < this.coast.length; i++) {
      const ring = this.coast[i];
      let started = false;
      for (let k = 0; k < ring.length; k++) {
        const rv = this._rotate(ring[k]);
        if (rv[2] > 0.04) {                    // front hemisphere only
          const p = this._project(rv, R);
          if (started) ctx.lineTo(p.x, p.y); else { ctx.moveTo(p.x, p.y); started = true; }
        } else started = false;                // pen up across the horizon
      }
    }
    ctx.stroke();
  };

  // Even-area dots via Fibonacci sphere, kept only where there is land.
  Globe.prototype._buildDots = function () {
    const N = 28000;                 // +75% density, evenly spread (Fibonacci)
    const inc = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const phi = i * inc;
      const x = Math.cos(phi) * r, z = Math.sin(phi) * r;
      const lat = Math.asin(y) / DEG;
      const lon = Math.atan2(x, z) / DEG;        // match llToVec handedness
      if (isLand(lat, lon)) this.dots.push([x, y, z]);
    }
  };

  Globe.prototype.setClusters = function (clusters) { this.clusters = clusters; };

  // Drop a prominent red marker at a location (used when a search result is chosen).
  // Always drawn, regardless of zoom level-of-detail, so any event is findable.
  Globe.prototype.setHighlight = function (lat, lon, opts) {
    this.highlight = (lat == null) ? null
      : { lat: lat, lon: lon, color: (opts && opts.color) || '#ff3b30', id: opts && opts.id };
  };
  Globe.prototype.clearHighlight = function () { this.highlight = null; };

  // "You are here" marker (blue), shown when the user sets their location.
  Globe.prototype.setUserLocation = function (lat, lon) {
    this.userLoc = (lat == null) ? null : { lat: lat, lon: lon };
  };
  Globe.prototype.clearUserLocation = function () { this.userLoc = null; };
  Globe.prototype.setPaused = function (p) { this.paused = p; };
  Globe.prototype.togglePaused = function () { this.paused = !this.paused; return this.paused; };
  Globe.prototype.zoomBy = function (f) {
    this.targetZoom = Math.max(0.75, Math.min(3.4, this.targetZoom * f));
  };

  Globe.prototype.resize = function () {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.canvas.width = w * this.dpr;
    this.canvas.height = h * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.w = w; this.h = h;
    this.cx = w / 2;
    this.cy = h / 2;
    this.baseR = Math.min(w, h) * 0.40;
  };

  Globe.prototype._bind = function () {
    const self = this, cv = this.canvas;
    let lastX = 0, lastY = 0, moved = 0;

    function down(e) {
      self.dragging = true; moved = 0;
      const p = point(e); lastX = p.x; lastY = p.y;
      cv.classList.add('grabbing');
    }
    function move(e) {
      const p = point(e);
      if (self.dragging) {
        const dx = p.x - lastX, dy = p.y - lastY;
        self.rotY += dx * 0.005;
        self.rotX = Math.max(-1.3, Math.min(1.3, self.rotX + dy * 0.005));
        moved += Math.abs(dx) + Math.abs(dy);
        lastX = p.x; lastY = p.y;
      } else {
        self._hoverTest(p.x, p.y);
      }
    }
    function up(e) {
      if (self.dragging && moved < 6) { const p = point(e); self._clickTest(p.x, p.y); }
      self.dragging = false;
      cv.classList.remove('grabbing');
    }
    function point(e) {
      const r = cv.getBoundingClientRect();
      const t = e.touches ? e.touches[0] : e;
      return { x: t.clientX - r.left, y: t.clientY - r.top };
    }

    cv.addEventListener('mousedown', down);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    cv.addEventListener('touchstart', function (e) { down(e); }, { passive: true });
    cv.addEventListener('touchmove', function (e) { move(e); }, { passive: true });
    cv.addEventListener('touchend', up);
    cv.addEventListener('wheel', function (e) {
      e.preventDefault();
      self.zoomBy(e.deltaY < 0 ? 1.12 : 0.89);
    }, { passive: false });
    window.addEventListener('resize', function () { self.resize(); });
  };

  Globe.prototype._rotate = function (v) {
    const cy = Math.cos(this.rotY), sy = Math.sin(this.rotY);
    const x = cy * v[0] + sy * v[2];
    const z = -sy * v[0] + cy * v[2];
    const y = v[1];
    const cx = Math.cos(this.rotX), sx = Math.sin(this.rotX);
    return [x, cx * y - sx * z, sx * y + cx * z];
  };

  Globe.prototype._project = function (rv, radius) {
    const d = 2.6;
    const persp = d / (d - rv[2]);
    return { x: this.cx + rv[0] * radius * persp, y: this.cy - rv[1] * radius * persp, z: rv[2], persp: persp };
  };

  Globe.prototype.flyTo = function (lat, lon) {
    this.targetRotY = -lon * DEG;       // rotY = -lon centers that longitude
    this.targetRotX = lat * DEG;
    this._flying = true;
  };

  Globe.prototype._hoverTest = function (mx, my) {
    const id = this._pick(mx, my, 20);
    if (id !== this.hoverId) {
      this.hoverId = id;
      this.canvas.style.cursor = id ? 'pointer' : 'grab';
      if (this.onMarkerHover) this.onMarkerHover(id);
    }
  };
  Globe.prototype._clickTest = function (mx, my) {
    const id = this._pick(mx, my, 24);
    if (id && this.onMarkerClick) this.onMarkerClick(id);
  };
  Globe.prototype._pick = function (mx, my, tol) {
    let best = null, bestD = tol * tol;
    for (let i = 0; i < this.clusters.length; i++) {
      const c = this.clusters[i];
      if (!c._screen || !c._screen.visible) continue;
      let dx = c._screen.x - mx, dy = c._screen.y - my;
      let d = dx * dx + dy * dy;
      if (c._spikeTop) {                       // clicking the raised spike works too
        const ex = c._spikeTop.x - mx, ey = c._spikeTop.y - my;
        const d2 = ex * ex + ey * ey; if (d2 < d) d = d2;
      }
      if (d < bestD) { bestD = d; best = c.id; }
    }
    return best;
  };

  Globe.prototype.render = function () {
    const ctx = this.ctx, R = this.baseR * this.zoom;

    this.zoom += (this.targetZoom - this.zoom) * 0.12;
    if (this._flying) {
      this.rotY += (this.targetRotY - this.rotY) * 0.08;
      this.rotX += (this.targetRotX - this.rotX) * 0.08;
      if (Math.abs(this.targetRotY - this.rotY) < 0.01) this._flying = false;
    } else if (!this.dragging && !this.paused) {
      this.rotY += this.spin;
    }

    ctx.clearRect(0, 0, this.w, this.h);

    // Atmosphere glow — warm clay haze (brand "Clay")
    const ar = R * 1.18;
    const ag = ctx.createRadialGradient(this.cx, this.cy, R * 0.7, this.cx, this.cy, ar);
    ag.addColorStop(0, 'rgba(203,90,60,0)');
    ag.addColorStop(0.80, 'rgba(203,90,60,0.06)');
    ag.addColorStop(0.93, 'rgba(203,90,60,0.16)');
    ag.addColorStop(1, 'rgba(203,90,60,0)');
    ctx.fillStyle = ag;
    ctx.beginPath(); ctx.arc(this.cx, this.cy, ar, 0, Math.PI * 2); ctx.fill();

    // Cream sphere with soft warm shading (a planet against grey space)
    const og = ctx.createRadialGradient(this.cx - R * 0.38, this.cy - R * 0.42, R * 0.1, this.cx, this.cy, R);
    og.addColorStop(0, '#fbf5ec');
    og.addColorStop(0.7, '#efe5d6');
    og.addColorStop(1, '#e2d6c4');
    ctx.fillStyle = og;
    ctx.beginPath(); ctx.arc(this.cx, this.cy, R, 0, Math.PI * 2); ctx.fill();

    this._drawCoast(ctx, R);                    // faint continent outlines, under the dots

    // Land dots (front hemisphere), batched into depth tiers so we set
    // fillStyle a handful of times per frame instead of once per dot.
    const dotScale = this.zoom > 1.8 ? 1.25 : 1;
    const TIERS = 6;
    const cy = Math.cos(this.rotY), sy = Math.sin(this.rotY);
    const cx2 = Math.cos(this.rotX), sx2 = Math.sin(this.rotX);
    const d = 2.6;
    const buckets = this._buckets || (this._buckets = []);
    for (let t = 0; t < TIERS; t++) buckets[t] = buckets[t] || [];
    for (let t = 0; t < TIERS; t++) buckets[t].length = 0;

    for (let i = 0; i < this.dots.length; i++) {
      const v = this.dots[i];
      const zr = -sy * v[0] + cy * v[2];
      const yr = v[1];
      const depth = sx2 * yr + cx2 * zr;          // rotated z
      if (depth <= 0.015) continue;
      const xr = cy * v[0] + sy * v[2];
      const y2 = cx2 * yr - sx2 * zr;
      const persp = d / (d - depth);
      const px = this.cx + xr * R * persp;
      const py = this.cy - y2 * R * persp;
      const size = (0.42 + depth * 0.35) * persp * dotScale;   // 50% smaller dots
      let tier = (depth * TIERS) | 0; if (tier >= TIERS) tier = TIERS - 1;
      const b = buckets[tier]; b.push(px, py, size);
    }
    for (let t = 0; t < TIERS; t++) {
      const b = buckets[t]; if (!b.length) continue;
      const depth = (t + 0.5) / TIERS;
      // black/ink land dots on the cream sphere, nearer = darker
      ctx.fillStyle = 'rgba(33,26,21,' + (0.34 + depth * 0.55).toFixed(2) + ')';
      ctx.beginPath();
      for (let k = 0; k < b.length; k += 3) {
        ctx.moveTo(b[k] + b[k + 2], b[k + 1]);
        ctx.arc(b[k], b[k + 1], b[k + 2], 0, Math.PI * 2);
      }
      ctx.fill();
    }

    this._drawMarkers(ctx, R);
  };

  // "Living planet" markers: every visible cluster is a calm DOT (pulsing softly
  // if it has a live or soon event); a budgeted set of clusters also breathe a
  // SPIKE that rises/holds/falls/disappears independently. Look stays clean at any
  // scale because we only ever draw the ~clusters, never per-event.
  Globe.prototype._drawMarkers = function (ctx, R) {
    const t = performance.now() / 1000;
    const zoom = this.zoom;

    // PASS 1 — dots for every visible cluster within its zoom level-of-detail
    for (let i = 0; i < this.clusters.length; i++) {
      const c = this.clusters[i];
      c._screen = c._screen || {};
      c._screen.visible = false; c._spikeTop = null;
      if (!c._visible) continue;
      if (zoom < (c._lodMin || 0)) continue;
      const base = llToVec(c.lat, c.lon);
      const rv = this._rotate(base);
      if (rv[2] <= 0.02) continue;                       // backface cull
      const p = this._project(rv, R);
      c._screen.x = p.x; c._screen.y = p.y; c._screen.visible = true;
      c._base = base; c._rv = rv; c._p = p;
      const hovered = this.hoverId === c.id;
      const pop = c._pop || 0.2;
      const col = c._color || '#CB5A3C';
      const live = c._hasLive;
      const dotBase = 0.8 + pop * 1.6;                   // shared base size (dots + spike caps)
      c._dotBase = dotBase;
      let r = dotBase * p.persp;
      if (c._pulse) {                                    // soft, slow, staggered; sharper when live
        const pulse = 0.5 + 0.5 * Math.sin(t * 1.1 + (c.lat + c.lon));
        r *= 1 + pulse * (live ? 0.42 : 0.22);
        ctx.shadowColor = hexA(col, live ? 0.7 : 0.4);
        ctx.shadowBlur = (live ? 8 : 4) + pop * 7 + pulse * (live ? 9 : 5);
      } else {
        ctx.shadowColor = hexA(col, 0.3); ctx.shadowBlur = 2 + pop * 4;
      }
      if (hovered) r += 1.6;
      ctx.fillStyle = hexA(col, live ? 1 : 0.9);
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      if (live) {                                        // crisp ring makes live-now pop
        ctx.strokeStyle = hexA(col, 0.95); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, r + 1.4, 0, Math.PI * 2); ctx.stroke();
      }
      if (c._hasNative) {                                 // Eventually-published: cream halo
        ctx.strokeStyle = 'rgba(255,250,243,0.95)'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(p.x, p.y, r + 2.6, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = hexA(col, 0.5); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, r + 4.4, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,250,243,' + (live ? 0.72 : 0.5) + ')';
      ctx.beginPath(); ctx.arc(p.x - r * 0.28, p.y - r * 0.28, r * 0.24, 0, Math.PI * 2); ctx.fill();
      if (hovered) { ctx.strokeStyle = hexA(col, 0.9); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(p.x, p.y, r + 6, 0, Math.PI * 2); ctx.stroke(); }
    }

    // PASS 2 — breathing spikes (budgeted set), on top of the dots
    for (let i = 0; i < this.clusters.length; i++) {
      const c = this.clusters[i];
      if (!c._spike || !c._screen.visible) continue;
      const h = this._spikeHeight(t, c);
      if (h <= 0.001) continue;
      const sponsored = c._spikeKind === 'sponsored';
      const col = sponsored ? '#CB5A3C' : (c._color || '#CB5A3C');
      const p = c._p, base = c._base;
      const len = (sponsored ? 0.32 : 0.22) * (0.55 + (c._pop || 0.3)) * h;
      const topV = [base[0] * (1 + len), base[1] * (1 + len), base[2] * (1 + len)];
      const pt = this._project(this._rotate(topV), R);
      const alpha = (0.5 + c._rv[2] * 0.4) * h;
      const grad = ctx.createLinearGradient(p.x, p.y, pt.x, pt.y);
      grad.addColorStop(0, hexA(col, 0.05));
      grad.addColorStop(0.5, hexA(col, alpha));
      grad.addColorStop(1, hexA(col, Math.min(1, alpha + 0.25)));
      ctx.strokeStyle = grad;
      ctx.lineWidth = ((sponsored ? 2.4 : 1.6) + (c._pop || 0.3) * 2.4) * p.persp;
      ctx.lineCap = 'round';
      ctx.shadowColor = hexA(col, sponsored ? 0.7 : 0.45); ctx.shadowBlur = (sponsored ? 20 : 12) * h;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(pt.x, pt.y); ctx.stroke();
      ctx.shadowBlur = 0;
      const cap = (c._dotBase || (0.8 + (c._pop || 0.3) * 1.6)) * p.persp;   // same size as a non-rising dot
      ctx.fillStyle = col; ctx.shadowColor = hexA(col, sponsored ? 0.8 : 0.5); ctx.shadowBlur = (sponsored ? 16 : 9) * h;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, cap, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,250,243,0.6)';
      ctx.beginPath(); ctx.arc(pt.x - cap * 0.28, pt.y - cap * 0.28, cap * 0.26, 0, Math.PI * 2); ctx.fill();
      if (sponsored) {
        ctx.strokeStyle = 'rgba(224,135,95,' + (0.5 * h).toFixed(2) + ')'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(pt.x, pt.y, cap + 4, 0, Math.PI * 2); ctx.stroke();
      }
      c._spikeTop = { x: pt.x, y: pt.y };
    }

    this._drawHighlight(ctx, R, t);
    this._drawUserLocation(ctx, R, t);
  };

  // Blue "you are here" marker at the user's chosen location (persistent).
  Globe.prototype._drawUserLocation = function (ctx, R, t) {
    const u = this.userLoc; if (!u) return;
    const base = llToVec(u.lat, u.lon);
    const rv = this._rotate(base);
    if (rv[2] <= 0.02) return;                 // behind the globe
    const p = this._project(rv, R);
    const col = '#2e7dff';
    const ping = (t * 0.7) % 1;
    ctx.strokeStyle = hexA(col, (1 - ping) * 0.7); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, 7 + ping * 20, 0, Math.PI * 2); ctx.stroke();
    const pulse = 0.5 + 0.5 * Math.sin(t * 3);
    const r = (5 + pulse * 1.2) * p.persp;
    ctx.shadowColor = col; ctx.shadowBlur = 14; ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath(); ctx.arc(p.x - r * 0.3, p.y - r * 0.3, r * 0.3, 0, Math.PI * 2); ctx.fill();
  };

  // Red search-result marker: a pulsing dot with an expanding "radar ping" ring,
  // drawn on top of everything and never culled by zoom LOD.
  Globe.prototype._drawHighlight = function (ctx, R, t) {
    const hl = this.highlight; if (!hl) return;
    const base = llToVec(hl.lat, hl.lon);
    const rv = this._rotate(base);
    if (rv[2] <= 0.02) return;                 // behind the globe right now
    const p = this._project(rv, R);
    const col = hl.color || '#ff3b30';
    const ping = (t * 0.85) % 1;               // expanding ring, loops 0..1
    ctx.strokeStyle = hexA(col, (1 - ping) * 0.85);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, 6 + ping * 24, 0, Math.PI * 2); ctx.stroke();
    const pulse = 0.5 + 0.5 * Math.sin(t * 4.2);
    const r = (4.6 + pulse * 1.6) * p.persp;
    ctx.shadowColor = col; ctx.shadowBlur = 16;
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = hexA(col, 0.95); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(p.x, p.y, r + 2.5, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.beginPath(); ctx.arc(p.x - r * 0.3, p.y - r * 0.3, r * 0.3, 0, Math.PI * 2); ctx.fill();
  };

  // Independent breathing cycle per cluster, in ABSOLUTE seconds so spikes linger
  // (~10s held up, ~14s for sponsored) — easy to click before they fall again.
  Globe.prototype._spikeHeight = function (t, c) {
    const sponsored = c._spikeKind === 'sponsored';
    if (c._spikeRise == null) {
      c._spikeRise = 1.3;
      c._spikeHold = sponsored ? 34 : 30;                     // stay up ~30s (sponsored a touch longer)
      c._spikeFall = 1.8;
      c._spikeGap = 6 + this._hash(c.id) * 9;                 // calm gap, randomized
      c._spikePeriod = c._spikeRise + c._spikeHold + c._spikeFall + c._spikeGap;
      c._spikePhase = this._hash(c.id + 'p') * c._spikePeriod;
    }
    const x = (t + c._spikePhase) % c._spikePeriod;
    let h;
    if (x < c._spikeRise) h = x / c._spikeRise;
    else if (x < c._spikeRise + c._spikeHold) h = 1;
    else if (x < c._spikeRise + c._spikeHold + c._spikeFall) h = 1 - (x - c._spikeRise - c._spikeHold) / c._spikeFall;
    else return 0;                                            // the calm gap
    return h * h * (3 - 2 * h);                                // smoothstep
  };

  Globe.prototype._hash = function (s) {
    let h = 2166136261; s = '' + s;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 1000) / 1000;                          // stable 0..1
  };

  function hexA(hex, a) {
    if (hex[0] !== '#') return hex;
    const n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  global.EventuallyGlobe = Globe;
})(window);

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
    this._buildDots();
    this._bind();
    this.resize();
  }

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
      const dx = c._screen.x - mx, dy = c._screen.y - my;
      const d = dx * dx + dy * dy;
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

    this._drawClusters(ctx, R, 'upcoming');
    this._drawClusters(ctx, R, 'live');
    this._drawCounts(ctx);
  };

  // One marker per location (cluster). A location towers as a pillar if any of
  // its events fall on the selected day, otherwise it is a glowing dot. Size /
  // brightness / height scale with the location's aggregate popularity.
  Globe.prototype._drawClusters = function (ctx, R, phase) {
    for (let i = 0; i < this.clusters.length; i++) {
      const c = this.clusters[i];
      c._screen = c._screen || {};
      if (c._renderType !== phase || !c._visible) continue;

      const base = llToVec(c.lat, c.lon);
      const rv = this._rotate(base);
      const front = rv[2] > -0.05;
      const p = this._project(rv, R);
      const hovered = this.hoverId === c.id;
      const pop = c._pop || 0.2;
      const t = performance.now() / 1000;
      const pulse = 0.5 + 0.5 * Math.sin(t * 2 + c.lat);
      const col = c._color || '#ffb547';
      const featured = c._featured;

      c._screen.x = p.x; c._screen.y = p.y;
      c._screen.visible = front && rv[2] > 0;
      c._label = null;
      if (!front) continue;

      if (phase === 'live') {
        const h = 0.16 + pop * 0.42 + (hovered ? 0.08 : 0);
        const topV = [base[0] * (1 + h), base[1] * (1 + h), base[2] * (1 + h)];
        const pt = this._project(this._rotate(topV), R);
        const alpha = 0.55 + rv[2] * 0.4;
        const grad = ctx.createLinearGradient(p.x, p.y, pt.x, pt.y);
        grad.addColorStop(0, hexA(col, 0.08));
        grad.addColorStop(0.5, hexA(col, alpha));
        grad.addColorStop(1, hexA(col, Math.min(1, alpha + 0.25)));
        ctx.strokeStyle = grad;
        ctx.lineWidth = (1.6 + pop * 3.4) * p.persp;
        ctx.lineCap = 'round';
        ctx.shadowColor = hexA(col, 0.5); ctx.shadowBlur = 10 + pop * 14;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(pt.x, pt.y); ctx.stroke();
        ctx.shadowBlur = 0;
        const cap = (2.6 + pop * 4 + (hovered ? 2 : 0)) * p.persp;
        ctx.fillStyle = col; ctx.shadowColor = hexA(col, 0.6); ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.arc(pt.x, pt.y, cap, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255,250,243,0.6)';   // small specular, keeps tip solid
        ctx.beginPath(); ctx.arc(pt.x - cap * 0.28, pt.y - cap * 0.28, cap * 0.26, 0, Math.PI * 2); ctx.fill();
        if (featured) {
          ctx.strokeStyle = 'rgba(224,135,95,' + (0.55 + pulse * 0.4).toFixed(2) + ')';
          ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.arc(pt.x, pt.y, cap + 4 + pulse * 2, 0, Math.PI * 2); ctx.stroke();
        }
        c._screen.x = pt.x; c._screen.y = pt.y;          // click target = the cap
        c._label = { x: pt.x, y: pt.y, r: cap, col: col, hovered: hovered };
      } else {
        if (rv[2] <= 0) continue;
        const r = (2.2 + pop * 5.0 + (hovered ? 2.5 : 0)) * p.persp;
        ctx.shadowColor = hexA(col, 0.5); ctx.shadowBlur = 5 + pop * 14 + pulse * 3;
        ctx.fillStyle = hexA(col, 0.95);
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        // small off-centre cream specular so the dot reads solid (not hollow)
        ctx.fillStyle = 'rgba(255,250,243,0.55)';
        ctx.beginPath(); ctx.arc(p.x - r * 0.28, p.y - r * 0.28, r * 0.22, 0, Math.PI * 2); ctx.fill();
        if (featured) {
          ctx.strokeStyle = 'rgba(224,135,95,' + (0.55 + pulse * 0.4).toFixed(2) + ')';
          ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.arc(p.x, p.y, r + 4 + pulse * 2, 0, Math.PI * 2); ctx.stroke();
        }
        if (hovered) {
          ctx.strokeStyle = hexA(col, 0.9); ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.arc(p.x, p.y, r + 7 + pulse * 3, 0, Math.PI * 2); ctx.stroke();
        }
        c._label = { x: p.x, y: p.y, r: r, col: col, hovered: hovered };
      }
    }
  };

  // Count badges drawn on top (crisp text, above the glow). Shown when a
  // location has 2+ events on the selected date.
  Globe.prototype._drawCounts = function (ctx) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < this.clusters.length; i++) {
      const c = this.clusters[i];
      const L = c._label;
      if (!L || c._visible < 2) continue;
      const n = c._visible;
      const txt = n > 99 ? '99+' : String(n);
      const fs = Math.max(9, Math.min(15, L.r + 5));
      const bx = L.x, by = L.y - L.r - fs * 0.9;       // float just above the marker
      const pad = fs * 0.5;
      ctx.font = '700 ' + fs + "px 'Space Mono', ui-monospace, monospace";
      const tw = ctx.measureText(txt).width;
      const bw = tw + pad * 2, bh = fs + pad * 0.7;
      // clay pill = the "going / lands here" indicator, cream numerals
      ctx.fillStyle = L.hovered ? '#8A3B1E' : '#CB5A3C';
      ctx.strokeStyle = 'rgba(244,236,226,0.9)';
      ctx.lineWidth = 1.4;
      roundRect(ctx, bx - bw / 2, by - bh / 2, bw, bh, bh / 2);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#F4ECE2';
      ctx.fillText(txt, bx, by + 0.5);
    }
  };

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function hexA(hex, a) {
    if (hex[0] !== '#') return hex;
    const n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  global.EventuallyGlobe = Globe;
})(window);

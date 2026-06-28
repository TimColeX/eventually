/* Eventually — time-travel timeline. Scrub past → present → future;
 * fires onChange(selectedDate) so the globe re-derives event markers. */
(function (global) {
  'use strict';

  function Timeline(el, opts) {
    this.el = el;
    this.today = opts.today;
    this.min = 0;              // days — starts at TODAY (forward-only, no past)
    this.max = 60;
    this.value = 0;            // offset in days from today
    this.onChange = opts.onChange || function () {};
    this.getDensity = opts.getDensity || function () { return 0; };
    this._build();
  }

  Timeline.prototype._build = function () {
    const self = this;
    this.el.innerHTML =
      '<div class="tl-head">' +
        '<button class="tl-btn" data-step="-1" title="Previous day">‹</button>' +
        '<div class="tl-date"><span class="tl-label">SELECTED</span><strong class="tl-value"></strong></div>' +
        '<button class="tl-btn" data-step="1" title="Next day">›</button>' +
        '<button class="tl-today" title="Jump to today">● TODAY</button>' +
      '</div>' +
      '<div class="tl-track">' +
        '<canvas class="tl-spark"></canvas>' +
        '<input type="range" class="tl-range" min="' + this.min + '" max="' + this.max + '" value="0" step="1">' +
        '<div class="tl-ticks"></div>' +
      '</div>';

    this.range = this.el.querySelector('.tl-range');
    this.valueEl = this.el.querySelector('.tl-value');
    this.spark = this.el.querySelector('.tl-spark');
    this.ticks = this.el.querySelector('.tl-ticks');

    this.range.addEventListener('input', function () {
      self.value = parseInt(self.range.value, 10);
      self._update();
    });
    this.el.querySelector('.tl-today').addEventListener('click', function () {
      self.set(0);
    });
    this.el.querySelectorAll('.tl-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        self.set(self.value + parseInt(b.dataset.step, 10));
      });
    });

    this._buildTicks();
    window.addEventListener('resize', function () { self._drawSpark(); });
    this._update();
  };

  Timeline.prototype._buildTicks = function () {
    let html = '';
    for (let d = this.min; d <= this.max; d += 15) {
      const dt = new Date(this.today); dt.setUTCDate(dt.getUTCDate() + d);
      const pct = (d - this.min) / (this.max - this.min) * 100;
      const lbl = dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      html += '<span style="left:' + pct + '%">' + lbl + '</span>';
    }
    this.ticks.innerHTML = html;
  };

  Timeline.prototype.set = function (v) {
    this.value = Math.max(this.min, Math.min(this.max, v));
    this.range.value = this.value;
    this._update();
  };

  Timeline.prototype.selectedDate = function () {
    const d = new Date(this.today);
    d.setUTCDate(d.getUTCDate() + this.value);
    return d;
  };

  Timeline.prototype._update = function () {
    const d = this.selectedDate();
    const opts = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' };
    let label = d.toLocaleDateString(undefined, opts);
    if (this.value === 0) label = 'Today · ' + label;
    else if (this.value === 1) label = 'Tomorrow · ' + label;
    else if (this.value === -1) label = 'Yesterday · ' + label;
    this.valueEl.textContent = label;
    this.onChange(d);
    this._drawSpark();
  };

  // Density sparkline across the whole range (event count per day band).
  Timeline.prototype._drawSpark = function () {
    const c = this.spark, dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = c.clientWidth, h = c.clientHeight;
    if (!w) return;
    c.width = w * dpr; c.height = h * dpr;
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const span = this.max - this.min;
    const sel = (this.value - this.min) / span * w;
    for (let d = this.min; d <= this.max; d++) {
      const count = this.getDensity(d);
      const x = (d - this.min) / span * w;
      const bh = Math.min(h - 4, 3 + count * 7);
      const active = Math.abs(d - this.value) <= 1;
      ctx.fillStyle = active ? 'rgba(203,90,60,0.95)' : 'rgba(33,26,21,0.28)';  // clay / ink
      ctx.fillRect(x - 1.2, h - bh, 2.4, bh);
    }
    // playhead
    ctx.fillStyle = 'rgba(138,59,30,0.9)';   // ember
    ctx.fillRect(sel - 0.75, 0, 1.5, h);
  };

  global.EventuallyTimeline = Timeline;
})(window);

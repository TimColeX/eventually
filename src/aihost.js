/* Eventually — the "eventually" Host. A radio-DJ / tour-guide / concierge /
 * news-anchor personality. Captions rotate continuously (always live); pressing
 * play makes the Host speak them aloud (browser speech). Sponsor reads are tagged.
 */
(function (global) {
  'use strict';

  function AIHost(el, opts) {
    this.el = el;
    this.getLine = opts.getLine;          // () -> { text, kind, sponsor? }
    this.onPlay = opts.onPlay || function () {};
    this.onPause = opts.onPause || function () {};
    this.onSpeakStart = opts.onSpeakStart || function () {};
    this.onSpeakEnd = opts.onSpeakEnd || function () {};
    this.speaking = false;
    this.amp = 0.14;
    this.bars = 40;
    this.phase = [];
    for (let i = 0; i < this.bars; i++) this.phase.push(Math.random() * Math.PI * 2);
    this.current = null;
    this.INTRO = 10000;   // music alone before the Host first speaks (first play)
    this.SHORT_INTRO = 3000;  // shorter lead-in when resuming later
    this.GAP = 10000;     // music between spoken segments (jittered for a live feel)
    this.IDLE = 6500;     // silent caption ticker pace when not playing
    this._everPlayed = false;
    this._build();
    this._rotate();                       // first caption immediately
    this._timer = setInterval(this._rotate.bind(this), this.IDLE);
    this._loop();
  }

  AIHost.prototype._build = function () {
    const self = this;
    this.el.innerHTML =
      '<button class="ah-play" aria-label="Play the Host aloud">' +
        '<svg viewBox="0 0 24 24" class="ic-play"><path d="M8 5v14l11-7z"/></svg>' +
        '<svg viewBox="0 0 24 24" class="ic-pause" style="display:none"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>' +
      '</button>' +
      '<div class="ah-body">' +
        '<div class="ah-label">eventually Host <span class="ah-live">● LIVE</span></div>' +
        '<div class="ah-caption"><span class="ah-spon" style="display:none">SPONSORED</span>' +
        '<span class="ah-text"></span></div>' +
      '</div>' +
      '<canvas class="ah-wave"></canvas>';

    this.canvas = this.el.querySelector('.ah-wave');
    this.icPlay = this.el.querySelector('.ic-play');
    this.icPause = this.el.querySelector('.ic-pause');
    this.textEl = this.el.querySelector('.ah-text');
    this.sponEl = this.el.querySelector('.ah-spon');
    this.el.querySelector('.ah-play').addEventListener('click', function () { self.toggle(); });
  };

  AIHost.prototype._rotate = function () {
    if (!this.getLine) return;
    const line = this.getLine();
    if (!line) return;
    this.current = line;
    this.sponEl.style.display = line.kind === 'sponsor' ? '' : 'none';
    this.el.querySelector('.ah-caption').classList.toggle('is-sponsor', line.kind === 'sponsor');
    // fade swap
    this.textEl.style.opacity = 0;
    const self = this;
    setTimeout(function () { self.textEl.textContent = line.text; self.textEl.style.opacity = 1; }, 180);
    if (this.speaking) this._speakAndContinue(line.text);
  };

  // Speak one segment, then leave a ~GAP of music before advancing to the next.
  AIHost.prototype._speakAndContinue = function (text) {
    const self = this;
    function afterSegment() {
      self.onSpeakEnd();                                   // swell music back up
      if (!self.speaking) return;
      clearTimeout(self._gapTimer);
      self._gapTimer = setTimeout(function () { if (self.speaking) self._rotate(); }, self._jitter(self.GAP, 2500));
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.0; u.pitch = 1.0; u.volume = 1.0;
      u.onstart = function () { self.amp = 0.6; self.onSpeakStart(); };   // duck music under voice
      u.onboundary = function () { self.amp = 0.55 + Math.random() * 0.4; };
      u.onend = afterSegment;
      u.onerror = afterSegment;
      window.speechSynthesis.speak(u);
    } else {
      // no speech engine: simulate a read so the music rhythm still works
      self.amp = 0.5;
      const read = Math.min(9000, 2600 + text.length * 45);
      clearTimeout(self._readTimer);
      self._readTimer = setTimeout(afterSegment, read);
    }
  };

  AIHost.prototype.toggle = function () { this.speaking ? this.stop() : this.play(); };

  AIHost.prototype.play = function () {
    this.speaking = true;
    this.icPlay.style.display = 'none';
    this.icPause.style.display = '';
    this.onPlay();                          // music starts and plays alone first
    if (this._timer) { clearInterval(this._timer); this._timer = null; }   // pause silent ticker
    const self = this;
    // full ~10s intro on the first play; a short lead-in on later resumes
    const lead = this._everPlayed ? this._jitter(this.SHORT_INTRO, 800) : this._jitter(this.INTRO, 1200);
    this._everPlayed = true;
    clearTimeout(this._introTimer);
    this._introTimer = setTimeout(function () { if (self.speaking) self._rotate(); }, lead);
  };

  AIHost.prototype._jitter = function (base, spread) {
    return Math.max(1500, base + (Math.random() * 2 - 1) * spread);
  };
  AIHost.prototype.stop = function () {
    this.speaking = false;
    this.icPlay.style.display = '';
    this.icPause.style.display = 'none';
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    clearTimeout(this._introTimer); clearTimeout(this._gapTimer); clearTimeout(this._readTimer);
    this.onPause();                         // stop the music bed
    if (!this._timer) this._timer = setInterval(this._rotate.bind(this), this.IDLE);   // resume silent ticker
  };

  AIHost.prototype._loop = function () {
    const self = this;
    function frame() { self._draw(); requestAnimationFrame(frame); }
    frame();
  };

  AIHost.prototype._draw = function () {
    const c = this.canvas, dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = c.clientWidth, h = c.clientHeight;
    if (!w) return;
    if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const target = this.speaking ? this.amp : 0.12;
    this.amp += (target - this.amp) * 0.08;
    if (this.speaking) this.amp *= 0.96;

    const t = performance.now() / 1000;
    const gap = w / this.bars, mid = h / 2;
    for (let i = 0; i < this.bars; i++) {
      const env = Math.sin((i / this.bars) * Math.PI);
      const wob = 0.35 + 0.65 * Math.abs(Math.sin(t * 3 + this.phase[i]));
      const bh = Math.max(2, env * wob * this.amp * h * 1.6);
      const x = i * gap + gap / 2;
      const hue = 16 + i * 0.5;
      ctx.fillStyle = this.speaking ? 'hsla(' + hue + ',62%,52%,0.95)' : 'rgba(138,59,30,0.4)';
      ctx.beginPath();
      roundRect(ctx, x - gap * 0.28, mid - bh / 2, gap * 0.56, bh, Math.min(gap * 0.3, 2));
      ctx.fill();
    }
  };

  function roundRect(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
  }

  global.EventuallyAIHost = AIHost;
})(window);

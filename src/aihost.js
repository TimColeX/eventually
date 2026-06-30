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
    this.synth = opts.synth || null;       // (text, lang, kind) -> Promise<url|null> (legacy per-line)
    this.getBriefing = opts.getBriefing || null;  // () -> Promise<{url,text}|null> (shared city briefing)
    this.getOpener = opts.getOpener || null;      // () -> { text, lang, rtl } (personalized, browser voice)
    this._audio = new Audio();             // reusable element for premium-voice playback
    this._audio.preload = 'auto'; this._audio.setAttribute('playsinline', '');
    this.speaking = false;
    this.amp = 0.14;
    this.bars = 40;
    this.phase = [];
    for (let i = 0; i < this.bars; i++) this.phase.push(Math.random() * Math.PI * 2);
    this.current = null;
    this.INTRO = 10000;   // music alone before the Host first speaks (first play)
    this.SHORT_INTRO = 3000;  // shorter lead-in when resuming later
    this.GAP = 30000;     // ~30s of music between spoken segments (jittered for a live feel)
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

  // Update the caption (no audio). Shared by line rotation + briefing mode.
  AIHost.prototype._showCaption = function (line) {
    this.current = line;
    this.sponEl.style.display = line.kind === 'sponsor' ? '' : 'none';
    this.el.querySelector('.ah-caption').classList.toggle('is-sponsor', line.kind === 'sponsor');
    this.textEl.setAttribute('dir', line.rtl ? 'rtl' : 'ltr');   // Arabic etc.
    this.textEl.style.opacity = 0;
    const self = this;
    setTimeout(function () { self.textEl.textContent = line.text; self.textEl.style.opacity = 1; }, 180);
  };

  // After a spoken segment: swell music back, then leave a ~GAP before the next.
  AIHost.prototype._afterSegment = function () {
    clearInterval(this._ampTimer);
    this.onSpeakEnd();
    if (!this.speaking) return;
    const self = this;
    clearTimeout(this._gapTimer);
    this._gapTimer = setTimeout(function () { if (self.speaking) self._rotate(); }, this._jitter(this.GAP, 2500));
  };

  AIHost.prototype._rotate = function () {
    if (!this.getLine) return;
    const self = this;
    // Briefing mode (Plus): a personalized opener in the browser voice, then the
    // SHARED, cached city briefing in the premium voice (cost-optimized "radio").
    if (this.speaking && this.getBriefing) {
      if (!this._openerDone) {
        this._openerDone = true;
        const op = this.getOpener ? this.getOpener() : null;
        if (op && op.text) {
          this._showCaption({ text: op.text, kind: 'greeting', lang: op.lang, rtl: op.rtl });
          this._lang = op.lang || 'en-US';
          this._browserSpeak(op.text, function () { if (self.speaking) self._rotate(); });
          return;
        }
      }
      this.getBriefing().then(function (b) {
        if (!self.speaking) return;
        if (b && b.url) {
          self._showCaption({ text: b.text, kind: 'briefing', lang: 'en-US' });
          self._audioSpeak(b.url, b.text, self._afterSegment.bind(self));
        } else {
          self._rotateLine();    // not Plus / unavailable → free browser rotation
        }
      }).catch(function () { self._rotateLine(); });
      return;
    }
    this._rotateLine();
  };

  // Classic per-line rotation (free browser voice, or per-line synth if provided).
  AIHost.prototype._rotateLine = function () {
    const line = this.getLine();
    if (!line) return;
    this._lang = line.lang || 'en-US';                 // BCP-47 for the utterance
    this._showCaption(line);
    if (this.speaking) this._speakAndContinue(line.text);
  };

  // Speak one line, then a music GAP. Premium per-line synth if `synth` is set
  // (legacy path), otherwise the free browser voice.
  AIHost.prototype._speakAndContinue = function (text) {
    const self = this;
    const afterSegment = this._afterSegment.bind(this);
    const kind = this.current && this.current.kind;
    if (this.synth) {
      this.synth(text, this._lang, kind).then(function (url) {
        if (url && self.speaking) self._audioSpeak(url, text, afterSegment);
        else self._browserSpeak(text, afterSegment);
      }).catch(function () { self._browserSpeak(text, afterSegment); });
    } else {
      this._browserSpeak(text, afterSegment);
    }
  };

  // Premium voice: play the returned audio URL via the (gesture-unlocked) element.
  AIHost.prototype._audioSpeak = function (url, text, afterSegment) {
    const self = this, a = this._audio;
    try {
      a.onended = function () { afterSegment(); };
      a.onerror = function () { self._browserSpeak(text, afterSegment); };
      a.src = url; a.currentTime = 0;
      const p = a.play();
      const begin = function () {
        self.onSpeakStart();                               // duck music under voice
        clearInterval(self._ampTimer);
        self._ampTimer = setInterval(function () { self.amp = 0.5 + Math.random() * 0.4; }, 180);
      };
      if (p && p.then) p.then(begin).catch(function () { self._browserSpeak(text, afterSegment); });
      else begin();
    } catch (e) { self._browserSpeak(text, afterSegment); }
  };

  // Free voice: browser SpeechSynthesis (or a timed simulation if unavailable).
  AIHost.prototype._browserSpeak = function (text, afterSegment) {
    const self = this;
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.0; u.pitch = 1.0; u.volume = 1.0;
      u.lang = this._lang || 'en-US';
      const v = this._voiceFor(u.lang); if (v) u.voice = v;
      u.onstart = function () { self.amp = 0.6; self.onSpeakStart(); };   // duck music under voice
      u.onboundary = function () { self.amp = 0.55 + Math.random() * 0.4; };
      u.onend = afterSegment;
      u.onerror = afterSegment;
      self._utter = u;                       // keep a ref so the engine doesn't GC events
      try { window.speechSynthesis.resume(); } catch (e) {}   // iOS can leave it paused
      window.speechSynthesis.speak(u);
    } else {
      self.amp = 0.5;
      const read = Math.min(9000, 2600 + text.length * 45);
      clearTimeout(self._readTimer);
      self._readTimer = setTimeout(afterSegment, read);
    }
  };

  AIHost.prototype.toggle = function () { this.speaking ? this.stop() : this.play(); };

  AIHost.prototype.play = function () {
    this.speaking = true;
    this._openerDone = false;              // personalized opener plays once per session
    this.icPlay.style.display = 'none';
    this.icPause.style.display = '';
    this._unlockSpeech();                   // MUST run inside the tap to enable mobile TTS
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

  // Pick a browser voice matching the language (free, on-device). Falls back to
  // the engine default if no localized voice is installed on the device.
  AIHost.prototype._voiceFor = function (bcp) {
    if (!('speechSynthesis' in window)) return null;
    const pref = (bcp || 'en').slice(0, 2).toLowerCase();
    const vs = window.speechSynthesis.getVoices() || [];
    let exact = null, lang = null;
    for (let i = 0; i < vs.length; i++) {
      const vl = (vs[i].lang || '').toLowerCase();
      if (vl === (bcp || '').toLowerCase()) { exact = vs[i]; break; }
      if (!lang && vl.slice(0, 2) === pref) lang = vs[i];
    }
    return exact || lang || null;
  };

  // Mobile (esp. iOS Safari) only allows speech that begins inside a user gesture,
  // or after one has "unlocked" the engine. Our first real line is on a timer, so
  // we prime the engine here with a silent micro-utterance while still in the tap.
  AIHost.prototype._unlockSpeech = function () {
    // Unlock the premium-voice <audio> element so it can play later off-gesture.
    if (!this._audioUnlocked && this._audio) {
      try {
        this._audio.src = silentClip();
        const p = this._audio.play();
        if (p && p.then) p.then(function () {}).catch(function () {});
        this._audioUnlocked = true;
      } catch (e) {}
    }
    if (this._unlocked || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.resume();
      const u = new SpeechSynthesisUtterance(' ');   // non-breaking space
      u.volume = 0; u.rate = 1;
      this._unlockUtter = u;                               // hold a ref (GC guard)
      window.speechSynthesis.speak(u);
      this._unlocked = true;
    } catch (e) {}
  };
  AIHost.prototype.stop = function () {
    this.speaking = false;
    this.icPlay.style.display = '';
    this.icPause.style.display = 'none';
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    try { this._audio.pause(); } catch (e) {}
    clearInterval(this._ampTimer);
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

  // A tiny silent WAV (object URL) used once inside the play gesture to unlock the
  // premium-voice <audio> element for later off-gesture playback on mobile.
  let _silentUrl = null;
  function silentClip() {
    if (_silentUrl) return _silentUrl;
    const sr = 8000, n = Math.floor(sr * 0.05);
    const buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf);
    const ws = function (o, s) { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); ws(8, 'WAVE'); ws(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true);
    dv.setUint16(34, 16, true); ws(36, 'data'); dv.setUint32(40, n * 2, true);
    _silentUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
    return _silentUrl;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
  }

  global.EventuallyAIHost = AIHost;
})(window);

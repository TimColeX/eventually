/* Eventually — the "eventually" Host. A radio-DJ / tour-guide / concierge /
 * news-anchor personality. Captions rotate continuously (always live); pressing
 * play makes the Host speak them aloud (browser speech). Sponsor reads are tagged.
 */
(function (global) {
  'use strict';

  // Best-quality natural voices per platform, in priority order (name substrings).
  const VOICE_PREF = [
    'ava', 'samantha', 'allison', 'serena', 'zoe', 'nicky', 'evan',            // Apple
    'aria', 'jenny', 'guy', 'michelle', 'sonia', 'libby', 'ryan',             // Microsoft
    'google us english', 'google uk english female', 'google uk english male' // Google
  ];
  // Quality markers that boost any voice containing them.
  const VOICE_BOOST = ['enhanced', 'premium', 'neural', 'natural', 'online', 'siri'];

  function AIHost(el, opts) {
    this.el = el;
    this.getLine = opts.getLine;          // () -> { text, kind, sponsor? }
    this.onPlay = opts.onPlay || function () {};
    this.onPause = opts.onPause || function () {};
    this.onSpeakStart = opts.onSpeakStart || function () {};
    this.onSpeakEnd = opts.onSpeakEnd || function () {};
    this.synth = opts.synth || null;       // (text, lang, kind) -> Promise<url|null> (legacy per-line)
    this.getBriefing = opts.getBriefing || null;  // () -> Promise<{url,text}|null> (shared city briefing)
    this.getDailyBriefing = opts.getDailyBriefing || null;  // () -> Promise<{text}|null> (free daily briefing, device voice)
    this.onHomeReset = opts.onHomeReset || null;  // () -> void ("back to my area" clicked)
    this.getOpener = opts.getOpener || null;      // () -> { text, lang, rtl } (personalized, browser voice)
    this.getVoiceSettings = opts.getVoiceSettings || null;  // () -> { rate, pitch } (admin-tunable)
    // Voices can load asynchronously; refresh the best-voice pick when they arrive.
    if ('speechSynthesis' in global && global.speechSynthesis.addEventListener) {
      const self = this;
      global.speechSynthesis.addEventListener('voiceschanged', function () { self._voiceCache = {}; });
    }
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
      '<button class="ah-home" style="display:none" aria-label="Back to my area">↩ My area</button>' +
      (this.getDailyBriefing ? '<button class="ah-briefing" aria-label="Play today\'s briefing">▶ Today’s briefing</button>' : '') +
      '<canvas class="ah-wave"></canvas>';

    this.canvas = this.el.querySelector('.ah-wave');
    this.icPlay = this.el.querySelector('.ic-play');
    this.icPause = this.el.querySelector('.ic-pause');
    this.textEl = this.el.querySelector('.ah-text');
    this.sponEl = this.el.querySelector('.ah-spon');
    this.el.querySelector('.ah-play').addEventListener('click', function () { self.toggle(); });
    const brief = this.el.querySelector('.ah-briefing');
    if (brief) brief.addEventListener('click', function () { self.playDailyBriefing(); });
    const home = this.el.querySelector('.ah-home');
    if (home) home.addEventListener('click', function () { if (self.onHomeReset) self.onHomeReset(); });
  };

  // Show/hide the "back to my area" reset. Visible only when the Host is focused on
  // a place other than the user's home (so there's somewhere to return to).
  AIHost.prototype.setExploring = function (exploring, homeCity) {
    const b = this.el.querySelector('.ah-home');
    if (!b) return;
    b.style.display = exploring ? '' : 'none';
    b.textContent = '↩ My area';
    if (homeCity) b.title = 'Back to ' + homeCity;
  };

  // Free "Today's briefing": a discrete ~45–60s spoken segment via the DEVICE voice.
  // Speech must be primed inside this click (mobile), so unlock synchronously, then
  // fetch the text and speak. When it finishes, the ambient live rotation resumes.
  AIHost.prototype.playDailyBriefing = function () {
    if (!this.getDailyBriefing) return;
    const self = this;
    // Generation token: if the active location changes mid-play we call this again;
    // stale fetches / speech-end callbacks from the previous call then no-op.
    const gen = (this._briefingGen = (this._briefingGen || 0) + 1);
    this.briefingPlaying = true;
    this._unlockSpeech();                    // MUST run inside the tap
    this.speaking = true;
    this._everPlayed = true;
    this._openerDone = true;                 // skip the Plus opener for this path
    this.icPlay.style.display = 'none';
    this.icPause.style.display = '';
    this.onPlay();                           // music bed on
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    clearTimeout(this._introTimer); clearTimeout(this._gapTimer);
    const briefEl = this.el.querySelector('.ah-briefing');
    if (briefEl) briefEl.disabled = true;
    this._showCaption({ text: 'Preparing today’s briefing…', kind: 'briefing', lang: 'en-US' });
    this.getDailyBriefing().then(function (b) {
      if (gen !== self._briefingGen) return;   // superseded by a newer location
      if (briefEl) briefEl.disabled = false;
      if (!self.speaking) { self.briefingPlaying = false; return; }
      const text = b && b.text;
      if (!text) { self.briefingPlaying = false; self._rotate(); return; }   // → ambient rotation
      self._lang = (b && b.lang) || 'en-US';
      self._showCaption({ text: text, kind: 'briefing', lang: self._lang, rtl: !!(b && b.rtl) });
      self._browserSpeak(text, function () {
        if (gen !== self._briefingGen) return;   // a swap started; let the newer one finish
        self.briefingPlaying = false;
        self._afterSegment();                    // after briefing → ambient rotation
      });
    }).catch(function () {
      if (gen !== self._briefingGen) return;
      if (briefEl) briefEl.disabled = false;
      self.briefingPlaying = false;
      if (self.speaking) self._rotate();
    });
  };

  // Live DJ: the focus city changed. The narrator has queued a station ident as the
  // next line — if we're currently in a music gap (between spoken segments), bring
  // that next line forward so the switch feels responsive. If we're mid-sentence,
  // do nothing: the ident plays naturally right after the current line finishes.
  AIHost.prototype.transitionTo = function () {
    if (!this.speaking || this.briefingPlaying) return;
    if (this._gapTimer) {
      clearTimeout(this._gapTimer);
      const self = this;
      this._gapTimer = setTimeout(function () { if (self.speaking && !self.briefingPlaying) self._rotate(); }, 1400);
    }
  };

  // Relabel the "Today's briefing" button with the active location (Phase 1).
  AIHost.prototype.setBriefingLabel = function (city) {
    const b = this.el.querySelector('.ah-briefing');
    if (b) b.textContent = '▶ Today’s briefing' + (city ? ' · ' + city : '');
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
  // Free voice: speak sentence-by-sentence with a natural pause between each (like
  // a radio presenter), using the best available device voice + tuned rate/pitch.
  AIHost.prototype._browserSpeak = function (text, afterSegment) {
    const self = this;
    if (!('speechSynthesis' in window)) {
      self.amp = 0.5;
      const read = Math.min(9000, 2600 + text.length * 45);
      clearTimeout(self._readTimer); self._readTimer = setTimeout(afterSegment, read);
      return;
    }
    window.speechSynthesis.cancel();
    const sentences = self._splitSentences(text);
    const voice = self._voiceFor(self._lang || 'en-US');
    const cfg = self.getVoiceSettings ? (self.getVoiceSettings() || {}) : {};
    const rate = cfg.rate || 0.98;                        // slightly relaxed = more natural
    const pitch = (cfg.pitch != null ? cfg.pitch : 1.0);
    self._utters = [];
    let i = 0;
    function next() {
      if (!self.speaking) return;
      if (i >= sentences.length) { afterSegment(); return; }
      const u = new SpeechSynthesisUtterance(sentences[i]);
      u.lang = self._lang || 'en-US'; u.rate = rate; u.pitch = pitch; u.volume = 1.0;
      if (voice) u.voice = voice;
      if (i === 0) u.onstart = function () { self.amp = 0.6; self.onSpeakStart(); };   // duck once
      u.onboundary = function () { self.amp = 0.55 + Math.random() * 0.35; };
      u.onend = function () { i++; next(); };             // gap between utterances = a natural breath
      u.onerror = function () { i++; next(); };
      self._utters.push(u);                                // GC guard
      try { window.speechSynthesis.resume(); } catch (e) {}
      window.speechSynthesis.speak(u);
    }
    next();
  };

  // Split into sentences so the engine pauses naturally between them.
  AIHost.prototype._splitSentences = function (text) {
    const t = String(text).replace(/\s+/g, ' ').trim();
    const parts = t.match(/[^.!?…]+[.!?…]+["')\]]*(\s|$)|[^.!?…]+$/g);
    const out = (parts || [t]).map(function (s) { return s.trim(); }).filter(Boolean);
    return out.length ? out : [t];
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

  // Highest-quality device voice for a language, chosen automatically. Prefers the
  // best known natural voices per platform (Apple Ava/Samantha, MS Aria/Jenny/Guy,
  // Google), then any enhanced/premium/neural voice, then the locale default.
  AIHost.prototype._scoreVoice = function (v) {
    const n = (v.name || '').toLowerCase();
    let s = 0;
    for (let i = 0; i < VOICE_PREF.length; i++) { if (n.indexOf(VOICE_PREF[i]) > -1) { s += 60 - i; break; } }
    for (let j = 0; j < VOICE_BOOST.length; j++) { if (n.indexOf(VOICE_BOOST[j]) > -1) s += 12; }
    if (v.localService === false) s += 4;   // Chrome's Google network voices sound better than local eSpeak
    if (v.default) s += 3;
    return s;
  };
  AIHost.prototype._voiceFor = function (bcp) {
    if (!('speechSynthesis' in window)) return null;
    const key = (bcp || 'en-US').toLowerCase();
    this._voiceCache = this._voiceCache || {};
    if (Object.prototype.hasOwnProperty.call(this._voiceCache, key)) return this._voiceCache[key];
    const vs = window.speechSynthesis.getVoices() || [];
    if (!vs.length) return null;                          // not loaded yet — retry on next line
    const pref2 = key.slice(0, 2);
    const matches = vs.filter(function (v) { return (v.lang || '').toLowerCase().slice(0, 2) === pref2; });
    const pool = matches.length ? matches : vs;
    const self = this;
    let best = null, bestScore = -1;
    pool.forEach(function (v) {
      let sc = self._scoreVoice(v) + ((v.lang || '').toLowerCase() === key ? 5 : 0);   // exact-locale tiebreak
      if (sc > bestScore) { bestScore = sc; best = v; }
    });
    this._voiceCache[key] = best;
    return best;
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
    this.briefingPlaying = false;
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

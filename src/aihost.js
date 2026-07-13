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
    this.onMuteToggle = opts.onMuteToggle || null;  // () -> bool (new muted state)
    this.initialMuted = !!opts.initialMuted;
    this._premiumPlaying = false;
    this.getStinger = opts.getStinger || null;    // () -> Promise<{url,text}|null> (cached ElevenLabs intro, Plus)
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
        '<span class="ah-cue" style="display:none" aria-hidden="true"></span>' +
      '</button>' +
      '<div class="ah-body">' +
        '<div class="ah-label">eventually Host <span class="ah-live">● LIVE</span><span class="ah-focus"></span></div>' +
        '<div class="ah-caption"><span class="ah-spon" style="display:none">SPONSORED</span>' +
        '<span class="ah-text"></span></div>' +
      '</div>' +
      '<button class="ah-home" style="display:none" aria-label="Back to my area">↩ My area</button>' +
      '<button class="ah-mute" aria-label="Mute music" title="Mute music">' +
        '<svg viewBox="0 0 24 24" class="ic-vol"><path d="M3 10v4h4l5 4V6L7 10H3z"/><path d="M15.5 8.5a4.5 4.5 0 010 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' +
        '<svg viewBox="0 0 24 24" class="ic-mute" style="display:none"><path d="M3 10v4h4l5 4V6L7 10H3z"/><path d="M15 9.5l5 5M20 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' +
      '</button>' +
      '<canvas class="ah-wave"></canvas>';

    this.canvas = this.el.querySelector('.ah-wave');
    this.icPlay = this.el.querySelector('.ic-play');
    this.icPause = this.el.querySelector('.ic-pause');
    this.textEl = this.el.querySelector('.ah-text');
    this.sponEl = this.el.querySelector('.ah-spon');
    this.el.querySelector('.ah-play').addEventListener('click', function () { self.toggle(); });
    const home = this.el.querySelector('.ah-home');
    if (home) home.addEventListener('click', function () { if (self.onHomeReset) self.onHomeReset(); });
    const mute = this.el.querySelector('.ah-mute');
    if (mute) {
      this._setMuteIcon(this.initialMuted);
      mute.addEventListener('click', function (e) { e.stopPropagation(); self._setMuteIcon(self.onMuteToggle ? self.onMuteToggle() : false); });
    }
    // Tap the caption to open a readable "Now playing" transcript.
    const cap = this.el.querySelector('.ah-caption');
    if (cap) { cap.classList.add('ah-tappable'); cap.title = 'Tap to read the full transcript'; cap.addEventListener('click', function () { self._toggleExpand(); }); }
    // Transcript panel (appended to body; overlays above the host bar).
    const panel = document.createElement('div');
    panel.className = 'ah-expand'; panel.style.display = 'none';
    panel.innerHTML = '<div class="ah-exp-card"><div class="ah-exp-head"><span>Now playing — transcript</span>' +
      '<button class="ah-exp-x" aria-label="Close">✕</button></div><div class="ah-exp-body" tabindex="0"></div></div>';
    document.body.appendChild(panel);
    this._panel = panel;
    this._expBody = panel.querySelector('.ah-exp-body');
    panel.querySelector('.ah-exp-x').addEventListener('click', function () { self._toggleExpand(false); });
    panel.addEventListener('click', function (e) { if (e.target === panel) self._toggleExpand(false); });
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

  // The free show's OPENING: a short spoken intro (the narrator's greeting — or, on
  // a location switch, the queued station ident) via the device voice, then Today's
  // Briefing, then it flows into the ambient live rotation. One continuous listen.
  AIHost.prototype._playOpening = function () {
    const self = this;
    const line = this.getLine ? this.getLine() : null;   // greeting, or a queued 'ident' on a switch
    const briefingThenAmbient = function () {
      if (!self.speaking) return;
      if (self._dailyBriefingDisabled) { self._afterSegment(); return; }   // admin-disabled → skip to ambient
      self._speakDailyBriefing(function () { self._afterSegment(); });      // → GAP → ambient rotation
    };
    if (line && line.text) {
      this._lang = line.lang || 'en-US';
      this._showCaption(line);
      this._browserSpeak(line.text, briefingThenAmbient);
    } else {
      briefingThenAmbient();
    }
  };

  // Speak Today's Briefing via the DEVICE voice (free path). ~45–60s, Claude-authored
  // server script (local-first) with a procedural fallback. Takes exclusive audio
  // control so it never overlaps the live host. Calls onDone when finished.
  AIHost.prototype._speakDailyBriefing = function (onDone) {
    if (!this.getDailyBriefing) { if (onDone) onDone(); return; }
    const self = this;
    // Generation token: a mid-play location switch supersedes this fetch/speech.
    const gen = (this._briefingGen = (this._briefingGen || 0) + 1);
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();   // exclusive audio
    try { this._audio.pause(); } catch (e) {}
    clearInterval(this._ampTimer);
    this.briefingPlaying = true;
    this._setBuffering(true);
    this._showCaption({ text: 'Preparing today’s briefing…', kind: 'briefing', lang: 'en-US' });
    this.getDailyBriefing().then(function (b) {
      if (gen !== self._briefingGen) return;                 // superseded
      self._setBuffering(false);
      if (!self.speaking) { self.briefingPlaying = false; return; }
      const text = b && b.text;
      if (!text) { self.briefingPlaying = false; if (onDone) onDone(); return; }
      self._lang = (b && b.lang) || 'en-US';
      self._showCaption({ text: text, kind: 'briefing', lang: self._lang, rtl: !!(b && b.rtl) });
      self._browserSpeak(text, function () {
        if (gen !== self._briefingGen) return;
        self.briefingPlaying = false;
        if (onDone) onDone();
      });
    }).catch(function () {
      if (gen !== self._briefingGen) return;
      self._setBuffering(false);
      self.briefingPlaying = false;
      if (onDone) onDone();
    });
  };

  // Free path per rotation: play the opening (intro + briefing) once per show, then
  // fall into the ambient narrator rotation.
  AIHost.prototype._freeSegment = function () {
    if (!this._openingDone) { this._openingDone = true; this._playOpening(); }
    else this._rotateLine();
  };

  // The focus city changed WHILE LISTENING. Finish the current sentence, then flow
  // into the new city's opening (station ident → fresh briefing → live). Checked
  // between sentences in _browserSpeak; if we're in a music gap, bring it forward.
  AIHost.prototype.switchLocation = function () {
    if (!this.speaking) return;
    if (this._premiumPlaying) {                 // Plus: crossfade out the current clip, then switch
      this._voiceVol(0, 0.5);
      const self = this;
      clearTimeout(this._switchFade);
      this._switchFade = setTimeout(function () {
        try { self._audio.pause(); } catch (e) {}
        self._premiumPlaying = false; self._applySwitch();
      }, 520);
      return;
    }
    this._switchPending = true;                 // device: finish the current sentence, then switch
    if (this._gapTimer) {                        // in a music gap → apply soon
      clearTimeout(this._gapTimer);
      const self = this;
      this._gapTimer = setTimeout(function () { if (self.speaking) self._applySwitch(); }, 1200);
    }
  };
  AIHost.prototype._applySwitch = function () {
    this._switchPending = false;
    this.briefingPlaying = false;
    this._openingDone = false;                  // replay the opening (ident → briefing) for the new city
    if (this.speaking) this._rotate();
  };

  // Admin toggle: when the daily briefing is disabled, the show plays intro → live
  // (the briefing segment is skipped).
  AIHost.prototype.setDailyBriefingEnabled = function (on) { this._dailyBriefingDisabled = (on === false); };

  // Reflect the music mute state on the speaker button.
  AIHost.prototype._setMuteIcon = function (m) {
    const b = this.el.querySelector('.ah-mute'); if (!b) return;
    b.classList.toggle('is-muted', !!m);
    const v = b.querySelector('.ic-vol'), x = b.querySelector('.ic-mute');
    if (v) v.style.display = m ? 'none' : '';
    if (x) x.style.display = m ? '' : 'none';
    b.title = m ? 'Unmute music' : 'Mute music'; b.setAttribute('aria-label', b.title);
  };

  // Fade the premium <audio> clip's volume (crossfades in/out). No-op ducking on iOS
  // (volume is read-only there) — playback still switches promptly.
  AIHost.prototype._voiceVol = function (to, secs) {
    const a = this._audio; if (!a) return;
    clearInterval(this._voiceTween);
    const from = (typeof a.volume === 'number') ? a.volume : 1;
    const steps = Math.max(1, Math.round(secs * 20)), dv = (to - from) / steps;
    let i = 0; const self = this;
    this._voiceTween = setInterval(function () {
      i++; let vv = from + dv * i; vv = vv < 0 ? 0 : (vv > 1 ? 1 : vv);
      try { a.volume = vv; } catch (e) {}
      if (i >= steps) { try { a.volume = to < 0 ? 0 : (to > 1 ? 1 : to); } catch (e) {} clearInterval(self._voiceTween); self._voiceTween = null; }
    }, 50);
  };

  // Buffering state (premium briefing being generated/synthesized) → the play button
  // pulses and the caption shows a "preparing" hint, so silence never reads as a bug.
  AIHost.prototype._setBuffering = function (on) {
    this._buffering = !!on;
    this.el.classList.toggle('ah-buffering', !!on);
  };

  // Show the focus city in the Host label (" · Toronto").
  AIHost.prototype.setFocusCity = function (city) {
    const f = this.el.querySelector('.ah-focus');
    if (f) f.textContent = city ? ' · ' + city : '';
  };
  // Idle "new briefing ready" cue on the Play button (browsers block autoplay, so a
  // location search while stopped can't start sound — it prompts a tap instead).
  AIHost.prototype.setNewBriefingCue = function (on, city) {
    const c = this.el.querySelector('.ah-cue');
    if (c) c.style.display = on ? '' : 'none';
    const play = this.el.querySelector('.ah-play');
    if (play) {
      play.classList.toggle('has-cue', !!on);
      play.title = on ? ('New briefing for ' + (city || 'your area') + ' — tap to listen') : 'Play the Host aloud';
    }
  };

  function escHtml(s) {
    return String(s).replace(/[&<>"]/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m]; });
  }
  // Tokenize text into word spans tagged with their char offsets (so speech word-
  // boundary events can highlight the right word). Returns {html, meta:[{s,e}]}.
  function wordsHTML(text) {
    const parts = String(text).split(/(\s+)/);
    let idx = 0, html = '';
    const meta = [];
    for (const p of parts) {
      if (!p) continue;
      if (/^\s+$/.test(p)) { html += p.replace(/ /g, '&nbsp;').replace(/\t/g, '&nbsp;&nbsp;'); idx += p.length; }
      else { const s = idx, e = idx + p.length; meta.push({ s: s, e: e }); html += '<span class="ah-w" data-s="' + s + '">' + escHtml(p) + '</span>'; idx = e; }
    }
    return { html: html, meta: meta };
  }
  AIHost.prototype._reducedMotion = function () {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  };

  // Update the caption (no audio). Renders the line as word spans so it can scroll
  // and highlight the current word in sync with the narration. Shared by line
  // rotation + briefing mode.
  AIHost.prototype._showCaption = function (line) {
    this.current = line;
    this.sponEl.style.display = line.kind === 'sponsor' ? '' : 'none';
    this.el.querySelector('.ah-caption').classList.toggle('is-sponsor', line.kind === 'sponsor');
    const rtl = !!line.rtl, text = line.text || '';
    this.textEl.setAttribute('dir', rtl ? 'rtl' : 'ltr');
    this._capText = text; this._words = null; this._activeWord = -1; this._synced = false;
    this._stopMarquee();
    this.textEl.style.opacity = 0;
    const self = this;
    clearTimeout(this._capTimer);
    this._capTimer = setTimeout(function () {
      const w = wordsHTML(text);
      self.textEl.innerHTML = '<span class="ah-run">' + w.html + '</span>';
      self._runEl = self.textEl.querySelector('.ah-run');
      const spans = self._runEl.querySelectorAll('.ah-w');
      self._words = w.meta.map(function (m, i) { m.el = spans[i]; return m; });
      self._runEl.style.transform = 'translateX(0)';
      self.textEl.style.opacity = 1;
      self._maybeMarquee();
      if (self._expanded) self._renderExpand(text, rtl);
    }, 180);
  };

  // If the caption overflows and nothing is word-syncing it (premium audio, or no
  // boundary events), gently ping-pong it so the whole line is readable.
  AIHost.prototype._stopMarquee = function () {
    clearTimeout(this._marqueeTimer); this._marqueeTimer = null;
    if (this._runEl) this._runEl.style.transition = 'none';
  };
  AIHost.prototype._maybeMarquee = function () {
    this._stopMarquee();
    if (this._synced || this._reducedMotion() || !this._runEl) return;
    const clip = this.textEl.clientWidth, run = this._runEl.scrollWidth;
    if (run <= clip + 4) return;                 // fits — no scroll needed
    const overflow = run - clip, self = this;
    const dur = Math.max(3, overflow / 40);      // ~40 px/s
    let out = true;
    const step = function () {
      if (!self._runEl || self._synced) return;
      self._runEl.style.transition = 'transform ' + dur + 's linear';
      self._runEl.style.transform = 'translateX(' + (out ? -overflow : 0) + 'px)';
      self._marqueeTimer = setTimeout(function () { out = !out; step(); }, dur * 1000 + 1100);
    };
    this._marqueeTimer = setTimeout(step, 800);
  };

  // Highlight the word containing `charIdx` (a global offset into the caption text)
  // and keep it in view. Called from speech word-boundary events (browser voice).
  AIHost.prototype._highlightWord = function (charIdx) {
    if (!this._words || !this._words.length) return;
    this._synced = true; this._stopMarquee();
    let wi = this._words.length - 1;
    for (let i = 0; i < this._words.length; i++) {
      if (charIdx < this._words[i].e) { wi = (charIdx >= this._words[i].s) ? i : Math.max(0, i - 1); break; }
    }
    if (wi === this._activeWord) return;
    if (this._activeWord >= 0 && this._words[this._activeWord].el) this._words[this._activeWord].el.classList.remove('active');
    this._activeWord = wi;
    const el = this._words[wi].el; if (!el) return;
    el.classList.add('active');
    if (this._runEl && !this._reducedMotion()) {   // scroll the bar so the active word stays visible
      const clip = this.textEl.clientWidth;
      const maxShift = Math.max(0, this._runEl.scrollWidth - clip);
      const shift = Math.min(Math.max(0, el.offsetLeft - clip * 0.33), maxShift);
      this._runEl.style.transition = 'transform 0.35s ease';
      this._runEl.style.transform = 'translateX(' + (-shift) + 'px)';
    }
    if (this._expanded && this._expWords && this._expWords[wi]) {   // mirror in the transcript panel
      if (this._expActive >= 0 && this._expWords[this._expActive]) this._expWords[this._expActive].classList.remove('active');
      this._expActive = wi; this._expWords[wi].classList.add('active');
      try { this._expWords[wi].scrollIntoView({ block: 'center', behavior: this._reducedMotion() ? 'auto' : 'smooth' }); } catch (e) {}
    }
  };

  // The expandable "Now playing" transcript (full text, wrapped, auto-highlighting).
  AIHost.prototype._toggleExpand = function (force) {
    this._expanded = (force === undefined) ? !this._expanded : !!force;
    if (this._panel) this._panel.style.display = this._expanded ? '' : 'none';
    if (this._expanded) this._renderExpand(this._capText || '', this.textEl.getAttribute('dir') === 'rtl');
  };
  AIHost.prototype._renderExpand = function (text, rtl) {
    if (!this._expBody) return;
    const w = wordsHTML(text);
    this._expBody.setAttribute('dir', rtl ? 'rtl' : 'ltr');
    this._expBody.innerHTML = w.html || '<span class="ah-hint">Press play to start the show.</span>';
    this._expWords = this._expBody.querySelectorAll('.ah-w');
    this._expActive = -1;
    if (this._activeWord >= 0 && this._expWords[this._activeWord]) {
      this._expActive = this._activeWord; this._expWords[this._activeWord].classList.add('active');
    }
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
    if (this.briefingPlaying) return;          // the briefing owns the audio right now
    const self = this;
    // Briefing mode: Plus = SHARED, cached ElevenLabs briefing (premium voice from the
    // very first word — a cached stinger covers synth latency at the start). Free = the
    // browser-voice show. getBriefing() resolves null for Free → the free show runs.
    if (this.speaking && this.getBriefing) {
      // Start of the show (once per Play): play a cached ElevenLabs stinger IMMEDIATELY
      // while the full briefing synthesizes in parallel — no browser-voice greeting.
      if (!this._openerDone && this.getStinger) {
        this._openerDone = true;
        this._pendingBriefing = this.getBriefing();          // kick off the heavy fetch now (parallel)
        this._setBuffering(true);
        this.getStinger().then(function (s) {
          if (!self.speaking || self.briefingPlaying) return;
          if (s && s.url) { self._setBuffering(false); self._audioSpeak(s.url, s.text, function () { self._playPendingBriefing(); }); }
          else self._playPendingBriefing();                  // no stinger (Free / unavailable) → straight to briefing
        }).catch(function () { self._playPendingBriefing(); });
        return;
      }
      // Refreshes / subsequent rotations: fetch + play the briefing (no stinger).
      this._openerDone = true;
      this._setBuffering(true);
      this.getBriefing().then(function (b) { self._setBuffering(false); self._playBriefingResult(b); })
        .catch(function () { self._setBuffering(false); self._freeSegment(); });
      return;
    }
    this._rotateLine();
  };

  // Plus: play the cached premium audio segments (briefing body + any verbatim promo
  // clips) back-to-back, then a music GAP. Each clip is a pre-rendered ElevenLabs mp3.
  AIHost.prototype._playPremiumSegments = function (segs, i) {
    if (!this.speaking || this.briefingPlaying) return;
    if (i >= segs.length) { this._afterSegment(); return; }   // done → GAP → refresh on next rotate
    const seg = segs[i], self = this;
    this._showCaption({ text: seg.text || '', kind: 'briefing', lang: 'en-US' });
    this._audioSpeak(seg.url, seg.text || '', function () { self._playPremiumSegments(segs, i + 1); });
  };

  // Play a resolved briefing result: Plus audio segments, else the free browser show.
  AIHost.prototype._playBriefingResult = function (b) {
    if (!this.speaking || this.briefingPlaying) return;
    if (b && b.segments && b.segments.length) this._playPremiumSegments(b.segments, 0);
    else this._freeSegment();               // Free / unavailable / failed → browser-voice fallback
  };
  // After the premium stinger, play the full briefing. If it isn't ready yet, hold on
  // the music bed + buffering cue until it resolves (no browser voice in between).
  AIHost.prototype._playPendingBriefing = function () {
    if (!this.speaking) return;
    const self = this, p = this._pendingBriefing; this._pendingBriefing = null;
    this._setBuffering(true);
    Promise.resolve(p).then(function (b) { self._setBuffering(false); self._playBriefingResult(b); })
      .catch(function () { self._setBuffering(false); self._freeSegment(); });
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
    if (this.briefingPlaying) return;                                  // never play premium over the briefing
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();  // enforce one voice: silence browser TTS
    this.onSpeakStart();                                               // duck the music now
    try {
      a.onended = function () { self._premiumPlaying = false; afterSegment(); };
      a.onerror = function () { self._premiumPlaying = false; self._browserSpeak(text, afterSegment); };
      a.src = url; a.currentTime = 0;
      try { a.volume = 0; } catch (e) {}                   // start silent → fade the clip in
      const p = a.play();
      const begin = function () {
        self._premiumPlaying = true;
        self._voiceVol(1, 0.35);                           // crossfade the clip in
        self.onSpeakStart();                               // duck music under voice
        clearInterval(self._ampTimer);
        self._ampTimer = setInterval(function () { self.amp = 0.5 + Math.random() * 0.4; }, 180);
      };
      if (p && p.then) p.then(begin).catch(function () { self._premiumPlaying = false; self._browserSpeak(text, afterSegment); });
      else begin();
    } catch (e) { self._premiumPlaying = false; self._browserSpeak(text, afterSegment); }
  };

  // Free voice: browser SpeechSynthesis (or a timed simulation if unavailable).
  // Free voice: speak sentence-by-sentence with a natural pause between each (like
  // a radio presenter), using the best available device voice + tuned rate/pitch.
  AIHost.prototype._browserSpeak = function (text, afterSegment) {
    const self = this;
    try { this._audio.pause(); } catch (e) {}   // enforce one voice: silence the premium element first
    this.onSpeakStart();                         // duck the music NOW (don't wait for onstart, which is flaky)
    if (!('speechSynthesis' in window)) {
      self.amp = 0.5;
      const read = Math.min(9000, 2600 + text.length * 45);
      clearTimeout(self._readTimer); self._readTimer = setTimeout(afterSegment, read);
      return;
    }
    window.speechSynthesis.cancel();
    const sentences = self._splitSentences(text);
    // Char offset of each sentence within `text`, so word-boundary charIndex (which
    // is relative to the utterance) maps to a global position for caption sync.
    const offsets = []; let cur = 0;
    for (let s = 0; s < sentences.length; s++) { const at = text.indexOf(sentences[s], cur); offsets.push(at < 0 ? cur : at); cur = (at < 0 ? cur : at) + sentences[s].length; }
    const voice = self._voiceFor(self._lang || 'en-US');
    const cfg = self.getVoiceSettings ? (self.getVoiceSettings() || {}) : {};
    const rate = cfg.rate || 0.98;                        // slightly relaxed = more natural
    const pitch = (cfg.pitch != null ? cfg.pitch : 1.0);
    self._utters = [];
    let i = 0;
    function next() {
      if (!self.speaking) return;
      if (self._switchPending) { self._applySwitch(); return; }   // finish this sentence, then switch city
      if (i >= sentences.length) { afterSegment(); return; }
      const si = i;                                        // capture for the boundary closure
      const u = new SpeechSynthesisUtterance(sentences[i]);
      u.lang = self._lang || 'en-US'; u.rate = rate; u.pitch = pitch; u.volume = 1.0;
      if (voice) u.voice = voice;
      if (i === 0) u.onstart = function () { self.amp = 0.6; self.onSpeakStart(); };   // duck once
      u.onboundary = function (e) {
        self.amp = 0.55 + Math.random() * 0.35;
        if (e && (e.name === 'word' || e.charIndex != null)) self._highlightWord(offsets[si] + (e.charIndex || 0));
      };
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
    this._openerDone = false;              // premium stinger plays once per Play session
    this._openingDone = false;             // replay the show opening (intro → briefing) on each Play
    this._switchPending = false;
    this.setNewBriefingCue(false);         // pressing Play consumes any "new briefing" cue
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
    this._switchPending = false;
    this._premiumPlaying = false;
    this._pendingBriefing = null;
    this._setBuffering(false);
    this.icPlay.style.display = '';
    this.icPause.style.display = 'none';
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    try { this._audio.pause(); } catch (e) {}
    clearInterval(this._ampTimer); clearInterval(this._voiceTween);
    clearTimeout(this._introTimer); clearTimeout(this._gapTimer); clearTimeout(this._readTimer); clearTimeout(this._switchFade);
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

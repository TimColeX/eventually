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
    this.getWelcome = opts.getWelcome || null;    // () -> Promise<{url,text}|null> (official cached "Welcome to Eventually…")
    this.getIntro = opts.getIntro || null;        // ({have}) -> Promise<{changed,sig,segments}|null> (one-time host self-intro)
    this.getTransitions = opts.getTransitions || null;  // () -> Promise<[{url,text}]|null> (generic cached city-switch transitions)
    this._transIdx = 0;                           // rotates through the transition lines
    this.getCityFiller = opts.getCityFiller || null;  // () -> Promise<{segments,filler}|null> (cached city radio filler for the current city)
    this.MUSIC_GAP = 4200;                        // ~4s music swell between radio-filler segments (uses the play-button bed)
    this._fillerPlaying = false;                  // true while cached city filler segments are playing (incl. music gaps)
    this.REPLAY_MS = 180000;                      // continuous radio: after settling on music, re-run the show (~3 min)
    this.FILLER_COOLDOWN = 180000;                // never replay the city segments within 3 min of last playing them
    this._lastFillerAt = 0; this._replayTimer = null;
    this.onHomeReset = opts.onHomeReset || null;  // () -> void ("back to my area" clicked)
    this.onMuteToggle = opts.onMuteToggle || null;  // () -> bool (new muted state)
    this.initialMuted = !!opts.initialMuted;
    this._premiumPlaying = false;
    this._musicHold = false; this._freeMode = false; this._introDone = false;
    // Generation token: bumped on every play/stop/city-switch. An async fetch (briefing /
    // welcome) captures the token when it starts and MUST re-check it before playing, so a
    // late result for a PREVIOUS city can never overwrite the current one (#4 race control).
    this._gen = 0;
    this.getStinger = opts.getStinger || null;    // () -> Promise<{url,text}|null> (cached ElevenLabs intro, Plus)
    this.getFreeGreeting = opts.getFreeGreeting || null;  // () -> Promise<{url,text}|null> (cached EL greeting, Free)
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
    // The auto-start's own lead-in. It used SHORT_INTRO, and with the bed's 1.6s
    // fade-in that left barely a second of audible music before the voice arrived —
    // too little for the listener to register that music is playing at all, so the
    // duck that follows reads as silence rather than as music underneath.
    this.AUTO_INTRO = 6000;
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
      '<button class="ah-play" data-tour="play" aria-label="Play the Host aloud">' +
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
  AIHost.prototype.switchLocation = function (city) {
    if (!this.speaking && !this._musicHold) return;
    this._gen++;                                 // invalidate ANY in-flight generation for the old city (#4)
    clearTimeout(this._replayTimer); this._replayTimer = null;   // cancel any pending continuous-radio replay
    this._identCity = city || this._focusCity || null;   // → the generic transition plays while the new city loads
    this._primeAudio();                          // iOS: keep the audio element alive within THIS tap gesture
    // Still in the music lead-in after Play (nothing spoken yet) → switch NOW. Waiting for
    // the lead-in to finish delayed the "give me a moment" line by several seconds, which
    // is exactly the gap it exists to cover.
    if (this._introTimer && !this._premiumPlaying) { clearTimeout(this._introTimer); this._introTimer = null; this._applySwitch(); return; }
    const self = this;
    // Two-host conversation already finished (music bed playing) → start the NEW city's
    // conversation. Without this, a city switch after the convo ended did nothing.
    if (this._musicHold) {
      this._musicHold = false; this.speaking = true; this._premiumPlaying = false;
      this._openerDone = false; this._openingDone = false;
      this.icPlay.style.display = 'none'; this.icPause.style.display = '';
      this._rotate();
      return;
    }
    // Mid city-radio-filler: stop the sequence immediately (Section 3 — a globe spin
    // interrupts). If a segment is actively playing, fall through to the crossfade below;
    // if we're in a between-segment music gap, apply the switch right now.
    if (this._fillerPlaying) {
      clearTimeout(this._fillerGap); this._fillerPlaying = false;
      if (!this._premiumPlaying) { this._applySwitch(); return; }
    }
    if (this._premiumPlaying) {                 // crossfade out the current clip, then switch
      this._voiceVol(0, 0.5);
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
      this._gapTimer = setTimeout(function () { if (self.speaking) self._applySwitch(); }, 1200);
    }
  };
  AIHost.prototype._applySwitch = function () {
    this._switchPending = false;
    this.briefingPlaying = false;
    this._openingDone = false;                  // replay the opening (ident → briefing) for the new city
    this._openerDone = false;                   // ← two-host / stinger: re-run the opener for the NEW city (#3)
    if (this.speaking) this._rotate();
  };

  // Next line of a transition set ('wait' | 'nearly' | 'ready') in rotation, or null. Each
  // set rotates on its own, so a line is never heard twice in a row; `avoidSpeaker` skips a
  // line in that host's voice (the "nearly there" follow-up comes from the OTHER host). The
  // sets are fetched once and pre-downloaded (hostvoice.getTransitions). Never rejects.
  AIHost.prototype._pickLine = function (kind, avoidSpeaker) {
    if (!this.getTransitions) return Promise.resolve(null);
    const self = this;
    return this.getTransitions().then(function (set) {
      if (!set) return null;
      const list = Array.isArray(set) ? (kind === 'wait' ? set : []) : (set[kind] || []);
      if (!list.length) return null;
      self._lineIdx = self._lineIdx || {};
      let i = self._lineIdx[kind] || 0;
      if (avoidSpeaker != null && list.length > 1 && list[i % list.length].speaker === avoidSpeaker) i++;
      self._lineIdx[kind] = i + 1;
      return list[i % list.length];
    }).catch(function () { return null; });
  };
  AIHost.prototype._nextTransition = function () { return this._pickLine('wait'); };

  // True while the Host is "on" — actively narrating OR holding on the music bed after a
  // show has settled (speaking:false, _musicHold:true). A city switch in EITHER state
  // should flow into the new city's briefing; only a FULLY stopped/paused Host shows a
  // tap-to-play cue. Fixes the silent-switch-after-a-short-clip bug (e.g. a quiet home).
  AIHost.prototype.isActive = function () { return !!(this.speaking || this._musicHold); };

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
    // A fresh city (or a language change) needs a new script AND new speech — around 30
    // seconds during which only the music bed plays. A pulsing button alone reads as
    // "broken"; say what's happening instead. The real caption overwrites this the moment
    // audio starts, and we never clobber a caption that's already showing something.
    const t = this.el.querySelector('.ah-text');
    if (!t) return;
    if (on) {
      if (!this._preBufferCaption) this._preBufferCaption = t.textContent || '';
      // After a city pick, name it — people who have the sound off get the same "hold on".
      this._bufMsg = this._loadingCity ? 'Getting ' + this._loadingCity + '…' : 'Preparing your briefing…';
      t.textContent = this._bufMsg;
    } else if (this._preBufferCaption != null) {
      if (t.textContent === this._bufMsg) t.textContent = this._preBufferCaption;
      this._preBufferCaption = null;
    }
  };

  // Show the focus city in the Host label (" · Toronto").
  AIHost.prototype.setFocusCity = function (city) {
    this._focusCity = city || null;
    const f = this.el.querySelector('.ah-focus');
    if (f) f.textContent = city ? ' · ' + city : '';
  };
  // Idle "new briefing ready" cue on the Play button (browsers block autoplay, so a
  // location search while stopped can't start sound — it prompts a tap instead).
  AIHost.prototype.setNewBriefingCue = function (on, city) {
    this._cuePending = !!on;                     // a city was picked while stopped → Play opens with the transition
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
  // Normalize whitespace ONCE. The caption's word offsets and the speech engine's
  // sentence/boundary offsets must share ONE coordinate system — previously the
  // caption was tokenized from the raw text while sentences were split from a
  // whitespace-collapsed copy, so any newline/double-space made every subsequent
  // boundary map onto the wrong word (drifting highlight).
  function normText(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

  AIHost.prototype._reducedMotion = function () {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  };

  // Has the official welcome already been spoken this session? The launch splash
  // (src/signature.js) sets this flag the moment its welcome clip starts playing, so
  // the Host doesn't repeat it seconds later. If the splash was disabled, skipped, or
  // its audio failed, the flag stays unset and the Host delivers the greeting instead.
  const WELCOME_KEY = 'eventually.welcomeSpoken';
  AIHost.prototype._needsWelcome = function () {
    try { return sessionStorage.getItem(WELCOME_KEY) !== '1'; } catch (e) { return true; }
  };
  // Play a list of cached audio segments back-to-back, then call `done`. Used for the
  // one-time host intro (Fish = one clip; ElevenLabs = one clip per turn). noFallback so
  // a failed clip never drops to the browser voice — it just advances to `done`.
  AIHost.prototype._playSegmentsThen = function (segs, i, done) {
    if (!this.speaking) return;
    if (i >= segs.length) { if (done) done(); return; }
    const seg = segs[i], self = this;
    this._audioSpeak(seg.url, seg.text || '', function () { self._playSegmentsThen(segs, i + 1, done); },
      true, { text: seg.text || '', kind: 'greeting', lang: 'en-US' });
  };

  // THE UNLOCK. Safari (and iOS especially) will only let an <audio> element play
  // off-gesture later if it has already played UNMUTED from inside a user gesture.
  //
  // ⚠️ This used to play it MUTED — which unlocks nothing at all. Muted playback is
  // always permitted, so Safari grants no permission for it, and the element stayed
  // locked. That is why tapping a spike (a real gesture, which calls this) still left
  // the "hold on…" clip unable to play, and why only pressing Play by hand helped.
  // Silence here comes from the CONTENT — a 50ms silent WAV on loop — so an unmuted
  // play is completely inaudible and is a genuine unlock.
  //
  // Called on every real gesture (first tap, spike tap, Play) and cheap to repeat: it
  // stops as soon as a clip is actually playing, so it can never cut one off.
  AIHost.prototype._primeAudio = function () {
    const a = this._audio; if (!a) return;
    // A real clip already playing IS the permission — never stomp its src. (Compared
    // against silentClip() itself, which is a memoised blob: URL, so the primer's own
    // looping silence doesn't count as "something is playing".)
    if (this._premiumPlaying) return;
    if (!a.paused && a.src && a.src !== silentClip()) return;
    const self = this;
    try {
      a.onended = null; a.onerror = null;                        // don't let the primer fire stale handlers
      a.loop = true; a.muted = false;                            // silent by content, NOT by mute
      a.src = silentClip();
      try { a.volume = 1; } catch (e) {}                         // _audioSpeak fades from here
      const p = a.play();
      // Only count it as unlocked when the play actually RESOLVED. The old code set the
      // flag unconditionally, so one refused attempt (a timer-driven auto-start, with no
      // gesture behind it) permanently convinced the app it was unlocked and it never
      // tried again for the rest of the session.
      if (p && p.then) p.then(function () { self._audioUnlocked = true; }, function () {});
      else self._audioUnlocked = true;
    } catch (e) {}
  };

  // Admin flips the whole app between single-host and two-host conversation mode.
  AIHost.prototype.setTwoHost = function (on, names) { this.twoHost = !!on; this._hostNames = names || null; };

  // Update the caption (no audio). Renders the line as word spans so it can scroll
  // and highlight the current word in sync with the narration. Shared by line
  // rotation + briefing mode.
  AIHost.prototype._showCaption = function (line, immediate) {
    this.current = line;
    this.sponEl.style.display = line.kind === 'sponsor' ? '' : 'none';
    this.el.querySelector('.ah-caption').classList.toggle('is-sponsor', line.kind === 'sponsor');
    const rtl = !!line.rtl, text = normText(line.text);
    this.textEl.setAttribute('dir', rtl ? 'rtl' : 'ltr');
    this._capText = text; this._words = null; this._activeWord = -1; this._synced = false;
    this._stopMarquee(); this._stopAudioSync();
    const self = this;
    clearTimeout(this._capTimer);
    const render = function () {
      const w = wordsHTML(text);
      self.textEl.innerHTML = '<span class="ah-run">' + w.html + '</span>';
      self._runEl = self.textEl.querySelector('.ah-run');
      const spans = self._runEl.querySelectorAll('.ah-w');
      self._words = w.meta.map(function (m, i) { m.el = spans[i]; return m; });
      self._runEl.style.transition = 'none';
      self._runEl.style.transform = 'translateX(0)';
      self.textEl.style.opacity = 1;
      self._maybeMarquee();
      if (self._expanded) self._renderExpand(text, rtl);
    };
    // `immediate` = the caption is being driven by audio that is starting RIGHT NOW,
    // so render in step with playback instead of after the 180ms cross-fade (which
    // used to leave the previous line on screen while the new clip was already talking).
    if (immediate) { render(); return; }
    this.textEl.style.opacity = 0;
    this._capTimer = setTimeout(render, 180);
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
  // Apply the active word + keep it in view. MONOTONIC: a read-along only ever moves
  // forward within a caption. Boundary events can fire on whitespace (resolving to the
  // PREVIOUS word), which used to yank the highlight — and the scroll — backwards.
  AIHost.prototype._setActiveWord = function (wi) {
    if (!this._words || wi < 0 || !this._words[wi]) return;
    if (wi <= this._activeWord) return;                 // same or backwards → ignore
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

  // Highlight the word containing `charIdx` (a global offset into the caption text).
  // Called from speech word-boundary events (browser voice).
  AIHost.prototype._highlightWord = function (charIdx) {
    if (!this._words || !this._words.length) return;
    this._synced = true; this._stopMarquee();
    let wi = this._words.length - 1;
    for (let i = 0; i < this._words.length; i++) {
      if (charIdx < this._words[i].e) { wi = (charIdx >= this._words[i].s) ? i : Math.max(0, i - 1); break; }
    }
    this._setActiveWord(wi);
  };

  // PREMIUM (pre-rendered ElevenLabs mp3): the browser emits NO word-boundary events,
  // so the caption used to fall back to a ping-pong marquee that scrolled forward and
  // back on its own timer — visually "out of sync" and unrelated to the speech. Drive
  // the read-along from the AUDIO CLOCK instead: progress = currentTime / duration.
  // Approximate (assumes an even speaking rate) but always forward and always tied to
  // what is actually being spoken.
  AIHost.prototype._stopAudioSync = function () {
    if (this._audio && this._audioSyncFn) {
      try { this._audio.removeEventListener('timeupdate', this._audioSyncFn); } catch (e) {}
    }
    this._audioSyncFn = null;
  };
  AIHost.prototype._startAudioSync = function () {
    this._stopAudioSync();
    const self = this, a = this._audio;
    if (!a) return;
    this._audioSyncFn = function () {
      if (!self._words || !self._words.length || !self._runEl) return;
      const d = a.duration;
      if (!isFinite(d) || d <= 0) return;
      self._synced = true; self._stopMarquee();       // audio clock owns the caption now
      const p = Math.max(0, Math.min(1, a.currentTime / d));
      self._setActiveWord(Math.min(self._words.length - 1, Math.floor(p * self._words.length)));
    };
    a.addEventListener('timeupdate', this._audioSyncFn);
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
    if (this.briefingPlaying) return;          // the browser-voice briefing owns the audio right now
    if (this._premiumPlaying) return;          // a cached clip is playing (two-host briefing/ident) → never re-fetch/replay over it
    if (this._fillerPlaying) return;           // cached city radio-filler is playing (or in a music gap) → don't re-fetch over it
    if (this._musicHold) return;               // free intro done → music bed only, no caption rotation
    const self = this;
    // Briefing mode: Plus = SHARED, cached ElevenLabs briefing (premium voice from the
    // very first word — a cached stinger covers synth latency at the start). Free = the
    // browser-voice show. getBriefing() resolves null for Free → the free show runs.
    if (this.speaking && this.getBriefing) {
      // TWO-HOST mode: the show is ONE cached two-host conversation for everyone. Open
      // with the official welcome (unless the splash spoke it), then play the
      // conversation once and settle to music. Fallback on failure = silent + music
      // (never the browser voice). Reuses _playFreeIntro (play segments → stop → music).
      if (this.twoHost && !this._openerDone) {
        this._openerDone = true;
        // Name the city in the loading caption from the very first moment of a switch.
        this._loadingCity = this._identCity || (this._bridgeNext ? this._focusCity : null) || null;
        this._setBuffering(true);
        const myGen = this._gen;                             // tie this show to the CURRENT city
        const stale = function () { return myGen !== self._gen || !self.speaking; };
        // Play a briefing once its fetch resolves. `pending` = { p, ready }: a briefing that
        // finished loading while the transition played starts at once, with no loading
        // caption flash in between.
        // After a wait line (`afterLine`), a city still loading NUDGE_MS later gets ONE
        // "nearly there" from the other host — long silence is when people click away. A
        // briefing that lands mid-nudge waits for the line to finish (the gate) rather than
        // cutting it off.
        const NUDGE_MS = 5000;
        const playBriefing = function (pending, afterLine, lastSpeaker) {
          if (stale()) { self._setBuffering(false); return; }   // superseded → abandon (never leave buffering stuck)
          const gate = { busy: false, after: null };
          if (!pending.ready) {
            self._setBuffering(true);
            if (afterLine) {
              clearTimeout(self._nudgeTimer);
              self._nudgeTimer = setTimeout(function () {
                if (stale() || pending.ready) return;
                self._pickLine('nearly', lastSpeaker).then(function (t) {
                  if (stale() || pending.ready || !t || !t.url) return;
                  gate.busy = true;
                  self._setBuffering(false);
                  self._audioSpeak(t.url, t.text, function () {
                    gate.busy = false;
                    if (gate.after) { const f = gate.after; gate.after = null; f(); }
                    else if (!pending.ready) self._setBuffering(true);
                  }, true, { text: t.text, kind: 'greeting', lang: 'en-US' });
                });
              }, NUDGE_MS);
            }
          }
          const whenFree = function (f) { clearTimeout(self._nudgeTimer); if (gate.busy) gate.after = f; else f(); };
          pending.p.then(function (b) { whenFree(function () {
            if (stale()) { self._setBuffering(false); return; } // a newer city started → ignore this result (#4/#5)
            self._loadingCity = null;
            self._setBuffering(false);
            if (b && b.segments && b.segments.length) {
              if (b.filler) self._playFillerSegs(b.segments, 0, myGen);   // quiet city → already the cached radio filler
              // events → then city filler. afterEvents=true so the filler opens with the
              // "bridge" line, NOT "it's quiet in <city>" (which would contradict the briefing).
              else self._playSegmentsThen(b.segments, 0, function () { self._continueWithFiller(myGen, true); });
            // No briefing came back (a timeout or error). We don't know the city is quiet —
            // the map may be full of events — so the filler opens with the neutral line,
            // never "it's a little quiet in <city>". A genuinely quiet city never lands
            // here: the server answers that case with `filler` segments (handled above).
            } else self._continueWithFiller(myGen, true);
          }); }).catch(function () { whenFree(function () { self._loadingCity = null; self._setBuffering(false); if (stale()) return; self._continueWithFiller(myGen, true); }); });
        };
        const load = function (quick) {                        // quick → short "headline" (fast synth) on a switch
          const pending = { p: self.getBriefing(quick), ready: false };
          pending.p.then(function () { pending.ready = true; }, function () { pending.ready = true; });
          return pending;
        };
        // CITY TRANSITION: when a city was just picked, play one of the generic cached bridge
        // lines ("Let me pull up what's happening right there.") WHILE that city's briefing
        // loads. The line exists to cover the wait, so the fetch starts FIRST — it used to
        // start only after the line finished, which added the line's length to the wait.
        // The same clips serve every city (voiced once per voice + language, never per city).
        // A city whose briefing is already cached answers in well under a second; give the
        // fetch this head start first. If it's in, "give me a moment" would ask people to
        // wait for something already here, so the quick "here's what's on" line plays.
        const READY_WINDOW_MS = 350;
        const playConv = function () {
          if (stale()) return;
          const switched = !!self._identCity, bridge = switched || self._bridgeNext;
          const city = self._identCity || self._focusCity || null;
          self._identCity = null; self._bridgeNext = false;
          const pending = load(switched);                     // a mid-listen switch gets the fast headline tier
          if (!bridge) { playBriefing(pending); return; }
          self._loadingCity = city;                           // loading caption: "Getting <city>…"
          const cap = function (t) { return { text: t.text, kind: 'greeting', lang: 'en-US' }; };
          const headStart = new Promise(function (r) { setTimeout(r, READY_WINDOW_MS); });
          Promise.race([pending.p.then(function () {}, function () {}), headStart]).then(function () {
            if (stale()) return;
            const kind = pending.ready ? 'ready' : 'wait';
            self._pickLine(kind).then(function (t) {
              if (stale()) return;
              if (!t || !t.url) { playBriefing(pending, kind === 'wait'); return; }
              self._setBuffering(false);
              self._audioSpeak(t.url, t.text, function () { playBriefing(pending, kind === 'wait', t.speaker); }, true, cap(t));
            });
          });
        };
        // The name-free brand welcome ("Welcome to Eventually…"), unless the splash
        // already spoke it this session. Runs AFTER the one-time host intro.
        const afterIntro = function () {
          if (stale()) return;
          if (self._needsWelcome() && self.getWelcome) {
            self.getWelcome().then(function (w) {
              if (stale()) return;
              if (w && w.url) self._audioSpeak(w.url, w.text, playConv, true, { text: w.text, kind: 'greeting', lang: 'en-US' });
              else playConv();
            }).catch(playConv);
          } else playConv();
        };
        // STARTUP vs SWITCH. The one-time intro + brand welcome are STARTUP-only. A city
        // SWITCH (_identCity set) skips STRAIGHT to the ident + briefing — no extra intro/
        // welcome round-trips — so it stays snappy (ident ≈ 1s, not ~3s).
        if (this._identCity) { playConv(); return; }
        // ONE-TIME HOST INTRODUCTION (#5): the hosts say their NAMES once per device. We
        // send the sig we last played; the server returns changed:false (NO synthesis) when
        // the hosts/voices are unchanged — so returning users skip it and every briefing
        // stays name-free and cheap. A rename/voice change yields a new sig → introduced once.
        let have = '';
        try { have = (global.localStorage && localStorage.getItem('ev_introSig')) || ''; } catch (e) {}
        if (this.getIntro) {
          this.getIntro({ have: have }).then(function (intro) {
            if (stale()) return;
            if (intro && intro.sig) { try { localStorage.setItem('ev_introSig', intro.sig); } catch (e) {} }
            if (intro && intro.changed && intro.segments && intro.segments.length) {
              self._setBuffering(false);
              self._playSegmentsThen(intro.segments, 0, afterIntro);
            } else afterIntro();
          }).catch(afterIntro);
        } else afterIntro();
        return;
      }
      // Start of the show (once per Play): play a cached ElevenLabs stinger IMMEDIATELY
      // while the full briefing synthesizes in parallel — no browser-voice greeting.
      if (!this._openerDone && (this.getStinger || this.getFreeGreeting)) {
        this._openerDone = true;
        this._setBuffering(true);
        this._pendingBriefing = this.getBriefing ? this.getBriefing() : Promise.resolve(null);   // Plus fetch (parallel)
        // A city was just picked (mid-listen switch, or chosen while stopped) → open with the
        // generic cached transition instead of the stinger. Both are holding lines; playing
        // both back to back would be one too many.
        const bridge = !!(this._identCity || this._bridgeNext);
        this._identCity = null; this._bridgeNext = false;
        // The show proper: PLUS = stinger → briefing; FREE = one brief greeting → stop.
        const proceed = function (bridged) {
          (self.getStinger ? self.getStinger() : Promise.resolve(null)).then(function (s) {
            if (!self.speaking || self.briefingPlaying) return;
            if (s && s.url) {                                   // PLUS: stinger → briefing (+ personalization)
              self._setBuffering(false);
              if (bridged) { self._playPendingBriefing(); return; }   // the transition already covered the wait
              self._audioSpeak(s.url, s.text, function () { self._playPendingBriefing(); },
                false, { text: s.text, kind: 'greeting', lang: 'en-US' });   // stinger read-along, shown on play
            } else {                                            // FREE: one brief greeting, then STOP
              self._pendingBriefing = null;
              self._playFreeGreeting();
            }
          }).catch(function () { self._pendingBriefing = null; self._playFreeGreeting(); });
        };
        const bridgeThenProceed = function () {
          self._nextTransition().then(function (t) {
            if (!self.speaking || self.briefingPlaying) return;
            if (t && t.url) {
              self._setBuffering(false);
              self._audioSpeak(t.url, t.text, function () { proceed(true); }, true, { text: t.text, kind: 'greeting', lang: 'en-US' });
            } else proceed(false);
          });
        };
        const next = bridge ? bridgeThenProceed : function () { proceed(false); };
        // OFFICIAL GREETING: the Host opens with "Welcome to Eventually…" — but ONLY if
        // the launch splash didn't already speak it this session (otherwise the user
        // would hear the same welcome twice within seconds). Applies to Plus, free
        // first-play and free repeat plays; city switches keep their station ident
        // because they don't come through this opener.
        if (this._needsWelcome() && this.getWelcome) {
          this.getWelcome().then(function (w) {
            if (!self.speaking || self.briefingPlaying) return;
            if (w && w.url) {
              self._setBuffering(false);
              // noFallback=true: if the cached clip can't play, SKIP the welcome silently
              // and go straight to the show. The brand greeting must never be read by the
              // robotic device voice (and free tier never uses browser voice at all).
              self._audioSpeak(w.url, w.text, next, true, { text: w.text, kind: 'greeting', lang: 'en-US' });
            } else next();                                      // no clip → don't block the show
          }).catch(next);
        } else next();
        return;
      }
      // TWO-HOST is a PLAY-ONCE-then-music model — it must NOT loop. If a stray rotation
      // reaches here for two-host (e.g. the idle ticker firing while speaking), settle to the
      // music bed instead of re-fetching + replaying the briefing forever (a UX + cost bug).
      if (this.twoHost) { this._endFreeIntro(); return; }
      // Legacy per-line / single-voice refresh path (not used by the two-host experience).
      this._openerDone = true;
      this._setBuffering(true);
      this.getBriefing().then(function (b) { self._setBuffering(false); self._playBriefingResult(b); })
        .catch(function () { self._setBuffering(false); self._freeSegment(); });
      return;
    }
    this._rotateLine();
  };

  // Play the cached audio segments back-to-back, then a music GAP. Each clip is a
  // pre-rendered mp3. The server decides the order — currently sponsor clip(s), then the
  // briefing body, then any announcement — so nothing here may assume segs[0] is the
  // briefing; each segment carries its own caption and is played as it comes.
  AIHost.prototype._playPremiumSegments = function (segs, i) {
    if (!this.speaking || this.briefingPlaying) return;
    if (i >= segs.length) { this._afterSegment(); return; }   // done → GAP → refresh on next rotate
    const seg = segs[i], self = this;
    // Caption is handed to _audioSpeak so it appears exactly when this clip starts.
    // noFallback=true: a clip that fails to load SKIPS to the next segment (or ends to the
    // music bed) — never the browser voice.
    this._audioSpeak(seg.url, seg.text || '', function () { self._playPremiumSegments(segs, i + 1); },
      true, { text: seg.text || '', kind: 'briefing', lang: 'en-US' });
  };

  // FREE: play ONE brief cached ElevenLabs greeting, then STOP (no continuous show).
  // NEVER uses the browser voice. If the ElevenLabs greeting is unavailable, it skips
  // narration entirely and just lets the music bed play (→ _endFreeIntro).
  AIHost.prototype._playFreeGreeting = function () {
    const self = this;
    this._freeMode = true;
    if (!this.getFreeGreeting) { this._setBuffering(false); this._endFreeIntro(); return; }
    this.getFreeGreeting().then(function (g) {
      if (!self.speaking) return;
      self._setBuffering(false);
      if (g && g.segments && g.segments.length) self._playFreeIntro(g.segments, 0);
      else self._endFreeIntro();                          // no clip → music only, no browser voice
    }).catch(function () { self._setBuffering(false); self._endFreeIntro(); });
  };
  // Play the assembled free intro clips (ElevenLabs only), then stop narration but
  // KEEP the music bed playing.
  AIHost.prototype._playFreeIntro = function (segs, i) {
    if (!this.speaking) return;
    if (i >= segs.length) { this._endFreeIntro(); return; }
    const seg = segs[i], self = this;
    this._audioSpeak(seg.url, seg.text || '', function () { self._playFreeIntro(segs, i + 1); },
      true /* no browser fallback */, { text: seg.text || '', kind: 'greeting', lang: 'en-US' });
  };
  // Free intro finished: narration stops, but the music bed keeps playing (uninterrupted)
  // until the user pauses or mutes. The button now controls the music, not narration.
  AIHost.prototype._endFreeIntro = function () {
    this.speaking = false;
    this._musicHold = true;                               // music continues on its own
    this._introDone = true;
    this._premiumPlaying = false;
    this._fillerPlaying = false; clearTimeout(this._fillerGap);   // city radio-filler (if any) is done
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    // Keep the voice element WARM (muted silent loop) instead of pausing it. On iOS Safari a
    // media element that has gone idle often refuses a later programmatic play() — which made
    // the next city switch silent. Staying "playing" (inaudibly) means the switched briefing
    // can always swap in and play, no fresh tap gesture required.
    try { this._primeAudio(); } catch (e) { try { this._audio.pause(); } catch (e2) {} }
    clearInterval(this._voiceTween); clearTimeout(this._gapTimer); clearTimeout(this._introTimer);
    // Kill the idle caption-ticker while we sit on the music bed. It served no purpose here
    // (rotation is a no-op during music-hold) and, crucially, it fired `_rotate` during the next
    // city switch → the legacy refresh path → an infinite re-fetch/replay loop. The ticker is
    // restarted only when the Host is fully paused (stop()).
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    this.onSpeakEnd();                                    // swell the music back up
    this.icPlay.style.display = 'none';                   // button = "music playing"
    this.icPause.style.display = '';
    // CONTINUOUS RADIO: after ~3 min on the music bed, bring the show back around for the
    // current city (re-checks events; replays city segments only if the 3-min cooldown has
    // passed). Cancelled the moment the user switches city, pauses, or stops.
    clearTimeout(this._replayTimer); this._replayTimer = null;
    if (this.twoHost && this.REPLAY_MS > 0) {
      const self = this;
      this._replayTimer = setTimeout(function () { self._radioReplay(); }, this.REPLAY_MS);
    }
  };
  // Continuous-radio re-engage: resume the show for the CURRENT city after the music pause.
  // Only fires if still holding on the music bed (user hasn't switched/paused). Skips the
  // welcome/intro (deduped anyway) and goes straight to the briefing → filler.
  AIHost.prototype._radioReplay = function () {
    clearTimeout(this._replayTimer); this._replayTimer = null;
    if (!this._musicHold || !this.twoHost) return;         // user acted → cancel
    this._musicHold = false; this.speaking = true;
    this._premiumPlaying = false; this._fillerPlaying = false;
    this._openerDone = false;                              // re-run the show for the current city
    this.icPlay.style.display = 'none'; this.icPause.style.display = '';
    this._rotate();
  };

  // ── CITY RADIO FILLER ───────────────────────────────────────────────────────────
  // After the event briefing (or for a quiet city), keep the station going with the city's
  // CACHED modular segments (facts/history/culture/typical events), a ~4s Eventually-music
  // swell between each, then settle on the music bed. All audio is cached + reused (the
  // play-button bed is reused for the transitions), so this adds no per-play AI cost.
  AIHost.prototype._playFillerSegs = function (segs, i, myGen) {
    if (myGen == null) myGen = this._gen;
    if (!this.speaking || myGen !== this._gen) { return; }          // switched away / stopped → abort
    if (!segs || i >= segs.length) { this._fillerPlaying = false; this._endFreeIntro(); return; }
    this._fillerPlaying = true;
    if (i === 0) this._lastFillerAt = Date.now();          // cooldown anchor (no repeat within 3 min)
    const seg = segs[i], self = this;
    this._audioSpeak(seg.url, seg.text || '', function () {
      if (!self.speaking || myGen !== self._gen) { self._fillerPlaying = false; return; }
      self.onSpeakEnd();                                            // 🎵 swell the bed to the front (the "~5s music")
      clearTimeout(self._fillerGap);
      self._fillerGap = setTimeout(function () { self._playFillerSegs(segs, i + 1, myGen); }, self.MUSIC_GAP);
    }, true /* no browser fallback */, { text: seg.text || '', kind: 'greeting', lang: 'en-US' });
  };
  // Fetch the current city's cached filler and play it (radio-style). Cheap: cached after
  // the first ever visit to that city. On failure/none → settle to the music bed.
  // `afterEvents` = the hosts just finished a real event briefing for this city, so the
  // filler must open with the neutral "bridge" line rather than the "it's quiet" one.
  AIHost.prototype._continueWithFiller = function (myGen, afterEvents) {
    const self = this; if (myGen == null) myGen = this._gen;
    if (!this.speaking || myGen !== this._gen) return;
    if (!this.getCityFiller) { this._endFreeIntro(); return; }
    // COOLDOWN: don't replay the city segments within 3 min of last playing them — settle
    // to music instead (the replay timer will bring the show back around later).
    if (Date.now() - this._lastFillerAt < this.FILLER_COOLDOWN) { this._endFreeIntro(); return; }
    this._setBuffering(true);
    Promise.resolve(this.getCityFiller(!!afterEvents)).then(function (f) {
      self._setBuffering(false);
      if (!self.speaking || myGen !== self._gen) return;
      if (f && f.segments && f.segments.length) self._playFillerSegs(f.segments, 0, myGen);
      else self._endFreeIntro();
    }).catch(function () { self._setBuffering(false); if (self.speaking && myGen === self._gen) self._endFreeIntro(); });
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
  // noFallback=true (FREE tier) → on failure, do NOT drop to the browser voice; just
  // advance/finish (music-only). Free must never use the browser voice.
  AIHost.prototype._audioSpeak = function (url, text, afterSegment, noFallback, caption) {
    const self = this, a = this._audio;
    if (this.briefingPlaying) return;                                  // never play premium over the briefing
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();  // enforce one voice: silence browser TTS
    this.onSpeakStart();                                               // duck the music now
    // A clip that can't play is SILENT by design — we degrade to the music bed, never the
    // device voice. But it was silent to us too: a browser refusing play() (blocked
    // autoplay on a phone) skipped every segment in turn, so the show ended in music with
    // no briefing spoken and nothing anywhere to say why. One warning line makes that
    // diagnosable on a real device without changing the behaviour.
    const fail = function (err) {
      try { console.warn('[AIHost] clip did not play (' + ((err && (err.name || err.message)) || 'unknown') + '): ' + url); } catch (e) {}
      self._premiumPlaying = false; self._stopAudioSync();
      if (noFallback) { if (afterSegment) afterSegment(); } else self._browserSpeak(text, afterSegment);
    };
    try {
      a.onended = function () { self._premiumPlaying = false; self._stopAudioSync(); afterSegment(); };
      a.onerror = fail;
      a.loop = false; a.muted = false;                     // clear any iOS keep-alive primer state
      a.src = url;
      // ⚠️ `a.currentTime = 0` on a src that hasn't loaded its metadata yet throws
      // InvalidStateError on Safari. It sat inside the outer try, so the throw landed in
      // fail() — which, with noFallback, silently skips to the next segment. Every segment
      // in turn, and the show ends in music with nothing spoken. Assigning src already
      // resets the position, so this only ever needed to be defensive.
      try { if (a.currentTime) a.currentTime = 0; } catch (e) {}
      try { a.volume = 0; } catch (e) {}                   // start silent → fade the clip in (iOS ignores: volume is read-only there)
      const p = a.play();
      const begin = function () {
        self._premiumPlaying = true;
        // Show this clip's caption AT PLAYBACK START. Setting it before play() meant
        // the text swapped while the previous clip was still audible (and while this
        // one was still buffering) — the caption led the audio by up to seconds.
        if (caption) self._showCaption(caption, true);
        self._startAudioSync();                            // read-along paced by the audio clock
        self._voiceVol(1, 0.35);                           // crossfade the clip in
        self.onSpeakStart();                               // duck music under voice
        clearInterval(self._ampTimer);
        self._ampTimer = setInterval(function () { self.amp = 0.5 + Math.random() * 0.4; }, 180);
      };
      if (p && p.then) p.then(begin).catch(fail);
      else begin();
    } catch (e) { fail(); }
  };

  // Free voice: browser SpeechSynthesis (or a timed simulation if unavailable).
  // Free voice: speak sentence-by-sentence with a natural pause between each (like
  // a radio presenter), using the best available device voice + tuned rate/pitch.
  AIHost.prototype._browserSpeak = function (text, afterSegment) {
    const self = this;
    // BROWSER/DEVICE VOICE IS DISABLED BY DESIGN. The Host is premium-voice (Fish/ElevenLabs)
    // ONLY — if a cached clip is ever unavailable we degrade to the MUSIC BED, never the
    // robotic device voice. This is the single chokepoint every fallback path funnels through,
    // so guarding it here guarantees the device voice can't surface anywhere. (Set
    // this._allowBrowserVoice = true to restore the legacy behaviour.)
    if (!this._allowBrowserVoice) { this._endFreeIntro(); return; }
    try { this._audio.pause(); } catch (e) {}   // enforce one voice: silence the premium element first
    this.onSpeakStart();                         // duck the music NOW (don't wait for onstart, which is flaky)
    if (!('speechSynthesis' in window)) {
      self.amp = 0.5;
      const read = Math.min(9000, 2600 + text.length * 45);
      clearTimeout(self._readTimer); self._readTimer = setTimeout(afterSegment, read);
      return;
    }
    window.speechSynthesis.cancel();
    // Offsets MUST be measured against the same normalized string the caption was
    // tokenized from (_showCaption also normalizes). Previously sentences came from a
    // whitespace-collapsed copy but were located inside the RAW text, so any newline or
    // double space made indexOf miss → offsets fell back to a running counter and every
    // later boundary highlighted the wrong word.
    const norm = normText(text);
    const sentences = self._splitSentences(norm);
    const offsets = []; let cur = 0;
    for (let s = 0; s < sentences.length; s++) { const at = norm.indexOf(sentences[s], cur); offsets.push(at < 0 ? cur : at); cur = (at < 0 ? cur : at) + sentences[s].length; }
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

  // AUTO-START (returning visitors). A visible, cancellable "Host starting in 5…" note in
  // the caption, then the normal show. Refuses if the Host is already on. If `canStart()`
  // is false when the count reaches zero (a dialog is open), the start waits until it's
  // clear. Pressing Play/pause during the count cancels it (see toggle). `onStart` fires
  // only if it really starts.
  AIHost.prototype.autoStart = function (secs, canStart, onStart) {
    if (this.isActive() || this._auto) return false;
    const self = this, cap = this.el.querySelector('.ah-caption');
    if (!cap) return false;
    let n = Math.max(1, secs || 5);
    const note = document.createElement('span');
    note.className = 'ah-auto'; note.setAttribute('role', 'status');
    note.innerHTML = '<span class="ah-auto-t"></span><button class="ah-auto-x" type="button">Cancel</button>';
    note.addEventListener('click', function (e) { e.stopPropagation(); });   // not the transcript tap
    const txt = note.querySelector('.ah-auto-t');
    const show = function () { txt.textContent = n > 0 ? 'Host starting in ' + n + '…' : 'Host starting in a moment…'; };
    const end = function (start) {
      clearInterval(self._autoTimer); self._autoTimer = null; self._auto = null;
      if (note.parentNode) note.parentNode.removeChild(note);
      self.textEl.style.display = '';
      // Short lead-in: the welcome that just played already did the intro's job.
      if (start && !self.isActive()) { self.play({ shortLead: true }); if (onStart) onStart(); }
    };
    note.querySelector('.ah-auto-x').addEventListener('click', function () { end(false); });
    this._auto = { cancel: function () { end(false); } };
    this.textEl.style.display = 'none';
    cap.appendChild(note);
    show();
    this._autoTimer = setInterval(function () {
      if (self.isActive()) { end(false); return; }          // started some other way
      if (n > 0) n--;
      show();
      if (n === 0 && (!canStart || canStart())) end(true);
    }, 1000);
    return true;
  };
  // Unlock the voice element inside a tap so a later auto-start can play on mobile.
  // Never while the Host is on — it would cut off whatever is playing.
  // Public: called from the app's first-tap handler. The isActive() gate that used to be
  // here skipped the unlock during the music hold — exactly the state a spike tap arrives
  // in, and exactly when the next clip needs permission. _primeAudio guards itself against
  // interrupting a clip, so the gate was only ever losing us unlocks.
  AIHost.prototype.primeAudio = function () { this._primeAudio(); };

  AIHost.prototype.toggle = function () {
    if (this._auto) this._auto.cancel();                 // Play/pause during the countdown takes over
    if (this.speaking) return this.stop();               // narration playing → stop everything
    if (this._musicHold) return this._musicPause();      // free: music bed playing → stop the music
    // Fully stopped. Free with the intro already played this session → just resume the
    // music bed (don't replay the intro). Otherwise start the show/intro.
    if (this._freeMode && this._introDone) return this._musicResume();
    this.play();
  };
  // Music-only controls (free tier, after the intro).
  AIHost.prototype._musicPause = function () {
    this._musicHold = false;
    clearTimeout(this._replayTimer); this._replayTimer = null;   // paused → cancel the radio replay
    this.onPause();                                      // stop the music bed
    this.icPlay.style.display = ''; this.icPause.style.display = 'none';
  };
  AIHost.prototype._musicResume = function () {
    this._musicHold = true;
    this.onPlay();                                       // resume the music bed (no narration)
    this.icPlay.style.display = 'none'; this.icPause.style.display = '';
    clearTimeout(this._replayTimer);                     // resumed → bring the show back around (~3 min)
    if (this.twoHost && this.REPLAY_MS > 0) { const self = this; this._replayTimer = setTimeout(function () { self._radioReplay(); }, this.REPLAY_MS); }
  };

  AIHost.prototype.play = function (opts) {
    this.speaking = true;
    this._gen++;                           // new session → invalidate any older in-flight fetch
    this._musicHold = false; this._freeMode = false;
    this._openerDone = false;              // premium stinger plays once per Play session
    this._openingDone = false;             // replay the show opening (intro → briefing) on each Play
    this._switchPending = false;
    this._identCity = null;                // a fresh Play is not a mid-listen switch…
    this._bridgeNext = !!this._cuePending; // …but if a city was picked while stopped, open with the transition
    this.setNewBriefingCue(false);         // pressing Play consumes any "new briefing" cue
    if (this.getTransitions) this.getTransitions();   // fetch + pre-download the transitions now, so a switch is instant
    this.icPlay.style.display = 'none';
    this.icPause.style.display = '';
    this._unlockSpeech();                   // MUST run inside the tap to enable mobile TTS
    this.onPlay();                          // music starts and plays alone first
    if (this._timer) { clearInterval(this._timer); this._timer = null; }   // pause silent ticker
    const self = this;
    // full ~10s intro on the first play; ~6s on an auto-start (opts.shortLead, which
    // follows the spoken welcome); ~3s on a later resume, where the listener already
    // knows what the bed sounds like.
    const auto = !!(opts && opts.shortLead);
    const lead = auto ? this._jitter(this.AUTO_INTRO, 800)
      : this._everPlayed ? this._jitter(this.SHORT_INTRO, 800)
      : this._jitter(this.INTRO, 1200);
    this._everPlayed = true;
    clearTimeout(this._introTimer);
    this._introTimer = setTimeout(function () { self._introTimer = null; if (self.speaking) self._rotate(); }, lead);
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
    // One implementation of the unlock, not two that disagreed: _primeAudio does the
    // unmuted silent play, guards a clip that is already playing, and only records
    // success when the play resolves. Safe to call whether or not we're in a gesture.
    this._primeAudio();
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
    this._gen++;                           // invalidate any in-flight generation on stop
    this.briefingPlaying = false;
    this._switchPending = false;
    this._premiumPlaying = false;
    this._fillerPlaying = false;
    this._musicHold = false;
    this._pendingBriefing = null;
    this._identCity = null;
    this._bridgeNext = false;
    this._setBuffering(false);
    this.icPlay.style.display = '';
    this.icPause.style.display = 'none';
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    try { this._audio.pause(); } catch (e) {}
    clearInterval(this._ampTimer); clearInterval(this._voiceTween);
    clearTimeout(this._introTimer); clearTimeout(this._gapTimer); clearTimeout(this._readTimer); clearTimeout(this._switchFade);
    clearTimeout(this._replayTimer); this._replayTimer = null; clearTimeout(this._fillerGap);   // cancel continuous-radio replay + filler
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

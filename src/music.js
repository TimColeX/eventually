/* Eventually — background music bed for the AI Host (radio-DJ style).
 * Plays while the Host is "on": ducks to a soft presence under speech, swells
 * between segments.
 *
 * Level control goes through the Web Audio API (a master GainNode), so ducking
 * works on EVERY platform — including iOS, where HTMLMediaElement.volume is
 * read-only. A real track (<audio id="bg-music" src>) is routed through the
 * context via a MediaElementSource; with no track we synthesize an ambient bed.
 *
 * Trade-off: a Web-Audio-routed element can be suspended when the app is
 * backgrounded on some mobile browsers → we resume the context (and resume the
 * element) whenever the app returns to the foreground. If Web Audio is
 * unavailable we fall back to direct <audio> playback (background-safe, but no
 * ducking).
 *
 * To use your own track: add  <audio id="bg-music" src="assets/yourtrack.mp3">
 * to index.html (no other changes needed) and it will be used automatically.
 */
(function (global) {
  'use strict';

  // On-screen audio diagnostics (?audiodebug=1). A no-op unless app.js installed the panel.
  function ealog(msg) { try { if (global.__eaLog) global.__eaLog('[music] ' + msg); } catch (e) {} }

  const BED = 0.18;     // normal bed level (music "swells" up to here)
  // ~39% of the bed, about 8 dB below it — a normal radio duck. It was 0.036 (20%,
  // roughly -29 dB), which measured as present but was inaudible in practice: under a
  // voice at full volume, on a phone speaker, it read as "the music never started".
  // The giveaway was that Pause then Play "fixed" it — that path plays the bed at 0.18
  // with nothing over it. ⚠️ The opposite complaint (music too loud under speech) is
  // what produced 0.036 in v78, so this is the balance point between the two; the clips
  // play back-to-back with no swell between them, so whatever is set here is the level
  // for the WHOLE briefing, not just one sentence.
  const DUCK = 0.07;
  const DOWN = 0.22;    // duck-in time (fast, so speech is clear promptly)
  const UP = 1.2;       // swell-out time (smooth, natural)

  function Music() {
    this.audioEl = null;             // real track element
    this.ctx = null; this.master = null;
    this.on = false; this._built = false; this._direct = false; this._tween = null;
    this._ducked = false; this.muted = false;
    this._primedSilent = false;      // playing (inaudibly) purely to hold the autoplay unlock
    this._unlocked = false;          // true only once a play() has genuinely RESOLVED
    this._primeTimer = null;
  }

  Music.prototype._build = function () {
    if (this._built) return !!(this.master || this.audioEl);
    this._built = true;
    const Ctx = global.AudioContext || global.webkitAudioContext;
    const el = document.getElementById('bg-music');
    const hasTrack = el && el.getAttribute('src');

    // REAL TRACK → route through Web Audio (MediaElementSource → master GainNode) so the bed
    // can DUCK under the Host's voice on EVERY platform, INCLUDING iOS — where a plain
    // <audio>'s .volume is read-only and can't be turned down. This is the behaviour that
    // "used to work fine": the music drops to a soft presence while the hosts speak and
    // swells back between segments. Trade-off (an Apple limitation, not a bug): iOS SUSPENDS a
    // Web-Audio-routed element when the app is backgrounded, so the music pauses if you leave
    // the app; it resumes automatically when you return (_wireResume). You can't have both
    // ducking AND background audio on iPhone Safari — ducking is the chosen priority.
    if (hasTrack && Ctx) {
      try {
        const ctx = new Ctx(); this.ctx = ctx;
        el.loop = true; el.setAttribute('playsinline', ''); try { el.volume = 1; } catch (e) {}
        const src = ctx.createMediaElementSource(el);
        const master = ctx.createGain(); master.gain.value = 0;
        src.connect(master); master.connect(ctx.destination);
        this.master = master; this.audioEl = el;
        this._wireResume();
        return true;
      } catch (e) { this.ctx = null; this.master = null; /* fall through to direct */ }
    }
    if (hasTrack) {                             // Web Audio unavailable → direct playback (no ducking)
      el.loop = true; el.setAttribute('playsinline', ''); try { el.volume = 0; } catch (e) {}
      this.audioEl = el; this._direct = true; this._wireResume();
      return true;
    }
    return this._buildSynth();                  // no track → Web Audio ambient bed (foreground only)
  };

  Music.prototype._buildSynth = function () {
    const Ctx = global.AudioContext || global.webkitAudioContext;
    if (!Ctx) return false;
    const ctx = new Ctx(); this.ctx = ctx;
    const master = ctx.createGain(); master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp); comp.connect(ctx.destination);
    this.master = master;
    this._synth(ctx, master);
    this._wireResume();
    return true;
  };

  // Warm, slow, low ambient pad — a tasteful radio bed, not a melody.
  Music.prototype._synth = function (ctx, master) {
    const reverb = ctx.createConvolver();
    const len = ctx.sampleRate * 4, buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
    }
    reverb.buffer = buf;
    const wet = ctx.createGain(); wet.gain.value = 0.8; reverb.connect(wet); wet.connect(master);
    const dry = ctx.createGain(); dry.gain.value = 0.6; dry.connect(master);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 620; lp.Q.value = 0.6;
    lp.connect(dry); lp.connect(reverb);
    const bus = ctx.createGain(); bus.gain.value = 0.4; bus.connect(lp);

    [55, 110, 130.81, 164.81, 220].forEach(function (f, i) {
      const o = ctx.createOscillator();
      o.type = i < 2 ? 'sine' : 'triangle'; o.frequency.value = f; o.detune.value = (i - 2) * 3;
      const g = ctx.createGain(); g.gain.value = (i < 2 ? 0.3 : 0.12) / (1 + i * 0.2);
      o.connect(g); g.connect(bus); o.start();
    });
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05;
    const lg = ctx.createGain(); lg.gain.value = 200; lfo.connect(lg); lg.connect(lp.frequency); lfo.start();
  };

  // Master-gain level ramp (Web Audio — the normal path).
  Music.prototype._ramp = function (to, secs) {
    if (!this.ctx || !this.master) return;
    const n = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(n);
    this.master.gain.setValueAtTime(this.master.gain.value, n);
    this.master.gain.linearRampToValueAtTime(to, n + secs);
  };

  // Direct <audio>.volume tween (fallback only, where Web Audio is unavailable).
  Music.prototype._tweenVol = function (to, secs) {
    const el = this.audioEl; if (!el) return;
    if (this._tween) { clearInterval(this._tween); this._tween = null; }
    const from = el.volume, steps = Math.max(1, Math.round(secs * 20)), dv = (to - from) / steps;
    let i = 0; const self = this;
    this._tween = setInterval(function () {
      i++; let v = from + dv * i; v = v < 0 ? 0 : (v > 1 ? 1 : v);
      try { el.volume = v; } catch (e) {}
      if (i >= steps) { try { el.volume = to < 0 ? 0 : (to > 1 ? 1 : to); } catch (e) {} clearInterval(self._tween); self._tween = null; }
    }, 50);
  };

  Music.prototype._level = function (to, secs) {
    if (this._direct) this._tweenVol(to, secs); else this._ramp(to, secs);
  };

  Music.prototype.start = function () {
    if (!this._build()) return;
    this.on = true;
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(function () {});
    const el = this.audioEl;
    if (el) {
      // Coming off the primer: rewind so the bed opens at the top of the track rather
      // than wherever the silent keep-alive had reached. (Nothing to unmute — the primer
      // deliberately plays UNMUTED so that it counts as an unlock on Safari; it is
      // inaudible because the master gain is still 0.)
      if (this._primedSilent) { this._primedSilent = false; el.muted = false; try { el.currentTime = 0; } catch (e) {} }
      const self = this;
      try {
        const p = el.play();
        // A REJECTION HERE IS THE "no music until you press pause then play" BUG. It was
        // swallowed silently, so there was nothing to find. Say so.
        if (p && p.then) p.then(function () { self._unlocked = true; ealog('music bed playing'); }, function (err) {
          try { console.warn('[Music] bed refused to play (' + ((err && (err.name || err.message)) || 'unknown') + ') — autoplay unlock lost'); } catch (e) {}
          ealog('✖ MUSIC BED REFUSED: ' + ((err && err.name) || err));
        });
      } catch (e) {}
      this._mediaSession();
    }
    this._level(this.muted ? 0 : BED, 1.6);      // swell in (silent if muted)
  };

  // Unlock audio INSIDE a user gesture so a later start() that is NOT tied to a tap (the
  // Host's auto-start countdown, ~11s after the tap) is allowed to play.
  //
  // ⚠️ This used to play the element and then PAUSE it again. On iOS that gives the unlock
  // back: an element that has been left paused can have a later programmatic play()
  // refused, which is silent — the promise rejection was swallowed — so the bed simply
  // never arrived and only pressing pause/play (a real gesture) brought it back. The
  // Host's own voice element never had this problem because _primeAudio in aihost.js keeps
  // it ALIVE on a looping silent clip instead of pausing it. This now does the same: the
  // track keeps playing, MUTED, until start() unmutes it. Two reasons it is inaudible
  // meanwhile — muted, and the master gain is still 0 — so it is safe in direct mode too,
  // which is why that exclusion is gone.
  Music.prototype.prime = function () {
    if (!this._build()) return;
    // Already playing (started by a tap on Play) — that IS a resolved unlock.
    if (this.on) { if (this.audioEl && !this.audioEl.paused) this._unlocked = true; return; }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(function () {});
    const el = this.audioEl;
    if (!el) return;
    const self = this;
    try {
      // ⚠️ NOT muted. The same lesson as the Host's voice element: Safari grants an
      // element no permission for a MUTED play, because muted playback needed none. It
      // has to be an UNMUTED play inside the gesture to count. This is inaudible anyway —
      // the master gain is 0 until start() ramps it up, and in direct mode (no Web Audio)
      // the element's own volume is 0 from _build.
      el.muted = false;
      this._primedSilent = true;
      const p = el.play();
      // Only a play that RESOLVED is an unlock. app.js keeps re-priming on every gesture
      // until this is true — which is what lets a failed first attempt be retried.
      if (p && p.then) p.then(function () { self._unlocked = true; ealog('music unlocked'); },
        function (err) { ealog('music prime refused: ' + ((err && err.name) || err)); });
      else self._unlocked = true;
    } catch (e) {}
    // Don't decode a looping track forever on a phone if the Host is never started. The
    // auto-start fires about 11s after the tap, so this is far past it; any start after
    // this point comes from a real tap on Play, which needs no unlock.
    clearTimeout(this._primeTimer);
    this._primeTimer = setTimeout(function () {
      if (self.on) return;
      self._primedSilent = false;
      try { el.pause(); } catch (e) {}
    }, 45000);
  };

  // The bed should be playing but isn't — recover it. Called whenever the Host starts or
  // stops speaking, because that is when a phone is most likely to have taken the audio
  // session away from a second element, or suspended a backgrounded context.
  Music.prototype._ensure = function () {
    if (!this.on) return;
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(function () {});
    const el = this.audioEl;
    if (el && el.paused) {
      try { const p = el.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
    }
  };

  Music.prototype.stop = function () {
    this.on = false;
    clearTimeout(this._primeTimer);
    const self = this, el = this.audioEl;
    this._level(0, 0.9);
    if (el) setTimeout(function () { if (!self.on) { try { el.pause(); } catch (e) {} } }, 1000);
  };

  // duck(true) → soft presence under speech; duck(false) → swell back between segments.
  Music.prototype.duck = function (d) {
    this._ducked = d;
    if (!this.on) return;
    this._ensure();                       // the Host just started/stopped: make sure the bed survived it
    if (this.muted) return;
    this._level(d ? DUCK : BED, d ? DOWN : UP);
  };

  // Mute/unmute ONLY the music bed — narration keeps playing. Unmuting restores the
  // level appropriate to whether the Host is currently speaking (ducked) or not.
  Music.prototype.setMuted = function (m) {
    this.muted = !!m;
    if (!this.on) return;
    this._level(this.muted ? 0 : (this._ducked ? DUCK : BED), 0.25);
  };

  // Resume the context + element when the app returns to the foreground (mobile
  // suspends a Web-Audio-routed element in the background).
  Music.prototype._wireResume = function () {
    const self = this;
    const resume = function () {
      if (!self.on) return;
      if (self.ctx && self.ctx.state === 'suspended') self.ctx.resume().catch(function () {});
      if (self.audioEl && self.audioEl.paused) { try { self.audioEl.play().catch(function () {}); } catch (e) {} }
    };
    document.addEventListener('visibilitychange', function () { if (!document.hidden) resume(); });
    global.addEventListener('focus', resume);
  };

  // Lock-screen / background media metadata — helps the OS keep audio alive.
  Music.prototype._mediaSession = function () {
    if (!('mediaSession' in navigator)) return;
    try {
      if (global.MediaMetadata) {
        navigator.mediaSession.metadata = new global.MediaMetadata({
          title: 'Eventually', artist: 'Live globe radio', album: 'Eventually'
        });
      }
      navigator.mediaSession.playbackState = 'playing';
    } catch (e) {}
  };

  global.EventuallyMusic = Music;
})(window);

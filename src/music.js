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

  const BED = 0.18;     // normal bed level (music "swells" up to here)
  const DUCK = 0.036;   // ~20% of the bed — soft presence under the Host's voice
  const DOWN = 0.22;    // duck-in time (fast, so speech is clear promptly)
  const UP = 1.2;       // swell-out time (smooth, natural)

  function Music() {
    this.audioEl = null;             // real track element
    this.ctx = null; this.master = null;
    this.on = false; this._built = false; this._direct = false; this._tween = null;
    this._ducked = false; this.muted = false;
  }

  Music.prototype._build = function () {
    if (this._built) return !!(this.master || this.audioEl);
    this._built = true;
    const Ctx = global.AudioContext || global.webkitAudioContext;
    const el = document.getElementById('bg-music');
    const hasTrack = el && el.getAttribute('src');

    if (hasTrack && Ctx) {                      // real track through Web Audio → duck anywhere
      try {
        const ctx = new Ctx(); this.ctx = ctx;
        el.loop = true; el.setAttribute('playsinline', ''); try { el.volume = 1; } catch (e) {}
        const src = ctx.createMediaElementSource(el);
        const master = ctx.createGain(); master.gain.value = 0;
        src.connect(master); master.connect(ctx.destination);
        this.master = master; this.audioEl = el;
        this._wireResume();
        return true;
      } catch (e) { this.ctx = null; this.master = null; /* fall through */ }
    }
    if (hasTrack) {                             // Web Audio unavailable → direct playback (no ducking)
      el.loop = true; el.setAttribute('playsinline', ''); try { el.volume = 0; } catch (e) {}
      this.audioEl = el; this._direct = true;
      return true;
    }
    return this._buildSynth();                  // no track → Web Audio ambient bed
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
    if (this.audioEl) { try { this.audioEl.play().catch(function () {}); } catch (e) {} this._mediaSession(); }
    this._level(this.muted ? 0 : BED, 1.6);      // swell in (silent if muted)
  };

  Music.prototype.stop = function () {
    this.on = false;
    const self = this, el = this.audioEl;
    this._level(0, 0.9);
    if (el) setTimeout(function () { if (!self.on) { try { el.pause(); } catch (e) {} } }, 1000);
  };

  // duck(true) → soft presence under speech; duck(false) → swell back between segments.
  Music.prototype.duck = function (d) {
    this._ducked = d;
    if (!this.on || this.muted) return;
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

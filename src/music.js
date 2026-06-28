/* Eventually — background music bed for the AI Host (radio-DJ style).
 * Plays while the Host is "on": ducks to a whisper under speech, swells between
 * segments.
 *
 * Background playback: when a real track (<audio id="bg-music" src>) is provided
 * we play it DIRECTLY as an HTML media element and control level via el.volume.
 * That keeps it playing when the app is backgrounded (like any music app). We do
 * NOT route it through a Web Audio AudioContext, because mobile browsers suspend
 * the context in the background — which would mute the music while the Host's
 * speechSynthesis keeps talking (the bug this avoids).
 *
 * If no real track is present we synthesize an ambient bed via Web Audio (that
 * fallback does suspend in the background — provide a real track to avoid it).
 *
 * Note: iOS treats <audio>.volume as read-only (hardware-controlled), so ducking
 * is a no-op there, but the track still keeps playing in the background.
 *
 * To use your own track: add  <audio id="bg-music" src="assets/yourtrack.mp3">
 * to index.html (no other changes needed) and it will be used automatically.
 */
(function (global) {
  'use strict';

  const BED = 0.17;    // level between segments (music "swells" up to here)
  const DUCK = 0.05;   // level under the Host's voice (whisper)

  function Music() {
    this.audioEl = null;          // real track — direct playback (background-safe)
    this.ctx = null; this.master = null;   // synth fallback only
    this.on = false; this._tween = null;
  }

  Music.prototype._build = function () {
    const el = document.getElementById('bg-music');
    if (el && el.getAttribute('src')) {       // real track → direct HTML playback
      el.loop = true;
      el.setAttribute('playsinline', '');
      try { el.volume = 0; } catch (e) {}
      this.audioEl = el;
      return true;
    }
    return this._buildSynth();                 // no track → Web Audio ambient bed
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

  // --- synth (Web Audio) level ramp ---
  Music.prototype._ramp = function (to, secs) {
    const n = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(n);
    this.master.gain.setValueAtTime(this.master.gain.value, n);
    this.master.gain.linearRampToValueAtTime(to, n + secs);
  };

  // --- real <audio> volume tween (where volume is settable; no-op effect on iOS) ---
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

  Music.prototype.start = function () {
    if (!this.audioEl && !this.ctx && !this._build()) return;
    this.on = true;
    if (this.audioEl) {
      try { this.audioEl.volume = 0; } catch (e) {}
      this.audioEl.play().catch(function () {});
      this._tweenVol(BED, 1.6);               // swell in
      this._mediaSession();
    } else if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      this._ramp(BED, 1.6);
    }
  };

  Music.prototype.stop = function () {
    this.on = false;
    if (this.audioEl) {
      const el = this.audioEl, self = this;
      this._tweenVol(0, 1.0);
      setTimeout(function () { if (!self.on) el.pause(); }, 1100);
    } else if (this.ctx) {
      this._ramp(0, 1.0);
    }
  };

  // duck(true) under speech; duck(false) swells back between segments.
  Music.prototype.duck = function (d) {
    if (!this.on) return;
    if (this.audioEl) this._tweenVol(d ? DUCK : BED, d ? 0.4 : 1.3);
    else if (this.ctx) this._ramp(d ? DUCK : BED, d ? 0.4 : 1.3);
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

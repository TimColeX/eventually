/* Eventually — background music bed for the AI Host (radio-DJ style).
 * Plays while the Host is "on": ducks to a whisper under speech, swells between
 * segments. Uses a real track if one is provided (an <audio id="bg-music" src>),
 * otherwise synthesizes a subtle ambient bed. Frontend only; gesture-gated.
 *
 * To use your own track later: add  <audio id="bg-music" src="assets/yourtrack.mp3">
 * to index.html (no other changes needed) and it will be used automatically.
 */
(function (global) {
  'use strict';

  const BED = 0.17;    // level between segments (music "swells" up to here)
  const DUCK = 0.05;   // level under the Host's voice (whisper)

  function Music() {
    this.ctx = null; this.master = null; this.on = false;
    this.audioEl = null; this.nodes = [];
  }

  Music.prototype._build = function () {
    const Ctx = global.AudioContext || global.webkitAudioContext;
    if (!Ctx) return false;
    const ctx = new Ctx(); this.ctx = ctx;
    const master = ctx.createGain(); master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp); comp.connect(ctx.destination);
    this.master = master;

    const el = document.getElementById('bg-music');
    if (el && el.getAttribute('src')) {            // real track provided → use it
      el.loop = true;
      try {
        const src = ctx.createMediaElementSource(el);
        src.connect(master); this.audioEl = el; return true;
      } catch (e) { /* fall through to synth */ }
    }
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

  Music.prototype._ramp = function (to, secs) {
    const n = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(n);
    this.master.gain.setValueAtTime(this.master.gain.value, n);
    this.master.gain.linearRampToValueAtTime(to, n + secs);
  };

  Music.prototype.start = function () {
    if (!this.ctx && !this._build()) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (this.audioEl) this.audioEl.play().catch(function () {});
    this.on = true;
    this._ramp(BED, 1.6);          // swell in
  };
  Music.prototype.stop = function () {
    if (!this.ctx) return;
    this.on = false;
    this._ramp(0, 1.0);
    const el = this.audioEl;
    if (el) setTimeout(function () { el.pause(); }, 1100);
  };
  // duck(true) under speech; duck(false) swells back between segments.
  Music.prototype.duck = function (d) {
    if (!this.on || !this.ctx) return;
    this._ramp(d ? DUCK : BED, d ? 0.4 : 1.3);
  };

  global.EventuallyMusic = Music;
})(window);

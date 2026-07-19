/* Eventually — signature opening (the brand "launch moment").
 *
 * A short branded splash shown once per session on launch: animated wordmark,
 * tagline, a LIVE count of what's happening near the user, and (for free users) a
 * gentle Eventually Plus invitation. Because browsers block audio autoplay, the
 * SONIC LOGO (a procedural "ta-dum") + any spoken welcome fire on the user's first
 * tap — the natural "enter" moment — then the splash dismisses to the globe.
 *
 * Frontend-only + self-contained. The sonic logo is a placeholder synth sting
 * (swap `playSting` for a custom audio file later with no other change). A
 * `getVoice` hook lets a cached-ElevenLabs spoken welcome be added later without
 * touching this module's callers.
 */
(function (global) {
  'use strict';

  const SHOWN_KEY = 'eventually.signature.shown';  // sessionStorage — once per session
  const OFF_KEY   = 'eventually.signature.off';     // localStorage — user disabled it
  let el = null, dismissed = false, timer = null, entered = false;

  function isEnabled() { try { return localStorage.getItem(OFF_KEY) !== '1'; } catch (e) { return true; } }
  function setEnabled(on) { try { on ? localStorage.removeItem(OFF_KEY) : localStorage.setItem(OFF_KEY, '1'); } catch (e) {} }
  function reduced() { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }

  // Procedural sonic logo: a warm two-note "ta-dum" (rising fifth) over a soft pad
  // with a gentle bell shimmer. ~1.6s. Must be triggered from a user gesture.
  function playSting() {
    try {
      const AC = global.AudioContext || global.webkitAudioContext; if (!AC) return;
      const ctx = new AC();
      const now = ctx.currentTime;
      const master = ctx.createGain();
      master.connect(ctx.destination);
      master.gain.setValueAtTime(0.0001, now);
      master.gain.exponentialRampToValueAtTime(0.55, now + 0.05);
      master.gain.exponentialRampToValueAtTime(0.30, now + 0.9);
      master.gain.exponentialRampToValueAtTime(0.0001, now + 1.9);
      function note(freq, t0, dur, type, gain) {
        const o = ctx.createOscillator(); o.type = type || 'triangle'; o.frequency.value = freq;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, now + t0);
        g.gain.exponentialRampToValueAtTime(gain, now + t0 + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, now + t0 + dur);
        o.connect(g); g.connect(master); o.start(now + t0); o.stop(now + t0 + dur + 0.05);
      }
      note(146.83, 0.00, 1.7, 'sine',     0.16);  // D3 pad underneath
      note(220.00, 0.00, 0.55, 'triangle', 0.55); // "ta"  (A3)
      note(329.63, 0.32, 1.35, 'triangle', 0.58); // "dum" (E4) — warm rising fifth
      note(659.26, 0.32, 1.05, 'sine',     0.14); // bell shimmer (E5)
      setTimeout(function () { try { ctx.close(); } catch (e) {} }, 2300);
    } catch (e) {}
  }

  function dismiss() {
    if (dismissed) return; dismissed = true;
    if (timer) { clearTimeout(timer); timer = null; }
    if (el) {
      el.classList.add('sg-out');
      const node = el;
      setTimeout(function () { if (node && node.parentNode) node.parentNode.removeChild(node); }, 480);
      el = null;
    }
  }

  // Spoken welcome: cached ElevenLabs clips (fixed lines → synthesized once, ever).
  // Plays AFTER the sonic logo, over the revealed globe, so entry stays snappy.
  const STING_MS = 1750;                 // let the sonic logo finish first
  let voiceEl = null;
  let voicePromise = null;               // PREFETCHED while the splash is on screen
  function stopVoice() {
    if (voiceEl) { try { voiceEl.pause(); voiceEl.src = ''; } catch (e) {} voiceEl = null; }
  }
  function playVoice(p) {
    if (!p || typeof p.then !== 'function') return;
    p.then(function (res) {
      const segs = (res && res.segments) || res;
      if (!segs || !segs.length) return;                 // no audio → the sting alone carries it
      let i = 0;
      voiceEl = new Audio();
      voiceEl.preload = 'auto';
      const el2 = voiceEl;
      function next() {
        if (voiceEl !== el2) return;                     // stopped/superseded
        if (i >= segs.length) { stopVoice(); return; }
        const s = segs[i++];
        if (!s || !s.url) return next();
        el2.src = s.url;
        const pr = el2.play();
        if (pr && pr.catch) pr.catch(function () { stopVoice(); });
      }
      el2.addEventListener('ended', next);
      el2.addEventListener('error', next);
      next();
    }).catch(function () {});
  }
  // If the user starts the AI Host, drop the opening voice so they never overlap.
  document.addEventListener('click', function (e) {
    if (e.target && e.target.closest && e.target.closest('#ai-host')) stopVoice();
  }, true);

  // First tap = the "enter" gesture: sonic logo, then the spoken welcome, then out.
  function enter(opts) {
    if (entered) { dismiss(); return; }
    entered = true;
    playSting();
    // Voice was prefetched when the splash appeared, so it's ready to play the
    // instant the sonic logo finishes (the fetch itself can take seconds).
    if (voicePromise) setTimeout(function () { playVoice(voicePromise); }, STING_MS);
    dismiss();
  }

  function countUp(node, target) {
    if (!node) return;
    if (reduced() || target <= 0) { node.textContent = target; return; }
    const dur = 950, start = performance.now();
    (function step(t) {
      const p = Math.min(1, (t - start) / dur);
      node.textContent = Math.round(p * target);
      if (p < 1) requestAnimationFrame(step);
    })(start);
  }

  // opts: { nearCount, totalCount, isPlus, onUpgrade, getVoice }
  function play(opts) {
    opts = opts || {};
    if (!isEnabled()) return false;
    try { if (sessionStorage.getItem(SHOWN_KEY)) return false; sessionStorage.setItem(SHOWN_KEY, '1'); } catch (e) {}

    // Fresh run: reset per-show state and clear any stale overlay (defensive —
    // play() is normally once per session, but never leave two splashes around).
    dismissed = false; entered = false;
    const stale = document.getElementById('signature'); if (stale && stale.parentNode) stale.parentNode.removeChild(stale);

    // PREFETCH the spoken welcome now, while the user is reading the splash. The
    // clips are cached server-side but the round trip still costs seconds, so
    // starting it here means the voice is ready the moment the sting ends.
    voicePromise = null;
    if (typeof opts.getVoice === 'function') {
      try { const vp = opts.getVoice(); if (vp && typeof vp.then === 'function') voicePromise = vp.catch(function () { return null; }); } catch (e) {}
    }

    const near = opts.nearCount || 0, total = opts.totalCount || 0;
    const target = near > 0 ? near : total;
    const countLine = near > 0
      ? '<b class="sg-num">0</b> event' + (near === 1 ? '' : 's') + ' happening near you today'
      : (total > 0 ? '<b class="sg-num">0</b> events happening around the world today'
                   : 'Live experiences from around the world');
    const upsell = opts.isPlus ? '' :
      '<button class="sg-plus" type="button">✦ Unlock Eventually Plus — personalized AI briefings &amp; recommendations</button>';

    el = document.createElement('div');
    el.id = 'signature';
    el.className = 'signature' + (reduced() ? ' sg-reduced' : '');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Welcome to Eventually');
    el.innerHTML =
      '<div class="sg-inner">' +
        '<span class="sg-dots"><i></i><i></i><i></i></span>' +
        '<h1 class="sg-word">eventually</h1>' +
        '<p class="sg-tag">Your gateway to live experiences around the world</p>' +
        '<p class="sg-count">' + countLine + '</p>' +
        upsell +
        '<button class="sg-enter" type="button">Tap to enter <span aria-hidden="true">›</span></button>' +
        '<button class="sg-off" type="button">Don’t show this again</button>' +
      '</div>';
    document.body.appendChild(el);
    countUp(el.querySelector('.sg-num'), target);

    el.addEventListener('click', function (e) {
      if (e.target.closest('.sg-off')) { e.stopPropagation(); setEnabled(false); dismiss(); return; }
      if (e.target.closest('.sg-plus')) { e.stopPropagation(); dismiss(); if (opts.onUpgrade) opts.onUpgrade(); return; }
      enter(opts);   // tap anywhere else = enter (plays the sonic logo)
    });
    // If the user never taps, dismiss visually after a beat (no sound — no gesture).
    timer = setTimeout(dismiss, 6500);
    return true;
  }

  global.EventuallySignature = { play: play, dismiss: dismiss, stopVoice: stopVoice, isEnabled: isEnabled, setEnabled: setEnabled };
})(window);

/* Eventually — first-run onboarding tour.
 *
 * Four coach marks over the REAL interface, not a slideshow. Two reasons that matters here:
 *   1. The app changes often; screenshots would go stale within weeks, and would need
 *      separate desktop and mobile sets. Pointing at live elements never goes stale.
 *   2. Browsers block autoplay, so the AI Host — the thing that makes Eventually memorable —
 *      cannot speak without a user gesture. The final step's button IS the Play press, so the
 *      tour ends by STARTING the host rather than describing it.
 *
 * Robustness: steps target `data-tour="..."` attributes, never CSS selectors, and any step
 * whose target is missing is SKIPPED. A future UI change therefore shortens the tour instead
 * of breaking it — the failure mode is a shorter tour, never a stuck overlay.
 */
(function (global) {
  'use strict';

  const KEY = 'eventually.tourSeen.v1';       // per-device; survives sign-out
  let el = null, idx = 0, steps = [], onFinish = null, active = false;

  function seen() { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return true; } }
  function markSeen() { try { localStorage.setItem(KEY, '1'); } catch (e) {} }

  // The four steps. `target` is a data-tour name; `place` is the preferred side, which the
  // positioner overrides whenever the tooltip would fall outside the viewport.
  function buildSteps() {
    return [
      { target: 'globe', place: 'center',
        title: 'This is happening right now',
        body: 'Every spike is real events. Drag to spin the world.' },
      { target: 'globe', place: 'center', pauseSpin: true,
        title: 'Tap a spike',
        body: 'Tap any glowing spike to see what’s on there.' },
      { target: 'location', place: 'bottom',
        title: 'Make it yours',
        body: 'Set your city — the globe starts where you are.' },
      { target: 'play', place: 'top', last: true,
        title: 'Meet your host',
        body: 'They’ll tell you what’s on, wherever you’re looking.' },
    ];
  }

  const targetEl = (name) => document.querySelector('[data-tour="' + name + '"]');

  function visible(node) {
    if (!node) return false;
    const r = node.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
  }

  function render() {
    const s = steps[idx];
    if (!s) return finish(false);

    const node = targetEl(s.target);
    // Missing or off-screen target → skip rather than point at nothing.
    if (!visible(node)) { idx++; return render(); }

    const ring = el.querySelector('.tr-ring');
    const card = el.querySelector('.tr-card');
    const r = node.getBoundingClientRect();

    // Spotlight ring. The globe fills the screen, so it gets a soft centre highlight rather
    // than a rectangle tracing the whole canvas.
    if (s.target === 'globe') {
      const size = Math.min(innerWidth, innerHeight) * 0.56;
      ring.style.cssText = 'width:' + size + 'px;height:' + size + 'px;border-radius:50%;left:' +
        (innerWidth / 2 - size / 2) + 'px;top:' + (innerHeight / 2 - size / 2) + 'px;';
    } else {
      const pad = 8;
      ring.style.cssText = 'width:' + (r.width + pad * 2) + 'px;height:' + (r.height + pad * 2) +
        'px;border-radius:14px;left:' + (r.left - pad) + 'px;top:' + (r.top - pad) + 'px;';
    }

    card.querySelector('.tr-step').textContent = (idx + 1) + ' of ' + steps.length;
    card.querySelector('.tr-title').textContent = s.title;
    card.querySelector('.tr-body').textContent = s.body;
    card.querySelector('.tr-next').textContent = s.last ? 'Start listening' : 'Next';
    card.querySelector('.tr-skip').textContent = s.last ? 'I’ll explore myself' : 'Skip';

    // Position the card, then clamp it inside the viewport. Measured after the text is set so
    // the height is real — guessing it puts the card half off-screen on small phones.
    card.style.visibility = 'hidden';
    card.style.left = '0px'; card.style.top = '0px';
    requestAnimationFrame(function () {
      const c = card.getBoundingClientRect();
      const gap = 14;
      let left, top;
      if (s.target === 'globe') {
        left = innerWidth / 2 - c.width / 2;
        top = Math.min(innerHeight - c.height - 24, innerHeight * 0.62);
      } else if (s.place === 'top') {
        left = r.left + r.width / 2 - c.width / 2;
        top = r.top - c.height - gap;
      } else {
        left = r.left + r.width / 2 - c.width / 2;
        top = r.bottom + gap;
      }
      // Never let the card sit off-screen, and never let it cover the thing it points at.
      left = Math.max(12, Math.min(left, innerWidth - c.width - 12));
      if (top < 12) top = r.bottom + gap;
      if (top + c.height > innerHeight - 12) top = Math.max(12, r.top - c.height - gap);
      card.style.left = Math.round(left) + 'px';
      card.style.top = Math.round(top) + 'px';
      card.style.visibility = '';
    });

    if (s.pauseSpin && global.EventuallyTourHooks && global.EventuallyTourHooks.pauseSpin) {
      global.EventuallyTourHooks.pauseSpin();
    }
  }

  function next() {
    const s = steps[idx];
    if (s && s.last) return finish(true);       // "Start listening" → hand off to the Host
    idx++;
    if (idx >= steps.length) return finish(false);
    render();
  }

  function finish(startHost) {
    if (!active) return;
    active = false;
    markSeen();
    if (el && el.parentNode) el.parentNode.removeChild(el);
    el = null;
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    // THE POINT OF ENDING HERE: this call runs inside the click handler, so it still counts
    // as a user gesture and the browser will allow audio. Starting the Host any later — from
    // a timer, say — would be blocked.
    if (startHost && onFinish) { try { onFinish(); } catch (e) {} }
  }

  function onKey(e) {
    if (e.key === 'Escape') finish(false);
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); next(); }
  }
  function onResize() { if (active) render(); }

  function start(opts) {
    opts = opts || {};
    if (active) return false;
    onFinish = typeof opts.onFinish === 'function' ? opts.onFinish : null;
    steps = buildSteps();
    // Nothing to point at (very small viewport, or the shell hasn't rendered) → don't run.
    if (!steps.some(function (s) { return visible(targetEl(s.target)); })) return false;

    idx = 0; active = true;
    el = document.createElement('div');
    el.className = 'tour';
    el.innerHTML =
      '<div class="tr-scrim"></div>' +
      '<div class="tr-ring"></div>' +
      '<div class="tr-card" role="dialog" aria-modal="true" aria-label="Getting started">' +
        '<span class="tr-step"></span>' +
        '<strong class="tr-title"></strong>' +
        '<p class="tr-body"></p>' +
        '<div class="tr-actions">' +
          '<button class="tr-skip" type="button"></button>' +
          '<button class="tr-next" type="button"></button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);
    el.querySelector('.tr-next').addEventListener('click', next);
    el.querySelector('.tr-skip').addEventListener('click', function () { finish(false); });
    el.querySelector('.tr-scrim').addEventListener('click', function () { finish(false); });
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    render();
    return true;
  }

  global.EventuallyTour = {
    start: start,
    // First run only. The caller still decides WHEN (we start after the splash finishes).
    maybeStart: function (opts) { return seen() ? false : start(opts); },
    reset: function () { try { localStorage.removeItem(KEY); } catch (e) {} },
    seen: seen
  };
})(window);

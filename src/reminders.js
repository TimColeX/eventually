/* Eventually — local event reminders (frontend, no backend).
 *
 * Schedules browser notifications for SAVED events that are coming up, plus a
 * once-a-day "coming up" digest. This is the "local now" tier: timers fire while
 * the app is open (or a tab is alive), and an on-open digest catches the rest.
 * Reliable off-device delivery (app fully closed) needs Web Push (VAPID) — that's
 * the planned follow-up; this module is intentionally backend-free.
 *
 * Gated by the user's `comms.reminders` opt-in AND Notification permission.
 * Only reminds about events resolvable locally (loaded on the globe / merged via
 * search) — Web Push will cover the rest server-side later.
 */
(function (global) {
  'use strict';

  const KEY = 'eventually.reminders.fired.v1';
  let opts = null;
  let timers = [];

  function fired() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } }
  function markFired(k) {
    const f = fired(); f[k] = Date.now();
    for (const kk in f) { if (Date.now() - f[kk] > 2 * 86400000) delete f[kk]; }   // prune >2 days
    try { localStorage.setItem(KEY, JSON.stringify(f)); } catch (e) {}
  }
  function supported() { return 'Notification' in global; }
  function permitted() { return supported() && Notification.permission === 'granted'; }

  function notify(title, body) {
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready
          .then(function (reg) { reg.showNotification(title, { body: body, icon: 'assets/icon.svg', tag: title }); })
          .catch(function () { new Notification(title, { body: body, icon: 'assets/icon.svg' }); });
      } else { new Notification(title, { body: body, icon: 'assets/icon.svg' }); }
    } catch (e) {}
  }

  // Lead times before an event to remind at.
  const LEADS = [ { ms: 24 * 3600000, label: 'tomorrow' }, { ms: 60 * 60000, label: 'in an hour' }, { ms: 0, label: 'now' } ];
  const HORIZON = 26 * 3600000;   // only arm in-session timers for events within ~26h

  function clear() { timers.forEach(function (t) { clearTimeout(t); }); timers = []; }

  function schedule() {
    clear();
    if (!opts || !permitted() || !opts.commsOn()) return;
    const now = Date.now();
    const ids = (opts.savedIds() || []);
    const digest = [];
    ids.forEach(function (id) {
      const e = opts.getById(id);
      if (!e || !e.date) return;
      const start = e.date.getTime();
      if (start < now) return;

      LEADS.forEach(function (L) {
        const delay = (start - L.ms) - now;
        if (delay < -60000 || delay > HORIZON) return;   // near-term only while open
        const key = 'r:' + id + ':' + L.ms + ':' + Math.floor(start / 86400000);
        if (fired()[key]) return;
        timers.push(setTimeout(function () {
          markFired(key);
          const tail = e.city ? ' in ' + e.city : '';
          notify('Eventually reminder', L.ms ? (e.name + ' — ' + L.label + tail) : (e.name + ' is starting' + tail));
        }, Math.max(0, delay)));
      });

      if (start - now <= 24 * 3600000) digest.push(e);
    });

    // Once-a-day "coming up" digest for saved events in the next 24h.
    if (digest.length) {
      const dayKey = 'digest:' + Math.floor(now / 86400000);
      if (!fired()[dayKey]) {
        markFired(dayKey);
        const sorted = digest.slice().sort(function (a, b) { return a.date - b.date; });
        const first = sorted[0], more = sorted.length - 1;
        setTimeout(function () {
          notify('Your saved events', digest.length + ' saved event' + (digest.length > 1 ? 's' : '') +
            ' coming up — next: ' + first.name + (more > 0 ? ' (+' + more + ' more)' : ''));
        }, 4000);
      }
    }
  }

  global.EventuallyReminders = {
    supported: supported,
    permitted: permitted,
    configure: function (o) { opts = o; },
    sync: function () { try { schedule(); } catch (e) { console.warn('[reminders]', e); } },
    // Ask for Notification permission (must be called from a user gesture).
    requestPermission: function (cb) {
      if (!supported()) { if (cb) cb(false); return; }
      Notification.requestPermission().then(function (p) {
        const ok = p === 'granted'; if (ok) schedule(); if (cb) cb(ok);
      });
    }
  };
})(window);

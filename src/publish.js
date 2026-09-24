/* Eventually — the organiser's page (publish.html).
 *
 * WHY THIS FILE EXISTS
 *   Publishing used to happen in a modal stacked on top of the globe: the map kept
 *   spinning behind it, the host kept talking, and a form with fifteen fields lived
 *   inside an 85vh scroller. An organiser filling it in is doing work, not browsing, so
 *   it now has a page of its own — a URL they can bookmark, mail to a colleague, or come
 *   back to after a sign-in round trip.
 *
 *   The FORM ITSELF IS NOT DUPLICATED. This page mounts the same src/coordinator.js in
 *   `pageMode`, which only takes the modal chrome off it (see `.co-page` in main.css).
 *   Every field, the venue book, the mini-map, the picture box and the publish rules stay
 *   in one file, so a fix to the form is a fix in both places at once.
 *
 * WHAT IS DIFFERENT HERE
 *   • Anyone may look and fill it in; the sign-in wall stands at the publish button, not
 *     at the door. Someone who has never heard of us can read what the deal is, type
 *     their event, and only then be asked for an account.
 *   • What they type is kept in THIS BROWSER (localStorage) while they work, so a
 *     sign-in round trip, an accidental Back, or a phone call doesn't cost them the form.
 *     It never leaves the device and it is dropped the moment the event is published.
 *   • Their events, their allowance and their venue book are on the same page, because
 *     they are the same job.
 */
(function (global) {
  'use strict';

  const A = global.EventuallyAuth;
  const P = global.EventuallyProfile;
  const acctEnabled = function () { return !!(A && A.enabled); };

  /* ---------- toast (the app's, minus the app) ---------- */
  const toastEl = document.getElementById('toast');
  let toastT;
  global.EventuallyToast = function (msg, ms) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove('show'); }, ms || 2600);
  };
  const toast = global.EventuallyToast;

  /* ---------- page furniture ---------- */
  const el = {
    intro:   document.querySelector('.pg-intro'),
    tabs:    document.querySelector('.pg-tabs'),
    allow:   document.querySelector('.pg-allow'),
    signin:  document.querySelector('.pg-signin'),
    quota:   document.querySelector('.pg-quota'),
    acct:    document.querySelector('.pg-acct'),
    venues:  document.querySelector('.pg-venues'),
    myEvents: document.getElementById('myevents'),
    panels:  Array.prototype.slice.call(document.querySelectorAll('.pg-panel'))
  };
  let user = null;

  function showTab(name) {
    el.panels.forEach(function (p) { p.hidden = p.dataset.panel !== name; });
    document.querySelectorAll('.pg-tab').forEach(function (b) {
      const on = b.dataset.tab === name;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (name === 'venues') renderVenues();
    // The tab is in the URL so a reload, a share or a Back lands on the same one.
    try {
      const u = new URL(location.href);
      if (name === 'new') u.searchParams.delete('tab'); else u.searchParams.set('tab', name);
      history.replaceState(null, '', u);
    } catch (e) {}
  }
  if (el.tabs) {
    el.tabs.addEventListener('click', function (e) {
      const b = e.target.closest('.pg-tab'); if (!b) return;
      showTab(b.dataset.tab);
    });
  }

  /* ---------- drafts: this device only ---------- */
  /* Kept deliberately small and boring: the text of the form, the pin and the chosen time
     zone. NOT the picture — an image in localStorage is megabytes of quota for something
     the organiser can re-pick in two taps, and it is the one field that would push the
     store over its limit and silently lose the rest of the draft with it. */
  const DRAFT_KEY = 'eventually.publish.draft.v1';
  const DRAFT_FIELDS = ['.f-name', '.f-cat', '.f-venue', '.f-address', '.f-date', '.f-time',
                        '.f-endtime', '.f-tz', '.f-desc', '.f-url', '.f-capacity'];
  const draftBar = document.querySelector('.pg-draft');
  let draftT;

  function readDraft() {
    try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { return null; }
  }
  function clearDraft(quiet) {
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
    if (draftBar) draftBar.hidden = true;
    if (!quiet) toast('Draft cleared.');
  }
  function saveDraft() {
    if (!coordinator || coordinator.editId) return;      // editing a live event is not a draft
    const q = function (s) { const n = document.querySelector(s); return n ? n.value : ''; };
    const d = { at: Date.now(), fields: {}, pin: coordinator.pin, city: coordinator.city,
                chosen: !!coordinator.locationChosen, tz: coordinator.timezone || null };
    DRAFT_FIELDS.forEach(function (s) { d.fields[s] = q(s); });
    const reg = document.querySelector('input[name="co-reg"]:checked');
    d.reg = reg ? reg.value : 'link';
    d.feature = !!(document.querySelector('.f-feature') || {}).checked;
    // Nothing typed yet → nothing worth keeping (and nothing to restore noisily later).
    if (!d.fields['.f-name'] && !d.fields['.f-venue'] && !d.fields['.f-desc']) { clearDraft(true); return; }
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch (e) {}
  }
  function restoreDraft() {
    const d = readDraft();
    if (!d || !d.fields) return;
    DRAFT_FIELDS.forEach(function (s) {
      const n = document.querySelector(s);
      if (n && d.fields[s]) n.value = d.fields[s];
    });
    const reg = document.querySelector('.f-reg-' + (d.reg === 'eventually' ? 'eventually' : (d.reg === 'none' ? 'none' : 'link')));
    if (reg) { reg.checked = true; coordinator._syncRegMode(); }
    const feat = document.querySelector('.f-feature'); if (feat) feat.checked = !!d.feature;
    if (d.pin && d.pin.lat != null) {
      coordinator.pin = { lat: +d.pin.lat, lon: +d.pin.lon };
      coordinator.city = d.city || null;
      coordinator.locationChosen = !!d.chosen;
    }
    if (d.tz) { coordinator.timezone = d.tz; coordinator._tzTouched = true; coordinator._tzSure = true; coordinator._fillTzOptions(null); coordinator._syncTzNote(); }
    coordinator._drawMap();
    if (draftBar) {
      const when = new Date(d.at || Date.now());
      draftBar.querySelector('span').textContent =
        'Picked up where you left off — saved on this device ' +
        when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' at ' +
        when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) + '. The picture isn\'t saved.';
      draftBar.hidden = false;
    }
  }
  if (draftBar) draftBar.addEventListener('click', function (e) {
    if (!e.target.closest('.pg-draft-x')) return;
    clearDraft();
    if (coordinator) coordinator._resetForm();
  });

  /* ---------- the form (the app's coordinator, in page mode) ---------- */
  const coordinator = new global.EventuallyCoordinator(document.getElementById('coordinator'), {
    pageMode: true,
    onUploadImage: function (blob, eventId) {
      if (!acctEnabled() || !A.uploadEventImage) return Promise.resolve({ error: 'offline' });
      return A.uploadEventImage(blob, eventId);
    },
    getVenues: function () {
      if (!user || !A.myVenues) return Promise.resolve([]);
      return A.myVenues();
    },
    onSaveVenue: function (v) {
      if (!user || !A.rememberVenue) return Promise.resolve(null);
      return Promise.resolve(A.rememberVenue(v)).then(function (r) { renderVenues(); return r; });
    },
    getPublishHistory: function () {
      if (!user || !A.publishHistory) return Promise.resolve([]);
      return A.publishHistory();
    },
    /* THE SIGN-IN WALL. It stands here rather than at the door: someone can read the
       page, fill the form in and only then be asked for an account — and what they typed
       is already on their device, so the round trip costs them nothing. */
    onPublish: function (evt) {
      if (!user) {
        saveDraft();
        askToSignIn('Sign in to publish — what you\'ve typed is saved on this device.');
        return Promise.resolve({ ok: false });
      }
      return A.publishEvent(evt).then(function (r) {
        if (r && r.error) {
          const m = String((r.error && r.error.message) || '').match(/PUBLISH_LIMIT_REACHED\|(\d+)\|(-?\d+)\|([\d-]*)/);
          if (m) { showPublishLimit(+m[2], m[3]); return { ok: false }; }
          toast('Publish failed: ' + r.error.message, 5000);
          return { ok: false };
        }
        clearDraft(true);
        refreshQuota();
        if (evt.sponsored) settleFeature(evt);
        // Land them on the list, where the event is now sitting as "In review" — that is
        // the honest answer to "did it work?", rather than an empty form and a toast.
        setTimeout(function () { showTab('events'); renderMyEvents(); window.scrollTo(0, 0); }, 60);
        return { ok: true, live: false, message: 'Submitted for review — it goes live once we\'ve checked it.' };
      });
    },
    onUpdate: function (evt) {
      if (!user) { askToSignIn('Sign in to save your changes.'); return Promise.resolve({ ok: false }); }
      return A.updateEvent(evt).then(function (r) {
        if (r && r.error) { toast('Update failed: ' + r.error.message, 5000); return { ok: false }; }
        setTimeout(function () { showTab('events'); renderMyEvents(); window.scrollTo(0, 0); }, 60);
        return { ok: true, live: false, message: 'Changes saved — resubmitted for review.' };
      });
    },
    onDelete: function (id) {
      if (!user) return Promise.resolve(false);
      return A.deleteEvent(id).then(function (r) {
        if (r && r.error) { toast('Delete failed: ' + r.error.message, 5000); return false; }
        toast('Event deleted.');
        refreshQuota();
        return true;
      });
    },
    onSetPublished: function (id, on) {
      if (!user) return Promise.resolve(false);
      return A.setPublished(id, on).then(function () {
        toast(on ? 'Back on the globe.' : 'Taken off the globe.');
        return true;
      });
    },
    getQuota: function () { return user && A.publishingQuota ? A.publishingQuota() : Promise.resolve(null); },
    getCreatorStats: function () {
      if (!user) return Promise.resolve([]);
      return A.creatorStats();
    },
    // The map opens where the app thinks they are, exactly as the modal did.
    getDefaultLocation: function () {
      const l = P && P.get ? P.get().location : null;
      return (l && l.lat != null) ? { lat: l.lat, lon: l.lon, city: l.city } : null;
    },
    getMyEvents: function () { return []; }     // no local demo globe on this page
  });
  coordinator.open();                           // page mode: "open" just means rendered

  // Keep the draft current, cheaply: one delegated listener, debounced.
  document.getElementById('coordinator').addEventListener('input', function () {
    clearTimeout(draftT); draftT = setTimeout(saveDraft, 500);
  });
  document.getElementById('coordinator').addEventListener('change', function () {
    clearTimeout(draftT); draftT = setTimeout(saveDraft, 500);
  });
  restoreDraft();

  /* ---------- the allowance ---------- */
  function refreshQuota() {
    if (!el.allow) return;
    if (!user) { el.allow.hidden = true; if (el.quota) el.quota.hidden = true; return; }
    Promise.resolve(coordinator.getQuota()).then(function (q) {
      if (!q || q.error || q.enabled === false) { el.allow.hidden = true; if (el.quota) el.quota.hidden = true; return; }
      const nEl = el.allow.querySelector('.pg-allow-n');
      const sEl = el.allow.querySelector('.pg-allow-sub');
      const bar = el.allow.querySelector('.pg-allow-bar');
      if (q.unlimited) {
        nEl.textContent = 'No limit on your account';
        sEl.textContent = (q.used || 0) + ' published this year';
        bar.innerHTML = ''; bar.hidden = true;
        el.allow.classList.remove('is-full');
      } else {
        const used = +q.used || 0, cap = +q.capacity || 0, left = Math.max(0, cap - used);
        nEl.textContent = used + ' of ' + cap + ' events published this year';
        sEl.textContent = left === 0 ? 'None left this year' : (left === 1 ? '1 left' : left + ' left');
        bar.hidden = false;
        bar.innerHTML = '<i style="width:' + (cap ? Math.min(100, Math.round(used / cap * 100)) : 0) + '%"></i>';
        el.allow.setAttribute('aria-label', used + ' of ' + cap + ' events used this year');
        el.allow.classList.toggle('is-full', left === 0);
        if (el.quota) { el.quota.textContent = used + ' of ' + cap + ' used'; el.quota.hidden = false; }
      }
      el.allow.hidden = false;
    }, function () { el.allow.hidden = true; });
  }

  /* "Ask us to feature this event" was ticked. Featuring is free while we're in beta and
     granted by an admin, so with billing switched off this does nothing and the request
     simply rides along on the event (feature_requested). Once a store exists, a Plus
     member's monthly free placements are claimed first and anyone else is sent to a
     one-off checkout. Moved here with the form; it used to sit in app.js. */
  function settleFeature(evt) {
    const B = global.EventuallyBilling;
    if (!B || !B.enabled || !A.claimFreeFeature) return;
    A.claimFreeFeature(evt.id).then(function (res) {
      if (res && res.ok) {
        toast('Featured with Plus — ' + res.remaining + ' free left this month.', 4000);
      } else {
        toast('Opening checkout to feature this event…');
        B.startFeatureCheckout({ id: user.id, email: user.email }, evt.id);
      }
    }).catch(function () { toast('Could not start featuring — try again from My Events.', 4000); });
  }

  // The wall, when the server refuses. Same words as the app's, minus the globe's modal.
  function showPublishLimit(capacity, nextSlotISO) {
    let when = '';
    if (nextSlotISO) {
      const d = new Date(nextSlotISO + 'T00:00:00');
      if (!isNaN(d)) when = ' Your next slot opens on ' + d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) + '.';
    }
    if (acctEnabled() && A.logPublishBlock) A.logPublishBlock();
    toast('You\'ve used all ' + capacity + ' of your events for the year.' + when +
          ' Email info@eventually-app.com and we\'ll sort you out.', 9000);
    refreshQuota();
  }

  /* ---------- your events ---------- */
  function renderMyEvents() {
    if (!el.myEvents) return;
    coordinator.mountMyEvents(el.myEvents, function () {
      // "Edit" / "Duplicate" hand the event to the form — so go to the form.
      showTab('new');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ---------- your venues ---------- */
  /* The only place a saved venue can be renamed or removed. It exists because the venue
     book writes itself: publish once from "The Artesian" with a typo and that typo is a
     chip on the form forever. Removing one changes nothing about events already
     published from it — the address, pin and zone were copied onto the event. */
  function renderVenues() {
    if (!el.venues) return;
    if (!user) { el.venues.innerHTML = '<p class="pg-v-empty">Sign in to see the venues you\'ve saved.</p>'; return; }
    Promise.resolve(A.myVenues()).then(function (vs) {
      if (!vs || !vs.length) {
        el.venues.innerHTML = '<p class="pg-v-empty">Nothing saved yet. Publish an event and the venue you used is kept here — ' +
          'address, map pin and time zone — ready to reuse in one tap.</p>';
        return;
      }
      el.venues.innerHTML = vs.map(function (v) {
        const sub = [v.address || v.city, v.timezone].filter(Boolean);
        return '<div class="pg-venue" data-id="' + esc(v.id) + '">' +
          '<div class="pg-v-main">' +
            '<span class="pg-v-name">' + esc(v.name) + '</span>' +
            '<span class="pg-v-sub">' + esc(sub[0] || '—') +
              (v.timezone ? ' · <span class="pg-v-tz">' + esc(v.timezone) + '</span>' : '') +
              (v.used_count > 1 ? ' · used ' + (+v.used_count) + ' times' : '') +
            '</span>' +
          '</div>' +
          '<div class="pg-v-acts">' +
            '<button type="button" class="an-act" data-v-act="rename">Rename</button>' +
            '<button type="button" class="an-act an-danger" data-v-act="remove">Remove</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }, function () {
      el.venues.innerHTML = '<p class="pg-v-empty">Couldn\'t load your venues just now.</p>';
    });
  }
  if (el.venues) {
    el.venues.addEventListener('click', function (e) {
      const b = e.target.closest('[data-v-act]'); if (!b) return;
      const row = b.closest('.pg-venue'); if (!row) return;
      const id = row.dataset.id;
      const name = (row.querySelector('.pg-v-name') || {}).textContent || 'this venue';
      if (b.dataset.vAct === 'rename') {
        const next = prompt('What should this venue be called?', name);
        if (next == null || !next.trim() || next.trim() === name) return;
        A.renameVenue(id, next.trim()).then(function (r) {
          if (r && r.error) { toast('Couldn\'t rename that: ' + r.error.message, 5000); return; }
          toast('Renamed.'); renderVenues(); coordinator._loadVenues();
        });
      } else {
        if (!confirm('Remove "' + name + '" from your saved venues?\n\nEvents you have already published there are not affected.')) return;
        A.forgetVenue(id).then(function (r) {
          if (r && r.error) { toast('Couldn\'t remove that: ' + r.error.message, 5000); return; }
          toast('Removed.'); renderVenues(); coordinator._loadVenues();
        });
      }
    });
  }

  /* ---------- sign in ---------- */
  function askToSignIn(why) {
    if (!el.signin) return;
    el.signin.hidden = false;
    const note = el.signin.querySelector('.pg-auth-note');
    if (note && why) { note.textContent = why; note.classList.remove('is-bad'); }
    el.signin.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const mail = document.getElementById('pg-email');
    if (mail) setTimeout(function () { mail.focus({ preventScroll: true }); }, 400);
  }
  const gBtn = document.querySelector('.pg-google');
  if (gBtn) gBtn.addEventListener('click', function () {
    if (!acctEnabled()) { toast('Accounts are unavailable right now.'); return; }
    A.signInWithGoogle().then(function (r) {
      if (r && r.error) toast('Google sign-in failed: ' + r.error.message, 5000);
    });
  });
  const mailForm = document.querySelector('.pg-mail');
  if (mailForm) mailForm.addEventListener('submit', function (e) {
    e.preventDefault();
    const input = document.getElementById('pg-email');
    const btn = mailForm.querySelector('.pg-send');
    const note = el.signin.querySelector('.pg-auth-note');
    const email = (input.value || '').trim();
    if (!email) return;
    if (!acctEnabled()) { note.textContent = 'Accounts are unavailable right now.'; note.classList.add('is-bad'); return; }
    btn.disabled = true; btn.textContent = 'Sending…';
    A.signInWithEmail(email).then(function (r) {
      btn.disabled = false; btn.textContent = 'Email me a sign-in link';
      if (r && r.error) { note.textContent = 'Couldn\'t send that: ' + r.error.message; note.classList.add('is-bad'); return; }
      note.classList.remove('is-bad');
      note.textContent = 'Check ' + email + ' — the link brings you straight back to this page, with your event still here.';
    });
  });
  if (el.acct) el.acct.addEventListener('click', function () {
    if (!user) { askToSignIn(); return; }
    if (!confirm('Sign out of Eventually?')) return;
    A.signOut().then(function () { location.reload(); });
  });

  /* ---------- who is here ---------- */
  function render() {
    const inAcct = !!user;
    if (el.intro)  el.intro.hidden  = inAcct;      // the pitch is for people who need it
    if (el.tabs)   el.tabs.hidden   = !inAcct;
    if (el.signin) el.signin.hidden = inAcct;
    if (el.acct) {
      el.acct.hidden = !inAcct;
      el.acct.textContent = inAcct ? (user.email || 'Signed in') : '';
      el.acct.title = inAcct ? 'Sign out' : '';
    }
    if (!inAcct) {
      showTab('new');                              // the only thing worth showing
      if (el.quota) el.quota.hidden = true;
      if (el.allow) el.allow.hidden = true;
      return;
    }
    refreshQuota();
    renderMyEvents();
    coordinator._loadVenues();
    // Land on the tab the link asked for ("My Events" in the globe menu sends ?tab=events).
    let want = 'new';
    try { want = new URL(location.href).searchParams.get('tab') || 'new'; } catch (e) {}
    showTab(['new', 'events', 'venues'].indexOf(want) === -1 ? 'new' : want);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m];
    });
  }

  /* Who is here decides what the page shows, so it waits for the answer — but only
     briefly. Supabase resolving the session is a network call, and if it is slow, blocked
     or down, waiting forever leaves an organiser looking at a bare form with no sign-in
     button and no explanation. After a beat, show them the page a signed-out visitor
     gets; a later answer simply re-renders. */
  if (acctEnabled()) {
    let answered = false;
    A.onChange(function (u) { user = u; answered = true; render(); });
    setTimeout(function () { if (!answered) render(); }, 1200);
  } else {
    render();
  }
})(window);

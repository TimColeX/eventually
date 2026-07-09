/* Eventually — app orchestrator. Wires the globe, timeline, AI host, event card,
 * auth modal and coordinator portal together. Front-end demo (no backend). */
(function () {
  'use strict';

  const D = window.EventuallyData;
  const P = window.EventuallyProfile;
  const M = window.EventuallyMonetize;
  const A = window.EventuallyAuth;
  const authReal = !!(A && A.enabled);
  // With real auth on, signed-in state comes ONLY from a live Supabase session
  // (set in onChange) — never from cached localStorage. This avoids showing a
  // false "signed in / Plus" before (or without) a verified session.
  let user = (!authReal && P.get().name) ? { name: P.get().name, provider: 'saved' } : null;
  let selectedDate = D.TODAY;
  let interestFilterActive = false;     // Plus "advanced filtering"
  const activeTypes = {};               // "Event types" globe filter (all on by default)
  Object.keys(D.CATEGORIES).forEach(function (c) { activeTypes[c] = true; });
  // Runtime config — admin-tunable via the app_config table; these are the code
  // defaults used until (and if) the remote config loads.
  let RT = { spikes: { priority: 18, fair: 15, sponsored: 12 }, maxClusters: 0, adsEnabled: true, hostEnabled: true,
             hostLines: null, hostVoice: { rate: 0.98, pitch: 1.0 },
             pinned: [], hiddenCities: [], hiddenEvents: [], _hidEv: {}, _hidCity: {} };
  function applyHidden() {
    RT._hidEv = {}; (RT.hiddenEvents || []).forEach(function (id) { RT._hidEv[id] = 1; });
    RT._hidCity = {}; (RT.hiddenCities || []).forEach(function (c) { RT._hidCity[String(c).toLowerCase()] = 1; });
  }
  // "You are here" + nearby-events (within NEAR_KM of the user's chosen location).
  let userLoc = null;
  const NEAR_KM = 50;
  function haversineKm(a1, o1, a2, o2) {
    const R = 6371, d = Math.PI / 180, dLat = (a2 - a1) * d, dLon = (o2 - o1) * d;
    const s = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a1 * d) * Math.cos(a2 * d) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  // Render an admin template ("{event} in {city}") from a line's data dict.
  function renderTemplate(tmpl, data) {
    return String(tmpl).replace(/\{(\w+)\}/g, function (_, k) {
      const v = data ? data[k] : null;
      if (v == null) return '';
      return (typeof v === 'number') ? v.toLocaleString() : String(v);
    }).replace(/\s{2,}/g, ' ').trim();
  }

  // location-popup state (declared early: the timeline fires onChange during
  // construction, which calls rerenderPlace before the popup section runs)
  const place = document.getElementById('place');
  const placeList = place.querySelector('.place-list');
  let activeClusterId = null;
  let focusEventId = null;

  /* ---------- toast ---------- */
  const toastEl = document.getElementById('toast');
  let toastT;
  window.EventuallyToast = function (msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove('show'); }, 2600);
  };

  /* ---------- globe ---------- */
  const globe = new window.EventuallyGlobe(document.getElementById('globe'));
  globe.setClusters(D.getClusters());

  // Per location, derive for the selected date: counts, pulse (live/soon), an
  // aggregate popularity, colour, a priority score, continent, and zoom LOD. Then
  // pick the budgeted spike set. Designed to stay clean from 500 to 50,000 events.
  const WEEK_MS = 7 * 86400000;
  function continentOf(lat, lon) {
    if (lon >= -170 && lon < -30 && lat >= 7) return 'NA';
    if (lon >= -92 && lon < -30 && lat < 7) return 'SA';
    if (lon >= -25 && lon < 45 && lat >= 35) return 'EU';
    if (lon >= -20 && lon < 60 && lat < 35) return 'AF';
    if (lon >= 110 && lat < 0) return 'OC';
    return 'AS';
  }
  function refreshMarkers() {
    const interests = (interestFilterActive && P.get().plus) ? P.effectiveInterests(D.getById) : null;
    const selMs = selectedDate.getTime();
    D.getClusters().forEach(function (c) {
      let vis = 0, live = 0, soon = 0, maxPop = 0, col = null, bestPop = -1, featured = false, editor = false, likeSum = 0, nat = false;
      const ids = c.eventIds;
      for (let k = 0; k < ids.length; k++) {
        const ev = D.getById(ids[k]);
        if (RT._hidEv[ev.id] || RT._hidCity[(ev.city || '').toLowerCase()]) continue;   // admin-hidden
        if (!activeTypes[ev.category]) continue;
        if (interests && interests.length && interests.indexOf(ev.category) < 0) continue;
        const t = D.typeForDate(ev, selectedDate);
        if (t === 'past') continue;
        vis++;
        if (t === 'live') live++;
        else if (ev.date.getTime() - selMs <= WEEK_MS) soon++;   // starts within 7 days
        if (ev.sponsored) featured = true;
        if (ev.editor) editor = true;
        if (ev.is_native) nat = true;        // Eventually-published (native) event here
        const p = D.popularity(ev);
        if (p > maxPop) maxPop = p;
        if (p > bestPop) { bestPop = p; col = ev.categoryColor; }
        likeSum += ev.likes;
      }
      c._visible = vis;
      c._hasLive = live > 0;
      c._pulse = (live > 0) || (soon > 0);                       // pulse if live now OR soon
      c._pop = Math.min(1, maxPop + 0.035 * Math.min(10, vis));
      c._color = col || '#CB5A3C';
      c._featured = featured; c._editor = editor;
      c._score = live * 3 + maxPop * 4 + (soon > 0 ? 1.5 : 0) + (featured ? 6 : 0) +
        (editor ? 4 : 0) + Math.min(4, vis * 0.05) + Math.min(3, likeSum / 3000);
      c._hasNative = nat;
      c._eligible = featured || editor || live > 0 || vis >= 10;
      // Native (Eventually-published) clusters always show their dot, at any zoom.
      c._lodMin = nat ? 0 : ((c._visible >= 14) ? 0.95 : (c._visible >= 5 ? 1.4 : 2.0));
      // Events near the user's location are always revealed.
      c._near = !!(userLoc && vis > 0 && haversineKm(userLoc.lat, userLoc.lon, c.lat, c.lon) <= NEAR_KM);
      if (c._near) c._lodMin = 0;
      if (!c._continent) c._continent = continentOf(c.lat, c.lon);
    });
    selectSpikes();
  }

  // Global spike budget: 18 top-priority + 15 continent-fair + 12 sponsored
  // (max 3 sponsored / continent, rotating). Everything else stays a dot.
  let spikeRotation = 0;
  function selectSpikes() {
    const all = D.getClusters();
    all.forEach(function (c) { c._spike = false; c._spikeKind = null; });
    const pool = all.filter(function (c) { return c._visible > 0 && c._eligible; })
      .sort(function (a, b) { return b._score - a._score; });
    const chosen = {};
    const mark = function (c, kind) { chosen[c.id] = true; c._spike = true; c._spikeKind = kind; c._lodMin = 0; };

    // sponsored — rotate so we never show more than 3 per continent / 12 total
    const spon = {};
    pool.forEach(function (c) { if (c._featured) (spon[c._continent] = spon[c._continent] || []).push(c); });
    let s = 0;
    Object.keys(spon).forEach(function (cont) {
      const list = spon[cont], start = list.length > 3 ? (spikeRotation % list.length) : 0;
      for (let k = 0; k < Math.min(3, list.length) && s < RT.spikes.sponsored; k++) {
        const c = list[(start + k) % list.length];
        if (!chosen[c.id]) { mark(c, 'sponsored'); s++; }
      }
    });
    // global top priority
    let g = 0;
    for (let i = 0; i < pool.length && g < RT.spikes.priority; i++) if (!chosen[pool[i].id]) { mark(pool[i], 'priority'); g++; }
    // continent fairness — round-robin so every continent is represented
    const conts = ['NA', 'SA', 'EU', 'AF', 'AS', 'OC'];
    let f = 0, progress = true;
    while (f < RT.spikes.fair && progress) {
      progress = false;
      for (let ci = 0; ci < conts.length && f < RT.spikes.fair; ci++) {
        const cont = conts[ci];
        const c = pool.find(function (x) { return x._continent === cont && !chosen[x.id]; });
        if (c) { mark(c, 'fair'); f++; progress = true; }
      }
    }
    // Admin-pinned cities ALWAYS spike, with their chosen type.
    (RT.pinned || []).forEach(function (pin) {
      if (!pin || !pin.city) return;
      const key = String(pin.city).toLowerCase();
      const c = all.find(function (x) { return x._visible > 0 && x.city && x.city.toLowerCase() === key; });
      if (!c) return;
      c._spike = true; c._lodMin = 0;
      c._spikeKind = pin.type === 'sponsored' ? 'sponsored' : 'priority';
      if (pin.type === 'sponsored') c._featured = true;
      if (pin.type === 'editor') c._editor = true;
    });
  }
  function highestPriorityCluster() {
    let best = null, bs = -1;
    D.getClusters().forEach(function (c) { if (c._visible > 0 && c._score > bs) { bs = c._score; best = c; } });
    return best;
  }
  refreshMarkers();
  setInterval(function () { spikeRotation++; selectSpikes(); }, 35000);  // rotate ~ every spike cycle

  globe.onMarkerClick = function (id) { openPlace(id); };
  globe.onMarkerHover = function (id) {
    const tip = document.getElementById('hovertip');
    tip.style.opacity = id ? 1 : 0;
    if (id) {
      const c = clusterById(id);
      const n = c._visible;
      tip.textContent = c.city + ' · ' + n + ' event' + (n === 1 ? '' : 's');
    }
  };
  function clusterById(id) { return D.getClusters().find(function (c) { return c.id === id; }); }

  /* ---------- "Types" dropdown (right end of the search bar) ---------- */
  const typesBtn = document.getElementById('types-btn');
  const typesMenu = document.getElementById('types-menu');
  function renderTypesMenu() {
    const cats = Object.keys(D.CATEGORIES);
    const allOn = cats.every(function (c) { return activeTypes[c]; });
    let h = '<button class="topt topt-all' + (allOn ? ' on' : '') + '" data-type="__all">All event types</button>';
    h += cats.map(function (c) {
      return '<button class="topt' + (activeTypes[c] ? ' on' : '') + '" data-type="' + c + '">' +
        '<span class="tdot" style="background:' + D.CATEGORIES[c] + '"></span>' + c +
        '<span class="tcheck">' + (activeTypes[c] ? '✓' : '') + '</span></button>';
    }).join('');
    typesMenu.innerHTML = h;
    const sel = cats.filter(function (c) { return activeTypes[c]; }).length;
    const badge = typesBtn.querySelector('.types-badge');
    if (allOn) { badge.style.display = 'none'; typesBtn.classList.remove('active'); }
    else { badge.style.display = ''; badge.textContent = sel; typesBtn.classList.add('active'); }
  }
  typesBtn.addEventListener('click', function (e) {
    e.stopPropagation(); renderTypesMenu(); typesMenu.classList.toggle('show');
  });
  typesMenu.addEventListener('click', function (e) {
    const b = e.target.closest('[data-type]'); if (!b) return;
    const cats = Object.keys(D.CATEGORIES);
    if (b.dataset.type === '__all') { cats.forEach(function (c) { activeTypes[c] = true; }); }
    else {
      const c = b.dataset.type;
      if (cats.every(function (x) { return activeTypes[x]; })) cats.forEach(function (x) { activeTypes[x] = (x === c); });
      else { activeTypes[c] = !activeTypes[c]; if (cats.every(function (x) { return !activeTypes[x]; })) cats.forEach(function (x) { activeTypes[x] = true; }); }
    }
    renderTypesMenu(); refreshMarkers(); rerenderPlace();
  });
  document.addEventListener('click', function (e) { if (!e.target.closest('.types-wrap')) typesMenu.classList.remove('show'); });
  renderTypesMenu();

  let _raf;
  function loop() { globe.render(); _raf = requestAnimationFrame(loop); }
  _raf = requestAnimationFrame(loop);
  // debug hooks (let a screenshot tool capture a still frame)
  window.__eventually = {
    globe: globe,
    freeze: function () { cancelAnimationFrame(_raf); globe.render(); },
    resume: function () { _raf = requestAnimationFrame(loop); },
    // AI-Host hook (architecture only, not wired): the current top cluster + pan-to.
    highestPriorityCluster: function () { return highestPriorityCluster(); },
    flyToTopCluster: function () { const c = highestPriorityCluster(); if (c) globe.flyTo(c.lat, c.lon); return c; }
  };

  /* ---------- globe controls (pause spin / zoom) ---------- */
  const spinBtn = document.getElementById('ctl-spin');
  spinBtn.addEventListener('click', function () {
    const paused = globe.togglePaused();
    spinBtn.querySelector('.ic-pause').style.display = paused ? 'none' : '';
    spinBtn.querySelector('.ic-play').style.display = paused ? '' : 'none';
    spinBtn.classList.toggle('active', paused);
    spinBtn.setAttribute('aria-label', paused ? 'Resume spin' : 'Pause spin');
    window.EventuallyToast(paused ? 'Spin paused — tap any marker.' : 'Spin resumed.');
  });
  document.getElementById('ctl-zoom-in').addEventListener('click', function () { globe.zoomBy(1.25); });
  document.getElementById('ctl-zoom-out').addEventListener('click', function () { globe.zoomBy(0.8); });

  /* ---------- timeline ---------- */
  const timeline = new window.EventuallyTimeline(document.getElementById('timeline'), {
    today: D.TODAY,
    onChange: function (date) { selectedDate = date; refreshMarkers(); updateStats(); rerenderPlace(); },
    getDensity: function (off) {
      return D.getEvents().filter(function (e) { return e.dayOffset === off; }).length;
    }
  });

  /* ---------- AI host ("eventually" Host) ---------- */
  // Captions rotate continuously; pressing play speaks them. The narrator pulls
  // from live events + the user's profile, with rate-limited sponsor reads.
  const narrator = window.EventuallyNarrator.create({
    data: D, profile: P, monetize: M,
    selectedDate: function () { return selectedDate; }
  });
  const music = new window.EventuallyMusic();   // duckable bed, swaps to a real file if provided
  const I18n = window.EventuallyI18n;
  new window.EventuallyAIHost(document.getElementById('ai-host'), {
    getLine: function () {                       // localize the structured line to the user's language
      let line = narrator.next();
      // Skip admin-disabled line types (cap attempts to avoid loops).
      let guard = 0;
      while (RT.hostLines && RT.hostLines[line.kind] && RT.hostLines[line.kind].on === false && guard++ < 8) {
        line = narrator.next();
      }
      const lang = P.get().language || 'en';
      const ov = RT.hostLines && RT.hostLines[line.kind];
      let text;
      // English admin override (skip the greeting's no-recs form — it lacks the data).
      if (lang === 'en' && ov && ov.text && !(line.kind === 'greeting' && line.data && !line.data.hasRecs)) {
        text = renderTemplate(ov.text, line.data || {});
      } else {
        text = I18n.format(line, lang);
      }
      return { text: text, kind: line.kind, sponsor: line.sponsor, lang: I18n.bcp(lang), rtl: I18n.isRTL(lang) };
    },
    onPlay: function () { music.start(); narrator.reset(); },   // bed on + lead with the user's area
    onPause: function () { music.stop(); },
    onSpeakStart: function () { music.duck(true); },   // duck under the voice
    onSpeakEnd: function () { music.duck(false); },    // swell between segments
    // Cost-optimized "radio" model: a SHARED, cached ElevenLabs briefing per city
    // (Plus only). null → the host uses the free browser-voice rotation.
    getBriefing: function () {
      if (!window.EventuallyHostVoice || !window.EventuallyHostVoice.enabled) return Promise.resolve(null);
      if (!P.get().plus) return Promise.resolve(null);
      const loc = P.get().location;
      const city = (loc && loc.city) ? loc.city : null;   // null → worldwide briefing
      return window.EventuallyHostVoice.getBriefing(city, P.get().language || 'en');
    },
    // Personalized opener spoken in the FREE browser voice (no ElevenLabs cost).
    getOpener: function () {
      if (!P.get().plus) return null;
      const p = P.get();
      const h = new Date().getHours();
      const part = h < 12 ? 'morning' : (h < 18 ? 'afternoon' : 'evening');
      return { text: 'Good ' + part + (p.name ? ', ' + p.name : '') + ". Here's your Eventually briefing.",
               lang: 'en-US', rtl: false };
    },
    // Admin-tunable delivery for the free browser voice (rate/pitch).
    getVoiceSettings: function () { return RT.hostVoice || {}; },
    // Free "Today's briefing" (device voice): prefer the LLM-authored server
    // script (local-first, worldwide fallback); if unavailable, build one locally
    // from the loaded events so the feature always works.
    getDailyBriefing: function () {
      const loc = P.get().location;
      const city = (loc && loc.city) ? loc.city : null;
      const lang = P.get().language || 'en';
      const localDay = new Date();
      const day = localDay.getFullYear() + '-' +
        String(localDay.getMonth() + 1).padStart(2, '0') + '-' +
        String(localDay.getDate()).padStart(2, '0');
      const fallback = function () { return { text: buildProceduralBriefing(city), lang: I18n.bcp(lang), rtl: I18n.isRTL(lang) }; };
      if (!window.EventuallyAPI || !window.EventuallyAPI.config.remote || !window.EventuallyAPI.dailyBriefing) {
        return Promise.resolve(fallback());
      }
      return window.EventuallyAPI.dailyBriefing({ city: city, lat: loc && loc.lat, lon: loc && loc.lon, lang: lang, day: day })
        .then(function (b) { return (b && b.text) ? { text: b.text, lang: 'en-US' } : fallback(); })
        .catch(fallback);
    }
  });

  // Compile a short spoken daily briefing locally from the loaded events — the
  // free fallback when the LLM briefing isn't available. Local-first (events in
  // the user's city), else worldwide top by popularity.
  function buildProceduralBriefing(city) {
    const h = new Date().getHours();
    const part = h < 12 ? 'morning' : (h < 18 ? 'afternoon' : 'evening');
    const all = D.getEvents().filter(function (e) {
      const t = D.typeForDate(e, selectedDate); return t === 'live' || t === 'upcoming';
    });
    let pool = all;
    if (city) {
      const local = all.filter(function (e) { return e.city && e.city.toLowerCase() === city.toLowerCase(); });
      if (local.length >= 2) pool = local;
    }
    pool = pool.slice().sort(function (a, b) { return D.popularity(b) - D.popularity(a); });
    const place = (pool === all || !city) ? 'around the world' : city;
    const name = P.get().name;
    if (!pool.length) {
      return 'Good ' + part + (name ? ', ' + name : '') + '. It\'s quiet on the globe right now — spin it to explore what\'s coming up near you.';
    }
    const top = pool.slice(0, 4);
    const localCount = (pool !== all) ? pool.length : 0;
    let s = 'Good ' + part + (name ? ', ' + name : '') + '. Here\'s your Eventually briefing for ' + place + '. ';
    s += localCount ? ('There are ' + localCount + ' events coming up near you. ')
                    : 'There\'s plenty happening around the world. ';
    s += 'Top of the list: ' + top[0].name + ' in ' + top[0].city + '. ';
    if (top[1]) s += 'Also worth a look, ' + top[1].name + (top[1].city ? ' in ' + top[1].city : '') + '. ';
    if (top[2]) s += 'And keep an eye on ' + top[2].name + '. ';
    s += 'Spin the globe to explore more.';
    return s.replace(/\s{2,}/g, ' ').trim();
  }

  // Local event reminders (frontend). Reminds about SAVED events that are coming
  // up, gated by the comms.reminders opt-in + Notification permission.
  const Reminders = window.EventuallyReminders;
  if (Reminders) {
    Reminders.configure({
      getById: function (id) { return D.getById(id); },
      savedIds: function () { return P.get().saved || []; },
      commsOn: function () { const c = P.get().comms; return !!(c && c.reminders); }
    });
  }
  function syncReminders() { if (Reminders) Reminders.sync(); }

  /* ---------- coordinator portal ---------- */
  function addPublishedLocally(evt) {
    D.addEvent(evt);                 // re-clusters internally
    globe.setClusters(D.getClusters());
    refreshMarkers();
    updateStats();
    timeline._drawSpark();
  }
  // Re-fetch live events from the backend and repaint (after edit/unpublish/delete).
  function refreshLiveEvents() {
    if (!(window.EventuallyAPI && window.EventuallyAPI.config.remote)) return Promise.resolve();
    return window.EventuallyAPI.fetchEvents({}).then(function (evs) {
      if (evs) { D.replaceAll(evs); markMine(); globe.setClusters(D.getClusters()); refreshMarkers(); updateStats(); rerenderPlace(); if (timeline && timeline._drawSpark) timeline._drawSpark(); }
    }).catch(function () {});
  }
  const coordinator = new window.EventuallyCoordinator(document.getElementById('coordinator'), {
    // Returns a Promise<boolean>: true = published. When signed in we write the
    // native event to Supabase (attributed to the user); otherwise demo/local only.
    onPublish: function (evt) {
      if (acctEnabled()) {
        return A.publishEvent(evt).then(function (r) {
          if (r && r.error) { window.EventuallyToast('Publish failed: ' + r.error.message); return { ok: false }; }
          if (evt.sponsored && billingEnabled()) handleFeature(evt);   // settle free/paid featuring
          // Native events are PENDING admin review — don't show on the globe yet.
          return { ok: true, live: false, message: 'Submitted for review — it goes live once an admin approves it.' };
        });
      }
      evt._mine = true; addPublishedLocally(evt);
      return Promise.resolve({ ok: true, live: true, message: 'Published! Live on the globe.' });
    },
    onUpdate: function (evt) {
      if (!acctEnabled()) return Promise.resolve({ ok: false });
      return A.updateEvent(evt).then(function (r) {
        if (r && r.error) { window.EventuallyToast('Update failed: ' + r.error.message); return { ok: false }; }
        // Edits send the event back to pending review → refresh (it drops off the globe until re-approved).
        return refreshLiveEvents().then(function () { return { ok: true, live: false, message: 'Changes saved — resubmitted for review.' }; });
      });
    },
    onDelete: function (id) {
      if (!acctEnabled()) return Promise.resolve(false);
      return A.deleteEvent(id).then(function (r) {
        if (r && r.error) { window.EventuallyToast('Delete failed: ' + r.error.message); return false; }
        window.EventuallyToast('Event deleted.');
        return refreshLiveEvents().then(function () { return true; });
      });
    },
    onSetPublished: function (id, on) {
      if (!acctEnabled()) return Promise.resolve(false);
      return A.setPublished(id, on).then(function () {
        window.EventuallyToast(on ? 'Event published.' : 'Event unpublished (hidden from the globe).');
        return refreshLiveEvents().then(function () { return true; });
      });
    },
    getCreatorStats: function () {
      if (!acctEnabled()) return Promise.resolve([]);
      return A.creatorStats();
    },
    // Start the publish map on the user's set location (from the home tab).
    getDefaultLocation: function () {
      const l = P.get().location;
      return (l && l.lat != null) ? { lat: l.lat, lon: l.lon, city: l.city } : null;
    },
    onFlyTo: function (lat, lon) { coordinator.close(); globe.flyTo(lat, lon); },
    getMyEvents: function () {
      return D.getEvents().filter(function (e) { return e._mine; });
    }
  });
  // (Coordinator / Profile / Sign-in are opened from the ⋯ menu, wired below.)

  /* ---------- auth ---------- */
  const authEl = document.getElementById('auth');
  function requireLogin(action) {
    if (user) { action(); return; }
    pendingAction = action;
    openAuth();
  }
  let pendingAction = null;

  function openAuth() { authEl.classList.add('open'); }
  function closeAuth() { authEl.classList.remove('open'); }

  authEl.querySelector('.auth-close').addEventListener('click', closeAuth);
  authEl.querySelector('.auth-backdrop').addEventListener('click', closeAuth);
  // (A / authReal are declared at the top of the IIFE.)
  authEl.querySelectorAll('[data-sso]').forEach(function (b) {
    b.addEventListener('click', function () {
      const provider = b.dataset.sso;
      if (authReal) {
        if (provider === 'google') {
          A.signInWithGoogle().then(function (r) { if (r && r.error) window.EventuallyToast('Google sign-in failed: ' + r.error.message); });
        } else { window.EventuallyToast('Use the email magic link below.'); }
        return;
      }
      finishLogin('You', provider);   // mock fallback (no backend configured)
    });
  });
  const magicForm = authEl.querySelector('.magic');
  magicForm.addEventListener('submit', function (e) {
    e.preventDefault();
    const v = magicForm.querySelector('input').value.trim();
    if (!v) return;
    if (authReal) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { window.EventuallyToast('Enter a valid email for the magic link.'); return; }
      A.signInWithEmail(v).then(function (r) {
        if (r && r.error) window.EventuallyToast('Could not send link: ' + r.error.message);
        else window.EventuallyToast('Magic link sent to ' + v + ' — check your email.');
      });
      return;
    }
    window.EventuallyToast('Magic link sent to ' + v + ' (demo: logging you in).');
    finishLogin(v.split('@')[0] || 'You', /@/.test(v) ? 'email' : 'phone');
  });

  function finishLogin(name, provider) {
    user = { name: name, provider: provider };
    P.setName(name);
    closeAuth();
    renderMenuTrigger();
    window.EventuallyToast('Signed in via ' + provider + ' — the globe is yours.');
    if (pendingAction) { const a = pendingAction; pendingAction = null; a(); }
  }
  function logout() {
    if (authReal) { A.signOut(); return; }   // onChange(null) clears state + UI
    user = null; P.setName(null); renderMenuTrigger(); window.EventuallyToast('Signed out.');
  }

  // The nav trigger (avatar / ⋯) and its dropdown are wired in the menu section below.

  /* ---------- location popup (scrollable list of events at one place) ---------- */
  function esc(s) { return String(s).replace(/[&<>"]/g, function (m) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m]; }); }

  // Events at a location that match the current timeline date (live or upcoming),
  // live first, then soonest.
  function visibleEvents(cluster) {
    return cluster.eventIds.map(D.getById)
      .filter(function (e) { return D.typeForDate(e, selectedDate) !== 'past'; })
      .sort(function (a, b) {
        if (!!b.sponsored !== !!a.sponsored) return b.sponsored ? 1 : -1;  // featured first
        const ta = D.typeForDate(a, selectedDate) === 'live' ? 0 : 1;
        const tb = D.typeForDate(b, selectedDate) === 'live' ? 0 : 1;
        return ta - tb || a.date - b.date;
      });
  }

  function eventCardHTML(ev) {
    const type = D.typeForDate(ev, selectedDate);
    const dateLabel = ev.date.toLocaleDateString(undefined,
      { weekday: 'short', month: 'short', day: 'numeric' });
    const badge = type === 'live'
      ? '<span class="badge live">● Live today</span>'
      : '<span class="badge soon">Upcoming</span>';
    const featured = ev.sponsored ? '<span class="badge featured">★ Featured</span>' : '';
    const srcs = ev.sourceCount > 1
      ? '<span class="ev-srcs">◇ Found on ' + ev.sourceCount + ' sources</span>'
      : (ev.is_native ? '<span class="ev-srcs native">On Eventually</span>' : '');
    return '' +
      '<button class="ev' + (ev.sponsored ? ' is-featured' : '') + '" data-open="' + ev.id + '">' +
        '<div class="ev-banner" style="background:' + ev.categoryColor + '"></div>' +
        '<div class="ev-main">' +
          '<div class="ev-top">' +
            '<span class="ev-cat" style="color:' + ev.categoryColor + '">' + esc(ev.category) + '</span>' +
            featured + badge +
          '</div>' +
          '<h4 class="ev-title">' + esc(ev.name) + '</h4>' +
          '<p class="ev-date">' + dateLabel + '  ·  ' + esc(ev.city) + '</p>' +
          '<p class="ev-desc">' + esc(ev.description) + '</p>' +
          '<div class="ev-foot">' + srcs + '<span class="ev-view">View ›</span></div>' +
        '</div>' +
      '</button>';
  }

  // Revenue 4 — a location-based partner suggestion shown in the popup (non-Plus).
  function partnerCardHTML(cluster) {
    if (P.get().plus) return '';
    const pn = M.partnerFor(cluster.lat * 100 + cluster.lon);
    return '<div class="partner"><span class="partner-tag">Partner</span>' +
      '<div class="partner-body"><strong>' + esc(pn.name) + '</strong>' +
      '<span>' + esc(pn.pitch) + ' Our featured ' + pn.type.toLowerCase() +
      ' partner is near ' + esc(cluster.city) + '.</span></div></div>';
  }

  // in-card filter + sort state
  let placeCat = 'all', placeSort = 'soon', placeExpanded = false;
  const PLACE_TOP = 8;            // show the top few, then "See all"
  function eventCheapest(ev) {
    let m = Infinity; (ev.sources || []).forEach(function (s) { if (s.price != null && s.price < m) m = s.price; });
    return m === Infinity ? null : m;
  }
  function sortEvents(list, mode) {
    return list.slice().sort(function (a, b) {
      if (mode === 'popular') return D.popularity(b) - D.popularity(a);
      if (mode === 'cheap') { const pa = eventCheapest(a), pb = eventCheapest(b); return (pa == null ? 1e9 : pa) - (pb == null ? 1e9 : pb); }
      if (!!b.sponsored !== !!a.sponsored) return b.sponsored ? 1 : -1;     // soonest (+ featured/live first)
      const ta = D.typeForDate(a, selectedDate) === 'live' ? 0 : 1, tb = D.typeForDate(b, selectedDate) === 'live' ? 0 : 1;
      return ta - tb || a.date - b.date;
    });
  }
  function buildPlaceTools(c) {
    const cats = {}; visibleEvents(c).forEach(function (e) { cats[e.category] = true; });
    let filter = '<select class="pfilter" aria-label="Filter by type"><option value="all"' +
      (placeCat === 'all' ? ' selected' : '') + '>All types</option>';
    filter += Object.keys(cats).map(function (cat) {
      return '<option value="' + cat + '"' + (placeCat === cat ? ' selected' : '') + '>' + cat + '</option>';
    }).join('') + '</select>';
    const sort = '<select class="psort" aria-label="Sort events">' +
      '<option value="soon"' + (placeSort === 'soon' ? ' selected' : '') + '>Soonest</option>' +
      '<option value="popular"' + (placeSort === 'popular' ? ' selected' : '') + '>Popular</option>' +
      '<option value="cheap"' + (placeSort === 'cheap' ? ' selected' : '') + '>Cheapest</option></select>';
    place.querySelector('.place-tools').innerHTML = filter + sort;
  }
  function renderPlaceList() {
    const c = clusterById(activeClusterId); if (!c) return;
    let list = visibleEvents(c);
    if (placeCat !== 'all') list = list.filter(function (e) { return e.category === placeCat; });
    list = sortEvents(list, placeSort);
    let shown = list, more = '';
    if (!placeExpanded && list.length > PLACE_TOP) {
      shown = list.slice(0, PLACE_TOP);
      more = '<button class="see-all" data-seeall="1">See all ' + list.length + ' events ↓</button>';
    }
    placeList.innerHTML = shown.map(eventCardHTML).join('') + more + partnerCardHTML(c);
    if (focusEventId) {
      const el = placeList.querySelector('.ev[data-id="' + focusEventId + '"]');
      if (el) { el.classList.add('focus'); el.scrollIntoView({ block: 'center' }); }
      focusEventId = null;
    }
  }
  function openPlace(clusterId, focusId) {
    const c = clusterById(clusterId);
    if (!c) return;
    activeClusterId = clusterId; focusEventId = focusId || null;
    placeCat = 'all'; placeSort = 'soon'; placeExpanded = !!focusId;   // expand if jumping to a specific event
    const all = visibleEvents(c), n = all.length;
    place.querySelector('.place-city').textContent = c.city;
    place.querySelector('.place-count').textContent =
      n + ' event' + (n === 1 ? '' : 's') + ' · ' +
      selectedDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' onward';
    buildPlaceTools(c);
    renderPlaceList();
    place.classList.add('open');
    all.forEach(function (e) { e.clicks++; });
  }
  function rerenderPlace() {
    if (activeClusterId && place.classList.contains('open')) { buildPlaceTools(clusterById(activeClusterId)); renderPlaceList(); }
  }
  place.querySelector('.place-tools').addEventListener('change', function (e) {
    if (e.target.classList.contains('pfilter')) { placeCat = e.target.value; placeExpanded = false; renderPlaceList(); }
    else if (e.target.classList.contains('psort')) { placeSort = e.target.value; placeExpanded = false; renderPlaceList(); }
  });

  place.querySelector('.place-close').addEventListener('click', function () {
    place.classList.remove('open'); activeClusterId = null;
  });

  // Tap a compact card → open the full event detail; "See all" expands the list.
  placeList.addEventListener('click', function (e) {
    if (e.target.closest('[data-seeall]')) { placeExpanded = true; renderPlaceList(); return; }
    const card = e.target.closest('[data-open]');
    if (card) openEvent(card.dataset.open);
  });

  /* ---------- full event detail (dedup view: title, desc, "Available on") ---------- */
  const eventEl = document.getElementById('event');
  const eventScroll = eventEl.querySelector('.evd-scroll');
  let activeEventId = null;

  function sourceRowHTML(ev, s) {
    const cheapest = s.source_id === ev.cheapestId;
    const badge = s.badge ? '<span class="avail-badge">' + esc(s.badge) + '</span>' : '';
    return '<button class="avail-row' + (cheapest ? ' cheapest' : '') + '" data-src="' + s.source_id + '">' +
      '<span class="avail-left"><strong>' + esc(s.sourceLabel) + '</strong>' + badge + '</span>' +
      '<span class="avail-right">' + (cheapest ? '<span class="avail-tag">Cheapest</span>' : '') +
      '<span class="avail-price">' + esc(s.priceLabel) + '</span><span class="avail-go">↗</span></span></button>';
  }

  function openEvent(id) {
    const ev = D.getById(id); if (!ev) return;
    activeEventId = id; ev.clicks++;
    const type = D.typeForDate(ev, selectedDate);
    const dateLabel = ev.date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    const timeLabel = ev.date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const badge = type === 'live' ? '<span class="badge live">● Live today</span>'
      : (type === 'past' ? '<span class="badge past">Past</span>' : '<span class="badge soon">Upcoming</span>');
    const featured = ev.sponsored ? '<span class="badge featured">★ Featured</span>' : '';
    const transparency = ev.sourceCount > 1
      ? '<div class="evd-dedup">◇ Found on ' + ev.sourceCount + ' sources · best match ' + Math.round(ev.topScore * 100) + '%' +
        '<small>Listings grouped automatically — every original source is preserved.</small></div>' : '';
    let avail;
    if (ev.is_native) {
      avail = '<div class="evd-section"><div class="evd-sec-h">Hosted on Eventually</div>' +
        '<button class="native-cta" data-register="' + ev.id + '">Register on this platform</button>' +
        '<p class="evd-note">Hosted natively on Eventually — no external ticketing needed.</p></div>';
    } else {
      avail = '<div class="evd-section"><div class="evd-sec-h">Available on</div>' +
        '<div class="avail-list">' + ev.sources.map(function (s) { return sourceRowHTML(ev, s); }).join('') + '</div>' +
        '<p class="evd-note">Prices and links come straight from each source — pick where you buy.</p></div>';
    }
    eventScroll.innerHTML =
      '<div class="evd-banner" style="background:linear-gradient(135deg,' + ev.categoryColor + ',#211A15)">' +
        '<button class="evd-back" aria-label="Back">‹ Back</button>' +
        '<button class="evd-x" aria-label="Close">✕</button>' +
        '<span class="evd-cat">' + esc(ev.category) + '</span>' +
      '</div>' +
      '<div class="evd-body">' +
        '<div class="evd-badges">' + featured + badge + '</div>' +
        '<h2 class="evd-title">' + esc(ev.name) + '</h2>' +
        '<p class="evd-meta">' + esc(dateLabel) + ' · ' + timeLabel + '  —  ' + esc(ev.city) + '</p>' +
        transparency +
        '<p class="evd-desc">' + esc(ev.description) + '</p>' +
        '<div class="evd-actions">' +
          '<button class="ev-like' + (ev.userLiked ? ' on' : '') + '" data-act="like">♥ <span class="n">' + ev.likes.toLocaleString() + '</span></button>' +
          '<button class="ev-attend' + (ev.userAttending ? ' on' : '') + '" data-act="attend">✓ <span class="n">' + ev.attending.toLocaleString() + '</span></button>' +
          '<button class="ev-save' + (P.isSaved(ev.id) ? ' on' : '') + '" data-act="save">' + (P.isSaved(ev.id) ? '★' : '☆') + '</button>' +
        '</div>' + avail +
      '</div>';
    eventEl.classList.add('open');
  }
  function closeEvent() { eventEl.classList.remove('open'); activeEventId = null; }

  eventEl.addEventListener('click', function (e) {
    if (e.target.closest('.evd-x') || e.target.closest('.evd-back')) { closeEvent(); return; }
    if (e.target.closest('[data-register]')) { window.EventuallyToast('Registration (demo) — native Eventually event.'); return; }
    const srcBtn = e.target.closest('[data-src]');
    if (srcBtn) {
      const ev = D.getById(activeEventId);
      const s = ev.sources.find(function (x) { return x.source_id === srcBtn.dataset.src; });
      ev.clicks++; const n = M.trackAffiliate();
      window.open(M.affiliate(s.url || 'https://example.com'), '_blank', 'noopener');
      window.EventuallyToast('Opening ' + s.sourceLabel + ' — referral tracked (demo · ' + n + ').');
      updateStats(); return;
    }
    const act = e.target.closest('[data-act]'); if (!act) return;
    const ev = D.getById(activeEventId);
    if (act.dataset.act === 'save') {
      const on = P.toggleSaved(ev.id); act.classList.toggle('on', on); act.textContent = on ? '★' : '☆';
      if (acctEnabled()) A.setUserEvent('save', ev.id, snap(ev), on);
      syncReminders();
      window.EventuallyToast(on ? 'Saved to your events.' : 'Removed from saved.'); return;
    }
    requireLogin(function () {
      if (act.dataset.act === 'like') {
        ev.userLiked = !ev.userLiked; ev.likes += ev.userLiked ? 1 : -1;
        act.classList.toggle('on', ev.userLiked); act.querySelector('.n').textContent = ev.likes.toLocaleString();
        if (acctEnabled()) A.setUserEvent('like', ev.id, snap(ev), ev.userLiked);
        window.EventuallyToast(ev.userLiked ? 'Liked — the marker glows brighter.' : 'Like removed.');
      } else {
        ev.userAttending = !ev.userAttending; ev.attending += ev.userAttending ? 1 : -1;
        if (ev.userAttending) P.markAttended(ev.id);
        act.classList.toggle('on', ev.userAttending); act.querySelector('.n').textContent = ev.attending.toLocaleString();
        if (acctEnabled()) A.setUserEvent('attend', ev.id, snap(ev), ev.userAttending);
        window.EventuallyToast(ev.userAttending ? "You're attending — globe updated." : 'Removed from attending.');
      }
      refreshMarkers();
    });
  });

  /* ---------- search ---------- */
  const searchInput = document.getElementById('search');
  const searchResults = document.getElementById('search-results');
  function nearestClusterId(lat, lon) {
    let best = null, bd = Infinity;
    D.getClusters().forEach(function (c) { const dd = (c.lat - lat) * (c.lat - lat) + (c.lon - lon) * (c.lon - lon); if (dd < bd) { bd = dd; best = c; } });
    return best ? best.id : null;
  }
  // Fly to a chosen result. When live, first load that area's events (so cities/
  // events that weren't on the loaded globe appear), then open it.
  function goToSearchResult(o) {
    searchResults.classList.remove('show'); searchInput.value = '';
    function finish() {
      globe.flyTo(o.lat, o.lon);
      globe.setHighlight(o.lat, o.lon, { color: '#ff3b30', id: o.eventId });
      setTimeout(function () {
        if (o.eventId && D.getById(o.eventId)) openEvent(o.eventId);
        else { const cid = nearestClusterId(o.lat, o.lon); if (cid) openPlace(cid); }
      }, 650);
    }
    if (window.EventuallyAPI && window.EventuallyAPI.config.remote && window.EventuallyAPI.fetchEvents) {
      window.EventuallyAPI.fetchEvents({ minLat: o.lat - 0.4, maxLat: o.lat + 0.4, minLon: o.lon - 0.6, maxLon: o.lon + 0.6 })
        .then(function (evs) {
          if (evs && evs.length) { D.mergeEvents(evs); markMine(); globe.setClusters(D.getClusters()); refreshMarkers(); updateStats(); }
          finish();
        }).catch(finish);
    } else { finish(); }
  }
  function renderSearchResults(cities, events) {
    let html = cities.map(function (c) {
      return '<button class="sr-city" data-lat="' + c.lat + '" data-lon="' + c.lon + '"><span class="dot city">📍</span>' +
        esc(c.city) + '<small>' + c.n + ' event' + (c.n === 1 ? '' : 's') + '</small></button>';
    }).join('');
    html += events.map(function (e) {
      return '<button data-ev="' + esc(e.id) + '" data-lat="' + e.lat + '" data-lon="' + e.lon + '"><span class="dot" style="background:' +
        (e.color || '#CB5A3C') + '"></span>' + esc(e.name) + '<small>' + esc(e.city || '') + '</small></button>';
    }).join('');
    searchResults.innerHTML = html || '<div class="no-hits">No events found.</div>';
    searchResults.classList.add('show');
    searchResults.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        P.addSearch(searchInput.value);
        goToSearchResult({ lat: +b.dataset.lat, lon: +b.dataset.lon, eventId: b.dataset.ev });
      });
    });
  }
  function localSearch(q) {   // demo / offline: search the loaded set
    const byCity = {};
    D.getClusters().forEach(function (c) {
      if (!c._visible || !c.city || c.city.toLowerCase().indexOf(q) < 0) return;
      const k = c.city.toLowerCase();
      if (!byCity[k] || c._visible > byCity[k].n) byCity[k] = { city: c.city, lat: c.lat, lon: c.lon, n: c._visible };
    });
    const cities = Object.keys(byCity).map(function (k) { return byCity[k]; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 3);
    const events = D.getEvents().filter(function (e) {
      if (RT._hidEv[e.id] || RT._hidCity[(e.city || '').toLowerCase()]) return false;
      return (e.name + ' ' + e.city + ' ' + e.category).toLowerCase().indexOf(q) > -1;
    }).sort(function (a, b) { return D.popularity(b) - D.popularity(a); }).slice(0, 5)
      .map(function (e) { return { id: e.id, name: e.name, city: e.city, lat: e.lat, lon: e.lon, color: e.categoryColor }; });
    renderSearchResults(cities, events);
  }
  let _searchTimer = null;
  searchInput.addEventListener('input', function () {
    const q = searchInput.value.trim();
    if (!q) { searchResults.classList.remove('show'); return; }
    clearTimeout(_searchTimer);
    if (window.EventuallyAPI && window.EventuallyAPI.config.remote && window.EventuallyAPI.search) {
      // Backend search: finds ANY approved event in the database (not just loaded).
      _searchTimer = setTimeout(function () {
        window.EventuallyAPI.search(q).then(function (rows) {
          rows = (rows || []).filter(function (e) { return !RT._hidEv[e.event_id] && !RT._hidCity[(e.city || '').toLowerCase()]; });
          const byCity = {};
          rows.forEach(function (e) { const k = (e.city || '').toLowerCase(); if (!k) return; if (!byCity[k]) byCity[k] = { city: e.city, lat: e.lat, lon: e.lon, n: 0 }; byCity[k].n++; });
          const cities = Object.keys(byCity).map(function (k) { return byCity[k]; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 4);
          const events = rows.slice(0, 6).map(function (e) { return { id: e.event_id, name: e.title, city: e.city, lat: e.lat, lon: e.lon, color: D.CATEGORIES[e.category] || '#CB5A3C' }; });
          renderSearchResults(cities, events);
        });
      }, 250);
    } else {
      localSearch(q.toLowerCase());
    }
  });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.search-wrap')) searchResults.classList.remove('show');
  });

  /* ---------- header stats ---------- */
  function updateStats() {
    const all = D.getEvents();
    const live = all.filter(function (e) { return D.typeForDate(e, selectedDate) === 'live'; }).length;
    const up = all.filter(function (e) { return D.typeForDate(e, selectedDate) === 'upcoming'; }).length;
    document.getElementById('stat-live').textContent = live;
    document.getElementById('stat-up').textContent = up;
    document.getElementById('stat-total').textContent = all.length;
  }
  updateStats();

  /* ---------- location (browser geolocation + manual fallback) ---------- */
  const locChip = document.getElementById('nav-location');
  const locName = locChip.querySelector('.loc-name');
  const locMenu = document.getElementById('loc-menu');

  function uniqueCities() {
    const seen = {}, out = [];
    D.getEvents().forEach(function (e) { if (!seen[e.city]) { seen[e.city] = 1; out.push({ city: e.city, lat: e.lat, lon: e.lon }); } });
    return out.sort(function (a, b) { return a.city < b.city ? -1 : 1; });
  }
  function nearestCity(lat, lon) {
    let best = null, bd = Infinity;
    uniqueCities().forEach(function (c) {
      const d = (c.lat - lat) * (c.lat - lat) + (c.lon - lon) * (c.lon - lon);
      if (d < bd) { bd = d; best = c; }
    });
    return best;
  }
  function renderLocChip() {
    const loc = P.get().location;
    locName.textContent = loc ? loc.city : 'Set location';
    locChip.classList.toggle('set', !!loc);
  }
  function setLocation(loc) {
    P.setLocation(loc); renderLocChip(); refreshProfile(); syncProfile();
    userLoc = { lat: loc.lat, lon: loc.lon };
    if (globe.setUserLocation) globe.setUserLocation(loc.lat, loc.lon);   // "you are here" marker
    globe.flyTo(loc.lat, loc.lon);
    refreshMarkers();
    let near = 0;
    D.getClusters().forEach(function (c) { if (c._near) near += (c._visible || 0); });
    window.EventuallyToast(near
      ? 'You\'re in ' + loc.city + ' — ' + near + ' event' + (near === 1 ? '' : 's') + ' within ' + NEAR_KM + ' km.'
      : 'Location set to ' + loc.city + ' — no events within ' + NEAR_KM + ' km yet.');
  }
  // GPS → the REAL city name (reverse-geocoded), falling back to the nearest
  // loaded-event city, then "Your area", if the geocoder is unavailable.
  function setFromGPS(loc) {
    const done = function (city) { setLocation({ city: city, lat: loc.lat, lon: loc.lon, source: 'gps' }); };
    if (window.EventuallyGeo && window.EventuallyGeo.reverse) {
      window.EventuallyGeo.reverse(loc.lat, loc.lon)
        .then(function (r) { done((r && r.city) || (nearestCity(loc.lat, loc.lon) || {}).city || 'Your area'); })
        .catch(function () { done((nearestCity(loc.lat, loc.lon) || {}).city || 'Your area'); });
    } else { done((nearestCity(loc.lat, loc.lon) || {}).city || 'Your area'); }
  }
  locChip.addEventListener('click', function (e) {
    e.stopPropagation();
    // Primary: current location. Fallback: type your city (any city, geocoded) —
    // covers GPS denial / desktop, and lets any place be "home" (not just loaded ones).
    locMenu.innerHTML =
      '<button class="loc-detect" data-detect="1">⌖ Use my current location</button>' +
      '<div class="loc-search"><input class="loc-input" type="text" placeholder="Or search your city…" autocomplete="off">' +
      '<div class="loc-sug"></div></div>';
    const open = !locMenu.classList.contains('show');
    locMenu.classList.toggle('show', open);
    if (open) { const inp = locMenu.querySelector('.loc-input'); if (inp) setTimeout(function () { inp.focus(); }, 30); }
  });
  locMenu.addEventListener('click', function (e) {
    if (e.target.closest('[data-detect]')) {
      window.EventuallyToast('Asking your browser for location…');
      P.detectLocation(function (loc) {
        if (loc) setFromGPS(loc);
        else window.EventuallyToast('Location unavailable — search your city instead.');
      });
      const inp = locMenu.querySelector('.loc-input'); if (inp) setTimeout(function () { inp.focus(); }, 30);
      return;
    }
    const pick = e.target.closest('.loc-pick');
    if (pick) { setLocation({ city: pick.dataset.city, lat: +pick.dataset.lat, lon: +pick.dataset.lon, source: 'manual' }); locMenu.classList.remove('show'); }
  });
  // Debounced city autocomplete (Nominatim) inside the location menu.
  let _locTimer = null;
  locMenu.addEventListener('input', function (e) {
    if (!e.target.classList || !e.target.classList.contains('loc-input')) return;
    const q = e.target.value.trim();
    const sug = locMenu.querySelector('.loc-sug');
    clearTimeout(_locTimer);
    if (q.length < 3 || !window.EventuallyGeo) { if (sug) sug.innerHTML = ''; return; }
    _locTimer = setTimeout(function () {
      window.EventuallyGeo.search(q, 5).then(function (list) {
        if (!sug) return;
        sug.innerHTML = (list || []).map(function (r) {
          return '<button class="loc-pick" data-city="' + esc(r.city) + '" data-lat="' + r.lat + '" data-lon="' + r.lon + '">' + esc(r.label) + '</button>';
        }).join('');
      });
    }, 350);
  });
  document.addEventListener('click', function (e) { if (!e.target.closest('.loc-wrap')) locMenu.classList.remove('show'); });
  renderLocChip();
  // Restore the "you are here" marker if a location was saved previously.
  (function () {
    const loc = P.get().location;
    if (loc && loc.lat != null) { userLoc = { lat: loc.lat, lon: loc.lon }; if (globe.setUserLocation) globe.setUserLocation(loc.lat, loc.lon); }
  })();

  /* ---------- profile / "You" panel (personalization + Plus + notifications) ---------- */
  const profileEl = document.getElementById('profile');

  function recommendations() {
    const interests = P.effectiveInterests(D.getById);
    const loc = P.get().location;
    return D.getEvents()
      .filter(function (e) { return D.typeForDate(e, selectedDate) !== 'past'; })
      .filter(function (e) { return !interests.length || interests.indexOf(e.category) > -1; })
      .map(function (e) { return { e: e, d: loc ? ((e.lat - loc.lat) * (e.lat - loc.lat) + (e.lon - loc.lon) * (e.lon - loc.lon)) : 0 }; })
      .sort(function (a, b) { return a.d - b.d; })
      .slice(0, 4).map(function (x) { return x.e; });
  }
  function renderProfile() {
    const p = P.get();
    profileEl.querySelector('.pf-greeting').textContent = 'Hello ' + (p.name || 'there');
    profileEl.querySelector('.pf-plus-state').textContent = p.plus ? 'Eventually Plus · active' : 'Free plan';
    profileEl.querySelector('.pf-loc').textContent = p.location ? p.location.city : 'not set';
    profileEl.querySelector('.pf-saved-n').textContent = p.saved.length;
    profileEl.querySelector('.pf-interests').innerHTML = Object.keys(D.CATEGORIES).map(function (c) {
      return '<button class="chip' + (P.hasInterest(c) ? ' on' : '') + '" data-cat="' + c + '">' + c + '</button>';
    }).join('');
    const recs = recommendations();
    profileEl.querySelector('.pf-recs').innerHTML = recs.length ? recs.map(function (e) {
      return '<button class="pf-rec" data-id="' + e.id + '"><span class="dot" style="background:' + e.categoryColor + '"></span>' +
        esc(e.name) + '<small>' + esc(e.city) + '</small></button>';
    }).join('') : '<p class="pf-empty">Set your location and interests for tailored picks.</p>';
    profileEl.querySelector('.pf-langs').innerHTML = I18n.LANGS.map(function (l) {
      return '<button class="chip' + ((p.language || 'en') === l.code ? ' on' : '') + '" data-lang="' + l.code + '">' + l.label + '</button>';
    }).join('');
    profileEl.querySelector('.pf-notify').classList.toggle('on', p.notify);
    profileEl.querySelector('.pf-notify .tg-state').textContent = p.notify ? 'On' : 'Off';
    profileEl.querySelector('.pf-filter').classList.toggle('on', interestFilterActive);
    profileEl.querySelector('.pf-filter .tg-state').textContent = interestFilterActive ? 'On' : 'Off';
    profileEl.querySelector('.pf-filter').style.display = p.plus ? '' : 'none';
    profileEl.querySelector('.pf-plus-btn').textContent = p.plus ? 'Cancel Plus (demo)' : 'Go Plus — $7/mo';
    profileEl.querySelector('.pf-logout').style.display = user ? '' : 'none';
    renderAccount();
    renderIdentities();
  }

  /* ---------- account details (name / phone / emails / address / comms) ---------- */
  let acctEditing = null;   // which field is currently in edit mode (null = none)

  function fmtAddress(a) {
    if (!a) return '';
    return [a.line1, a.line2, a.city, a.region, a.postcode, a.country].filter(Boolean).join(', ');
  }

  function renderAccount() {
    const box = profileEl.querySelector('.pf-acct');
    if (!box) return;
    const p = P.get();

    if (!user) {
      box.innerHTML = '<p class="pf-hint">Sign in to view and manage your name, contact details and address.</p>' +
        '<button class="pf-acct-signin">Sign in</button>';
      return;
    }

    // A read row, or an edit row when acctEditing === field.
    function row(field, label, value, opts) {
      opts = opts || {};
      if (acctEditing === field) {
        return '<div class="pf-acct-row is-edit" data-field="' + field + '">' +
          '<label class="pf-acct-k">' + esc(label) + '</label>' +
          '<input class="pf-acct-in" type="' + (opts.type || 'text') + '" value="' + esc(value || '') +
            '" placeholder="' + esc(opts.ph || '') + '">' +
          '<div class="pf-acct-btns"><button class="pf-acct-save" data-save="' + field + '">Save</button>' +
          '<button class="pf-acct-cancel" type="button">Cancel</button></div>' +
          (opts.note ? '<p class="pf-hint">' + esc(opts.note) + '</p>' : '') + '</div>';
      }
      const action = (opts.action != null) ? opts.action
        : '<button class="pf-acct-edit" data-edit="' + field + '">' + (value ? 'Edit' : 'Add') + '</button>';
      return '<div class="pf-acct-row" data-field="' + field + '">' +
        '<span class="pf-acct-k">' + esc(label) + '</span>' +
        '<span class="pf-acct-v">' + (value ? esc(value) : '<i>not set</i>') + '</span>' + action + '</div>';
    }

    let h = '';
    h += row('name', 'Name', p.name, { ph: 'Your name' });
    h += row('phone', 'Phone', p.phone, { type: 'tel', ph: '+1 555 123 4567' });

    // Login email — editable only for email/magic-link accounts (Google owns its own).
    if (acctEditing === 'loginEmail') {
      h += row('loginEmail', 'Login email', user.email, { type: 'email',
        note: "We'll email a confirmation link to the new address — the change applies once you click it." });
    } else {
      h += row('loginEmail', 'Login email', user.email, {
        action: user.provider === 'google'
          ? '<span class="pf-acct-note">Managed by Google</span>'
          : '<button class="pf-acct-edit" data-edit="loginEmail">Change</button>'
      });
    }

    h += row('contactEmail', 'Contact email', p.contactEmail, { type: 'email', ph: 'you@email.com' });

    // Home address — composite; editing opens a sub-form with autocomplete.
    if (acctEditing === 'address') {
      const a = p.address || {};
      const f = function (k, ph) { return '<input class="pf-addr-f" data-k="' + k + '" placeholder="' + ph + '" value="' + esc(a[k] || '') + '">'; };
      h += '<div class="pf-acct-addr" data-field="address">' +
        '<label class="pf-acct-k">Home address</label>' +
        '<input class="pf-addr-search" placeholder="Search your address…" autocomplete="off">' +
        '<div class="pf-addr-sug"></div>' +
        f('line1', 'Address line 1') + f('line2', 'Address line 2 (optional)') +
        f('city', 'City') + f('region', 'Region / state') + f('postcode', 'Postcode') + f('country', 'Country') +
        '<div class="pf-acct-btns"><button class="pf-acct-save" data-save="address">Save address</button>' +
        '<button class="pf-acct-cancel" type="button">Cancel</button></div></div>';
    } else {
      h += row('address', 'Home address', fmtAddress(p.address), {});
    }

    // Communication preferences (always-interactive toggles).
    const comms = p.comms || {};
    h += '<div class="pf-acct-comms"><div class="pf-acct-k">Communication preferences</div>' +
      [['reminders', 'Event reminders'], ['marketing', 'Offers & news'], ['sms', 'SMS updates']].map(function (d) {
        return '<button class="pf-toggle pf-comm' + (comms[d[0]] ? ' on' : '') + '" data-comm="' + d[0] + '">' +
          '<span>' + d[1] + '</span><span class="tg-state">' + (comms[d[0]] ? 'On' : 'Off') + '</span></button>';
      }).join('') + '</div>';

    box.innerHTML = h;
    if (acctEditing && acctEditing !== 'address') {
      const inp = box.querySelector('.pf-acct-in'); if (inp) { inp.focus(); inp.select(); }
    }
  }

  function applyAddrSuggestion(r) {
    const box = profileEl.querySelector('.pf-acct');
    const set = function (k, v) { const el = box.querySelector('.pf-addr-f[data-k="' + k + '"]'); if (el && v) el.value = v; };
    set('line1', r.line1); set('city', r.city); set('region', r.region); set('postcode', r.postcode); set('country', r.country);
    const form = box.querySelector('.pf-acct-addr');
    if (form && r.lat != null) { form.dataset.lat = r.lat; form.dataset.lon = r.lon; }
    const sug = box.querySelector('.pf-addr-sug'); if (sug) sug.innerHTML = '';
  }

  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  function saveAccountField(field) {
    const box = profileEl.querySelector('.pf-acct');

    if (field === 'address') {
      const a = {};
      box.querySelectorAll('.pf-addr-f').forEach(function (el) { const v = el.value.trim(); if (v) a[el.dataset.k] = v; });
      const form = box.querySelector('.pf-acct-addr');
      if (Object.keys(a).length && form && form.dataset.lat) { a.lat = +form.dataset.lat; a.lon = +form.dataset.lon; }
      P.set({ address: Object.keys(a).length ? a : null });
      acctEditing = null; renderAccount(); syncProfile();
      window.EventuallyToast(Object.keys(a).length ? 'Address saved.' : 'Address cleared.');
      return;
    }

    const inp = box.querySelector('.pf-acct-in');
    if (!inp) return;
    const v = inp.value.trim();

    if (field === 'loginEmail') {
      if (!EMAIL_RE.test(v)) { window.EventuallyToast('Enter a valid email address.'); return; }
      if (v === user.email) { acctEditing = null; renderAccount(); return; }
      A.updateEmail(v).then(function (r) {
        if (r && r.error) { window.EventuallyToast('Could not change email: ' + r.error.message); return; }
        window.EventuallyToast('Confirmation link sent to ' + v + '. Click it to finish changing your sign-in email.');
      });
      acctEditing = null; renderAccount();
      return;
    }
    if (field === 'contactEmail' && v && !EMAIL_RE.test(v)) { window.EventuallyToast('Enter a valid email address.'); return; }

    if (field === 'name') { P.setName(v || 'You'); renderMenuTrigger(); }
    else if (field === 'phone') { P.set({ phone: v || null }); }
    else if (field === 'contactEmail') { P.set({ contactEmail: v || null }); }

    acctEditing = null;
    if (field === 'name') renderProfile(); else renderAccount();
    syncProfile();
    window.EventuallyToast('Saved.');
  }
  // Show linked sign-in methods + let the user attach Google to this account so
  // Google and the magic link open ONE account (real auth only).
  function renderIdentities() {
    const sec = profileEl.querySelector('.pf-identities');
    if (!sec) return;
    if (!authReal || !user) { sec.style.display = 'none'; return; }
    sec.style.display = '';
    const list = sec.querySelector('.pf-id-list');
    list.innerHTML = '<span class="pf-id-loading">…</span>';
    A.listIdentities().then(function (ids) {
      const have = {}; ids.forEach(function (i) { have[i.provider] = true; });
      let h = ids.map(function (i) {
        const label = i.provider === 'google' ? 'Google' : (i.provider === 'email' ? 'Email magic link' : i.provider);
        return '<div class="pf-id-row"><span>✓ ' + esc(label) + '</span></div>';
      }).join('');
      if (!have.google) h += '<button class="pf-id-link" data-link="google">Connect Google</button>';
      else if (!have.email) h += '<p class="pf-hint">Tip: sign in with the email magic link to add it too.</p>';
      list.innerHTML = h || '<span class="pf-id-loading">No methods found.</span>';
    }).catch(function () { list.innerHTML = '<span class="pf-id-loading">Could not load methods.</span>'; });
  }
  function refreshProfile() { if (profileEl.classList.contains('open')) renderProfile(); }
  function openProfile() { profileEl.classList.add('open'); renderProfile(); }

  profileEl.querySelector('.pf-close').addEventListener('click', function () { profileEl.classList.remove('open'); });
  profileEl.addEventListener('click', function (e) {
    const chip = e.target.closest('.chip[data-cat]');
    if (chip) { P.toggleInterest(chip.dataset.cat); chip.classList.toggle('on'); refreshMarkers(); renderProfile(); syncProfile(); return; }
    const lang = e.target.closest('.chip[data-lang]');
    if (lang) {
      P.set({ language: lang.dataset.lang }); renderProfile(); syncProfile();
      const l = I18n.LANGS.find(function (x) { return x.code === lang.dataset.lang; });
      window.EventuallyToast('Host language: ' + (l ? l.label : lang.dataset.lang) + '. Press ▶ to hear it.');
      return;
    }
    const rec = e.target.closest('.pf-rec[data-id]');
    if (rec) {
      const ev = D.getById(rec.dataset.id);
      profileEl.classList.remove('open'); globe.flyTo(ev.lat, ev.lon);
      setTimeout(function () { openEvent(ev.id); }, 600);
      return;
    }
    const link = e.target.closest('.pf-id-link');
    if (link && link.dataset.link === 'google' && authReal) {
      window.EventuallyToast('Opening Google to link it to this account…');
      A.linkGoogle().then(function (r) {
        if (r && r.error) window.EventuallyToast('Could not link Google: ' + r.error.message);
      });
      return;
    }
    // ---- account details ----
    if (e.target.closest('.pf-acct-signin')) { openAuth(); return; }
    const aEdit = e.target.closest('.pf-acct-edit');
    if (aEdit) { acctEditing = aEdit.dataset.edit; renderAccount(); return; }
    if (e.target.closest('.pf-acct-cancel')) { acctEditing = null; renderAccount(); return; }
    const aSave = e.target.closest('.pf-acct-save');
    if (aSave) { saveAccountField(aSave.dataset.save); return; }
    const pick = e.target.closest('.pf-addr-pick');
    if (pick) { try { applyAddrSuggestion(JSON.parse(pick.dataset.r)); } catch (err) {} return; }
    const comm = e.target.closest('.pf-comm');
    if (comm) {
      const c = Object.assign({}, P.get().comms); const k = comm.dataset.comm;
      c[k] = !c[k]; P.set({ comms: c }); renderAccount(); syncProfile();
      // Turning reminders on: ask for Notification permission (needs this gesture), then schedule.
      if (k === 'reminders') {
        if (c[k] && Reminders && !Reminders.permitted()) {
          Reminders.requestPermission(function (ok) {
            window.EventuallyToast(ok ? 'Reminders on — we\'ll ping you about saved events.' : 'Allow notifications to get reminders.');
          });
        } else { syncReminders(); }
      }
      return;
    }
  });
  // Save-on-Enter for single-field account edits.
  profileEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('pf-acct-in')) {
      e.preventDefault(); if (acctEditing) saveAccountField(acctEditing);
    }
  });
  // Debounced address autocomplete (Nominatim) inside the address editor.
  let _addrTimer = null;
  profileEl.addEventListener('input', function (e) {
    if (!e.target.classList || !e.target.classList.contains('pf-addr-search')) return;
    const q = e.target.value.trim();
    const sug = profileEl.querySelector('.pf-addr-sug');
    clearTimeout(_addrTimer);
    if (q.length < 3 || !window.EventuallyGeo) { if (sug) sug.innerHTML = ''; return; }
    _addrTimer = setTimeout(function () {
      window.EventuallyGeo.search(q, 5).then(function (list) {
        if (!sug) return;
        sug.innerHTML = (list || []).map(function (r) {
          return '<button type="button" class="pf-addr-pick" data-r="' + esc(JSON.stringify(r)) + '">' + esc(r.label) + '</button>';
        }).join('');
      });
    }, 350);
  });
  profileEl.querySelector('.pf-plus-btn').addEventListener('click', goPlus);
  profileEl.querySelector('.pf-notify').addEventListener('click', enableNotifications);
  profileEl.querySelector('.pf-filter').addEventListener('click', function () {
    interestFilterActive = !interestFilterActive;
    refreshMarkers(); renderProfile();
    window.EventuallyToast(interestFilterActive ? 'Globe filtered to your interests.' : 'Showing all events.');
  });
  profileEl.querySelector('.pf-logout').addEventListener('click', function () { logout(); profileEl.classList.remove('open'); });

  /* ---------- web notifications (frontend demo) ---------- */
  function enableNotifications() {
    if (!('Notification' in window)) { window.EventuallyToast('Notifications not supported here.'); return; }
    if (P.get().notify) { P.setNotify(false); renderProfile(); syncProfile(); window.EventuallyToast('Notifications off.'); return; }
    Notification.requestPermission().then(function (perm) {
      if (perm === 'granted') {
        P.setNotify(true); renderProfile(); syncProfile();
        try { new Notification('Eventually', { body: "You're set — we'll ping you about saved & nearby events.", icon: 'assets/icon.svg' }); } catch (e) {}
        setTimeout(function () { if (P.get().notify) try { new Notification('New nearby event', { body: 'A live music event just popped up near you.', icon: 'assets/icon.svg' }); } catch (e) {} }, 9000);
        setTimeout(function () { if (P.get().notify) try { new Notification('Trending now', { body: 'Neon Skyline Festival is climbing fast.', icon: 'assets/icon.svg' }); } catch (e) {} }, 20000);
      } else window.EventuallyToast('Notifications blocked in your browser settings.');
    });
  }

  /* ---------- display ads + premium visibility ---------- */
  const adbar = document.getElementById('adbar');
  function renderAd() {
    const ad = M.randomAd();
    adbar.innerHTML = '<span class="ad-tag">Ad</span>' +
      '<div class="ad-body"><strong>' + esc(ad.brand) + '</strong><span>' + esc(ad.text) + '</span></div>' +
      '<button class="ad-plus">Remove ads</button>';
    adbar.querySelector('.ad-plus').addEventListener('click', openProfile);
  }
  function applyMonetization() {
    const showAds = RT.adsEnabled && !P.get().plus;   // admin can disable ads globally
    document.body.classList.toggle('has-ad', showAds);
    adbar.style.display = showAds ? '' : 'none';
    if (showAds) renderAd();
    rerenderPlace();                 // show/hide the partner card
  }
  applyMonetization();
  setInterval(function () { if (!P.get().plus) renderAd(); }, 30000);  // rotate ad creatives

  /* ---------- ⋯ menu (consolidated nav) ---------- */
  const menuBtn = document.getElementById('nav-menu');
  const dropdown = document.getElementById('nav-dropdown');

  function renderMenuTrigger() {
    if (user) {
      menuBtn.classList.add('signed');
      menuBtn.innerHTML = '<span class="avatar">' + user.name[0].toUpperCase() + '</span>' +
        (P.get().plus ? '<span class="plus-tag">PLUS</span>' : '') +
        '<span class="menu-dots"><i></i><i></i><i></i></span>';
    } else {
      menuBtn.classList.remove('signed');
      menuBtn.innerHTML = '<span class="menu-dots"><i></i><i></i><i></i></span>';
    }
  }
  function buildDropdown() {
    const p = P.get();
    let h = '';
    if (user) h += '<div class="dd-user"><span class="avatar">' + user.name[0].toUpperCase() + '</span>' +
      '<div><strong>' + esc(user.name) + '</strong><small>' + (p.plus ? 'Eventually Plus' : 'Free plan') + '</small></div></div>';
    else h += '<button class="dd-item dd-primary" data-act="signin">Sign in / Sign up</button>';
    h += '<button class="dd-item" data-act="profile">Profile</button>';
    h += '<button class="dd-item" data-act="saved">Saved events <span class="dd-badge">' + p.saved.length + '</span></button>';
    h += '<button class="dd-item" data-act="create">Create an event</button>';
    h += '<div class="dd-sep"></div>';
    h += '<button class="dd-item" data-act="help">Help centre</button>';
    h += '<button class="dd-item" data-act="contact">Contact sales</button>';
    if (!p.plus) h += '<button class="dd-item dd-plus" data-act="plus">✦ Get Eventually Plus</button>';
    if (user) h += '<div class="dd-sep"></div><button class="dd-item dd-muted" data-act="signout">Sign out</button>';
    dropdown.innerHTML = h;
  }
  function openMenu() { buildDropdown(); dropdown.classList.add('show'); menuBtn.setAttribute('aria-expanded', 'true'); }
  function closeMenu() { dropdown.classList.remove('show'); menuBtn.setAttribute('aria-expanded', 'false'); }
  menuBtn.addEventListener('click', function (e) { e.stopPropagation(); dropdown.classList.contains('show') ? closeMenu() : openMenu(); });
  document.addEventListener('click', function (e) { if (!e.target.closest('.menu-wrap')) closeMenu(); });
  dropdown.addEventListener('click', function (e) {
    const it = e.target.closest('[data-act]'); if (!it) return;
    const act = it.dataset.act; closeMenu();
    if (act === 'signin') openAuth();
    else if (act === 'signout') logout();
    else if (act === 'profile' || act === 'saved' || act === 'plus') openProfile();
    else if (act === 'create') requireLogin(function () { coordinator.open(); });
    else if (act === 'types') openTypes();
    else if (act === 'help') openHelp();
    else if (act === 'contact') openContact();
  });
  renderMenuTrigger();

  /* ---------- shared modal (Help / Contact / Event types) ---------- */
  const modal = document.getElementById('modal');
  function openModal(title, bodyHTML, mount) {
    modal.querySelector('.modal-title').textContent = title;
    modal.querySelector('.modal-body').innerHTML = bodyHTML;
    modal.classList.add('open');
    if (mount) mount(modal.querySelector('.modal-body'));
  }
  function closeModal() { modal.classList.remove('open'); }
  modal.querySelector('.modal-close').addEventListener('click', closeModal);
  modal.querySelector('.modal-backdrop').addEventListener('click', closeModal);

  function openTypes() {
    const cats = Object.keys(D.CATEGORIES);
    const html = '<p class="modal-lead">Show or hide event types across the globe and results.</p>' +
      '<div class="type-chips">' + cats.map(function (c) {
        return '<button class="chip' + (activeTypes[c] ? ' on' : '') + '" data-type="' + c + '">' +
          '<span class="dot" style="background:' + D.CATEGORIES[c] + '"></span>' + c + '</button>';
      }).join('') + '</div>' +
      '<div class="type-actions"><button data-all="1">Show all</button><button data-all="0">Hide all</button></div>';
    openModal('Event types', html, function (body) {
      body.addEventListener('click', function (e) {
        const chip = e.target.closest('[data-type]');
        if (chip) { const c = chip.dataset.type; activeTypes[c] = !activeTypes[c]; chip.classList.toggle('on', activeTypes[c]); refreshMarkers(); rerenderPlace(); return; }
        const all = e.target.closest('[data-all]');
        if (all) { const v = all.dataset.all === '1'; cats.forEach(function (c) { activeTypes[c] = v; }); body.querySelectorAll('[data-type]').forEach(function (ch) { ch.classList.toggle('on', v); }); refreshMarkers(); rerenderPlace(); }
      });
    });
  }
  function openHelp() {
    openModal('Help centre',
      '<div class="help">' +
      '<details open><summary>What is Eventually?</summary><p>A live directory of events worldwide on an interactive globe. Spin it, tap any glowing marker, and see everything happening at that spot.</p></details>' +
      '<details><summary>How do I save events?</summary><p>Tap the ☆ on any event card. Saved events feed your personalized recommendations from the Host.</p></details>' +
      '<details><summary>What is the eventually Host?</summary><p>Your live AI concierge — it narrates what\'s happening worldwide and tailors picks to your location and interests. Press play to hear it, with a music bed behind it.</p></details>' +
      '<details><summary>How do I list my event?</summary><p>Open the ⋯ menu → Create an event, drop a pin on the map, and publish straight to the globe.</p></details>' +
      '<details><summary>What is Eventually Plus?</summary><p>An ad-free, sponsor-free membership with advanced filtering, a personalized Host, reminders and early access.</p></details>' +
      '</div>');
  }
  function openContact() {
    openModal('Contact sales',
      '<p class="modal-lead">Partner with Eventually — sponsorships, featured placements and ticketing.</p>' +
      '<form class="contact-form">' +
        '<label>Name<input name="name" required></label>' +
        '<label>Work email<input name="email" type="email" required></label>' +
        '<label>How can we help?<textarea name="msg" rows="3"></textarea></label>' +
        '<button type="submit">Send enquiry</button>' +
        '<p class="modal-fine">Demo only — this form doesn\'t send anywhere.</p>' +
      '</form>',
      function (body) {
        body.querySelector('.contact-form').addEventListener('submit', function (e) {
          e.preventDefault(); closeModal(); window.EventuallyToast('Thanks — our team will be in touch (demo).');
        });
      });
  }

  /* ---------- accounts (Supabase Auth) ----------
     When configured, real sign-in drives `user`. On login we pull the account's
     profile + saved/liked/attended and migrate any anonymous localStorage data
     up once. When not configured, the mock auth flow above stays in charge. */
  function acctEnabled() { return !!(authReal && user); }
  let myEventIds = [];
  function markMine() { myEventIds.forEach(function (id) { const e = D.getById(id); if (e) e._mine = true; }); }
  function snap(e) {
    return e ? { title: e.name, city: e.city, category: e.category, lat: e.lat, lon: e.lon,
                 start: e.date && e.date.toISOString(), url: e.ticketUrl || null } : null;
  }
  function billingEnabled() { return !!(window.EventuallyBilling && window.EventuallyBilling.enabled); }
  function syncProfile() {
    if (!acctEnabled()) return;
    const p = P.get();
    const patch = { name: p.name, phone: p.phone, location: p.location, interests: p.interests,
                    notify: p.notify, language: p.language };
    if (!billingEnabled()) patch.is_plus = p.plus;   // when billing is live, is_plus is server-only
    A.saveProfile(patch);
    // Columns from 20_profile_details.sql — saved in a SEPARATE update so that if
    // that migration hasn't been run yet, the missing-column error can't block the
    // core fields above.
    A.saveProfile({ contact_email: p.contactEmail, address: p.address, comms: p.comms });
  }
  function goPlus() {
    if (billingEnabled()) {
      if (P.get().plus) { window.EventuallyToast("You're on Eventually Plus — manage it from your email receipts."); return; }
      requireLogin(function () {
        window.EventuallyToast('Opening secure checkout…');
        window.EventuallyBilling.startPlusCheckout({ id: user.id, email: user.email });
      });
      return;
    }
    // demo (no billing configured): mock toggle
    P.setPlus(!P.get().plus); applyMonetization(); renderProfile(); renderMenuTrigger(); syncProfile();
    window.EventuallyToast(P.get().plus ? 'Welcome to Eventually Plus — ads & sponsor reads off (demo).' : 'Eventually Plus cancelled (demo).');
  }
  // After a native event is published with "Feature" ticked, settle the placement:
  // a Plus member's monthly free quota first, otherwise a one-off checkout.
  function handleFeature(evt) {
    if (!billingEnabled()) return;                 // demo: it's already featured locally
    A.claimFreeFeature(evt.id).then(function (res) {
      if (res && res.ok) {
        evt.sponsored = true; refreshMarkers();
        window.EventuallyToast('Featured with Plus — ' + res.remaining + ' free left this month.');
      } else {
        evt.sponsored = false; refreshMarkers();   // not featured until paid
        window.EventuallyToast('Opening checkout to feature this event…');
        window.EventuallyBilling.startFeatureCheckout({ id: user.id, email: user.email }, evt.id);
      }
    }).catch(function () { window.EventuallyToast('Could not start featuring — try again.'); });
  }
  // One-time "complete your profile" step after first sign-in.
  function promptProfileSetup(pr) {
    const p = P.get();
    const nm = (pr && pr.name) || p.name || (user && user.name) || '';
    const cityVal = (p.location && p.location.city) || '';
    openModal('Complete your profile',
      '<form class="ps-form">' +
        '<label>Display name<input class="ps-name" value="' + esc(nm) + '" placeholder="Your name" required></label>' +
        '<label>City <span class="ps-opt">(optional)</span><input class="ps-city" value="' + esc(cityVal) + '" placeholder="e.g. Toronto" autocomplete="off"></label>' +
        '<label>Phone <span class="ps-opt">(optional, but encouraged)</span><input class="ps-phone" type="tel" placeholder="+1 555 123 4567"></label>' +
        '<p class="ps-fine">Your city tailors nearby events. Phone is optional and never shown publicly.</p>' +
        '<div class="ps-actions"><button type="button" class="ps-skip">Skip for now</button><button type="submit" class="ps-save">Save</button></div>' +
      '</form>',
      function (body) {
        function finish(extra) { A.saveProfile(Object.assign({ profile_completed: true }, extra || {})); closeModal(); }
        body.querySelector('.ps-skip').addEventListener('click', function () { finish(); });
        body.querySelector('.ps-form').addEventListener('submit', function (e) {
          e.preventDefault();
          const name = body.querySelector('.ps-name').value.trim() || nm || 'You';
          const phone = body.querySelector('.ps-phone').value.trim() || null;
          const cityStr = body.querySelector('.ps-city').value.trim();
          P.setName(name); renderMenuTrigger();
          const done = function () { finish({ name: name, phone: phone }); window.EventuallyToast('Profile saved.'); };
          if (cityStr && window.EventuallyGeo) {
            window.EventuallyGeo.forward(cityStr).then(function (res) {
              if (res) setLocation({ city: res.city || cityStr, lat: res.lat, lon: res.lon, source: 'manual' });
              done();
            }).catch(done);
          } else { done(); }
        });
      });
  }
  if (authReal) {
    A.onChange(function (u) {
      if (!u) {
        const was = user; user = null;
        // Plus is account-bound — never leave a cached Plus state active without a session.
        if (P.get().plus) { P.setPlus(false); applyMonetization(); }
        renderMenuTrigger(); refreshProfile();
        if (was) window.EventuallyToast('Signed out.');
        return;
      }
      const meta = u.user_metadata || {};
      user = { id: u.id, email: u.email, provider: (u.app_metadata && u.app_metadata.provider) || 'email',
               name: meta.name || meta.full_name || (u.email || 'You').split('@')[0] };
      closeAuth();
      // Load profile + saved/liked/attended together, then MERGE with any local
      // (anonymous) data — never overwrite local saves with an empty remote read.
      Promise.all([A.getProfile(), A.listUserEvents()]).then(function (res) {
        const pr = res[0], rows = res[1] || [];
        const rSaved = [], rAttended = [];
        rows.forEach(function (r) { if (r.action === 'save') rSaved.push(r.event_id); else if (r.action === 'attend') rAttended.push(r.event_id); });
        const local = P.get();
        const saved = Array.from(new Set(rSaved.concat(local.saved || [])));
        const attended = Array.from(new Set(rAttended.concat(local.attended || [])));
        if (pr) P.set({ name: user.name,
                        phone: (pr.phone != null) ? pr.phone : local.phone,
                        contactEmail: (pr.contact_email != null) ? pr.contact_email : local.contactEmail,
                        address: pr.address || local.address,
                        comms: pr.comms || local.comms,
                        interests: (pr.interests && pr.interests.length) ? pr.interests : local.interests,
                        location: pr.location || local.location, plus: !!pr.is_plus,
                        notify: !!pr.notify, language: pr.language || local.language });
        else P.setName(user.name);
        P.set({ saved: saved, attended: attended });
        // Push any local-only items up to the account (so they survive the next login).
        saved.filter(function (id) { return rSaved.indexOf(id) < 0; })
             .forEach(function (id) { A.setUserEvent('save', id, snap(D.getById(id)), true); });
        attended.filter(function (id) { return rAttended.indexOf(id) < 0; })
                .forEach(function (id) { A.setUserEvent('attend', id, snap(D.getById(id)), true); });
        if (!pr) syncProfile();   // create/fill the profile row from local data
        if (A.myEvents) A.myEvents().then(function (rows) { myEventIds = (rows || []).map(function (r) { return r.event_id; }); markMine(); });
        renderMenuTrigger(); renderLocChip(); applyMonetization(); refreshMarkers(); refreshProfile();
        syncReminders();                  // saved list changed after sign-in
        if (eventEl.classList.contains('open') && activeEventId) openEvent(activeEventId);
        if (place.classList.contains('open')) rerenderPlace();
        window.EventuallyToast('Signed in' + (user.name ? ' — welcome, ' + user.name + '.' : '.'));
        if (pendingAction) { const a = pendingAction; pendingAction = null; a(); }
        // First-time users: ask for display name / city / phone (once).
        // Only when the column exists AND is false (avoids prompting before the
        // 07_profile_fields.sql migration is run).
        if (pr && pr.profile_completed === false) promptProfileSetup(pr);
      }).catch(function (err) { console.warn('[auth] load failed', err); renderMenuTrigger(); });
    });
  }

  /* ---------- live data (Supabase) ----------
     When a backend is configured we do NOT paint the dense demo dataset first
     (that caused a "flash" of many dots that then collapsed to the real, sparser
     set). Instead we show a clean globe with a small "loading" hint, fetch the
     real events, and populate once. If the load fails, we fall back to the demo
     data so the globe is never empty. */
  function setGlobeLoading(on) {
    const el = document.getElementById('globe-loading');
    if (el) el.classList.toggle('show', !!on);
  }
  if (window.EventuallyAPI && window.EventuallyAPI.config.remote) {
    // Pull admin-tunable runtime config (spike budget, ad/host toggles…).
    if (window.EventuallyAPI.getConfig) {
      window.EventuallyAPI.getConfig().then(function (cfg) {
        if (!cfg) return;
        if (cfg.spikes) RT.spikes = Object.assign({}, RT.spikes, cfg.spikes);
        if (typeof cfg.maxClusters === 'number') RT.maxClusters = cfg.maxClusters;
        if (typeof cfg.adsEnabled === 'boolean') RT.adsEnabled = cfg.adsEnabled;
        if (typeof cfg.hostEnabled === 'boolean') RT.hostEnabled = cfg.hostEnabled;
        if (cfg.hostLines) RT.hostLines = cfg.hostLines;
        if (cfg.hostVoice) RT.hostVoice = Object.assign({}, RT.hostVoice, cfg.hostVoice);
        if (cfg.pinnedLocations) RT.pinned = cfg.pinnedLocations;
        if (cfg.hiddenCities) RT.hiddenCities = cfg.hiddenCities;
        if (cfg.hiddenEvents) RT.hiddenEvents = cfg.hiddenEvents;
        applyHidden();
        refreshMarkers(); applyMonetization();
      });
    }
    globe.setClusters([]);            // clear the demo markers before the first paint
    refreshMarkers();
    setGlobeLoading(true);
    window.EventuallyAPI.onData(function (events) {
      D.replaceAll(events);
      markMine();
      globe.setClusters(D.getClusters());
      refreshMarkers();
      updateStats();
      rerenderPlace();
      if (timeline && timeline._drawSpark) timeline._drawSpark();
      setGlobeLoading(false);
      syncReminders();                  // saved events are now resolvable → (re)schedule
    });
    window.EventuallyAPI.boot().then(function (ok) {
      if (!ok) {                      // load failed → fall back to demo data
        globe.setClusters(D.getClusters());
        refreshMarkers(); updateStats();
        if (timeline && timeline._drawSpark) timeline._drawSpark();
      }
      setGlobeLoading(false);
    });
  }

  /* ---------- PWA service worker ---------- */
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();

/* Eventually — app orchestrator. Wires the globe, timeline, AI host, event card,
 * auth modal and coordinator portal together. Front-end demo (no backend). */
(function () {
  'use strict';

  const D = window.EventuallyData;
  const P = window.EventuallyProfile;
  const M = window.EventuallyMonetize;
  let user = P.get().name ? { name: P.get().name, provider: 'saved' } : null;
  let selectedDate = D.TODAY;
  let interestFilterActive = false;     // Plus "advanced filtering"
  const activeTypes = {};               // "Event types" globe filter (all on by default)
  Object.keys(D.CATEGORIES).forEach(function (c) { activeTypes[c] = true; });

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

  // Per location, derive what to show for the selected date: how many events
  // are live / upcoming, the aggregate popularity, and a representative colour.
  function refreshMarkers() {
    const interests = (interestFilterActive && P.get().plus) ? P.effectiveInterests(D.getById) : null;
    D.getClusters().forEach(function (c) {
      let live = 0, up = 0, maxPop = 0, col = null, bestPop = -1, featured = false;
      c.eventIds.forEach(function (id) {
        const ev = D.getById(id);
        if (!activeTypes[ev.category]) return;                 // "Event types" filter
        if (interests && interests.length && interests.indexOf(ev.category) < 0) return;
        const t = D.typeForDate(ev, selectedDate);
        if (t === 'past') return;
        if (t === 'live') live++; else up++;
        if (ev.sponsored) featured = true;       // Revenue 2 — featured placement
        const p = D.popularity(ev);
        if (p > maxPop) maxPop = p;
        if (p > bestPop) { bestPop = p; col = ev.categoryColor; }
      });
      c._live = live; c._up = up; c._visible = live + up;
      c._renderType = live > 0 ? 'live' : (up > 0 ? 'upcoming' : 'none');
      c._featured = featured;
      // brightness/height: most popular event + bump per extra event + featured boost
      c._pop = Math.min(1, maxPop + 0.07 * Math.max(0, c._visible - 1) + (featured ? 0.2 : 0));
      c._color = col || '#ffb547';
    });
  }
  refreshMarkers();

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

  let _raf;
  function loop() { globe.render(); _raf = requestAnimationFrame(loop); }
  _raf = requestAnimationFrame(loop);
  // debug hooks (let a screenshot tool capture a still frame)
  window.__eventually = {
    globe: globe,
    freeze: function () { cancelAnimationFrame(_raf); globe.render(); },
    resume: function () { _raf = requestAnimationFrame(loop); }
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
  new window.EventuallyAIHost(document.getElementById('ai-host'), {
    getLine: function () { return narrator.next(); },
    onPlay: function () { music.start(); },        // radio bed on when the Host talks
    onPause: function () { music.stop(); },
    onSpeakStart: function () { music.duck(true); },   // duck under the voice
    onSpeakEnd: function () { music.duck(false); }     // swell between segments
  });

  /* ---------- coordinator portal ---------- */
  const coordinator = new window.EventuallyCoordinator(document.getElementById('coordinator'), {
    onPublish: function (evt) {
      D.addEvent(evt);                 // re-clusters internally
      globe.setClusters(D.getClusters());
      refreshMarkers();
      updateStats();
      timeline._drawSpark();
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
  authEl.querySelectorAll('[data-sso]').forEach(function (b) {
    b.addEventListener('click', function () {
      const provider = b.dataset.sso;
      finishLogin(provider === 'email' || provider === 'phone'
        ? 'You' : 'You', provider);
    });
  });
  const magicForm = authEl.querySelector('.magic');
  magicForm.addEventListener('submit', function (e) {
    e.preventDefault();
    const v = magicForm.querySelector('input').value.trim();
    if (!v) return;
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
  function logout() { user = null; P.setName(null); renderMenuTrigger(); window.EventuallyToast('Signed out.'); }

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
    const saved = P.isSaved(ev.id);
    return '' +
      '<article class="ev' + (ev.sponsored ? ' is-featured' : '') + '" data-id="' + ev.id + '">' +
        '<div class="ev-banner" style="background:' + ev.categoryColor + '"></div>' +
        '<div class="ev-main">' +
          '<div class="ev-top">' +
            '<span class="ev-cat" style="color:' + ev.categoryColor + '">' + esc(ev.category) + '</span>' +
            featured + badge +
          '</div>' +
          '<h4 class="ev-title">' + esc(ev.name) + '</h4>' +
          '<p class="ev-date">' + dateLabel + '  ·  ' + esc(ev.sourceLabel) + '</p>' +
          '<p class="ev-desc">' + esc(ev.description) + '</p>' +
          '<div class="ev-actions">' +
            '<button class="ev-like' + (ev.userLiked ? ' on' : '') + '" data-act="like">♥ <span class="n">' + ev.likes.toLocaleString() + '</span></button>' +
            '<button class="ev-attend' + (ev.userAttending ? ' on' : '') + '" data-act="attend">✓ <span class="n">' + ev.attending.toLocaleString() + '</span></button>' +
            '<button class="ev-save' + (saved ? ' on' : '') + '" data-act="save" title="Save event" aria-label="Save event">' + (saved ? '★' : '☆') + '</button>' +
            (ev.ticketUrl ? '<button class="ev-ticket" data-act="ticket">Tickets ↗</button>'
                          : '<span class="ev-native">On Eventually</span>') +
          '</div>' +
        '</div>' +
      '</article>';
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

  function openPlace(clusterId, focusId) {
    const c = clusterById(clusterId);
    if (!c) return;
    activeClusterId = clusterId;
    focusEventId = focusId || null;
    const list = visibleEvents(c);
    const n = list.length;
    place.querySelector('.place-city').textContent = c.city;
    place.querySelector('.place-count').textContent =
      n + ' event' + (n === 1 ? '' : 's') + ' · ' +
      selectedDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' onward';
    placeList.innerHTML = list.map(eventCardHTML).join('') + partnerCardHTML(c);
    place.classList.add('open');
    // count this as a view/click for each shown event
    list.forEach(function (e) { e.clicks++; });
    if (focusEventId) {
      const el = placeList.querySelector('.ev[data-id="' + focusEventId + '"]');
      if (el) { el.classList.add('focus'); el.scrollIntoView({ block: 'center' }); }
    }
  }

  function rerenderPlace() {
    if (activeClusterId && place.classList.contains('open')) openPlace(activeClusterId, focusEventId);
  }

  place.querySelector('.place-close').addEventListener('click', function () {
    place.classList.remove('open'); activeClusterId = null;
  });

  // Delegated like / attend / ticket on the compact cards.
  placeList.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const art = btn.closest('.ev');
    const ev = D.getById(art.dataset.id);
    const act = btn.dataset.act;
    if (act === 'ticket') {                        // Revenue 5 — affiliate tracking
      ev.clicks++;
      const n = M.trackAffiliate();
      window.open(M.affiliate(ev.ticketUrl), '_blank', 'noopener');
      window.EventuallyToast('Opening tickets — referral tracked (demo · ' + n + ' total).');
      updateStats(); return;
    }
    if (act === 'save') {                          // personalization — saved events (anonymous ok)
      const on = P.toggleSaved(ev.id);
      btn.classList.toggle('on', on); btn.textContent = on ? '★' : '☆';
      window.EventuallyToast(on ? 'Saved to your events.' : 'Removed from saved.');
      return;
    }
    requireLogin(function () {
      if (act === 'like') {
        ev.userLiked = !ev.userLiked; ev.likes += ev.userLiked ? 1 : -1;
        btn.classList.toggle('on', ev.userLiked);
        btn.querySelector('.n').textContent = ev.likes.toLocaleString();
        window.EventuallyToast(ev.userLiked ? 'Liked — the marker glows brighter.' : 'Like removed.');
      } else {
        ev.userAttending = !ev.userAttending; ev.attending += ev.userAttending ? 1 : -1;
        if (ev.userAttending) P.markAttended(ev.id);
        btn.classList.toggle('on', ev.userAttending);
        btn.querySelector('.n').textContent = ev.attending.toLocaleString();
        window.EventuallyToast(ev.userAttending ? "You're attending — globe updated." : 'Removed from attending.');
      }
      refreshMarkers();           // popularity changed -> marker brightness
    });
  });

  /* ---------- search ---------- */
  const searchInput = document.getElementById('search');
  const searchResults = document.getElementById('search-results');
  searchInput.addEventListener('input', function () {
    const q = searchInput.value.trim().toLowerCase();
    if (!q) { searchResults.classList.remove('show'); return; }
    const hits = D.getEvents().filter(function (e) {
      return (e.name + ' ' + e.city + ' ' + e.category).toLowerCase().indexOf(q) > -1;
    }).sort(function (a, b) {                 // featured events rank higher
      if (!!b.sponsored !== !!a.sponsored) return b.sponsored ? 1 : -1;
      return D.popularity(b) - D.popularity(a);
    }).slice(0, 6);
    searchResults.innerHTML = hits.length
      ? hits.map(function (e) {
          return '<button data-id="' + e.id + '"><span class="dot" style="background:' +
            e.categoryColor + '"></span>' + e.name +
            '<small>' + e.city + '</small></button>';
        }).join('')
      : '<div class="no-hits">No events found.</div>';
    searchResults.classList.add('show');
    searchResults.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        const ev = D.getById(b.dataset.id);
        const c = D.getClusters().find(function (cl) { return cl.eventIds.indexOf(ev.id) > -1; });
        P.addSearch(searchInput.value);          // personalization — remember searches
        globe.flyTo(ev.lat, ev.lon);
        searchResults.classList.remove('show');
        searchInput.value = '';
        if (c) setTimeout(function () { openPlace(c.id, ev.id); }, 600);
      });
    });
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
    P.setLocation(loc); renderLocChip(); refreshProfile();
    window.EventuallyToast('Location set to ' + loc.city + '.');
  }
  locChip.addEventListener('click', function (e) {
    e.stopPropagation();
    let html = '<button class="loc-detect" data-detect="1">⌖ Use my current location</button><div class="loc-list">';
    uniqueCities().forEach(function (c) {
      html += '<button data-city="' + esc(c.city) + '" data-lat="' + c.lat + '" data-lon="' + c.lon + '">' + esc(c.city) + '</button>';
    });
    locMenu.innerHTML = html + '</div>';
    locMenu.classList.toggle('show');
  });
  locMenu.addEventListener('click', function (e) {
    if (e.target.closest('[data-detect]')) {
      window.EventuallyToast('Asking your browser for location…');
      P.detectLocation(function (loc) {
        if (loc) { const c = nearestCity(loc.lat, loc.lon); setLocation({ city: c ? c.city : 'Your area', lat: loc.lat, lon: loc.lon, source: 'gps' }); }
        else window.EventuallyToast('Location unavailable — pick a city below.');
      });
      locMenu.classList.remove('show'); return;
    }
    const cb = e.target.closest('[data-city]');
    if (cb) { setLocation({ city: cb.dataset.city, lat: +cb.dataset.lat, lon: +cb.dataset.lon, source: 'manual' }); locMenu.classList.remove('show'); }
  });
  document.addEventListener('click', function (e) { if (!e.target.closest('.loc-wrap')) locMenu.classList.remove('show'); });
  renderLocChip();

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
    profileEl.querySelector('.pf-notify').classList.toggle('on', p.notify);
    profileEl.querySelector('.pf-notify .tg-state').textContent = p.notify ? 'On' : 'Off';
    profileEl.querySelector('.pf-filter').classList.toggle('on', interestFilterActive);
    profileEl.querySelector('.pf-filter .tg-state').textContent = interestFilterActive ? 'On' : 'Off';
    profileEl.querySelector('.pf-filter').style.display = p.plus ? '' : 'none';
    profileEl.querySelector('.pf-plus-btn').textContent = p.plus ? 'Cancel Plus (demo)' : 'Go Plus — $7/mo';
    profileEl.querySelector('.pf-logout').style.display = user ? '' : 'none';
  }
  function refreshProfile() { if (profileEl.classList.contains('open')) renderProfile(); }
  function openProfile() { profileEl.classList.add('open'); renderProfile(); }

  profileEl.querySelector('.pf-close').addEventListener('click', function () { profileEl.classList.remove('open'); });
  profileEl.addEventListener('click', function (e) {
    const chip = e.target.closest('.chip[data-cat]');
    if (chip) { P.toggleInterest(chip.dataset.cat); chip.classList.toggle('on'); refreshMarkers(); renderProfile(); return; }
    const rec = e.target.closest('.pf-rec[data-id]');
    if (rec) {
      const ev = D.getById(rec.dataset.id);
      const c = D.getClusters().find(function (cl) { return cl.eventIds.indexOf(ev.id) > -1; });
      profileEl.classList.remove('open'); globe.flyTo(ev.lat, ev.lon);
      if (c) setTimeout(function () { openPlace(c.id, ev.id); }, 600);
    }
  });
  profileEl.querySelector('.pf-plus-btn').addEventListener('click', function () {
    P.setPlus(!P.get().plus); applyMonetization(); renderProfile(); renderMenuTrigger();
    window.EventuallyToast(P.get().plus ? 'Welcome to Eventually Plus — ads & sponsor reads off (demo).' : 'Eventually Plus cancelled (demo).');
  });
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
    if (P.get().notify) { P.setNotify(false); renderProfile(); window.EventuallyToast('Notifications off.'); return; }
    Notification.requestPermission().then(function (perm) {
      if (perm === 'granted') {
        P.setNotify(true); renderProfile();
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
    const plus = P.get().plus;
    document.body.classList.toggle('has-ad', !plus);
    adbar.style.display = plus ? 'none' : '';
    if (!plus) renderAd();
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
    h += '<button class="dd-item" data-act="types">Event types</button>';
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

  /* ---------- PWA service worker ---------- */
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();

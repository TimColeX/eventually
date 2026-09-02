/* Eventually — Admin app. Static, zero-build. Auth + RLS secured: only profiles
 * with is_admin=true can read analytics or write config (enforced server-side). */
(function () {
  'use strict';
  const cfg = window.EVENTUALLY_ADMIN_CONFIG || {};
  const main = document.getElementById('ad-main');
  const userBox = document.querySelector('.ad-user');
  if (!cfg.supabaseUrl || !window.supabase) { main.innerHTML = '<div class="ad-center">Config / supabase-js missing.</div>'; return; }
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey,
    { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

  const esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m]; }); };
  const redirectTo = function () { return location.origin + location.pathname; };
  let me = null;

  /* ---------------- auth gate ---------------- */
  sb.auth.getSession().then(function (r) { route(r.data.session); });
  sb.auth.onAuthStateChange(function (_e, s) { route(s); });

  function route(session) {
    if (!session) { me = null; userBox.innerHTML = ''; return renderLogin(); }
    me = session.user;
    sb.from('profiles').select('is_admin,name').eq('id', me.id).maybeSingle().then(function (r) {
      const p = r.data;
      userBox.innerHTML = esc((p && p.name) || me.email) + ' <button id="ad-out">Sign out</button>';
      document.getElementById('ad-out').onclick = function () { sb.auth.signOut(); };
      if (p && p.is_admin) renderDashboard(); else renderDenied();
    });
  }

  function renderLogin() {
    main.innerHTML =
      '<div class="ad-login"><span class="ad-dots" style="justify-content:center"><i></i><i></i><i></i></span>' +
      '<h1>Admin sign in</h1><p>Admins only. Same account as the app.</p>' +
      '<button class="ad-btn" id="ad-google">Continue with Google</button>' +
      '<div class="ad-or">or</div>' +
      '<input id="ad-email" type="email" placeholder="you@email.com" />' +
      '<button class="ad-btn ghost" id="ad-magic">Email me a magic link</button></div>';
    document.getElementById('ad-google').onclick = function () {
      sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirectTo() } });
    };
    document.getElementById('ad-magic').onclick = function () {
      const v = document.getElementById('ad-email').value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return alert('Enter a valid email.');
      sb.auth.signInWithOtp({ email: v, options: { emailRedirectTo: redirectTo() } })
        .then(function (r) { alert(r.error ? ('Error: ' + r.error.message) : 'Magic link sent — check your email.'); });
    };
  }

  function renderDenied() {
    main.innerHTML = '<div class="ad-deny"><h2>Not authorized</h2><p class="ad-muted">This account isn\'t an admin. ' +
      'Set <code>is_admin = true</code> on your row in Supabase → Table Editor → profiles, then reload.</p></div>';
  }

  /* ---------------- dashboard ---------------- */
  let tab = 'overview';
  let pendingCount = null;   // events awaiting review — shown as a badge on the Review Events tab
  // Reflect the pending-review count on its tab so unreviewed events are visible from anywhere.
  function setPendingBadge() {
    const b = main.querySelector('.ad-tab[data-tab="review"]');
    if (b) { b.textContent = 'Review Events' + (pendingCount ? ' (' + pendingCount + ')' : ''); b.classList.toggle('ad-tab-alert', pendingCount > 0); }
  }
  function refreshPending() {
    sb.rpc('pending_events').then(function (r) { pendingCount = (r.data || []).length; setPendingBadge(); }).catch(function () {});
  }
  function renderDashboard() {
    // 'Subscriptions' hidden while Eventually Plus is parked ("coming soon"). Browser-voice
    // editor removed — the Host is premium-voice (Fish/ElevenLabs) only.
    main.innerHTML =
      '<div class="ad-tabs">' +
        tabBtn('overview', 'Overview') + tabBtn('review', 'Review Events') +
        tabBtn('affiliate', 'Affiliate') + tabBtn('host', 'AI Host') +
        tabBtn('globe', 'Globe & Display') + tabBtn('publishing', 'Publishing') +
      '</div><div id="ad-body"></div>';
    main.querySelectorAll('.ad-tab').forEach(function (b) {
      b.onclick = function () { tab = b.dataset.tab; renderDashboard(); };
    });
    setPendingBadge();                               // show the cached count immediately
    if (pendingCount === null) refreshPending();     // first load → fetch it once
    const body = document.getElementById('ad-body');
    if (tab === 'overview') renderOverview(body);
    else if (tab === 'review') renderReview(body);
    else if (tab === 'affiliate') renderAffiliate(body);
    else if (tab === 'host') renderHost(body);
    else if (tab === 'publishing') renderPublishing(body);
    else renderGlobe(body);
  }

  /* ---------------- Publishing limits (native events) ----------------
   * Rules live in app_config.config.publishing so they change from here, never in code.
   * Extra capacity is granted per user with a validity window — payment happens offline,
   * so an admin grant IS the fulfilment step. Grants are a ledger, never a counter, so
   * you keep the who/when/why/invoice trail.
   */
  function renderPublishing(body) {
    body.innerHTML = '<div class="ad-center">Loading config…</div>';
    sb.from('app_config').select('config').eq('id', 1).maybeSingle().then(function (r) {
      const c = (r.data && r.data.config) || {};
      const p = c.publishing || {};
      const lim = p.limits || {};
      const num = function (id, label, v, min) {
        return '<div class="ad-field"><label>' + label + '</label><input id="' + id + '" type="number" min="' + (min == null ? 0 : min) + '" value="' + (v == null ? 0 : v) + '"></div>';
      };
      body.innerHTML =
        '<div class="ad-sec"><h2>Publishing limits</h2>' +
        '<p class="ad-hint">How many events a user may publish per rolling window. Enforced by the database on insert, so it cannot be bypassed from the browser. Admins are never limited.</p>' +
        '<label class="ad-toggle"><input type="checkbox" id="pb-on"' + (p.enabled === false ? '' : ' checked') + '> Enforce publishing limits</label>' +
        '<div class="ad-row">' + num('pb-days', 'Rolling window (days)', p.windowDays || 365, 1) +
          '<div class="ad-field"><label>Contact email (shown at the limit)</label><input id="pb-email" value="' + esc(p.contactEmail || 'info@eventually-app.com') + '"></div></div>' +
        '<p class="ad-hint" style="margin:14px 0 4px"><strong>Posts allowed per plan</strong> — use −1 for unlimited.</p>' +
        '<div class="ad-row">' +
          num('pb-free', 'free', lim.free != null ? lim.free : 10, -1) +
          num('pb-partner', 'partner', lim.partner != null ? lim.partner : 25, -1) +
          num('pb-venue', 'venue', lim.venue != null ? lim.venue : 50, -1) +
          num('pb-plus', 'plus', lim.plus != null ? lim.plus : 25, -1) +
        '</div>' +
        '<button class="ad-btn" id="pb-save">Save limits</button> <span id="pb-msg" class="ad-hint"></span></div>' +

        '<div class="ad-sec"><h2>Find a publisher</h2>' +
        '<p class="ad-hint">Look someone up by email to see their usage, change their plan, or grant extra slots after an offline payment.</p>' +
        '<div class="ad-row"><div class="ad-field" style="flex:1"><label>Email or user id</label>' +
          '<input id="pb-q" placeholder="name@example.com"></div>' +
          '<div class="ad-field"><label>&nbsp;</label><button class="ad-btn" id="pb-find">Look up</button></div></div>' +
        '<div id="pb-result"></div></div>';

      document.getElementById('pb-save').onclick = function () {
        const btn = document.getElementById('pb-save'), m = document.getElementById('pb-msg');
        const v = function (id) { return +document.getElementById(id).value; };
        btn.disabled = true;
        patchConfig({ publishing: Object.assign({}, p, {
          enabled: document.getElementById('pb-on').checked,
          windowDays: Math.max(1, v('pb-days') || 365),
          contactEmail: document.getElementById('pb-email').value.trim(),
          limits: { free: v('pb-free'), partner: v('pb-partner'), venue: v('pb-venue'), plus: v('pb-plus') }
        }) }).then(function (rr) {
          btn.disabled = false;
          if (rr && rr.error) { m.textContent = 'Error: ' + rr.error.message; m.style.color = '#b3402a'; return; }
          m.textContent = 'Saved — applies on next app load.'; m.style.color = '';
        });
      };
      document.getElementById('pb-find').onclick = lookupPublisher;
      document.getElementById('pb-q').addEventListener('keydown', function (e) { if (e.key === 'Enter') lookupPublisher(); });
    });
  }

  function lookupPublisher() {
    const q = document.getElementById('pb-q').value.trim();
    const out = document.getElementById('pb-result');
    if (!q) { out.innerHTML = ''; return; }
    out.innerHTML = '<p class="ad-hint">Looking up…</p>';
    sb.rpc('admin_publisher_lookup', { p_q: q }).then(function (r) {
      const d = r && r.data;
      if (!d || !d.found) { out.innerHTML = '<p class="ad-hint">No user found for “' + esc(q) + '”.</p>'; return; }
      const qt = d.quota || {}, plan = qt.plan || 'free';
      const cap = qt.unlimited ? '∞' : qt.capacity;
      const msg = '<span id="pb-msg2" class="ad-hint"></span>';
      out.innerHTML =
        '<p class="ad-hint" style="margin-top:14px"><strong>' + esc(d.email || d.user_id) + '</strong> — ' +
          (qt.used || 0) + ' of ' + cap + ' posts used' +
          (qt.next_slot_at ? ' · next slot frees up ' + esc(qt.next_slot_at) : '') +
          ' · plan <strong>' + esc(plan) + '</strong>' + (qt.extra ? ' (includes +' + qt.extra + ' granted)' : '') + '</p>' +
        '<div class="ad-row"><div class="ad-field"><label>Plan</label><select id="pb-plan">' +
          ['free', 'partner', 'venue', 'plus'].map(function (k) {
            return '<option value="' + k + '"' + (plan === k ? ' selected' : '') + '>' + k + '</option>';
          }).join('') + '</select></div>' +
          '<div class="ad-field"><label>&nbsp;</label><button class="ad-btn" id="pb-plan-save">Set plan</button></div></div>' +
        '<p class="ad-hint" style="margin:16px 0 4px"><strong>Grant extra slots</strong> — for capacity paid for offline. Leave “valid to” blank for no expiry.</p>' +
        '<div class="ad-row">' +
          '<div class="ad-field"><label>Slots</label><input id="pb-slots" type="number" min="1" value="10"></div>' +
          '<div class="ad-field"><label>Valid from</label><input id="pb-from" type="date" value="' + new Date().toISOString().slice(0, 10) + '"></div>' +
          '<div class="ad-field"><label>Valid to</label><input id="pb-to" type="date"></div>' +
          '<div class="ad-field"><label>Invoice / ref</label><input id="pb-ref" placeholder="INV-1042"></div>' +
        '</div>' +
        '<div class="ad-row"><div class="ad-field" style="flex:1"><label>Note</label>' +
          '<input id="pb-note" placeholder="Paid offline — Globe Theatre 2026/27 season"></div></div>' +
        '<button class="ad-btn" id="pb-grant">Grant slots</button> ' + msg +
        '<p class="ad-hint" style="margin:16px 0 4px"><strong>Grant history</strong></p>' + creditRows(d.credits || []) +
        '<p class="ad-hint" style="margin:16px 0 4px"><strong>Recent posts</strong></p>' + postRows(d.recent || []);

      const say = function (t, bad) {
        const m = document.getElementById('pb-msg2');
        if (m) { m.textContent = t; m.style.color = bad ? '#b3402a' : ''; }
      };
      document.getElementById('pb-plan-save').onclick = function () {
        sb.rpc('admin_set_publishing_plan', { p_user: d.user_id, p_plan: document.getElementById('pb-plan').value })
          .then(function (rr) {
            if (rr && rr.error) { say('Error: ' + rr.error.message, true); return; }
            lookupPublisher();
          });
      };
      document.getElementById('pb-grant').onclick = function () {
        const slots = +document.getElementById('pb-slots').value;
        if (!slots || slots < 1) { say('Enter at least 1 slot.', true); return; }
        sb.rpc('admin_grant_slots', {
          p_user: d.user_id, p_slots: slots,
          p_valid_from: document.getElementById('pb-from').value || null,
          p_valid_to: document.getElementById('pb-to').value || null,
          p_note: document.getElementById('pb-note').value || null,
          p_order_ref: document.getElementById('pb-ref').value || null
        }).then(function (rr) {
          if (rr && rr.error) { say('Grant failed: ' + rr.error.message, true); return; }
          lookupPublisher();
        });
      };
      out.querySelectorAll('[data-revoke]').forEach(function (b) {
        b.onclick = function () {
          if (!confirm('Revoke this grant? The slots stop counting immediately.')) return;
          sb.rpc('admin_revoke_slots', { p_id: b.dataset.revoke }).then(function () { lookupPublisher(); });
        };
      });
    }, function (e) { out.innerHTML = '<p class="ad-hint">Lookup failed: ' + esc(String((e && e.message) || e)) + '</p>'; });
  }

  function creditRows(rows) {
    if (!rows.length) return '<p class="ad-hint">No extra slots granted.</p>';
    return '<div class="ad-list">' + rows.map(function (c) {
      const dead = !!c.revoked_at;
      return '<div class="ad-list-row"' + (dead ? ' style="opacity:.5"' : '') + '>' +
        '<div><strong>+' + c.slots + ' slots</strong> ' +
        '<span class="ad-hint">' + esc(c.valid_from || '') + ' → ' + esc(c.valid_to || 'no end') +
        (c.order_ref ? ' · ' + esc(c.order_ref) : '') + (c.note ? ' · ' + esc(c.note) : '') +
        (dead ? ' · REVOKED' : '') + '</span></div>' +
        (dead ? '' : '<button class="ad-btn" data-revoke="' + esc(c.id) + '">Revoke</button>') +
        '</div>';
    }).join('') + '</div>';
  }
  function postRows(rows) {
    if (!rows.length) return '<p class="ad-hint">No events published yet.</p>';
    return '<div class="ad-list">' + rows.map(function (e) {
      return '<div class="ad-list-row"><div><strong>' + esc(e.title || '(untitled)') + '</strong> ' +
        '<span class="ad-hint">' + esc(e.city || '') + ' · posted ' + esc(String(e.created_at || '').slice(0, 10)) +
        ' · ' + esc(e.moderation || 'approved') + (e.published === false ? ' · off globe' : '') + '</span></div></div>';
    }).join('') + '</div>';
  }

  /* ---------------- Review / moderate pending events ---------------- */
  function renderReview(body) {
    body.innerHTML = '<div class="ad-center">Loading pending events…</div>';
    sb.rpc('pending_events').then(function (r) {
      const rows = r.data || [];
      if (r.error) { body.innerHTML = '<div class="ad-center">Could not load (' + esc(r.error.message) + ').</div>'; return; }
      pendingCount = rows.length; setPendingBadge();     // keep the tab badge in sync
      if (!rows.length) { body.innerHTML = '<div class="ad-sec"><h2>Review Events</h2><p class="ad-hint">Nothing pending — all caught up. ✓</p></div>'; return; }
      let html = '<div class="ad-sec"><h2>Pending review (' + rows.length + ')</h2>' +
        '<p class="ad-hint">Events submitted by users wait here for your approval before they appear on the globe. Editing an already-approved event sends it back here for re-review.</p>';
      rows.forEach(function (e) {
        html += '<div class="rv-row" data-id="' + esc(e.event_id) + '">' +
          '<div class="rv-main"><strong>' + esc(e.title) + '</strong>' +
          '<small>' + esc(e.category || '') + ' · ' + esc(e.city || '') + ' · ' + (e.start_time ? new Date(e.start_time).toLocaleDateString() : '') + '</small>' +
          (e.description ? '<p class="rv-desc">' + esc(e.description) + '</p>' : '') + '</div>' +
          '<div class="rv-actions">' +
            '<button class="ad-save rv-approve" data-id="' + esc(e.event_id) + '">Approve</button>' +
            '<button class="an-act an-danger rv-reject" data-id="' + esc(e.event_id) + '">Reject</button>' +
          '</div></div>';
      });
      body.innerHTML = html + '</div>';
      function moderate(id, status, reason) {
        sb.rpc('moderate_event', { p_id: id, p_status: status, p_reason: reason || null }).then(function () { renderReview(body); });
      }
      body.querySelectorAll('.rv-approve').forEach(function (b) { b.onclick = function () { moderate(b.dataset.id, 'approved'); }; });
      body.querySelectorAll('.rv-reject').forEach(function (b) {
        b.onclick = function () { const reason = prompt('Reason for rejection (the creator will see this):', ''); if (reason === null) return; moderate(b.dataset.id, 'rejected', reason); };
      });
    });
  }

  // Merge a partial into app_config.config and save (admin RLS).
  function patchConfig(partial) {
    return sb.from('app_config').select('config').eq('id', 1).maybeSingle().then(function (r) {
      const c = Object.assign({}, (r.data && r.data.config) || {}, partial);
      return sb.from('app_config').update({ config: c, updated_at: new Date().toISOString() }).eq('id', 1);
    });
  }
  function tabBtn(id, label) { return '<button class="ad-tab' + (tab === id ? ' on' : '') + '" data-tab="' + id + '">' + label + '</button>'; }

  /* ---------------- Overview (analytics) ---------------- */
  function renderOverview(body) {
    body.innerHTML = '<div class="ad-center">Loading analytics…</div>';
    sb.rpc('admin_overview').then(function (r) {
      const d = r.data;
      if (!d || d.error) { body.innerHTML = '<div class="ad-center">Could not load analytics (' + esc(d && d.error || (r.error && r.error.message) || 'error') + ').</div>'; return; }
      const kpi = function (v, l) { return '<div class="ad-kpi"><b>' + (v == null ? '—' : v) + '</b><span>' + l + '</span></div>'; };
      const mrr = '$' + ((d.plus || 0) * 7);
      let html = '<div class="ad-grid">' +
        kpi(d.users, 'Users') + kpi(d.plus, 'Plus members') + kpi(mrr, '≈ MRR (Plus×$7)') +
        kpi(d.feature_paid, 'Paid features') +
        kpi(d.signups_7d, 'Signups · 7d') + kpi(d.signups_30d, 'Signups · 30d') +
        kpi(d.active_1d, 'Active · 24h') + kpi(d.active_30d, 'Active · 30d') +
        kpi(d.saves, 'Saves') + kpi(d.likes, 'Likes') + kpi(d.attends, 'Attending') +
        kpi(d.events_total, 'Events') +
      '</div>';
      // content
      html += '<div class="ad-sec"><h2>Content</h2>' +
        '<p class="ad-hint">' + (d.events_native || 0) + ' native · last ingest ' +
        (d.events_last_updated ? new Date(d.events_last_updated).toLocaleString() : '—') + '</p>';
      const cats = d.events_by_category || {};
      const max = Math.max.apply(null, Object.keys(cats).map(function (k) { return cats[k]; }).concat([1]));
      html += '<div class="ad-bars">' + Object.keys(cats).sort(function (a, b) { return cats[b] - cats[a]; }).map(function (k) {
        return '<div class="ad-bar"><span>' + esc(k) + '</span><i style="width:' + (cats[k] / max * 100) + '%"></i><span>' + cats[k] + '</span></div>';
      }).join('') + '</div>';
      const tc = d.top_cities || [];
      if (tc.length) html += '<div class="ad-list" style="margin-top:16px">' + tc.map(function (c) {
        return '<div class="ad-li"><span>' + esc(c.city) + '</span><span>' + c.n + '</span></div>';
      }).join('') + '</div>';
      html += '</div>';
      html += '<div class="ad-sec" id="ad-health"><h2>Event data sources — health</h2><p class="ad-hint">Loading provider status…</p></div>';
      html += '<div class="ad-sec" id="ad-src"><h2>Event sources</h2><p class="ad-hint">Counting per source…</p></div>';
      html += '<div class="ad-sec" id="ad-dq"><h2>Data quality</h2><p class="ad-hint">Checking event coordinates…</p></div>';
      html += '<div class="ad-sec" id="ad-bu"><h2>Daily briefing usage</h2><p class="ad-hint">Counting Claude calls…</p></div>';
      html += '<div class="ad-sec" id="ad-el"><h2>AI Host voice usage</h2><p class="ad-hint">Measuring cache performance…</p></div>';
      body.innerHTML = html;
      renderSyncHealth();
      renderSourceBreakdown();
      renderDataQuality();
      renderBriefingUsage();
      renderAudioUsage();
    });
  }

  // Event-data pipeline health — one card per provider (status dot, last successful sync,
  // last run counts + errors) with a "Sync now" button. Reads admin_sync_health (39_sync_runs).
  function syncRel(ts) {
    if (!ts) return 'never';
    const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
    if (s < 90) return Math.round(s) + 's ago';
    if (s < 5400) return Math.round(s / 60) + ' min ago';
    if (s < 172800) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' d ago';
  }
  function syncDot(status, lastSuccess) {
    const okRecent = lastSuccess && (Date.now() - new Date(lastSuccess).getTime()) < 26 * 3600 * 1000;
    if (!lastSuccess || status === 'failed') return ['🔴', 'Offline'];
    if (status === 'partial') return ['🟡', 'Degraded'];
    if (!okRecent) return ['🟠', 'Stale'];
    return ['🟢', 'Healthy'];
  }
  function renderSyncHealth() {
    const box = document.getElementById('ad-health'); if (!box) return;
    sb.rpc('admin_sync_health').then(function (r) {
      const d = r.data;
      if (!d || d.error) { box.innerHTML = '<h2>Event data sources — health</h2><p class="ad-hint">Unavailable (' + esc((d && d.error) || (r.error && r.error.message) || 'error') + '). Have you run <b>39_sync_runs.sql</b>?</p>'; return; }
      // Providers we've intentionally disabled (redundant / no valid key) are hidden here.
      // (PredictHQ dedups against Ticketmaster → 0 net events, and its trial token expired.)
      const CR_HIDDEN = { predicthq: 1 };
      let h = '<h2>Event data sources — health</h2><p class="ad-hint">Each provider syncs into Supabase; the globe reads only from Supabase, so one provider failing never empties it. “Sync now” pulls fresh events immediately.</p>';
      (d || []).filter(function (p) { return !CR_HIDDEN[p.provider]; }).forEach(function (p) {
        const last = p.last || {}, st = syncDot(last.status, p.last_success);
        h += '<div class="aff-row" style="padding:12px;margin-top:8px;border:1px solid var(--line);border-radius:10px">' +
          '<div style="display:flex;align-items:center;gap:8px"><b style="flex:1">' + st[0] + ' ' + esc(p.provider) + ' — ' + st[1] + '</b>' +
          '<button class="ad-save" style="padding:4px 12px" data-sync="' + esc(p.provider) + '">Sync now</button></div>' +
          '<div class="ad-hint" style="margin-top:6px">Last successful sync: <b>' + syncRel(p.last_success) + '</b>' +
          (last.finished_at ? ' · last run ' + syncRel(last.finished_at) + ' (' + esc(last.status || '?') + ')' : ' · no runs yet') + '</div>' +
          (last.status ? '<div class="ad-hint">Fetched ' + (last.fetched || 0) + ' · upserted ' + (last.upserted || 0) + ' · removed ' + (last.removed || 0) + ' · countries ' + (last.countries_ok || 0) + '✓/' + (last.countries_failed || 0) + '✗' + (last.duration_ms ? ' · ' + Math.round(last.duration_ms / 1000) + 's' : '') + '</div>' : '') +
          (last.error_message ? '<div class="ad-hint" style="color:#b3402a">Last error: ' + esc(last.error_message) + '</div>' : '') +
          '<span class="ad-saved" id="sync-msg-' + esc(p.provider) + '"></span></div>';
      });
      box.innerHTML = h;
      box.querySelectorAll('[data-sync]').forEach(function (btn) { btn.onclick = function () { triggerSync(btn.getAttribute('data-sync'), btn); }; });
    }).catch(function () { box.innerHTML = '<h2>Event data sources — health</h2><p class="ad-hint">Unavailable.</p>'; });
  }
  function triggerSync(provider, btn) {
    const fn = provider === 'predicthq' ? 'ingest-predicthq' : 'ingest-ticketmaster';
    const msg = document.getElementById('sync-msg-' + provider);
    btn.disabled = true; if (msg) { msg.textContent = 'Syncing ' + provider + '… (up to a minute)'; msg.style.color = ''; }
    sb.functions.invoke(fn, { body: {} }).then(function (r) {
      btn.disabled = false;
      const d = r.data || {};
      if (r.error || d.error) { if (msg) { msg.textContent = 'Failed: ' + ((r.error && r.error.message) || d.error); msg.style.color = '#b3402a'; } return; }
      const fetched = d.fetched != null ? d.fetched : (d.kept || 0);
      const up = d.upEvents != null ? d.upEvents : (d.upserted || 0);
      if (msg) { msg.textContent = 'Done · ' + (d.status || 'ok') + ' · fetched ' + fetched + ' · upserted ' + up; msg.style.color = '#3a7d44'; }
      renderSyncHealth();
    }).catch(function (e) { btn.disabled = false; if (msg) { msg.textContent = 'Failed: ' + String(e); msg.style.color = '#b3402a'; } });
  }

  // ElevenLabs cache performance + spend, by category. Proves the caching is working:
  // a high hit % means we rarely pay ElevenLabs. Chars ≈ credits for eleven_multilingual_v2.
  const EL_COST_PER_1K = 0.30;   // ≈ $ per 1,000 characters (adjust to your ElevenLabs plan)
  function renderAudioUsage() {
    const box = document.getElementById('ad-el');
    if (!box) return;
    sb.rpc('admin_audio_usage', { p_days: 30 }).then(function (r) {
      const d = r.data;
      if (!d || (r.error && r.error.message)) {
        box.innerHTML = '<h2>AI Host voice usage</h2><p class="ad-hint">Unavailable (' +
          esc((r.error && r.error.message) || 'run backend/32_audio_usage.sql') + ').</p>';
        return;
      }
      const money = function (chars) { const v = (chars / 1000) * EL_COST_PER_1K; return '≈ $' + v.toFixed(v < 1 ? 3 : 2); };
      const kpi = function (v, l) { return '<div class="ad-kpi"><b>' + v + '</b><span>' + l + '</span></div>'; };
      const perUser = d.plus_users ? Math.round(d.chars / d.plus_users) : 0;
      const cats = d.by_category || {};
      let catRows = Object.keys(cats).map(function (k) {
        var c = cats[k];
        return '<div class="ad-li"><span><b>' + esc(k) + '</b></span><span>' + (c.requests || 0) + ' req · ' +
          (c.misses || 0) + ' synth · ' + (c.chars || 0).toLocaleString() + ' chars</span></div>';
      }).join('') || '<div class="ad-li"><span class="ad-hint">No requests yet.</span></div>';
      var reused = (d.top_reused || []).map(function (t) {
        return '<div class="ad-li"><span>' + esc(t.scope || '—') + '</span><span>' + t.hits + ' reuse</span></div>';
      }).join('') || '<div class="ad-li"><span class="ad-hint">—</span></div>';
      box.innerHTML = '<h2>AI Host voice usage · last ' + (d.window_days || 30) + ' days</h2>' +
        '<p class="ad-hint">Each request either hits the cache (no ElevenLabs call) or synthesizes. A high hit % = the caching is preventing spend. Characters ≈ ElevenLabs credits; edit EL_COST_PER_1K in admin.js for your plan.</p>' +
        '<div class="ad-grid">' +
          kpi((d.hit_pct != null ? d.hit_pct : 0) + '%', 'Cache hit rate') +
          kpi((d.misses || 0).toLocaleString(), 'ElevenLabs calls (synths)') +
          kpi((d.hits || 0).toLocaleString(), 'Cache hits (free)') +
          kpi((d.chars || 0).toLocaleString(), 'Chars synthesized') +
          kpi(money(d.chars || 0), 'Est. spend') +
          kpi((d.chars_saved || 0).toLocaleString(), 'Chars saved by cache') +
          kpi((d.plus_users || 0), 'Plus listeners') +
          kpi(perUser.toLocaleString(), 'Chars / listener') +
        '</div>' +
        '<div class="ad-field" style="margin-top:14px"><label>By category</label><div class="ad-list">' + catRows + '</div></div>' +
        '<div class="ad-field" style="margin-top:10px"><label>Most reused (cache hits by area)</label><div class="ad-list">' + reused + '</div></div>';
    }).catch(function () { box.innerHTML = '<h2>AI Host voice usage</h2><p class="ad-hint">Unavailable.</p>'; });
  }

  // Per-source breakdown (live). Dynamic — any new source appears automatically.
  const SRC_LABELS = { ticketmaster: 'Ticketmaster', predicthq: 'PredictHQ', native: 'Eventually', meetup: 'Meetup', eventbrite: 'Eventbrite', seatgeek: 'SeatGeek' };
  function renderSourceBreakdown() {
    const box = document.getElementById('ad-src');
    if (!box) return;
    sb.rpc('admin_source_breakdown').then(function (r) {
      const d = r.data;
      if (!d || (r.error && r.error.message)) {
        box.innerHTML = '<h2>Event sources</h2><p class="ad-hint">Unavailable (' +
          esc((r.error && r.error.message) || 'run backend/27_source_breakdown.sql') + ').</p>';
        return;
      }
      const srcs = d.sources || [];
      const max = Math.max.apply(null, srcs.map(function (s) { return s.share || 0; }).concat([1]));
      const nm = function (k) { return SRC_LABELS[k] || (k ? k.charAt(0).toUpperCase() + k.slice(1) : '—'); };
      let h = '<h2>Event sources</h2>' +
        '<p class="ad-hint">Where the ' + (d.total_events || 0).toLocaleString() + ' events on the globe come from. ' +
        '“events” counts each event once (its primary source); “listings” counts every source an event appears on. New sources appear here automatically.</p>' +
        '<div class="ad-bars">' + srcs.map(function (s) {
          return '<div class="ad-bar"><span>' + esc(nm(s.source)) + '</span>' +
            '<i style="width:' + ((s.share || 0) / max * 100) + '%"></i>' +
            '<span>' + (s.primary_events || 0).toLocaleString() + ' events · ' +
            (s.listings || 0).toLocaleString() + ' listings · ' + (s.share || 0) + '%</span></div>';
        }).join('') + '</div>' +
        '<div class="ad-grid" style="margin-top:12px">' +
          '<div class="ad-kpi"><b>' + (d.multi_source || 0).toLocaleString() + '</b><span>On 2+ sources</span></div>' +
        '</div>';
      box.innerHTML = h;
    }).catch(function () { box.innerHTML = '<h2>Event sources</h2><p class="ad-hint">Unavailable.</p>'; });
  }

  // Daily-briefing spend at a glance: each daily_briefings row = one Claude call
  // (one cluster cell generated that day, shared by everyone there). Cost is an
  // estimate for Claude Haiku 4.5 at ~150 words per briefing.
  const BRIEFING_COST_PER_CALL = 0.0015;   // ≈ $ (Haiku 4.5: ~500 in + ~180 out tokens)
  function renderBriefingUsage() {
    const box = document.getElementById('ad-bu');
    if (!box) return;
    const today = todayStr();
    const wa = new Date(); wa.setDate(wa.getDate() - 6);
    const weekAgo = wa.getFullYear() + '-' + String(wa.getMonth() + 1).padStart(2, '0') + '-' + String(wa.getDate()).padStart(2, '0');
    const cnt = function (q) { return q.then(function (r) { return (r && r.count) || 0; }); };
    Promise.all([
      cnt(sb.from('daily_briefings').select('scope', { count: 'exact', head: true }).eq('day', today)),
      cnt(sb.from('daily_briefings').select('scope', { count: 'exact', head: true }).gte('day', weekAgo)),
      cnt(sb.from('daily_briefings').select('scope', { count: 'exact', head: true }))
    ]).then(function (res) {
      const tday = res[0], wk = res[1], total = res[2];
      const money = function (n) { const v = n * BRIEFING_COST_PER_CALL; return '≈ $' + v.toFixed(v < 1 ? 3 : 2); };
      const kpi = function (v, l) { return '<div class="ad-kpi"><b>' + v + '</b><span>' + l + '</span></div>'; };
      box.innerHTML = '<h2>Daily briefing usage</h2>' +
        '<p class="ad-hint">Each Claude call generates one briefing for a cluster cell that day, shared by everyone there — so this is the whole free-briefing spend. Cost is estimated for Claude Haiku 4.5 (~150-word briefings); check your Anthropic Console for exact billing.</p>' +
        '<div class="ad-grid">' +
        kpi(tday, 'Claude calls · today') + kpi(money(tday), 'Est. cost · today') +
        kpi(wk, 'Calls · last 7 days') + kpi(money(wk), 'Est. cost · 7 days') +
        kpi(total, 'Cached briefings (total)') +
        '</div>';
    }).catch(function () {
      box.innerHTML = '<h2>Daily briefing usage</h2><p class="ad-hint">Unavailable (run backend/21_daily_briefing.sql).</p>';
    });
  }

  // Coordinate sanity: flags the "spike under Africa" class of bug (events at
  // (0,0), plotted outside their country, or missing a country) automatically.
  function renderDataQuality() {
    const box = document.getElementById('ad-dq');
    if (!box) return;
    sb.rpc('admin_data_quality').then(function (r) {
      const d = r.data;
      if (!d || (r.error && r.error.message)) {
        box.innerHTML = '<h2>Data quality</h2><p class="ad-hint">Unavailable (' +
          esc((r.error && r.error.message) || 'run backend/19_data_quality.sql') + ').</p>';
        return;
      }
      const bad = (d.null_island || 0) + (d.out_of_country || 0);
      const kpi = function (v, l, warn) { return '<div class="ad-kpi' + (warn && v ? ' ad-kpi-warn' : '') + '"><b>' + (v == null ? '—' : v) + '</b><span>' + l + '</span></div>'; };
      let h = '<h2>Data quality' + (bad ? ' ⚠️' : ' ✅') + '</h2>' +
        '<p class="ad-hint">Coordinate sanity across all ' + (d.total || 0) + ' events · checked ' +
        (d.checked_at ? new Date(d.checked_at).toLocaleString() : 'now') + '</p>' +
        '<div class="ad-grid">' +
        kpi(d.null_island, 'At (0,0) · Null Island', true) +
        kpi(d.out_of_country, 'Outside stated country', true) +
        kpi(d.missing_country, 'Missing country', false) +
        '</div>';
      const s = d.samples || [];
      if (s.length) {
        h += '<div class="ad-list" style="margin-top:12px">' + s.slice(0, 30).map(function (e) {
          return '<div class="ad-li"><span>' + esc(e.status) + ' · ' + esc(e.city || '—') + ' (' + esc(e.country || '?') +
            ')</span><span>' + Number(e.lat).toFixed(2) + ', ' + Number(e.lon).toFixed(2) + '</span></div>';
        }).join('') + '</div>';
      } else {
        h += '<p class="ad-hint">No coordinate anomalies found. 🎉</p>';
      }
      box.innerHTML = h;
    });
  }

  /* ---------------- AI Host Script ---------------- */
  let dbCfg = {};      // app_config.config.dailyBriefing
  let vbCfg = {};      // app_config.config.voiceBudget (daily generation ceiling)
  let dbRows = [];     // recent daily_briefings (cache view)
  let dbSponsors = []; // briefing_sponsors rows
  let aiCfg = {};      // app_config.config.aiHost (two-host / provider / host profiles)
  function renderHost(body) {
    body.innerHTML = '<div class="ad-center">Loading script…</div>';
    Promise.all([
      sb.from('app_config').select('config').eq('id', 1).maybeSingle(),
      sb.from('daily_briefings').select('scope,day,text,generated_at').order('generated_at', { ascending: false }).limit(20),
      sb.from('briefing_sponsors').select('*').order('scope')
    ]).then(function (res) {
      dbCfg = (res[0].data && res[0].data.config && res[0].data.config.dailyBriefing) || {};
      vbCfg = (res[0].data && res[0].data.config && res[0].data.config.voiceBudget) || {};
      aiCfg = (res[0].data && res[0].data.config && res[0].data.config.aiHost) || {};
      dbRows = res[1].data || [];
      dbSponsors = (res[2] && res[2].data) || [];
      drawHost(body);
    });
  }
  // The old fill-in-the-blank template editor (host_script) is retired — Claude now
  // authors BOTH tiers, so everything lives in the one "AI Host briefing" section.
  function drawHost(body) {
    body.innerHTML = aiHostManagerHTML() + dailySectionHTML() + cityRadioHTML();
    const $ = function (id) { return document.getElementById(id); };
    bindAiHostManager($);
    bindDailySection($, body);
    bindCityRadio($);
  }

  /* -------- AI Host Manager: pluggable voice providers + host voices --------
   * PROVIDER REGISTRY — the ONE place voice platforms are declared. To add a new one:
   *   1. add an entry here (id, label, note; whether it has a model dropdown / speed+temp);
   *   2. add a synth adapter for that `id` in backend/31_briefing.ts (synthBytes) — the
   *      per-provider voice ids are already stored generically in host.voiceIds[id];
   *   3. it then appears in the "Voice provider" dropdown automatically, with its own fields. */
  const PROVIDERS = [
    { id: 'fish', label: 'Fish Audio', note: 'native two-voice · cheapest (~$0.015/briefing)', model: true, speedTemp: true,
      models: [['s2.1-pro-free', 's2.1-pro-free (free — works now)'], ['s2.1-pro', 's2.1-pro (needs API credit)'], ['s2-pro', 's2-pro (needs API credit)']] },
    { id: 'elevenlabs', label: 'ElevenLabs', note: 'two voices stitched · higher cost', model: false, speedTemp: false },
    { id: 'easyvoice', label: 'EasyVoice', note: 'Kokoro-82M · stitched · $9.99/mo unlimited (free key = 5k chars/day to test)', model: false, speedTemp: false }
  ];
  function providerVoiceId(h, prov) {
    if (h && h.voiceIds && h.voiceIds[prov]) return h.voiceIds[prov];
    if (prov === 'fish') return h.fishVoiceId || h.voiceId || '';
    if (prov === 'elevenlabs') return h.elVoiceId || '';
    return '';
  }
  function hostFields(n, h) {
    h = h || {};
    // Recommended default voice IDs per provider (a free Kokoro pair for EasyVoice so the
    // user can Test immediately) — used only when no id is already saved.
    const seeds = { fish: (n === 1 ? '536d3a5e000945adb7038665781a4aca' : '933563129e564b19a115bedd57b7406a'),
                    easyvoice: (n === 1 ? 'af_aoede' : 'am_michael') };
    // One voice-ID field per provider; only the active provider's is shown (toggled live).
    const voiceFields = PROVIDERS.map(function (p) {
      const val = providerVoiceId(h, p.id) || seeds[p.id] || '';
      return '<div class="ad-field ai-provfield" data-prov="' + p.id + '"><label>' + esc(p.label) + ' voice ID</label>' +
        '<input id="ai-h' + n + '-vid-' + p.id + '" value="' + esc(val) + '" placeholder="' + esc(p.label) + ' voice / reference id"></div>';
    }).join('');
    return '<div class="ad-sec aff-row" style="padding:14px"><h3 class="ad-sub">Host ' + n + '</h3>' +
      '<label class="ad-toggle"><input type="checkbox" id="ai-h' + n + '-en"' + (h.enabled === false ? '' : ' checked') + '> Enabled</label>' +
      '<div class="ad-row">' +
        '<div class="ad-field"><label>Name</label><input id="ai-h' + n + '-name" value="' + esc(h.name || (n === 1 ? 'Ethan' : 'Sarah')) + '"></div>' +
        '<div class="ad-field"><label>Role</label><input id="ai-h' + n + '-role" value="' + esc(h.role || (n === 1 ? 'Primary host' : 'Co-host')) + '"></div>' +
      '</div>' +
      '<div class="ad-row">' + voiceFields + '</div>' +
      '<div class="ad-field"><label>Personality / speaking style</label><textarea id="ai-h' + n + '-pers">' + esc(h.personality || '') + '</textarea></div>' +
      '<div><button class="ad-save" id="ai-h' + n + '-play" type="button">▶ Test Host ' + n + ' voice</button>' +
        '<audio id="ai-h' + n + '-audio" controls style="width:100%;display:none;margin-top:6px"></audio>' +
        '<span class="ad-saved" id="ai-h' + n + '-msg"></span></div></div>';
  }
  function aiHostManagerHTML() {
    const prov = aiCfg.provider || 'fish';
    const mode = aiCfg.hostMode === 'two' ? 'two' : 'single';
    const model = aiCfg.model || 's2.1-pro-free';
    const vs = aiCfg.voiceSettings || {};
    const opt = function (v, c, label) { return '<option value="' + v + '"' + (c === v ? ' selected' : '') + '>' + label + '</option>'; };
    const provOpts = PROVIDERS.map(function (p) { return opt(p.id, prov, p.label + ' — ' + p.note); }).join('');
    // Per-provider model dropdowns (only providers that have one) — each toggled by provider.
    const modelBlocks = PROVIDERS.filter(function (p) { return p.model; }).map(function (p) {
      return '<div class="ad-field ai-provfield" data-prov="' + p.id + '"><label>' + esc(p.label) + ' model</label><select id="ai-model-' + p.id + '">' +
        p.models.map(function (m) { return opt(m[0], model, m[1]); }).join('') + '</select></div>';
    }).join('');
    // Speed/temp rows (only providers that support prosody tuning) — toggled by provider.
    const speedTemp = PROVIDERS.filter(function (p) { return p.speedTemp; }).map(function (p) {
      return '<div class="ad-row ai-provfield" data-prov="' + p.id + '">' +
        '<div class="ad-field"><label>' + esc(p.label) + ' voice speed (0.5–2.0)</label><input id="ai-speed" type="number" step="0.05" min="0.5" max="2" value="' + (vs.speed != null ? vs.speed : 1.1) + '"></div>' +
        '<div class="ad-field"><label>' + esc(p.label) + ' expressiveness / temp (0–1)</label><input id="ai-temp" type="number" step="0.05" min="0" max="1" value="' + (vs.temperature != null ? vs.temperature : 0.8) + '"></div>' +
        '<div class="ad-field"><p class="ad-hint" style="margin:0">Higher speed = snappier; higher temp = more expressive.</p></div></div>';
    }).join('');
    return '<div class="ad-sec"><h2>AI Host Manager</h2>' +
      '<p class="ad-hint">Pick a <b>voice provider</b> and <b>one or two hosts</b> — only the active provider\'s settings show. Two-host is a real conversation on any provider. ' +
      'Set the active provider\'s voice ID for each host, <b>test before switching live</b>, then Save. Changes apply to briefings generated after Save.</p>' +
      '<div class="ad-row">' +
        '<div class="ad-field"><label>Voice provider</label><select id="ai-provider">' + provOpts + '</select></div>' +
        '<div class="ad-field"><label>Hosts</label><select id="ai-mode2">' + opt('two', mode, 'Two hosts (conversation)') + opt('single', mode, 'Single host') + '</select></div>' +
        modelBlocks +
      '</div>' +
      speedTemp +
      '<div class="ad-row">' +
        '<div class="ad-field"><label>Target length (seconds)</label><input id="ai-secs" type="number" min="20" max="180" value="' + (aiCfg.maxSeconds || 70) + '"></div>' +
        '<div class="ad-field"><label>Max events per briefing</label><input id="ai-events" type="number" min="2" max="10" value="' + (aiCfg.maxEvents || 6) + '"></div>' +
        '<div class="ad-field"><label>Look-ahead (days)</label><input id="ai-days" type="number" min="1" max="90" value="' + (aiCfg.daysAhead || 30) + '"><div class="ad-hint" style="margin:2px 0 0">How far ahead the hosts mention events. Beyond this, a city plays cached filler.</div></div>' +
        '<div class="ad-field"><label>Tone (optional)</label><input id="ai-tone" value="' + esc(aiCfg.tone || '') + '" placeholder="e.g. warm, upbeat, local"></div>' +
      '</div>' +
      hostFields(1, aiCfg.host1) + hostFields(2, aiCfg.host2) +
      '<div class="ad-sec aff-row" style="padding:14px"><h3 class="ad-sub">Test the conversation (uses the selected provider + both voices)</h3>' +
        '<p class="ad-hint">Enter a sample dialogue as "Host 1: …" / "Host 2: …". Generates a real clip with the currently-selected provider.</p>' +
        '<div class="ad-field"><textarea id="ai-conv" style="min-height:90px">Host 1: What have you found happening around town this weekend?\nHost 2: There are quite a few events — I found a family festival on Saturday.\nHost 1: That sounds fun. What’s on there?\nHost 2: Live music, food vendors and activities for the kids.</textarea></div>' +
        '<button class="ad-save" id="ai-conv-play" type="button">▶ Test Conversation</button>' +
        '<audio id="ai-conv-audio" controls style="width:100%;display:none;margin-top:8px"></audio>' +
        '<span class="ad-saved" id="ai-conv-msg"></span></div>' +
      '<div style="margin-top:12px"><button class="ad-save" id="ai-save">Save AI Host settings</button><span class="ad-saved" id="ai-msg"></span></div></div>';
  }
  // Call the briefing function with the admin's session (sb.functions.invoke passes the JWT).
  function invokeBriefing(bodyObj) {
    return sb.functions.invoke('briefing', { body: bodyObj }).then(function (r) {
      if (r.error) return { error: r.error.message || 'error' };
      return r.data || {};
    }).catch(function (e) { return { error: String(e) }; });
  }
  // Play an array of {url} segments back-to-back in one <audio> (ElevenLabs conversations
  // return one clip per turn; Fish returns one).
  function playSegments(au, segs) {
    if (!segs || !segs.length) { return; }
    let i = 0; au.style.display = '';
    au.onended = function () { if (i < segs.length) { au.src = segs[i++].url; au.play().catch(function () {}); } };
    au.src = segs[i++].url; au.play().catch(function () {});
  }

  /* -------- City radio (cached AI filler segments per city) --------
   * When a city has no more events, the hosts play these CACHED segments with music
   * between. Generated once per city (AI), reused forever; regen only when edited here.
   * All CRUD goes through the briefing Edge Function's admin-gated `city_admin` modes. */
  const CR_ORDER = ['intro', 'history', 'culture', 'events', 'outro'];
  function cityRadioHTML() {
    return '<div class="ad-sec"><h2>City radio (filler)</h2>' +
      '<p class="ad-hint">When a city runs out of events, the hosts play these <b>cached</b> segments — facts, history, culture and typical events — with music between, so the station never falls silent. Generated once per city by AI and reused forever (no per-play voice cost). Edit any script and <b>Save</b> to re-voice it, or <b>Regenerate</b> to have the AI rewrite the whole city.</p>' +
      '<div class="ad-row">' +
        '<div class="ad-field" style="flex:2"><label>Generate or open a city</label><input id="cr-city" placeholder="e.g. Toronto"></div>' +
        '<div class="ad-field" style="align-self:flex-end"><button class="ad-save" id="cr-gen" type="button">Generate / open</button></div>' +
      '</div>' +
      '<div class="ad-saved" id="cr-msg"></div>' +
      '<div class="ad-field"><label>Cities with content</label><div class="ad-list" id="cr-list">Loading…</div></div>' +
      '<div id="cr-editor" style="display:none;margin-top:14px;border-top:1px solid var(--line);padding-top:14px">' +
        '<h3 class="ad-sub">Editing: <span id="cr-editing"></span></h3>' +
        '<div id="cr-segs"></div>' +
        '<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">' +
          '<button class="ad-save" id="cr-save" type="button">Save &amp; re-voice</button>' +
          '<button class="ad-save" id="cr-regen" type="button">Regenerate (AI)</button>' +
          '<button class="ad-save" id="cr-play" type="button">▶ Preview</button>' +
          '<button class="ad-save ad-danger" id="cr-del" type="button">Delete city</button>' +
        '</div>' +
        '<audio id="cr-audio" controls style="width:100%;display:none;margin-top:8px"></audio>' +
        '<div class="ad-saved" id="cr-emsg"></div>' +
      '</div></div>';
  }
  function crSegFields(segs) {
    const byType = {}; (segs || []).forEach(function (s) { byType[s.seg_type] = s; });
    return CR_ORDER.map(function (t) {
      const s = byType[t] || {};
      return '<div class="ad-field"><label>' + t + ' — host ' + ((s.speaker || 0) + 1) + ' · ' + (s.source || 'ai') + '</label>' +
        '<textarea id="cr-seg-' + t + '" rows="2">' + esc(s.script || '') + '</textarea></div>';
    }).join('');
  }
  function bindCityRadio($) {
    let editing = null;
    const setMsg = function (id, t, ok) { const m = $(id); if (m) { m.textContent = t || ''; m.style.color = t ? (ok ? '#3a7d44' : '#b3402a') : ''; } };
    function loadList() {
      invokeBriefing({ city_admin: 'list' }).then(function (d) {
        const el = $('cr-list'); if (!el) return;
        if (d.error) { el.innerHTML = '<span class="ad-hint">' + esc(d.error) + '</span>'; return; }
        const cities = (d && d.cities) || [];
        if (!cities.length) { el.innerHTML = '<span class="ad-hint">No cities yet — generate one above, or they appear automatically as users explore quiet cities.</span>'; return; }
        el.innerHTML = cities.map(function (c) {
          return '<div style="display:flex;align-items:center;gap:8px;padding:4px 0"><b style="flex:1">' + esc(c.city_key) + '</b>' +
            '<span class="ad-hint">' + c.segments + ' segs · ' + esc(c.source) + '</span>' +
            '<button class="ad-save" style="padding:3px 10px" data-open="' + esc(c.city_key) + '">Edit</button></div>';
        }).join('');
        el.querySelectorAll('[data-open]').forEach(function (b) { b.onclick = function () { openCity(b.getAttribute('data-open')); }; });
      });
    }
    function openCity(city) {
      setMsg('cr-msg', 'Loading ' + city + '…');
      invokeBriefing({ city_admin: 'get', city: city }).then(function (d) {
        if (d.error) { setMsg('cr-msg', d.error); return; }
        setMsg('cr-msg', ''); editing = d.city;
        $('cr-editing').textContent = editing;
        $('cr-segs').innerHTML = crSegFields(d.segments);
        $('cr-editor').style.display = ''; $('cr-audio').style.display = 'none'; setMsg('cr-emsg', '');
      });
    }
    if ($('cr-gen')) $('cr-gen').onclick = function () {
      const city = ($('cr-city').value || '').trim(); if (!city) { setMsg('cr-msg', 'Enter a city name.'); return; }
      const btn = $('cr-gen'); btn.disabled = true; setMsg('cr-msg', 'Generating ' + city + ' (first time ~20s)…');
      invokeBriefing({ city_admin: 'generate', city: city }).then(function (d) {
        btn.disabled = false;
        if (d.error || !d.ok) { setMsg('cr-msg', 'Failed: ' + (d.error || 'no content generated')); return; }
        setMsg('cr-msg', 'Ready ✓', true); loadList(); openCity(d.city);
      });
    };
    if ($('cr-save')) $('cr-save').onclick = function () {
      if (!editing) return;
      const segments = CR_ORDER.map(function (t) { const ta = $('cr-seg-' + t); return ta ? { seg_type: t, script: ta.value } : null; }).filter(Boolean);
      const btn = $('cr-save'); btn.disabled = true; setMsg('cr-emsg', 'Saving…');
      invokeBriefing({ city_admin: 'save', city: editing, segments: segments }).then(function (d) {
        btn.disabled = false;
        if (d.error) { setMsg('cr-emsg', d.error); return; }
        setMsg('cr-emsg', 'Saved ✓ — will re-voice on next play', true); loadList();
      });
    };
    if ($('cr-regen')) $('cr-regen').onclick = function () {
      if (!editing || !confirm('Regenerate ' + editing + ' with AI? This replaces the current scripts.')) return;
      const btn = $('cr-regen'); btn.disabled = true; setMsg('cr-emsg', 'Regenerating (~20s)…');
      invokeBriefing({ city_admin: 'delete', city: editing })
        .then(function () { return invokeBriefing({ city_admin: 'generate', city: editing }); })
        .then(function (d) {
          btn.disabled = false;
          if (d.error || !d.ok) { setMsg('cr-emsg', 'Failed: ' + (d.error || 'no content')); return; }
          setMsg('cr-emsg', 'Regenerated ✓', true); openCity(editing); loadList();
        });
    };
    if ($('cr-play')) $('cr-play').onclick = function () {
      if (!editing) return;
      setMsg('cr-emsg', 'Loading audio…');
      invokeBriefing({ city_admin: 'generate', city: editing }).then(function (d) {
        if (d.error || !(d.segments && d.segments.length)) { setMsg('cr-emsg', 'No audio'); return; }
        setMsg('cr-emsg', '', true); playSegments($('cr-audio'), d.segments);
      });
    };
    if ($('cr-del')) $('cr-del').onclick = function () {
      if (!editing || !confirm('Delete all radio content for ' + editing + '?')) return;
      invokeBriefing({ city_admin: 'delete', city: editing }).then(function () {
        $('cr-editor').style.display = 'none'; editing = null; setMsg('cr-msg', 'Deleted ✓', true); loadList();
      });
    };
    loadList();
  }
  function bindAiHostManager($) {
    const providerOf = function () { return ($('ai-provider') && $('ai-provider').value) || 'fish'; };
    const provModel = function () { const el = $('ai-model-' + providerOf()); return el ? el.value : (aiCfg.model || 's2.1-pro-free'); };
    const provSpeed = function () { const el = $('ai-speed'); return el ? parseFloat(el.value) : (aiCfg.voiceSettings && aiCfg.voiceSettings.speed) || 1.1; };
    const provTemp = function () { const el = $('ai-temp'); return el ? parseFloat(el.value) : (aiCfg.voiceSettings && aiCfg.voiceSettings.temperature) || 0.8; };
    const hostVid = function (n) { const el = $('ai-h' + n + '-vid-' + providerOf()); return el ? el.value.trim() : ''; };
    // Show ONLY the active provider's settings (model / speed+temp / per-host voice ID fields).
    function applyProviderVisibility() {
      const prov = providerOf();
      document.querySelectorAll('.ai-provfield').forEach(function (el) { el.style.display = (el.dataset.prov === prov) ? '' : 'none'; });
    }
    if ($('ai-provider')) $('ai-provider').onchange = applyProviderVisibility;
    applyProviderVisibility();
    function testHost(n) {
      const prov = providerOf(), vid = hostVid(n);
      const btn = $('ai-h' + n + '-play'), msg = $('ai-h' + n + '-msg'), au = $('ai-h' + n + '-audio');
      if (!vid) { msg.textContent = 'Set a ' + prov + ' voice ID first.'; msg.style.color = '#b3402a'; return; }
      btn.disabled = true; msg.textContent = 'Generating (' + prov + ')…'; msg.style.color = '';
      invokeBriefing({ test_voice: true, provider: prov, reference_id: vid, model: provModel(), speed: provSpeed(), temperature: provTemp(), text: $('ai-h' + n + '-name').value + ' here — welcome to Eventually. Here\'s what\'s happening around you this weekend.' }).then(function (d) {
        btn.disabled = false;
        if (d.error || !d.url) { msg.textContent = 'Failed: ' + (d.error || 'no audio'); msg.style.color = '#b3402a'; return; }
        au.src = d.url; au.style.display = ''; au.play().catch(function () {});
        msg.textContent = 'OK · ' + prov + ' · ' + (d.textBytes || 0) + ' bytes'; msg.style.color = '#3a7d44';
      });
    }
    if ($('ai-h1-play')) $('ai-h1-play').onclick = function () { testHost(1); };
    if ($('ai-h2-play')) $('ai-h2-play').onclick = function () { testHost(2); };
    if ($('ai-conv-play')) $('ai-conv-play').onclick = function () {
      const prov = providerOf(), ids = [hostVid(1), hostVid(2)];
      const btn = $('ai-conv-play'), msg = $('ai-conv-msg'), au = $('ai-conv-audio');
      if (!ids[0] || !ids[1]) { msg.textContent = 'Set both ' + prov + ' voice IDs first.'; msg.style.color = '#b3402a'; return; }
      btn.disabled = true; msg.textContent = 'Generating conversation (' + prov + ')…'; msg.style.color = '';
      invokeBriefing({ test_conversation: true, provider: prov, reference_id: ids, model: provModel(), speed: provSpeed(), temperature: provTemp(), text: $('ai-conv').value }).then(function (d) {
        btn.disabled = false;
        if (d.error || !(d.segments && d.segments.length)) { msg.textContent = 'Failed: ' + (d.error || 'no audio'); msg.style.color = '#b3402a'; return; }
        playSegments(au, d.segments);
        msg.textContent = 'OK · ' + prov + ' · ' + d.segments.length + ' clip(s) · ' + (d.textBytes || 0) + ' bytes'; msg.style.color = '#3a7d44';
      });
    };
    if ($('ai-save')) $('ai-save').onclick = function () {
      const provider = providerOf();
      const hostMode = ($('ai-mode2') && $('ai-mode2').value === 'two') ? 'two' : 'single';
      // Build each host's per-provider voice map from ALL provider fields (they're all rendered,
      // just hidden) so switching providers never loses another provider's voice IDs.
      function host(n) {
        const cur = (n === 1 ? aiCfg.host1 : aiCfg.host2) || {};
        const voiceIds = Object.assign({}, cur.voiceIds || {});
        PROVIDERS.forEach(function (p) { const el = $('ai-h' + n + '-vid-' + p.id); if (el) voiceIds[p.id] = el.value.trim(); });
        return { name: $('ai-h' + n + '-name').value.trim(), role: $('ai-h' + n + '-role').value.trim(), personality: $('ai-h' + n + '-pers').value.trim(),
          enabled: $('ai-h' + n + '-en').checked, voiceIds: voiceIds,
          fishVoiceId: voiceIds.fish || '', elVoiceId: voiceIds.elevenlabs || '' };   // legacy mirror (back-compat)
      }
      const patch = { aiHost: { provider: provider, hostMode: hostMode, model: provModel(), maxSeconds: parseInt($('ai-secs').value, 10) || 70, maxEvents: parseInt($('ai-events').value, 10) || 6, daysAhead: Math.min(90, Math.max(1, parseInt($('ai-days').value, 10) || 30)), tone: $('ai-tone').value.trim(),
        voiceSettings: { speed: provSpeed() || 1.1, temperature: provTemp() || 0.8 }, host1: host(1), host2: host(2) } };
      const btn = $('ai-save'); btn.disabled = true;
      patchConfig(patch).then(function (r) {
        btn.disabled = false;
        const m = $('ai-msg');
        if (r && r.error) { m.textContent = 'Error: ' + r.error.message; m.style.color = '#b3402a'; return; }
        aiCfg = patch.aiHost;
        const plabel = (PROVIDERS.find(function (p) { return p.id === provider; }) || {}).label || provider;
        m.textContent = 'Saved ✓ — ' + (hostMode === 'two' ? 'Two-Host' : 'Single-Host') + ' (' + plabel + ') LIVE for all users'; m.style.color = '#3a7d44';
      });
    };
  }

  /* -------- Daily briefing (AI) — free device-voice, admin-controlled -------- */
  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function dailySectionHTML() {
    const enabled = dbCfg.enabled !== false;
    let rows = dbRows.map(function (r) {
      const prev = (r.text || '').slice(0, 70);
      return '<div class="ad-li"><span>' + esc(r.scope) + ' · ' + esc(String(r.day)) + ' — ' + esc(prev) + '…</span>' +
        '<button class="ad-regen" data-scope="' + esc(r.scope) + '" data-day="' + esc(String(r.day)) + '">Regenerate</button></div>';
    }).join('');
    if (!rows) rows = '<div class="ad-li"><span class="ad-hint">No briefings cached yet.</span></div>';

    // Sponsors manager (Phase 2): worldwide + city-targeted, appended verbatim.
    let sponRows = dbSponsors.map(function (s) {
      const prev = (s.message || '').slice(0, 60);
      const win = (s.active_from || s.active_to) ? (' · ' + (s.active_from || '…') + '→' + (s.active_to || '…')) : '';
      return '<div class="ad-li"><span>' + (s.enabled === false ? '⏸ ' : '') + '<b>' + esc(s.scope) + '</b> · w' + (s.weight || 1) + win +
        ' — ' + esc(prev) + '…</span><span>' +
        '<button class="ad-regen ad-spon-tog" data-id="' + esc(s.id) + '" data-en="' + (s.enabled === false ? '0' : '1') + '">' + (s.enabled === false ? 'Enable' : 'Disable') + '</button> ' +
        '<button class="ad-regen ad-spon-del" data-id="' + esc(s.id) + '">Delete</button></span></div>';
    }).join('');
    if (!sponRows) sponRows = '<div class="ad-li"><span class="ad-hint">No sponsors yet.</span></div>';
    const sponsors =
      '<div class="ad-field" style="margin-top:20px"><label>Sponsors (' + dbSponsors.length + ') — FREE tier only, verbatim; worldwide + city-targeted</label>' +
      '<p class="ad-hint">Paid sponsors play on the <b>free</b> tier only (Plus is ad-free). Scope <b>world</b> plays everywhere; a city name (e.g. <b>toronto</b>) plays only there. One worldwide + one city sponsor per briefing, rotated by weight. Verbatim — not written by Claude, edits apply instantly (no regeneration). For a message on BOTH tiers, use the Announcement above.</p>' +
      '<div class="ad-list" id="db-spon-list">' + sponRows + '</div>' +
      '<div class="ad-row" style="margin-top:10px">' +
        '<div class="ad-field"><label>Scope</label><input id="db-spon-scope" placeholder="world   or   toronto"></div>' +
        '<div class="ad-field"><label>Weight</label><input id="db-spon-weight" type="number" min="1" value="1"></div></div>' +
      '<div class="ad-field"><label>Message (read aloud verbatim)</label><textarea id="db-spon-msg" placeholder="e.g. This briefing is brought to you by Acme Coffee — grab a cup on King Street."></textarea></div>' +
      '<div class="ad-row"><div class="ad-field"><label>Active from (optional)</label><input id="db-spon-from" type="date"></div>' +
        '<div class="ad-field"><label>Active to (optional)</label><input id="db-spon-to" type="date"></div></div>' +
      '<div><button class="ad-save" id="db-spon-add">Add sponsor</button><span class="ad-saved" id="db-spon-ok"></span></div></div>';

    return '<div class="ad-sec"><h2>Briefing content &amp; controls</h2>' +
      '<p class="ad-hint">Claude authors the AI Host briefing per area (the two-host conversation, or the single-host script). Toggle it on/off, add a global announcement, cap daily generations, and manage sponsors. The hosts, voices and provider are set in <b>AI Host Manager</b> above. Changes apply to briefings generated after you save.</p>' +
      '<label class="ad-toggle"><input type="checkbox" id="db-en"' + (enabled ? ' checked' : '') + '> AI Host briefing enabled</label>' +
      '<div class="ad-field"><label>Global announcement (read to everyone, verbatim)</label>' +
      '<textarea id="db-ann">' + esc(dbCfg.announcement || '') + '</textarea></div>' +
      '<div class="ad-field"><label>Daily voice-generation ceiling (0 = unlimited)</label>' +
      '<input id="db-budget" type="number" min="0" step="1" value="' + (vbCfg.maxDailyGenerations != null ? vbCfg.maxDailyGenerations : 0) + '">' +
      '<div class="ad-hint" id="db-ceiling">' + budgetCeilingText(vbCfg.maxDailyGenerations != null ? vbCfg.maxDailyGenerations : 0) + '</div>' +
      '<p class="ad-hint">Hard platform-wide cap on <b>new</b> briefing generations per day. ' +
      'Cached audio is always served and never counts, so listeners in already-generated areas are unaffected. ' +
      'Once the cap is hit, new areas get a short cached clip instead.</p></div>' +
      '<div><button class="ad-save" id="db-save">Save briefing settings</button><span class="ad-saved" id="db-msg"></span></div>' +
      sponsors +
      '<div class="ad-field" style="margin-top:16px"><label>Cached briefings (' + dbRows.length + ')</label>' +
      '<div class="ad-list" id="db-list">' + rows + '</div>' +
      '<div style="margin-top:8px"><button class="ad-save ad-danger" id="db-clear">Clear today’s briefings</button></div></div></div>';
  }
  // Live "estimated monthly ceiling" for the daily cap, priced on the ACTIVE provider
  // and the configured briefing length. Fish ≈ $0.015/1k chars; ElevenLabs ≈ $0.15/1k.
  // Speech ≈ 15 chars/sec, so chars ≈ maxSeconds × 15. Real spend is well below this
  // ceiling (cache hits + empty areas cost nothing) — it's the worst case if EVERY
  // capped generation were a fresh full briefing.
  function budgetCeilingText(n) {
    const prov = aiCfg.provider || 'fish';
    const chars = Math.round((parseInt(aiCfg.maxSeconds, 10) || 70) * 15);
    if (!n || n <= 0) {
      return '<b>Unlimited</b> — no hard cap on new generations per day. Cost/usage tracks how many populated areas are opened per day; empty areas and cache hits are free. Enter a number to cap it.';
    }
    if (prov === 'easyvoice') {
      // EasyVoice is FLAT-RATE ($9.99/mo Pro), so the risk isn't a surprise bill — it's the
      // 10M chars/month fair-use cap. Frame the ceiling as % of that cap, not $.
      const moChars = n * chars * 30, cap = 10000000, pct = Math.round((moChars / cap) * 100);
      return 'Active voice: <b>EasyVoice</b> (flat <b>$9.99/mo</b> Pro, 10M chars/mo fair-use). At ~' + chars + ' chars/briefing, ' + n + '/day ≈ <b>' + moChars.toLocaleString() + ' chars/month</b> worst-case (~' + pct + '% of the fair-use cap). Real usage is far lower — cache hits + empty areas are free.';
    }
    const provider = prov === 'elevenlabs' ? 'ElevenLabs' : 'Fish';
    const price = provider === 'ElevenLabs' ? 0.15 : 0.015;   // $ per 1,000 chars
    const per = (chars / 1000) * price;                       // $ per new full briefing
    const day = n * per, mo = Math.round(day * 30);
    return 'Active voice: <b>' + provider + '</b> (~' + chars + ' chars/briefing at ~$' + price.toFixed(3) + '/1k). Worst-case ceiling: <b>$' + day.toFixed(2) + '/day</b> · <b>$' + mo.toLocaleString() + '/month</b>. Real spend is usually far lower (cache hits + empty areas cost nothing).';
  }
  function bindDailySection($, body) {
    const budget = $('db-budget'), ceil = $('db-ceiling');
    if (budget && ceil) budget.oninput = function () { ceil.innerHTML = budgetCeilingText(Math.max(0, parseInt(budget.value, 10) || 0)); };
    const save = $('db-save');
    if (save) save.onclick = function () {
      // persona/premiumPersona no longer edited here (two-host uses the conversation
      // prompt); preserve any existing saved values so single-host tuning isn't lost.
      const patch = { dailyBriefing: { enabled: $('db-en').checked, persona: (dbCfg.persona || ''), premiumPersona: (dbCfg.premiumPersona || ''), announcement: $('db-ann').value } };
      if ($('db-budget')) patch.voiceBudget = { maxDailyGenerations: Math.max(0, parseInt($('db-budget').value, 10) || 0) };
      save.disabled = true;
      patchConfig(patch).then(function (r) {
        save.disabled = false;
        const m = $('db-msg');
        if (r && r.error) { m.textContent = 'Error: ' + r.error.message; m.style.color = '#b3402a'; return; }
        dbCfg = patch.dailyBriefing;
        if (patch.voiceBudget) vbCfg = patch.voiceBudget;
        m.textContent = 'Saved ✓'; m.style.color = '#3a7d44';
      });
    };
    const clear = $('db-clear');
    if (clear) clear.onclick = function () {
      if (!confirm('Clear all of today’s cached briefings? They’ll regenerate on the next listen.')) return;
      sb.rpc('admin_clear_daily_briefings', { p_scope: null, p_day: todayStr() }).then(function () { renderHost(body); });
    };
    const list = $('db-list');
    if (list) list.addEventListener('click', function (e) {
      const b = e.target.closest('.ad-regen'); if (!b) return;
      sb.rpc('admin_clear_daily_briefings', { p_scope: b.dataset.scope, p_day: b.dataset.day }).then(function () {
        const row = b.closest('.ad-li'); if (row) row.remove();
      });
    });
    // Sponsors: add / toggle / delete.
    const addS = $('db-spon-add');
    if (addS) addS.onclick = function () {
      const scope = ($('db-spon-scope').value || '').trim().toLowerCase();
      const message = ($('db-spon-msg').value || '').trim();
      const ok = $('db-spon-ok');
      if (!scope || !message) { ok.textContent = 'Scope + message required'; ok.style.color = '#b3402a'; return; }
      const row = {
        scope: scope, message: message,
        weight: Math.max(1, parseInt($('db-spon-weight').value, 10) || 1),
        active_from: $('db-spon-from').value || null, active_to: $('db-spon-to').value || null, enabled: true
      };
      addS.disabled = true;
      sb.from('briefing_sponsors').insert(row).then(function (r) {
        addS.disabled = false;
        if (r.error) { ok.textContent = 'Error: ' + r.error.message; ok.style.color = '#b3402a'; return; }
        renderHost(body);
      });
    };
    const sList = $('db-spon-list');
    if (sList) sList.addEventListener('click', function (e) {
      const del = e.target.closest('.ad-spon-del');
      const tog = e.target.closest('.ad-spon-tog');
      if (del) {
        if (!confirm('Delete this sponsor?')) return;
        sb.from('briefing_sponsors').delete().eq('id', del.dataset.id).then(function () { renderHost(body); });
      } else if (tog) {
        sb.from('briefing_sponsors').update({ enabled: tog.dataset.en === '0' }).eq('id', tog.dataset.id).then(function () { renderHost(body); });
      }
    });
  }


  /* ---------------- Subscriptions & Free Trial ---------------- */
  // datetime-local <-> ISO helpers for the campaign window fields.
  function toLocalInput(iso) {
    if (!iso) return '';
    const d = new Date(iso); if (isNaN(d.getTime())) return '';
    const p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function fromLocalInput(v) { if (!v) return null; const d = new Date(v); return isNaN(d.getTime()) ? null : d.toISOString(); }

  function renderSubscriptions(body) {
    body.innerHTML = '<div class="ad-center">Loading subscriptions…</div>';
    Promise.all([
      sb.rpc('admin_subscriptions'),
      sb.from('app_config').select('config').eq('id', 1).maybeSingle()
    ]).then(function (res) {
      const m = (res[0] && res[0].data) || null;
      const merr = res[0] && res[0].error;
      const cfg = (res[1].data && res[1].data.config) || {};
      const t = cfg.trial || {};
      const price = (cfg.plus && cfg.plus.priceMonthly != null) ? cfg.plus.priceMonthly : 7;

      // --- metrics ---
      let html = '<div class="ad-sec"><h2>Subscription metrics</h2>';
      if (merr || !m || m.error) {
        html += '<p class="ad-hint">Unavailable' +
          (m && m.error ? ' (' + esc(m.error) + ')' : merr ? ' (' + esc(merr.message) + ')' : '') +
          ' — run <code>backend/33_subscriptions.sql</code>, then reload.</p>';
      } else {
        const kpi = function (v, l) { return '<div class="ad-kpi"><b>' + esc(String(v == null ? '—' : v)) + '</b><span>' + esc(l) + '</span></div>'; };
        html += '<div class="ad-grid">' +
          kpi(m.plus_active, 'Active Plus') + kpi(m.trials_active, 'Active trials') +
          kpi(m.trials_started, 'Trials started') + kpi(m.converted, 'Converted') +
          kpi((m.conversion_rate || 0) + '%', 'Conversion rate') + kpi(m.canceling, 'Canceling') +
          kpi(m.trial_expired, 'Trials expired') + kpi(m.expired, 'Plus expired') +
          kpi('$' + (m.mrr_estimate || 0), '≈ MRR') +
          '</div>' +
          '<p class="ad-hint">Conversion = converted ÷ trials started. No-card trials don\'t convert until paid billing is wired, so this reads 0% for now. MRR ≈ active Plus × $' + esc(String(price)) + '/mo.</p>';
      }
      html += '</div>';

      // --- trial policy editor ---
      html += '<div class="ad-sec"><h2>Free trial settings</h2>' +
        '<p class="ad-hint">Tune the Eventually Plus free trial with no code change — duration, availability, promotional window and messaging. Applies to new trials on next app load.</p>' +
        '<label class="ad-toggle"><input type="checkbox" id="tr-enabled"' + (t.enabled !== false ? ' checked' : '') + '> Free trials enabled</label>' +
        '<div class="ad-row">' +
          '<div class="ad-field"><label>Trial length (days)</label><input id="tr-days" type="number" min="0" step="1" value="' + (t.days != null ? t.days : 3) + '"></div>' +
          '<div class="ad-field"><label>Reminder lead (hours before end)</label><input id="tr-remind" type="number" min="0" step="1" value="' + (t.remindHoursBefore != null ? t.remindHoursBefore : 24) + '"></div>' +
          '<div class="ad-field"><label>Plus price ($/mo · for MRR)</label><input id="tr-price" type="number" min="0" step="0.01" value="' + esc(String(price)) + '"></div>' +
        '</div>' +
        '<label class="ad-toggle"><input type="checkbox" id="tr-full"' + (t.fullAccess !== false ? ' checked' : '') + '> Grant full Plus access during trial</label>' +
        '<label class="ad-toggle"><input type="checkbox" id="tr-pay"' + (t.requirePayment ? ' checked' : '') + '> Require payment details before trial <span class="ad-muted">— needs a live payment provider; leave OFF for the no-card trial</span></label>' +
        '<div class="ad-row">' +
          '<div class="ad-field"><label>Campaign start <span class="ad-muted">(optional)</span></label><input id="tr-start" type="datetime-local" value="' + esc(toLocalInput(t.startAt)) + '"></div>' +
          '<div class="ad-field"><label>Campaign end <span class="ad-muted">(optional)</span></label><input id="tr-end" type="datetime-local" value="' + esc(toLocalInput(t.endAt)) + '"></div>' +
        '</div>' +
        '<div class="ad-field"><label>Trial message shown to users</label><textarea id="tr-txt">' + esc(t.message || '') + '</textarea></div>' +
        '<div><button class="ad-save" id="tr-save">Save trial settings</button><span class="ad-saved" id="tr-saved"></span></div></div>';

      body.innerHTML = html;

      const saveBtn = document.getElementById('tr-save');
      if (saveBtn) saveBtn.onclick = function () {
        const trial = {
          enabled:           document.getElementById('tr-enabled').checked,
          days:              Math.max(0, parseInt(document.getElementById('tr-days').value, 10) || 0),
          remindHoursBefore: Math.max(0, parseInt(document.getElementById('tr-remind').value, 10) || 0),
          fullAccess:        document.getElementById('tr-full').checked,
          requirePayment:    document.getElementById('tr-pay').checked,
          startAt:           fromLocalInput(document.getElementById('tr-start').value),
          endAt:             fromLocalInput(document.getElementById('tr-end').value),
          message:           document.getElementById('tr-txt').value
        };
        const plus = { priceMonthly: parseFloat(document.getElementById('tr-price').value) || 0 };
        saveBtn.disabled = true;
        patchConfig({ trial: trial, plus: plus }).then(function (r) {
          saveBtn.disabled = false;
          const el = document.getElementById('tr-saved');
          if (r.error) { el.textContent = 'Error: ' + r.error.message; el.style.color = '#b3402a'; }
          else { el.textContent = 'Saved ✓'; el.style.color = '#3a7d44'; }
        });
      };
    });
  }

  /* ---------------- Affiliate Providers + outbound-click analytics ---------------- */
  function renderAffiliate(body) {
    body.innerHTML = '<div class="ad-center">Loading affiliate providers…</div>';
    Promise.all([
      sb.rpc('admin_ticket_clicks', { p_days: 30 }),
      sb.from('app_config').select('config').eq('id', 1).maybeSingle()
    ]).then(function (res) {
      const m = (res[0] && res[0].data) || null;
      const merr = res[0] && res[0].error;
      const cfg = (res[1].data && res[1].data.config) || {};
      const providers = cfg.affiliateProviders || {};

      // --- outbound click analytics ---
      let html = '<div class="ad-sec"><h2>Outbound ticket clicks · last 30 days</h2>';
      if (merr || !m || m.error) {
        html += '<p class="ad-hint">Unavailable' + (m && m.error ? ' (' + esc(m.error) + ')' : '') +
          ' — run <code>backend/35_affiliate_redirect.sql</code> + deploy the <code>go</code> function, then reload.</p>';
      } else {
        const kpi = function (v, l) { return '<div class="ad-kpi"><b>' + esc(String(v == null ? '—' : v)) + '</b><span>' + esc(l) + '</span></div>'; };
        const pct = m.total ? Math.round((m.affiliate / m.total) * 100) : 0;
        html += '<div class="ad-grid">' +
          kpi(m.total, 'Total clicks') + kpi(m.affiliate, 'Via affiliate') +
          kpi(pct + '%', 'Affiliate share') + kpi(m.signed_in, 'Signed-in clicks') +
          '</div>';
        if ((m.by_provider || []).length) {
          html += '<h3 class="ad-sub">By provider</h3><table class="ad-table"><tr><th>Provider</th><th>Clicks</th><th>Affiliate</th></tr>' +
            m.by_provider.map(function (p) { return '<tr><td>' + esc(p.provider || '—') + '</td><td>' + p.clicks + '</td><td>' + p.affiliate + '</td></tr>'; }).join('') + '</table>';
        }
        if ((m.by_country || []).length) {
          html += '<h3 class="ad-sub">By country</h3><table class="ad-table"><tr><th>Country</th><th>Clicks</th></tr>' +
            m.by_country.map(function (c) { return '<tr><td>' + esc(c.country) + '</td><td>' + c.clicks + '</td></tr>'; }).join('') + '</table>';
        }
      }
      html += '</div>';

      // --- provider manager ---
      html += '<div class="ad-sec"><h2>Affiliate providers</h2>' +
        '<p class="ad-hint">The <code>go</code> redirect applies these at click time — add/change/remove affiliate programs with no re-ingest and no code change. ' +
        'Pattern placeholders: <code>{url}</code> = URL-encoded ticket link, <code>{raw}</code> = raw link. Leave the pattern blank (or disable) to send users straight to the provider.</p>' +
        '<div id="aff-list"></div>' +
        '<button class="ad-save" id="aff-add" type="button" style="margin-top:8px">+ Add provider</button>' +
        '<div style="margin-top:12px"><button class="ad-save" id="aff-save">Save providers</button><span class="ad-saved" id="aff-msg"></span></div></div>';

      body.innerHTML = html;

      const list = document.getElementById('aff-list');
      // Mirrors the `go` function EXACTLY (supabase/functions/go): no {url}/{raw} placeholder
      // → the pattern can't be applied and the user goes straight to the ticket link.
      function applyPattern(pattern, url) {
        if (!pattern || (pattern.indexOf('{url}') === -1 && pattern.indexOf('{raw}') === -1)) return null;
        return pattern.replace(/\{url\}/g, encodeURIComponent(url)).replace(/\{raw\}/g, url);
      }
      function row(key, p) {
        p = p || {};
        const d = document.createElement('div');
        d.className = 'ad-sec aff-row'; d.style.padding = '14px';
        d.innerHTML =
          '<div class="ad-row">' +
            '<div class="ad-field"><label>Provider key</label><input class="aff-key" value="' + esc(key) + '" placeholder="e.g. ticketmaster"></div>' +
            '<div class="ad-field"><label>Display name</label><input class="aff-name" value="' + esc(p.name || '') + '" placeholder="Ticketmaster"></div>' +
            '<div class="ad-field"><label>Status</label><input class="aff-status" value="' + esc(p.status || '') + '" placeholder="e.g. Live / Pending"></div>' +
          '</div>' +
          '<div class="ad-field"><label>Affiliate URL pattern</label><input class="aff-pattern" value="' + esc(p.urlPattern || '') + '" placeholder="https://track.net/deep?url={url}&aid=123"></div>' +
          '<div class="ad-field"><label>Notes</label><input class="aff-notes" value="' + esc(p.notes || '') + '" placeholder="Network, account id, terms…"></div>' +
          '<div class="ad-field"><label>Test the pattern <span class="ad-muted">— paste a sample ticket link, then Test</span></label>' +
            '<div class="ad-row" style="align-items:flex-end;gap:8px">' +
              '<input class="aff-sample" style="flex:1;min-width:200px" value="https://www.ticketmaster.com/event/1A00612345" placeholder="https://…/event/123">' +
              '<button class="ad-save aff-test" type="button">Test →</button>' +
            '</div>' +
            '<div class="aff-test-out"></div>' +
          '</div>' +
          '<label class="ad-toggle"><input type="checkbox" class="aff-enabled"' + (p.enabled ? ' checked' : '') + '> Enabled</label> ' +
          '<button class="an-act an-danger aff-del" type="button">Remove</button>';
        d.querySelector('.aff-del').onclick = function () { d.remove(); };
        d.querySelector('.aff-test').onclick = function () {
          const pattern = d.querySelector('.aff-pattern').value.trim();
          const sample = d.querySelector('.aff-sample').value.trim();
          const enabled = d.querySelector('.aff-enabled').checked;
          const out = d.querySelector('.aff-test-out');
          if (!sample) { out.className = 'aff-test-out is-warn'; out.textContent = 'Enter a sample ticket link first.'; return; }
          const applied = applyPattern(pattern, sample);
          if (applied === null) {
            out.className = 'aff-test-out is-plain';
            out.innerHTML = 'No affiliate pattern applied — the user goes straight to:<br><b>' + esc(sample) + '</b>';
          } else {
            out.className = 'aff-test-out is-ok';
            out.innerHTML = 'Redirects to:<br><b>' + esc(applied) + '</b>' +
              (enabled ? '' : '<br><span class="is-warn">⚠ This provider is disabled — live clicks currently skip the pattern.</span>');
          }
        };
        list.appendChild(d);
      }
      Object.keys(providers).forEach(function (k) { row(k, providers[k]); });
      if (!Object.keys(providers).length) row('', {});
      document.getElementById('aff-add').onclick = function () { row('', {}); };

      document.getElementById('aff-save').onclick = function () {
        const out = {};
        list.querySelectorAll('.aff-row').forEach(function (d) {
          const key = d.querySelector('.aff-key').value.trim().toLowerCase();
          if (!key) return;
          out[key] = {
            name:       d.querySelector('.aff-name').value.trim() || key,
            enabled:    d.querySelector('.aff-enabled').checked,
            urlPattern: d.querySelector('.aff-pattern').value.trim(),
            notes:      d.querySelector('.aff-notes').value.trim(),
            status:     d.querySelector('.aff-status').value.trim()
          };
        });
        const btn = document.getElementById('aff-save'); btn.disabled = true;
        patchConfig({ affiliateProviders: out }).then(function (r) {
          btn.disabled = false;
          const el = document.getElementById('aff-msg');
          if (r.error) { el.textContent = 'Error: ' + r.error.message; el.style.color = '#b3402a'; }
          else { el.textContent = 'Saved ✓'; el.style.color = '#3a7d44'; }
        });
      };
    });
  }

  /* ---------------- Globe & Display config ---------------- */
  function renderGlobe(body) {
    body.innerHTML = '<div class="ad-center">Loading config…</div>';
    sb.from('app_config').select('config').eq('id', 1).maybeSingle().then(function (r) {
      const c = (r.data && r.data.config) || {};
      const sp = c.spikes || { priority: 18, fair: 15, sponsored: 12 };
      const pins = c.pinnedLocations || [];
      const hidC = (c.hiddenCities || []).join('\n');
      const hidE = (c.hiddenEvents || []).join('\n');
      body.innerHTML =
        '<div class="ad-sec"><h2>Globe &amp; display</h2>' +
        '<p class="ad-hint">Controls the live globe and platform toggles. Applies on next app load.</p>' +
        '<div class="ad-row">' +
        field('cf-pri', 'Priority spikes', sp.priority) + field('cf-fair', 'Continent-fair spikes', sp.fair) + field('cf-spon', 'Sponsored spikes', sp.sponsored) +
        '</div>' +
        '<div class="ad-row"><div class="ad-field"><label>Globe time window (days)</label><input id="cf-win" type="number" min="1" max="365" value="' + (c.windowDays || 60) + '"><div class="ad-hint" style="margin:2px 0 0">How far ahead an event can be and still appear on the globe. Higher = more markers/spikes (up to your event data).</div></div>' +
        '<div class="ad-field"><label>Max events loaded (globe cap)</label><input id="cf-max" type="number" min="500" max="10000" step="100" value="' + (c.globeMaxEvents || 3000) + '"><div class="ad-hint" style="margin:2px 0 0">Events fetched per visit, spread fairly across the world. Events published on Eventually are ALWAYS included and never count against this. Raising it increases Supabase egress on every visit (~275&nbsp;KB per 1,000 events).</div></div></div>' +
        '<label class="ad-toggle"><input type="checkbox" id="cf-ads"' + (c.adsEnabled === false ? '' : ' checked') + '> Show ads (non-Plus)</label>' +
        '<label class="ad-toggle"><input type="checkbox" id="cf-host"' + (c.hostEnabled === false ? '' : ' checked') + '> AI Host enabled</label></div>' +

        '<div class="ad-sec"><h2>Pinned locations</h2>' +
        '<p class="ad-hint">These cities always show a spike on the globe, with the chosen style. Use the city name as it appears in events.</p>' +
        '<div id="pin-list"></div>' +
        '<button class="ad-save" id="pin-add" type="button" style="margin-top:6px">+ Add city</button></div>' +

        '<div class="ad-sec"><h2>Hide from the globe &amp; search</h2>' +
        '<div class="ad-field"><label>Hidden cities (one per line)</label><textarea id="cf-hidc">' + esc(hidC) + '</textarea></div>' +
        '<div class="ad-field"><label>Hidden event IDs (one per line, e.g. tm_… or nat_…)</label><textarea id="cf-hide">' + esc(hidE) + '</textarea></div></div>' +

        '<div class="ad-sec"><h2>Event feeds (iCal / RSS)</h2>' +
        '<p class="ad-hint">Grow your OWN inventory for free. Paste a public <b>.ics</b> (iCal) or <b>RSS</b> feed URL from a venue, university, tourism board, library or community calendar. Set the feed’s default <b>city + coordinates</b> (used when an event has no built-in location) and a category. Events flow onto the globe like any other source. Click <b>Save all</b>, then <b>Sync feeds now</b>. iCal feeds work best.</p>' +
        '<div id="feed-list"></div>' +
        '<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">' +
          '<button class="ad-save" id="feed-add" type="button">+ Add feed</button>' +
          '<button class="ad-save" id="feed-sync" type="button">⟳ Sync feeds now</button>' +
          '<span class="ad-saved" id="feed-msg"></span>' +
        '</div></div>' +

        '<div><button class="ad-save" id="cf-save">Save all</button><span class="ad-saved" id="cf-msg"></span></div>';

      // pinned rows
      const list = document.getElementById('pin-list');
      function pinRow(p) {
        const row = document.createElement('div'); row.className = 'ad-row pin-row';
        row.innerHTML = '<div class="ad-field"><input class="pin-city" placeholder="City (e.g. Toronto)" value="' + esc(p.city || '') + '"></div>' +
          '<div class="ad-field"><select class="pin-type">' +
          ['priority', 'sponsored', 'editor'].map(function (t) { return '<option value="' + t + '"' + (p.type === t ? ' selected' : '') + '>' + (t === 'editor' ? "Editor's Choice" : t.charAt(0).toUpperCase() + t.slice(1)) + '</option>'; }).join('') +
          '</select></div><button class="ad-chip pin-del" type="button" style="align-self:center">remove</button>';
        row.querySelector('.pin-del').onclick = function () { row.remove(); };
        list.appendChild(row);
      }
      (pins.length ? pins : []).forEach(pinRow);
      document.getElementById('pin-add').onclick = function () { pinRow({ city: '', type: 'priority' }); };

      // ---- Event feeds (iCal / RSS) ----
      const FEED_CATS = ['Music', 'Tech', 'Business', 'Arts', 'Food & Drink', 'Sports', 'Film & Media', 'Community', 'Nightlife', 'Comedy'];
      const feedList = document.getElementById('feed-list');
      function feedRow(f) {
        f = f || {};
        const row = document.createElement('div');
        row.className = 'feed-row'; row.style.cssText = 'border:1px solid var(--line);border-radius:8px;padding:8px;margin-top:8px';
        row.innerHTML =
          '<div class="ad-field"><input class="fd-url" placeholder="Feed URL (.ics or RSS)" value="' + esc(f.url || '') + '"></div>' +
          '<div class="ad-row">' +
            '<div class="ad-field"><input class="fd-name" placeholder="Source name (e.g. Regina Library)" value="' + esc(f.name || '') + '"></div>' +
            '<div class="ad-field"><input class="fd-city" placeholder="City" value="' + esc(f.city || '') + '"></div>' +
          '</div>' +
          '<div class="ad-row">' +
            '<div class="ad-field"><input class="fd-lat" type="number" step="0.0001" placeholder="Default latitude" value="' + (f.lat != null ? f.lat : '') + '"></div>' +
            '<div class="ad-field"><input class="fd-lon" type="number" step="0.0001" placeholder="Default longitude" value="' + (f.lon != null ? f.lon : '') + '"></div>' +
            '<div class="ad-field"><select class="fd-cat">' + FEED_CATS.map(function (c2) { return '<option value="' + c2 + '"' + (f.category === c2 ? ' selected' : '') + '>' + c2 + '</option>'; }).join('') + '</select></div>' +
          '</div>' +
          '<button class="ad-chip fd-del" type="button">remove</button>';
        row.querySelector('.fd-del').onclick = function () { row.remove(); };
        feedList.appendChild(row);
      }
      ((c.eventFeeds && c.eventFeeds.length) ? c.eventFeeds : []).forEach(feedRow);
      document.getElementById('feed-add').onclick = function () { feedRow({}); };
      function collectFeeds() {
        const feeds = [];
        feedList.querySelectorAll('.feed-row').forEach(function (row) {
          const url = row.querySelector('.fd-url').value.trim(); if (!url) return;
          const lat = parseFloat(row.querySelector('.fd-lat').value), lon = parseFloat(row.querySelector('.fd-lon').value);
          feeds.push({ url: url, name: row.querySelector('.fd-name').value.trim(), city: row.querySelector('.fd-city').value.trim(),
            lat: Number.isFinite(lat) ? lat : null, lon: Number.isFinite(lon) ? lon : null, category: row.querySelector('.fd-cat').value });
        });
        return feeds;
      }
      document.getElementById('feed-sync').onclick = function () {
        const feeds = collectFeeds();
        const btn = this, msg = document.getElementById('feed-msg');
        btn.disabled = true; msg.textContent = 'Saving + syncing feeds… (up to a minute)'; msg.style.color = '';
        // Persist feeds (read-modify-write so we never clobber other config), then run the ingest.
        sb.from('app_config').select('config').eq('id', 1).maybeSingle().then(function (rr) {
          const conf = Object.assign({}, (rr.data && rr.data.config) || {}, { eventFeeds: feeds });
          return sb.from('app_config').update({ config: conf, updated_at: new Date().toISOString() }).eq('id', 1);
        }).then(function () {
          return sb.functions.invoke('ingest-feeds', { body: {} });
        }).then(function (r) {
          btn.disabled = false;
          const d = (r && r.data) || {};
          if ((r && r.error) || d.error) { msg.textContent = 'Failed: ' + ((r.error && r.error.message) || d.error); msg.style.color = '#b3402a'; return; }
          msg.textContent = 'Done · ' + (d.status || 'ok') + ' · feeds ' + (d.feedsOk || 0) + '✓/' + (d.feedsFailed || 0) + '✗ · fetched ' + (d.fetched || 0) + ' · upserted ' + (d.upEvents || 0); msg.style.color = '#3a7d44';
        }).catch(function (e) { btn.disabled = false; msg.textContent = 'Failed: ' + String(e); msg.style.color = '#b3402a'; });
      };

      document.getElementById('cf-save').onclick = function () {
        const pinned = [];
        list.querySelectorAll('.pin-row').forEach(function (row) {
          const city = row.querySelector('.pin-city').value.trim();
          if (city) pinned.push({ city: city, type: row.querySelector('.pin-type').value });
        });
        const lines = function (id) { return document.getElementById(id).value.split(/[\n,]+/).map(function (s) { return s.trim(); }).filter(Boolean); };
        const merged = Object.assign({}, c, {
          spikes: { priority: +val('cf-pri'), fair: +val('cf-fair'), sponsored: +val('cf-spon') },
          windowDays: Math.min(365, Math.max(1, +val('cf-win') || 60)),
          globeMaxEvents: Math.min(10000, Math.max(500, +val('cf-max') || 3000)),
          adsEnabled: document.getElementById('cf-ads').checked,
          hostEnabled: document.getElementById('cf-host').checked,
          pinnedLocations: pinned, hiddenCities: lines('cf-hidc'), hiddenEvents: lines('cf-hide'),
          eventFeeds: collectFeeds()
        });
        const btn = document.getElementById('cf-save'); btn.disabled = true;
        sb.from('app_config').update({ config: merged, updated_at: new Date().toISOString() }).eq('id', 1).then(function (r) {
          btn.disabled = false;
          const m = document.getElementById('cf-msg');
          if (r.error) { m.textContent = 'Error: ' + r.error.message; m.style.color = '#b3402a'; }
          else { m.textContent = 'Saved ✓'; m.style.color = '#3a7d44'; }
        });
      };
    });
    function field(id, label, v) { return '<div class="ad-field"><label>' + label + '</label><input id="' + id + '" type="number" min="0" value="' + (v == null ? 0 : v) + '"></div>'; }
    function val(id) { return document.getElementById(id).value; }
  }
})();

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
  function renderDashboard() {
    main.innerHTML =
      '<div class="ad-tabs">' +
        tabBtn('overview', 'Overview') + tabBtn('review', 'Review Events') +
        tabBtn('subs', 'Subscriptions') +
        tabBtn('host', 'AI Host Script') + tabBtn('browser', 'Browser Voice') +
        tabBtn('globe', 'Globe & Display') +
      '</div><div id="ad-body"></div>';
    main.querySelectorAll('.ad-tab').forEach(function (b) {
      b.onclick = function () { tab = b.dataset.tab; renderDashboard(); };
    });
    const body = document.getElementById('ad-body');
    if (tab === 'overview') renderOverview(body);
    else if (tab === 'review') renderReview(body);
    else if (tab === 'subs') renderSubscriptions(body);
    else if (tab === 'host') renderHost(body);
    else if (tab === 'browser') renderBrowser(body);
    else renderGlobe(body);
  }

  /* ---------------- Review / moderate pending events ---------------- */
  function renderReview(body) {
    body.innerHTML = '<div class="ad-center">Loading pending events…</div>';
    sb.rpc('pending_events').then(function (r) {
      const rows = r.data || [];
      if (r.error) { body.innerHTML = '<div class="ad-center">Could not load (' + esc(r.error.message) + ').</div>'; return; }
      if (!rows.length) { body.innerHTML = '<div class="ad-sec"><h2>Review events</h2><p class="ad-hint">Nothing pending — all caught up. ✓</p></div>'; return; }
      let html = '<div class="ad-sec"><h2>Pending review (' + rows.length + ')</h2>' +
        '<p class="ad-hint">Native events wait here until you approve them. Editing an approved event sends it back here.</p>';
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
      html += '<div class="ad-sec" id="ad-src"><h2>Event sources</h2><p class="ad-hint">Counting per source…</p></div>';
      html += '<div class="ad-sec" id="ad-dq"><h2>Data quality</h2><p class="ad-hint">Checking event coordinates…</p></div>';
      html += '<div class="ad-sec" id="ad-bu"><h2>Daily briefing usage</h2><p class="ad-hint">Counting Claude calls…</p></div>';
      html += '<div class="ad-sec" id="ad-el"><h2>ElevenLabs usage (Plus voice)</h2><p class="ad-hint">Measuring cache performance…</p></div>';
      body.innerHTML = html;
      renderSourceBreakdown();
      renderDataQuality();
      renderBriefingUsage();
      renderAudioUsage();
    });
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
        box.innerHTML = '<h2>ElevenLabs usage (Plus voice)</h2><p class="ad-hint">Unavailable (' +
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
      box.innerHTML = '<h2>ElevenLabs usage (Plus voice) · last ' + (d.window_days || 30) + ' days</h2>' +
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
    }).catch(function () { box.innerHTML = '<h2>ElevenLabs usage (Plus voice)</h2><p class="ad-hint">Unavailable.</p>'; });
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
  let dbRows = [];     // recent daily_briefings (cache view)
  let dbSponsors = []; // briefing_sponsors rows
  function renderHost(body) {
    body.innerHTML = '<div class="ad-center">Loading script…</div>';
    Promise.all([
      sb.from('app_config').select('config').eq('id', 1).maybeSingle(),
      sb.from('daily_briefings').select('scope,day,text,generated_at').order('generated_at', { ascending: false }).limit(20),
      sb.from('briefing_sponsors').select('*').order('scope')
    ]).then(function (res) {
      dbCfg = (res[0].data && res[0].data.config && res[0].data.config.dailyBriefing) || {};
      dbRows = res[1].data || [];
      dbSponsors = (res[2] && res[2].data) || [];
      drawHost(body);
    });
  }
  // The old fill-in-the-blank template editor (host_script) is retired — Claude now
  // authors BOTH tiers, so everything lives in the one "AI Host briefing" section.
  function drawHost(body) {
    body.innerHTML = dailySectionHTML();
    const $ = function (id) { return document.getElementById(id); };
    bindDailySection($, body);
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

    return '<div class="ad-sec"><h2>AI Host briefing (Claude) — Free &amp; Plus</h2>' +
      '<p class="ad-hint">One script provider for both tiers: Claude authors the briefing per cluster area. <b>Free</b> is spoken by the phone’s own voice; <b>Plus</b> is the same idea, longer &amp; richer, in the ElevenLabs premium voice. Steer both here — changes apply to briefings generated after you save.</p>' +
      '<label class="ad-toggle"><input type="checkbox" id="db-en"' + (enabled ? ' checked' : '') + '> Enabled (both tiers)</label>' +
      '<div class="ad-field"><label>Free persona / tone (system prompt — blank = built-in ~120-word default)</label>' +
      '<textarea id="db-persona" placeholder="e.g. You are the Eventually radio host — warm, upbeat, concise. Write a ~120-word spoken briefing…">' + esc(dbCfg.persona || '') + '</textarea></div>' +
      '<div class="ad-field"><label>Plus premium persona (blank = built-in ~250-word default)</label>' +
      '<textarea id="db-premium" placeholder="e.g. You are the Eventually premium host — warm, vivid, energetic. Write a ~250-word spoken briefing, 5–8 events grouped by vibe…">' + esc(dbCfg.premiumPersona || '') + '</textarea></div>' +
      '<div class="ad-field"><label>Global announcement (read on BOTH tiers, verbatim)</label>' +
      '<textarea id="db-ann">' + esc(dbCfg.announcement || '') + '</textarea></div>' +
      '<div><button class="ad-save" id="db-save">Save briefing settings</button><span class="ad-saved" id="db-msg"></span></div>' +
      sponsors +
      '<div class="ad-field" style="margin-top:16px"><label>Cached briefings (' + dbRows.length + ')</label>' +
      '<div class="ad-list" id="db-list">' + rows + '</div>' +
      '<div style="margin-top:8px"><button class="ad-save ad-danger" id="db-clear">Clear today’s briefings</button></div></div></div>';
  }
  function bindDailySection($, body) {
    const save = $('db-save');
    if (save) save.onclick = function () {
      const patch = { dailyBriefing: { enabled: $('db-en').checked, persona: $('db-persona').value, premiumPersona: ($('db-premium') ? $('db-premium').value : (dbCfg.premiumPersona || '')), announcement: $('db-ann').value } };
      save.disabled = true;
      patchConfig(patch).then(function (r) {
        save.disabled = false;
        const m = $('db-msg');
        if (r && r.error) { m.textContent = 'Error: ' + r.error.message; m.style.color = '#b3402a'; return; }
        dbCfg = patch.dailyBriefing;
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

  /* ---------------- Browser-voice scripts (free rotation, EN) ---------------- */
  const LINE_DEFS = [
    { kind: 'greeting', label: 'Greeting (personalized)', tmpl: "Good {part}, {name}! Based on what you love, I've found {k} live {cat} events within {mi} miles — including {event}, over in {city}.", ph: '{part} {name} {k} {cat} {mi} {event} {city}' },
    { kind: 'welcome', label: 'Worldwide pulse', tmpl: 'Welcome to Eventually! Right now, there are {count} events happening live around the world.', ph: '{count}' },
    { kind: 'spotlight', label: 'Spotlight', tmpl: "Here's one to watch: {event}, in {city}. {going} people are heading there right now.", ph: '{event} {city} {going}' },
    { kind: 'countdown', label: 'Countdown', tmpl: 'Heads up — {event} in {city} kicks off in just {min} minutes.', ph: '{event} {min} {city}' },
    { kind: 'region', label: 'Regional roundup', tmpl: 'Over in {region}, {n} big {cat} events are underway right now.', ph: '{n} {cat} {region}' },
    { kind: 'trending', label: 'Trending', tmpl: "Trending tonight: {event}, in {city}. It's climbing fast, with {likes} likes.", ph: '{event} {city} {likes}' },
    { kind: 'sponsor', label: 'Sponsor read', tmpl: 'This update is brought to you by {sponsor}.', ph: '{sponsor}' },
    { kind: 'tip', label: 'Tip', tmpl: "Tap any glowing marker on the globe, and you'll see everything happening there.", ph: '(none)' }
  ];
  function renderBrowser(body) {
    body.innerHTML = '<div class="ad-center">Loading…</div>';
    sb.from('app_config').select('config').eq('id', 1).maybeSingle().then(function (r) {
      const cfg = (r.data && r.data.config) || {};
      const hl = cfg.hostLines || {};
      const hv = cfg.hostVoice || { rate: 0.98, pitch: 1.0 };
      let html = '<div class="ad-sec"><h2>Voice delivery (free)</h2>' +
        '<p class="ad-hint">Fine-tune how the free on-device voice sounds. The best available device voice is chosen automatically. 1.0 = normal.</p>' +
        '<div class="ad-row">' +
        '<div class="ad-field"><label>Speaking rate (0.7–1.3)</label><input id="hv-rate" type="number" step="0.01" min="0.7" max="1.3" value="' + (hv.rate || 0.98) + '"></div>' +
        '<div class="ad-field"><label>Pitch (0.7–1.3)</label><input id="hv-pitch" type="number" step="0.01" min="0.7" max="1.3" value="' + (hv.pitch != null ? hv.pitch : 1.0) + '"></div>' +
        '</div></div>';
      html += '<div class="ad-sec"><h2>Browser-voice scripts (free)</h2>' +
        '<p class="ad-hint">The rotating lines spoken by the free on-device voice (separate from the ElevenLabs city briefing). Write them conversationally, for the ear. Placeholders fill from live data. Untick to stop a line type.</p>';
      LINE_DEFS.forEach(function (d) {
        const cur = hl[d.kind] || {};
        const text = cur.text != null ? cur.text : d.tmpl;
        const on = cur.on !== false;
        html += '<div class="ad-field" data-kind="' + d.kind + '">' +
          '<label>' + esc(d.label) + ' <span class="ad-muted">— ' + esc(d.ph) + '</span></label>' +
          '<textarea class="bl-text">' + esc(text) + '</textarea>' +
          '<label class="ad-toggle" style="margin-top:6px"><input type="checkbox" class="bl-on"' + (on ? ' checked' : '') + '> Enabled</label></div>';
      });
      html += '<div><button class="ad-save" id="bl-save">Save voice &amp; scripts</button><span class="ad-saved" id="bl-msg"></span></div></div>';
      body.innerHTML = html;
      document.getElementById('bl-save').onclick = function () {
        const out = {};
        body.querySelectorAll('[data-kind]').forEach(function (f) {
          out[f.dataset.kind] = { text: f.querySelector('.bl-text').value, on: f.querySelector('.bl-on').checked };
        });
        const voice = { rate: +document.getElementById('hv-rate').value || 0.98, pitch: +document.getElementById('hv-pitch').value || 1.0 };
        const btn = document.getElementById('bl-save'); btn.disabled = true;
        patchConfig({ hostLines: out, hostVoice: voice }).then(function (r) {
          btn.disabled = false;
          const m = document.getElementById('bl-msg');
          if (r.error) { m.textContent = 'Error: ' + r.error.message; m.style.color = '#b3402a'; }
          else { m.textContent = 'Saved ✓ (applies on next app load)'; m.style.color = '#3a7d44'; }
        });
      };
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
        '<label class="ad-toggle"><input type="checkbox" id="cf-ads"' + (c.adsEnabled === false ? '' : ' checked') + '> Show ads (non-Plus)</label>' +
        '<label class="ad-toggle"><input type="checkbox" id="cf-host"' + (c.hostEnabled === false ? '' : ' checked') + '> AI Host enabled</label></div>' +

        '<div class="ad-sec"><h2>Pinned locations</h2>' +
        '<p class="ad-hint">These cities always show a spike on the globe, with the chosen style. Use the city name as it appears in events.</p>' +
        '<div id="pin-list"></div>' +
        '<button class="ad-save" id="pin-add" type="button" style="margin-top:6px">+ Add city</button></div>' +

        '<div class="ad-sec"><h2>Hide from the globe &amp; search</h2>' +
        '<div class="ad-field"><label>Hidden cities (one per line)</label><textarea id="cf-hidc">' + esc(hidC) + '</textarea></div>' +
        '<div class="ad-field"><label>Hidden event IDs (one per line, e.g. tm_… or nat_…)</label><textarea id="cf-hide">' + esc(hidE) + '</textarea></div></div>' +

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

      document.getElementById('cf-save').onclick = function () {
        const pinned = [];
        list.querySelectorAll('.pin-row').forEach(function (row) {
          const city = row.querySelector('.pin-city').value.trim();
          if (city) pinned.push({ city: city, type: row.querySelector('.pin-type').value });
        });
        const lines = function (id) { return document.getElementById(id).value.split(/[\n,]+/).map(function (s) { return s.trim(); }).filter(Boolean); };
        const merged = Object.assign({}, c, {
          spikes: { priority: +val('cf-pri'), fair: +val('cf-fair'), sponsored: +val('cf-spon') },
          adsEnabled: document.getElementById('cf-ads').checked,
          hostEnabled: document.getElementById('cf-host').checked,
          pinnedLocations: pinned, hiddenCities: lines('cf-hidc'), hiddenEvents: lines('cf-hide')
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

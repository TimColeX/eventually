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
        tabBtn('overview', 'Overview') + tabBtn('host', 'AI Host Script') +
        tabBtn('globe', 'Globe & Display') +
      '</div><div id="ad-body"></div>';
    main.querySelectorAll('.ad-tab').forEach(function (b) {
      b.onclick = function () { tab = b.dataset.tab; renderDashboard(); };
    });
    const body = document.getElementById('ad-body');
    if (tab === 'overview') renderOverview(body);
    else if (tab === 'host') renderHost(body);
    else renderGlobe(body);
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
      body.innerHTML = html;
    });
  }

  /* ---------------- AI Host Script ---------------- */
  let scripts = [];   // host_script rows
  function renderHost(body) {
    body.innerHTML = '<div class="ad-center">Loading script…</div>';
    sb.from('host_script').select('*').order('scope').then(function (r) {
      scripts = r.data || [];
      drawHost(body, 'global');
    });
  }
  function findScope(scope) { return scripts.find(function (s) { return s.scope === scope; }) || { scope: scope, template: '', announcement: '', sponsor_message: '', enabled: true }; }

  function drawHost(body, scope) {
    const opts = [{ scope: 'global' }].concat(scripts.filter(function (s) { return s.scope !== 'global'; }))
      .map(function (s) { return '<option value="' + esc(s.scope) + '"' + (s.scope === scope ? ' selected' : '') + '>' + (s.scope === 'global' ? 'Global (default)' : esc(s.scope)) + '</option>'; }).join('');
    const cur = findScope(scope);
    body.innerHTML =
      '<div class="ad-sec"><h2>AI Host script</h2>' +
      '<p class="ad-hint">Edit what the Host says. The city briefing uses this template; a city/region override replaces the global one for that place. Changes apply on the next ~20-min refresh window.</p>' +
      '<div class="ad-row"><div class="ad-field"><label>Scope</label><select id="hs-scope">' + opts + '</select></div>' +
      '<div class="ad-field"><label>Add city/region override (lowercase, e.g. toronto)</label>' +
      '<div style="display:flex;gap:8px"><input id="hs-new" placeholder="city name…"><button class="ad-save" id="hs-add" type="button">Add</button></div></div></div>' +
      '<div class="ad-field"><label>Template</label><textarea id="hs-tmpl">' + esc(cur.template) + '</textarea>' +
      '<div class="ad-chips">' + ['{city}', '{count}', '{top}', '{featured}'].map(function (t) { return '<span class="ad-chip" data-ins="' + t + '">' + t + '</span>'; }).join('') + '</div></div>' +
      '<div class="ad-field"><label>Announcement (optional — appended)</label><textarea id="hs-ann">' + esc(cur.announcement) + '</textarea></div>' +
      '<div class="ad-field"><label>Sponsor message (optional — appended)</label><textarea id="hs-spon">' + esc(cur.sponsor_message) + '</textarea></div>' +
      '<label class="ad-toggle"><input type="checkbox" id="hs-en"' + (cur.enabled === false ? '' : ' checked') + '> Enabled</label>' +
      '<div><button class="ad-save" id="hs-save">Save script</button><span class="ad-saved" id="hs-msg"></span></div>' +
      '<div class="ad-field" style="margin-top:16px"><label>Live preview (sample data)</label><div class="ad-preview" id="hs-prev"></div></div></div>';

    const $ = function (id) { return document.getElementById(id); };
    $('hs-scope').onchange = function () { drawHost(body, this.value); };
    $('hs-add').onclick = function () {
      const c = $('hs-new').value.trim().toLowerCase(); if (!c) return;
      if (!scripts.find(function (s) { return s.scope === c; })) scripts.push({ scope: c, template: findScope('global').template, announcement: '', sponsor_message: '', enabled: true });
      drawHost(body, c);
    };
    body.querySelectorAll('.ad-chip').forEach(function (ch) {
      ch.onclick = function () { const ta = $('hs-tmpl'); ta.value += (ta.value && !/\s$/.test(ta.value) ? ' ' : '') + ch.dataset.ins; preview(); };
    });
    ['hs-tmpl', 'hs-ann', 'hs-spon'].forEach(function (id) { $(id).addEventListener('input', preview); });
    function preview() {
      let s = ($('hs-tmpl').value || '')
        .replace(/\{city\}/g, scope === 'global' ? 'Toronto' : scope)
        .replace(/\{count\}/g, '42').replace(/\{top\}/g, 'Summer Jazz Festival').replace(/\{featured\}/g, 'Night Market');
      s = s.replace(/\s{2,}/g, ' ').trim();
      if ($('hs-ann').value.trim()) s += ' ' + $('hs-ann').value.trim();
      if ($('hs-spon').value.trim()) s += ' ' + $('hs-spon').value.trim();
      $('hs-prev').textContent = s;
    }
    preview();
    $('hs-save').onclick = function () {
      const row = { scope: scope, template: $('hs-tmpl').value, announcement: $('hs-ann').value, sponsor_message: $('hs-spon').value, enabled: $('hs-en').checked, updated_at: new Date().toISOString() };
      $('hs-save').disabled = true;
      sb.from('host_script').upsert(row, { onConflict: 'scope' }).then(function (r) {
        $('hs-save').disabled = false;
        if (r.error) { $('hs-msg').textContent = 'Error: ' + r.error.message; $('hs-msg').style.color = '#b3402a'; return; }
        const i = scripts.findIndex(function (s) { return s.scope === scope; });
        if (i > -1) scripts[i] = row; else scripts.push(row);
        $('hs-msg').textContent = 'Saved ✓'; $('hs-msg').style.color = '#3a7d44';
      });
    };
  }

  /* ---------------- Globe & Display config ---------------- */
  function renderGlobe(body) {
    body.innerHTML = '<div class="ad-center">Loading config…</div>';
    sb.from('app_config').select('config').eq('id', 1).maybeSingle().then(function (r) {
      const c = (r.data && r.data.config) || {};
      const sp = c.spikes || { priority: 18, fair: 15, sponsored: 12 };
      body.innerHTML =
        '<div class="ad-sec"><h2>Globe &amp; display</h2>' +
        '<p class="ad-hint">Controls the live globe and platform toggles. Applies on next app load.</p>' +
        '<div class="ad-row">' +
        field('cf-pri', 'Priority spikes', sp.priority) + field('cf-fair', 'Continent-fair spikes', sp.fair) + field('cf-spon', 'Sponsored spikes', sp.sponsored) +
        '</div>' +
        '<label class="ad-toggle"><input type="checkbox" id="cf-ads"' + (c.adsEnabled === false ? '' : ' checked') + '> Show ads (non-Plus)</label>' +
        '<label class="ad-toggle"><input type="checkbox" id="cf-host"' + (c.hostEnabled === false ? '' : ' checked') + '> AI Host enabled</label>' +
        '<div><button class="ad-save" id="cf-save">Save config</button><span class="ad-saved" id="cf-msg"></span></div></div>';
      document.getElementById('cf-save').onclick = function () {
        const merged = Object.assign({}, c, {
          spikes: { priority: +val('cf-pri'), fair: +val('cf-fair'), sponsored: +val('cf-spon') },
          adsEnabled: document.getElementById('cf-ads').checked,
          hostEnabled: document.getElementById('cf-host').checked
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

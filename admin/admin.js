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
        tabBtn('browser', 'Browser Voice') + tabBtn('globe', 'Globe & Display') +
      '</div><div id="ad-body"></div>';
    main.querySelectorAll('.ad-tab').forEach(function (b) {
      b.onclick = function () { tab = b.dataset.tab; renderDashboard(); };
    });
    const body = document.getElementById('ad-body');
    if (tab === 'overview') renderOverview(body);
    else if (tab === 'host') renderHost(body);
    else if (tab === 'browser') renderBrowser(body);
    else renderGlobe(body);
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

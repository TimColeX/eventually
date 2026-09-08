/* Eventually — live updates from the organiser.
 *
 * A one-way feed attached to a single event, open only while that event runs
 * and gone afterwards. The organiser posts the practical things — doors,
 * parking, running late — and attendees read them.
 *
 * One-way is the whole design, not a limitation waiting to be lifted. It works
 * at a single reader, where a chat room needs a crowd; and with no
 * user-generated content it carries none of the moderation duty a chat would.
 *
 * Reading needs no account. The server decides whether the window is open and
 * who may post (see backend/55_event_updates.sql) — nothing here is a security
 * boundary, only a rendering of what the server said.
 */
(function (global) {
  'use strict';

  const cfg = global.EVENTUALLY_CONFIG || {};
  const BASE = (cfg.supabaseUrl || '').replace(/\/+$/, '');
  const KEY = cfg.supabaseAnonKey || '';
  const ENABLED = !!(BASE && KEY);

  /* One entry per mounted feed. My Events can show several at once — an
     organiser with two events running tonight — so state is keyed to the box
     rather than held as a single "current" feed. */
  const mounted = new Map();   // box element -> { eventId, channel }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m];
    });
  }

  /* Prefer the supabase client when it's there: it attaches the signed-in user's
     token for us, and posting is gated on auth.uid() — with the bare anon key
     the server correctly refuses. The fetch path is the fallback for when
     supabase-js didn't load, where reading still works and posting simply
     isn't offered. */
  function rpc(name, body) {
    const A = global.EventuallyAuth;
    if (A && A.client) {
      return A.client.rpc(name, body || {})
        .then(function (r) { return (r && !r.error) ? r.data : null; }, function () { return null; });
    }
    return fetch(BASE + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: 'Bearer ' + KEY },
      body: JSON.stringify(body || {})
    }).then(function (r) { return r.ok ? r.json() : null; }, function () { return null; });
  }

  function relTime(iso) {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    return Math.round(s / 3600) + 'h ago';
  }

  /* "closes 22:00" only when the event carries a real end time. Three quarters
     of events don't, and inventing a precise time people can watch tick past is
     worse than saying less. */
  function closingLine(f) {
    if (f.state === 'scheduled') {
      const t = new Date(f.opens_at);
      return 'opens ' + t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    if (f.estimated_end) return 'closes after the event';
    return 'closes ' + new Date(f.closes_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function render(box, f, eventId) {
    const list = f.updates || [];
    const live = f.state === 'live';

    let inner = '';
    if (!list.length) {
      // Never describe the feed as empty — say what it's for. Someone who opens
      // this before the organiser has posted should understand why to come back.
      inner = '<p class="lu-none">' + (live
        ? 'Nothing posted yet. The organiser can share updates here while the event runs.'
        : 'The organiser can post updates here from ' +
          new Date(f.opens_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '.') + '</p>';
    } else {
      inner = '<ul class="lu-list">' + list.map(function (u) {
        return '<li><span class="lu-body">' + esc(u.body) + '</span>' +
               '<span class="lu-when">' + esc(relTime(u.created_at)) + '</span></li>';
      }).join('') + '</ul>';
    }

    /* Say what posting does BEFORE they post, not in the terms. Someone about to
       publish to strangers should know it is public and that it won't survive the
       night — both are easy to assume the other way round. */
    const composer = f.can_post
      ? '<form class="lu-post"><input class="lu-input" maxlength="280" ' +
        'placeholder="Post an update to everyone here…"><button type="submit">Post</button>' +
        '<span class="lu-msg"></span></form>' +
        '<p class="lu-rules">Posted publicly to anyone viewing this event. Deleted when it ends.</p>'
      : '';

    box.innerHTML =
      '<div class="lu-head">' +
        '<span class="lu-dot' + (live ? ' on' : '') + '"></span>' +
        '<span class="lu-title">Live updates</span>' +
        '<span class="lu-when">' + esc(closingLine(f)) + '</span>' +
      '</div>' + inner + composer;

    const form = box.querySelector('.lu-post');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        const input = form.querySelector('.lu-input');
        const msg = form.querySelector('.lu-msg');
        const body = input.value.trim();
        if (!body) return;
        input.disabled = true;
        rpc('post_event_update', { p_event_id: eventId, p_body: body }).then(function (r) {
          input.disabled = false;
          if (r && r.ok) { input.value = ''; msg.textContent = ''; load(box, eventId); return; }
          const why = (r && r.reason) || 'error';
          msg.textContent = why === 'too_fast' ? 'Give it a few seconds.'
            : why === 'not_allowed' ? 'You can\'t post to this event.'
            : why === 'closed' ? 'This has closed.' : 'Couldn\'t post that.';
        });
      });
    }
  }

  function load(box, eventId) {
    return rpc('event_update_feed', { p_event_id: eventId }).then(function (f) {
      if (!f || !f.open) { box.innerHTML = ''; box.hidden = true; return false; }
      box.hidden = false;
      render(box, f, eventId);
      return true;
    });
  }

  /* Realtime so a reader standing in a queue sees the organiser's post without
     refreshing. Falls back silently to the loaded snapshot if the socket can't
     be established — the feed is still correct, just not live. */
  function subscribe(box, eventId) {
    try {
      const A = global.EventuallyAuth;
      if (!A || !A.client) return null;
      return A.client
        .channel('updates:' + eventId + ':' + Math.random().toString(36).slice(2, 8))
        .on('postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'event_updates', filter: 'event_id=eq.' + eventId },
            function () { load(box, eventId); })
        .subscribe();
    } catch (e) { return null; }
  }

  function drop(box) {
    const m = mounted.get(box);
    if (!m) return;
    try {
      const A = global.EventuallyAuth;
      if (m.channel && A && A.client) A.client.removeChannel(m.channel);
    } catch (e) {}
    mounted.delete(box);
  }

  const api = {
    enabled: ENABLED,
    /* Mount the feed into `box` for one event. Resolves true if the feed is
       open — the caller uses that to decide whether the section is shown.
       Mounting the same box again replaces what was there, so re-rendering a
       list never leaves an orphaned socket behind. */
    mount: function (box, eventId) {
      if (!ENABLED || !box || !eventId) { if (box) box.hidden = true; return Promise.resolve(false); }
      drop(box);
      box.hidden = true;                       // stay hidden until we know it's open
      return load(box, eventId).then(function (open) {
        if (open) mounted.set(box, { eventId: eventId, channel: subscribe(box, eventId) });
        return open;
      }).catch(function () { box.hidden = true; return false; });
    },
    /* Close one feed, or every feed if no box is given. */
    unmount: function (box) {
      if (box) { drop(box); return; }
      Array.from(mounted.keys()).forEach(drop);
    }
  };

  global.EventuallyUpdates = api;
})(window);

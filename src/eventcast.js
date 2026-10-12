/* Eventually — EventCast, the organiser's side.
 *
 * Plan: backend/notes/EVENTCAST-STAGE-1.md. Storage and rules: 167 + 174.
 *
 * 🔴 THE ORGANISER DOES NOT WRITE ANYTHING THE HOSTS SAY. They answer three factual
 * questions, we write and record it, and they listen and keep it or bin it. That is the
 * whole contract, and it is a change from the first version (owner's decision,
 * 2026-10-11) made for one reason: the editable script box was the root of every defect
 * this feature produced. A renamed speaker label spoken aloud, an unlabelled line folded
 * into the previous turn, and underneath both of those, the plain fact that an organiser
 * could put ANY words into OUR hosts' voices, on OUR domain, under their own name.
 * Fixing those one at a time was treating a design flaw as a run of bugs.
 *
 * ⚠️ THEY LOSE NOTHING REAL. If a fact is wrong, the fix is to correct the ANSWER and
 * ask again — which is the right loop, because the answers are the facts and the script
 * is derived from them. Editing the script could only ever fix the symptom.
 *
 * 🔑 THEY HEAR IT BEFORE THEY DECIDE. Reading a script tells you much less than hearing
 * one, so the audio is made before approval rather than after. That inverts the old
 * rule of never paying for a clip nobody wanted — accepted knowingly, because at about
 * 1.3p a clip the cost of a declined one is nothing beside the cost of an organiser
 * publishing something they had not actually heard.
 *
 * ⚠️ A BLANK "Description" BOX IS WORSE THAN NO BOX. It is the hardest field in any form
 * and it produces compliance text — "Come and enjoy!" — which a model will then try to
 * elaborate on. Three short, specific questions get specific answers.
 */
(function (global) {
  'use strict';

  const cfg = global.EVENTUALLY_CONFIG || {};
  const BASE = (cfg.supabaseUrl || '').replace(/\/+$/, '');
  const ANON = cfg.supabaseAnonKey || '';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m];
    });
  }
  function auth() { return global.EventuallyAuth; }
  function client() { const A = auth(); return (A && A.client) || null; }

  // Same refresh-aware token as hostvoice.js: an organiser who left the tab open all
  // afternoon must not be told to sign in again because the access token aged out.
  function accessToken() {
    const A = auth();
    if (!A || !A.client) return Promise.resolve(null);
    return A.client.auth.getSession().then(function (r) {
      const s = r && r.data && r.data.session;
      if (!s) return null;
      const now = Math.floor(Date.now() / 1000);
      if (s.expires_at && s.expires_at - now < 60) {
        return A.client.auth.refreshSession().then(function (rr) {
          return (rr && rr.data && rr.data.session && rr.data.session.access_token) || null;
        }).catch(function () { return null; });
      }
      return s.access_token;
    }).catch(function () { return null; });
  }

  function callBriefing(payload) {
    if (!BASE || !ANON) return Promise.resolve({ error: 'offline' });
    return accessToken().then(function (tk) {
      if (!tk) return { error: 'sign_in_required' };
      return fetch(BASE + '/functions/v1/briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: 'Bearer ' + tk },
        body: JSON.stringify(payload)
      }).then(function (r) {
        return r.json().then(function (j) { return j || {}; }, function () { return { error: 'bad_response' }; });
      });
    }).catch(function () { return { error: 'network' }; });
  }

  /* 🔑 AN ERROR THAT SAYS NOTHING IS OUR BUG, NOT THE USER'S. Every backend failure used
     to render as "The hosts couldn't write it just now" — true, useless, and identical
     whether the key was missing, the model returned something unparseable, or the
     request never left the browser. The raw code in brackets is ugly and it is the only
     part that makes a report actionable. */
  const WHY = {
    sign_in_required: 'Your sign-in has expired. Reload the page and sign in again.',
    not_yours: 'This event belongs to another account.',
    blocked: 'This EventCast has been withdrawn and cannot be changed.',
    offline: 'The app is not configured to reach the backend.',
    network: 'The request could not reach the server — check your connection.',
    bad_response: 'The server answered with something we could not read.',
    eligibility_unavailable: 'We could not check this event just now.',
    not_configured: 'The writing service is switched off on the server.',
    llm_failed: 'The writing service did not answer. This is usually temporary.',
    bad_script: 'What came back could not be read as a two-person script.',
    event_missing: 'That event could not be found.',
    not_recorded_yet: 'This has not been recorded yet, so there is nothing to publish.',
    nothing_to_publish: 'There is nothing here to publish yet.',
  };
  function explain(j, fallback) {
    const code = (j && j.error) || 'unknown';
    const msg = (j && j.detail) || WHY[code] || fallback;
    return msg + ' (' + code + ')';
  }

  const Q = [
    { k: 'ec_who',       label: "Who's on?",              hint: '"MrP", "the Kano Youth Choir".' },
    { k: 'ec_what',      label: 'What happens?',          hint: '"Three sets, doors at seven."' },
    { k: 'ec_dont_miss', label: 'One thing not to miss?', hint: '"A late jam, open to local players."' }
  ];

  function mount(box, eventId) {
    if (!box || !eventId) return;
    const sb = client();
    if (!sb) { box.innerHTML = '<p class="ec-note">Sign in to make an EventCast.</p>'; return; }
    box.innerHTML = '<p class="ec-note">Loading…</p>';

    let state = null;
    let audio = null;

    function load() {
      return sb.rpc('eventcast_eligibility', { p_event_id: eventId }).then(function (r) {
        const d = (r && r.data) || {};
        if (r && r.error) { box.innerHTML = '<p class="ec-note ec-bad">Couldn\'t load this (' + esc(r.error.message) + ').</p>'; return; }
        if (d.error) { box.innerHTML = '<p class="ec-note ec-bad">This isn\'t your event.</p>'; return; }
        state = d; render();
      }, function () { box.innerHTML = '<p class="ec-note ec-bad">Couldn\'t load this.</p>'; });
    }

    function list(a) {
      if (!a.length) return '';
      if (a.length === 1) return a[0];
      return a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
    }

    function questions(ec, disabled) {
      let h = '<div class="ec-qs">';
      Q.forEach(function (q) {
        h += '<label class="ec-q"><span>' + esc(q.label) + '</span>' +
             '<input class="ec-in" data-k="' + q.k + '" maxlength="300"' + (disabled ? ' disabled' : '') +
             ' value="' + esc((ec && ec[q.k]) || '') + '" placeholder="' + esc(q.hint) + '"></label>';
      });
      return h + '</div>';
    }

    // The player. Segments play back to back: Fish returns one mp3 for the whole
    // conversation, other providers one per turn, and this must not care which.
    function player(label) {
      return '<div class="ec-player">' +
        '<button type="button" class="ec-play" data-ec="play" aria-label="Play the EventCast">&#9654;</button>' +
        '<div class="ec-pmid"><div class="ec-bar"><i class="ec-prog"></i></div>' +
        '<span class="ec-plabel">' + esc(label) + '</span></div></div>';
    }

    function render() {
      stopAudio();
      const ec = state.eventcast || {};
      const st = ec.status || 'none';
      const miss = state.missing || [];
      // Gaps the organiser fixes HERE are separated from gaps they must fix on the event
      // itself. Telling someone "the venue is missing" inside a panel with no venue box
      // is how a form makes people feel stupid.
      const answerGaps = miss.filter(function (m) { return /questions|detail/.test(m); });
      const eventGaps  = miss.filter(function (m) { return answerGaps.indexOf(m) < 0; });
      let h = '';

      if (st === 'blocked') {
        box.innerHTML = '<p class="ec-note ec-warn">This EventCast has been withdrawn. ' +
          'Email <a href="mailto:info@eventually-app.com">info@eventually-app.com</a> if you think that is a mistake.</p>';
        return;
      }

      if (st === 'ready') {
        h += '<p class="ec-note ec-good">Live on your event page. ' +
             (state.past ? 'Your event has finished, so it now plays there as a record of it.'
                         : 'Anyone who opens the page can play it.') + '</p>' +
             player('On your page now') +
             '<div class="ec-btns"><button class="an-act" data-ec="decline">Take it off my page</button></div>';
        h += '<div class="ec-msg" aria-live="polite"></div>';
        box.innerHTML = h; return;
      }

      if (st === 'review' || st === 'declined') {
        h += st === 'review'
          ? '<p class="ec-note ec-good">Your EventCast is ready. <b>Have a listen</b> — if you like it, put it on your page. If you don\'t, bin it. It is free either way.</p>'
          : '<p class="ec-note">You turned this one down. It is not on your page. You can still change your mind.</p>';
        h += player(st === 'review' ? 'Listen before you decide' : 'Not on your page');
        h += '<div class="ec-btns">' +
               '<button class="an-act ec-go" data-ec="publish">Put it on my page</button>' +
               (st === 'review' ? '<button class="an-act" data-ec="decline">No thanks</button>' : '') +
               '<button class="an-act" data-ec="restart">Start again</button>' +
             '</div>';
        h += '<p class="ec-hint">Written and recorded by us from your answers. Nothing goes on your page until you say so.</p>';
        h += '<div class="ec-msg" aria-live="polite"></div>';
        box.innerHTML = h; return;
      }

      if (st === 'submitted' || st === 'stale') {
        h += st === 'stale'
          ? '<p class="ec-note ec-warn"><b>Paused.</b> You changed ' + esc(ec.stale_reason || 'this event') +
            ', so what the hosts say no longer matches it. We are redoing it — it will come back here for you to hear. ' +
            '<b>We never quietly re-record it in your name.</b></p>'
          : '<p class="ec-note">Thanks — we have your answers. We write and record it, then it appears here for you to listen to. ' +
            'Usually within a day.</p>';
        h += questions(ec, true);
        h += '<div class="ec-btns"><button class="an-act" data-ec="restart">Change my answers</button></div>';
        h += '<div class="ec-msg" aria-live="polite"></div>';
        box.innerHTML = h; return;
      }

      // draft / nothing yet — the three questions.
      h += '<p class="ec-note">A short audio promo for your event, read by the Eventually hosts, free. ' +
           'Answer two or three questions and we write and record it. You hear it first and decide whether to use it.</p>';
      if (eventGaps.length) {
        h += '<p class="ec-note ec-warn">Your event needs ' + esc(list(eventGaps)) +
             ' before we can make one. Press <b>Edit</b> above to add that.</p>';
      }
      h += questions(ec, false);
      h += '<p class="ec-hint">These are the <b>only</b> facts the hosts are given. They are not allowed to add anything you did not write.</p>';
      if (answerGaps.length) h += '<p class="ec-note ec-warn">Still needs ' + esc(list(answerGaps)) + '.</p>';
      h += '<div class="ec-btns">' +
             '<button class="an-act" data-ec="save">Save answers</button>' +
             '<button class="an-act ec-go" data-ec="ask"' + (state.ok ? '' : ' disabled') + '>Make me an EventCast</button>' +
           '</div>';
      h += '<div class="ec-msg" aria-live="polite"></div>';
      box.innerHTML = h;
    }

    function say(msg, kind) {
      const m = box.querySelector('.ec-msg');
      if (m) m.innerHTML = '<p class="ec-note ' + (kind || '') + '">' + esc(msg) + '</p>';
    }
    function busy(on, label) {
      box.querySelectorAll('.an-act').forEach(function (b) { b.disabled = !!on; });
      if (on && label) say(label, '');
    }
    function answers() {
      const o = {};
      box.querySelectorAll('.ec-in').forEach(function (i) { o[i.dataset.k] = i.value.trim(); });
      return o;
    }
    function saveAnswers() {
      const a = answers();
      return sb.rpc('eventcast_save_prompts', {
        p_event_id: eventId, p_who: a.ec_who || '', p_what: a.ec_what || '', p_dont_miss: a.ec_dont_miss || ''
      });
    }

    function stopAudio() { if (audio) { try { audio.pause(); } catch (e) {} audio = null; } }

    function play(btn) {
      const segs = (state.eventcast && state.eventcast.segments) || [];
      if (!segs.length) { say('There is no recording here yet.', 'ec-warn'); return; }
      const prog = box.querySelector('.ec-prog');
      if (audio && !audio.paused) { stopAudio(); btn.innerHTML = '&#9654;'; return; }
      let i = 0;
      audio = new Audio();
      const paint = function () {
        const each = 100 / segs.length;
        const within = (audio.duration && isFinite(audio.duration)) ? (audio.currentTime / audio.duration) : 0;
        if (prog) prog.style.width = Math.min(100, Math.round(i * each + within * each)) + '%';
      };
      audio.addEventListener('timeupdate', paint);
      audio.addEventListener('ended', function () {
        if (i + 1 < segs.length) { i++; audio.src = segs[i].url; audio.play().catch(function () {}); return; }
        if (prog) prog.style.width = '100%';
        btn.innerHTML = '&#9654;';
      });
      audio.addEventListener('error', function () {
        btn.innerHTML = '&#9654;'; say('That recording would not play.', 'ec-bad');
      });
      audio.src = segs[0].url;
      btn.innerHTML = '&#10073;&#10073;';
      audio.play().catch(function () { btn.innerHTML = '&#9654;'; });
    }

    box.addEventListener('click', function (e) {
      const b = e.target.closest('[data-ec]');
      if (!b || b.disabled) return;
      const act = b.dataset.ec;

      if (act === 'play') { play(b); return; }

      if (act === 'save') {
        busy(true, 'Saving…');
        saveAnswers().then(function (r) {
          const d = (r && r.data) || {};
          if ((r && r.error) || d.error) { busy(false); say(explain(d, 'Couldn\'t save that.'), 'ec-bad'); return; }
          state = d; render(); say('Saved.', 'ec-good');
        }, function () { busy(false); say('Couldn\'t save that. Try again.', 'ec-bad'); });
        return;
      }

      if (act === 'ask') {
        // Save first, always. Otherwise someone types an answer, presses the button, and
        // gets a script written from the answers they typed LAST time — which looks
        // exactly like the model ignoring them.
        busy(true, 'Saving your answers…');
        saveAnswers().then(function (r) {
          const d = (r && r.data) || {};
          if ((r && r.error) || d.error) { busy(false); say(explain(d, 'Couldn\'t save your answers.'), 'ec-bad'); return; }
          state = d;
          if (!d.ok) { render(); say('Not quite yet — see above.', 'ec-warn'); return; }
          say('Sending it to be written…', '');
          return callBriefing({ eventcast: 'draft', event_id: eventId }).then(function (j) {
            busy(false);
            if (j.error === 'too_many_rewrites') { say(j.detail || 'Too many requests today.', 'ec-warn'); return; }
            if (j.error || !j.ok) { say(explain(j, 'We couldn\'t start it just now. Try again in a moment.'), 'ec-bad'); return; }
            return load().then(function () { say('Done — we will record it and it will appear here for you to hear.', 'ec-good'); });
          });
        }, function () { busy(false); say('Couldn\'t save your answers.', 'ec-bad'); });
        return;
      }

      if (act === 'publish' || act === 'decline') {
        const rpc = act === 'publish' ? 'eventcast_publish' : 'eventcast_decline';
        busy(true, act === 'publish' ? 'Putting it on your page…' : 'Taking it down…');
        sb.rpc(rpc, { p_event_id: eventId }).then(function (r) {
          const d = (r && r.data) || {};
          if ((r && r.error) || d.error) { busy(false); say(explain(d, 'That didn\'t work.'), 'ec-bad'); return; }
          state = d; render();
          say(act === 'publish' ? 'It is on your event page now.' : 'Taken off your page.', 'ec-good');
        }, function () { busy(false); say('That didn\'t work. Try again.', 'ec-bad'); });
        return;
      }

      if (act === 'restart') {
        if (!confirm('Start again?\n\nThis clears the answers and the recording, and you can ask for a new one.')) return;
        busy(true, 'Clearing…');
        sb.rpc('eventcast_delete', { p_event_id: eventId }).then(function (r) {
          const d = (r && r.data) || {};
          if ((r && r.error) || d.error) { busy(false); say(explain(d, 'Couldn\'t clear that.'), 'ec-bad'); return; }
          state = d; render();
        }, function () { busy(false); say('Couldn\'t clear that.', 'ec-bad'); });
        return;
      }
    });

    load();
  }

  global.EventuallyEventcast = { mount: mount };
})(window);

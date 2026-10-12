/* Eventually — EventCast, the organiser's side (stage 1).
 *
 * The plan is backend/notes/EVENTCAST-STAGE-1.md; the storage and the rules are
 * backend/167_eventcasts.sql. This file is the panel an organiser opens from their own
 * event in "My events": three short questions, a script they can edit, and an approve
 * button. Nothing here decides anything — eligibility and ownership are decided in SQL,
 * and this just renders the answer.
 *
 * 🔴 WHY THE APPROVE BUTTON IS THE WHOLE PRODUCT
 *   A promo clip carries the organiser's name and gets shared to their audience. If they
 *   cannot read the exact words first, we are putting sentences in their mouth. So:
 *   nothing is voiced until they press approve, and the script is an EDITABLE BOX rather
 *   than approve/regenerate — someone who can only reroll can never fix a wording, they
 *   can only gamble on a better one.
 *
 * 🔑 WHY THE THREE QUESTIONS ARE HERE AND NOT ON THE PUBLISH FORM
 *   Every extra required field on the publish form costs organisers we do not have yet.
 *   Publishing stays frictionless; ELIGIBILITY is what gets stricter. "To make an
 *   EventCast we need a few more details" is a fair thing to say to someone who has just
 *   asked for one.
 *
 * ⚠️ A BLANK "Description" BOX IS WORSE THAN NO BOX. It is the hardest field in any form
 *   and it produces compliance text — "Come and enjoy!" — which is worse than empty,
 *   because a vague sentence is exactly what a model will try to elaborate on. Three
 *   short, specific questions get specific answers, and each maps to one beat of script.
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
  // afternoon must not be told to sign in again just because the access token aged out.
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

  /* The script is stored and edited in the two-host wire format (HOST_1: / HOST_2:),
     because that is what the voice pipeline parses. Nobody should have to read that, so
     the box shows the host NAMES and converts back on save. The mapping is positional,
     never by matching the typed name: an organiser who renames a speaker in the box must
     not silently reassign a voice. */
  function toFriendly(script, n1, n2) {
    return String(script || '').replace(/^\s*HOST[_ ]?1\s*[:\-]\s*/gim, n1 + ': ')
                               .replace(/^\s*HOST[_ ]?2\s*[:\-]\s*/gim, n2 + ': ');
  }
  function toWire(text, n1, n2) {
    const r1 = new RegExp('^\\s*' + n1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[:\\-]\\s*', 'gim');
    const r2 = new RegExp('^\\s*' + n2.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[:\\-]\\s*', 'gim');
    return String(text || '').replace(r1, 'HOST_1: ').replace(r2, 'HOST_2: ');
  }

  /* 🔑 AN ERROR THAT SAYS NOTHING IS OUR BUG, NOT THE USER'S.
     The first version of this panel mapped every backend failure to "The hosts couldn't
     write it just now" — which is true, useless, and identical whether the Anthropic key
     is missing, the model returned something unparseable, or the request never left the
     browser. The owner hit it on the first real run and there was nothing to act on and
     nothing to report. So: a plain sentence per known cause, and the raw code in
     brackets after it, always. The code is ugly and it is the only part that makes a
     report actionable. */
  const WHY = {
    sign_in_required: 'Your sign-in has expired. Reload the page and sign in again.',
    not_yours: 'This event belongs to another account.',
    offline: 'The app is not configured to reach the backend.',
    network: 'The request could not reach the server — check your connection.',
    bad_response: 'The server answered with something we could not read.',
    eligibility_unavailable: 'We could not check this event just now.',
    not_configured: 'The writing service is switched off on the server.',
    llm_failed: 'The writing service did not answer. This is usually temporary.',
    bad_script: 'The hosts wrote something we could not read back as a conversation.',
    event_missing: 'That event could not be found.',
    answer_the_questions_first: 'Save your answers first, then write it.',
    no_script: 'There is no script to approve yet.',
    no_voice_configured: 'The hosts’ voices are not set up on the server right now.',
    synth_failed: 'The voice provider did not return any audio. Nothing was published.',
  };
  function explain(j, fallback) {
    const code = (j && j.error) || 'unknown';
    const msg = (j && j.detail) || WHY[code] || fallback;
    // `sample` is what the hosts actually wrote when it could not be read back. Shown,
    // not just logged: the first time this failed the text was discarded, and without it
    // there was no way to tell a formatting quirk from a refusal.
    const sample = (j && j.sample) ? '\n\n' + j.sample : '';
    return msg + ' (' + code + ')' + sample;
  }

  const Q = [
    { k: 'ec_who',       label: "Who's on?",              hint: 'A name is enough — "MrP", "the Kano Youth Choir".' },
    { k: 'ec_what',      label: 'What happens?',          hint: 'One line. "Three sets, doors at seven."' },
    // Kept short on purpose: a placeholder longer than the box is clipped mid-word on a
    // phone, which makes the example unreadable exactly where the help is needed most.
    { k: 'ec_dont_miss', label: 'One thing not to miss?', hint: '"A late jam, open to local players."' }
  ];

  function mount(box, eventId) {
    if (!box || !eventId) return;
    const sb = client();
    if (!sb) { box.innerHTML = '<p class="ec-note">Sign in to make an EventCast.</p>'; return; }
    box.innerHTML = '<p class="ec-note">Loading…</p>';

    let state = null;
    /* The hosts' real names, read from the same admin config the briefing uses, so the
       box says "Ethan:" rather than "HOST_1:". Display only — the VOICES are chosen
       server-side and are never influenced by what is typed here. Falls back to the
       neutral labels if the config is slow or unavailable, which keeps the wire format
       working either way. */
    const hostNames = { n1: 'Host 1', n2: 'Host 2' };
    /* Read straight from app_config rather than through EventuallyAPI: this panel lives
       on publish.html, which does NOT load src/api.js, and a module that only works on
       one of two pages is a trap for whoever reuses it next. app_config has a public read
       policy — it is the same row the app itself fetches on every load. */
    function loadNames() {
      if (!BASE || !ANON) return Promise.resolve();
      return fetch(BASE + '/rest/v1/app_config?select=config&limit=1',
                   { headers: { apikey: ANON, Authorization: 'Bearer ' + ANON } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (rows) {
          const ai = (rows && rows[0] && rows[0].config && rows[0].config.aiHost) || {};
          if (ai.host1 && ai.host1.name) hostNames.n1 = String(ai.host1.name).trim();
          if (ai.host2 && ai.host2.name) hostNames.n2 = String(ai.host2.name).trim();
        })
        .catch(function () {});
    }

    function load() {
      return sb.rpc('eventcast_eligibility', { p_event_id: eventId }).then(function (r) {
        const d = (r && r.data) || {};
        if (r && r.error) { box.innerHTML = '<p class="ec-note ec-bad">Couldn\'t load this (' + esc(r.error.message) + ').</p>'; return; }
        if (d.error) { box.innerHTML = '<p class="ec-note ec-bad">This isn\'t your event.</p>'; return; }
        state = d;
        render();
      }, function () { box.innerHTML = '<p class="ec-note ec-bad">Couldn\'t load this.</p>'; });
    }

    function render() {
      const ec = state.eventcast || {};
      const st = ec.status || 'none';
      const miss = state.missing || [];
      // Gaps the organiser fixes HERE (the three answers) are separated from gaps they
      // have to fix on the event itself. Telling someone "the venue is missing" inside a
      // panel with no venue box is how a form makes people feel stupid.
      const answerGaps = miss.filter(function (m) { return /questions|detail/.test(m); });
      const eventGaps  = miss.filter(function (m) { return answerGaps.indexOf(m) < 0; });

      let h = '';

      if (st === 'ready') {
        // No tick in the text: .ec-note.ec-good adds one, and two ticks reads as a typo.
        h += '<p class="ec-note ec-good">Live on your event page. ' +
             (state.past ? 'The event has finished, so it now plays there as a record of it.'
                         : 'Anyone who opens the page can play it.') + '</p>';
      } else if (st === 'stale') {
        h += '<p class="ec-note ec-warn"><b>Your EventCast is paused.</b> You changed ' +
             esc(ec.stale_reason || 'this event') + ', so what the hosts say no longer matches it. ' +
             'It has been taken off your page until you read it again and approve it. ' +
             '<b>We never quietly re-record it</b> — those are your words, in your name.</p>';
      }

      if (eventGaps.length) {
        h += '<p class="ec-note ec-warn">Before we can make one, your event needs ' +
             esc(list(eventGaps)) + '. Press <b>Edit</b> above to add that.</p>';
      }

      h += '<div class="ec-qs">';
      Q.forEach(function (q) {
        h += '<label class="ec-q"><span>' + esc(q.label) + '</span>' +
             '<input class="ec-in" data-k="' + q.k + '" maxlength="300" value="' + esc(ec[q.k] || '') + '" placeholder="' + esc(q.hint) + '">' +
             '</label>';
      });
      h += '</div>';
      h += '<p class="ec-hint">Answer at least two. The hosts are told these are the <b>only</b> facts about your event — ' +
           'they are not allowed to add anything you did not write.</p>';

      if (answerGaps.length) {
        h += '<p class="ec-note ec-warn">Still needs ' + esc(list(answerGaps)) + '.</p>';
      }

      h += '<div class="ec-btns">' +
           '<button class="an-act" data-ec="save">Save answers</button>' +
           '<button class="an-act ec-go" data-ec="draft"' + (state.ok ? '' : ' disabled') + '>' +
             (ec.script ? 'Write it again' : 'Write my EventCast') + '</button>' +
           '</div>';

      if (ec.script) {
        h += '<div class="ec-draft">' +
             '<label class="ec-q"><span>The script — change any word of it</span>' +
             '<textarea class="ec-script" rows="9">' + esc(toFriendly(ec.script, hostNames.n1, hostNames.n2)) + '</textarea>' +
             '</label>' +
             '<p class="ec-hint">Nothing is recorded until you approve. Once you do, these exact words are what the hosts say.</p>' +
             '<div class="ec-btns">' +
               '<button class="an-act ec-go" data-ec="approve">' +
                 (st === 'ready' ? 'Re-approve and publish' : st === 'stale' ? 'Approve again and put it back' : 'Approve and publish') +
               '</button>' +
             '</div></div>';
      }

      h += '<div class="ec-msg" aria-live="polite"></div>';
      box.innerHTML = h;
    }

    function list(a) {
      if (a.length === 1) return a[0];
      return a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
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

    box.addEventListener('click', function (e) {
      const b = e.target.closest('[data-ec]');
      if (!b || b.disabled) return;
      const act = b.dataset.ec;
      const a = answers();

      if (act === 'save') {
        busy(true, 'Saving…');
        sb.rpc('eventcast_save_prompts', {
          p_event_id: eventId, p_who: a.ec_who || '', p_what: a.ec_what || '', p_dont_miss: a.ec_dont_miss || ''
        }).then(function (r) {
          const d = (r && r.data) || {};
          if ((r && r.error) || d.error) { busy(false); say('Couldn\'t save that. Try again.', 'ec-bad'); return; }
          state = d; render(); say('Saved.', 'ec-good');
        }, function () { busy(false); say('Couldn\'t save that. Try again.', 'ec-bad'); });
        return;
      }

      if (act === 'draft') {
        // Save first, always. Otherwise someone types an answer, presses "Write my
        // EventCast", and gets a script written from the answers they typed LAST time —
        // which looks like the model ignoring them.
        busy(true, 'Saving your answers…');
        sb.rpc('eventcast_save_prompts', {
          p_event_id: eventId, p_who: a.ec_who || '', p_what: a.ec_what || '', p_dont_miss: a.ec_dont_miss || ''
        }).then(function (r) {
          const d = (r && r.data) || {};
          if ((r && r.error) || d.error) { busy(false); say('Couldn\'t save your answers.', 'ec-bad'); return; }
          state = d;
          if (!d.ok) { render(); say('Not quite yet — see above.', 'ec-warn'); return; }
          say('Writing it… this takes a few seconds.', '');
          return callBriefing({ eventcast: 'draft', event_id: eventId }).then(function (j) {
            busy(false);
            if (j.error === 'too_many_rewrites') { say(j.detail || 'Too many rewrites today.', 'ec-warn'); return; }
            if (j.error === 'not_eligible') { return load().then(function () { say('A few details are still missing.', 'ec-warn'); }); }
            if (j.error || !j.script) {
              console.warn('[eventcast] draft failed', j);     // the whole response, for a bug report
              say(explain(j, 'The hosts couldn\'t write it just now. Try again in a moment.'), 'ec-bad');
              return;
            }
            return load().then(function () { say('Here it is. Read it, change anything you like, then approve.', 'ec-good'); });
          });
        }, function () { busy(false); say('Couldn\'t save your answers.', 'ec-bad'); });
        return;
      }

      if (act === 'approve') {
        const ta = box.querySelector('.ec-script');
        const edited = toWire(ta ? ta.value : '', hostNames.n1, hostNames.n2);
        /* 🔴 EVERY LINE, NOT "AT LEAST ONE LINE".
           The old check was `/HOST_[12]:/.test(edited)` — true if a single label
           survived. So renaming ONE speaker (to a third person, or a typo) sailed
           through: the unlabelled line is appended to the PREVIOUS host's turn, and the
           name the organiser typed is then SPOKEN ALOUD — "...in Regina. Bob: Doors at
           eight." Paid audio, on their own public page. Renaming BOTH was caught only by
           accident, because then no label was left at all.
           The offending line is quoted back, because "a line is wrong" in a six-line box
           is not something anyone should have to hunt for. */
        const stray = edited.split('\n').map(function (l) { return l.trim(); })
          .filter(Boolean)
          .filter(function (l) { return !/^(HOST[_ ]?[12]|H[12])\s*[:\-]/i.test(l); })[0];
        if (stray) {
          say('Every line needs to start with ' + hostNames.n1 + ': or ' + hostNames.n2 +
              ': so we know who says it. This one does not — "' + stray.slice(0, 70) + '"', 'ec-warn');
          return;
        }
        busy(true, 'Recording it… this takes a few seconds.');
        callBriefing({ eventcast: 'approve', event_id: eventId, script: edited }).then(function (j) {
          busy(false);
          if (j.error === 'script_too_long') { say(j.detail || 'That script is too long.', 'ec-warn'); return; }
          if (j.error || !j.ok) {
            console.warn('[eventcast] approve failed', j);
            say(explain(j, 'That didn\'t record. Nothing was published — try approving again.'), 'ec-bad');
            return;
          }
          load().then(function () { say('Published. It is on your event page now.', 'ec-good'); });
        });
        return;
      }
    });

    // Names before the first render, or the script box would label its lines with
    // "Host 1" and then relabel them on the next load — which reads as a bug.
    loadNames().then(load, load);
  }

  global.EventuallyEventcast = { mount: mount };
})(window);

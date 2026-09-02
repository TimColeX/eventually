/* Eventually — monetization helpers (frontend mock; no real ad networks/payments).
 * Covers: display-ad content, AI-host sponsorships (rate-limited), local-business
 * partners, ticket-affiliate tagging, and the Eventually Plus benefit list. */
(function (global) {
  'use strict';

  // Revenue Stream 3 — AI Host sponsors (inserted into narration, never spammy).
  // REAL sponsors only: this list is loaded at runtime from `briefing_sponsors` — the
  // SAME table the Admin → "Sponsors" section writes to and the spoken briefing reads.
  // (The old hardcoded demo names — Aperol Spritz, ABC Airlines … — were removed: with
  // the app live they claimed sponsorships that don't exist.) Empty list = NO sponsor
  // line is ever shown, so nothing appears until you actually sell one.
  let adminSponsors = [];      // [{ scope, message, weight, active_from, active_to }]
  let sponsorCity = null;      // the city the host is currently covering (for city-scoped sponsors)

  // Revenue Stream 1 — display ads (mock creatives for the 60px bottom zone).
  const ADS = [
    { brand: 'Coastal Hotels', text: 'Stay where the events are — 20% off weekend rates.' },
    { brand: 'ABC Airlines',   text: 'Fly to the festival. One-way fares from $89.' },
    { brand: 'Brightline Rail', text: 'Skip the traffic. Trains to every major venue.' },
    { brand: 'Verve Mobile',   text: 'Unlimited data for travellers. First month free.' }
  ];

  // Revenue Stream 4 — local business partners (surfaced by user location).
  const PARTNERS = [
    { type: 'Restaurant', name: 'The Copper Kettle', pitch: 'Looking for dinner before the show?' },
    { type: 'Hotel',      name: 'Riverside Suites',  pitch: 'Stay the night, steps from the venue.' },
    { type: 'Bar',        name: 'Lantern & Co.',     pitch: 'Grab a drink after the encore.' },
    { type: 'Transport',  name: 'GoCity Rides',      pitch: 'Get there and back, no parking stress.' }
  ];

  // Benefit-led (concierge intelligence first, premium voice last) — Plus is bought
  // for what the host KNOWS, not just how it sounds.
  const PLUS_BENEFITS = [
    'Your personal AI event concierge',
    'Personalized daily briefings',
    'Intelligent, interest-based recommendations',
    'Travel-aware city briefings',
    'Saved-event reminders & schedule alerts',
    'Premium AI narration',
    'Ad-free & sponsor-free'
  ];

  let lastSponsorAt = 0;
  let affiliateClicks = 0;

  /* ---------------- Display ad slots (provider-agnostic) ----------------
   * Three reserved placements: `banner` (bottom bar), `infeed` (native card in
   * event lists), `panel` (rectangle in the event-detail view). Today they render
   * house creatives; the containers already reserve the correct sizes so there's
   * no layout shift when a real network fills them.
   *
   * TO GO LIVE WITH GOOGLE ADSENSE (website / installed-PWA only — not native apps):
   *   1. Add the AdSense loader <script> to index.html <head> (see the comment there).
   *   2. Fill ADSENSE below: enabled=true, client='ca-pub-…', and each slot id.
   *   3. That's it — adSlotHTML() then emits <ins class="adsbygoogle"> and
   *      mountAdSense() activates each unit. No other code changes needed.
   * Ads are only rendered for non-Plus users when the admin has ads enabled
   * (the app gates on RT.adsEnabled && !plus before calling adSlotHTML). */
  const ADSENSE = {
    enabled: true,                                // LIVE — approved 2026-09-01, manual units (Auto ads deliberately OFF)
    client: 'ca-pub-9120618442042757',            // publisher id (live)
    slots: {                                      // per-placement ad-unit ids from AdSense → Ads → By ad unit
      banner: '3532231028',                       // bottom bar (horizontal)
      infeed: '1518160402',                       // inside the results list
      panel:  '8592986015'                        // event detail side panel
    }
  };
  // Reserved min-heights (px) — keep in sync with .ad-slot CSS to avoid layout shift.
  const SLOT_H = { banner: 56, infeed: 96, panel: 250 };

  function houseCreative(kind) {
    const ad = ADS[Math.floor(Math.random() * ADS.length)];
    if (kind === 'infeed') {
      return '<span class="ad-tag">Sponsored</span>' +
        '<div class="ad-native-body"><strong>' + ad.brand + '</strong>' +
        '<span>' + ad.text + '</span></div><span class="ad-cta">Learn more ›</span>';
    }
    if (kind === 'panel') {
      return '<span class="ad-tag">Ad</span>' +
        '<strong>' + ad.brand + '</strong><span>' + ad.text + '</span>' +
        '<span class="ad-cta">Learn more ›</span>';
    }
    // banner (bottom bar) — keeps the "Remove ads" → Plus affordance.
    return '<span class="ad-tag">Ad</span><div class="ad-body"><strong>' + ad.brand +
      '</strong><span>' + ad.text + '</span></div><button class="ad-plus">Remove ads</button>';
  }

  const api = {
    get sponsors() { return adminSponsors; },   // live admin-configured sponsors (was a demo array)
    partners: PARTNERS,
    plusBenefits: PLUS_BENEFITS,
    adsense: ADSENSE,

    randomAd: function () { return ADS[Math.floor(Math.random() * ADS.length)]; },
    partnerFor: function (seed) { return PARTNERS[Math.abs(seed | 0) % PARTNERS.length]; },

    // Inner HTML for an ad placement. Emits an AdSense <ins> when configured,
    // otherwise a house creative. Caller wraps it in the reserved .ad-slot box.
    adSlotHTML: function (kind) {
      const h = SLOT_H[kind] || SLOT_H.banner;
      if (ADSENSE.enabled && ADSENSE.client) {
        // BANNER = FIXED 320x50 (mobile leaderboard). The bottom bar is a fixed 56px
        // strip, so a RESPONSIVE unit there commonly returns a 320x100 and spills over
        // the globe / AI-host bar — bad UX and a policy risk (ads must not be obscured
        // or clipped). A fixed size can never overflow. The in-feed and panel slots keep
        // the responsive unit: their containers use min-height and are free to grow.
        if (kind === 'banner') {
          return '<ins class="adsbygoogle" style="display:inline-block;width:320px;height:50px" ' +
            'data-ad-client="' + ADSENSE.client + '" data-ad-slot="' + (ADSENSE.slots.banner || '') + '"></ins>';
        }
        return '<ins class="adsbygoogle" style="display:block;min-height:' + h + 'px" ' +
          'data-ad-client="' + ADSENSE.client + '" data-ad-slot="' + (ADSENSE.slots[kind] || '') + '" ' +
          'data-ad-format="auto" data-full-width-responsive="true"></ins>';
      }
      return houseCreative(kind);
    },
    // After inserting slots into the DOM, activate any AdSense units within `root`.
    // No-op until ADSENSE is configured (house creatives need nothing).
    mountAdSense: function (root) {
      if (!ADSENSE.enabled || !ADSENSE.client || !window.adsbygoogle) return;
      (root || document).querySelectorAll('ins.adsbygoogle:not([data-mounted])').forEach(function (el) {
        el.setAttribute('data-mounted', '1');
        try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { /* ignore */ }
      });
    },

    // Rate-limited host sponsorship line. Returns null for Plus members or if a
    // sponsorship played in the last ~75s (spec: at most one every several minutes).
    // Sponsors come from Admin → Sponsors (briefing_sponsors). Load once at boot.
    setSponsors: function (list) { adminSponsors = Array.isArray(list) ? list : []; },
    // The city the Host is currently covering — decides which city-scoped sponsors apply.
    setSponsorCity: function (city) { sponsorCity = city ? String(city).toLowerCase() : null; },
    nextSponsorLine: function (isPlus) {
      if (isPlus) return null;                                   // Plus is ad-free
      const now = Date.now();
      if (now - lastSponsorAt < 75000) return null;              // at most one every ~75s
      const today = new Date().toISOString().slice(0, 10);
      // Eligible = enabled, in its active window, and scoped to "world" or THIS city.
      const pool = adminSponsors.filter(function (s) {
        if (!s || s.enabled === false || !s.message) return false;
        if (s.active_from && s.active_from > today) return false;
        if (s.active_to && s.active_to < today) return false;
        const sc = String(s.scope || 'world').toLowerCase();
        return sc === 'world' || (sponsorCity && sc === sponsorCity);
      });
      if (!pool.length) return null;                             // no real sponsors → say nothing
      const total = pool.reduce(function (a, s) { return a + Math.max(1, s.weight || 1); }, 0);
      let r = Math.random() * total, pick = pool[0];
      for (const s of pool) { r -= Math.max(1, s.weight || 1); if (r <= 0) { pick = s; break; } }
      lastSponsorAt = now;
      // The admin message is read VERBATIM (same contract as the spoken briefing) —
      // we never wrap an advertiser's copy in our own sentence.
      return { text: String(pick.message), sponsor: String(pick.message) };
    },

    // Revenue Stream 5 — tag an outbound ticket URL with our affiliate ref.
    affiliate: function (url) {
      if (!url) return url;
      return url + (url.indexOf('?') > -1 ? '&' : '?') + 'ref=eventually-aff';
    },
    trackAffiliate: function () { affiliateClicks++; return affiliateClicks; },
    affiliateClicks: function () { return affiliateClicks; }
  };

  global.EventuallyMonetize = api;
})(window);

/* Eventually — monetization helpers (frontend mock; no real ad networks/payments).
 * Covers: display-ad content, AI-host sponsorships (rate-limited), local-business
 * partners, ticket-affiliate tagging, and the Eventually Plus benefit list. */
(function (global) {
  'use strict';

  // Revenue Stream 3 — AI Host sponsors (inserted into narration, never spammy).
  const SPONSORS = [
    'Coastal Hotels', 'ABC Airlines', 'Brightline Rail',
    'Summit Outdoors', 'Aperol Spritz', 'Verve Mobile'
  ];

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

  const PLUS_BENEFITS = [
    'Ad-free experience',
    'No sponsorship messages',
    'Advanced event filtering',
    'A personalized AI Host',
    'Travel planning tools',
    'Event reminders',
    'Early access to new features'
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
    enabled: false,
    client: '',                                   // e.g. 'ca-pub-XXXXXXXXXXXXXXXX'
    slots: { banner: '', infeed: '', panel: '' }  // per-placement ad-unit ids
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
    sponsors: SPONSORS,
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
    nextSponsorLine: function (isPlus) {
      if (isPlus) return null;
      const now = Date.now();
      if (now - lastSponsorAt < 75000) return null;
      lastSponsorAt = now;
      const s = SPONSORS[Math.floor(Math.random() * SPONSORS.length)];
      const forms = [
        'This update is brought to you by ' + s + '.',
        "Today's featured partner is " + s + '.',
        'Your next few minutes on Eventually are sponsored by ' + s + '.'
      ];
      return { text: forms[Math.floor(Math.random() * forms.length)], sponsor: s };
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

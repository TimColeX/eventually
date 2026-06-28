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

  const api = {
    sponsors: SPONSORS,
    partners: PARTNERS,
    plusBenefits: PLUS_BENEFITS,

    randomAd: function () { return ADS[Math.floor(Math.random() * ADS.length)]; },
    partnerFor: function (seed) { return PARTNERS[Math.abs(seed | 0) % PARTNERS.length]; },

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

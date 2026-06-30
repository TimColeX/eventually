/* Eventually — billing seam (Lemon Squeezy, Merchant of Record).
 *
 * Dormant + safe: if window.EVENTUALLY_CONFIG.billing isn't filled in, `enabled`
 * is false and the app keeps the mock Plus toggle / free feature behaviour. Once
 * the checkout URLs are configured, the Plus button and "Feature this event" open
 * real Lemon Squeezy checkout. Paid state (is_plus, featured) is set ONLY by the
 * server webhook — never trusted from the client.
 *
 * To swap to Paddle later, only this file + the webhook change.
 */
(function (global) {
  'use strict';

  const cfg = (global.EVENTUALLY_CONFIG && global.EVENTUALLY_CONFIG.billing) || {};
  const PLUS_URL = cfg.plusCheckoutUrl || '';
  const FEATURE_URL = cfg.featureCheckoutUrl || '';
  const FREE_PER_MONTH = cfg.freeFeaturesPerMonth != null ? cfg.freeFeaturesPerMonth : 3;
  const ENABLED = !!PLUS_URL;

  // Open a Lemon Squeezy checkout — overlay if lemon.js is present, else redirect.
  function openCheckout(baseUrl, custom, email) {
    if (!baseUrl) return false;
    let u;
    try { u = new URL(baseUrl); } catch (e) { return false; }
    if (email) u.searchParams.set('checkout[email]', email);
    Object.keys(custom || {}).forEach(function (k) {
      if (custom[k] != null) u.searchParams.set('checkout[custom][' + k + ']', custom[k]);
    });
    const url = u.toString();
    if (global.LemonSqueezy && global.LemonSqueezy.Url && global.LemonSqueezy.Url.Open) {
      global.LemonSqueezy.Url.Open(url);     // in-app overlay
    } else {
      global.open(url, '_blank', 'noopener'); // new tab fallback
    }
    return true;
  }

  global.EventuallyBilling = {
    enabled: ENABLED,
    freeFeaturesPerMonth: FREE_PER_MONTH,
    startPlusCheckout: function (u) {
      if (!ENABLED || !u) return false;
      return openCheckout(PLUS_URL, { user_id: u.id }, u.email);
    },
    startFeatureCheckout: function (u, eventId) {
      if (!FEATURE_URL || !u) return false;
      return openCheckout(FEATURE_URL, { user_id: u.id, event_id: eventId }, u.email);
    }
  };
})(window);

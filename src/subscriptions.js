/* Eventually — subscription service layer (provider-AGNOSTIC).
 *
 * The app talks ONLY to this module for subscription/trial state — never to a
 * payment provider directly. Today it drives the no-card free trial (a DB-only
 * 'trialing' state) via the SECURITY DEFINER RPCs in backend/33_subscriptions.sql.
 * When paid billing is wired, the payment provider's specifics live in billing.js
 * (checkout) + the server webhook (conversion) — this interface does NOT change,
 * so Lemon Squeezy can be swapped for Stripe with no app-level changes.
 *
 * Dormant + safe: if auth isn't configured (or the RPCs aren't deployed yet),
 * every call resolves to null and the app falls back to its prior behaviour.
 */
(function (global) {
  'use strict';

  const A = global.EventuallyAuth;

  // Call a Postgres RPC through the authenticated Supabase client. Resolves the
  // data payload, or null on any failure (not signed in, RPC missing, network).
  function rpc(name, args) {
    if (!A || !A.enabled || !A.client) return Promise.resolve(null);
    return A.client.rpc(name, args || {})
      .then(function (r) { return (r && !r.error) ? r.data : null; })
      .catch(function () { return null; });
  }

  global.EventuallySubscriptions = {
    // Effective status: { state, is_plus, trial_available, trial_days, trial_end,
    // seconds_remaining, cancel_at_period_end, remind_hours_before, trial_message, … }.
    getStatus: function () { return rpc('my_subscription'); },
    // Start the admin-configured no-card free trial. Returns { ok, … } (the full
    // status on success, or { ok:false, reason } — reasons: trials_disabled,
    // not_started, campaign_ended, trial_already_used, already_subscribed).
    startTrial: function () { return rpc('start_trial'); },
    // Cancel (keeps access until the period ends; won't renew/convert).
    cancel: function () { return rpc('cancel_subscription'); },
    // Undo a pending cancel while still inside the period.
    resume: function () { return rpc('resume_subscription'); }
  };
})(window);

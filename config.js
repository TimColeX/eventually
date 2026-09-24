/* Eventually — backend configuration, shared by every page on the site.
 *
 * This used to be inline in index.html. It moved out when publish.html arrived: two pages
 * that each carry their own copy of the Supabase URL is two copies to keep in step, and
 * the one that drifts is the one nobody is looking at.
 *
 * SAFE TO COMMIT. The anon key is a PUBLIC key — it identifies the project, it does not
 * grant anything; every table is behind row-level security. The keys that ARE secret
 * (Ticketmaster, PredictHQ, Anthropic, ElevenLabs, Fish, the cron token) live only in
 * Supabase Secrets and are never sent to a browser.
 *
 * NOTE: the build stamp (window.EVENTUALLY_BUILD) stays inline in index.html, because
 * that is the file `node tools/bump-version.js` rewrites.
 */
window.EVENTUALLY_CONFIG = {
  supabaseUrl: 'https://gpsetmqivzchlvyrcgld.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdwc2V0bXFpdnpjaGx2eXJjZ2xkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1MDM2NzcsImV4cCI6MjA5ODA3OTY3N30.a0BB-FQDh5NKFvgxeSgJ3YmeN_HYOWGLOJza29wW8KI',
  // Billing (Lemon Squeezy). Leave blank to keep the mock Plus toggle.
  // Fill these in once your store + products exist (see backend/SETUP-BILLING.md).
  billing: {
    plusCheckoutUrl: '',      // Lemon Squeezy "Eventually Plus" subscription checkout URL
    featureCheckoutUrl: '',   // one-off "Feature this event" product checkout URL
    freeFeaturesPerMonth: 3   // hybrid: free features/month for Plus members
  },
  // AI Host premium voice (Plus-only). Set host.elevenlabs false to keep everyone on the
  // on-device browser voice. The provider itself is chosen in the admin portal.
  host: { elevenlabs: true }
};

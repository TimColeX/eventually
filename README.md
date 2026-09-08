# Eventually

**The event directory where good things land — eventually.**

A progressive web app that turns event discovery into a live, narrated 3D globe. Spin the
planet, watch events glow as dots and spikes, tap a place to see what's on, and let an
AI radio host talk you through it.

**Live:** [eventually-app.com](https://eventually-app.com)

---

## What it does

- **A hand-rolled 3D globe** — Canvas 2D, no WebGL, no library. Real Natural Earth
  landmasses, per-city clustering, and "breathing" spikes whose height tracks how much is
  on. A 60-day timeline scrubs the whole planet through time.
- **Real events**, ~15,000 of them, from the Ticketmaster Discovery API and published
  venue calendars, deduplicated across sources.
- **An AI host** that narrates what's happening near you — a two-voice conversation
  generated per city and cached aggressively, so the same briefing is never paid for twice.
- **Live updates** — while an event is running, its organiser can post practical notes
  (doors, parking, running late) to everyone viewing it. Opens an hour before the start,
  deleted when the event ends.
- **Anyone can publish an event** to the globe in a few taps, with a rolling annual
  allowance enforced in the database.
- **Static city pages** for SEO, regenerated daily by a GitHub Action.

## How it's built

The unusual part is what *isn't* here: **there is no build step.** No bundler, no
framework, no transpiler. Modules are plain `<script>` tags attaching to `window`
globals, loaded in dependency order from `index.html`. What you read is what runs, and
what runs is what deploys.

| Layer | Choice |
|---|---|
| Frontend | Static HTML/CSS/JS, zero dependencies at runtime |
| Backend | Supabase — Postgres, Auth, Realtime, Edge Functions (Deno) |
| Hosting | GitHub Pages, Cloudflare DNS |
| Events | Ticketmaster Discovery API, iCal/RSS venue feeds |
| Voice | Fish Audio, behind a provider-agnostic adapter |
| Text | Claude (Anthropic) |

Reads go straight to Postgres through PostgREST with the public anon key, protected by
row-level security. Every secret lives in an Edge Function's environment; none reaches the
browser.

### Versioning without a bundler

With no build step, assets sit at stable paths — `src/app.js`, never
`src/app.a83f21.js` — so the service worker's cache name is the only thing distinguishing
one release from the next. Three files have to agree on it, and
`node tools/bump-version.js` keeps them in step:

```
sw.js          CACHE            which cache the new worker fills and serves
index.html     EVENTUALLY_BUILD what a running copy reports itself as
version.json   build            what the server says is current
```

An installed PWA is usually *resumed*, not navigated to, so it never re-checks the worker
on its own. The app therefore checks for a new version whenever it returns to the
foreground, and swaps at a moment that won't interrupt you — never mid-briefing, never
over an open dialog.

## Run it locally

Serving over `http://` rather than `file://` is required — the service worker and auth
both refuse otherwise.

```powershell
powershell -ExecutionPolicy Bypass -File .\serve.ps1
```

Then <http://localhost:8080/> — and <http://localhost:8080/admin/> for the admin portal,
which is admin-only and never cached by the service worker.

## Deploy

```powershell
.\publish.ps1 "what changed"
```

Pulls first (a daily Action commits regenerated city pages straight to this repo), then
commits and pushes. GitHub Pages rebuilds in a minute or two.

## Layout

```
index.html         app shell + public Supabase config
sw.js              service worker — cache, offline shell, update handshake
version.json       build stamp the running app compares itself against
src/*.js           frontend modules (window.EventuallyX globals)
styles/main.css    every app style, in the warm "Clay" palette
admin/             separate admin app — analytics, moderation, configuration
events/  browse/   generated city pages, rebuilt daily by an Action
tools/             page generator and the release stamper
brand/             logo, QR codes, posters
assets/            icons, ambient music
```

Server-side work — SQL migrations, Edge Functions and setup guides — lives in a separate
private repository. It's deployed by hand and never served to a browser, so it has no
business in the folder that *is* the website.

## Conventions worth knowing

- **Add a module** by putting a `<script>` in `index.html` in dependency order, and by
  adding it to `ASSETS` in `sw.js` — otherwise an offline load 404s on a file the page asks for.
- **Never cache `/admin/`** in the service worker.
- **Never put a secret in frontend config.** The anon key there is public by design and
  row-level security is what protects the data.
- **Privileged state** — `is_plus`, `is_admin`, `sponsored`, `moderation` — is set only by
  triggers, RPCs, webhooks or the service role. Never by the client.
- **Bump the version** with `tools/bump-version.js`, not by editing `sw.js` by hand;
  editing one of the three files alone leaves the other two behind and silently disables
  update detection.

## Licence

All rights reserved. The code is public because this repository *is* the deployed site,
not as an invitation to reuse it.

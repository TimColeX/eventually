#!/usr/bin/env node
/* Eventually — release stamper.
 *
 * WHY THIS EXISTS: the app has no build step, so assets sit at stable paths and
 * the service worker's CACHE name is the only thing that distinguishes one
 * release from the next. Three files have to agree on it:
 *
 *   sw.js          CACHE          — which cache the new worker fills and serves
 *   index.html     EVENTUALLY_BUILD — what the running app thinks it is
 *   version.json   build          — what the server says is current
 *
 * Bumping sw.js by hand and forgetting the other two is silent: the worker
 * updates fine, but the app loses its ability to notice a deploy on its own, so
 * installed Home Screen copies drift. Run this instead, and mirror.
 *
 *   node tools/bump-version.js          # v146 -> v147
 *   node tools/bump-version.js v200     # set explicitly
 *
 * It also copies the four files into Eventually-site/ so the mirror can't fall
 * behind — a stale mirror is the same bug wearing a different hat.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SW = path.join(ROOT, 'sw.js');
const HTML = path.join(ROOT, 'index.html');
const VER = path.join(ROOT, 'version.json');
const MIRROR = path.join(ROOT, 'Eventually-site');

function read(f) { return fs.readFileSync(f, 'utf8'); }

const sw = read(SW);
const m = sw.match(/const CACHE = 'eventually-v(\d+)';/);
if (!m) {
  console.error('Could not find the CACHE line in sw.js — has it been renamed?');
  process.exit(1);
}
const current = 'v' + m[1];
const arg = process.argv[2];
const next = arg ? (/^v?\d+$/.test(arg) ? 'v' + arg.replace(/^v/, '') : null) : 'v' + (+m[1] + 1);
if (!next) {
  console.error('Version must look like v147 or 147.');
  process.exit(1);
}
if (next === current) {
  console.error('Already at ' + current + ' — nothing to do.');
  process.exit(1);
}

// 1. sw.js — the cache the new worker fills and serves from.
fs.writeFileSync(SW, sw.replace(
  /const CACHE = 'eventually-v\d+';/,
  "const CACHE = 'eventually-" + next + "';"
));

// 2. index.html — what a running copy reports itself as.
const html = read(HTML);
if (!/window\.EVENTUALLY_BUILD = '[^']+';/.test(html)) {
  console.error('index.html has no EVENTUALLY_BUILD line — restore it before releasing.');
  process.exit(1);
}
fs.writeFileSync(HTML, html.replace(
  /window\.EVENTUALLY_BUILD = '[^']+';/,
  "window.EVENTUALLY_BUILD = '" + next + "';"
));

// 3. version.json — the beacon an installed app polls to spot a deploy.
fs.writeFileSync(VER, JSON.stringify({ build: next }, null, 2) + '\n');

// Mirroring to Eventually-site/ used to happen here, because the site was
// published by uploading that folder through GitHub's web UI. The repo is now
// under git and pushed from this folder directly, so the mirror is dead weight —
// and copying into it would only create a second, stale truth.
const mirrored = 0;

console.log('Eventually ' + current + ' -> ' + next);
console.log('  sw.js            CACHE = eventually-' + next);
console.log('  index.html       EVENTUALLY_BUILD = ' + next);
console.log('  version.json     build = ' + next);
console.log('');
console.log('Now publish it:   .\\publish.ps1 "what changed"');
console.log('Installed apps pick it up on their next foreground check — no reinstall.');

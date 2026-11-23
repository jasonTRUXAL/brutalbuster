#!/usr/bin/env node
// Runs after `vite build`. Writes a tiny page per tape, dist/t/<id>/index.html, so a
// shared tape link (the held-tape panel's Copy link) previews in chat apps and social
// sites with the tape's title and thumbnail. The page just forwards to ../../?tape=<id>,
// which puts the visitor in front of that tape. Built from the catalogs in dist/ (the
// deploy restocks them before building, so the pages match what's on the shelves).
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogTargets } from './lib/build-catalog.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');
const configFile = resolve(ROOT, 'store.config.json');
const config = existsSync(configFile) ? JSON.parse(readFileSync(configFile, 'utf8')) : {};
const storeName = [config.store?.name || 'BRUTALBUSTER', config.store?.subtitle || 'VIDEO'].join(' ');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// (a safe folder name: YouTube ids are [A-Za-z0-9_-], sample ids are slugs)
const SAFE_ID = /^[\w-]{1,64}$/;

export function tapePage(video, store = storeName) {
  const id = encodeURIComponent(video.id);
  const title = `${video.title} · ${store}`;
  // (not the video's description: those often open with a sponsor read)
  const desc = [video.duration, 'Pick it up off the shelf at the walk-in 1990s video store.'].filter(Boolean).join(' · ');
  const thumb = video.thumb || (video.youtubeId ? `https://i.ytimg.com/vi/${video.youtubeId}/hqdefault.jpg` : '');
  const to = `../../?tape=${id}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="video.other">
<meta property="og:site_name" content="${esc(store)}">
<meta property="og:title" content="${esc(video.title)}">
<meta property="og:description" content="${esc(desc)}">
${thumb ? `<meta property="og:image" content="${esc(thumb)}">\n<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:image" content="${esc(thumb)}">` : '<meta name="twitter:card" content="summary">'}
<meta name="twitter:title" content="${esc(video.title)}">
<meta name="theme-color" content="#0a0f26">
<meta http-equiv="refresh" content="0; url=${esc(to)}">
<link rel="icon" href="../../favicon.svg" type="image/svg+xml">
<script>location.replace(${JSON.stringify(to)} + location.hash)</script>
</head>
<body style="background:#0a0f26;color:#fff;font-family:sans-serif">
<p>Taking you to <a href="${esc(to)}" style="color:#ffc61a">${esc(video.title)}</a>…</p>
</body>
</html>
`;
}

function main() {
  if (!existsSync(DIST)) {
    console.error('dist/ is missing: run `vite build` first');
    process.exit(1);
  }
  const out = resolve(DIST, 't');
  rmSync(out, { recursive: true, force: true });
  let n = 0;
  for (const target of catalogTargets(config)) {
    const file = resolve(DIST, basename(target.out));
    if (!existsSync(file)) continue;
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    for (const v of raw.videos || []) {
      if (v.hidden || !SAFE_ID.test(String(v.id || ''))) continue;
      const dir = resolve(out, v.id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(resolve(dir, 'index.html'), tapePage(v));
      n++;
    }
  }
  console.log(`tape-pages: wrote ${n} share pages to dist/t/`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

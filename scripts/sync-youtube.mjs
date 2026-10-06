#!/usr/bin/env node
// Stocks the store: pulls every upload from a YouTube channel and writes public/catalog.json.
//
//   npm run sync                         # uses store.config.json + YOUTUBE_API_KEY from .env
//   npm run sync -- --channel @SomeHandle
//   npm run sync -- --out some/other.json
//   npm run sync -- --rss                # force the no-key RSS path
//
// With a YouTube Data API key it fetches the whole channel (titles, descriptions,
// durations, playlists). Without one it falls back to the channel's public RSS feed,
// which only lists the 15 most recent uploads.
//
// This file only does I/O. Parsing lives in lib/youtube-parse.mjs, shelving rules in
// lib/build-catalog.mjs, and the output is checked against src/catalog-schema.js
// before anything is written — a failed or partial fetch never replaces a good catalog.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCatalog } from '../src/catalog-schema.js';
import { isoDuration, parseChannel, extractChannelId, parseRssFeed } from './lib/youtube-parse.mjs';
import { buildCatalog } from './lib/build-catalog.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://www.googleapis.com/youtube/v3';

// ------------------------------------------------------------------ setup

function loadEnv() {
  const file = resolve(ROOT, '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

function args() {
  const out = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith('--')) {
      const key = a[i].slice(2);
      out[key] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true;
    }
  }
  return out;
}

const readJson = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback);

async function getJson(url) {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = body?.error?.errors?.[0]?.reason || res.status;
    throw new Error(`YouTube API error (${reason}): ${body?.error?.message || res.statusText}`);
  }
  return body;
}

async function scrapeChannelId(url) {
  const res = await fetch(url, { headers: { 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+1' } });
  const id = extractChannelId(await res.text());
  if (!id) throw new Error(`Couldn't find a channel ID at ${url}`);
  return id;
}

// ------------------------------------------------------------------ API path

async function fromApi(key, channel) {
  const q = (path, params) => `${API}/${path}?${new URLSearchParams({ ...params, key })}`;
  const channelBy = async (params) => (await getJson(q('channels', { part: 'snippet,contentDetails', ...params }))).items?.[0];
  let ch;
  if (channel.id) ch = await channelBy({ id: channel.id });
  else if (channel.handle) ch = await channelBy({ forHandle: channel.handle });
  else if (channel.username) ch = await channelBy({ forUsername: channel.username });
  if (!ch && channel.url) ch = await channelBy({ id: await scrapeChannelId(channel.url) });
  if (!ch) throw new Error('Channel not found. Check the "channel" value in store.config.json.');

  console.log(`📼 ${ch.snippet.title} — reading uploads…`);

  const playlistVideoIds = async (playlistId) => {
    const ids = [];
    let pageToken = '';
    do {
      const page = await getJson(q('playlistItems', { part: 'contentDetails', playlistId, maxResults: 50, ...(pageToken && { pageToken }) }));
      for (const it of page.items || []) ids.push(it.contentDetails.videoId);
      pageToken = page.nextPageToken || '';
    } while (pageToken);
    return ids;
  };

  const ids = await playlistVideoIds(ch.contentDetails.relatedPlaylists.uploads);
  const videos = [];
  for (let i = 0; i < ids.length; i += 50) {
    const page = await getJson(q('videos', { part: 'snippet,contentDetails,status', id: ids.slice(i, i + 50).join(','), maxResults: 50 }));
    for (const v of page.items || []) {
      if (v.status?.privacyStatus === 'private') continue;
      const dur = isoDuration(v.contentDetails?.duration);
      videos.push({
        youtubeId: v.id,
        title: v.snippet.title,
        description: v.snippet.description,
        tags: v.snippet.tags || [],
        publishedAt: v.snippet.publishedAt,
        duration: dur.text,
        seconds: dur.seconds,
        live: v.snippet.liveBroadcastContent !== 'none',
      });
    }
    process.stdout.write(`   ${Math.min(i + 50, ids.length)}/${ids.length} videos\r`);
  }
  console.log('');

  // playlists → aisle hints
  const playlists = [];
  let pageToken = '';
  do {
    const page = await getJson(q('playlists', { part: 'snippet', channelId: ch.id, maxResults: 50, ...(pageToken && { pageToken }) }));
    playlists.push(...(page.items || []));
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  const memberships = new Map();
  for (const pl of playlists) {
    const members = await playlistVideoIds(pl.id);
    for (const id of members) {
      if (!memberships.has(id)) memberships.set(id, []);
      memberships.get(id).push({ title: pl.snippet.title, size: members.length });
    }
  }
  console.log(`   ${playlists.length} playlists`);

  const url = ch.snippet.customUrl ? `https://www.youtube.com/${ch.snippet.customUrl}` : `https://www.youtube.com/channel/${ch.id}`;
  return { channel: { title: ch.snippet.title, url }, videos, memberships };
}

// ------------------------------------------------------------------ RSS path

async function fromRss(channel) {
  const id = channel.id || (await scrapeChannelId(channel.url || `https://www.youtube.com/${channel.handle || `user/${channel.username}`}`));
  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`);
  if (!res.ok) throw new Error(`RSS feed request failed (${res.status})`);
  const { title, videos } = parseRssFeed(await res.text());
  return { channel: { title, url: `https://www.youtube.com/channel/${id}` }, videos, memberships: new Map() };
}

// ------------------------------------------------------------------ main

async function main() {
  loadEnv();
  const opts = args();
  const config = readJson(resolve(ROOT, 'store.config.json'), {});
  const overrides = readJson(resolve(ROOT, 'catalog.overrides.json'), {});
  const outPath = resolve(ROOT, opts.out || 'public/catalog.json');

  const channel = parseChannel(opts.channel || config.youtube?.channel);
  if (!channel) {
    console.error('✖ No channel set. Put your friend’s channel (e.g. "@TheirHandle") in store.config.json → youtube.channel,');
    console.error('  or run:  npm run sync -- --channel @TheirHandle');
    process.exit(1);
  }

  const key = process.env.YOUTUBE_API_KEY;
  let data;
  if (key && !opts.rss) data = await fromApi(key, channel);
  else {
    console.warn('⚠ No YOUTUBE_API_KEY found — using the public RSS feed, which only lists the 15 newest uploads.');
    console.warn('  Add a key to .env to shelve the whole channel (see README).');
    data = await fromRss(channel);
  }

  const { catalog, skipped } = buildCatalog({ config, overrides, ...data });
  const { errors, warnings } = validateCatalog(catalog);
  for (const w of warnings) console.warn(`  ⚠ ${w}`);
  if (errors.length) {
    for (const e of errors.slice(0, 20)) console.error(`  ✖ ${e}`);
    throw new Error(`Catalog failed validation (${errors.length} problem${errors.length === 1 ? '' : 's'}); ${outPath} was left unchanged.`);
  }
  writeFileSync(outPath, `${JSON.stringify(catalog, null, 2)}\n`);

  const { videos, aisles } = catalog;
  console.log(`✔ Shelved ${videos.length} tapes across ${aisles.length} aisles → ${outPath}`);
  if (skipped) console.log(`  (skipped ${skipped}: hidden, Shorts or live streams)`);
  for (const a of aisles) console.log(`   • ${a.name}: ${videos.filter((v) => v.aisle === a.id).length}`);
}

main().catch((err) => {
  console.error(`✖ ${err.message}`);
  process.exit(1);
});

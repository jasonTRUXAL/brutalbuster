#!/usr/bin/env node
// Stocks the store: pulls every upload from a YouTube channel and writes public/catalog.json.
//
//   npm run sync                         # uses store.config.json + YOUTUBE_API_KEY from .env
//   npm run sync -- --channel @SomeHandle
//   npm run sync -- --out some/other.json
//
// With a YouTube Data API key it fetches the whole channel (titles, descriptions,
// durations, playlists). Without one it falls back to the channel's public RSS feed,
// which only lists the 15 most recent uploads.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

// ------------------------------------------------------------------ helpers

const slug = (s) =>
  String(s).toLowerCase().trim().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'misc';

function isoDuration(iso) {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || '');
  if (!m) return { text: '', seconds: 0 };
  const [h, mi, s] = [m[1], m[2], m[3]].map((x) => Number(x || 0));
  const seconds = h * 3600 + mi * 60 + s;
  const pad = (n) => String(n).padStart(2, '0');
  return { text: h ? `${h}:${pad(mi)}:${pad(s)}` : `${mi}:${pad(s)}`, seconds };
}

function findYear(...texts) {
  for (const t of texts) {
    const m = /\b(19[2-9]\d|200\d|201\d)\b/.exec(t || '');
    if (m) return Number(m[1]);
  }
  return null;
}

function decodeXml(s) {
  return String(s ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

function trimDescription(d) {
  // Drop link farms / hashtags people paste at the bottom of descriptions.
  const lines = String(d || '')
    .split(/\r?\n/)
    .filter((l) => !/^\s*(#\w+\s*)+$/.test(l) && !/^\s*https?:\/\/\S+\s*$/.test(l));
  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return text.length > 900 ? `${text.slice(0, 900).replace(/\s+\S*$/, '')}…` : text;
}

async function getJson(url) {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = body?.error?.errors?.[0]?.reason || res.status;
    throw new Error(`YouTube API error (${reason}): ${body?.error?.message || res.statusText}`);
  }
  return body;
}

// ------------------------------------------------------------------ channel lookup

function parseChannel(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  if (/^UC[\w-]{22}$/.test(s)) return { id: s };
  if (s.startsWith('@')) return { handle: s };
  try {
    const u = new URL(s.startsWith('http') ? s : `https://${s}`);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts[0]?.startsWith('@')) return { handle: decodeURIComponent(parts[0]) };
    if (parts[0] === 'channel' && parts[1]) return { id: parts[1] };
    if (parts[0] === 'user' && parts[1]) return { username: parts[1], url: u.href };
    if (parts[0] === 'c' && parts[1]) return { url: u.href };
  } catch {
    /* not a URL */
  }
  return { handle: `@${s.replace(/^@/, '')}` };
}

async function scrapeChannelId(url) {
  const res = await fetch(url, { headers: { 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+1' } });
  const html = await res.text();
  const m =
    /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/.exec(html) ||
    /"externalId":"(UC[\w-]{22})"/.exec(html) ||
    /"channelId":"(UC[\w-]{22})"/.exec(html);
  if (!m) throw new Error(`Couldn't find a channel ID at ${url}`);
  return m[1];
}

// ------------------------------------------------------------------ API path

async function fromApi(key, channel) {
  const q = (path, params) => `${API}/${path}?${new URLSearchParams({ ...params, key })}`;
  let ch;
  if (channel.id) ch = (await getJson(q('channels', { part: 'snippet,contentDetails', id: channel.id }))).items?.[0];
  else if (channel.handle) ch = (await getJson(q('channels', { part: 'snippet,contentDetails', forHandle: channel.handle }))).items?.[0];
  else if (channel.username) ch = (await getJson(q('channels', { part: 'snippet,contentDetails', forUsername: channel.username }))).items?.[0];
  if (!ch && channel.url) {
    const id = await scrapeChannelId(channel.url);
    ch = (await getJson(q('channels', { part: 'snippet,contentDetails', id }))).items?.[0];
  }
  if (!ch) throw new Error('Channel not found. Check the "channel" value in store.config.json.');

  const uploads = ch.contentDetails.relatedPlaylists.uploads;
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

  const ids = await playlistVideoIds(uploads);
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
    const page = await getJson(q('playlists', { part: 'snippet,contentDetails', channelId: ch.id, maxResults: 50, ...(pageToken && { pageToken }) }));
    playlists.push(...(page.items || []));
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  const memberships = new Map(); // videoId -> [{ title, size }]
  for (const pl of playlists) {
    const members = await playlistVideoIds(pl.id);
    for (const id of members) {
      if (!memberships.has(id)) memberships.set(id, []);
      memberships.get(id).push({ title: pl.snippet.title, size: members.length });
    }
  }
  console.log(`   ${playlists.length} playlists`);

  return {
    channel: { id: ch.id, title: ch.snippet.title, url: ch.snippet.customUrl ? `https://www.youtube.com/${ch.snippet.customUrl}` : `https://www.youtube.com/channel/${ch.id}` },
    videos,
    memberships,
  };
}

// ------------------------------------------------------------------ RSS path

async function fromRss(channel) {
  let id = channel.id;
  if (!id) {
    const url = channel.url || `https://www.youtube.com/${channel.handle || `user/${channel.username}`}`;
    id = await scrapeChannelId(url);
  }
  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`);
  if (!res.ok) throw new Error(`RSS feed request failed (${res.status})`);
  const xml = await res.text();
  const title = decodeXml(/<title>([\s\S]*?)<\/title>/.exec(xml)?.[1] || 'YouTube channel');
  const videos = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
    youtubeId: /<yt:videoId>([\s\S]*?)<\/yt:videoId>/.exec(e)?.[1],
    title: decodeXml(/<title>([\s\S]*?)<\/title>/.exec(e)?.[1]),
    description: decodeXml(/<media:description>([\s\S]*?)<\/media:description>/.exec(e)?.[1]),
    tags: [],
    publishedAt: /<published>([\s\S]*?)<\/published>/.exec(e)?.[1],
    duration: '',
    seconds: 0,
    shortsLink: /\/shorts\//.test(e),
  }));
  return { channel: { id, title, url: `https://www.youtube.com/channel/${id}` }, videos: videos.filter((v) => v.youtubeId), memberships: new Map() };
}

// ------------------------------------------------------------------ main

async function main() {
  loadEnv();
  const opts = args();
  const config = readJson(resolve(ROOT, 'store.config.json'), {});
  const yt = config.youtube || {};
  const overrides = readJson(resolve(ROOT, 'catalog.overrides.json'), {});
  const outPath = resolve(ROOT, opts.out || 'public/catalog.json');

  const channel = parseChannel(opts.channel || yt.channel);
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

  // ---- aisles
  const aisleRules = (config.aisles || []).map((a) => ({
    ...a,
    id: slug(a.name),
    patterns: (a.match || []).map((m) => new RegExp(`\\b${m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')),
  }));
  const aisles = new Map(aisleRules.map((a) => [a.id, { id: a.id, name: a.name, color: a.color }]));
  const ensureAisle = (name) => {
    const id = slug(name);
    if (!aisles.has(id)) aisles.set(id, { id, name });
    return id;
  };
  const cleanups = (yt.titleCleanup || []).map((r) => new RegExp(r, 'gi'));
  const defaultAisle = yt.defaultAisle || 'Rare Finds';

  const videos = [];
  let skipped = 0;
  for (const v of data.videos) {
    const o = overrides[v.youtubeId] || {};
    if (o.hidden) {
      skipped++;
      continue;
    }
    const looksShort = v.shortsLink || /#shorts?\b/i.test(`${v.title} ${v.description}`) || (v.seconds > 0 && v.seconds <= 60);
    if (yt.skipShorts !== false && looksShort && !o.aisle) {
      skipped++;
      continue;
    }
    if (v.live) {
      skipped++;
      continue;
    }
    let title = v.title;
    for (const re of cleanups) title = title.replace(re, '');
    title = title.trim() || v.title;

    // Aisle priority: manual override → the channel's own playlists (mapped onto a
    // configured aisle when the playlist name matches one) → keywords → default.
    const lists = (data.memberships.get(v.youtubeId) || []).sort((a, b) => a.size - b.size);
    const ruleFor = (text) => aisleRules.find((a) => a.patterns.some((p) => p.test(text)))?.id;
    let aisle = o.aisle ? ensureAisle(o.aisle) : null;
    if (!aisle && yt.aislesFromPlaylists !== false && lists.length) {
      aisle = lists.map((l) => ruleFor(l.title)).find(Boolean) || ensureAisle(lists[0].title);
    }
    if (!aisle) aisle = ruleFor(`${title}\n${v.tags.join(' ')}`);
    if (!aisle) aisle = ensureAisle(defaultAisle);

    videos.push({
      id: v.youtubeId,
      youtubeId: v.youtubeId,
      title: o.title || title,
      description: o.description ?? trimDescription(v.description),
      aisle,
      year: o.year ?? findYear(title, v.description?.split('\n')[0]),
      duration: v.duration,
      publishedAt: v.publishedAt,
    });
  }

  const catalog = {
    source: 'youtube',
    generatedAt: new Date().toISOString(),
    store: {
      ...(config.store || {}),
      channelUrl: data.channel.url,
      channelName: data.channel.title,
    },
    aisles: [...aisles.values()].filter((a) => videos.some((v) => v.aisle === a.id)),
    videos,
  };
  writeFileSync(outPath, `${JSON.stringify(catalog, null, 2)}\n`);

  console.log(`✔ Shelved ${videos.length} tapes across ${catalog.aisles.length} aisles → ${outPath}`);
  if (skipped) console.log(`  (skipped ${skipped}: hidden, Shorts or live streams)`);
  for (const a of catalog.aisles) console.log(`   • ${a.name}: ${videos.filter((v) => v.aisle === a.id).length}`);
}

main().catch((err) => {
  console.error(`✖ ${err.message}`);
  process.exit(1);
});

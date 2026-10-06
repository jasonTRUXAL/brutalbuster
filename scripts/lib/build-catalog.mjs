// Turns raw channel data into a catalog.json object. Pure (no network, no files)
// so the shelving rules can be unit tested.
import { slug, SCHEMA_VERSION } from '../../src/catalog-schema.js';
import { findYear, trimDescription } from './youtube-parse.mjs';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @param {object} p
 * @param {object} p.config      store.config.json
 * @param {object} p.overrides   catalog.overrides.json, keyed by YouTube id
 * @param {{title: string, url: string}} p.channel
 * @param {Array<object>} p.videos  raw videos: { youtubeId, title, description, tags, publishedAt, duration, seconds, live, shortsLink }
 * @param {Map<string, Array<{title: string, size: number}>>} p.memberships  video id -> playlists it's in
 * @param {string} [p.now]       ISO timestamp (injectable for tests)
 * @returns {{ catalog: object, skipped: number }}
 */
export function buildCatalog({ config = {}, overrides = {}, channel, videos: raw, memberships = new Map(), now = new Date().toISOString() }) {
  const yt = config.youtube || {};
  const aisleRules = (config.aisles || []).map((a) => ({
    id: slug(a.name),
    name: a.name,
    color: a.color,
    patterns: (a.match || []).map((m) => new RegExp(`\\b${escapeRe(m)}\\b`, 'i')),
  }));
  const aisles = new Map(aisleRules.map((a) => [a.id, { id: a.id, name: a.name, ...(a.color && { color: a.color }) }]));
  const ensureAisle = (name) => {
    const id = slug(name);
    if (!aisles.has(id)) aisles.set(id, { id, name });
    return id;
  };
  const ruleFor = (text) => aisleRules.find((a) => a.patterns.some((p) => p.test(text)))?.id;
  const cleanups = (yt.titleCleanup || []).map((r) => new RegExp(r, 'gi'));
  const defaultAisle = yt.defaultAisle || 'Rare Finds';

  const videos = [];
  let skipped = 0;
  for (const v of raw) {
    const o = overrides[v.youtubeId] || {};
    const looksShort = v.shortsLink || /#shorts?\b/i.test(`${v.title} ${v.description}`) || (v.seconds > 0 && v.seconds <= 60);
    if (o.hidden || v.live || (yt.skipShorts !== false && looksShort && !o.aisle)) {
      skipped++;
      continue;
    }
    let title = v.title;
    for (const re of cleanups) title = title.replace(re, '');
    title = title.trim() || v.title;

    // Aisle priority: manual override → the channel's own playlists (mapped onto a
    // configured aisle when the playlist name matches one) → keywords → default.
    const lists = (memberships.get(v.youtubeId) || []).slice().sort((a, b) => a.size - b.size);
    let aisle = o.aisle ? ensureAisle(o.aisle) : null;
    if (!aisle && yt.aislesFromPlaylists !== false && lists.length) {
      aisle = lists.map((l) => ruleFor(l.title)).find(Boolean) || ensureAisle(lists[0].title);
    }
    if (!aisle) aisle = ruleFor(`${title}\n${(v.tags || []).join(' ')}`);
    if (!aisle) aisle = ensureAisle(defaultAisle);

    videos.push({
      id: v.youtubeId,
      youtubeId: v.youtubeId,
      title: o.title || title,
      description: o.description ?? trimDescription(v.description),
      aisle,
      year: o.year ?? findYear(title, v.description?.split('\n')[0]),
      duration: v.duration || '',
      publishedAt: v.publishedAt || '',
    });
  }

  const catalog = {
    schemaVersion: SCHEMA_VERSION,
    source: 'youtube',
    generatedAt: now,
    store: {
      ...(config.store || {}),
      channelUrl: channel.url,
      channelName: channel.title,
    },
    aisles: [...aisles.values()].filter((a) => videos.some((v) => v.aisle === a.id)),
    videos,
  };
  return { catalog, skipped };
}

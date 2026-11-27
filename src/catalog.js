// Loads public/catalog.json (written by `npm run sync`, or the bundled sample)
// and normalises it into the shape the store expects. The file format itself is
// defined in catalog-schema.js / docs/catalog-format.md.
import { AISLE_PALETTE } from './config.js';
import { slug, validateCatalog } from './catalog-schema.js';

export { slug };

const DEFAULT_STORE = {
  name: 'BRUTALBUSTER',
  subtitle: 'VIDEO',
  tagline: 'Be Kind, Please Rewind',
  channelUrl: '',
};

export async function loadCatalog(url = 'catalog.json') {
  return normalizeCatalog(await fetchCatalog(url));
}

/** The raw catalog file at `url` (checked against the schema in dev builds). */
export async function fetchCatalog(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
  const raw = await res.json();
  if (import.meta.env?.DEV) {
    const { errors, warnings } = validateCatalog(raw);
    for (const e of errors) console.error(`[catalog] ${url}: ${e}`);
    for (const w of warnings) console.warn(`[catalog] ${url}: ${w}`);
  }
  return raw;
}

export function normalizeCatalog(raw) {
  const store = { ...DEFAULT_STORE, ...(raw.store || {}) };

  const aisles = [];
  const aisleById = new Map();
  const addAisle = (a) => {
    const id = slug(a.id || a.name);
    if (aisleById.has(id)) return aisleById.get(id);
    const aisle = {
      id,
      name: a.name || a.id,
      color: a.color || AISLE_PALETTE[aisles.length % AISLE_PALETTE.length],
    };
    aisles.push(aisle);
    aisleById.set(id, aisle);
    return aisle;
  };
  (raw.aisles || []).forEach(addAisle);

  const seen = new Set();
  const videos = [];
  for (const v of raw.videos || []) {
    const id = String(v.id || v.youtubeId || '').trim();
    if (!id || seen.has(id) || v.hidden) continue;
    seen.add(id);
    const aisle = aisleById.get(slug(v.aisle || '')) || addAisle({ name: v.aisle || 'Rare Finds' });
    videos.push({
      id,
      youtubeId: v.youtubeId ?? null,
      title: String(v.title || 'Untitled Tape').trim(),
      description: String(v.description || '').trim(),
      aisle: aisle.id,
      year: v.year ? Number(v.year) : null,
      duration: v.duration || '',
      publishedAt: v.publishedAt || '',
      // YouTube's 320x180 thumbnail on the shelves (half the download of the 480x360 one,
      // and it looks the same at shelf size); the sharper one for the tape in your hands
      thumb: v.thumb || (v.youtubeId ? `https://i.ytimg.com/vi/${v.youtubeId}/mqdefault.jpg` : null),
      thumbSharp: v.thumb || (v.youtubeId ? `https://i.ytimg.com/vi/${v.youtubeId}/hqdefault.jpg` : null),
    });
  }

  // Drop aisles nobody stocks.
  const used = new Set(videos.map((v) => v.aisle));
  const stocked = aisles.filter((a) => used.has(a.id));

  return {
    store,
    source: raw.source || 'unknown',
    aisles: stocked,
    aisleById: new Map(stocked.map((a) => [a.id, a])),
    videos,
    videoById: new Map(videos.map((v) => [v.id, v])),
    areas: {},
  };
}

/**
 * The rooms with catalogs of their own, besides the sales floor's catalog.json. Each
 * file is written by `npm run sync` from store.config.json → `areas` (same id).
 */
export const AREAS = [{ id: 'streams', name: 'Streams', file: 'streams.json', color: '#b388ff' }];

/**
 * Add another area's catalog (Streams → streams.json) to the sales floor's. Its tapes
 * stay out of `catalog.videos` / `catalog.aisles` (those are the sales floor's), but its
 * aisles and tapes join the lookups, so anything handed one of its tapes (the inspector,
 * the directory) finds its shelf. Aisle ids get the area's prefix ("streams-2026").
 */
export function addArea(catalog, { id, name, color }, raw) {
  const area = normalizeCatalog(raw);
  const aisleId = (a) => `${id}-${a}`;
  const aisles = area.aisles.map((a) => ({ ...a, id: aisleId(a.id), area: id, areaName: name }));
  const videos = area.videos
    .filter((v) => !catalog.videoById.has(v.id))
    .map((v) => ({ ...v, aisle: aisleId(v.aisle), area: id }));
  for (const a of aisles) catalog.aisleById.set(a.id, a);
  for (const v of videos) catalog.videoById.set(v.id, v);
  catalog.areas[id] = { id, name, color, aisles, videos };
  return catalog.areas[id];
}

/** What to call a tape's shelf: "Horror" on the sales floor, "Streams · 2026" elsewhere. */
export const shelfName = (aisle) => [aisle?.areaName, aisle?.name].filter(Boolean).join(' · ');

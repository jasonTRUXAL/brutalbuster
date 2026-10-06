// Loads public/catalog.json (written by `npm run sync`, or the bundled sample)
// and normalises it into the shape the store expects.
import { AISLE_PALETTE } from './config.js';

const DEFAULT_STORE = {
  name: 'BRUTALBUSTER',
  subtitle: 'VIDEO',
  tagline: 'Be Kind, Please Rewind',
  channelUrl: '',
};

export async function loadCatalog(url = 'catalog.json') {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
  return normalizeCatalog(await res.json());
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
      thumb: v.thumb || (v.youtubeId ? `https://i.ytimg.com/vi/${v.youtubeId}/hqdefault.jpg` : null),
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
  };
}

export function slug(s) {
  return String(s).toLowerCase().trim().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'misc';
}

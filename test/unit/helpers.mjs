// Synthetic catalogs for tests.
import { normalizeCatalog } from '../../src/catalog.js';

const AISLES = ['Horror', 'Sci-Fi', 'Cartoons & Kids', 'Educational', 'Home Video', 'Holiday', 'TV Recordings'];

/** A valid raw catalog (catalog.json shape) with `n` videos spread unevenly over `aisleCount` aisles. */
export function rawCatalog(n, aisleCount = 5) {
  const names = Array.from({ length: aisleCount }, (_, i) => AISLES[i] || `Aisle ${i + 1}`);
  const aisles = names.map((name) => ({ id: name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-'), name }));
  const videos = Array.from({ length: n }, (_, i) => ({
    id: `vid-${String(i).padStart(5, '0')}`,
    youtubeId: null,
    title: `Tape Number ${i}`,
    description: 'A test tape.',
    // skew: the first aisle gets ~half, so some aisles are big and some are tiny
    aisle: aisles[i % 2 === 0 ? 0 : (i % aisleCount)].id,
    year: 1980 + (i % 20),
    duration: '30:00',
    publishedAt: new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString(),
  }));
  return { schemaVersion: 1, source: 'test', store: { name: 'TEST' }, aisles, videos };
}

export const catalogOf = (n, aisleCount) => normalizeCatalog(rawCatalog(n, aisleCount));

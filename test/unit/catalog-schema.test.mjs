import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateCatalog, slug } from '../../src/catalog-schema.js';
import { normalizeCatalog } from '../../src/catalog.js';
import { rawCatalog } from './helpers.mjs';

const errorsOf = (cat) => validateCatalog(cat).errors;

test('the bundled sample catalog is valid', () => {
  const cat = JSON.parse(readFileSync(new URL('../../public/catalog.json', import.meta.url), 'utf8'));
  assert.deepEqual(errorsOf(cat), []);
});

test('a synthetic catalog is valid', () => {
  assert.deepEqual(errorsOf(rawCatalog(50)), []);
});

test('rejects an empty store', () => {
  const cat = rawCatalog(3);
  cat.videos = [];
  assert.match(errorsOf(cat).join('\n'), /videos is empty/);
});

test('rejects duplicate ids, unknown aisles and malformed fields', () => {
  const cat = rawCatalog(4);
  cat.videos[1].id = cat.videos[0].id;
  cat.videos[2].aisle = 'nope';
  cat.videos[3].youtubeId = 'short';
  cat.videos[3].duration = '90 minutes';
  cat.videos[3].year = 1987.5;
  const errs = errorsOf(cat).join('\n');
  assert.match(errs, /duplicated/);
  assert.match(errs, /"nope" is not listed in aisles/);
  assert.match(errs, /not an 11-character YouTube ID/);
  assert.match(errs, /duration/);
  assert.match(errs, /year/);
});

test('rejects aisle ids that are not slugs, and bad colours', () => {
  const cat = rawCatalog(2, 1);
  cat.aisles.push({ id: 'Not A Slug', name: 'x' }, { id: 'ok-id', name: 'ok', color: 'red' });
  const errs = errorsOf(cat).join('\n');
  assert.match(errs, /must be a slug/);
  assert.match(errs, /color/);
});

test('rejects an unsupported schemaVersion; warns when missing', () => {
  const cat = rawCatalog(2);
  cat.schemaVersion = 99;
  assert.match(errorsOf(cat).join('\n'), /schemaVersion 99/);
  delete cat.schemaVersion;
  assert.match(validateCatalog(cat).warnings.join('\n'), /schemaVersion missing/);
});

test('slug matches the documented examples', () => {
  assert.equal(slug('Cartoons & Kids'), 'cartoons-and-kids');
  assert.equal(slug('  Sci-Fi!! '), 'sci-fi');
  assert.equal(slug('***'), 'misc');
});

test('normalizeCatalog drops hidden and duplicate videos and unused aisles', () => {
  const raw = rawCatalog(6, 3);
  raw.videos[1].hidden = true;
  raw.videos.push({ ...raw.videos[0] });
  raw.aisles.push({ id: 'empty', name: 'Empty' });
  const cat = normalizeCatalog(raw);
  assert.equal(cat.videos.length, 5);
  assert.ok(!cat.aisleById.has('empty'));
  assert.ok(cat.aisles.every((a) => a.color), 'every aisle gets a colour');
});

test('normalizeCatalog derives thumbnails from youtubeId', () => {
  const raw = rawCatalog(1, 1);
  raw.videos[0].youtubeId = 'dQw4w9WgXcQ';
  assert.equal(normalizeCatalog(raw).videos[0].thumb, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
});

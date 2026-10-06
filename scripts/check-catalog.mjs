#!/usr/bin/env node
// Validates a catalog file against the contract in src/catalog-schema.js.
//
//   npm run check:catalog                    # public/catalog.json
//   npm run check:catalog -- path/to.json
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCatalog } from '../src/catalog-schema.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const file = resolve(ROOT, process.argv[2] || 'public/catalog.json');

let cat;
try {
  cat = JSON.parse(readFileSync(file, 'utf8'));
} catch (err) {
  console.error(`✖ ${file}: ${err.message}`);
  process.exit(1);
}

const { errors, warnings } = validateCatalog(cat);
for (const w of warnings) console.warn(`⚠ ${w}`);
for (const e of errors) console.error(`✖ ${e}`);
if (errors.length) process.exit(1);
console.log(`✔ ${file}: ${cat.videos.length} videos, ${cat.aisles.length} aisles — valid`);

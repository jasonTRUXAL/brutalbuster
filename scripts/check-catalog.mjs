#!/usr/bin/env node
// Validates catalog files against the contract in src/catalog-schema.js.
//
//   npm run check:catalog                    # every area's catalog (public/catalog.json, public/streams.json…)
//   npm run check:catalog -- path/to.json
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCatalog } from '../src/catalog-schema.js';
import { catalogTargets } from './lib/build-catalog.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configFile = resolve(ROOT, 'store.config.json');
const config = existsSync(configFile) ? JSON.parse(readFileSync(configFile, 'utf8')) : {};
const files = process.argv[2] ? [process.argv[2]] : catalogTargets(config).map((a) => a.out);

let failed = false;
for (const f of files) {
  const file = resolve(ROOT, f);
  let cat;
  try {
    cat = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`✖ ${file}: ${err.message}`);
    failed = true;
    continue;
  }
  const { errors, warnings } = validateCatalog(cat);
  for (const w of warnings) console.warn(`⚠ ${f}: ${w}`);
  for (const e of errors) console.error(`✖ ${f}: ${e}`);
  if (errors.length) failed = true;
  else console.log(`✔ ${file}: ${cat.videos.length} videos, ${cat.aisles.length} aisles — valid`);
}
if (failed) process.exit(1);

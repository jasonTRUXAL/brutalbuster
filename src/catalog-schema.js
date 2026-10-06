// The catalog contract: the shape of public/catalog.json, shared by the YouTube
// sync script (which writes it), the store (which reads it) and the tests.
// Plain JS with no browser or Node APIs so every side can import it.
// Human-readable spec: docs/catalog-format.md — keep the two in step.

export const SCHEMA_VERSION = 1;

const YT_ID = /^[\w-]{11}$/;
const HEX = /^#[0-9a-f]{6}$/i;
const DURATION = /^(\d+:)?\d{1,2}:\d{2}$/;

/** Aisle ids are slugs of the aisle name: "Cartoons & Kids" -> "cartoons-and-kids". */
export function slug(s) {
  return String(s).toLowerCase().trim().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'misc';
}

/**
 * Check a parsed catalog against the contract.
 * Errors mean the store would misbehave (or show nothing) — never publish a catalog with errors.
 * Warnings are worth a look but harmless.
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validateCatalog(cat) {
  const errors = [];
  const warnings = [];
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isStr = (v) => typeof v === 'string';

  if (!isObj(cat)) return { errors: ['catalog must be a JSON object'], warnings };

  if (cat.schemaVersion === undefined) warnings.push(`schemaVersion missing (current is ${SCHEMA_VERSION})`);
  else if (cat.schemaVersion !== SCHEMA_VERSION) errors.push(`schemaVersion ${cat.schemaVersion} is not supported (expected ${SCHEMA_VERSION})`);

  if (cat.store !== undefined) {
    if (!isObj(cat.store)) errors.push('store must be an object');
    else {
      for (const k of ['name', 'subtitle', 'tagline', 'channelUrl', 'channelName']) {
        if (cat.store[k] !== undefined && !isStr(cat.store[k])) errors.push(`store.${k} must be a string`);
      }
      if (isStr(cat.store.channelUrl) && cat.store.channelUrl && !/^https:\/\//.test(cat.store.channelUrl)) {
        errors.push('store.channelUrl must be an https:// URL (or empty)');
      }
    }
  }

  // aisles
  const aisleIds = new Set();
  if (!Array.isArray(cat.aisles)) errors.push('aisles must be an array');
  else {
    cat.aisles.forEach((a, i) => {
      const at = `aisles[${i}]`;
      if (!isObj(a)) return errors.push(`${at} must be an object`);
      if (!isStr(a.id) || !a.id) errors.push(`${at}.id is required`);
      else if (a.id !== slug(a.id)) errors.push(`${at}.id "${a.id}" must be a slug (lowercase, a-z0-9 and dashes)`);
      else if (aisleIds.has(a.id)) errors.push(`${at}.id "${a.id}" is duplicated`);
      else aisleIds.add(a.id);
      if (!isStr(a.name) || !a.name.trim()) errors.push(`${at}.name is required`);
      if (a.color !== undefined && !(isStr(a.color) && HEX.test(a.color))) errors.push(`${at}.color must look like "#ff3b3b"`);
    });
  }

  // videos
  if (!Array.isArray(cat.videos)) errors.push('videos must be an array');
  else {
    if (!cat.videos.length) errors.push('videos is empty — refusing an empty store');
    const ids = new Set();
    const usedAisles = new Set();
    let unlinked = 0;
    cat.videos.forEach((v, i) => {
      const at = `videos[${i}]`;
      if (!isObj(v)) return errors.push(`${at} must be an object`);
      if (!isStr(v.id) || !v.id.trim()) errors.push(`${at}.id is required`);
      else if (ids.has(v.id)) errors.push(`${at}.id "${v.id}" is duplicated`);
      else ids.add(v.id);
      if (v.youtubeId === null || v.youtubeId === undefined) unlinked++;
      else if (!(isStr(v.youtubeId) && YT_ID.test(v.youtubeId))) errors.push(`${at}.youtubeId "${v.youtubeId}" is not an 11-character YouTube ID`);
      if (!isStr(v.title) || !v.title.trim()) errors.push(`${at}.title is required`);
      if (v.description !== undefined && !isStr(v.description)) errors.push(`${at}.description must be a string`);
      if (!isStr(v.aisle) || !v.aisle) errors.push(`${at}.aisle is required`);
      else if (Array.isArray(cat.aisles) && !aisleIds.has(v.aisle)) errors.push(`${at}.aisle "${v.aisle}" is not listed in aisles`);
      else usedAisles.add(v.aisle);
      if (v.year !== undefined && v.year !== null && !(Number.isInteger(v.year) && v.year >= 1880 && v.year <= 2100)) {
        errors.push(`${at}.year must be a whole year or null`);
      }
      if (v.duration !== undefined && v.duration !== '' && !(isStr(v.duration) && DURATION.test(v.duration))) {
        errors.push(`${at}.duration "${v.duration}" must look like "28:14" or "1:02:03"`);
      }
      if (v.publishedAt !== undefined && v.publishedAt !== '' && Number.isNaN(Date.parse(v.publishedAt))) {
        errors.push(`${at}.publishedAt must be an ISO date`);
      }
      if (v.thumb !== undefined && v.thumb !== null && !(isStr(v.thumb) && /^https:\/\//.test(v.thumb))) {
        errors.push(`${at}.thumb must be an https:// URL`);
      }
      if (v.hidden !== undefined && typeof v.hidden !== 'boolean') errors.push(`${at}.hidden must be true or false`);
    });
    if (unlinked) warnings.push(`${unlinked} video(s) have no youtubeId and can't be watched (fine for the sample catalog)`);
    for (const id of aisleIds) if (!usedAisles.has(id)) warnings.push(`aisle "${id}" has no videos and won't be shown`);
  }

  return { errors, warnings };
}

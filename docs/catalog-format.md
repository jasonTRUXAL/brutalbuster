# Catalog format (`public/catalog.json`)

`catalog.json` is the hand-off between the two halves of the project:

- the **content pipeline** (`npm run sync`, `scripts/`) writes it from the YouTube channel
- the **store** (`src/`) reads it at startup and builds the shelves from it

As long as both sides stick to this format, either one can change without breaking the other. The machine-checked version of these rules is `src/catalog-schema.js`. If you change the format, update this file, the validator, and its tests together.

Check any file against the rules with:

```bash
npm run check:catalog                 # public/catalog.json
npm run check:catalog -- some/file.json
```

`npm run sync` runs the same check before writing, and leaves the existing catalog untouched if the new one fails. That way a bad or empty YouTube response can never empty the store.

## Current version: `schemaVersion: 1`

```jsonc
{
  "schemaVersion": 1,                 // required for new files; bump on breaking changes
  "source": "youtube",                // informational: "youtube" | "sample" | anything
  "generatedAt": "2026-10-06T09:17:00Z",

  "store": {                          // optional; branding shown on signs, splash, box art
    "name": "BRUTALBUSTER",
    "subtitle": "VIDEO",
    "tagline": "Be Kind, Please Rewind",
    "channelUrl": "https://www.youtube.com/@TheirHandle",   // https:// or ""
    "channelName": "Their Channel"
  },

  "aisles": [                         // one entry per genre aisle, in shelving order
    { "id": "horror", "name": "Horror", "color": "#b388ff" }
  ],

  "videos": [
    {
      "id": "dQw4w9WgXcQ",            // unique; the YouTube id for real videos
      "youtubeId": "dQw4w9WgXcQ",     // 11-char YouTube id, or null (can't be watched)
      "title": "Night of the Gravedigger",
      "description": "Shown on the back of the box…",
      "aisle": "horror",              // must match an aisles[].id
      "year": 1964,                   // production year (not upload year), or null
      "duration": "1:16:20",          // "m:ss" or "h:mm:ss", or ""
      "publishedAt": "2026-03-02T18:00:00Z",   // ISO date or ""; newest go on the New Releases wall
      "thumb": "https://…",           // optional; defaults to the YouTube hqdefault thumbnail
      "hidden": false                 // optional; true = left off the shelves
    }
  ]
}
```

## Rules

**Errors.** The store would misbehave, so the file must not be published:

- `videos` is missing or empty
- a video has no `id` or `title`, or two videos share an `id`
- `video.aisle` doesn't match any `aisles[].id`
- `youtubeId` isn't null and isn't an 11-character YouTube id
- `aisles[].id` isn't a slug, or is duplicated
- malformed `color` (`#rrggbb`), `year` (whole number 1880–2100), `duration`, `publishedAt`, `thumb` (https), or `store.channelUrl` (https)
- an unsupported `schemaVersion`

**Warnings.** Harmless, but worth knowing about:

- `schemaVersion` missing
- videos without a `youtubeId` (expected in the sample catalog)
- aisles with no videos (the store hides them)

## Slugs

Aisle ids are slugs of the aisle name: lowercase, `&` becomes `and`, and any run of other characters becomes `-`. So `"Cartoons & Kids"` becomes `"cartoons-and-kids"`. Use `slug()` from `src/catalog-schema.js` rather than re-implementing it.

## What the store does with it

`src/catalog.js` `normalizeCatalog()` is lenient on purpose. It drops hidden and duplicate videos, gives colourless aisles a palette colour, removes empty aisles, and fills in `thumb`. The validator is strict on purpose. Producers should satisfy the validator; the store tolerates anything that slips through.

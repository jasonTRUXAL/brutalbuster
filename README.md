# Brutalbuster Video

A walk-in, first-person 1990s video rental store that runs in the browser. Every tape on the shelves is a video from one YouTube channel — VHS transfers of public-domain and otherwise unavailable tapes — shelved by genre, face-out, with procedurally generated box art built from each video's thumbnail.

Walk the aisles, pick a box up off the shelf, turn it over to read the back, and hit **Watch now** to play it on an in-store CRT.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:5173. The repo ships with a **sample catalog** of 71 made-up tapes so the store isn't empty; none of them are linked to real videos yet.

## Stocking the shelves from the YouTube channel

1. Put the channel in `store.config.json` → `youtube.channel`. Any of these work: `"@TheirHandle"`, `"https://www.youtube.com/@TheirHandle"`, or a `UC…` channel ID.
2. *(Recommended)* Get a free YouTube Data API key:
   - https://console.cloud.google.com → create a project
   - **APIs & Services → Library** → enable **YouTube Data API v3**
   - **Credentials → Create credentials → API key**
   - Copy `.env.example` to `.env` and paste the key after `YOUTUBE_API_KEY=`
3. Run:

   ```bash
   npm run sync
   ```

   This rewrites `public/catalog.json` with every public upload on the channel: title, description, runtime, publish date and thumbnail. Shorts and live streams are skipped. The new catalog is checked against the [catalog format](docs/catalog-format.md) before it's written; if it fails, the old one is kept.

Without an API key the sync still works, but it falls back to the channel's public RSS feed, which only lists the **15 newest** uploads. The key is used at build time only and never reaches the browser.

To preview a catalog before replacing the live one, write it somewhere else and load it with `?catalog=`:

```bash
npm run sync -- --out public/_preview.json
# then open http://localhost:5173/?catalog=_preview.json   (dev server only)
```

### How tapes get sorted into aisles

For each video, in this order:

1. **Manual override.** Copy `catalog.overrides.example.json` to `catalog.overrides.json` and key entries by YouTube video ID. You can set `aisle`, `title`, `year`, `description`, or `hidden: true`.
2. **The channel's own playlists.** A playlist whose name matches one of the configured aisles' keywords goes to that aisle (so "Horror Tapes" goes to *Horror*). Otherwise the playlist name becomes an aisle of its own.
3. **Keywords** in the title and tags, using the `match` lists under `aisles` in `store.config.json`.
4. Anything else goes to the default aisle, `Rare Finds`.

Aisle colours come from `store.config.json`. Years are pulled from the title or the first line of the description (for example "Aerobics Tape (1987)"), since the upload date isn't when the tape was made.

### Branding

The store name, subtitle and tagline are under `store` in `store.config.json`. They appear on the neon sign, splash screen, box art and TV. Run `npm run sync` after changing them.

## Controls

| | Desktop | Phone / tablet |
|---|---|---|
| Walk | `W A S D` / arrow keys (`Shift` to hurry) | drag on the left half |
| Look | mouse | drag on the right half |
| Pick up a tape | click (or `E`) | tap it |
| Turn the box over | `Space`, drag it, or **Flip box** | drag or tap it |
| Watch | `Enter` or **Watch now** | **Watch now** |
| Put it back | `Esc` | **Put back** |
| Find a title | `F` | **Find a tape** |
| Play a prize-corner machine | aim at it and click (or `E`) | tap it |
| Turn the gacha crank | `Space`, or **Turn the crank** | **Turn the crank** |
| Shoot pachinko balls | hold `Space` or the mouse; `←` `→` set launch power | hold **Hold to shoot**; drag the power slider |
| Stand back up | `Esc`, or **Stand up** | **Stand up** |

If the browser won't allow pointer lock (some embedded frames block it), the store switches to drag-to-look automatically.

### The prize corner

The prize corner is by the entrance: four capsule-toy (gacha) machines along the front window and a pachinko machine in the corner. Click one and the camera crouches down to the gacha, or sits you on the pachinko stool.

- **Gacha:** the crank turns, a capsule drops out, floats up and pops open. Each machine's pile shrinks as you play and refills when empty.
- **Pachinko:** real ball physics. Power decides where balls enter the board: weak shots drop in on the left, strong ones carry over to the right, and too strong goes straight down the right side. START (fed by the slanted "ways" under the screen) spins the reels, the tulips pay a few balls, and three of a kind is FEVER (+50 balls). It's free play, so an empty tray refills.

Every capsule and jackpot fires a `bb:prize` browser event. The always-win reward system (what's actually inside) will plug in there.

## How the store is built

The building sizes itself to the catalog. `src/layout.js` picks the number and length of aisles needed to hold every title, then fills them:

- **Genre aisles** use double-sided gondolas plus the side walls, and run in a snake so neighbouring genres share an aisle. Titles are alphabetical, with copies side by side like a real rental store (up to four per title).
- **The back wall is New Releases**: the newest uploads, several copies each.
- **Endcaps** each spotlight one random tape.
- **Leftover shelf space** becomes themed sections (Staff Picks, Cult Corner, Late Night…) stocked with a random mix of the catalog.

Everything is generated in code. There are no 3D models or image files: box art, carpet, signage and neon are all painted on `<canvas>`. All covers are packed into a few texture atlases and drawn with GPU instancing, so even a few thousand tapes take only a handful of draw calls.

```
src/
  main.js        app state machine, render loop, picking
  catalog-schema.js  the catalog.json contract (shared with the sync script)
  layout.js      floor-plan solver: store size, shelf runs, which tape goes where
  store.js       room, shelving, signs, checkout counter, entrance, lights
  tapes.js       instanced VHS cases + cover sleeves
  atlas.js       cover texture atlas
  covers.js      box art generator (front, back, spine) + thumbnail loading
  textures.js    carpet, ceiling tiles, signs, neon
  inspect.js     the picked-up tape (fly-in animation, spin, flip)
  controls.js    first-person movement, collision, touch joystick
  crt.js         the TV above the counter
  prizes.js      prize-corner props: gacha machines and the pachinko cabinet
  arcade.js      hit-testing machines, crouch/sit camera, routing input to a game
  gacha.js       gacha play: crank, capsule drop and open
  pachinko.js    pachinko play: firing, reels, FEVER, ball tray
  pachinko-physics.js  board layout + 2D ball physics (pure, unit tested)
  ui.js          splash, HUD, details panel, player, directory
scripts/
  sync-youtube.mjs   builds public/catalog.json from the channel (network + files)
  lib/               parsing and shelving rules (pure, unit tested)
  check-catalog.mjs  validates a catalog file
test/
  unit/          node --test: catalog contract, YouTube parsing, layout invariants
  smoke/         Playwright: loads the real store and walks the core flows
```

## Development and tests

```bash
npm run check
```

This runs everything: lint, the catalog check, unit tests, a production build, and browser smoke tests that open the store headlessly (using the Edge or Chrome already installed) and pick up, flip, find and play a tape. It takes about 30 seconds. `npm run check:fast` skips the build and browser tests. GitHub runs the full check on every push.

[CLAUDE.md](CLAUDE.md) explains how the code is organised for anyone, human or AI, working on it.

## Putting it online

It's a static site: `npm run build` produces a `dist/` folder you can host anywhere (GitHub Pages, Netlify, Cloudflare Pages, any web host).

**GitHub Pages with automatic restocking** (already set up in `.github/workflows/deploy.yml`):

1. Push this folder to a GitHub repository (branch `main`).
2. **Settings → Pages → Source: GitHub Actions.**
3. **Settings → Secrets and variables → Actions → New repository secret:** `YOUTUBE_API_KEY`.
4. The workflow builds and deploys on every push and **re-syncs the channel daily**, so new uploads show up on the shelves without anyone touching the code. You can also trigger it by hand from the Actions tab.

**Netlify or Cloudflare Pages:** use build command `npm run build` and output directory `dist`. To restock, run `npm run sync` locally and push, or add the sync to the build command (`npm run sync && npm run build`) with `YOUTUBE_API_KEY` set as an environment variable.

## What's next

- **Viewing experience.** Right now **Watch now** opens a YouTube embed inside a CRT-styled frame. Possible next steps: play the tape on a TV inside the 3D store, add a "rewinding…" insert animation, or build a couch-and-TV viewing room.
- Ambient store audio (fluorescent hum, muzak, the clack of a case).
- A rentals counter that remembers what you've watched.

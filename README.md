# Brutalbuster Video

A walk-in, first-person 1990s video rental store that runs in the browser. Every tape on the shelves is a video from one YouTube channel — VHS transfers of public-domain and otherwise unavailable tapes — shelved by genre, face-out, with procedurally generated box art built from each video's thumbnail.

Walk the aisles, pick a box up off the shelf and turn it over to read the back. **View on YouTube** opens it there, or **Grab** it, carry it to the VCR in the lounge, and watch it on the big screen.

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

   It also restocks the other areas listed under `areas` in `store.config.json`, each from its own channel into its own file. Right now that's **Streams**, from [moose2](https://www.youtube.com/moose2), into `public/streams.json`, shelved by the year each stream went up. `npm run sync -- --area streams` restocks just that one. If one area fails, its old file is kept and the others still update.

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

The store name, subtitle and tagline are under `store` in `store.config.json`. They appear on the neon sign, splash screen and box art. Run `npm run sync` after changing them.

## Controls

| | Desktop | Phone / tablet |
|---|---|---|
| Walk | `W A S D` / arrow keys (`Shift` to hurry) | drag on the left half |
| Look | mouse | drag on the right half |
| Pick up a tape | click (or `E`) | tap it |
| Turn the box over | `Space`, drag it, or **Flip box** | drag or tap it |
| Take it with you | `G` or **Grab** | **Grab** |
| Watch it on YouTube | **View on YouTube** | **View on YouTube** |
| Put it back | `Esc` | **Put back** |
| Put the tape in the lounge's VCR | walk up to it holding a tape, click (or `E`) | walk up to it, tap |
| Sit on a couch | aim at it and click (or `E`) | tap it |
| Find a title | `F` | **Find a tape** |
| Play a prize-corner machine | aim at it and click (or `E`) | tap it |
| Turn the gacha crank | `Space`, or **Turn the crank** | **Turn the crank** |
| Lucky Hit: aim, then drop | aim with the mouse or `←` `→`; `Space` or click to drop | drag the **Drop spot** slider; tap **Drop** |
| Stand back up | `Esc`, **Stand up**, or start walking | **Stand up** |
| PS1 Mode on / off | `P`, or **PS1 mode** | **PS1** |

If the browser won't allow pointer lock (some embedded frames block it), the store switches to drag-to-look automatically.

### PS1 Mode

**PS1 mode** (top right, or `P`) draws the store like a 1995 PlayStation game: a 240-line picture with chunky pixels, wobbly polygons, warping and point-sampled textures, the console's 15-bit dithered colour, and distance fog. The video thumbnails are left alone: box covers, posters, the standee, the counter TV and the tape in your hands are drawn again at full resolution on top, so you can still tell every tape apart. The choice is remembered on that browser. `?ps1` and `?ps1=0` in the address turn it on or off for one visit.

### The prize corner

The prize corner is by the entrance: four capsule-toy (gacha) machines along the front window, and a Lucky Hit stall (the street drop board from Shenmue) in the corner. Click one and the camera crouches down to the gacha, or steps you up to the stall's table.

- **Gacha:** the crank turns, a capsule drops out, floats up and pops open. Each machine's pile shrinks as you play and refills when empty.
- **Lucky Hit:** pick a spot along the top, let go, and one ball drifts slowly down through the nails (about 4 seconds) into a prize slot. Every slot wins something themed like the gacha machines. One narrow gold slot is the jackpot (about 4% of drops), saved for rarer prizes.
- **Board of the day:** the nail pattern (Classic, Diamonds, Chevrons, Spiral, Zigzag, Moose, Scatter), the slot order and the jackpot's position change every day (UTC), the same for everyone. A chalkboard on the table shows today's board number. Before a board is used, the game plays it by simulation and rejects it if any ball could get stuck, any slot couldn't be won, or the jackpot is too easy. A fixed, tested Classic board stands in if no variant passes. The unit tests check a full year of boards ahead of time.

Every capsule and jackpot fires a `bb:prize` browser event. The always-win reward system (what's actually inside) will plug in there.

### The rooms off the sales floor

- **The lounge.** A hallway in the left wall, near the front (under the pink **LOUNGE** sign), leads to a living-room-style lounge: two couches facing a projector screen, with curtains, a popcorn machine and a floor lamp. There's a VCR in the cabinet under the screen, its clock blinking 12:00. Pick a tape up anywhere in the store, **Grab** it (it rides along at the bottom of your view), and walk up to the VCR: it asks for the tape. Put it in and the VCR starts it the old way, in about seven seconds: black, then the blue screen full of static while it auto-tracks, then the tape's title, the date it went up and its length, and a blip into the video. It keeps playing while you walk round (fainter as you go). Put another tape in and the first goes back on its shelf, as it does when the tape ends. With nothing in, a VHS logo bounces round the screen. You can sit on either couch (three seats each); that's all sitting does.
- **Streams.** Through the archway at the back of the lounge (under the **ON AIR** sign) is Streams: every stream from [moose2](https://www.youtube.com/moose2), shelved by the year it went up, newest year first. Within a year the tapes run in the order they were uploaded, so a playthrough's parts read left to right, Part One to Finale. Start on the gondola in the middle (this year and last), then go round the walls. The gondola's front end shows the latest stream. Pick up, flip and grab work the same as on the sales floor, and **Find a tape** has a **Streams** button.
- **Extras.** A door in the back right-hand corner, past New Releases, leads to the Extras back room.

Extras has empty **Coming Soon** shelves (and a few boxes of stock) until its videos are chosen. See [docs/roadmap.md](docs/roadmap.md).

## How the store is built

The building sizes itself to the catalog. `src/layout.js` picks the number and length of aisles needed to hold every title, then fills them:

- **Genre aisles** use double-sided gondolas plus the side walls, and run in a snake so neighbouring genres share an aisle. Titles are alphabetical, with copies side by side like a real rental store (up to four per title).
- **The back wall is New Releases**: the newest uploads, several copies each.
- **Endcaps** each spotlight one random tape.
- **Leftover shelf space** becomes themed sections (Staff Picks, Cult Corner, Late Night…) stocked with a random mix of the catalog.
- **The other rooms** (hallway, lounge, Streams, Extras) are placed relative to the sales floor, so they move with it as it grows. Streams also runs further back, a bay at a time, when its own catalog needs more shelf.
- **Rooms out of sight aren't drawn.** A room off the sales floor is only drawn while a doorway leading to it is in view, so the wing costs nothing from the front door.

Everything is generated in code. There are no 3D models or image files: box art, carpet, signage and neon are all painted on `<canvas>`. All covers are packed into a few texture atlases and drawn with GPU instancing, so even a few thousand tapes take only a handful of draw calls.

```
src/
  main.js        app state machine, render loop, picking
  catalog-schema.js  the catalog.json contract (shared with the sync script)
  layout.js      floor-plan solver: store size, shelf runs, which tape goes where, the other rooms and every wall
  store.js       the sales floor: room, shelving, signs, checkout counter, entrance, lights
  rooms.js       the rooms off it: hallway, lounge and Streams wing, Extras back room
  lounge.js      the lounge: couches, projector, screen (bouncing logo / blue PLAY / clear), the VCR
  fixtures.js    building blocks shared by both: batching, walls, floors, shelving, signs, posters
  tapes.js       instanced VHS cases + cover sleeves
  atlas.js       cover texture atlas
  covers.js      box art generator (front, back, spine) + thumbnail loading
  textures.js    carpet, ceiling tiles, signs, neon
  inspect.js     the picked-up tape (fly-in animation, spin, flip) and the one you're carrying
  ps1.js         PS1 Mode: low-res render, shader patches, sharp thumbnail pass
  controls.js    first-person movement, collision, touch joystick
  crt.js         the TV above the counter
  prizes.js      prize-corner props: gacha machines and the Lucky Hit stall
  arcade.js      hit-testing machines, crouch/sit camera, routing input to a game
  gacha.js       gacha play: crank, capsule drop and open
  luckyhit.js    Lucky Hit play: aiming, the drop, landing and the prize
  luckyhit-physics.js  board of the day + 2D ball physics + the daily check (pure, unit tested)
  theater.js     the lounge working: the VCR, the YouTube player lined up behind the screen, the couches
  ui.js          splash, HUD, details panel, the couch's Stand up, directory
scripts/
  sync-youtube.mjs   builds public/catalog.json from the channel (network + files)
  lib/               parsing and shelving rules (pure, unit tested)
  check-catalog.mjs  validates a catalog file
test/
  unit/          node --test: catalog contract, YouTube parsing, layout invariants, PS1 shader patches
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

- **The lounge VCR.** Possible next steps: a way to eject a tape without putting another in, a "rewinding…" pause, or picking up where you left off.
- **Stock Extras** once its list is ready.
- Ambient store audio (fluorescent hum, muzak, the clack of a case).
- A rentals counter that remembers what you've watched.

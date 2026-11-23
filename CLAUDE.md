# Brutalbuster Video

A first-person 1990s video rental store that runs in the browser. Its shelves hold only the videos from one YouTube channel, [brutalmoose](https://www.youtube.com/brutalmoose) (set in `store.config.json`). Built with Vite and Three.js in plain ES modules: no framework, no TypeScript, and no 3D models or image assets. Everything is painted procedurally on `<canvas>`. The README is the user-facing guide; this file is for working on the code. Where the project is headed (theater room, streaming-archive area, VHS vault) and the content decisions so far are in `docs/roadmap.md` and `docs/channel-notes.md`. Read them before changing what gets shelved.

## Commands

```bash
npm run dev            # http://localhost:5173 (exposes window.__bb test hooks)
npm run check          # everything CI runs: lint, catalog, unit, build, browser smoke (~30s)
npm run check:fast     # lint + catalog contract + unit tests (~2s), for quick feedback
npm test               # unit tests only (node --test, no browser)
npm run test:smoke     # Playwright against the dev server, using installed Edge/Chrome
npm run sync           # rebuild public/catalog.json and each area's catalog (public/streams.json) from YouTube
```

Run `npm run check` before committing. CI (`.github/workflows/ci.yml`) runs the same steps on every push and PR.

## Workstreams and their boundaries

Each area can change independently as long as it keeps its contract with the others.

| Workstream | Owns | Contract with the rest |
|---|---|---|
| **Content pipeline** | `scripts/`, `store.config.json`, `catalog.overrides.json` | Writes `public/catalog.json` (sales floor) and one file per `areas` entry (`public/streams.json`), all per `docs/catalog-format.md` and validated by `src/catalog-schema.js` |
| **The store (world)** | `layout.js`, `store.js`, `fixtures.js` (shared building blocks), `rooms.js` (hallway, Streams, Extras, room culling), `lounge.js`, `tapes.js`, `atlas.js`, `covers.js`, `textures.js`, `crt.js`, `config.js`, `prizes.js` (prize-corner props), `seasons.js` (decorations), `calendar.js` (pure: time of day, season) | Reads the normalized catalog; exposes `plan.slots`, `TapeShelves` and `store.colliders` to `main.js` |
| **PS1 Mode** | `ps1.js` | Draws any scene in the PS1 style. Relies on two material flags set by the world (see Conventions); `main.js` and `inspect.js` call its render methods |
| **Interaction and viewing** | `main.js` (state machine), `controls.js` (walking, crouching), `inspect.js` (the held tape, and the one you've grabbed and are carrying), `theater.js` (the lounge's VCR and its remote, the YouTube player behind the screen, the couches), `ui.js`, `style.css`, `index.html`, `audio.js` (all the sound, made in code: one-offs via `audio.play(name)` or a `bb:sound` window event) | Modes are `splash`, `walk`, `paused`, `inspect`, `directory`, `card` (the membership card), `play`, `sit`. Videos play only on the lounge screen (or on YouTube, from **View on YouTube**) |
| **Membership and tokens** | `membership.js` (pure: the rules in `REWARDS`, kept in `localStorage` as `bb.member`) | Pays out for the day's visit and streak (on Enter), lounge watching (`watch(dt)` from the loop while a tape plays) and finished tapes; `spend()` is there for the prize corner |
| **Prize-corner games** | `arcade.js` (hit-testing, crouch/sit camera), `gacha.js`, `luckyhit.js`, `luckyhit-physics.js`, `arcade-ui.js` | Games get their props from `prizes.js`; every win fires a `bb:prize` window event, which is where the reward system plugs in |
| **Hosting and ops** | `.github/workflows/`, `vite.config.js`, `package.json` | Static `dist/`; daily restock through `deploy.yml` |

The shared, environment-neutral modules are `src/catalog-schema.js` (imported by Node and the browser, so no DOM or Node APIs), `src/layout.js`, `src/catalog.js`, `src/config.js` and `src/luckyhit-physics.js`. `luckyhit-physics.js` is the single definition of the Lucky Hit board (`LUCKY` sizes, `boardForDay()`, the physics and `validateBoard()`): the painted board, the 3D nails and the simulation all read it, so change it there. Every daily board is played by simulation before use. If you change the patterns or physics, run `test/unit/luckyhit.test.mjs`, which checks a year of boards. Nails must stay at least `MIN_GAP` apart, because a ball cradled between two nails never lands. They're all pure, which is what lets them be unit tested.

## How a frame of the store comes together

`main.js` boots in this order: load fonts, then the catalog (`catalog.js`) plus each area's (`AREAS`: Streams' `streams.json`, attached with `addArea()`: its tapes join the lookups but not `catalog.videos`), then `planStore()` (`layout.js`: sizes the building to the catalog, assigns every tape a slot). The same plan places the rooms off the sales floor (hallway, lounge, Streams, Extras) relative to it, and lists every wall (`plan.walls`, with their openings) and every collider. Then `CoverAtlas` paints every box cover into a few 2048² canvases. Streams is stocked by `planAnnex()` from the area catalog: a section per aisle (year), in upload order, the room growing back a bay at a time until they fit. A game's run of streams is one box set (`findBoxSets()` in `boxsets.js`, from the titles), shelved `BOX_SPAN` slots wide. Its tapes are still slots, all at the box's position, with `slot.box` / `slot.part` set, and are never drawn: `BoxSetShelves` (`tapes.js`) draws the boxes (`plan.boxes`), and picking one up takes out its first tape. Its slots are appended to `plan.slots`, so every room's tapes are one set. Then `TapeShelves` draws all tapes with 1 instanced draw call for the cases plus 1 per atlas page, and `buildStore()` merges the static fixtures per material (`Batcher` in `fixtures.js`). It calls `buildAnnex()` (`rooms.js`) for the other rooms, each batched into its own group. `RoomCulling` hides a room's group, and the cover pages that only hold its tapes, while no doorway to it is in view (`plan.portals`, `visibleRooms()` in `layout.js`). Furniture footprints live in the plan, not the builders, so `walkFrom()` (a flood fill in `layout.js`) can prove in the tests that every room can be walked to and the building is sealed. Thumbnails stream in afterwards and repaint atlas cells. `atlas.flush()` uploads them, throttled.

The picked-up tape is rendered in a separate overlay scene (`inspect.js`) over the dimmed store. The tape on the shelf is hidden by zero-scaling its instance. **Grab** keeps it in that scene, at the bottom of the view, while you walk; its slot stays empty while you carry it and while it's in the lounge's VCR.

**The lounge screen.** A YouTube video can't be drawn into WebGL, so `theater.js` puts the real player in the page *behind* the canvas, lined up with the screen by three.js's `CSS3DRenderer`. While it plays, the screen mesh (`ProjectorScreen` in `lounge.js`, 'video' mode) writes alpha 0, so the canvas (created with `alpha: true`) is see-through exactly where the screen shows, and anything in front still hides the video. So a transparent material that can be drawn in front of that screen must leave the canvas's alpha alone (custom blending with `blendSrcAlpha: ZeroFactor, blendDstAlpha: OneFactor`, like the projector beam), and PS1 Mode copies its low-res picture's alpha straight through (`_blit`). There's **one** player iframe, made empty (`/embed/?enablejsapi=1`) by `theater.prepare()` while the store loads on a computer (on the first tape on a touchscreen). Putting a tape in only posts `cueVideoById`, so nothing is added to the page mid-walk, and the VCR takes the tape on mouse-up. A tape starts with the VCR intro (`INTRO` in `lounge.js`, about 7 s); at the end `theater.js` sends `playVideo` and blips the screen open once the player says it's playing. The remote (rewind, pause, subtitles) is `theater.rewind()` / `togglePause()` / `toggleCaptions()`; it only works once the player has answered (`controllable`). Starting it, the volume and "the tape has ended" go over YouTube's embed `postMessage` protocol, with no API script. The iframe is `inert`: it must never take the focus, because a frame taking focus makes the browser let go of the pointer lock.

## Conventions

- **Units are metres.** Every physical dimension lives in `DIM` in `config.js`, and brand colours in `BRAND`. Don't hard-code sizes elsewhere.
- **Keep draw calls low.** Add many repeated objects as instances or through the `Batcher`, never as one mesh each. Plain-coloured props can share one vertex-coloured material through `Batcher.paint()` (the lounge does). Check with `renderer.info.render.calls`: the live store is about 96 from the door (the rooms off it are culled there), about 60 inside Streams. Picking is a per-frame cost too: `TapeShelves.hit()` only tests tapes within reach, so don't go back to raycasting the instanced mesh (2 ms a frame with ~2,200 tapes).
- **Deterministic.** Any randomness is seeded (`rng(hash(...))` from `util.js`) so the store looks the same on every load and tests are stable.
- **Canvas art is drawn on a design grid.** Covers are laid out on 160×280 and scaled by `s = width / 160`, so one function draws both the atlas thumbnail and the 512px held tape. Webfonts must be loaded (`loadFonts()`) before any canvas text is drawn.
- **Textures go through `toTexture()`.** It handles sRGB, anisotropy and mipmaps.
- **PS1 Mode flags.** A material that shows a video thumbnail sets `material.userData.thumbnail = true`: PS1 Mode leaves its texture alone and redraws it sharp. A flat layer sitting a few mm in front of another surface (signs, cards, the doormat) sets `material.userData.decal = true`, so it doesn't sink into its backing when vertices snap. New textured surfaces bigger than about a metre should be split into tiles (`tiledPlane()`, or `Batcher.box` does it for textured boxes), because PS1 Mode's affine texture mapping warps large polygons. Custom `ShaderMaterial`s are left out of PS1 Mode.
- **Comments:** a short header per module saying why it exists, plus brief notes on anything non-obvious. Match the surrounding density.
- **Files are LF** (`.gitattributes`). The dev machine is Windows, so use forward slashes in scripts.

## Verifying changes in a browser

- **Dev hooks.** In dev builds `window.__bb` exposes `plan`, `catalog`, `camera`, `controls`, `tapes`, `inspector`, `renderer`, `ps1`, `culling`, `theater`, `setPS1(on)`, `setMode()`, `pickUp(slot)`, `putBack()`, `grab()`, `insertTape()`, `sitDown(seat)`, `standUp()`, `emptyHands()` (drop what you carry, empty the VCR), `goToVideo(id)`, `raySlot(ndc)`, `aim(ndc)`, `mode`, `hovered`, `target`, `carried`, `inVcr` and `remoteShown`. **`__bb.advance(seconds)`** steps the simulation deterministically and renders once. Use it whenever frames aren't flowing, for example in a hidden or background browser pane where `requestAnimationFrame` is throttled. `?manual` turns off the render loop entirely (the smoke tests use it). CI has no GPU, so rendering is all in software there; reproduce that locally with `PW_SOFTWARE_GL=1 npm run test:smoke`.
- **Pointer lock** is plain `requestPointerLock()`, deliberately not `{ unadjustedMovement: true }`. With raw input, Chrome and Edge on Windows stop re-centring the hidden cursor, so it drifts to the screen edge (look down at the lounge VCR and it reaches the bottom), and a click there can land on the taskbar. That's the likely way "the Start menu opened and the store let go of the mouse" happened (it couldn't be reproduced without a real mouse).
- **Pointer lock** is usually refused in automated or embedded browsers. The app stays in `paused` mode (mouse free, "Click to look around" hint), and after a second refusal switches to drag-to-look. In tests, call `__bb.setMode('walk')` after clicking Enter.
- **Previewing another catalog:** `?catalog=_name.json` loads `public/_name.json` (dev only), and `?streams=_name.json` does the same for Streams. Files matching `public/_*.json` are git-ignored. The committed `catalog.json` and `streams.json` are small RSS samples; for the full stores, save the live files (`/brutalbuster/catalog.json`, `/brutalbuster/streams.json`) as `public/_live.json` and `public/_streams-live.json`.
- **PS1 Mode:** `?ps1` / `?ps1=0` force it on or off for one load. Otherwise the last choice is kept in `localStorage` (`bb.ps1`). The first switch in each direction compiles shaders (about a second).
- **Time of day and seasons:** `?time=dawn|day|dusk|night` fixes the sky (otherwise it follows the clock, checked every 30 s), and `?season=halloween|winter|valentine|none` puts up (or takes down) the decorations (otherwise `seasonFor()` decides).
- **Previewing a future Lucky Hit board:** `?luckyday=N` shows the board N days from today (dev only).
- **The lounge video** is a real page element behind the canvas, so `gl.readPixels` screenshots don't show it (they show the see-through hole, alpha 0). Use a page screenshot. The smoke tests block YouTube and check the iframe's `src` and the hole instead.
- **Thumbnails** come from `i.ytimg.com`, which sends CORS headers. The pixel reads in `covers.js` (black-bar cropping) depend on that.

## Guardrails

- Never commit `.env` or put the YouTube API key anywhere the browser can see it. It's used only by `npm run sync` and the deploy workflow (as a repo secret).
- Changing the catalog format means updating `docs/catalog-format.md`, `src/catalog-schema.js` and its tests together. Bump `SCHEMA_VERSION` if old files would break.
- Keep it a static site. Anything that needs a server is a separate discussion.
- Work on a branch per feature. `main` should always pass `npm run check`.

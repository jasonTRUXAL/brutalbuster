# Brutalbuster Video

A first-person 1990s video rental store that runs in the browser. Its shelves hold only the videos from one YouTube channel, [brutalmoose](https://www.youtube.com/brutalmoose) (set in `store.config.json`). Built with Vite and Three.js in plain ES modules: no framework, no TypeScript, and no 3D models or image assets. Everything is painted procedurally on `<canvas>`. The README is the user-facing guide; this file is for working on the code. Where the project is headed (theater room, streaming-archive area, VHS vault) and the content decisions so far are in `docs/roadmap.md` and `docs/channel-notes.md`. Read them before changing what gets shelved.

## Commands

```bash
npm run dev            # http://localhost:5173 (exposes window.__bb test hooks)
npm run check          # everything CI runs: lint, catalog, unit, build, browser smoke (~30s)
npm run check:fast     # lint + catalog contract + unit tests (~2s), for quick feedback
npm test               # unit tests only (node --test, no browser)
npm run test:smoke     # Playwright against the dev server, using installed Edge/Chrome
npm run sync           # rebuild public/catalog.json from the channel (needs youtube.channel)
```

Run `npm run check` before committing. CI (`.github/workflows/ci.yml`) runs the same steps on every push and PR.

## Workstreams and their boundaries

Each area can change independently as long as it keeps its contract with the others.

| Workstream | Owns | Contract with the rest |
|---|---|---|
| **Content pipeline** | `scripts/`, `store.config.json`, `catalog.overrides.json` | Writes `public/catalog.json` per `docs/catalog-format.md`, validated by `src/catalog-schema.js` |
| **The store (world)** | `layout.js`, `store.js`, `tapes.js`, `atlas.js`, `covers.js`, `textures.js`, `crt.js`, `config.js` | Reads the normalized catalog; exposes `plan.slots`, `TapeShelves` and `store.colliders` to `main.js` |
| **Interaction and viewing** | `main.js` (state machine), `controls.js`, `inspect.js`, `ui.js`, `style.css`, `index.html` | Modes are `splash`, `walk`, `paused`, `inspect`, `watch`, `directory`. The next big feature (the viewing experience) lives here |
| **Hosting and ops** | `.github/workflows/`, `vite.config.js`, `package.json` | Static `dist/`; daily restock through `deploy.yml` |

The shared, environment-neutral modules are `src/catalog-schema.js` (imported by Node and the browser, so no DOM or Node APIs), `src/layout.js`, `src/catalog.js` and `src/config.js`. They're all pure, which is what lets them be unit tested.

## How a frame of the store comes together

`main.js` boots in this order: load fonts, then the catalog (`catalog.js`), then `planStore()` (`layout.js`: sizes the building to the catalog, assigns every tape a slot). Then `CoverAtlas` paints every box cover into a few 2048² canvases. Then `TapeShelves` draws all tapes with 1 instanced draw call for the cases plus 1 per atlas page, and `buildStore()` merges the static fixtures per material (`Batcher`). Thumbnails stream in afterwards and repaint atlas cells. `atlas.flush()` uploads them, throttled.

The picked-up tape is rendered in a separate overlay scene (`inspect.js`) over the dimmed store. The tape on the shelf is hidden by zero-scaling its instance.

## Conventions

- **Units are metres.** Every physical dimension lives in `DIM` in `config.js`, and brand colours in `BRAND`. Don't hard-code sizes elsewhere.
- **Keep draw calls low.** Add many repeated objects as instances or through the `Batcher`, never as one mesh each. Check with `renderer.info.render.calls` (the sample store is ~20).
- **Deterministic.** Any randomness is seeded (`rng(hash(...))` from `util.js`) so the store looks the same on every load and tests are stable.
- **Canvas art is drawn on a design grid.** Covers are laid out on 160×280 and scaled by `s = width / 160`, so one function draws both the atlas thumbnail and the 512px held tape. Webfonts must be loaded (`loadFonts()`) before any canvas text is drawn.
- **Textures go through `toTexture()`.** It handles sRGB, anisotropy and mipmaps.
- **Comments:** a short header per module saying why it exists, plus brief notes on anything non-obvious. Match the surrounding density.
- **Files are LF** (`.gitattributes`). The dev machine is Windows, so use forward slashes in scripts.

## Verifying changes in a browser

- **Dev hooks.** In dev builds `window.__bb` exposes `plan`, `catalog`, `camera`, `controls`, `tapes`, `inspector`, `renderer`, `setMode()`, `pickUp(slot)`, `putBack()`, `goToVideo(id)`, `raySlot(ndc)`, `mode` and `hovered`. **`__bb.advance(seconds)`** steps the simulation deterministically and renders once. Use it whenever frames aren't flowing, for example in a hidden or background browser pane where `requestAnimationFrame` is throttled. `?manual` turns off the render loop entirely (the smoke tests use it). CI has no GPU, so rendering is all in software there; reproduce that locally with `PW_SOFTWARE_GL=1 npm run test:smoke`.
- **Pointer lock** is usually refused in automated or embedded browsers. The app stays in `paused` mode (mouse free, "Click to look around" hint), and after a second refusal switches to drag-to-look. In tests, call `__bb.setMode('walk')` after clicking Enter.
- **Previewing another catalog:** `?catalog=_name.json` loads `public/_name.json` (dev only). Files matching `public/_*.json` are git-ignored.
- **Thumbnails** come from `i.ytimg.com`, which sends CORS headers. The pixel reads in `covers.js` (black-bar cropping) depend on that.

## Guardrails

- Never commit `.env` or put the YouTube API key anywhere the browser can see it. It's used only by `npm run sync` and the deploy workflow (as a repo secret).
- Changing the catalog format means updating `docs/catalog-format.md`, `src/catalog-schema.js` and its tests together. Bump `SCHEMA_VERSION` if old files would break.
- Keep it a static site. Anything that needs a server is a separate discussion.
- Work on a branch per feature. `main` should always pass `npm run check`.

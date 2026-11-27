# Roadmap

Brutalbuster is a walk-in home for brutalmoose's video library. It's planned as separate areas, each stocked from its own source:

| # | Area | Source | Status |
|---|---|---|---|
| 1 | **The store** (main sales floor) | brutalmoose main channel ([youtube.com/brutalmoose](https://www.youtube.com/brutalmoose)) | ✅ Live: https://jasontruxal.github.io/brutalbuster/ |
| 2 | **The lounge** (the theater room) | Plays whatever tape you bring it | Working: carry a tape to the VCR and it plays on the big screen |
| 3 | **Streams** (the streaming archive) | [moose2](https://www.youtube.com/moose2), 742 videos | Stocked: every stream on the shelves, by year (restocked daily into `public/streams.json`) |
| 4 | **Extras** | To decide (the user is compiling the list) | Room built with empty "Coming Soon" shelves and boxes, kept as is for now |
| 5 | **VHS backup vault** | His VHS backup channel, possibly plus other websites for the full list | Later (it could live in Extras) |

**Proof-of-concept scope:** the store plus areas 2 and 3.

## New rooms (built 2026-11-21, branch `feature/new-rooms`)

The building now has rooms off the sales floor. They're placed relative to it, so they move with it when the channel grows:

- **Hallway → lounge and Streams.** A short hallway through the left wall, near the front (opposite the counter), opens into a wing next door. The wing's front third is the **lounge**: two couches facing a projector screen on the far wall, plus curtains, a popcorn machine, a floor lamp and blinds on the front windows. Its back two-thirds is **Streams**, through an archway under an **ON AIR** sign.
- **Extras.** A door in the back wall's right-hand corner (at the end of the right-hand aisle) leads to a back room behind the store.

What it cost the sales floor: the hallway took the front 2 bays of left-wall shelving, and the door took 2 bays of New Releases. Every tape is still shelved (the spare bays were featured filler).

The work is split into passes, each finished and approved before the next:

1. **Rooms and props** ✅ (this branch). Walls, floors, lighting and furniture, with empty "Coming Soon" shelves. No new videos. The lounge screen runs a "coming attractions" slideshow of box art.
2. **Content pipeline** ✅ (branch `feature/streams-catalog`). `store.config.json` → `areas` lists the extra catalogs. `npm run sync` writes `public/catalog.json` (sales floor) and `public/streams.json` (Streams, from moose2), both in [the catalog format](catalog-format.md). Streams is shelved by year (`aislesBy: "year"`): one aisle per year, newest first. The committed `streams.json` is the 15 newest from the RSS feed; the deploy restocks it with the full channel.
3. **Stock the Streams shelves** ✅ (branch `feature/streams-shelves`). The store loads `streams.json` alongside `catalog.json`. Each year gets a section, newest year first, starting on the centre gondola (the first thing you meet through the archway) and carrying on round the walls. Within a year, tapes run in upload order, so a playthrough reads Part One → Finale. The gondola's front end shows the latest stream and its back end a clerk's pick. The room runs further back, a bay at a time, when the catalog needs more shelf. 742 streams needed 25 bays and the standard room has 23, so it's 1.2 m deeper. Picking up, watching and **Find a tape** (a **Streams** button) work the same as on the sales floor. To keep the sales floor fast, rooms out of sight aren't drawn, and aiming only tests the tapes within reach. Extras waits for its list.
4. **A working projector** ✅ (branch `feature/lounge-vcr`). As the user specified:
   - The held-tape panel's **Watch now** (the pop-up TV) is gone. Its buttons are now **Grab** and **View on YouTube** (plus Flip and Put back).
   - **Grab** and you hold the tape: it's shown facing you, centred in the lower third of the view, and goes where you go. Grabbing another sends the first back to its shelf.
   - A VCR sits in a media cabinet under the screen. Nothing points you to it: you find it by exploring. Get near it holding a tape and it says **Insert tape**; get near it empty-handed and it says nothing.
   - Put the tape in and it starts like an old VCR, in about seven seconds (user's follow-up): a moment of black, the blue screen full of static while it auto-tracks (like the counter TV), then the tape's title, upload date and length on their own lines, and a blip into the video, which starts from the beginning then. The video is a real YouTube player lined up behind the see-through screen, so walls and furniture still hide it. It plays on as you walk round, quieter further off. A new tape sends the old one back to its shelf, as does the end of the tape.
   - With no tape in, a made-up VHS logo bounces round the screen like an idle DVD player's, changing colour at each bounce. It replaced the box-art slideshow.
   - You can sit on either couch (three seats each), but sitting does nothing else.
   - **The remote** (user's follow-up): while a tape plays, on the couch or standing at the VCR, a small panel offers back 5 seconds (YouTube's ← key), pause / play and subtitles. Keys R (← on the couch too), Space and T. Subtitles are off unless you turn them on, and the choice is remembered.
   - **Crouching** (user's follow-up): hold C on a computer, or tap the **Crouch** toggle on a phone. Your eyes drop to about a metre and you walk at half speed.

## Store life (built 2026-11-23, branch `feature/store-life`)

The user's picks from the ideas list:

- **Drop box:** carry a tape to the RETURNS box by the door and drop it in (1 token, five a day). Tapes still go back on their own.
- **Checkout counter:** take a tape to the register to rent it: a printed rental slip (due back in 2 nights, no late fees), the register's screen shows it, and it goes on the card's rental history. Empty-handed, the counter opens your membership card.
- **OPEN 24 HOURS:** an LED sign facing the street, so it's backwards from inside (the user's idea). It replaced the OPEN neon. No closing time anywhere. (Made neon on 2026-11-26: see HUD and polish.)
- **Time of day:** the sky, the lot and the street lamps follow the visitor's clock (dawn 5–7, day 7–17, dusk 17–20, night).
- **Seasons:** Halloween (Oct), winter holidays (1 Dec–6 Jan), Valentine's (1–14 Feb). The floor by the front is full (Lucky Hit, drop box, gates, gacha row), so the props go on the counter, the drop box and the window.

## HUD and polish (built 2026-11-26, branch `feature/hud-and-polish`)

The user's list, after the site had picked up "an over-abundance of information":

- **Hints:** one bar at the bottom of the screen holds what you're aiming at (it was a tooltip under the crosshair) and the keys (a long always-on line). It shows only once you've been still for 2 seconds; moving, looking round or turning the tape hides it. The held-tape view's hint is "Drag the box to turn it over".
- **Touchscreens:** the two halves are labelled (Walk / Look around) until both have been used; after that, the hint bar's one line.
- **Q, not Esc,** backs out (put back, stand up, close the card or slip). Esc makes the browser drop the mouse and refuse to give it straight back. Esc still works as a fallback.
- **Held-tape panel:** Copy link and Flip box are gone. The address bar is the link (now also while carrying a tape, and the live site shows `t/<id>/`, the preview page). Turning the box is a trackball drag with a little glide, and the box is about 1.6× bigger; the carried tape about 3×, half below the screen.
- **Fixes:** shelf ends flickered yellow over blue (the price-channel lip's ends shared a plane with the end upright); a tape's edge flickered between hovered and not (the aim test only tried the slid-out position).
- **OPEN 24 HOURS** is neon now (tubes with a hot core and glow; the 24 HOURS tube sputters), not LED dots.
- **Outside** (`src/outside.js`): a proper lot (stalls, wheel stops, island, lot lights, parked cars), a four-lane street with traffic both ways, and a strip mall and a gas station across it.

## HUD at the bottom, and a faster load (built 2026-11-26, branch `feature/hud-bottom-and-perf`)

- **Only the store's name stays up top.** The HUD's buttons (Find a tape, tokens, Sound, PS1, and Crouch on touch) joined the hint bar at the bottom, and show and hide with it.
- **Fixes:** endcap corners (the grey chrome posts were flush with the endcap's front: now 2 mm proud), the end boards behind them, and a hovered tape cutting into the shelf's yellow lip (it rises 4.5 cm now, not 1).
- **The door chime** rings whenever you come up to the front door, not just on Enter.
- **The debug overlay** (` or `?debug`): FPS, CPU/GPU time a frame, draw calls, memory, downloads, and the load's timeline.
- **Load:** usable in about 2.2 s instead of 3.2 s on the dev machine (production build, the live catalog). Covers' text fitting is three times faster with identical results; Streams' covers paint after the first frame; shaders compile without freezing the page; WebGL starts while files download; Streams' thumbnails trickle in (3 at a time, 8 when you head that way). Not done yet, for the user to decide: smaller thumbnails (YouTube's `mqdefault`, about a third fewer bytes, a little softer close up), or loading Streams' thumbnails only when you go there (27 of the 37 MB).

## Sound (built 2026-11-23, branch `feature/ambient-sound`)

Everything is made in code with Web Audio (`src/audio.js`), as the user asked ("no audio files for now"): room tone (hum, air conditioning, street and passing cars near the windows), procedural in-store music (a mellow D-major chord loop with bass, drums and a pentatonic melody, through a ceiling-speaker filter and a small room reverb; quieter in the side rooms and ducked under a lounge tape), footsteps (carpet or tile), and one-offs: door chime, tape clicks, VCR load, drop box, receipt printer, tokens, prizes. Sound toggle on the HUD (N), remembered.

## Prize corner (built)

- **Gacha machines (4):** playable. Crank, capsule drop, open, and a pile that empties and refills.
- **Lucky Hit:** playable. It's the Shenmue street drop board: aim, drop one slow ball, and every slot wins. The nails change daily (board of the day, checked by simulation). The narrow gold jackpot slot (about 4% of drops) is reserved for rare prizes. It replaced the classic pachinko machine on 2026-10-28.
- **Tokens and the membership card** (built 2026-11-23, branch `feature/membership`, the user's ask): tokens for the day's visit with a streak bonus that tops out (10 a day, +5 per day in a row up to +25; bonuses at 7/30/100/365 days), for lounge watching (1 per 5 minutes, 12 a day max) and for finishing a tape (5, three a day). A membership card (M, or the token chip) shows the streak, stamps, lounge time and rental history. Kept in the browser for now; sign-in accounts (Twitch, follow age) are a separate discussion because they need a server. Not decided yet: what tokens buy (the prize corner is still free to play).
- **Next: the reward system.** The rule is "you always win something; it's just what you win". Every capsule and jackpot fires a `bb:prize` event carrying `{ kind, machine, … }`. Ideas so far: each gacha machine's theme maps to a part of the store (Tape Pals → Mystery Tapes, Snack Pals → brutalfoods, Game Pals → the game reviews, TV Pals → Televoid!), and a capsule could contain a tape from that section.

## PS1 Mode (built)

Live since 2026-11-04 (commit 8ac00de). The **PS1 mode** button (or `P`, or `?ps1` in the address) draws the whole store like a 1995 PlayStation game, with the video thumbnails as the one exception. In PS1 Mode you get:

- a 240-pixel picture with chunky pixels;
- wobbly polygons;
- warping, point-sampled textures;
- 15-bit dithered colour;
- distance fog.

Box covers, posters, the standee, the counter TV and the held tape are redrawn sharp on top. How it works is in `src/ps1.js` and the "PS1 Mode flags" convention in CLAUDE.md.

- **Fixed alongside it:** the picked-up tape had been drawn *under* the dark backdrop, at about 30% brightness. Now it's in front of it, in both modes.
- **Also fixed:** signs flickered into the boards behind them when polygons wobbled. Large textured surfaces are now split into tiles so the texture warp stays mild.
- **Possible later:** pixelate the box design around each thumbnail, keeping only the thumbnail itself sharp. Today the whole box front, title included, stays sharp.

## Area notes

### 2. Theater room (the lounge)
- **Working** (pass 4 above). The screen is at `plan.lounge.screen`, the VCR and its cabinet at `plan.lounge.vcr` / `cabinet`, and the seats at `plan.lounge.seats`.
- **Technical note:** a YouTube player can't be drawn inside the 3D scene as a texture (browser security rules). The real player sits behind the canvas, lined up by three.js `CSS3DRenderer`, and the screen leaves the canvas see-through over it (see CLAUDE.md). It works the same on phones.
- **Ideas not built:** ejecting without inserting another tape, a "rewinding…" pause, remembering where you stopped.

### 3. Streaming archive (Streams)
- Built as the back two-thirds of the wing off the sales floor (see "New rooms"), with its own purple look. Stocked year by year (pass 3).
- **Source:** [moose2](https://www.youtube.com/moose2) (channel id `UCd6Tp3QcHhagsbSpyxmlzpg`), about 744 videos as of 2026-11-21. They're mostly stream recordings: full playthroughs and multi-part games ("Myst IV [Part One]" … "[Finale]"), plus shows like Play or Pass and Wiingo. Most games have their own playlist.
- **Box sets** (built 2026-11-23, branch `feature/box-sets`, the user's idea): a multi-night game, or a show that ran for weeks, is one box set on the shelf instead of a row of tapes. They're found from the titles (`src/boxsets.js`): 110 sets holding 364 of 742 streams as of 2026-11-23. A break of over 120 days, or the parts restarting at Part 1, starts a new set (Shenmue 2018 and 2025 are separate). Picking one up hands you Tape 1, with ◀ ▶ for the rest. Since 2026-11-27 (the user's ask) every stream is also shelved as a single tape, the box standing just before its first one: take the box or one night. Streams grew from about 8.5 m to 14.4 m deep for it. Titles that only say "PART 2" (Sonic '06) aren't caught; moose2's per-game playlists would make it exact, which needs a sync change. Next for box sets: the VCR offering the next tape when one ends.
- **Shelving:** by year (decided 2026-11-21). Parts of a game were streamed back to back, so they still sit together. One section per game was considered and set aside: 30+ games plus one-offs would need about 3 times the shelf space and dozens more signs. Within a year the tapes are in upload order (oldest first), so a game's parts read in order. The years themselves run newest first.
- **As of 2026-11-21:** 742 streams, 2017–2026. 2026 has 137, 2025 has 128 and 2021 has 17.

### 4. VHS backup vault
- The full list may live partly outside YouTube. Plan: one "source adapter" per website in `scripts/lib/`, each producing the same catalog format, so the 3D store never has to care where a tape came from.
- **Waiting on:** the channel link and the other sites.

## Decisions

- **2026-10-06:** The main store shelves the **entire** main channel, not a subset. "My response." stays on the shelves. Playlist notes and the alternative we considered are in [channel-notes.md](channel-notes.md).
- **2026-11-04:** PS1 Mode applies to everything except the video thumbnails, as asked. The whole box front counts as "thumbnail" so titles stay readable. The choice is per browser (remembered), and off by default.
- **2026-11-21:** New rooms. A hallway opposite the counter leads to a wing that's a lounge (front third: couches, projector) and Streams (back two-thirds). A door in the back right-hand corner leads to Extras. Built in passes: rooms and props first, then content, then the working projector.
- **2026-11-21:** Streams is stocked from moose2 and shelved by year. Extras keeps its empty shelves and boxes until the user has compiled what goes in it.
- **2026-11-22:** The lounge VCR has a remote (rewind 5 s, pause / play, subtitles) on the couch or at the VCR, and you can crouch (hold C; a toggle on phones). The YouTube player is set up once while the store loads, and a tape goes in on mouse-up.
- **2026-11-22:** Likely cause found: clicking the VCR could open the Windows Start menu, and the store lost the mouse. The store asked for raw mouse input, and then the browser doesn't keep the hidden cursor in the middle of the window; looking down at the VCR walked it to the bottom of the screen, onto the taskbar. It now uses plain pointer lock.
- **2026-11-21:** The lounge works the user's way: no pop-up TV. **Grab** a tape, carry it (shown in the lower third, facing you) to the VCR you find by exploring, and it plays on the big screen. The VCR speaks up only when you bring a tape. An empty screen shows a bouncing VHS logo, and the couches are just for sitting.

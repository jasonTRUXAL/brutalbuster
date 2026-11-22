# Roadmap

Brutalbuster is a walk-in home for brutalmoose's video library. It's planned as separate areas, each stocked from its own source:

| # | Area | Source | Status |
|---|---|---|---|
| 1 | **The store** (main sales floor) | brutalmoose main channel ([youtube.com/brutalmoose](https://www.youtube.com/brutalmoose)) | ✅ Live: https://jasontruxal.github.io/brutalbuster/ |
| 2 | **The lounge** (the theater room) | Plays whatever tape you pick | Room and props built (see "New rooms"); playing videos comes later |
| 3 | **Streams** (the streaming archive) | His streaming-archive channel (link needed) | Room built with empty "Coming Soon" shelves |
| 4 | **Extras** | To decide | Room built with empty "Coming Soon" shelves |
| 5 | **VHS backup vault** | His VHS backup channel, possibly plus other websites for the full list | Later (it could live in Extras) |

**Proof-of-concept scope:** the store plus areas 2 and 3.

## New rooms (built 2026-11-21, branch `feature/new-rooms`)

The building now has rooms off the sales floor. They're placed relative to it, so they move with it when the channel grows:

- **Hallway → lounge and Streams.** A short hallway through the left wall, near the front (opposite the counter), opens into a wing next door. The wing's front third is the **lounge**: two couches facing a projector screen on the far wall, plus curtains, a popcorn machine, a floor lamp and blinds on the front windows. Its back two-thirds is **Streams**, through an archway under an **ON AIR** sign.
- **Extras.** A door in the back wall's right-hand corner (at the end of the right-hand aisle) leads to a back room behind the store.

What it cost the sales floor: the hallway took the front 2 bays of left-wall shelving, and the door took 2 bays of New Releases. Every tape is still shelved (the spare bays were featured filler).

The work is split into passes, each finished and approved before the next:

1. **Rooms and props** ✅ (this branch). Walls, floors, lighting and furniture, with empty "Coming Soon" shelves. No new videos. The lounge screen runs a "coming attractions" slideshow of box art.
2. **Content pipeline.** `npm run sync` writes one catalog per area (for example `public/catalogs/main.json`, `streams.json`, `extras.json`, each following [the catalog format](catalog-format.md)). Needs the Streams channel link and a decision on what Extras holds.
3. **Stock the new shelves.** Streams shelved by date (stream VODs are long, so dates suit them better than genre aisles). Extras shelved to suit its contents. Picking up and watching works the same as on the sales floor.
4. **A working projector.** Sit on a couch and the tape plays on the lounge screen. `plan.lounge.screen` is the screen's position and size, for laying a YouTube player over it (see "Theater room" below). `plan.lounge.sofas` are the seats.

## Prize corner (built)

- **Gacha machines (4):** playable. Crank, capsule drop, open, and a pile that empties and refills.
- **Lucky Hit:** playable. It's the Shenmue street drop board: aim, drop one slow ball, and every slot wins. The nails change daily (board of the day, checked by simulation). The narrow gold jackpot slot (about 4% of drops) is reserved for rare prizes. It replaced the classic pachinko machine on 2026-10-28.
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
- **Built as props** (see "New rooms"). The screen is at `plan.lounge.screen` and the couches are at `plan.lounge.sofas`.
- **Open question:** is this where **Watch now** leads (walk into a small theater and the tape plays on the big screen, replacing today's pop-up TV), or a separate destination (for example a screening room with a featured program)?
- **Technical note:** a YouTube player can't be drawn inside the 3D scene as a texture (browser security rules). The usual approach is to lay the real player over the 3D screen and keep it lined up as you look around (three.js `CSS3DRenderer`), with a full-screen fallback on phones.

### 3. Streaming archive (Streams)
- Built as the back two-thirds of the wing off the sales floor (see "New rooms"), with its own purple look and empty shelving for now.
- **Needs multiple catalogs:** the config lists several sources, `npm run sync` writes one catalog per area (for example `public/catalogs/main.json` and `archive.json`, each following [the catalog format](catalog-format.md)), the layout solver runs once per area, and a door switches areas.
- Stream VODs are long (often hours), so shelving by date or series may suit them better than genre aisles.
- **Waiting on:** the channel link.

### 4. VHS backup vault
- The full list may live partly outside YouTube. Plan: one "source adapter" per website in `scripts/lib/`, each producing the same catalog format, so the 3D store never has to care where a tape came from.
- **Waiting on:** the channel link and the other sites.

## Decisions

- **2026-10-06:** The main store shelves the **entire** main channel, not a subset. "My response." stays on the shelves. Playlist notes and the alternative we considered are in [channel-notes.md](channel-notes.md).
- **2026-11-04:** PS1 Mode applies to everything except the video thumbnails, as asked. The whole box front counts as "thumbnail" so titles stay readable. The choice is per browser (remembered), and off by default.
- **2026-11-21:** New rooms. A hallway opposite the counter leads to a wing that's a lounge (front third: couches, projector) and Streams (back two-thirds). A door in the back right-hand corner leads to Extras. Built in passes: rooms and props first, then content, then the working projector.

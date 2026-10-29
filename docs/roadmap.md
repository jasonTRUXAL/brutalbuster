# Roadmap

Brutalbuster is a walk-in home for brutalmoose's video library. It's planned as separate areas, each stocked from its own source:

| # | Area | Source | Status |
|---|---|---|---|
| 1 | **The store** (main sales floor) | brutalmoose main channel ([youtube.com/brutalmoose](https://www.youtube.com/brutalmoose)) | ✅ Live: https://jasontruxal.github.io/brutalbuster/ |
| 2 | **Theater room** | Plays whatever tape you pick | Proof of concept: next |
| 3 | **Streaming archive** (a separate area you walk into) | His streaming-archive channel (link needed) | Proof of concept: next |
| 4 | **VHS backup vault** | His VHS backup channel, possibly plus other websites for the full list | Later |

**Proof-of-concept scope:** the store plus areas 2 and 3.

## Prize corner (built)

- **Gacha machines (4):** playable. Crank, capsule drop, open, and a pile that empties and refills.
- **Lucky Hit:** playable. It's the Shenmue street drop board: aim, drop one slow ball, and every slot wins. The nails change daily (board of the day, checked by simulation). The narrow gold jackpot slot (about 4% of drops) is reserved for rare prizes. It replaced the classic pachinko machine on 2026-10-28.
- **Next: the reward system.** The rule is "you always win something; it's just what you win". Every capsule and jackpot fires a `bb:prize` event carrying `{ kind, machine, … }`. Ideas so far: each gacha machine's theme maps to a part of the store (Tape Pals → Mystery Tapes, Snack Pals → brutalfoods, Game Pals → the game reviews, TV Pals → Televoid!), and a capsule could contain a tape from that section.

## Area notes

### 2. Theater room
- **Open question:** is this where **Watch now** leads (walk into a small theater and the tape plays on the big screen, replacing today's pop-up TV), or a separate destination (for example a screening room with a featured program)?
- **Technical note:** a YouTube player can't be drawn inside the 3D scene as a texture (browser security rules). The usual approach is to lay the real player over the 3D screen and keep it lined up as you look around (three.js `CSS3DRenderer`), with a full-screen fallback on phones.

### 3. Streaming archive
- A "wholly separate area to enter": for example, a doorway off the main floor, or a second building across the parking lot. It has its own shelves and its own look.
- **Needs multiple catalogs:** the config lists several sources, `npm run sync` writes one catalog per area (for example `public/catalogs/main.json` and `archive.json`, each following [the catalog format](catalog-format.md)), the layout solver runs once per area, and a door switches areas.
- Stream VODs are long (often hours), so shelving by date or series may suit them better than genre aisles.
- **Waiting on:** the channel link.

### 4. VHS backup vault
- The full list may live partly outside YouTube. Plan: one "source adapter" per website in `scripts/lib/`, each producing the same catalog format, so the 3D store never has to care where a tape came from.
- **Waiting on:** the channel link and the other sites.

## Decisions

- **2026-10-06:** The main store shelves the **entire** main channel, not a subset. "My response." stays on the shelves. Playlist notes and the alternative we considered are in [channel-notes.md](channel-notes.md).

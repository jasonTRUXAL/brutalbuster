# brutalmoose main channel: shelving notes

Reference for how the main store is stocked, so the content can be adjusted later. The live numbers below are from the deploy on **2026-10-06**: 245 tapes in 17 aisles.

## How a tape picks its aisle

Full rules are in the README ("How tapes get sorted into aisles"). In short:

1. A manual override in `catalog.overrides.json`
2. **The channel's own playlists.** Playlist names are used as aisle names, minus the "| brutalmoose" tag. If a tape is in several playlists, the smallest (most specific) one wins.
3. Keyword rules in `store.config.json`
4. Anything left over goes to **Rare Finds**

Catch-all playlists ("The Latest", "Popular uploads", …) are never used as aisles. Add more to `youtube.ignorePlaylists`.

## Playlist → aisle map (as live)

| Aisle | Tapes | Comes from | Notes |
|---|---:|---|---|
| PC Game Reviews | 35 | playlist "PC Game Reviews \| brutalmoose" | |
| brutalfoods | 39 | playlist "brutalfoods" | Also picks up recent food videos that used to sit in "The Latest" |
| Nostalgic Favorites | 27 | playlist "Nostalgic Favorites \| brutalmoose" | Mixed: board games, toys, food, PC games |
| Game Reviews | 25 | playlist "Game Reviews \| brutalmoose" | |
| VHS, Film, and TV Reviews | 23 | playlist "VHS, Film, and TV Reviews \| brutalmoose" | Includes the Mary-Kate & Ashley and Tupperware tapes |
| brutalmoose Originals \| Season 1 | 15 | playlist of the same name | The "\| Season 1" isn't the channel tag, so it stays |
| Rare Finds | 14 | not in any playlist | Default aisle |
| Live Action / FMV | 13 | playlist "Live Action / FMV \| brutalmoose" | |
| Humongous Entertainment | 10 | playlist "Humongous Entertainment \| brutalmoose" | |
| Mystery Tapes | 9 | playlist "Mystery Tapes" | The real found-VHS series |
| Holiday | 7 | playlist "a very brutalmoose christmas", plus Halloween/Christmas keywords | Configured aisle (red) |
| Televoid! | 6 | playlist "Televoid! \| brutalmoose" | Public-domain educational films, 1959–89 |
| Field Trips | 6 | playlist "Field Trips \| brutalmoose" | |
| History Kitchen | 5 | playlist "History Kitchen" | Holds "My response." (staying; see Decisions) |
| Arcade Series | 5 | playlist "Arcade Series \| brutalmoose" | |
| brutalfoods Adventures | 3 | playlist "brutalfoods Adventures" | |
| GERBERT | 3 | playlist "GERBERT" | |

Not used as aisles: "The Latest" (catch-all). "brutalmoose Originals" (no season) exists as a playlist, but its tapes go to the smaller "Season 1" list.

Aisles that come straight from a playlist get colours from the store palette automatically. To pin a colour or rename one, add an entry under `aisles` in `store.config.json` whose `match` includes the playlist name.

## Suggestions on file (not applied)

- **VHS-focused subset.** If the store should feel more like a tape store, limit it to **Mystery Tapes, Televoid!, VHS, Film, and TV Reviews** (and maybe **GERBERT** / **Nostalgic Favorites**). This needs a small new `youtube.playlists` allowlist option in the sync, which hasn't been built yet. *Decided against for now: the whole channel stays.*
- **Merge the small food aisles** (brutalfoods Adventures, History Kitchen) into **brutalfoods** by mapping their playlist names onto one configured aisle.
- **Feature the retro sections:** put Mystery Tapes / Televoid! on the endcaps or near the entrance instead of random picks.

## Decisions

- **2026-10-06:** Shelve the entire main channel. "My response." stays where it is (History Kitchen).

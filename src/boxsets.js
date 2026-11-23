// Box sets for the Streams room: a game streamed over several nights (Part One …
// Finale), or a show that ran for a few weeks (Bingo98), is shelved as one box set
// instead of a row of single tapes. The archive has no "series" field, so sets are
// found from the titles, which name the game in many ways:
//   "Shenmue (Part 2)", "Shenmue II - Ryo's Cups", "Myst IV: Revelation (2004) [Part Two]",
//   "how do i crash this boat? | Titanic: Adventure Out of Time (Part 2)"
// Each title is cut at its separators ( | , || , - , -- ) into candidate names, with the
// part markers, brackets, platforms and emoji stripped. Streams that share a name and
// went up close together form a set. A set ends at a long break, or when the parts
// start again from Part 1 (a replay: Shenmue was played in 2018 and again in 2025).
// Pure (no DOM, no three.js): the layout and the unit tests both use it.

/** Longest break between two parts of one set. Shenmue III paused for ~2.5 months. */
export const MAX_GAP_DAYS = 120;
export const MIN_SET = 2;

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
// "Part 2", "PART ONE", "Pt. 3", "Part 8/Finale", "[1/5]", "Ep. 2", "FNMPP #2", "Episode 1",
// "S2E3". (A "#" number counts only at the end: "Nancy Drew #17: …" is the game's number.)
const PART_RE = /\b(?:part|pt\.?|ep\.?|episode)\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b(?:\s*\/\s*finale)?|\[(\d+)\s*\/\s*[\d?]+\]|#(\d+)\s*$|\bs\d+e(\d+)\b/i;
const FINALE_RE = /\b(?:season\s+)?finale\b!?/i;
// Names that say nothing about which game it is.
const GENERIC = new Set([
  '', 'full playthrough', 'full playthroughs', 'playthrough', 'finale', 'part', 'episode', 'brutalmoose stream archive',
  'brutalmoose', 'brutalmoose live', 'stream', 'chat decides', 'extra side quests', 'leftovers',
]);

/** The part number a title gives ("Part Two" → 2), 'finale', or null. */
export function partOf(title) {
  const m = String(title).match(PART_RE);
  if (m) {
    const raw = (m[1] || m[2] || m[3] || m[4] || '').toLowerCase();
    return NUMBER_WORDS[raw] ?? Number(raw);
  }
  return FINALE_RE.test(title) ? 'finale' : null;
}

/** A name, normalised for comparing: no brackets, emoji, punctuation or part markers. */
export function normName(s) {
  return String(s)
    .replace(new RegExp(PART_RE.source, 'gi'), ' ')
    .replace(new RegExp(FINALE_RE.source, 'gi'), ' ')
    .replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, ' ')
    .replace(/[™®]/g, '')
    .replace(/\p{Extended_Pictographic}|️|‍/gu, ' ')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/'/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The names a title could be filed under, most specific first, each as { key, label }.
 * "/" joins several games in one stream: those stay single tapes (no names).
 */
export function candidateNames(title) {
  const t = String(title);
  if (/\s\/\s|\w\/\s|\s\/\w/.test(t.replace(/\[\d+\s*\/\s*[\d?]+\]/g, '').replace(/part\s*\d+\s*\/\s*finale/gi, ''))) return [];
  if (/full\s*playthrough|full\s*watchthrough/i.test(t)) return []; // a whole game in one tape
  // (brackets go first: "(Ch. 1 - 3)", "[Diamond Heights]" and "(PS2)" aren't the name)
  const pieces = t
    .replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, ' ')
    .split(/\s+\|\|?\s+|\s+-{1,2}\s+|\s+\|\s*|\s*\|\s+|:\s+(?=(?:part|finale)\b)/i);
  const out = [];
  for (const p of pieces) {
    const key = normName(p);
    if (GENERIC.has(key) || key.length < 3 || /^\d+$/.test(key)) continue;
    if (!out.some((o) => o.key === key)) out.push({ key, label: cleanLabel(p) });
  }
  return out;
}

function cleanLabel(s) {
  return String(s)
    .replace(new RegExp(PART_RE.source, 'gi'), '')
    .replace(new RegExp(FINALE_RE.source, 'gi'), '')
    .replace(/\[\s*\]|\(\s*\)/g, '')
    .replace(/\p{Extended_Pictographic}|️|‍/gu, '')
    .replace(/\s*[:|–-]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const DAY = 86400000;
const time = (v) => Date.parse(v.publishedAt) || 0;

/**
 * Find the box sets among `videos` (any order). Returns
 *   { sets: [{ id, key, title, videos: [...] (upload order) }], setOf: Map(video.id → set) }.
 * A video belongs to one set at most; it goes to the longest run it can join.
 */
export function findBoxSets(videos, { maxGapDays = MAX_GAP_DAYS, minSet = MIN_SET } = {}) {
  const sorted = [...videos].sort((a, b) => time(a) - time(b) || String(a.id).localeCompare(String(b.id)));
  // every run of streams sharing a name, split at long breaks and part-1 restarts
  const runs = [];
  const open = new Map(); // key -> current run
  for (const v of sorted) {
    const part = partOf(v.title);
    for (const { key, label } of candidateNames(v.title)) {
      let run = open.get(key);
      const restart = run && part === 1 && run.videos.some((x) => x.part !== null);
      if (!run || time(v) - run.last > maxGapDays * DAY || restart || run.finished) {
        run = { key, labels: new Map(), videos: [], last: 0, finished: false };
        open.set(key, run);
        runs.push(run);
      }
      run.videos.push({ v, part });
      run.labels.set(label, (run.labels.get(label) || 0) + 1);
      run.last = time(v);
      if (part === 'finale') run.finished = true;
    }
  }
  // longest runs claim their videos first (ties: the more specific name)
  runs.sort((a, b) => b.videos.length - a.videos.length || b.key.length - a.key.length || time(a.videos[0].v) - time(b.videos[0].v));
  const setOf = new Map();
  const sets = [];
  for (const run of runs) {
    const free = run.videos.filter(({ v }) => !setOf.has(v.id));
    if (free.length < minSet) continue;
    const title = [...run.labels].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0];
    const set = { id: `set-${free[0].v.id}`, key: run.key, title, videos: free.map(({ v }) => v) };
    sets.push(set);
    for (const { v } of free) setOf.set(v.id, set);
  }
  sets.sort((a, b) => time(a.videos[0]) - time(b.videos[0]));
  return { sets, setOf };
}

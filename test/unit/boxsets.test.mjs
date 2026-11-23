// Box sets in Streams (src/boxsets.js): which streams are parts of one game's run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findBoxSets, partOf, normName, candidateNames } from '../../src/boxsets.js';

let n = 0;
const v = (date, title) => ({ id: `v${++n}`, title, publishedAt: `${date}T20:00:00Z` });
const titlesOf = (set) => set.videos.map((x) => x.title);

test('part markers, however they are written', () => {
  assert.equal(partOf('Shenmue (Part 2)'), 2);
  assert.equal(partOf('Myst IV: Revelation (2004) [Part Two]'), 2);
  assert.equal(partOf('sonic \'06 has already broken me | PART 2'), 2);
  assert.equal(partOf('Civilization VI [3/5]'), 3);
  assert.equal(partOf('i am luigi and i will gamble to victory | FNMPP #2'), 2);
  assert.equal(partOf('Bully | The End of All Bullying (Part 8/Finale)'), 8);
  assert.equal(partOf('Harvester [Finale]'), 'finale');
  assert.equal(partOf('🕵️ Nancy Drew #17: Legend of the Crystal Skull'), null); // the game's number
  assert.equal(partOf('Peggle Deluxe'), null);
});

test('names are compared without platforms, brackets, emoji or punctuation', () => {
  assert.equal(normName('Raw Danger! (PS2)'), normName('Raw Danger'));
  assert.equal(normName('🏴‍☠️ The Secret of Monkey Island ⛵'), 'the secret of monkey island');
  assert.deepEqual(candidateNames('Episode | Kill My Love (Ch. 1 - 3)').map((c) => c.key), ['kill my love']);
  assert.deepEqual(candidateNames('Animal Crossing / Mario Party'), []); // several games: a single tape
  assert.deepEqual(candidateNames('Toonstruck | Full Playthrough'), []); // the whole game in one tape
});

test('a game played over several nights is one set, interleaved one-offs stay single', () => {
  const vids = [
    v('2018-01-26', 'Shenmue (Part 1)'),
    v('2018-01-29', 'Shenmue (Part 2)'),
    v('2018-02-03', 'ChillTruck | not in a shenmood'),
    v('2018-02-04', 'Shenmue (Part 3) | BIG MONEY SHENMUE'),
    v('2018-02-12', 'Shenmue (Part 4) | FINALE'),
  ];
  const { sets, setOf } = findBoxSets(vids);
  assert.equal(sets.length, 1);
  assert.equal(sets[0].title, 'Shenmue');
  assert.equal(sets[0].videos.length, 4);
  assert.equal(setOf.has(vids[2].id), false);
});

test('a replay years later is its own set; breaks within a run are fine', () => {
  const vids = [
    v('2018-01-26', 'Shenmue (Part 1)'),
    v('2018-02-12', 'Shenmue (Part 2) | FINALE'),
    v('2019-11-20', 'Shenmue III - The Story Continues... (Part 1)'),
    v('2019-12-05', 'Shenmue III - Bye Bye Bailu (Part 2)'),
    v('2020-01-20', 'Shenmue III - Where\'s Chobu Chan? (Part 3)'), // a month and a half later
    v('2020-04-16', 'Shenmue III - Bad Boy Beatdown (Part 4)'), // nearly three months later
    v('2025-11-04', 'the adventure begins again | Shenmue (Part 1)'),
    v('2025-11-18', 'all good things must come to an end | Shenmue (Finale)'),
  ];
  const { sets } = findBoxSets(vids);
  assert.deepEqual(sets.map((s) => [s.title, s.videos.length]), [['Shenmue', 2], ['Shenmue III', 4], ['Shenmue', 2]]);
});

test('starting again from Part 1 starts a new set even without a long break', () => {
  const vids = [
    v('2024-01-01', 'Riven | Part 1'),
    v('2024-01-03', 'Riven | Part 2'),
    v('2024-01-20', 'Riven | Part 1'),
    v('2024-01-22', 'Riven | Part 2'),
  ];
  assert.deepEqual(findBoxSets(vids).sets.map((s) => s.videos.length), [2, 2]);
});

test('a show that runs for weeks is a collection; a lone stream stays single', () => {
  const vids = [
    v('2023-03-09', 'Windows 98 Variety Gaming! | Bingo98'),
    v('2023-03-10', 'Oregon Trail II, Mario Teaches Typing, & More! | Bingo98'),
    v('2023-03-13', 'mostly edutainment but also some curveballs | Bingo98'),
    v('2023-04-01', 'Peggle Deluxe'),
  ];
  const { sets } = findBoxSets(vids);
  assert.equal(sets.length, 1);
  assert.equal(sets[0].title, 'Bingo98');
  assert.deepEqual(titlesOf(sets[0]).length, 3);
});

// The membership card's tokens (src/membership.js): daily visits and streaks, lounge
// watching, and that it's all kept between visits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Membership, REWARDS, streakBonus, dayKey, daysBetween } from '../../src/membership.js';

const memoryStorage = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), map: m };
};
const at = (day, hour = 20) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00`).getTime(); // local time
const member = (storage = memoryStorage()) => new Membership({ storage, random: () => 0.5 }).load(at('2026-11-01'));
const total = (events) => events.reduce((n, e) => n + e.amount, 0);

test('days are the visitor\'s own calendar days', () => {
  assert.equal(dayKey(at('2026-11-23', 0)), '2026-11-23');
  assert.equal(dayKey(at('2026-11-23', 23)), '2026-11-23');
  assert.equal(daysBetween('2026-02-28', '2026-03-01'), 1);
  assert.equal(daysBetween('2026-12-31', '2027-01-01'), 1);
});

test('the streak bonus grows by a step a day and tops out', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 50].map(streakBonus), [0, 5, 10, 15, 20, 25, 25, 25]);
});

test('first visit: welcome plus the day\'s visit; again that day pays nothing', () => {
  const m = member();
  assert.equal(total(m.visit(at('2026-11-01', 9))), REWARDS.WELCOME + REWARDS.VISIT);
  assert.deepEqual(m.visit(at('2026-11-01', 22)), []);
  assert.equal(m.state.tokens, 35);
  assert.equal(m.state.streak, 1);
});

test('coming back on consecutive days builds the streak; missing a day starts again', () => {
  const m = member();
  const days = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'];
  const paid = days.map((d) => total(m.visit(at(d))));
  assert.deepEqual(paid, [35, 15, 20, 25, 30, 35, 35 + REWARDS.MILESTONES[7]]);
  assert.equal(m.state.streak, 7);
  assert.equal(total(m.visit(at('2026-11-09'))), REWARDS.VISIT); // skipped the 8th
  assert.equal(m.state.streak, 1);
  assert.equal(m.state.best, 7);
});

test('watching in the lounge: a token per 5 minutes, an hour\'s worth a day at most', () => {
  const m = member();
  m.rent({ id: 'a', title: 'Shenmue (Part 1)' }, at('2026-11-01'));
  let tokens = 0;
  for (let s = 0; s < 3 * 3600; s += 1) tokens += m.watch(1, at('2026-11-01'))?.amount || 0;
  assert.equal(tokens, REWARDS.WATCH_DAILY_CAP);
  assert.equal(Math.round(m.state.history[0].watchSec), 3 * 3600);
  assert.equal(m.watch(600, at('2026-11-02'))?.amount, 2, 'a new day, a new allowance');
});

test('finishing tapes and drop-box returns pay a little, a few times a day', () => {
  const m = member();
  const v = { id: 'a', title: 'A' };
  m.rent(v, at('2026-11-01'));
  const finishes = [1, 2, 3, 4].map(() => m.finish(v, at('2026-11-01'))?.amount || 0);
  assert.deepEqual(finishes, [5, 5, 5, 0]);
  assert.equal(m.state.history[0].finished, true);
  const returns = Array.from({ length: 7 }, () => m.returned(v, at('2026-11-01'))?.amount || 0);
  assert.equal(returns.reduce((a, b) => a + b, 0), REWARDS.RETURN * REWARDS.RETURN_DAILY_CAP);
});

test('the card is kept between visits, and a broken or missing store is survivable', () => {
  const storage = memoryStorage();
  const m = member(storage);
  m.visit(at('2026-11-01'));
  const again = new Membership({ storage }).load(at('2026-11-02'));
  assert.equal(again.state.tokens, 35);
  assert.equal(again.state.memberNo, m.state.memberNo);
  storage.map.set('bb.member', '{not json');
  assert.equal(new Membership({ storage }).load().state.tokens, 0);
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const p = new Membership({ storage: throwing }).load(at('2026-11-01'));
  assert.equal(total(p.visit(at('2026-11-01'))), 35);
});

test('spending needs enough tokens', () => {
  const m = member();
  m.visit(at('2026-11-01'));
  assert.equal(m.spend(100, 'too much'), false);
  assert.equal(m.spend(5, 'a capsule'), true);
  assert.equal(m.state.tokens, 30);
});

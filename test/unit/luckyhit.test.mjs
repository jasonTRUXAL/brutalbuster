import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LUCKY, PATTERNS, THEMES, dayNumber, boardForDay, generateBoard, validateBoard, createWorld, drop, step } from '../../src/luckyhit-physics.js';

const TODAY = dayNumber(new Date(Date.UTC(2026, 9, 28)));

test('day numbers are UTC days, and board #1 was 1 Oct 2026', () => {
  assert.equal(dayNumber(new Date('2026-10-28T00:00:01Z')), dayNumber(new Date('2026-10-28T23:59:59Z')));
  assert.equal(dayNumber(new Date('2026-10-29T00:00:00Z')) - dayNumber(new Date('2026-10-28T12:00:00Z')), 1);
  assert.equal(boardForDay(dayNumber(new Date('2026-10-01T09:00:00Z')), { check: false }).number, 1);
});

test('the board of the day is the same for everyone (deterministic)', () => {
  assert.deepEqual(boardForDay(TODAY), boardForDay(TODAY));
  assert.notDeepEqual(boardForDay(TODAY).pins, boardForDay(TODAY + 1).pins);
});

test('every pattern keeps nails on the board and far enough apart that no ball can wedge', () => {
  const minGap = 2 * (LUCKY.ball + LUCKY.pin);
  for (let d = 0; d < PATTERNS.length; d++) {
    const b = generateBoard(TODAY + d);
    assert.ok(b.pins.length > 30, `${b.pattern}: only ${b.pins.length} nails`);
    for (const [x, y] of b.pins) {
      assert.ok(Math.abs(x) < LUCKY.inner && y >= LUCKY.field.y0 && y <= LUCKY.field.y1, `${b.pattern}: nail off the field`);
    }
    for (let i = 0; i < b.pins.length; i++) for (let j = i + 1; j < b.pins.length; j++) {
      const [ax, ay] = b.pins[i];
      const [bx, by] = b.pins[j];
      assert.ok(Math.hypot(ax - bx, ay - by) > minGap, `${b.pattern}: two nails would trap a ball`);
    }
  }
});

test('slots: one narrow jackpot (never at an edge), regular slots cycle the gacha themes', () => {
  const b = boardForDay(TODAY);
  const jackpots = b.slots.filter((s) => s.jackpot);
  assert.equal(jackpots.length, 1);
  assert.equal(b.slots.length, LUCKY.slots.regular + 1);
  const jp = jackpots[0];
  assert.ok(jp.index > 0 && jp.index < b.slots.length - 1);
  const regular = b.slots.filter((s) => !s.jackpot);
  assert.ok(jp.x1 - jp.x0 < (regular[0].x1 - regular[0].x0) / 2, 'jackpot should be much narrower');
  assert.ok(regular.every((s) => THEMES.includes(s.theme)));
  assert.equal(b.slots.at(-1).x1.toFixed(4), LUCKY.inner.toFixed(4), 'slots fill the board exactly');
});

test('a full year of daily boards all pass the simulation check', () => {
  const failures = [];
  for (let d = TODAY; d < TODAY + 365; d++) {
    const b = boardForDay(d);
    const v = b.check || validateBoard(b); // daily boards carry the check they passed
    if (!v.ok) failures.push(`#${b.number} ${b.pattern}: ${v.reasons.join(', ')}`);
    assert.ok(v.jackpotShare <= 0.12);
  }
  assert.deepEqual(failures, []);
});

test('the fixed Classic fallback board passes (it is the same board every day)', () => {
  const a = generateBoard(TODAY, -1);
  const b = generateBoard(TODAY + 40, -1);
  assert.deepEqual(a.pins, b.pins);
  assert.deepEqual(a.slots.map((s) => [s.x0, s.jackpot]), b.slots.map((s) => [s.x0, s.jackpot]));
  const v = validateBoard(a);
  assert.ok(v.ok, v.reasons.join(', '));
});

test('a dropped ball lands in a slot within a few seconds, deterministically', () => {
  const play = () => {
    const w = createWorld(boardForDay(TODAY), 5);
    const log = [];
    for (const x of [-0.2, -0.05, 0, 0.12, 0.25]) {
      drop(w, x);
      for (let t = 0; t < 12; t += 1 / 60) {
        const ev = step(w, 1 / 60);
        if (ev.length) {
          log.push(`${ev[0].type}:${ev[0].slot?.index}:${t.toFixed(2)}`);
          break;
        }
      }
    }
    return log;
  };
  const a = play();
  assert.equal(a.length, 5);
  assert.ok(a.every((e) => e.startsWith('landed:')), a.join(' '));
  assert.deepEqual(a, play());
});

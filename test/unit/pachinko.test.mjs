import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOARD, pinLayout, createWorld, launch, step } from '../../src/pachinko-physics.js';

const DT = 1 / 60;

/** Run until the ball resolves (or `seconds` pass). Returns the event and the path. */
function fly(power, seconds = 6, seed = 1) {
  const w = createWorld(seed);
  const b = launch(w, power);
  const path = [];
  let releasedAt = null;
  for (let t = 0; t < seconds; t += DT) {
    const evs = step(w, DT);
    path.push([b.x, b.y]);
    if (releasedAt === null && !b.lane) releasedAt = [b.x, b.y];
    if (evs.length) return { event: evs[0], path, releasedAt };
  }
  return { event: null, path, releasedAt };
}

test('pin field stays inside the rail and off the screen', () => {
  const pins = pinLayout();
  assert.ok(pins.length > 120, `only ${pins.length} pins`);
  const { rail, lcd } = BOARD;
  for (const [x, y] of pins) {
    assert.ok(Math.hypot(x - rail.cx, y - rail.cy) < rail.r, 'pin outside the rail');
    assert.ok(!(x > lcd.x0 && x < lcd.x1 && y > lcd.y0 && y < lcd.y1), 'pin on the screen');
  }
});

test('shots leave the lane at the upper left, and power decides how far they carry', () => {
  const furthestRight = (power) => {
    const { releasedAt, event, path } = fly(power);
    assert.ok(releasedAt, `power ${power}: never left the launch lane`);
    assert.ok(releasedAt[0] < 0 && releasedAt[1] > 0, `power ${power}: released at ${releasedAt}`);
    assert.notEqual(event?.type, 'foul');
    // how far right the ball got while still in the top half of the board
    return Math.max(...path.filter(([, y]) => y > 0.05).map(([x]) => x));
  };
  const soft = furthestRight(0.35);
  const hard = furthestRight(1);
  assert.ok(hard > 0.15, `a full-power shot should carry over to the right (reached x=${hard.toFixed(3)})`);
  assert.ok(soft < hard - 0.05, `a softer shot should drop in further left (${soft.toFixed(3)} vs ${hard.toFixed(3)})`);
});

test('a weak shot rolls back down the lane (a foul, not a lost ball)', () => {
  const { event, releasedAt } = fly(0);
  assert.equal(releasedAt, null);
  assert.equal(event?.type, 'foul');
});

test('every ball finishes, none escape, and pockets get hit', () => {
  const w = createWorld(7);
  const counts = { pocket: 0, lost: 0, foul: 0 };
  const pockets = {};
  const SHOTS = 300;
  let fired = 0;
  for (let t = 0; t < 120 && (fired < SHOTS || w.balls.length); t += DT) {
    if (fired < SHOTS && Math.round(t / DT) % 12 === 0) {
      launch(w, 0.45 + ((fired * 37) % 55) / 100); // powers spread over 0.45..1.0
      fired++;
    }
    for (const e of step(w, DT)) {
      counts[e.type]++;
      if (e.type === 'pocket') pockets[e.pocket.id] = (pockets[e.pocket.id] || 0) + 1;
    }
    for (const b of w.balls) {
      const d = Math.hypot(b.x - BOARD.rail.cx, b.y - BOARD.rail.cy);
      assert.ok(d < BOARD.rail.r + 0.035, `ball ${b.id} escaped the board`);
    }
  }
  assert.equal(w.balls.length, 0, `${w.balls.length} balls never finished`);
  assert.equal(counts.pocket + counts.lost + counts.foul, SHOTS);
  assert.ok(counts.pocket > 0, `no pocket hits in ${SHOTS} shots: ${JSON.stringify(counts)}`);
  assert.ok(counts.lost > counts.pocket, 'pockets should be the exception, not the rule');
  assert.ok(pockets.start > 0, `the START pocket was never hit: ${JSON.stringify(pockets)}`);
});

test('no ball lingers: every shot finishes within 8 seconds (many seeds)', () => {
  let worst = 0;
  for (let s = 1; s <= 25; s++) {
    const w = createWorld(s * 7919);
    const born = new Map();
    let fired = 0;
    for (let t = 0; t < 30; t += DT) {
      if (fired < 40 && t >= fired * 0.2) {
        born.set(launch(w, 0.2 + ((fired * 37 + s) % 80) / 100).id, t);
        fired++;
      }
      for (const e of step(w, DT)) worst = Math.max(worst, t - born.get(e.ball.id));
      for (const b of w.balls) assert.ok(t - born.get(b.id) < 8, `seed ${s}: ball ${b.id} still on the board after 8s at ${b.x.toFixed(3)},${b.y.toFixed(3)}`);
    }
  }
  assert.ok(worst > 0);
});

test('simulation is deterministic for a seed', () => {
  const run = () => {
    const w = createWorld(3);
    const log = [];
    for (let i = 0; i < 40; i++) launch(w, 0.5 + (i % 5) / 10);
    for (let t = 0; t < 30; t += DT) for (const e of step(w, DT)) log.push(`${e.type}:${e.ball.id}`);
    return log;
  };
  assert.deepEqual(run(), run());
});

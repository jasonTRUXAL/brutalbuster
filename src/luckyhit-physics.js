// Lucky Hit: the street-stall drop board from Shenmue. You pick a spot along the top,
// let go, and one ball drifts down through the nails into a prize slot. Every slot
// wins; one narrow slot is the jackpot.
//
// This module is pure (no three.js, no DOM) so the painted board, the 3D nails and the
// simulation share one definition, and so every day's board can be checked by
// simulation, here and in the unit tests, before anyone plays it.
//
// Units are metres on the board's face. Origin is the centre of the board, +x right,
// +y up the board.
import { rng, hash, clamp } from './util.js';

export const LUCKY = {
  W: 0.62, // the whole wooden board
  H: 0.94,
  inner: 0.28, // half-width of the play area between the side rails
  ball: 0.0095, // ball radius
  pin: 0.0028, // nail radius
  dropY: 0.39, // where the ball hangs before you let go
  aim: 0.25, // how far left/right you can drop from
  field: { y0: -0.26, y1: 0.33 }, // nails go between these heights
  slots: { y0: -0.43, y1: -0.33, regular: 7, jackpotW: 0.027, divider: 0.004 },
};

export const THEMES = ['tape', 'snack', 'game', 'tv']; // same prize families as the gacha machines
export const PATTERNS = ['Classic', 'Diamonds', 'Chevrons', 'Spiral', 'Zigzag', 'Moose', 'Scatter'];

const G = 0.95; // m/s²: a slow, dramatic fall (about 3-4 seconds top to bottom)
const REST_PIN = 0.42;
const REST_WALL = 0.25;
const SUBSTEP = 1 / 360;
const MIN_GAP = 2 * (0.0095 + 0.0028) + 0.007; // nails never close enough to cradle a ball
const BOARD_ONE = Date.UTC(2026, 9, 1) / 86400000; // board #1 was 1 Oct 2026

/** UTC day number: everyone in the world sees the same board at the same moment. */
export function dayNumber(date = new Date()) {
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86400000);
}

// ------------------------------------------------------------------ board of the day

/**
 * The board for a given UTC day: the day's nail pattern, with the slot layout (and the
 * jackpot's position) shuffled too. Each candidate is played by simulation first, and
 * the first that passes wins (its check result rides along as `board.check`). If none
 * do, a fixed Classic board, tested to always pass, stands in.
 */
export function boardForDay(day, { check = true } = {}) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const b = generateBoard(day, attempt);
    if (!check) return b;
    b.check = validateBoard(b);
    if (b.check.ok) return b;
  }
  return generateBoard(day, -1);
}

/** attempt -1 is the fixed fallback: Classic, no jitter, jackpot in a tested spot. */
export function generateBoard(day, attempt = 0) {
  const r = rng(hash(`lucky-${day}-${attempt}`));
  const fallback = attempt < 0;
  const pattern = fallback ? 'Classic' : PATTERNS[((day % PATTERNS.length) + PATTERNS.length) % PATTERNS.length];
  return {
    day,
    number: day - BOARD_ONE + 1,
    pattern,
    attempt,
    slots: makeSlots(r, day, fallback ? 3 : null),
    pins: makePins(pattern, r, fallback ? 0 : 0.006),
  };
}

function makeSlots(r, day, fixedJackpot) {
  const { inner, slots } = LUCKY;
  const n = slots.regular;
  const jackpotAt = fixedJackpot ?? 1 + Math.floor(r() * (n - 1)); // never at either edge
  const regularW = (2 * inner - slots.jackpotW - n * slots.divider) / n;
  const out = [];
  let x = -inner;
  let theme = ((day % THEMES.length) + THEMES.length) % THEMES.length;
  for (let i = 0; i <= n; i++) {
    const jackpot = i === jackpotAt;
    const w = jackpot ? slots.jackpotW : regularW;
    out.push({ index: i, x0: x, x1: x + w, jackpot, theme: jackpot ? 'rare' : THEMES[theme++ % THEMES.length] });
    x += w + slots.divider;
  }
  return out;
}

/** Nail positions for a pattern, jittered, then thinned so no two are too close. */
function makePins(pattern, r, jitter) {
  const { inner, field } = LUCKY;
  const raw = [];
  const jit = (a) => (r() - 0.5) * a * (jitter / 0.006);
  const grid = (dx, dy, stagger = true, keep = 1) => {
    let row = 0;
    for (let y = field.y1; y >= field.y0; y -= dy, row++) {
      for (let x = -inner + dx / 2 + (stagger && row % 2 ? dx / 2 : 0); x < inner; x += dx) if (r() < keep) raw.push([x, y]);
    }
  };
  if (pattern === 'Classic') grid(0.05, 0.045);
  else if (pattern === 'Diamonds') {
    for (let y = field.y1 - 0.02; y > field.y0; y -= 0.11) {
      for (let x = -inner + 0.06 + (Math.round(y * 100) % 2 ? 0.05 : 0); x < inner - 0.03; x += 0.12) {
        const s = 0.034;
        raw.push([x, y + s], [x - s, y], [x + s, y], [x, y - s], [x, y]);
      }
    }
    grid(0.12, 0.11, true, 0.5);
  } else if (pattern === 'Chevrons') {
    for (let y = field.y1; y > field.y0; y -= 0.085) {
      const dir = Math.round(y * 100) % 2 ? 1 : -1;
      for (let i = -6; i <= 6; i++) raw.push([i * 0.04 + jit(0.006), y - dir * Math.abs(i) * 0.012]);
    }
  } else if (pattern === 'Spiral') {
    for (let t = 0.6; t < 24; t += 0.21) {
      const rad = 0.012 * t;
      raw.push([Math.cos(t) * rad, 0.03 + Math.sin(t) * rad * 1.15]);
    }
    grid(0.07, 0.07, true, 0.55);
  } else if (pattern === 'Zigzag') {
    for (let y = field.y1; y > field.y0; y -= 0.1) {
      const slope = Math.round(y * 100) % 2 ? 0.35 : -0.35;
      for (let x = -inner + 0.02; x < inner; x += 0.036) if (r() < 0.86) raw.push([x, y + slope * x * 0.25]);
    }
    grid(0.09, 0.1, true, 0.4);
  } else if (pattern === 'Moose') {
    // a moose head and antlers in nails, with a sparse field around it
    const head = (t) => [Math.sin(t) * 0.07, -0.02 - Math.cos(t) * 0.1];
    for (let t = -1.4; t <= 1.4; t += 0.22) raw.push(head(t));
    for (const s of [-1, 1]) {
      for (let t = 0; t <= 1; t += 0.16) raw.push([s * (0.06 + t * 0.12), 0.1 + t * 0.09]);
      for (const tip of [0.25, 0.55, 0.85]) raw.push([s * (0.06 + tip * 0.12), 0.1 + tip * 0.09 + 0.05], [s * (0.06 + tip * 0.12), 0.1 + tip * 0.09 + 0.09]);
    }
    grid(0.075, 0.075, true, 0.45);
  } else {
    // Scatter: random, but evenly spread (rejection sampling keeps the min gap)
    for (let i = 0; i < 900; i++) raw.push([(r() * 2 - 1) * inner, field.y0 + r() * (field.y1 - field.y0)]);
  }

  const pins = [];
  const margin = MIN_GAP;
  for (const [x0, y0] of raw) {
    const x = x0 + jit(jitter);
    const y = y0 + jit(jitter);
    if (y < field.y0 || y > field.y1 || Math.abs(x) > inner - margin) continue;
    if (pins.some(([px, py]) => (px - x) ** 2 + (py - y) ** 2 < MIN_GAP * MIN_GAP)) continue;
    pins.push([x, y]);
  }
  return pins;
}

// ------------------------------------------------------------------ physics

const CELL = 0.03;
const key = (cx, cy) => `${cx},${cy}`;

/** Static colliders for a board: nails, divider caps, divider walls, side rails, floor. */
export function createWorld(board, seed = 1) {
  const { inner, pin, slots, ball } = LUCKY;
  const posts = board.pins.map(([x, y]) => ({ x, y, r: pin }));
  const walls = [
    { x0: -inner, y0: slots.y0, x1: -inner, y1: LUCKY.H / 2 }, // side rails
    { x0: inner, y0: slots.y0, x1: inner, y1: LUCKY.H / 2 },
    { x0: -inner, y0: slots.y0, x1: inner, y1: slots.y0 }, // floor of the slots
  ];
  for (const s of board.slots.slice(1)) {
    const x = s.x0 - slots.divider / 2;
    walls.push({ x0: x, y0: slots.y0, x1: x, y1: slots.y1 });
    posts.push({ x, y: slots.y1, r: slots.divider / 2 + 0.0015 }); // rounded divider tops
  }
  const grid = new Map();
  posts.forEach((p, i) => {
    const reach = p.r + ball;
    for (let cx = Math.floor((p.x - reach) / CELL); cx <= Math.floor((p.x + reach) / CELL); cx++) {
      for (let cy = Math.floor((p.y - reach) / CELL); cy <= Math.floor((p.y + reach) / CELL); cy++) {
        const k = key(cx, cy);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(i);
      }
    }
  });
  return { board, posts, walls, grid, balls: [], rand: rng(seed >>> 0), time: 0, nextId: 1 };
}

/** Let go of a ball at `x` (clamped to the drop range). */
export function drop(world, x) {
  const b = {
    id: world.nextId++,
    x: clamp(x, -LUCKY.aim, LUCKY.aim),
    y: LUCKY.dropY,
    vx: (world.rand() - 0.5) * 0.01,
    vy: 0,
    anchor: null,
    nudges: 0,
    settle: 0,
  };
  b.anchor = { x: b.x, y: b.y, t: world.time };
  world.balls.push(b);
  return b;
}

/** Which slot an x position falls in. */
export function slotAt(board, x) {
  return board.slots.reduce((best, s) => (Math.abs(x - (s.x0 + s.x1) / 2) < Math.abs(x - (best.x0 + best.x1) / 2) ? s : best));
}

/**
 * Advance the simulation. Returns events:
 * { type: 'landed', slot, ball } once a ball comes to rest in a slot, or { type: 'lost', ball }.
 */
export function step(world, dt) {
  const events = [];
  let left = Math.min(dt, 0.1);
  while (left > 1e-9) {
    const h = Math.min(SUBSTEP, left);
    left -= h;
    world.time += h;
    for (let i = world.balls.length - 1; i >= 0; i--) {
      const b = world.balls[i];
      const ev = advance(world, b, h);
      if (ev) {
        world.balls.splice(i, 1);
        events.push({ ...ev, ball: b });
      }
    }
  }
  return events;
}

function advance(world, b, h) {
  const { ball, slots } = LUCKY;
  b.vy -= G * h;
  b.vx *= 1 - 0.15 * h; // a touch of air drag keeps it floaty
  b.x += b.vx * h;
  b.y += b.vy * h;

  // nails and divider caps
  const near = world.grid.get(key(Math.floor(b.x / CELL), Math.floor(b.y / CELL)));
  if (near) {
    for (const i of near) {
      const p = world.posts[i];
      const dx = b.x - p.x;
      const dy = b.y - p.y;
      const min = ball + p.r;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min || d2 < 1e-12) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d;
      const ny = dy / d;
      b.x = p.x + nx * min;
      b.y = p.y + ny * min;
      const vn = b.vx * nx + b.vy * ny;
      if (vn < 0) {
        b.vx -= (1 + REST_PIN) * vn * nx;
        b.vy -= (1 + REST_PIN) * vn * ny;
        const jitter = (world.rand() - 0.5) * 0.05; // never balance on a nail
        b.vx += -ny * jitter;
        b.vy += nx * jitter;
      }
    }
  }

  // rails, dividers, floor (thin segments)
  let onFloor = false;
  for (const w of world.walls) {
    const sx = w.x1 - w.x0;
    const sy = w.y1 - w.y0;
    const t = clamp(((b.x - w.x0) * sx + (b.y - w.y0) * sy) / (sx * sx + sy * sy), 0, 1);
    const qx = w.x0 + sx * t;
    const qy = w.y0 + sy * t;
    const ex = b.x - qx;
    const ey = b.y - qy;
    const e2 = ex * ex + ey * ey;
    if (e2 >= ball * ball || e2 < 1e-12) continue;
    const e = Math.sqrt(e2);
    const nx = ex / e;
    const ny = ey / e;
    b.x = qx + nx * ball;
    b.y = qy + ny * ball;
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) {
      b.vx -= (1 + REST_WALL) * vn * nx;
      b.vy -= (1 + REST_WALL) * vn * ny;
    }
    if (ny > 0.9) {
      onFloor = true;
      b.vx *= 1 - 3 * h; // rolling friction in the slot
    }
  }

  // landed: resting on the floor of a slot
  if (b.y < slots.y1 && onFloor && Math.abs(b.vy) < 0.05) {
    b.settle += h;
    if (b.settle > 0.25) return { type: 'landed', slot: slotAt(world.board, b.x) };
  } else b.settle = 0;

  if (b.y < slots.y0 - 0.05) return { type: 'lost' };

  // a ball that makes no progress for a second gets a nudge; after a few it's cleared
  if (world.time - b.anchor.t > 1) {
    if (b.y > slots.y1 && Math.hypot(b.x - b.anchor.x, b.y - b.anchor.y) < 0.005) {
      if (++b.nudges > 4) return { type: 'lost' };
      b.vx += (world.rand() - 0.5) * 0.25;
      b.vy += 0.08;
    }
    b.anchor = { x: b.x, y: b.y, t: world.time };
  }
  return null;
}

// ------------------------------------------------------------------ the daily check

/**
 * Play a board by simulation: `drops` balls spread across the full aim range.
 * A board is OK when every ball lands promptly, every regular slot can be won, the
 * jackpot is rare but reachable, and no single slot hogs the wins.
 */
export function validateBoard(board, { drops = 84 } = {}) {
  const world = createWorld(board, 99);
  const hits = new Array(board.slots.length).fill(0);
  let worst = 0;
  let failures = 0;
  for (let i = 0; i < drops; i++) {
    const x = -LUCKY.aim + ((i + 0.5) / drops) * 2 * LUCKY.aim;
    drop(world, x);
    const t0 = world.time;
    let done = null;
    while (!done && world.time - t0 < 14) {
      const ev = step(world, 1 / 30);
      if (ev.length) done = ev[0];
    }
    worst = Math.max(worst, world.time - t0);
    if (!done || done.type !== 'landed') {
      failures++;
      world.balls.length = 0;
    } else hits[done.slot.index]++;
  }
  const jackpot = board.slots.find((s) => s.jackpot);
  const jackpotShare = hits[jackpot.index] / drops;
  const regular = board.slots.filter((s) => !s.jackpot).map((s) => hits[s.index] / drops);
  const reasons = [];
  if (failures) reasons.push(`${failures} ball(s) never landed`);
  if (worst > 12) reasons.push(`slowest ball took ${worst.toFixed(1)}s`);
  if (regular.some((s) => s === 0)) reasons.push('a regular slot can never be won');
  if (jackpotShare === 0) reasons.push('the jackpot can never be won');
  if (jackpotShare > 0.12) reasons.push(`jackpot too easy (${(jackpotShare * 100).toFixed(0)}%)`);
  if (Math.max(...regular) > 0.4) reasons.push('one slot takes too many balls');
  return { ok: reasons.length === 0, reasons, hits, jackpotShare, worst };
}

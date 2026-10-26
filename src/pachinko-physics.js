// Pachinko board layout and ball physics. Pure 2D (no three.js, no DOM) so it can be
// unit tested, and so the painted playfield (prizes.js) and the simulation share one
// definition of where the rail, pins and pockets are.
//
// Units are metres. Origin is the centre of the playfield, +x right, +y up.
import { rng } from './util.js';

export const BOARD = {
  W: 0.52,
  H: 0.6,
  ball: 0.0055, // radius (a real pachinko ball is 11mm across)
  pin: 0.0022,
  rail: { cx: 0, cy: -0.012, r: 0.234, gapHalf: 0.32 * Math.PI }, // outer rail, open at the bottom
  lcd: { x0: -0.104, x1: 0.104, y0: -0.036, y1: 0.108, frame: 0.012 }, // centre screen (solid)
  cup: { lip: 0.0102, depth: 0.026 }, // pocket mouth height / depth, relative to its centre (width is per pocket)
  // "ways": slanted metal strips under the screen that roll balls in toward START
  ways: [
    // kept well over a ball's width below the screen so nothing can wedge between them
    { x0: -0.19, y0: -0.05, x1: -0.038, y1: -0.075 },
    { x0: 0.19, y0: -0.05, x1: 0.038, y1: -0.075 },
    // a shallow peaked roof on the screen sheds balls to either side (a flat top
    // would let them slide back and forth on it forever)
    { x0: 0, y0: 0.134, x1: -0.124, y1: 0.118, roof: true },
    { x0: 0, y0: 0.134, x1: 0.124, y1: 0.118, roof: true },
  ],
  pockets: [
    { id: 'start', label: 'START', x: 0, y: -0.087, half: 0.022, color: '#ffe14d', payout: 2, spin: true },
    { id: 'tulip-l', x: -0.09, y: -0.18, half: 0.015, color: '#ff3b3b', payout: 5 },
    { id: 'tulip-r', x: 0.09, y: -0.18, half: 0.015, color: '#ff3b3b', payout: 5 },
  ],
  windmills: [
    { x: -0.1768, y: 0.048, r: 0.018 },
    { x: 0.1768, y: 0.048, r: 0.018 },
  ],
  outHole: { x: 0, y: -0.258, r: 0.026 },
};

const G = 3.0; // m/s² — a real board is near vertical; gentler gravity keeps the balls readable
const REST_PIN = 0.45;
const REST_RAIL = 0.15;
const REST_LCD = 0.3;
const REST_WAY = 0.15;
const WAY_HALF = 0.0015; // half-thickness of a way strip
const SUBSTEP = 1 / 480;
const LAUNCH_ANGLE = -Math.PI / 2 - BOARD.rail.gapHalf - 0.04; // just left of the bottom opening
const LANE_END = Math.PI * 0.72; // the launch lane ends at the upper left; power decides how far the ball rides the rail after that
const SPEED = { min: 1.3, max: 1.68 }; // launch speed at power 0 / 1

/** Is (x, y) on, or just above, one of the ways? Those pins would stop a rolling ball. */
function onWay(x, y) {
  return BOARD.ways.some((w) => {
    if (x < Math.min(w.x0, w.x1) - 0.012 || x > Math.max(w.x0, w.x1) + 0.012) return false;
    const lineY = w.y0 + ((x - w.x0) * (w.y1 - w.y0)) / (w.x1 - w.x0);
    return y > lineY - 0.012 && y < lineY + 0.026;
  });
}

/** The classic staggered pin field, kept clear of the screen, pockets and windmills. */
export function pinLayout() {
  const { W, H, rail, lcd, pockets, windmills } = BOARD;
  const r = rng(4242);
  const out = [];
  for (let row = 0; row < 26; row++) {
    const v = 0.17 + row * 0.029;
    for (let col = 0; col < 24; col++) {
      const u = 0.06 + col * 0.04 + (row % 2) * 0.02;
      const x = (u - 0.5) * W;
      const y = (0.5 - v) * H;
      const keep = r() >= 0.22; // gaps make the lanes (drawn every time so the layout is stable)
      if (Math.hypot(x - rail.cx, y - rail.cy) > rail.r - 0.018) continue; // keep the rail itself clear for riding balls
      if (x > lcd.x0 - 0.03 && x < lcd.x1 + 0.03 && y > lcd.y0 - 0.03 && y < lcd.y1 + 0.025) continue;
      if (pockets.some((p) => Math.abs(x - p.x) < 0.034 && y < p.y + 0.03 && y > p.y - 0.035)) continue;
      if (windmills.some((m) => Math.hypot(x - m.x, y - m.y) < m.r + 0.012)) continue;
      if (onWay(x, y)) continue;
      if (keep) out.push([x, y]);
    }
  }
  return out;
}

const CELL = 0.02;
const cellKey = (cx, cy) => `${cx},${cy}`;

/** A fresh board with no balls in play. */
export function createWorld(seed = 1) {
  const { pin, cup, pockets, windmills } = BOARD;
  const posts = pinLayout().map(([x, y]) => ({ x, y, r: pin }));
  // the lips of each pocket's cup, so balls can bounce off the rim
  for (const p of pockets) for (const s of [-1, 1]) posts.push({ x: p.x + s * p.half, y: p.y + cup.lip, r: pin * 1.4 });
  for (const m of windmills) posts.push({ x: m.x, y: m.y, r: m.r });
  const grid = new Map();
  posts.forEach((p, i) => {
    const reach = p.r + BOARD.ball;
    for (let cx = Math.floor((p.x - reach) / CELL); cx <= Math.floor((p.x + reach) / CELL); cx++) {
      for (let cy = Math.floor((p.y - reach) / CELL); cy <= Math.floor((p.y + reach) / CELL); cy++) {
        const k = cellKey(cx, cy);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(i);
      }
    }
  });
  return { balls: [], posts, grid, rand: rng(seed), nextId: 1, time: 0 };
}

/** Fire one ball up the launch lane. `power` 0..1 maps to launch speed. */
export function launch(world, power) {
  const { rail, ball } = BOARD;
  const p = Math.min(1, Math.max(0, power));
  const speed = SPEED.min + p * (SPEED.max - SPEED.min) + (world.rand() - 0.5) * 0.04;
  const a = LAUNCH_ANGLE;
  const rr = rail.r - ball - 0.0005;
  const b = {
    id: world.nextId++,
    x: rail.cx + Math.cos(a) * rr,
    y: rail.cy + Math.sin(a) * rr,
    // clockwise along the rail: up the left side
    vx: Math.sin(a) * speed,
    vy: -Math.cos(a) * speed,
    lane: true,
    anchor: { x: 0, y: 0, t: 0 }, // for spotting balls that stop making progress
    nudges: 0,
  };
  b.anchor = { x: b.x, y: b.y, t: world.time };
  world.balls.push(b);
  return b;
}

const angleFromDown = (ang) => {
  let d = ang + Math.PI / 2;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return Math.abs(d);
};

/**
 * Advance the simulation. Returns what happened, e.g.
 * { type: 'pocket', pocket, ball } | { type: 'lost', ball } | { type: 'foul', ball }
 * (a foul is a ball too weak to clear the lane — it rolls back to the tray).
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
      const ev = advanceBall(world, b, h);
      if (ev) {
        world.balls.splice(i, 1);
        events.push({ ...ev, ball: b });
      }
    }
  }
  return events;
}

function advanceBall(world, b, h) {
  const { rail, ball, lcd, cup, pockets } = BOARD;
  b.vy -= G * h;
  b.x += b.vx * h;
  b.y += b.vy * h;

  // outer rail (inside of a circle), except across the opening at the bottom
  let dx = b.x - rail.cx;
  let dy = b.y - rail.cy;
  let d = Math.hypot(dx, dy);
  const ang = Math.atan2(dy, dx);
  const inGap = angleFromDown(ang) < rail.gapHalf;
  if (!inGap && d > rail.r - ball) {
    const nx = dx / d;
    const ny = dy / d;
    b.x = rail.cx + nx * (rail.r - ball);
    b.y = rail.cy + ny * (rail.r - ball);
    const vn = b.vx * nx + b.vy * ny;
    if (vn > 0) {
      b.vx -= (1 + REST_RAIL) * vn * nx;
      b.vy -= (1 + REST_RAIL) * vn * ny;
    }
    dx = b.x - rail.cx;
    dy = b.y - rail.cy;
    d = Math.hypot(dx, dy);
  }

  if (b.lane) {
    // still riding the launch lane (a separate channel in a real machine: no pins)
    if (ang > 0 && ang < LANE_END) {
      b.lane = false; // into the field; it rides the rail until it slows and drops into the pins
    } else if (b.y < rail.cy + Math.sin(LAUNCH_ANGLE) * rail.r - 0.004 && b.vy < 0) {
      return { type: 'foul' };
    }
    return null;
  }

  // pins, pocket lips and windmills
  const cx = Math.floor(b.x / CELL);
  const cy = Math.floor(b.y / CELL);
  const near = world.grid.get(cellKey(cx, cy));
  if (near) {
    for (const idx of near) {
      const p = world.posts[idx];
      const px = b.x - p.x;
      const py = b.y - p.y;
      const min = ball + p.r;
      const d2 = px * px + py * py;
      if (d2 >= min * min || d2 < 1e-12) continue;
      const pd = Math.sqrt(d2);
      const nx = px / pd;
      const ny = py / pd;
      b.x = p.x + nx * min;
      b.y = p.y + ny * min;
      const vn = b.vx * nx + b.vy * ny;
      if (vn < 0) {
        b.vx -= (1 + REST_PIN) * vn * nx;
        b.vy -= (1 + REST_PIN) * vn * ny;
        // a little chaos so balls never balance on a pin
        const jitter = (world.rand() - 0.5) * 0.06;
        b.vx += -ny * jitter;
        b.vy += nx * jitter;
      }
    }
  }

  // ways: smooth strips (a row of pins would trap balls in the dips between them)
  for (const w of BOARD.ways) {
    const sx = w.x1 - w.x0;
    const sy = w.y1 - w.y0;
    const len2 = sx * sx + sy * sy;
    const t = Math.min(1, Math.max(0, ((b.x - w.x0) * sx + (b.y - w.y0) * sy) / len2));
    const qx = w.x0 + sx * t;
    const qy = w.y0 + sy * t;
    const ex = b.x - qx;
    const ey = b.y - qy;
    const min = ball + WAY_HALF;
    const e2 = ex * ex + ey * ey;
    if (e2 < min * min && e2 > 1e-12) {
      const e = Math.sqrt(e2);
      const nx = ex / e;
      const ny = ey / e;
      b.x = qx + nx * min;
      b.y = qy + ny * min;
      const vn = b.vx * nx + b.vy * ny;
      if (vn < 0) {
        b.vx -= (1 + REST_WAY) * vn * nx;
        b.vy -= (1 + REST_WAY) * vn * ny;
      }
    }
  }

  // the centre screen is solid
  const x0 = lcd.x0 - lcd.frame;
  const x1 = lcd.x1 + lcd.frame;
  const y0 = lcd.y0 - lcd.frame;
  const y1 = lcd.y1 + lcd.frame;
  const qx = Math.min(x1, Math.max(x0, b.x));
  const qy = Math.min(y1, Math.max(y0, b.y));
  const ex = b.x - qx;
  const ey = b.y - qy;
  const e2 = ex * ex + ey * ey;
  if (e2 < ball * ball) {
    let nx;
    let ny;
    let push;
    if (e2 > 1e-12) {
      const e = Math.sqrt(e2);
      nx = ex / e;
      ny = ey / e;
      push = ball - e;
    } else {
      // centre ended up inside: leave by the nearest edge
      const opts = [[b.x - x0, -1, 0], [x1 - b.x, 1, 0], [b.y - y0, 0, -1], [y1 - b.y, 0, 1]].sort((a, c) => a[0] - c[0])[0];
      [, nx, ny] = opts;
      push = opts[0] + ball;
    }
    b.x += nx * push;
    b.y += ny * push;
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) {
      b.vx -= (1 + REST_LCD) * vn * nx;
      b.vy -= (1 + REST_LCD) * vn * ny;
    }
  }

  // pockets: dropping in through the mouth of a cup
  for (const p of pockets) {
    if (b.vy < 0 && Math.abs(b.x - p.x) < p.half - ball * 0.6 && b.y < p.y + cup.lip && b.y > p.y + cup.lip - 0.02) {
      return { type: 'pocket', pocket: p };
    }
  }

  // fell out of the bottom (the out hole), or somehow left the board
  if (b.y < rail.cy - rail.r - 0.01 || d > rail.r + 0.03) return { type: 'lost' };

  // a ball that makes no progress for a second (jammed, or rocking in place) gets a
  // nudge; after a few nudges it's cleared away
  if (world.time - b.anchor.t > 1) {
    if (Math.hypot(b.x - b.anchor.x, b.y - b.anchor.y) < 0.004) {
      if (++b.nudges > 3) return { type: 'lost' };
      b.vx += (world.rand() - 0.5) * 0.4;
      b.vy += 0.15;
    }
    b.anchor = { x: b.x, y: b.y, t: world.time };
  }
  return null;
}

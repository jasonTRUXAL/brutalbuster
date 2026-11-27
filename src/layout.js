// Floor plan solver. Sizes the building to fit the catalog, lays out shelving
// runs ("faces"), and decides which tape sits in which slot. Pure data — no three.js
// objects except the Matrix4 helpers at the bottom.
import * as THREE from 'three';
import { DIM, SLOTS_PER_BAY } from './config.js';
import { rng, shuffle, hash } from './util.js';
import { findBoxSets } from './boxsets.js';

const MAX_COPIES = 4;
/** A box set stands as wide as this many tapes. */
export const BOX_SPAN = 2;
// Fill eye-level shelves first so partly stocked bays look intentional.
const ROW_PRIORITY = [3, 2, 4, 1, 0];
// ...except in an archive, which reads like a page: top shelf first.
const TOP_DOWN = [4, 3, 2, 1, 0];
const FEATURED = [
  'Staff Picks', 'Recently Returned', 'Hidden Gems', 'Cult Corner', 'Late Night',
  'Blast From the Past', 'Grab Bag', 'Weird Stuff', 'Dollar Rentals', 'Rewind Classics',
];
const ENDCAP_LABELS = ['Staff Pick', 'Now Showing', 'Must See', 'Customer Fave', 'Clerk Pick', 'Spotlight'];
const FEATURE_COLORS = ['#ffc61a', '#ff2e88', '#2ee6ff', '#3ddc84', '#ff7a00', '#b388ff'];

const titleSort = (a, b) => a.title.replace(/^(the|a|an)\s+/i, '').localeCompare(b.title.replace(/^(the|a|an)\s+/i, ''), undefined, { numeric: true });

function computeDims(K, M) {
  const W = 2 * (DIM.WALL_UNIT + DIM.SIDE_AISLE) + K * DIM.G_DEPTH + (K - 1) * DIM.AISLE;
  const gLen = M * DIM.BAY_W + 2 * DIM.ENDCAP;
  const D = DIM.FRONT + gLen + DIM.BACK_AISLE + DIM.WALL_UNIT;
  const zFront = D / 2 - DIM.FRONT;
  const zBack = zFront - gLen;
  const wallStartZ = -D / 2 + DIM.WALL_UNIT + 0.05;
  // The hallway to the lounge cuts the front of the left wall; the Extras door cuts the
  // right-hand end of the back wall. The shelving stops short of both.
  const hall = { z1: D / 2 - DIM.HALL_FRONT, z0: D / 2 - DIM.HALL_FRONT - DIM.HALL_W };
  const backDoor = { x1: W / 2 - DIM.WALL_UNIT - 0.05, x0: W / 2 - DIM.WALL_UNIT - 0.05 - DIM.BACK_DOOR_W };
  const backStartX = -W / 2 + DIM.WALL_UNIT + 0.05;
  const leftLen = hall.z0 - 0.15 - wallStartZ; // (room for the door casing)
  const rightLen = zFront - wallStartZ;
  const backLen = backDoor.x0 - 0.15 - backStartX;
  const leftBays = Math.floor(leftLen / DIM.BAY_W);
  const rightBays = Math.floor(rightLen / DIM.BAY_W);
  const backBays = Math.floor(backLen / DIM.BAY_W);
  return {
    K, M, W, D, gLen, zFront, zBack, wallStartZ, leftLen, rightLen, backLen, backStartX, leftBays, rightBays, backBays,
    hall, backDoor,
    genreBays: 2 * K * M + leftBays + rightBays,
  };
}

function chooseSize(needBays) {
  const options = [];
  for (let M = 3; M <= 6; M++) for (let K = 3; K <= 16; K++) options.push(computeDims(K, M));
  const fits = options.filter((o) => o.genreBays >= needBays);
  if (!fits.length) return options.reduce((a, b) => (b.genreBays > a.genreBays ? b : a));
  // Smallest store that fits; prefer ~4-bay gondolas and a squarish footprint.
  fits.sort((a, b) => a.genreBays + Math.abs(a.M - 4) * 3 - (b.genreBays + Math.abs(b.M - 4) * 3));
  return fits[0];
}

/** How many slots wide a shelf item is: a tape is 1, a box set BOX_SPAN. */
const widthOf = (it) => (it?.boxSet ? BOX_SPAN : 1);

/** Spread `slots` slots across `items`, copies adjacent, max `maxCopies` each. */
function withCopies(items, slots, maxCopies) {
  if (!items.length) return [];
  const units = items.reduce((n, it) => n + widthOf(it), 0);
  const per = Math.min(maxCopies, Math.max(1, Math.floor(slots / units)));
  let extra = Math.min(units, Math.max(0, slots - per * units));
  if (per >= maxCopies) extra = 0;
  const out = [];
  let used = 0;
  for (const it of items) {
    const w = widthOf(it);
    const more = extra >= w; // (an extra copy only where it fits in what's spare)
    if (more) extra -= w;
    for (let i = 0; i < per + (more ? 1 : 0) && used + w <= slots; i++, used += w) out.push(it);
  }
  return out;
}

/**
 * Hand `spare` bays to the groups ({ items, bays }) that would otherwise be thinnest
 * (never past MAX_COPIES copies a title). A negative `spare` (more bays wanted than there
 * are) takes bays back from the biggest groups instead. Returns the bays left over.
 */
function shareBays(groups, spare) {
  while (spare > 0) {
    let best = null;
    for (const g of groups) {
      const ratio = ((g.bays + 1) * SLOTS_PER_BAY) / g.items.length;
      if (ratio <= MAX_COPIES && (!best || ratio < ((best.bays + 1) * SLOTS_PER_BAY) / best.items.length)) best = g;
    }
    if (!best) break;
    best.bays++;
    spare--;
  }
  // Too big for the room? Trim the largest groups.
  while (spare < 0) {
    const g = groups.reduce((a, b) => (b.bays > a.bays ? b : a));
    g.bays--;
    spare++;
  }
  return spare;
}

/** Give each section its bays, in order, snaking along `faces` (one after another). */
function snakeBays(faces, sections) {
  let fi = 0;
  let bi = 0;
  for (const sec of sections) {
    for (let b = 0; b < sec.bays; b++) {
      while (fi < faces.length && bi >= faces[fi].bays) {
        fi++;
        bi = 0;
      }
      if (fi >= faces.length) return;
      faces[fi].bayList.push({ section: sec, index: bi });
      bi++;
    }
  }
}

/**
 * Put each section's tapes into the slots of the bays it was given. A section carries on
 * from one bay (or face) to the next. Shelves fill in `face.rows` order (eye level first
 * unless the face says otherwise); a `rowMajor` face runs each row along the whole face.
 */
function fillSlots(faces, boxes = []) {
  const slots = [];
  const cursor = new Map();
  // A box set stands across BOX_SPAN slots. Its tapes are slots too (so picking one up,
  // carrying it and the VCR work as for any tape), all at the box's middle; the box
  // itself goes in `boxes`. One that won't fit at the end of a shelf starts the next.
  const placeBox = (item, face, bay, row, col, sec) => {
    const box = { boxSet: item.boxSet, face, bay, row, col: col + (BOX_SPAN - 1) / 2, section: sec, parts: [] };
    item.boxSet.videos.forEach((video, part) => {
      const s = { video, face, bay, row, col: box.col, section: sec, box, part };
      slots.push(s);
      box.parts.push(s);
    });
    boxes.push(box);
  };
  for (const face of faces) {
    const rows = face.rows || ROW_PRIORITY;
    if (face.rowMajor) {
      const sec = face.bayList[0]?.section;
      if (!sec) continue;
      let k = 0;
      for (const row of rows) {
        for (const { index: bay } of face.bayList) {
          for (let col = 0; col < face.perRow; col++) {
            const video = sec.items?.[k++];
            if (video) slots.push({ video, face, bay, row, col, section: sec });
          }
        }
      }
      continue;
    }
    for (const { section: sec, index: bay } of face.bayList) {
      let k = cursor.get(sec) || 0;
      for (const row of rows) {
        for (let col = 0; col < face.perRow; col++) {
          const item = sec.items?.[k];
          if (item?.boxSet) {
            if (col + BOX_SPAN > face.perRow) break;
            placeBox(item, face, bay, row, col, sec);
            col += BOX_SPAN - 1;
          } else if (item) slots.push({ video: item, face, bay, row, col, section: sec });
          k++;
        }
      }
      cursor.set(sec, k);
    }
  }
  return slots;
}

export function planStore(catalog) {
  const { videos, aisles } = catalog;
  const random = rng(hash(videos.map((v) => v.id).join('|')) || 1);

  const byAisle = new Map(aisles.map((a) => [a.id, []]));
  videos.forEach((v) => byAisle.get(v.aisle)?.push(v));
  for (const list of byAisle.values()) list.sort(titleSort);

  const genres = aisles
    .map((a) => ({ aisle: a, items: byAisle.get(a.id) || [] }))
    .filter((g) => g.items.length)
    .map((g) => ({ ...g, bays: Math.ceil(g.items.length / SLOTS_PER_BAY) }));

  const need = genres.reduce((n, g) => n + g.bays, 0);
  const dims = chooseSize(need);
  const { K, M, W, D, zFront, zBack } = dims;

  let spare = shareBays(genres, dims.genreBays - need);

  // ---- sections (in shelving order)
  const sections = [];
  for (const g of genres) {
    const slots = g.bays * SLOTS_PER_BAY;
    sections.push({
      key: g.aisle.id,
      label: g.aisle.name,
      color: g.aisle.color,
      kind: 'genre',
      bays: g.bays,
      items: withCopies(g.items.slice(0, slots), slots, MAX_COPIES),
    });
  }
  const pool = shuffle(videos, random);
  let poolIdx = 0;
  const pick = (n) => {
    const out = [];
    for (let i = 0; i < n && videos.length; i++) out.push(pool[poolIdx++ % pool.length]);
    return out;
  };
  // filler sections must never share a name with a real aisle
  const aisleNames = new Set(aisles.map((a) => a.name.toLowerCase()));
  const featured = FEATURED.filter((f) => !aisleNames.has(f.toLowerCase()));
  for (let i = 0; spare > 0; i++) {
    const bays = Math.min(spare, 2);
    spare -= bays;
    sections.push({
      key: `featured-${i}`,
      label: featured[i % featured.length],
      color: FEATURE_COLORS[i % FEATURE_COLORS.length],
      kind: 'featured',
      bays,
      items: pick(bays * SLOTS_PER_BAY),
    });
  }

  // ---- faces (shelving runs). t = viewer's right, n = toward viewer.
  const faces = [];
  const addFace = (f) => {
    const perRow = Math.floor((f.bayW - 0.06) / DIM.SLOT_PITCH);
    faces.push({ id: faces.length, room: 'main', bayW: DIM.BAY_W, ...f, perRow, bayList: [] });
    return faces[faces.length - 1];
  };
  const gx = (i) => -W / 2 + DIM.WALL_UNIT + DIM.SIDE_AISLE + DIM.G_DEPTH / 2 + i * (DIM.G_DEPTH + DIM.AISLE);
  const gondolas = [];
  const sideFaces = [];

  const leftX = -W / 2 + DIM.WALL_UNIT;
  const left = addFace({
    kind: 'wall', origin: { x: leftX, z: dims.wallStartZ + dims.leftLen }, t: { x: 0, z: -1 }, n: { x: 1, z: 0 },
    length: dims.leftLen, bays: dims.leftBays, bayW: DIM.BAY_W,
  });
  sideFaces.push(left);
  for (let i = 0; i < K; i++) {
    const x = gx(i);
    gondolas.push({ x, zFront, zBack });
    const coreFront = zFront - DIM.ENDCAP;
    const coreBack = zBack + DIM.ENDCAP;
    sideFaces.push(addFace({
      kind: 'gondola', gondola: i, origin: { x: x - DIM.G_DEPTH / 2, z: coreBack }, t: { x: 0, z: 1 }, n: { x: -1, z: 0 },
      length: M * DIM.BAY_W, bays: M, bayW: DIM.BAY_W,
    }));
    sideFaces.push(addFace({
      kind: 'gondola', gondola: i, origin: { x: x + DIM.G_DEPTH / 2, z: coreFront }, t: { x: 0, z: -1 }, n: { x: 1, z: 0 },
      length: M * DIM.BAY_W, bays: M, bayW: DIM.BAY_W,
    }));
  }
  const rightX = W / 2 - DIM.WALL_UNIT;
  sideFaces.push(addFace({
    kind: 'wall', origin: { x: rightX, z: dims.wallStartZ }, t: { x: 0, z: 1 }, n: { x: -1, z: 0 },
    length: dims.rightLen, bays: dims.rightBays, bayW: DIM.BAY_W,
  }));

  snakeBays(sideFaces, sections);

  // Back wall — New Releases.
  const backZ = -D / 2 + DIM.WALL_UNIT;
  const back = addFace({
    kind: 'wall', origin: { x: dims.backStartX, z: backZ }, t: { x: 1, z: 0 }, n: { x: 0, z: 1 },
    length: dims.backLen, bays: dims.backBays, bayW: DIM.BAY_W,
  });
  const newest = videos
    .slice()
    .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
  const backSlots = dims.backBays * SLOTS_PER_BAY;
  const nNew = Math.min(newest.length, Math.max(14, Math.floor(backSlots / 6)));
  const newSection = {
    key: 'new-releases', label: 'New Releases', color: '#ffc61a', kind: 'new',
    bays: dims.backBays, items: withCopies(newest.slice(0, nNew), backSlots, 8),
  };
  for (let b = 0; b < dims.backBays; b++) back.bayList.push({ section: newSection, index: b });
  back.rowMajor = true; // copies run along the whole wall, not bay by bay

  // Endcaps — one title, face-out, many copies.
  const endcapSections = [];
  const spotlight = shuffle(videos, random);
  let ec = 0;
  for (const g of gondolas) {
    for (const front of [true, false]) {
      const video = spotlight[ec % spotlight.length];
      const sec = {
        key: `endcap-${ec}`, label: ENDCAP_LABELS[ec % ENDCAP_LABELS.length], color: FEATURE_COLORS[ec % FEATURE_COLORS.length],
        kind: 'endcap', bays: 1, items: [],
      };
      const bayW = DIM.G_DEPTH - 0.04;
      const face = front
        ? addFace({ kind: 'endcap', origin: { x: g.x - bayW / 2, z: zFront }, t: { x: 1, z: 0 }, n: { x: 0, z: 1 }, length: bayW, bays: 1, bayW })
        : addFace({ kind: 'endcap', origin: { x: g.x + bayW / 2, z: zBack }, t: { x: -1, z: 0 }, n: { x: 0, z: -1 }, length: bayW, bays: 1, bayW });
      sec.items = Array(face.perRow * DIM.SHELF_COUNT).fill(video);
      face.bayList.push({ section: sec, index: 0 });
      endcapSections.push(sec);
      ec++;
    }
  }

  // ---- slots
  const slots = fillSlots(faces);

  // ---- hanging aisle signs (one per aisle, at the front end of the gondolas)
  const aisleSigns = [];
  for (let j = 0; j <= K; j++) {
    const xL = j === 0 ? leftX : gx(j - 1) + DIM.G_DEPTH / 2;
    const xR = j === K ? rightX : gx(j) - DIM.G_DEPTH / 2;
    const facesHere = [sideFaces[2 * j], sideFaces[2 * j + 1]].filter(Boolean);
    const labels = [];
    for (const f of facesHere) for (const { section } of f.bayList) if (!labels.includes(section.label)) labels.push(section.label);
    aisleSigns.push({ number: j + 1, x: (xL + xR) / 2, z: zFront + 0.25, labels });
  }

  // ---- colliders (axis-aligned boxes in XZ)
  const colliders = [];
  const box = (minX, maxX, minZ, maxZ) => colliders.push({ minX, maxX, minZ, maxZ });
  for (const g of gondolas) box(g.x - DIM.G_DEPTH / 2, g.x + DIM.G_DEPTH / 2, zBack, zFront);
  box(-W / 2, -W / 2 + DIM.WALL_UNIT, -D / 2, dims.hall.z0 - 0.15); // left wall unit, up to the hallway
  box(W / 2 - DIM.WALL_UNIT, W / 2, -D / 2, zFront); // right wall unit
  box(-W / 2, dims.backDoor.x0, -D / 2, -D / 2 + DIM.WALL_UNIT); // back wall unit, either side of the Extras door
  box(dims.backDoor.x1, W / 2, -D / 2, -D / 2 + DIM.WALL_UNIT);

  // Checkout counter + staff area (front-right corner)
  // (leaves a cross-aisle in front of the gondolas so the right-hand aisle stays open)
  const counter = {
    x: W / 2 - 2.5,
    zMin: zFront + 1.7,
    zMax: D / 2 - 1.2,
    depth: 0.7,
  };
  box(counter.x - counter.depth / 2, W / 2, counter.zMin - 0.05, D / 2);

  // Entrance
  const doorX = (-W / 2 + DIM.WALL_UNIT + (counter.x - counter.depth / 2)) / 2;
  const door = { x: doorX, width: 1.9, height: 2.35 };

  // The rooms off the sales floor, and every wall in the building.
  const annex = planAnnex(dims, catalog.areas?.streams);
  colliders.push(...annex.colliders);
  slots.push(...annex.slots);
  const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const r of annex.rooms) {
    bounds.minX = Math.min(bounds.minX, r.x0);
    bounds.maxX = Math.max(bounds.maxX, r.x1);
    bounds.minZ = Math.min(bounds.minZ, r.z0);
    bounds.maxZ = Math.max(bounds.maxZ, r.z1);
  }

  return {
    W, D, K, M, zFront, zBack, dims,
    faces, slots, sections, newSection, endcapSections, gondolas, aisleSigns, colliders,
    // Streams' box sets: { boxSet, face, bay, row, col, section, parts: [slot…] } (their
    // tapes are in `slots` too, with `box` and `part` set)
    boxes: annex.boxes,
    counter, door,
    walls: annex.walls,
    portals: annex.portals,
    rooms: annex.rooms,
    hall: annex.hall,
    lounge: annex.lounge,
    streams: annex.streams,
    extras: annex.extras,
    spawn: { x: doorX, z: D / 2 - 1.3, yaw: 0 },
    // walls do the real work; this just keeps the player inside the building's footprint
    bounds,
  };
}

// ------------------------------------------------------------------ annex rooms

const WALL_T = 0.2; // collider thickness behind an outside wall
const DIVIDER = 0.12; // the lounge / Streams partition

/**
 * A straight wall. `axis` is the coordinate that's constant along it ('x': the wall runs
 * along z at x = `at`; 'z': it runs along x at z = `at`), from `from` to `to`. `side`
 * (±1) is the way it faces along that axis, into its room. `openings` are spans
 * { from, to, h } that are open from the floor up to height h.
 */
function wall(room, axis, at, from, to, side, { openings = [], thick = WALL_T, height = DIM.CEILING, draw = true } = {}) {
  return { room, axis, at, from, to, side, openings, thick, height, draw };
}

/** A wall split into solid spans and openings, in order along it. */
export function wallSpans(w) {
  const spans = [];
  let s = w.from;
  for (const o of [...w.openings].sort((a, b) => a.from - b.from)) {
    if (o.from > s) spans.push({ from: s, to: o.from, solid: true });
    spans.push({ from: o.from, to: o.to, solid: false, h: o.h });
    s = o.to;
  }
  if (s < w.to) spans.push({ from: s, to: w.to, solid: true });
  return spans;
}

/** Colliders for a wall's solid spans: a slab just behind its face, run past the wall's
 *  ends (not past an opening's edges) so corners are sealed. */
function wallColliders(w) {
  const out = [];
  const c0 = w.side > 0 ? w.at - w.thick : w.at;
  const c1 = w.side > 0 ? w.at : w.at + w.thick;
  for (const sp of wallSpans(w)) {
    if (!sp.solid) continue;
    const a = sp.from - (sp.from === w.from ? WALL_T : 0);
    const b = sp.to + (sp.to === w.to ? WALL_T : 0);
    out.push(w.axis === 'x' ? { minX: c0, maxX: c1, minZ: a, maxZ: b } : { minX: a, maxX: b, minZ: c0, maxZ: c1 });
  }
  return out;
}

/** A shelving run (same shape as planStore's faces) with every bay given to `section`, if one. */
function shelfRun(kind, origin, t, n, length, section, bayW = DIM.BAY_W) {
  const bays = Math.max(1, Math.floor(length / bayW + 1e-6));
  const perRow = Math.floor((bayW - 0.06) / DIM.SLOT_PITCH);
  const bayList = section ? Array.from({ length: bays }, (_, index) => ({ section, index })) : []; // (filled in later)
  return { kind, origin, t, n, length, bays, bayW, perRow, bayList };
}

/** Wall shelving against wall `w`, between `a` and `b` along it. */
function wallShelf(w, a, b, section) {
  const n = w.axis === 'x' ? { x: w.side, z: 0 } : { x: 0, z: w.side };
  const t = { x: n.z, z: -n.x }; // the viewer's right, facing the shelf
  const front = w.at + w.side * DIM.WALL_UNIT;
  const start = (w.axis === 'x' ? t.z : t.x) > 0 ? a : b;
  const origin = w.axis === 'x' ? { x: front, z: start } : { x: start, z: front };
  return shelfRun('wall', origin, t, n, b - a, section);
}

/** The four faces of a double-sided gondola running along z. */
function gondolaRuns(x, zFront, zBack, section) {
  const G = DIM.G_DEPTH;
  const E = DIM.ENDCAP;
  const ec = G - 0.04;
  const len = zFront - zBack - 2 * E;
  return [
    shelfRun('gondola', { x: x - G / 2, z: zBack + E }, { x: 0, z: 1 }, { x: -1, z: 0 }, len, section),
    shelfRun('gondola', { x: x + G / 2, z: zFront - E }, { x: 0, z: -1 }, { x: 1, z: 0 }, len, section),
    shelfRun('endcap', { x: x - ec / 2, z: zFront }, { x: 1, z: 0 }, { x: 0, z: 1 }, ec, section, ec),
    shelfRun('endcap', { x: x + ec / 2, z: zBack }, { x: -1, z: 0 }, { x: 0, z: -1 }, ec, section, ec),
  ];
}

/** Axis-aligned footprint of a wall shelving run (shelf front back to the wall). */
function runCollider(f) {
  const xs = [f.origin.x, f.origin.x + f.t.x * f.length, f.origin.x - f.n.x * DIM.WALL_UNIT];
  const zs = [f.origin.z, f.origin.z + f.t.z * f.length, f.origin.z - f.n.z * DIM.WALL_UNIT];
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

const square = (x, z, half) => ({ minX: x - half, maxX: x + half, minZ: z - half, maxZ: z + half });

/**
 * The rooms around the sales floor. All of them hang off the main store's size, so they
 * follow it when the channel grows:
 * - a short hallway through the left wall, near the front;
 * - the wing it leads to: a lounge across the front third (couches facing a projector
 *   screen on the far wall) and Streams behind it, through an archway;
 * - the Extras back room, behind the back wall's right-hand corner.
 * Streams is stocked from its own catalog (`streamsArea`, from addArea() in catalog.js)
 * and runs further back when that needs more shelf than the sales floor's depth gives.
 * Without one, and in Extras for now, the shelving is empty "coming soon" stock.
 */
function planAnnex(d, streamsArea) {
  const { W, D, hall: h, backDoor: bd } = d;
  const H = DIM.OPENING_H;
  const WU = DIM.WALL_UNIT;
  const walls = [];
  const add = (w) => (walls.push(w), w);

  // sales floor: the shop front itself (glass and door) is built by store.js
  add(wall('main', 'x', -W / 2, -D / 2, D / 2, 1, { openings: [{ from: h.z0, to: h.z1, h: H }] }));
  add(wall('main', 'x', W / 2, -D / 2, D / 2, -1));
  add(wall('main', 'z', -D / 2, -W / 2, W / 2, 1, { openings: [{ from: bd.x0, to: bd.x1, h: H }], thick: 0.02 }));
  add(wall('main', 'z', D / 2, -W / 2, W / 2, -1, { draw: false }));
  const main = { id: 'main', x0: -W / 2, x1: W / 2, z0: -D / 2, z1: D / 2 };

  // hallway (its ceiling is the openings' height, so no wall shows above them)
  const hx1 = -W / 2;
  const hx0 = hx1 - DIM.HALL_LEN;
  add(wall('hall', 'z', h.z0, hx0, hx1, 1, { height: H }));
  add(wall('hall', 'z', h.z1, hx0, hx1, -1, { height: H }));
  const hall = { id: 'hall', x0: hx0, x1: hx1, z0: h.z0, z1: h.z1 };

  // the wing: lounge in front, Streams behind
  const wx1 = hx0;
  const wx0 = wx1 - DIM.WING_W;
  const zDiv = D / 2 - D / 3;
  const arch = { x1: wx1 - 0.35, x0: wx1 - 0.35 - DIM.ARCH_W };
  const archOpening = [{ from: arch.x0, to: arch.x1, h: H }];
  const lz0 = zDiv + DIVIDER / 2;
  const sz1 = zDiv - DIVIDER / 2;
  add(wall('lounge', 'x', wx0, lz0, D / 2, 1));
  add(wall('lounge', 'x', wx1, lz0, D / 2, -1, { openings: [{ from: h.z0, to: h.z1, h: H }] }));
  add(wall('lounge', 'z', D / 2, wx0, wx1, -1));
  add(wall('lounge', 'z', lz0, wx0, wx1, 1, { openings: archOpening, thick: DIVIDER }));
  // Streams reaches back at least as far as the sales floor, and a bay further at a time
  // until its tapes fit
  const archive = archiveGroups(streamsArea);
  const need = archive.reduce((n, g) => n + g.bays, 0);
  let shelving;
  for (let k = 0; k <= MAX_STREAMS_GROWTH; k++) {
    shelving = streamsShelving(wx0, wx1, -D / 2 - k * DIM.BAY_W, sz1);
    if (shelving.bays >= need) break;
  }
  add(shelving.west);
  add(shelving.east);
  add(shelving.back);
  const sz0 = shelving.back.at;
  add(wall('streams', 'z', sz1, wx0, wx1, -1, { openings: archOpening, thick: DIVIDER }));

  // Extras, behind the back wall
  const ex1 = W / 2;
  const ex0 = ex1 - DIM.EXTRAS_W;
  const ez1 = -D / 2;
  const ez0 = ez1 - DIM.EXTRAS_D;
  const eFront = add(wall('extras', 'z', ez1, ex0, ex1, -1, { openings: [{ from: bd.x0, to: bd.x1, h: H }], thick: 0.02 }));
  const eBack = add(wall('extras', 'z', ez0, ex0, ex1, 1));
  const eWest = add(wall('extras', 'x', ex0, ez0, ez1, 1));
  const eEast = add(wall('extras', 'x', ex1, ez0, ez1, -1));

  const colliders = walls.flatMap(wallColliders);

  // ---- lounge furniture (built by lounge.js; the footprints live here so the tests can
  // check nothing blocks the way through)
  const zc = (lz0 + D / 2) / 2;
  const lounge = {
    id: 'lounge', x0: wx0, x1: wx1, z0: lz0, z1: D / 2,
    arch,
    // the projection screen on the far wall: a tape in the VCR plays on it
    screen: { x: wx0 + 0.06, y: 1.55, z: zc, w: 3.0, h: 1.69, n: { x: 1, z: 0 } },
    projector: { x: wx0 + 5.4, y: 3.02, z: zc },
    sofas: [
      { x: wx0 + 3.0, z: zc, len: 2.3, depth: 0.92 },
      { x: wx0 + 4.5, z: zc, len: 2.3, depth: 0.92 },
    ],
    table: { x: wx0 + 1.95, z: zc, w: 0.55, len: 1.1 },
    lamp: { x: wx0 + 3.75, z: D / 2 - 0.35 },
    popcorn: { x: wx1 - 0.62, z: D / 2 - 0.62 },
    // a low media cabinet under the screen (w along the wall), the VCR on top, its front
    // (where the tape goes in) facing the room
    cabinet: { x: wx0 + 0.22, z: zc, w: 1.3, d: 0.44, h: 0.5 },
    vcr: { x: wx0 + 0.27, y: 0.5, z: zc, w: 0.43, d: 0.3, h: 0.09, n: { x: 1, z: 0 } },
  };
  // three seats per couch, where your eyes are once you've sat down
  lounge.seats = lounge.sofas.flatMap((s, sofa) => [-1, 0, 1].map((k) => ({ sofa, x: s.x + 0.06, y: DIM.SEATED_EYE, z: s.z + (k * (s.len - 0.36)) / 3 })));
  for (const s of lounge.sofas) colliders.push({ minX: s.x - s.depth / 2, maxX: s.x + s.depth / 2, minZ: s.z - s.len / 2, maxZ: s.z + s.len / 2 });
  const tb = lounge.table;
  colliders.push({ minX: tb.x - tb.w / 2, maxX: tb.x + tb.w / 2, minZ: tb.z - tb.len / 2, maxZ: tb.z + tb.len / 2 });
  const cb = lounge.cabinet;
  colliders.push({ minX: cb.x - cb.d / 2, maxX: cb.x + cb.d / 2, minZ: cb.z - cb.w / 2, maxZ: cb.z + cb.w / 2 });
  colliders.push(square(lounge.lamp.x, lounge.lamp.z, 0.2));
  colliders.push(square(lounge.popcorn.x, lounge.popcorn.z, 0.4));

  // ---- Streams: wall shelving on three sides and a gondola down the middle
  const soon = (key, color) => ({ key, label: 'Coming Soon', color, kind: 'placeholder' });
  const sSoon = soon('streams-soon', '#b388ff');
  const { chain, endcaps, gondola: g } = shelving;
  const stocked = archive.length > 0;
  const sections = [];
  if (stocked) {
    // a section per year (the catalog's aisles, in its order), each in upload order so a
    // playthrough's parts read left to right; spare bays go to the busiest years
    shareBays(archive, shelving.bays - need);
    for (const grp of archive) {
      const slots = grp.bays * grp.perBay;
      sections.push({
        key: grp.aisle.id, label: grp.aisle.name, color: grp.aisle.color, kind: 'genre', bays: grp.bays,
        items: withCopies(grp.items.slice(-slots), slots, MAX_COPIES), // (too many: keep the newest)
      });
    }
    snakeBays(chain, sections);
    // the gondola's ends: the newest upload faces the archway, a clerk's pick the back
    const videos = streamsArea.videos;
    const latest = videos.reduce((a, b) => (String(b.publishedAt) > String(a.publishedAt) ? b : a));
    const pick = videos[Math.floor(rng(hash(videos.map((v) => v.id).join('|')) || 1)() * videos.length)];
    for (const [face, key, label, color, video] of [
      [endcaps.front, 'streams-latest', 'Latest Stream', '#ff2e88', latest],
      [endcaps.rear, 'streams-pick', 'Clerk Pick', '#ffc61a', pick],
    ]) {
      const sec = { key, label, color, kind: 'endcap', bays: 1, items: Array(face.perRow * DIM.SHELF_COUNT).fill(video) };
      face.bayList.push({ section: sec, index: 0 });
      sections.push(sec);
    }
  }
  // whatever's left over (all of it, before there's a catalog) is "coming soon" stock
  for (const f of [...chain, endcaps.front, endcaps.rear]) for (let i = f.bayList.length; i < f.bays; i++) f.bayList.push({ section: sSoon, index: i });
  const streamFaces = [...shelving.walls, ...chain.filter((f) => f.kind === 'gondola'), endcaps.front, endcaps.rear];
  for (const f of streamFaces) f.room = 'streams';
  colliders.push({ minX: g.x - DIM.G_DEPTH / 2, maxX: g.x + DIM.G_DEPTH / 2, minZ: g.zBack, maxZ: g.zFront });
  const streams = {
    id: 'streams', x0: wx0, x1: wx1, z0: sz0, z1: sz1,
    faces: streamFaces, gondolas: [g], stocked, sections,
    // cardboard boxes of stock waiting to be shelved (once it's shelved, just one stack,
    // against the partition where it's in nobody's way)
    boxes: stocked
      ? [{ x: wx0 + 2.0, z: sz1 - 0.36, seed: 11 }]
      : [
        { x: wx0 + WU + 0.36, z: sz0 + WU + 0.36, seed: 11 },
        { x: g.x, z: g.zBack - 0.55, seed: 23 },
      ],
  };

  // ---- Extras: shelving round the walls
  const eSoon = soon('extras-soon', '#2ee6ff');
  const extras = {
    id: 'extras', x0: ex0, x1: ex1, z0: ez0, z1: ez1,
    door: bd,
    faces: [
      wallShelf(eBack, ex0 + WU + 0.05, ex1 - WU - 0.05, eSoon),
      wallShelf(eWest, ez0 + WU + 0.05, ez1 - 0.05, eSoon),
      wallShelf(eEast, ez0 + WU + 0.05, ez1 - 0.05, eSoon),
      wallShelf(eFront, ex0 + WU + 0.05, bd.x0 - 0.15, eSoon),
    ].map((f) => ({ ...f, room: 'extras' })),
    gondolas: [],
    boxes: [
      { x: ex0 + WU + 0.36, z: ez0 + WU + 0.36, seed: 37 },
      { x: ex1 - WU - 0.4, z: ez0 + 1.7, seed: 41 },
    ],
  };

  for (const room of [streams, extras]) {
    for (const f of room.faces) if (f.kind === 'wall') colliders.push(runCollider(f));
    for (const b of room.boxes) colliders.push(square(b.x, b.z, 0.31));
  }

  // The doorways between rooms, as thin boxes (y from 0 to H). A room can only be seen
  // through one of these, which is what lets the renderer skip the ones out of view.
  const P = 0.1;
  const portals = [
    { rooms: ['main', 'hall'], x0: hx1 - P, x1: hx1 + P, z0: h.z0, z1: h.z1 },
    { rooms: ['hall', 'lounge'], x0: hx0 - P, x1: hx0 + P, z0: h.z0, z1: h.z1 },
    { rooms: ['lounge', 'streams'], x0: arch.x0, x1: arch.x1, z0: zDiv - P, z1: zDiv + P },
    { rooms: ['main', 'extras'], x0: bd.x0, x1: bd.x1, z0: ez1 - P, z1: ez1 + P },
  ].map((p) => ({ ...p, y0: 0, y1: H }));

  const boxes = [];
  const slots = fillSlots(stocked ? [...chain, endcaps.front, endcaps.rear] : [], boxes);
  return { walls, colliders, slots, boxes, portals, rooms: [main, hall, lounge, streams, extras], hall, lounge, streams, extras };
}

/** Which room is the point in? (The sales floor if it's in none, e.g. out on the street.) */
export function roomAt(plan, p, slack = 0.1) {
  const inside = (r) => p.x > r.x0 - slack && p.x < r.x1 + slack && p.z > r.z0 - slack && p.z < r.z1 + slack;
  return plan.rooms.find((r) => r.id !== 'main' && inside(r))?.id || 'main';
}

/**
 * The rooms that could be in view from `at`: the one it's in, plus any reached through
 * a chain of doorways that `sees(portal)` says are in view (the camera frustum test).
 * Generous rather than exact: a room is only left out when no doorway to it is in view.
 */
export function visibleRooms(plan, at, sees) {
  const seen = new Set([roomAt(plan, at)]);
  const queue = [...seen];
  while (queue.length) {
    const room = queue.shift();
    for (const p of plan.portals) {
      const k = p.rooms.indexOf(room);
      if (k < 0) continue;
      const next = p.rooms[1 - k];
      if (seen.has(next) || !sees(p)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

const MAX_STREAMS_GROWTH = 25; // bays' worth (30 m): past that, the oldest tapes don't fit
// (a box set goes just before its first tape, which went up at the same moment)
const uploadOrder = (a, b) => String(a.publishedAt).localeCompare(String(b.publishedAt)) || (b.boxSet ? 1 : 0) - (a.boxSet ? 1 : 0) || a.id.localeCompare(b.id);

/**
 * An archive area's tapes grouped by aisle (in the catalog's order), oldest upload first.
 * A game's run of streams (boxsets.js) is on the shelf both ways: as a box set holding
 * its tapes, standing just before its first part (a run that carries on into the next
 * year starts in the year it started), and as single tapes, each where it would be
 * anyway. Take the whole box, or just the one night you want.
 */
function archiveGroups(area) {
  if (!area?.videos?.length) return [];
  const { setOf } = findBoxSets(area.videos);
  const byAisle = new Map(area.aisles.map((a) => [a.id, []]));
  for (const v of area.videos) {
    const set = setOf.get(v.id);
    if (set?.videos[0] === v) byAisle.get(v.aisle)?.push({ boxSet: set, publishedAt: v.publishedAt, id: set.id });
    byAisle.get(v.aisle)?.push(v);
  }
  // (a box can't start in a shelf's last slot: allow for one empty slot per shelf)
  const perBay = SLOTS_PER_BAY - DIM.SHELF_COUNT;
  return area.aisles
    .map((aisle) => ({ aisle, items: byAisle.get(aisle.id).sort(uploadOrder), perBay }))
    .filter((g) => g.items.length)
    .map((g) => ({ ...g, bays: Math.ceil(g.items.reduce((n, it) => n + widthOf(it), 0) / perBay) }));
}

/**
 * Streams' walls and shelving for a room from z = sz0 back to sz1 (the lounge partition).
 * `chain` is every bay in reading order, left to right all the way round: the gondola's
 * east side (you meet it first, coming through the archway), round its far end to the
 * west side, then the west, back and east walls, ending beside the archway.
 */
function streamsShelving(wx0, wx1, sz0, sz1) {
  const WU = DIM.WALL_UNIT;
  const west = wall('streams', 'x', wx0, sz0, sz1, 1);
  const east = wall('streams', 'x', wx1, sz0, sz1, -1);
  const back = wall('streams', 'z', sz0, wx0, wx1, 1);
  const walls = [
    wallShelf(west, sz0 + WU + 0.05, sz1 - 0.1, null),
    wallShelf(back, wx0 + WU + 0.05, wx1 - WU - 0.05, null),
    wallShelf(east, sz0 + WU + 0.05, sz1 - 0.1, null),
  ];
  const x = (wx0 + wx1) / 2;
  const zFront = sz1 - 1.6;
  const bays = Math.max(1, Math.min(6, Math.floor((zFront - 2 * DIM.ENDCAP - (sz0 + WU + 2.1)) / DIM.BAY_W)));
  const zBack = zFront - bays * DIM.BAY_W - 2 * DIM.ENDCAP;
  const [gWest, gEast, front, rear] = gondolaRuns(x, zFront, zBack, null);
  const chain = [gEast, gWest, ...walls];
  for (const f of chain) f.rows = TOP_DOWN;
  return { west, east, back, walls, chain, endcaps: { front, rear }, gondola: { x, zFront, zBack }, bays: chain.reduce((n, f) => n + f.bays, 0) };
}

/**
 * Where can a player (a circle of `radius`) walk to from `from` without going through a
 * collider? A flood fill over a grid; the tests use it to prove every room can be
 * reached and the building has no gaps to the outside. Returns `reaches(p)` and
 * `open(p)` (nothing in the way at p itself).
 */
export function walkFrom(colliders, bounds, from, { radius = DIM.RADIUS, step = 0.1 } = {}) {
  const nx = Math.ceil((bounds.maxX - bounds.minX) / step);
  const nz = Math.ceil((bounds.maxZ - bounds.minZ) / step);
  const cx = (i) => bounds.minX + (i + 0.5) * step;
  const cz = (j) => bounds.minZ + (j + 0.5) * step;
  const blocked = new Uint8Array(nx * nz);
  // the edge of the footprint, then every collider grown by the radius
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    if (cx(i) < bounds.minX + radius || cx(i) > bounds.maxX - radius || cz(j) < bounds.minZ + radius || cz(j) > bounds.maxZ - radius) blocked[i + j * nx] = 1;
  }
  const r2 = radius * radius;
  const clampI = (v, n) => Math.min(n - 1, Math.max(0, v));
  for (const c of colliders) {
    const i0 = clampI(Math.floor((c.minX - radius - bounds.minX) / step), nx);
    const i1 = clampI(Math.ceil((c.maxX + radius - bounds.minX) / step), nx);
    const j0 = clampI(Math.floor((c.minZ - radius - bounds.minZ) / step), nz);
    const j1 = clampI(Math.ceil((c.maxZ + radius - bounds.minZ) / step), nz);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dx = cx(i) - Math.min(Math.max(cx(i), c.minX), c.maxX);
      const dz = cz(j) - Math.min(Math.max(cz(j), c.minZ), c.maxZ);
      if (dx * dx + dz * dz < r2) blocked[i + j * nx] = 1;
    }
  }
  const index = (p) => {
    const i = Math.floor((p.x - bounds.minX) / step);
    const j = Math.floor((p.z - bounds.minZ) / step);
    return i < 0 || j < 0 || i >= nx || j >= nz ? -1 : i + j * nx;
  };
  const seen = new Uint8Array(nx * nz);
  const start = index(from);
  if (start >= 0 && !blocked[start]) {
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const k = stack.pop();
      const i = k % nx;
      for (const nk of [i + 1 < nx ? k + 1 : -1, i > 0 ? k - 1 : -1, k + nx < nx * nz ? k + nx : -1, k - nx]) {
        if (nk < 0 || seen[nk] || blocked[nk]) continue;
        seen[nk] = 1;
        stack.push(nk);
      }
    }
  }
  return {
    reaches: (p) => index(p) >= 0 && seen[index(p)] === 1,
    open: (p) => index(p) >= 0 && !blocked[index(p)],
  };
}

// ------------------------------------------------------------------ transforms

const _t = new THREE.Vector3();
const _n = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _p = new THREE.Vector3();

export function rowTopY(row) {
  return DIM.SHELF_Y0 + row * DIM.SHELF_PITCH;
}

/** Distance along a face to the start of a bay. */
export function bayStart(face, bay) {
  const pad = (face.length - face.bays * face.bayW) / 2;
  return pad + bay * face.bayW;
}

/** World matrix of the tape sitting in a slot (case centre, front = +Z). */
export function slotMatrix(slot, out = new THREE.Matrix4(), jitterSeed = 0) {
  const { face, bay, row, col } = slot;
  _t.set(face.t.x, 0, face.t.z);
  _n.set(face.n.x, 0, face.n.z);
  const along = bayStart(face, bay) + (face.bayW - face.perRow * DIM.SLOT_PITCH) / 2 + (col + 0.5) * DIM.SLOT_PITCH;
  const tilt = DIM.CASE_TILT + (jitterSeed ? ((jitterSeed % 100) / 100 - 0.5) * 0.04 : 0);
  // Y' leans back (away from the viewer), Z' tips up.
  _y.set(0, Math.cos(tilt), 0).addScaledVector(_n, -Math.sin(tilt));
  _z.copy(_n).multiplyScalar(Math.cos(tilt)).add(_p.set(0, Math.sin(tilt), 0));
  _p.set(face.origin.x, rowTopY(row) + 0.012, face.origin.z)
    .addScaledVector(_t, along)
    .addScaledVector(_n, -0.05)
    .addScaledVector(_y, DIM.CASE_H / 2)
    .addScaledVector(_z, -DIM.CASE_D / 2);
  out.makeBasis(_t, _y, _z).setPosition(_p);
  return out;
}

export function slotNormal(slot) {
  return new THREE.Vector3(slot.face.n.x, 0, slot.face.n.z);
}

// Floor plan solver. Sizes the building to fit the catalog, lays out shelving
// runs ("faces"), and decides which tape sits in which slot. Pure data — no three.js
// objects except the Matrix4 helpers at the bottom.
import * as THREE from 'three';
import { DIM, SLOTS_PER_BAY } from './config.js';
import { rng, shuffle, hash } from './util.js';

const MAX_COPIES = 4;
// Fill eye-level shelves first so partly stocked bays look intentional.
const ROW_PRIORITY = [3, 2, 4, 1, 0];
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
  const leftLen = D / 2 - 1.0 - wallStartZ;
  const rightLen = zFront - wallStartZ;
  const backLen = W - 2 * DIM.WALL_UNIT - 0.1;
  const leftBays = Math.floor(leftLen / DIM.BAY_W);
  const rightBays = Math.floor(rightLen / DIM.BAY_W);
  const backBays = Math.floor(backLen / DIM.BAY_W);
  return {
    K, M, W, D, gLen, zFront, zBack, wallStartZ, leftLen, rightLen, backLen, leftBays, rightBays, backBays,
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

/** Spread `slots` slots across `items`, copies adjacent, max `maxCopies` each. */
function withCopies(items, slots, maxCopies) {
  if (!items.length) return [];
  const per = Math.min(maxCopies, Math.max(1, Math.floor(slots / items.length)));
  let extra = Math.min(items.length, Math.max(0, slots - per * items.length));
  if (per >= maxCopies) extra = 0;
  const out = [];
  for (const it of items) {
    const n = per + (extra-- > 0 ? 1 : 0);
    for (let i = 0; i < n && out.length < slots; i++) out.push(it);
  }
  return out;
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

  // Hand out spare bays to genres that would otherwise be thin (≤ MAX_COPIES copies per title).
  let spare = dims.genreBays - need;
  while (spare > 0) {
    let best = null;
    for (const g of genres) {
      const ratio = ((g.bays + 1) * SLOTS_PER_BAY) / g.items.length;
      if (ratio <= MAX_COPIES && (!best || ratio < ((best.bays + 1) * SLOTS_PER_BAY) / best.items.length)) best = g;
    }
    if (!best) break;
    best.bays++;
    spare--;
  }
  // Too big for the biggest store? Trim the oldest tapes from the largest genres.
  let over = need - dims.genreBays;
  while (over > 0) {
    const g = genres.reduce((a, b) => (b.bays > a.bays ? b : a));
    g.bays--;
    over--;
  }

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
    faces.push({ id: faces.length, bayW: DIM.BAY_W, ...f, perRow, bayList: [] });
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

  // Assign bays to sections, snaking through the side faces.
  let fi = 0;
  let bi = 0;
  for (const sec of sections) {
    for (let b = 0; b < sec.bays; b++) {
      while (fi < sideFaces.length && bi >= sideFaces[fi].bays) {
        fi++;
        bi = 0;
      }
      if (fi >= sideFaces.length) break;
      sideFaces[fi].bayList.push({ section: sec, index: bi });
      bi++;
    }
  }

  // Back wall — New Releases.
  const backZ = -D / 2 + DIM.WALL_UNIT;
  const back = addFace({
    kind: 'wall', origin: { x: -dims.backLen / 2, z: backZ }, t: { x: 1, z: 0 }, n: { x: 0, z: 1 },
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
  const slots = [];
  const sectionCursor = new Map();
  for (const face of faces) {
    if (face.rowMajor) {
      const sec = face.bayList[0]?.section;
      if (!sec) continue;
      let k = 0;
      for (const row of ROW_PRIORITY) {
        for (const { index: bay } of face.bayList) {
          for (let col = 0; col < face.perRow; col++) {
            const video = sec.items[k++];
            if (video) slots.push({ video, face, bay, row, col, section: sec });
          }
        }
      }
      continue;
    }
    for (const { section: sec, index: bay } of face.bayList) {
      let k = sectionCursor.get(sec) || 0;
      for (const row of ROW_PRIORITY) {
        for (let col = 0; col < face.perRow; col++) {
          const video = sec.items[k++];
          if (video) slots.push({ video, face, bay, row, col, section: sec });
        }
      }
      sectionCursor.set(sec, k);
    }
  }

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
  box(-W / 2, -W / 2 + DIM.WALL_UNIT, -D / 2, D / 2); // left wall unit
  box(W / 2 - DIM.WALL_UNIT, W / 2, -D / 2, zFront); // right wall unit
  box(-W / 2, W / 2, -D / 2, -D / 2 + DIM.WALL_UNIT); // back wall unit

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

  return {
    W, D, K, M, zFront, zBack, dims,
    faces, slots, sections, newSection, endcapSections, gondolas, aisleSigns, colliders,
    counter, door,
    spawn: { x: doorX, z: D / 2 - 1.3, yaw: 0 },
    bounds: { minX: -W / 2, maxX: W / 2, minZ: -D / 2, maxZ: D / 2 },
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

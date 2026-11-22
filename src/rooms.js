// The rooms off the sales floor, as planned by planAnnex() in layout.js: the hallway,
// the wing with the lounge and Streams, and the Extras back room. Streams' tapes are
// drawn with the rest by TapeShelves; this builds the shelving they sit on. Extras has
// "coming soon" shelving until its own catalog exists (docs/roadmap.md).
//
// Each room batches its own geometry into its own group, so three.js can skip a whole
// room when it's outside the view.
import * as THREE from 'three';
import { DIM, BRAND } from './config.js';
import { FONT } from './fonts.js';
import { neonTexture, panelTexture, cardboardTexture } from './textures.js';
import { rng, shuffle } from './util.js';
import { Batcher, signPlane, batchWall, flatGeometry, buildGondolaShell, buildFace, addPoster } from './fixtures.js';
import { buildLounge } from './lounge.js';
import { visibleRooms } from './layout.js';

const ROOMS = ['hall', 'lounge', 'streams', 'extras'];

export function buildAnnex({ scene, root, mat, plan, catalog, trackArt, animated }) {
  const { W, D, hall, lounge, streams, extras } = plan;
  const H = DIM.OPENING_H;
  const group = {};
  const batch = {};
  for (const id of ROOMS) {
    group[id] = new THREE.Group();
    group[id].name = id;
    root.add(group[id]);
    batch[id] = new Batcher();
  }

  // ---- materials: each room gets its own tint of the store's wall paint and carpet
  const tint = (base, color, extra = {}) => new THREE.MeshStandardMaterial({ map: base.map, color, roughness: base.roughness, ...extra });
  const walls = {
    hall: mat.wall,
    lounge: tint(mat.wall, 0xd2a7b6),
    streams: tint(mat.wall, 0xc4b4ff),
    extras: tint(mat.wall, 0x9fdce4),
  };
  const floors = {
    hall: mat.carpet,
    lounge: tint(mat.carpet, 0xe6a0b2),
    streams: tint(mat.carpet, 0xb4a2ff),
    extras: mat.vct,
  };
  // the lounge's ceiling is painted dark, cinema-style
  const ceilings = { hall: mat.ceiling, lounge: tint(mat.ceiling, 0x3a3246), streams: mat.ceiling, extras: mat.ceiling };
  const cardboard = new THREE.MeshStandardMaterial({ map: cardboardTexture(), roughness: 0.9 });
  cardboard.map.wrapS = cardboard.map.wrapT = THREE.RepeatWrapping;

  // ---- shells: walls, floors, ceilings
  for (const w of plan.walls) if (batch[w.room]) batchWall(batch[w.room], walls[w.room], w);
  for (const id of ROOMS) {
    const r = plan[id];
    const top = id === 'hall' ? H : DIM.CEILING;
    batch[id].add(floors[id], flatGeometry(r.x0, r.x1, r.z0, r.z1, 0, id === 'extras' ? 1 / 0.6 : 0.5));
    batch[id].add(ceilings[id], flatGeometry(r.x0, r.x1, r.z0, r.z1, top, 1 / 0.6, { down: true }));
  }

  // ---- door casings round every opening
  // (an opening in the x = `at` wall spans z from..to; casings stand `out` metres proud
  // on each side, so they also cover the reveal of the lounge / Streams partition)
  const casing = (B, axis, at, from, to, outNeg, outPos) => {
    const c = 0.1;
    const depth = outNeg + outPos;
    const mid = at + (outPos - outNeg) / 2;
    const put = (a0, a1, y0, y1) => {
      const along = (a0 + a1) / 2;
      if (axis === 'x') B.box(mat.trim, mid, (y0 + y1) / 2, along, depth, y1 - y0, a1 - a0);
      else B.box(mat.trim, along, (y0 + y1) / 2, mid, a1 - a0, y1 - y0, depth);
    };
    put(from - c, from, 0, H + c);
    put(to, to + c, 0, H + c);
    put(from - c, to + c, H, H + c);
  };
  const out = 0.04;
  const half = 0.06 + out; // the partition is 0.12 thick
  casing(batch.hall, 'x', -W / 2, hall.z0, hall.z1, 0, out); // sales-floor end
  casing(batch.hall, 'x', hall.x0, hall.z0, hall.z1, out, 0); // lounge end
  casing(batch.lounge, 'z', (lounge.z0 + streams.z1) / 2, lounge.arch.x0, lounge.arch.x1, half, half);
  casing(batch.extras, 'z', -D / 2, extras.door.x0, extras.door.x1, out, out);

  // ---- hallway: a poster on each side
  const pool = shuffle(catalog.videos, rng(4321));
  if (pool.length) {
    const ph = 1.0;
    const pw = ph * (160 / 280);
    const hx = (hall.x0 + hall.x1) / 2;
    addPoster(group.hall, pool[0], catalog, trackArt, hx, 1.35, hall.z0 + 0.01, 0, pw, ph);
    addPoster(group.hall, pool[1 % pool.length], catalog, trackArt, hx, 1.35, hall.z1 - 0.01, Math.PI, pw, ph);
  }

  // ---- signs over the ways in
  const neon = (parent, text, color, h, x, y, z, rotY, opts = {}) => {
    const tex = neonTexture(text, color, { font: FONT.bungee, size: 130, ...opts });
    parent.add(signPlane(tex, h * tex.userData.aspect, h, x, y, z, rotY, { additive: true }));
  };
  const hz = (hall.z0 + hall.z1) / 2;
  neon(group.hall, 'LOUNGE', BRAND.magenta, 0.74, -W / 2 + 0.03, 2.9, hz, Math.PI / 2, { subtitle: 'AND STREAMS', subColor: BRAND.cyan });
  const ax = (lounge.arch.x0 + lounge.arch.x1) / 2;
  const onAir = panelTexture(['ON AIR'], { w: 512, h: 192, bg: '#d0102e', border: '#ffd9de' });
  group.lounge.add(signPlane(onAir, 0.78, 0.29, ax, 2.84, lounge.z0 + 0.052, 0));
  batch.lounge.box(mat.dark, ax, 2.84, lounge.z0 + 0.025, 0.84, 0.35, 0.05);
  const dx = (extras.door.x0 + extras.door.x1) / 2;
  neon(group.extras, 'EXTRAS', BRAND.cyan, 0.56, dx, 2.92, -D / 2 + 0.03, 0);

  // ---- Streams and Extras: shelving, the room's own neon, boxes of stock
  const fitRoom = (id, room, title, color, subtitle, signX) => {
    const B = batch[id];
    for (const g of room.gondolas) buildGondolaShell(B, mat, g);
    for (const f of room.faces) buildFace(group[id], B, mat, f);
    neon(group[id], title, color, 0.72, signX, 2.86, room.z0 + 0.03, 0, { subtitle, subColor: BRAND.yellow });
    for (const b of room.boxes) boxStack(B, cardboard, b);
  };
  // (Streams' sign lines up with the archway, so it shows through it from the lounge)
  fitRoom('streams', streams, 'STREAMS', '#b388ff', streams.stocked ? 'LIVE ARCHIVE' : 'LIVE ARCHIVE · COMING SOON', ax);
  fitRoom('extras', extras, 'EXTRAS', BRAND.cyan, 'COMING SOON', (extras.x0 + extras.x1) / 2);

  // ---- the lounge's furniture, projector and VCR
  const loungeParts = buildLounge({ group: group.lounge, B: batch.lounge, mat, plan, animated, scene });

  // ---- ceiling lights: troffers like the sales floor's (the lounge has its lamp instead)
  const panels = []; // [room, x, ceiling height, z]
  for (const [id, xs] of [['streams', [streams.x0 + 2.0, streams.x1 - 2.0]], ['extras', [(extras.x0 + extras.x1) / 2]]]) {
    const room = plan[id];
    for (let z = room.z1 - 1.6; z > room.z0 + 0.8; z -= 2.4) for (const x of xs) panels.push([id, x, DIM.CEILING, z]);
  }
  panels.push(['hall', (hall.x0 + hall.x1) / 2, H, hz]);
  const troffer = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.6, 0.03, 1.2),
    new THREE.MeshBasicMaterial({ color: 0xfffbf0, toneMapped: false }),
    panels.length,
  );
  const tm = new THREE.Matrix4();
  panels.forEach(([id, x, y, z], i) => {
    troffer.setMatrixAt(i, tm.makeTranslation(x, y - 0.015, z));
    batch[id].box(mat.chrome, x, y - 0.008, z, 0.66, 0.012, 1.26);
  });
  root.add(troffer);

  // A few point lights (each costs per-pixel work everywhere, so as few as will do).
  const light = (color, intensity, x, y, z, distance) => {
    const l = new THREE.PointLight(color, intensity, distance, 1.6);
    l.position.set(x, y, z);
    scene.add(l);
  };
  const sx = (streams.x0 + streams.x1) / 2;
  light(0xeee6ff, 4.2, sx, DIM.CEILING - 0.3, streams.z1 - (streams.z1 - streams.z0) / 3, 10);
  light(0xeee6ff, 4.2, sx, DIM.CEILING - 0.3, streams.z0 + (streams.z1 - streams.z0) / 3, 10);
  light(0xfff4e2, 4.6, (extras.x0 + extras.x1) / 2, DIM.CEILING - 0.3, (extras.z0 + extras.z1) / 2, 9);

  for (const id of ROOMS) batch[id].build(group[id]);
  return { groups: group, lounge: loungeParts };
}

/** A stack of two or three cardboard boxes, slightly askew. */
function boxStack(B, material, { x, z, seed }) {
  const r = rng(seed);
  const m = new THREE.Matrix4();
  let y = 0;
  const n = 2 + Math.floor(r() * 2);
  for (let i = 0; i < n; i++) {
    const w = 0.5 - i * 0.06 + r() * 0.04;
    const d = 0.42 - i * 0.04 + r() * 0.04;
    const h = 0.3 + r() * 0.08;
    m.makeRotationY((r() - 0.5) * 0.5).setPosition(x + (r() - 0.5) * 0.05, 0, z + (r() - 0.5) * 0.05);
    B.boxAt(material, m, 0, y + h / 2, 0, w, h, d, 2);
    y += h;
  }
}

/**
 * Skips drawing the rooms off the sales floor (and the tapes on their shelves) while no
 * doorway to them is in view. From the front door that's the whole wing and Extras; a
 * room's dozens of draw calls only come back once you could actually see into it.
 */
export class RoomCulling {
  constructor(plan, groups, meshes = []) {
    this.plan = plan;
    this.byRoom = new Map();
    const put = (room, o) => {
      if (!room || room === 'main') return;
      if (!this.byRoom.has(room)) this.byRoom.set(room, []);
      this.byRoom.get(room).push(o);
    };
    for (const [room, group] of Object.entries(groups)) put(room, group);
    for (const m of meshes) put(m.userData.room, m);
    this.frustum = new THREE.Frustum();
    this.box = new THREE.Box3();
    this.pv = new THREE.Matrix4();
    this.visible = new Set();
  }

  update(camera) {
    camera.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(this.pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const inView = (p) => {
      this.box.min.set(p.x0, p.y0, p.z0);
      this.box.max.set(p.x1, p.y1, p.z1);
      return this.frustum.intersectsBox(this.box);
    };
    this.visible = visibleRooms(this.plan, camera.position, inView);
    for (const [room, objects] of this.byRoom) for (const o of objects) o.visible = this.visible.has(room);
  }
}

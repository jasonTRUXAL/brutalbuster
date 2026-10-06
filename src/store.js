// Builds the static store: room shell, shelving, signage, checkout, entrance and lights.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DIM, BRAND } from './config.js';
import { bayStart, rowTopY } from './layout.js';
import {
  carpetTexture, vctTexture, ceilingTexture, pegboardTexture, wallTexture, asphaltTexture, nightSkyTexture,
  headerSignTexture, aisleSignTexture, neonTexture, panelTexture, toTexture,
} from './textures.js';
import { coverCanvas, coverData } from './covers.js';
import { FONT } from './fonts.js';
import { makeCanvas, rng, shuffle } from './util.js';
import { CrtScreen } from './crt.js';

// ------------------------------------------------------------- geometry batching

/** Rescale a BoxGeometry's UVs so textures tile at `scale` repeats per metre. */
function scaleBoxUV(g, sx, sy, sz, scale) {
  const uv = g.attributes.uv;
  const dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k;
    uv.setXY(i, uv.getX(i) * dims[f][0] * scale, uv.getY(i) * dims[f][1] * scale);
  }
}

class Batcher {
  constructor() {
    this.lists = new Map();
  }
  add(mat, geo) {
    if (!this.lists.has(mat)) this.lists.set(mat, []);
    this.lists.get(mat).push(geo);
  }
  box(mat, x, y, z, sx, sy, sz, uvScale = 1) {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    scaleBoxUV(g, sx, sy, sz, uvScale);
    g.translate(x, y, z);
    this.add(mat, g);
  }
  /** Box sized along a face's tangent (t), height, and normal (n) axes. */
  aligned(mat, cx, cy, cz, sizeT, sizeY, sizeN, t, uvScale = 1) {
    if (Math.abs(t.x) > 0.5) this.box(mat, cx, cy, cz, sizeT, sizeY, sizeN, uvScale);
    else this.box(mat, cx, cy, cz, sizeN, sizeY, sizeT, uvScale);
  }
  build(parent) {
    for (const [mat, list] of this.lists) {
      const merged = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      const mesh = new THREE.Mesh(merged, mat);
      mesh.matrixAutoUpdate = false;
      parent.add(mesh);
    }
    this.lists.clear();
  }
}

const facingY = (n) => Math.atan2(n.x, n.z);

function signPlane(tex, w, h, x, y, z, rotY, { additive = false, doubleSided = false } = {}) {
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: additive,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: !additive,
    side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    toneMapped: false,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z);
  m.rotation.y = rotY;
  return m;
}

// ------------------------------------------------------------- store

export function buildStore(scene, plan, catalog) {
  const { W, D, faces, gondolas, counter } = plan;
  const root = new THREE.Group();
  root.name = 'store';
  scene.add(root);
  const B = new Batcher();
  const animated = [];
  const extraColliders = [];

  // ---- materials
  const mat = {
    shelf: new THREE.MeshStandardMaterial({ color: 0x1c2458, roughness: 0.55, metalness: 0.25 }),
    lip: new THREE.MeshStandardMaterial({ color: BRAND.yellow, roughness: 0.45, metalness: 0.1 }),
    peg: new THREE.MeshStandardMaterial({ map: pegboardTexture(), roughness: 0.8 }),
    plinth: new THREE.MeshStandardMaterial({ color: 0x0b0e22, roughness: 0.7 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xc4c8d4, roughness: 0.3, metalness: 0.85 }),
    wall: new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 0.9 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x15132e, roughness: 0.6 }),
    counter: new THREE.MeshStandardMaterial({ color: 0x1a2258, roughness: 0.5, metalness: 0.1 }),
    counterTop: new THREE.MeshStandardMaterial({ color: 0xd9d3c3, roughness: 0.35 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1b1b22, roughness: 0.5, metalness: 0.2 }),
    gate: new THREE.MeshStandardMaterial({ color: 0xa9adb8, roughness: 0.35, metalness: 0.6 }),
    frame: new THREE.MeshStandardMaterial({ color: 0x2b2b33, roughness: 0.4, metalness: 0.7 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x8fb6e0, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.14, depthWrite: false }),
  };
  mat.peg.map.wrapS = mat.peg.map.wrapT = THREE.RepeatWrapping;
  mat.wall.map.wrapS = THREE.RepeatWrapping;

  // ---- floor
  const vctDepth = 3.4;
  const carpet = carpetTexture();
  carpet.wrapS = carpet.wrapT = THREE.RepeatWrapping;
  carpet.repeat.set(W / 2, (D - vctDepth) / 2);
  const floorC = new THREE.Mesh(new THREE.PlaneGeometry(W, D - vctDepth), new THREE.MeshStandardMaterial({ map: carpet, roughness: 0.95 }));
  floorC.rotation.x = -Math.PI / 2;
  floorC.position.set(0, 0, -vctDepth / 2);
  root.add(floorC);
  const vct = vctTexture();
  vct.wrapS = vct.wrapT = THREE.RepeatWrapping;
  vct.repeat.set(W / 0.6, vctDepth / 0.6);
  const floorV = new THREE.Mesh(new THREE.PlaneGeometry(W, vctDepth), new THREE.MeshStandardMaterial({ map: vct, roughness: 0.4, metalness: 0.05 }));
  floorV.rotation.x = -Math.PI / 2;
  floorV.position.set(0, 0, D / 2 - vctDepth / 2);
  root.add(floorV);
  B.box(mat.chrome, 0, 0.003, D / 2 - vctDepth, W, 0.006, 0.04); // transition strip

  // ---- ceiling with light troffers
  const ceil = ceilingTexture();
  ceil.wrapS = ceil.wrapT = THREE.RepeatWrapping;
  ceil.repeat.set(W / 0.6, D / 0.6);
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: ceil, roughness: 0.95 }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = DIM.CEILING;
  root.add(ceiling);

  const aisleXs = plan.aisleSigns.map((a) => a.x);
  const lightZs = [];
  for (let z = D / 2 - 1.6; z > -D / 2 + 0.8; z -= 2.4) lightZs.push(z);
  const troffer = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.6, 0.03, 1.2),
    new THREE.MeshBasicMaterial({ color: 0xfffbf0, toneMapped: false }),
    aisleXs.length * lightZs.length,
  );
  let ti = 0;
  const tm = new THREE.Matrix4();
  for (const x of aisleXs) for (const z of lightZs) troffer.setMatrixAt(ti++, tm.makeTranslation(x, DIM.CEILING - 0.015, z));
  root.add(troffer);
  for (const x of aisleXs) for (const z of lightZs) B.box(mat.chrome, x, DIM.CEILING - 0.008, z, 0.66, 0.012, 1.26);

  // ---- walls
  const wallH = DIM.CEILING;
  const wallPlane = (w, x, z, rotY) => {
    const g = new THREE.PlaneGeometry(w, wallH);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * w);
    const m = new THREE.Mesh(g, mat.wall);
    m.position.set(x, wallH / 2, z);
    m.rotation.y = rotY;
    root.add(m);
  };
  wallPlane(W, 0, -D / 2, 0);
  wallPlane(D, -W / 2, 0, Math.PI / 2);
  wallPlane(D, W / 2, 0, -Math.PI / 2);

  buildFrontWall(root, B, mat, plan);

  // ---- shelving
  for (const g of gondolas) buildGondolaShell(B, mat, g);
  for (const face of faces) buildFace(root, B, mat, face);

  // ---- hanging aisle markers
  for (const a of plan.aisleSigns) {
    const tex = aisleSignTexture(a.number, a.labels);
    const y = 2.72;
    root.add(signPlane(tex, 1.5, 0.586, a.x, y, a.z + 0.011, 0));
    root.add(signPlane(tex, 1.5, 0.586, a.x, y, a.z - 0.011, Math.PI));
    B.box(mat.trim, a.x, y, a.z, 1.54, 0.62, 0.02);
    for (const dx of [-0.6, 0.6]) B.box(mat.chrome, a.x + dx, (y + 0.31 + DIM.CEILING) / 2, a.z, 0.012, DIM.CEILING - y - 0.31, 0.012);
  }

  // ---- neon: New Releases over the back wall
  const nr = neonTexture('NEW RELEASES', BRAND.yellow, { font: FONT.bungee, size: 150 });
  const nrH = 0.62;
  root.add(signPlane(nr, nrH * nr.userData.aspect, nrH, 0, 2.86, -D / 2 + 0.03, 0, { additive: true }));

  // ---- checkout counter, entrance, decor
  buildCounter(root, B, mat, plan, catalog, animated);
  buildEntrance(root, B, mat, plan, catalog, extraColliders);
  buildPosters(root, plan, catalog);

  B.build(root);

  // ---- lighting
  scene.add(new THREE.HemisphereLight(0xfff1dc, 0x232046, 1.25));
  const lightPositions = [];
  // a modest grid of fill lights (every point light costs per-pixel work everywhere)
  const cols = Math.min(4, Math.max(2, Math.round(W / 6)));
  const rows = Math.min(Math.floor(8 / cols), Math.max(2, Math.round(D / 6)));
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    lightPositions.push([-W / 2 + (W * (i + 0.5)) / cols, DIM.CEILING - 0.3, -D / 2 + (D * (j + 0.5)) / rows]);
  }
  for (const [x, y, z] of lightPositions) {
    const l = new THREE.PointLight(0xfff4e2, 5.5, 0, 1.6);
    l.position.set(x, y, z);
    scene.add(l);
  }
  // warm wash from the neon / counter area
  const warm = new THREE.PointLight(0xff4fa3, 2.2, 7, 1.8);
  warm.position.set(W / 2 - 0.8, 2.6, (counter.zMin + counter.zMax) / 2);
  scene.add(warm);

  return {
    root,
    colliders: [...plan.colliders, ...extraColliders],
    update(dt, t) {
      for (const a of animated) a.update(dt, t);
    },
  };
}

// ------------------------------------------------------------- shelving

function buildGondolaShell(B, mat, g) {
  const len = g.zFront - g.zBack;
  const cz = (g.zFront + g.zBack) / 2;
  const plinthH = DIM.SHELF_Y0 - 0.02;
  B.box(mat.plinth, g.x, plinthH / 2, cz, DIM.G_DEPTH - 0.03, plinthH, len - 0.03);
  const coreLen = len - 2 * DIM.ENDCAP;
  const spineH = DIM.UNIT_H - plinthH;
  B.box(mat.peg, g.x, plinthH + spineH / 2, cz, 0.04, spineH, coreLen, 1 / 0.3);
  // endcap backs
  for (const z of [g.zFront - DIM.ENDCAP, g.zBack + DIM.ENDCAP]) B.box(mat.peg, g.x, plinthH + spineH / 2, z, DIM.G_DEPTH, spineH, 0.03, 1 / 0.3);
  // chrome corner posts
  for (const sx of [-1, 1]) for (const z of [g.zFront, g.zBack]) {
    B.box(mat.chrome, g.x + sx * (DIM.G_DEPTH / 2 - 0.012), DIM.UNIT_H / 2, z - Math.sign(z - cz) * 0.012, 0.024, DIM.UNIT_H, 0.024);
  }
}

function buildFace(root, B, mat, face) {
  const t = face.t;
  const n = face.n;
  const ox = face.origin.x;
  const oz = face.origin.z;
  const L = face.length;
  const at = (along, back) => [ox + t.x * along - n.x * back, oz + t.z * along - n.z * back];
  const plinthH = DIM.SHELF_Y0 - 0.02;
  const isWall = face.kind === 'wall';

  if (isWall) {
    const [px, pz] = at(L / 2, DIM.WALL_UNIT / 2);
    B.aligned(mat.plinth, px, plinthH / 2, pz, L, plinthH, DIM.WALL_UNIT - 0.02, t);
    const [bx, bz] = at(L / 2, DIM.WALL_UNIT - 0.012);
    const h = DIM.UNIT_H - plinthH;
    B.aligned(mat.peg, bx, plinthH + h / 2, bz, L, h, 0.02, t, 1 / 0.3);
  }

  // shelves + price channel lips
  const [sx, sz] = at(L / 2, DIM.SHELF_DEPTH / 2);
  const [lx, lz] = at(L / 2, 0.008);
  for (let row = 0; row < DIM.SHELF_COUNT; row++) {
    const y = rowTopY(row);
    B.aligned(mat.shelf, sx, y - 0.01, sz, L, 0.02, DIM.SHELF_DEPTH, t);
    B.aligned(mat.lip, lx, y + 0.014, lz, L, 0.045, 0.016, t);
  }
  // top cap
  B.aligned(mat.shelf, sx, DIM.UNIT_H - 0.015, sz, L, 0.03, DIM.SHELF_DEPTH, t);

  // uprights at every bay boundary
  const edges = new Set([0, L]);
  for (let b = 0; b <= face.bays; b++) edges.add(Math.min(L, Math.max(0, bayStart(face, b))));
  for (const e of edges) {
    const along = Math.min(L - 0.0125, Math.max(0.0125, e));
    const [ux, uz] = at(along, DIM.SHELF_DEPTH / 2);
    const h = DIM.UNIT_H - plinthH;
    B.aligned(mat.shelf, ux, plinthH + h / 2, uz, 0.025, h, DIM.SHELF_DEPTH, t);
  }

  // header signs — one per run of consecutive bays holding the same section
  const runs = [];
  for (const entry of face.bayList) {
    const last = runs[runs.length - 1];
    if (last && last.section === entry.section && last.end === entry.index) last.end++;
    else runs.push({ section: entry.section, start: entry.index, end: entry.index + 1 });
  }
  const signBack = face.kind === 'endcap' ? 0.06 : DIM.SHELF_DEPTH - 0.02;
  for (const r of runs) {
    const a0 = r.start === 0 && face.bays === 1 ? 0 : bayStart(face, r.start);
    const a1 = r.end === face.bays && face.bays === 1 ? L : bayStart(face, r.end);
    const segLen = a1 - a0 - 0.04;
    const mid = (a0 + a1) / 2;
    const y = DIM.UNIT_H + DIM.SIGN_H / 2 + 0.02;
    const [cx, cz] = at(mid, signBack + 0.02);
    B.aligned(mat.trim, cx, y, cz, segLen + 0.03, DIM.SIGN_H + 0.03, 0.04, t);
    const [fx, fz] = at(mid, signBack - 0.001);
    const tex = headerSignTexture(r.section.label, r.section.color, segLen, DIM.SIGN_H);
    root.add(signPlane(tex, segLen, DIM.SIGN_H, fx, y, fz, facingY(n)));
  }
}

// ------------------------------------------------------------- front wall + outside

function buildFrontWall(root, B, mat, plan) {
  const { W, D, door } = plan;
  const z = D / 2;
  const sill = 0.5;
  const head = 2.62;
  const H = DIM.CEILING;
  const dx0 = door.x - door.width / 2;
  const dx1 = door.x + door.width / 2;

  // solid parts (interior face = wall material)
  B.box(mat.trim, (-W / 2 + dx0) / 2, sill / 2, z + 0.08, dx0 + W / 2, sill, 0.16);
  B.box(mat.trim, (dx1 + W / 2) / 2, sill / 2, z + 0.08, W / 2 - dx1, sill, 0.16);
  B.box(mat.trim, 0, (head + H) / 2, z + 0.08, W, H - head, 0.16);
  B.box(mat.frame, 0, head - 0.03, z + 0.02, W, 0.06, 0.08);

  // window glass + mullions
  const glass = (x0, x1, y0, y1) => {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, y1 - y0), mat.glass);
    g.position.set((x0 + x1) / 2, (y0 + y1) / 2, z + 0.04);
    g.rotation.y = Math.PI;
    g.renderOrder = 2;
    root.add(g);
  };
  const mullion = (x, y0, y1) => B.box(mat.frame, x, (y0 + y1) / 2, z + 0.04, 0.07, y1 - y0, 0.09);
  const pane = (x0, x1) => {
    const n = Math.max(1, Math.round((x1 - x0) / 1.8));
    for (let i = 0; i < n; i++) glass(x0 + ((x1 - x0) * i) / n, x0 + ((x1 - x0) * (i + 1)) / n, sill, head - 0.06);
    for (let i = 0; i <= n; i++) mullion(x0 + ((x1 - x0) * i) / n, sill, head);
  };
  pane(-W / 2, dx0);
  pane(dx1, W / 2);
  B.box(mat.frame, 0, sill, z + 0.04, W, 0.05, 0.1);

  // door: frame, transom, two glass leaves with push bars
  const dh = door.height;
  glass(dx0, dx1, dh, head - 0.06);
  B.box(mat.frame, door.x, dh, z + 0.04, door.width, 0.07, 0.1);
  for (const x of [dx0, door.x, dx1]) B.box(mat.frame, x, dh / 2, z + 0.04, 0.07, dh, 0.1);
  for (const [a, b] of [[dx0, door.x], [door.x, dx1]]) {
    glass(a + 0.035, b - 0.035, 0.0, dh - 0.035);
    B.box(mat.chrome, (a + b) / 2, 1.05, z - 0.03, b - a - 0.25, 0.04, 0.04);
  }
  // doormat
  const matTex = toTexture(doormatCanvas());
  const mt = new THREE.Mesh(new THREE.PlaneGeometry(door.width - 0.1, 1.2), new THREE.MeshStandardMaterial({ map: matTex, roughness: 1 }));
  mt.rotation.x = -Math.PI / 2;
  mt.position.set(door.x, 0.004, z - 0.7);
  root.add(mt);

  // outside: parking lot + skyline backdrop
  const asphalt = asphaltTexture();
  asphalt.wrapS = asphalt.wrapT = THREE.RepeatWrapping;
  asphalt.repeat.set(40, 12);
  const lot = new THREE.Mesh(new THREE.PlaneGeometry(120, 34), new THREE.MeshStandardMaterial({ map: asphalt, roughness: 1, color: 0x8888aa }));
  lot.rotation.x = -Math.PI / 2;
  lot.position.set(0, -0.01, z + 17.2);
  root.add(lot);
  const curb = new THREE.Mesh(new THREE.PlaneGeometry(W + 6, 2.2), new THREE.MeshStandardMaterial({ color: 0x55565f, roughness: 1 }));
  curb.rotation.x = -Math.PI / 2;
  curb.position.set(0, 0.0, z + 1.2);
  root.add(curb);
  for (let i = -8; i <= 8; i++) B.box(mat.counterTop, i * 2.8, 0.002, z + 6.5, 0.1, 0.004, 4.5);
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(140, 46), new THREE.MeshBasicMaterial({ map: nightSkyTexture(), fog: false }));
  sky.position.set(0, 14, z + 34);
  sky.rotation.y = Math.PI;
  root.add(sky);
  // street lamps
  for (const x of [-10, 10]) {
    B.box(mat.frame, x, 3, z + 9, 0.14, 6, 0.14);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffd28a, toneMapped: false }));
    glow.position.set(x, 6, z + 9);
    root.add(glow);
  }
}

function doormatCanvas() {
  const c = makeCanvas(512, 320);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#121a3d';
  ctx.fillRect(0, 0, 512, 320);
  ctx.strokeStyle = BRAND.yellow;
  ctx.lineWidth = 12;
  ctx.strokeRect(14, 14, 484, 292);
  ctx.fillStyle = BRAND.yellow;
  ctx.font = `120px ${FONT.bebas}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('WELCOME', 256, 165);
  return c;
}

// ------------------------------------------------------------- checkout counter

function buildCounter(root, B, mat, plan, catalog, animated) {
  const { W, counter } = plan;
  const { store } = catalog;
  const len = counter.zMax - counter.zMin;
  const cz = (counter.zMin + counter.zMax) / 2;
  const front = counter.x - counter.depth / 2;

  B.box(mat.counter, counter.x, 0.5, cz, counter.depth, 1.0, len);
  B.box(mat.counterTop, counter.x - 0.03, 1.02, cz, counter.depth + 0.1, 0.04, len + 0.06);
  B.box(mat.lip, front - 0.001, 0.12, cz, 0.01, 0.06, len);
  // return leg to the wall at the back end
  B.box(mat.counter, (counter.x + W / 2) / 2, 0.5, counter.zMin + 0.3, W / 2 - counter.x, 1.0, 0.6);
  B.box(mat.counterTop, (counter.x + W / 2) / 2, 1.02, counter.zMin + 0.3, W / 2 - counter.x, 0.04, 0.66);

  // front panel signage
  // (kept clear of the candy rack at the far end)
  const panel = panelTexture(['RENTALS  ·  RETURNS', 'PAY HERE'], { w: 1024, h: 256, bg: BRAND.navy });
  const panelW = Math.min(2.4, len - 1.3);
  const panelZ = Math.min(cz, (counter.zMin + 0.15 + counter.zMax - 1.15) / 2);
  root.add(signPlane(panel, panelW, panelW / 4, front - 0.006, 0.58, panelZ, -Math.PI / 2));

  // register
  const rz = counter.zMin + 0.9;
  B.box(mat.dark, counter.x, 1.12, rz, 0.4, 0.16, 0.44);
  B.box(mat.dark, counter.x + 0.08, 1.33, rz, 0.06, 0.26, 0.36);
  const scr = makeCanvas(256, 192);
  const sctx = scr.getContext('2d');
  sctx.fillStyle = '#031a07';
  sctx.fillRect(0, 0, 256, 192);
  sctx.fillStyle = '#39ff6a';
  sctx.font = `34px ${FONT.vt}`;
  ['MEMBER #____', 'RENTAL: 2 NIGHTS', 'TOTAL  $ 0.00', '> READY_'].forEach((l, i) => sctx.fillText(l, 14, 40 + i * 40));
  const screen = signPlane(toTexture(scr), 0.3, 0.22, counter.x + 0.045, 1.35, rz, -Math.PI / 2);
  root.add(screen);

  // candy rack at the counter front
  const candy = makeCanvas(256, 256);
  const cctx = candy.getContext('2d');
  const r = rng(5);
  cctx.fillStyle = '#222';
  cctx.fillRect(0, 0, 256, 256);
  for (let row = 0; row < 4; row++) for (let i = 0; i < 6; i++) {
    cctx.fillStyle = ['#ff3b3b', '#ffc61a', '#3d7bff', '#3ddc84', '#ff4fa3', '#ff7a00'][Math.floor(r() * 6)];
    cctx.fillRect(6 + i * 41, 8 + row * 62, 36, 50);
    cctx.fillStyle = 'rgba(255,255,255,.7)';
    cctx.fillRect(10 + i * 41, 18 + row * 62, 28, 6);
  }
  const candyZ = counter.zMax - 0.7;
  B.box(mat.chrome, front - 0.2, 0.45, candyZ, 0.36, 0.9, 0.7);
  root.add(signPlane(toTexture(candy), 0.68, 0.84, front - 0.381, 0.47, candyZ, -Math.PI / 2));

  // overhead CRT, facing the sales floor
  const crt = new CrtScreen(catalog);
  animated.push(crt);
  const tvX = front + 0.1;
  const tvZ = cz;
  B.box(mat.dark, tvX + 0.2, 2.5, tvZ, 0.5, 0.48, 0.62);
  B.box(mat.chrome, tvX + 0.2, (2.74 + DIM.CEILING) / 2, tvZ, 0.04, DIM.CEILING - 2.74, 0.04);
  const tv = signPlane(crt.texture, 0.5, 0.375, tvX - 0.052, 2.5, tvZ, -Math.PI / 2);
  root.add(tv);

  // neon store logo on the wall behind the counter
  const logo = neonTexture(store.name, BRAND.cyan, { font: FONT.monoton, size: 170, subtitle: store.subtitle, subColor: BRAND.magenta });
  const lh = 1.05;
  const lw = Math.min(len + 1.4, lh * logo.userData.aspect);
  root.add(signPlane(logo, lw, lw / logo.userData.aspect, W / 2 - 0.03, 2.55, cz, -Math.PI / 2, { additive: true }));
}

// ------------------------------------------------------------- entrance decor

function buildEntrance(root, B, mat, plan, catalog, colliders) {
  const { W, D, door } = plan;
  const z = D / 2;

  // security gates
  for (const dx of [-door.width / 2 - 0.15, door.width / 2 + 0.15]) {
    const x = door.x + dx;
    B.box(mat.gate, x, 0.78, z - 0.75, 0.07, 1.56, 0.5);
    B.box(mat.plinth, x, 0.02, z - 0.75, 0.14, 0.04, 0.56);
    colliders.push({ minX: x - 0.08, maxX: x + 0.08, minZ: z - 1.02, maxZ: z - 0.48 });
  }
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.075, 1.3, 0.02), new THREE.MeshBasicMaterial({ color: 0x29e7ff, toneMapped: false }));
  for (const dx of [-door.width / 2 - 0.15, door.width / 2 + 0.15]) {
    const l = led.clone();
    l.position.set(door.x + dx, 0.85, z - 0.75);
    root.add(l);
  }

  // return drop box
  const rx = door.x - door.width / 2 - 1.0;
  B.box(mat.counter, rx, 0.55, z - 0.45, 0.6, 1.1, 0.5);
  B.box(mat.dark, rx, 0.95, z - 0.705, 0.42, 0.06, 0.01);
  root.add(signPlane(panelTexture(['RETURNS'], { w: 512, h: 192 }), 0.52, 0.2, rx, 0.7, z - 0.701, Math.PI));
  colliders.push({ minX: rx - 0.32, maxX: rx + 0.32, minZ: z - 0.72, maxZ: z });

  // neon OPEN sign hanging in the window (readable from inside: we face it toward -z)
  const open = neonTexture('OPEN', '#ff2d4a', { font: FONT.righteous, size: 170, padding: 50 });
  const oh = 0.42;
  const ox = door.x + door.width / 2 + 1.3;
  root.add(signPlane(open, oh * open.userData.aspect, oh, Math.min(ox, W / 2 - 1), 1.9, z - 0.02, Math.PI, { additive: true }));

  // cardboard standee for a featured tape
  const pick = catalog.videos[Math.floor(rng(catalog.videos.length * 7)() * catalog.videos.length)];
  if (pick) {
    const d = coverData(pick, catalog.aisleById.get(pick.aisle), catalog.store);
    const tex = toTexture(coverCanvas(d, 384));
    const sx = -W / 2 + DIM.WALL_UNIT + 1.0;
    const szz = plan.zFront + 1.3;
    const stand = new THREE.Group();
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 1.49), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }));
    face.position.y = 0.2 + 0.745;
    stand.add(face);
    const backing = new THREE.Mesh(new THREE.BoxGeometry(0.87, 1.51, 0.01), new THREE.MeshStandardMaterial({ color: 0x8a7a5e, roughness: 1 }));
    backing.position.set(0, 0.945, -0.007);
    stand.add(backing);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.2, 0.3), mat.counter);
    base.position.set(0, 0.1, 0);
    stand.add(base);
    const flag = signPlane(panelTexture(['COMING SOON'], { w: 512, h: 128, bg: BRAND.magenta, border: '#fff' }), 0.85, 0.2, 0, 0.1, 0.152, 0);
    stand.add(flag);
    stand.position.set(sx, 0, szz);
    stand.rotation.y = 0.55;
    stand.userData.videoId = pick.id;
    root.add(stand);
    colliders.push({ minX: sx - 0.45, maxX: sx + 0.45, minZ: szz - 0.35, maxZ: szz + 0.35 });
    stand.updateMatrixWorld();
  }
}

// ------------------------------------------------------------- posters

function buildPosters(root, plan, catalog) {
  const { W, D, zFront, door } = plan;
  const pool = shuffle(catalog.videos, rng(1234));
  if (!pool.length) return;
  let k = 0;
  const next = () => pool[k++ % pool.length];
  const ph = 0.82;
  const pw = ph * (160 / 280);
  const poster = (x, y, z, rotY, w = pw, h = ph) => {
    const v = next();
    const d = coverData(v, catalog.aisleById.get(v.aisle), catalog.store);
    const tex = toTexture(coverCanvas(d, 256));
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    m.userData.videoId = v.id;
    root.add(m);
    const frame = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.05, h + 0.05), new THREE.MeshStandardMaterial({ color: 0x0c0c12 }));
    frame.position.set(x, y, z);
    frame.rotation.y = rotY;
    frame.translateZ(-0.004);
    root.add(frame);
  };
  const y = 2.88;
  for (let z = -D / 2 + 1.5; z < D / 2 - 1.2; z += 2.2) poster(-W / 2 + 0.01, y, z, Math.PI / 2);
  for (let z = -D / 2 + 1.5; z < zFront - 0.3; z += 2.2) poster(W / 2 - 0.01, y, z, -Math.PI / 2);
  // window posters, facing in
  const wy = 1.55;
  const big = 1.2;
  for (const x of [-W / 2 + 1.2, door.x - door.width / 2 - 1.0]) {
    if (x > -W / 2 + 0.6) poster(x, wy, D / 2 - 0.03, Math.PI, big * (160 / 280), big);
  }
}

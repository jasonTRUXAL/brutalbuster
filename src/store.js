// Builds the static store: room shell, shelving, signage, checkout, entrance and lights.
// The rooms off the sales floor (hallway, lounge, Streams, Extras) come from rooms.js, and
// the view out of the front window (parking lot, street, traffic) from outside.js.
import * as THREE from 'three';
import { DIM, BRAND } from './config.js';
import {
  carpetTexture, vctTexture, ceilingTexture, pegboardTexture, wallTexture,
  aisleSignTexture, neonTexture, panelTexture, toTexture, neonSignTexture,
} from './textures.js';
import { coverCanvas, coverData } from './covers.js';
import { FONT } from './fonts.js';
import { makeCanvas, rng, shuffle } from './util.js';
import { CrtScreen } from './crt.js';
import { buildPrizeCorner } from './prizes.js';
import { Batcher, tiledPlane, signPlane, batchWall, flatGeometry, buildGondolaShell, buildFace, addPoster } from './fixtures.js';
import { buildAnnex } from './rooms.js';
import { buildSeason } from './seasons.js';
import { buildOutside } from './outside.js';

// ------------------------------------------------------------- store

/**
 * `season` ('halloween' | 'winter' | 'valentine' | null) puts up decorations; `phase`
 * ('dawn' | 'day' | 'dusk' | 'night') is the sky outside, changed later with setPhase().
 */
export function buildStore(scene, plan, catalog, { season = null, phase = 'night' } = {}) {
  const { W, D, faces, gondolas, counter } = plan;
  const root = new THREE.Group();
  root.name = 'store';
  scene.add(root);
  const B = new Batcher();
  const animated = [];
  const extraColliders = [];
  // Posters, the standee and the lounge screen show box art too; they're painted before
  // thumbnails finish loading, so remember them and repaint when a tape's thumbnail arrives.
  const art = new Map(); // video id -> [{ material, width }]
  const trackArt = (videoId, material, width) => {
    if (!art.has(videoId)) art.set(videoId, []);
    art.get(videoId).push({ material, width });
  };

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

  // ---- floor and ceiling. The textures are shared with the rooms off the sales floor,
  // so the geometry carries world-metre UVs instead of each texture repeating its own way.
  const tex = { carpet: carpetTexture(), vct: vctTexture(), ceiling: ceilingTexture() };
  for (const t of Object.values(tex)) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  mat.carpet = new THREE.MeshStandardMaterial({ map: tex.carpet, roughness: 0.95 });
  mat.vct = new THREE.MeshStandardMaterial({ map: tex.vct, roughness: 0.4, metalness: 0.05 });
  mat.ceiling = new THREE.MeshStandardMaterial({ map: tex.ceiling, roughness: 0.95 });
  const vctDepth = 3.4;
  B.add(mat.carpet, flatGeometry(-W / 2, W / 2, -D / 2, D / 2 - vctDepth, 0, 0.5)); // one carpet tile = 2m
  B.add(mat.vct, flatGeometry(-W / 2, W / 2, D / 2 - vctDepth, D / 2, 0, 1 / 0.6));
  B.box(mat.chrome, 0, 0.003, D / 2 - vctDepth, W, 0.006, 0.04); // transition strip

  // ---- ceiling with light troffers
  B.add(mat.ceiling, flatGeometry(-W / 2, W / 2, -D / 2, D / 2, DIM.CEILING, 1 / 0.6, { down: true }));

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

  // ---- walls, with the openings to the hallway and the Extras room
  for (const w of plan.walls) if (w.room === 'main') batchWall(B, mat.wall, w);

  buildFrontWall(root, B, mat, plan);
  const outside = buildOutside(root, plan);
  animated.push(outside); // (the traffic)

  // ---- shelving
  for (const g of gondolas) buildGondolaShell(B, mat, g);
  for (const face of faces) buildFace(root, B, mat, face);

  // ---- hanging aisle markers
  for (const a of plan.aisleSigns) {
    const tex = aisleSignTexture(a.number, a.labels);
    const y = 2.72;
    root.add(signPlane(tex, 1.5, 0.586, a.x, y, a.z + 0.013, 0));
    root.add(signPlane(tex, 1.5, 0.586, a.x, y, a.z - 0.013, Math.PI));
    B.box(mat.trim, a.x, y, a.z, 1.54, 0.62, 0.02);
    for (const dx of [-0.6, 0.6]) B.box(mat.chrome, a.x + dx, (y + 0.31 + DIM.CEILING) / 2, a.z, 0.012, DIM.CEILING - y - 0.31, 0.012);
  }

  // ---- neon: New Releases over the back wall (centred on its shelving, which stops at the Extras door)
  const nr = neonTexture('NEW RELEASES', BRAND.yellow, { font: FONT.bungee, size: 150 });
  const nrH = 0.62;
  const nrX = plan.dims.backStartX + plan.dims.backLen / 2;
  root.add(signPlane(nr, nrH * nr.userData.aspect, nrH, nrX, 2.86, -D / 2 + 0.03, 0, { additive: true }));

  // ---- checkout counter, entrance, decor
  const register = buildCounter(root, B, mat, plan, catalog, animated);
  const dropBox = buildEntrance(root, B, mat, plan, catalog, extraColliders, trackArt, animated);
  const decorations = buildSeason({ root, plan, season, colliders: extraColliders, dropBox });
  if (decorations) animated.push(decorations);
  outside.setPhase(phase);
  const prizes = buildPrizeCorner({ root, B, mat, plan, colliders: extraColliders, animated });
  buildPosters(root, plan, catalog, trackArt);
  // (the annex's furniture footprints are in plan.colliders already: see planAnnex)
  const annex = buildAnnex({ scene, root, mat, plan, catalog, trackArt, animated });

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
    prizes,
    annex,
    register, // { x, z, front, show(lines) }: the checkout's register and its screen
    dropBox, // { x, z }: the returns box by the door (its slot faces into the store)
    season,
    get phase() {
      return outside.phase;
    },
    /** The sky outside the window: 'dawn' | 'day' | 'dusk' | 'night'. */
    setPhase: (p) => outside.setPhase(p),
    update(dt, t) {
      for (const a of animated) a.update(dt, t);
    },
    /** Repaint posters / standee for a tape whose thumbnail just loaded. */
    refreshArt(video) {
      for (const { material, width } of art.get(video.id) || []) {
        const old = material.map;
        material.map = toTexture(coverCanvas(coverData(video, catalog.aisleById.get(video.aisle), catalog.store), width));
        old?.dispose();
      }
    },
  };
}

// ------------------------------------------------------------- front wall

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
  const mt = new THREE.Mesh(tiledPlane(door.width - 0.1, 1.2), new THREE.MeshStandardMaterial({ map: matTex, roughness: 1 }));
  mt.material.userData.decal = true;
  mt.rotation.x = -Math.PI / 2;
  mt.position.set(door.x, 0.004, z - 0.7);
  root.add(mt);
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
  const scrTex = toTexture(scr);
  const showOnRegister = (lines) => {
    sctx.fillStyle = '#031a07';
    sctx.fillRect(0, 0, 256, 192);
    sctx.fillStyle = '#39ff6a';
    sctx.font = `34px ${FONT.vt}`;
    lines.slice(0, 4).forEach((l, i) => sctx.fillText(String(l).slice(0, 15), 14, 40 + i * 40));
    scrTex.needsUpdate = true;
  };
  showOnRegister(['MEMBER #____', 'RENTAL: 2 NIGHTS', 'TOTAL  $ 0.00', '> READY_']);
  const screen = signPlane(scrTex, 0.3, 0.22, counter.x + 0.045, 1.35, rz, -Math.PI / 2);
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
  tv.material.userData.thumbnail = true; // it plays thumbnails: sharp in PS1 Mode
  root.add(tv);

  // neon store logo on the wall behind the counter
  const logo = neonTexture(store.name, BRAND.cyan, { font: FONT.monoton, size: 170, subtitle: store.subtitle, subColor: BRAND.magenta });
  const lh = 1.05;
  const lw = Math.min(len + 1.4, lh * logo.userData.aspect);
  root.add(signPlane(logo, lw, lw / logo.userData.aspect, W / 2 - 0.03, 2.55, cz, -Math.PI / 2, { additive: true }));
  return { x: counter.x, z: rz, front, show: showOnRegister };
}

// ------------------------------------------------------------- entrance decor

function buildEntrance(root, B, mat, plan, catalog, colliders, trackArt, animated) {
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
  const dropBox = { x: rx, z: z - 0.705 };

  // A neon OPEN 24 HOURS sign hanging in the window. It faces the street, so from inside
  // it reads back to front. It hums (a slight waver in its brightness), and every few
  // seconds the 24 HOURS tube sputters, the way an old one does.
  const lines = ['OPEN', '24 HOURS'];
  const lit = neonSignTexture(lines, { mirror: true });
  const sputter = neonSignTexture(lines, { mirror: true, lit: { bottom: false } });
  const oh = 0.46;
  const ow = oh * 2.4;
  const ox = Math.min(door.x + door.width / 2 + 1.3, W / 2 - 1);
  const openSign = signPlane(lit, ow, oh, ox, 1.95, z - 0.02, Math.PI, { additive: true });
  root.add(openSign);
  for (const dx of [-ow * 0.4, ow * 0.4]) B.box(mat.chrome, ox + dx, (1.95 + oh / 2 + 2.6) / 2, z - 0.02, 0.004, 2.6 - 1.95 - oh / 2, 0.004);
  const OFF = [[6.0, 6.07], [6.16, 6.21], [6.3, 6.36], [6.5, 6.53]]; // (seconds into each 9 s)
  animated.push({
    update(dt, t) {
      const s = t % 9;
      const map = OFF.some(([a, b]) => s >= a && s < b) ? sputter : lit;
      if (openSign.material.map !== map) openSign.material.map = map;
      openSign.material.color.setScalar(0.93 + 0.05 * Math.sin(t * 7.3) + 0.02 * Math.sin(t * 31));
    },
  });

  // cardboard standee promoting the newest upload
  const pick = catalog.videos.reduce((a, b) => (String(b.publishedAt) > String(a.publishedAt) ? b : a), catalog.videos[0]);
  if (pick) {
    const d = coverData(pick, catalog.aisleById.get(pick.aisle), catalog.store);
    const tex = toTexture(coverCanvas(d, 384));
    const sx = -W / 2 + DIM.WALL_UNIT + 1.0;
    const szz = plan.zFront + 1.3;
    const stand = new THREE.Group();
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 1.49), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }));
    trackArt(pick.id, face.material, 384);
    face.material.userData.thumbnail = true; // sharp in PS1 Mode
    face.position.y = 0.2 + 0.745;
    stand.add(face);
    const backing = new THREE.Mesh(new THREE.BoxGeometry(0.87, 1.51, 0.01), new THREE.MeshStandardMaterial({ color: 0x8a7a5e, roughness: 1 }));
    backing.position.set(0, 0.945, -0.007);
    stand.add(backing);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.2, 0.3), mat.counter);
    base.position.set(0, 0.1, 0);
    stand.add(base);
    const flag = signPlane(panelTexture(['NEWEST RELEASE'], { w: 512, h: 128, bg: BRAND.magenta, border: '#fff' }), 0.85, 0.2, 0, 0.1, 0.153, 0);
    stand.add(flag);
    stand.position.set(sx, 0, szz);
    stand.rotation.y = 0.55;
    stand.userData.videoId = pick.id;
    root.add(stand);
    colliders.push({ minX: sx - 0.45, maxX: sx + 0.45, minZ: szz - 0.35, maxZ: szz + 0.35 });
    stand.updateMatrixWorld();
  }
  return dropBox;
}

// ------------------------------------------------------------- posters

function buildPosters(root, plan, catalog, trackArt) {
  const { W, D, zFront, door, dims } = plan;
  const pool = shuffle(catalog.videos, rng(1234));
  if (!pool.length) return;
  let k = 0;
  const next = () => pool[k++ % pool.length];
  const ph = 0.82;
  const pw = ph * (160 / 280);
  const poster = (x, y, z, rotY, w = pw, h = ph) => addPoster(root, next(), catalog, trackArt, x, y, z, rotY, w, h);
  const y = 2.88;
  // (the left wall skips the hallway, which has its neon sign over it)
  const clearOfHall = (z) => z < dims.hall.z0 - 0.4 || z > dims.hall.z1 + 0.4;
  for (let z = -D / 2 + 1.5; z < D / 2 - 1.2; z += 2.2) if (clearOfHall(z)) poster(-W / 2 + 0.01, y, z, Math.PI / 2);
  for (let z = -D / 2 + 1.5; z < zFront - 0.3; z += 2.2) poster(W / 2 - 0.01, y, z, -Math.PI / 2);
  // window poster beside the door, facing in (the left-hand window is behind the Lucky Hit stall)
  const big = 1.2;
  poster(door.x - door.width / 2 - 1.0, 1.55, D / 2 - 0.03, Math.PI, big * (160 / 280), big);
}

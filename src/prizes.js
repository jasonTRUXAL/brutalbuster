// The prize corner by the entrance: a row of capsule-toy (gacha) machines along the
// front window and a Lucky Hit drop board (the street stall from Shenmue) in the
// front-left corner.
// Playing them and the always-win prize draw come later (docs/roadmap.md), so the
// moving parts (cranks, ball tray, lights) are kept as separate objects to animate.
import * as THREE from 'three';
import { DIM, BRAND } from './config.js';
import { FONT } from './fonts.js';
import { makeCanvas, rng, shade } from './util.js';
import { toTexture, neonTexture } from './textures.js';
import { LUCKY, boardForDay, dayNumber } from './luckyhit-physics.js';

// One card theme per machine. They line up with the channel's series, so later each
// machine could hand out tapes from "its" part of the store.
const GACHA_THEMES = [
  { body: '#e3262c', title: 'TAPE PALS', bg: ['#ffd23f', '#ff8c1a'], mascot: 'tape' },
  { body: '#1fa64a', title: 'SNACK PALS', bg: ['#fff3b0', '#ff5d5d'], mascot: 'burger' },
  { body: '#f2c200', title: 'GAME PALS', bg: ['#9be7ff', '#3d7bff'], mascot: 'controller' },
  { body: '#2a63d8', title: 'TV PALS', bg: ['#ffc6f0', '#b14dff'], mascot: 'tv' },
];
const CAPSULE_COLORS = ['#ff3b3b', '#ffb000', '#3ddc84', '#29b6f6', '#b388ff', '#ff4fa3', '#ff7a00', '#ffe14d'];

const GACHA = { W: 0.42, STAND_H: 0.55, BODY_H: 0.36, WIN_H: 0.42, DEPTH: 0.36, SPACING: 0.5 };

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

function plane(map, w, h, { basic = false, additive = false, transparent = false } = {}) {
  const material = basic
    ? new THREE.MeshBasicMaterial({ map, toneMapped: false, transparent: additive || transparent, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: !additive })
    : new THREE.MeshStandardMaterial({ map, roughness: 0.45, transparent });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
}

/** A cylinder whose axis points along local +z (knobs, handles, pins). */
function zCylinder(r, len, seg = 16) {
  return new THREE.CylinderGeometry(r, r, len, seg).rotateX(Math.PI / 2);
}

export function buildPrizeCorner({ root, B, mat, plan, colliders }) {
  const { W, D, door, counter } = plan;
  const group = new THREE.Group();
  group.name = 'prize-corner';
  root.add(group);

  const mats = {
    stand: new THREE.MeshStandardMaterial({ color: 0x2a2730, roughness: 0.6, metalness: 0.3 }),
    capsuleTop: new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.0 }),
    capsuleBottom: new THREE.MeshStandardMaterial({ color: 0xf2f4f8, roughness: 0.15, metalness: 0.0 }),
    // a bright, slightly self-lit ball so it reads against the painted board
    ball: new THREE.MeshStandardMaterial({ color: 0xf6f8fc, roughness: 0.12, metalness: 0.35, emissive: 0x2a2a30 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xd8b04a, roughness: 0.3, metalness: 0.6 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xffc933, roughness: 0.25, metalness: 0.6, emissive: 0x3a2a00 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x8a5a34, roughness: 0.75 }),
    woodDark: new THREE.MeshStandardMaterial({ color: 0x4f3020, roughness: 0.8 }),
    toy: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }),
    nailHead: new THREE.MeshStandardMaterial({ color: 0xfff0b8, roughness: 0.3, metalness: 0.3, emissive: 0x5a4818 }),
    // brighter than the store's chrome: with nothing to reflect, very metallic surfaces read as black
    steel: new THREE.MeshStandardMaterial({ color: 0xc9ccd6, roughness: 0.32, metalness: 0.5 }),
    plate: new THREE.MeshStandardMaterial({ color: 0x6f7380, roughness: 0.45, metalness: 0.5 }),
  };

  // ------------------------------------------------------------ gacha row
  const counterFront = counter.x - counter.depth / 2;
  const startX = door.x + door.width / 2 + 0.62;
  const room = counterFront - 0.12 - (startX - 0.23);
  const n = Math.max(0, Math.min(GACHA_THEMES.length, Math.floor(room / GACHA.SPACING)));
  const zRow = D / 2 - 0.36;
  const capsules = [];
  const gachas = [];
  for (let i = 0; i < n; i++) {
    const x = startX + i * GACHA.SPACING;
    gachas.push(buildGacha(B, mat, mats, group, GACHA_THEMES[i], x, zRow, Math.PI, 101 + i * 17, capsules));
  }
  if (n) {
    const meshes = addCapsules(group, mats, capsules);
    // each machine keeps its own pile (instance indices + resting matrices), top first
    for (const g of gachas) {
      g.capsuleMeshes = meshes;
      g.pile = capsules.map((c, index) => ({ ...c, index })).filter((c) => c.owner === g.seed);
      g.pile.sort((a, b) => b.y - a.y);
    }
    colliders.push({ minX: startX - 0.25, maxX: startX + (n - 1) * GACHA.SPACING + 0.25, minZ: zRow - 0.24, maxZ: D / 2 });
    // neon over the row, on the header above the front windows
    const sign = neonTexture('PRIZES!', BRAND.magenta, { font: FONT.bungee, size: 120, subtitle: '★ ALWAYS A WINNER ★', subColor: BRAND.yellow });
    const h = 0.55;
    const neon = plane(sign, h * sign.userData.aspect, h, { basic: true, additive: true });
    neon.position.set(startX + ((n - 1) * GACHA.SPACING) / 2, 2.98, D / 2 - 0.015);
    neon.rotation.y = Math.PI;
    group.add(neon);
  }

  // ------------------------------------------------------------ Lucky Hit, front-left corner
  // today's board (UTC): nail pattern and jackpot slot change every day.
  // Dev only: ?luckyday=N previews the board N days from now.
  const preview = import.meta.env?.DEV ? Number(new URLSearchParams(location.search).get('luckyday')) || 0 : 0;
  const board = boardForDay(dayNumber() + preview);
  const lx = -W / 2 + DIM.WALL_UNIT + 0.62;
  const lz = D / 2 - 0.42;
  const luckyHit = buildLuckyHitStall(B, mat, mats, group, board, lx, lz, Math.PI);
  colliders.push({ minX: lx - TABLE.W / 2 - 0.02, maxX: lx + TABLE.W / 2 + 0.02, minZ: lz - TABLE.D / 2 - 0.02, maxZ: D / 2 });

  return { group, gachas, luckyHit };
}

// ------------------------------------------------------------------ gacha machine

function buildGacha(B, mat, mats, parent, theme, x, z, rotY, seed, capsules) {
  const { W: w, STAND_H: sh, BODY_H: bh, WIN_H: wh, DEPTH: d } = GACHA;
  const m = new THREE.Matrix4().makeRotationY(rotY).setPosition(x, 0, z);
  const body = new THREE.MeshStandardMaterial({ color: theme.body, roughness: 0.35, metalness: 0.15 });
  const lid = new THREE.MeshStandardMaterial({ color: shade(theme.body, -0.12), roughness: 0.3, metalness: 0.15 });
  const front = d / 2;
  const yBody = sh + bh / 2;
  const yWin = sh + bh + 0.025 + wh / 2;
  const yTop = sh + bh + 0.025 + wh;

  B.boxAt(mats.stand, m, 0, sh / 2, 0, w + 0.04, sh, d + 0.04);
  B.boxAt(body, m, 0, yBody, 0, w, bh, d);
  B.boxAt(mats.plate, m, 0, yBody + 0.02, front + 0.006, 0.17, 0.21, 0.012); // coin mechanism plate
  B.boxAt(mat.dark, m, 0, yBody + 0.1, front + 0.013, 0.035, 0.008, 0.004); // coin slot
  B.boxAt(mats.steel, m, 0, sh + 0.05, front + 0.012, 0.11, 0.075, 0.03); // prize flap
  B.boxAt(mat.dark, m, 0, sh + 0.035, front + 0.028, 0.08, 0.028, 0.004);
  B.boxAt(mat.dark, m, 0, sh + bh + 0.0125, 0, w + 0.01, 0.025, d + 0.01); // seam
  B.boxAt(mat.glass, m, 0, yWin, 0, w - 0.02, wh, d - 0.02);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    B.boxAt(mats.steel, m, sx * (w / 2 - 0.01), yWin, sz * (d / 2 - 0.01), 0.012, wh, 0.012);
  }
  B.boxAt(lid, m, 0, yTop + 0.03, 0, w + 0.01, 0.06, d + 0.01);
  B.boxAt(lid, m, 0, yTop + 0.0725, 0, w - 0.08, 0.025, d - 0.08);
  B.geomAt(mats.steel, new THREE.CylinderGeometry(0.012, 0.012, 0.012, 12).translate(0, yTop + 0.09, 0), m);

  // moving parts stay separate so they can turn when the machine is played
  const machine = new THREE.Group();
  machine.position.set(x, 0, z);
  machine.rotation.y = rotY;
  parent.add(machine);

  const crank = new THREE.Group();
  crank.position.set(0, yBody + 0.02, front + 0.02);
  const knob = new THREE.Mesh(zCylinder(0.058, 0.03, 24), mats.steel);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.032, 0.03), mats.steel);
  handle.position.z = 0.026;
  crank.add(knob, handle);
  machine.add(crank);

  const card = plane(toTexture(gachaCard(theme, seed)), 0.25, 0.36);
  card.position.set(0.065, yWin + 0.005, front - 0.012);
  machine.add(card);

  // capsule pile inside the window: jittered layers, random tumble
  const r = rng(seed);
  machine.updateMatrixWorld();
  const R = 0.024;
  for (let layer = 0; layer < 3; layer++) {
    const off = layer % 2 ? 0.024 : 0;
    for (let ix = 0; ix < 7; ix++) for (let iz = 0; iz < 6; iz++) {
      if (layer === 2 && r() < 0.45) continue; // uneven top
      const lx = -0.15 + ix * 0.05 + off * 0.5 + (r() - 0.5) * 0.008;
      const lz = -0.13 + iz * 0.05 + off * 0.5 + (r() - 0.5) * 0.008;
      if (Math.abs(lx) > w / 2 - 0.03 - R || Math.abs(lz) > d / 2 - 0.03 - R) continue;
      const ly = sh + bh + 0.03 + R + layer * 0.043 + r() * 0.004;
      _q.setFromEuler(_e.set(r() * Math.PI * 2, r() * Math.PI * 2, r() * Math.PI * 2));
      _m.compose(_v.set(lx, ly, lz), _q, _s).premultiply(machine.matrixWorld);
      capsules.push({ owner: seed, y: ly, matrix: _m.clone(), color: CAPSULE_COLORS[Math.floor(r() * CAPSULE_COLORS.length)] });
    }
  }
  return { machine, crank, theme, seed, size: { ...GACHA, standH: sh, bodyH: bh, front } };
}

/** All capsules from every machine: two instanced hemispheres (coloured top, clear-ish bottom). */
function addCapsules(parent, mats, capsules) {
  const top = new THREE.SphereGeometry(0.024, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  const bottom = new THREE.SphereGeometry(0.024, 10, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  const tops = new THREE.InstancedMesh(top, mats.capsuleTop, capsules.length);
  const bottoms = new THREE.InstancedMesh(bottom, mats.capsuleBottom, capsules.length);
  const c = new THREE.Color();
  capsules.forEach((cap, i) => {
    tops.setMatrixAt(i, cap.matrix);
    bottoms.setMatrixAt(i, cap.matrix);
    tops.setColorAt(i, c.set(cap.color));
  });
  tops.computeBoundingSphere();
  bottoms.computeBoundingSphere();
  parent.add(tops, bottoms);
  return { tops, bottoms };
}

// ------------------------------------------------------------------ Lucky Hit stall

const TILT = (14 * Math.PI) / 180; // the board leans back against its prop
const TABLE = { W: 1.0, D: 0.56, H: 0.78 };
const THEME_STYLE = {
  tape: { color: '#e3262c', label: 'TAPE' },
  snack: { color: '#1fa64a', label: 'SNACK' },
  game: { color: '#f2c200', label: 'GAME' },
  tv: { color: '#2a63d8', label: 'TV' },
  rare: { color: '#ffcf33', label: '★' },
};

/**
 * A wooden board leaning on a little table, nails hammered into today's pattern, prize
 * slots along the bottom with a toy standing in front of each. `board` is the board of
 * the day from luckyhit-physics.js; the nails and slots come straight from it.
 */
function buildLuckyHitStall(B, mat, mats, parent, board, x, z, rotY) {
  const m = new THREE.Matrix4().makeRotationY(rotY).setPosition(x, 0, z);
  const wood = mats.wood;
  // table
  B.boxAt(wood, m, 0, TABLE.H - 0.02, 0, TABLE.W, 0.04, TABLE.D);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.boxAt(mats.woodDark, m, sx * (TABLE.W / 2 - 0.05), (TABLE.H - 0.04) / 2, sz * (TABLE.D / 2 - 0.05), 0.05, TABLE.H - 0.04, 0.05);
  for (const sz of [-1, 1]) B.boxAt(mats.woodDark, m, 0, 0.18, sz * (TABLE.D / 2 - 0.05), TABLE.W - 0.1, 0.04, 0.03);

  const stall = new THREE.Group();
  stall.position.set(x, 0, z);
  stall.rotation.y = rotY;
  parent.add(stall);

  // the board leans back from the table top; everything on it lives in its own space
  const { W, H, inner, slots, pin, ball, dropY } = LUCKY;
  const foot = -0.12; // where its bottom edge rests on the table
  const boardGroup = new THREE.Group();
  boardGroup.position.set(0, TABLE.H + (H / 2) * Math.cos(TILT), foot - (H / 2) * Math.sin(TILT));
  boardGroup.rotation.x = -TILT;
  stall.add(boardGroup);
  stall.updateMatrixWorld(true);
  const bm = boardGroup.matrixWorld;

  B.boxAt(wood, bm, 0, 0, -0.0125, W, H, 0.025); // the board itself
  for (const s of [-1, 1]) {
    B.boxAt(mats.woodDark, bm, s * (W / 2 - 0.012), 0, 0.006, 0.024, H, 0.014); // edge trim
    B.boxAt(mats.woodDark, bm, s * (inner + 0.008), (slots.y0 + H / 2 - 0.05) / 2, 0.012, 0.016, H / 2 - 0.05 - slots.y0, 0.024); // side rails
  }
  B.boxAt(mats.woodDark, bm, 0, H / 2 - 0.012, 0.006, W, 0.024, 0.014);
  B.boxAt(mats.woodDark, bm, 0, slots.y0 - 0.008, 0.012, 2 * inner + 0.032, 0.016, 0.024); // slot floor
  B.geomAt(mats.brass, new THREE.CylinderGeometry(0.004, 0.004, 2 * inner, 10).rotateZ(Math.PI / 2).translate(0, dropY + 0.03, 0.02), bm); // drop rail

  // painted face: wood, art, slot colours and labels, nail shadows
  const face = plane(toTexture(luckyBoardArt(board)), W, H);
  face.position.z = 0.0005;
  boardGroup.add(face);

  // nails (today's pattern) and slot dividers, instanced
  const nails = new THREE.InstancedMesh(zCylinder(pin, 0.022, 6), mats.brass, board.pins.length);
  // bright heads, so the day's pattern reads clearly against the painted art
  const nailHeads = new THREE.InstancedMesh(zCylinder(pin * 1.7, 0.003, 10), mats.nailHead, board.pins.length);
  board.pins.forEach(([px, py], i) => {
    nails.setMatrixAt(i, _m.makeTranslation(px, py, 0.011).premultiply(bm));
    nailHeads.setMatrixAt(i, _m.makeTranslation(px, py, 0.0225).premultiply(bm));
  });
  nails.computeBoundingSphere();
  nailHeads.computeBoundingSphere();
  parent.add(nails, nailHeads);
  const dividers = board.slots.slice(1);
  const divMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(slots.divider, slots.y1 - slots.y0, 0.024), mats.brass, dividers.length);
  dividers.forEach((s, i) => divMesh.setMatrixAt(i, _m.makeTranslation(s.x0 - slots.divider / 2, (slots.y0 + slots.y1) / 2, 0.012).premultiply(bm)));
  divMesh.computeBoundingSphere();
  parent.add(divMesh);

  // the ball and the little cup that holds it on the drop rail (the game moves these)
  const holder = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.01, 0.014, 16, 1, true), mats.brass);
  holder.material = mats.brass.clone();
  holder.material.side = THREE.DoubleSide;
  holder.position.set(0, dropY + 0.006, ball + 0.004);
  boardGroup.add(holder);
  const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(ball, 20, 14), mats.ball);
  ballMesh.position.set(0, dropY, ball + 0.002);
  boardGroup.add(ballMesh);
  // glow over the slot a ball lands in
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, slots.y1 - slots.y0), new THREE.MeshBasicMaterial({ color: 0xfff1b0, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
  glow.position.set(0, (slots.y0 + slots.y1) / 2, 0.002);
  boardGroup.add(glow);

  // a toy standing in front of each slot (gold trophy for the jackpot)
  const toys = board.slots.filter((s) => !s.jackpot);
  const bodies = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.011, 0.014, 0.034, 12), mats.toy, toys.length);
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.013, 14, 10), mats.toy, toys.length);
  const c = new THREE.Color();
  toys.forEach((s, i) => {
    const tx = (s.x0 + s.x1) / 2;
    bodies.setMatrixAt(i, _m.makeTranslation(tx, TABLE.H + 0.017, foot + 0.05).premultiply(stall.matrixWorld));
    heads.setMatrixAt(i, _m.makeTranslation(tx, TABLE.H + 0.046, foot + 0.05).premultiply(stall.matrixWorld));
    bodies.setColorAt(i, c.set(THEME_STYLE[s.theme].color));
    heads.setColorAt(i, c.set(THEME_STYLE[s.theme].color).offsetHSL(0, -0.1, 0.12));
  });
  for (const im of [bodies, heads]) im.computeBoundingSphere();
  parent.add(bodies, heads);
  const jp = board.slots.find((s) => s.jackpot);
  const trophy = new THREE.Group();
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.006, 0.026, 14), mats.gold);
  cup.position.y = 0.032;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.02, 8), mats.gold);
  stem.position.y = 0.012;
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.006, 0.022), mats.gold);
  base.position.y = 0.003;
  trophy.add(cup, stem, base);
  trophy.position.set((jp.x0 + jp.x1) / 2, TABLE.H, foot + 0.05);
  stall.add(trophy);

  // signs on the table: the stall card and today's chalkboard
  const card = plane(toTexture(luckyCard()), 0.15, 0.19);
  card.position.set(0.38, TABLE.H + 0.095, 0.12);
  card.rotation.set(-0.2, -0.25, 0);
  stall.add(card);
  const chalk = plane(toTexture(chalkboard(board)), 0.22, 0.16);
  chalk.position.set(-0.36, TABLE.H + 0.085, 0.12);
  chalk.rotation.set(-0.25, 0.25, 0);
  stall.add(chalk);

  return { stall, board, boardGroup, holder, ball: ballMesh, glow, foot };
}

// ------------------------------------------------------------------ canvas art

function swirl(ctx, w, h, c1, c2, cx, cy, arms = 10, twist = 0.012) {
  const img = ctx.createImageData(w, h);
  const a = new THREE.Color(c1);
  const b = new THREE.Color(c2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = x - cx;
    const dy = y - cy;
    const t = (Math.atan2(dy, dx) / (Math.PI * 2)) * arms + Math.hypot(dx, dy) * twist;
    const c = t - Math.floor(t) < 0.5 ? a : b;
    const i = (y * w + x) * 4;
    img.data[i] = c.r * 255;
    img.data[i + 1] = c.g * 255;
    img.data[i + 2] = c.b * 255;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

function eyes(ctx, x, y, gap, size) {
  for (const s of [-1, 1]) {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(x + s * gap, y, size, size * 1.25, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = size * 0.25;
    ctx.strokeStyle = '#111';
    ctx.stroke();
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(x + s * gap + size * 0.2, y + size * 0.15, size * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x + s * gap + size * 0.35, y - size * 0.1, size * 0.16, 0, Math.PI * 2);
    ctx.fill();
  }
}

function smile(ctx, x, y, w) {
  ctx.strokeStyle = '#111';
  ctx.lineWidth = w * 0.12;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x, y - w * 0.3, w * 0.6, 0.2 * Math.PI, 0.8 * Math.PI);
  ctx.stroke();
}

function mascot(ctx, kind, cx, cy, s) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 5 * s;
  if (kind === 'tape') {
    ctx.fillStyle = '#1d1d24';
    ctx.beginPath();
    ctx.roundRect(-70 * s, -45 * s, 140 * s, 90 * s, 10 * s);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#f4ecd8';
    ctx.fillRect(-56 * s, -36 * s, 112 * s, 34 * s);
    eyes(ctx, 0, 14 * s, 30 * s, 13 * s);
    smile(ctx, 0, 40 * s, 22 * s);
    ctx.fillStyle = BRAND.magenta;
    ctx.font = `${17 * s}px ${FONT.bungee}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('VHS', 0, -19 * s);
  } else if (kind === 'burger') {
    ctx.fillStyle = '#e39a3b';
    ctx.beginPath();
    ctx.ellipse(0, -15 * s, 68 * s, 45 * s, 0, Math.PI, 0);
    ctx.lineTo(68 * s, -10 * s);
    ctx.lineTo(-68 * s, -10 * s);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff6d6';
    for (let i = 0; i < 6; i++) ctx.fillRect((-40 + i * 15) * s, (-45 + (i % 2) * 8) * s, 5 * s, 3 * s);
    ctx.fillStyle = '#55c234';
    ctx.beginPath();
    ctx.moveTo(-74 * s, -8 * s);
    for (let i = 0; i <= 10; i++) ctx.lineTo((-74 + i * 14.8) * s, (i % 2 ? 6 : -6) * s);
    ctx.lineTo(74 * s, 4 * s);
    ctx.lineTo(-74 * s, 4 * s);
    ctx.fill();
    ctx.fillStyle = '#ffcc1f';
    ctx.beginPath();
    ctx.moveTo(-60 * s, 4 * s);
    ctx.lineTo(60 * s, 4 * s);
    ctx.lineTo(30 * s, 20 * s);
    ctx.lineTo(0, 8 * s);
    ctx.lineTo(-30 * s, 20 * s);
    ctx.fill();
    ctx.fillStyle = '#6b3a1f';
    ctx.beginPath();
    ctx.roundRect(-66 * s, 8 * s, 132 * s, 18 * s, 8 * s);
    ctx.fill();
    ctx.fillStyle = '#e39a3b';
    ctx.beginPath();
    ctx.roundRect(-64 * s, 26 * s, 128 * s, 20 * s, 9 * s);
    ctx.fill();
    ctx.stroke();
    eyes(ctx, 0, -28 * s, 24 * s, 11 * s);
  } else if (kind === 'controller') {
    ctx.fillStyle = '#b8b8c8';
    ctx.beginPath();
    ctx.roundRect(-75 * s, -32 * s, 150 * s, 64 * s, 30 * s);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#26262e';
    ctx.fillRect(-58 * s, -6 * s, 30 * s, 10 * s);
    ctx.fillRect(-48 * s, -16 * s, 10 * s, 30 * s);
    for (const [bx, by, c] of [[42, -8, '#e3262c'], [58, 4, '#2a63d8']]) {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(bx * s, by * s, 8 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    eyes(ctx, 0, -6 * s, 16 * s, 9 * s);
    smile(ctx, 0, 20 * s, 14 * s);
  } else {
    ctx.fillStyle = '#7a5b3a';
    ctx.beginPath();
    ctx.roundRect(-70 * s, -50 * s, 140 * s, 100 * s, 14 * s);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#7fe0ff';
    ctx.beginPath();
    ctx.roundRect(-56 * s, -38 * s, 92 * s, 76 * s, 16 * s);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#2b2b33';
    for (const ky of [-18, 12]) {
      ctx.beginPath();
      ctx.arc(54 * s, ky * s, 7 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(-20 * s, -50 * s);
    ctx.lineTo(-40 * s, -80 * s);
    ctx.moveTo(10 * s, -50 * s);
    ctx.lineTo(32 * s, -82 * s);
    ctx.stroke();
    eyes(ctx, -10 * s, -6 * s, 18 * s, 10 * s);
    smile(ctx, -10 * s, 22 * s, 16 * s);
  }
  ctx.restore();
}

function gachaCard(theme, seed) {
  const w = 256;
  const h = 368;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  swirl(ctx, w, h, theme.bg[0], theme.bg[1], w * 0.5, h * 0.55, 8 + (seed % 4), 0.01);
  // title band
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, 64);
  ctx.fillStyle = theme.body;
  ctx.font = `34px ${FONT.bungee}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(theme.title, w / 2, 34, w - 20);
  ctx.fillStyle = '#111';
  ctx.font = `13px ${FONT.pixel}`;
  ctx.fillText('CAPSULE TOYS', w / 2, 82, w - 20);
  mascot(ctx, theme.mascot, w / 2, 190, 1.25);
  // bottom ribbon
  ctx.fillStyle = BRAND.navy;
  ctx.fillRect(0, h - 70, w, 70);
  ctx.fillStyle = BRAND.yellow;
  ctx.font = `30px ${FONT.bebas}`;
  ctx.fillText('ALWAYS A WINNER!', w / 2, h - 46, w - 16);
  ctx.fillStyle = '#fff';
  ctx.font = `12px ${FONT.pixel}`;
  ctx.fillText('FREE PLAY', w / 2, h - 18);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, w - 6, h - 6);
  return c;
}

/** Hand-painted look for the board face: wood planks, the four pals, slot colours. */
function luckyBoardArt(board) {
  const { W, H, inner, slots, field } = LUCKY;
  const k = 800; // pixels per metre
  const w = Math.round(W * k);
  const h = Math.round(H * k);
  const X = (x) => (x / W + 0.5) * w;
  const Y = (y) => (0.5 - y / H) * h;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const r = rng(board.day * 31 + 7);

  // planks with grain
  const planks = 4;
  for (let i = 0; i < planks; i++) {
    const x0 = (w * i) / planks;
    const g = ctx.createLinearGradient(x0, 0, x0 + w / planks, 0);
    const base = ['#9a6539', '#8e5b31', '#a06b3d', '#93603a'][i];
    g.addColorStop(0, shade(base, -0.08));
    g.addColorStop(0.5, base);
    g.addColorStop(1, shade(base, -0.12));
    ctx.fillStyle = g;
    ctx.fillRect(x0, 0, w / planks, h);
    ctx.strokeStyle = 'rgba(60,30,10,.18)';
    ctx.lineWidth = 1.2;
    for (let n = 0; n < 14; n++) {
      const gx = x0 + r() * (w / planks);
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      for (let y = 0; y <= h; y += 40) ctx.lineTo(gx + Math.sin(y / 90 + n) * 4 + (r() - 0.5) * 2, y);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(40,20,5,.45)';
    ctx.fillRect(x0 - 1, 0, 2, h);
  }

  // painted art panel in the middle of the field, nails go right over it
  const px0 = X(-inner + 0.02);
  const py0 = Y(field.y1 - 0.02);
  const pw = X(inner - 0.02) - px0;
  const ph = Y(field.y0 + 0.08) - py0;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(px0, py0, pw, ph, 24);
  ctx.clip();
  const art = makeCanvas(Math.round(pw), Math.round(ph));
  swirl(art.getContext('2d'), art.width, art.height, '#ffd23f', '#ff6a3d', art.width / 2, art.height * 0.55, 12, 0.012);
  ctx.globalAlpha = 0.72; // let the wood show through a little; the nails need to read on top
  ctx.drawImage(art, px0, py0);
  ctx.globalAlpha = 1;
  const kinds = ['tape', 'burger', 'controller', 'tv'];
  kinds.forEach((kind, i) => mascot(ctx, kind, px0 + pw * (0.25 + (i % 2) * 0.5), py0 + ph * (0.3 + Math.floor(i / 2) * 0.42), 0.95));
  ctx.restore();
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#f4ecd8';
  ctx.beginPath();
  ctx.roundRect(px0, py0, pw, ph, 24);
  ctx.stroke();

  // title across the top, under the drop rail
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `46px ${FONT.bungee}`;
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#5a1010';
  ctx.strokeText('LUCKY HIT', w / 2, Y(LUCKY.dropY - 0.035));
  ctx.fillStyle = '#ffe14d';
  ctx.fillText('LUCKY HIT', w / 2, Y(LUCKY.dropY - 0.035));

  // slots: tinted backs and labels underneath
  for (const s of board.slots) {
    const st = THEME_STYLE[s.theme];
    ctx.fillStyle = st.color;
    ctx.globalAlpha = s.jackpot ? 0.95 : 0.6;
    ctx.fillRect(X(s.x0), Y(slots.y1), X(s.x1) - X(s.x0), Y(slots.y0) - Y(slots.y1));
    ctx.globalAlpha = 1;
    ctx.fillStyle = s.jackpot ? '#5a1010' : '#fff';
    ctx.font = `${s.jackpot ? 26 : 15}px ${s.jackpot ? FONT.bungee : FONT.bebas}`;
    ctx.save();
    ctx.translate((X(s.x0) + X(s.x1)) / 2, (Y(slots.y1) + Y(slots.y0)) / 2);
    if (!s.jackpot) ctx.rotate(-Math.PI / 2);
    ctx.fillText(st.label, 0, 1, Y(slots.y0) - Y(slots.y1) - 8);
    ctx.restore();
  }
  ctx.fillStyle = '#f4ecd8';
  ctx.font = `20px ${FONT.marker}`;
  ctx.fillText('every ball wins!', w / 2, Y(slots.y0 - 0.025));

  // nail shadows (the nails themselves are real geometry)
  ctx.fillStyle = 'rgba(30,15,5,.45)';
  for (const [x, y] of board.pins) {
    ctx.beginPath();
    ctx.arc(X(x) + 2.5, Y(y) + 3, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

/** The hand-lettered card propped on the table (like the "prize guaranteed" cards in Shenmue). */
function luckyCard() {
  const c = makeCanvas(300, 380);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f7f1e1';
  ctx.fillRect(0, 0, 300, 380);
  ctx.strokeStyle = '#2e7d32';
  ctx.lineWidth = 8;
  ctx.strokeRect(10, 10, 280, 360);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#2e7d32';
  ctx.font = `64px ${FONT.marker}`;
  ctx.fillText('LUCKY', 150, 80);
  ctx.fillText('HIT!', 150, 150);
  ctx.fillStyle = '#c62828';
  ctx.font = `34px ${FONT.marker}`;
  ctx.fillText('every ball', 150, 225);
  ctx.fillText('wins a prize', 150, 265);
  ctx.fillStyle = '#111';
  ctx.font = `46px ${FONT.marker}`;
  ctx.fillText('FREE', 150, 330);
  return c;
}

/** Today's board number and pattern, chalked up. */
function chalkboard(board) {
  const c = makeCanvas(352, 256);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#6b4128';
  ctx.fillRect(0, 0, 352, 256);
  ctx.fillStyle = '#1f2a24';
  ctx.fillRect(14, 14, 324, 228);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(240,240,230,.92)';
  ctx.font = `30px ${FONT.marker}`;
  ctx.fillText("TODAY'S BOARD", 176, 56);
  ctx.font = `58px ${FONT.marker}`;
  ctx.fillStyle = '#ffe9a8';
  ctx.fillText(`#${board.number}`, 176, 118);
  ctx.font = `30px ${FONT.marker}`;
  ctx.fillStyle = 'rgba(240,240,230,.92)';
  ctx.fillText(board.pattern, 176, 172);
  ctx.font = `18px ${FONT.marker}`;
  ctx.fillText('new nails every day', 176, 214);
  return c;
}

// The prize corner by the entrance: a row of capsule-toy (gacha) machines along the
// front window and a pachinko machine in the front-left corner. Props only for now.
// Playing them and the always-win prize draw come later (docs/roadmap.md), so the
// moving parts (cranks, ball tray, lights) are kept as separate objects to animate.
import * as THREE from 'three';
import { DIM, BRAND } from './config.js';
import { FONT } from './fonts.js';
import { makeCanvas, rng, shade } from './util.js';
import { toTexture, neonTexture } from './textures.js';

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

export function buildPrizeCorner({ root, B, mat, plan, colliders, animated }) {
  const { W, D, door, counter } = plan;
  const group = new THREE.Group();
  group.name = 'prize-corner';
  root.add(group);

  const mats = {
    stand: new THREE.MeshStandardMaterial({ color: 0x2a2730, roughness: 0.6, metalness: 0.3 }),
    capsuleTop: new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.0 }),
    capsuleBottom: new THREE.MeshStandardMaterial({ color: 0xf2f4f8, roughness: 0.15, metalness: 0.0 }),
    ball: new THREE.MeshStandardMaterial({ color: 0xd8dce4, roughness: 0.15, metalness: 0.95 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xd8b04a, roughness: 0.3, metalness: 0.9 }),
    frame: new THREE.MeshStandardMaterial({ color: 0x5b2a86, roughness: 0.35, metalness: 0.4 }),
    panel: new THREE.MeshStandardMaterial({ color: 0xc0153f, roughness: 0.4, metalness: 0.2 }),
    vinyl: new THREE.MeshStandardMaterial({ color: 0xb3122e, roughness: 0.55 }),
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
    addCapsules(group, mats, capsules);
    colliders.push({ minX: startX - 0.25, maxX: startX + (n - 1) * GACHA.SPACING + 0.25, minZ: zRow - 0.24, maxZ: D / 2 });
    // neon over the row, on the header above the front windows
    const sign = neonTexture('PRIZES!', BRAND.magenta, { font: FONT.bungee, size: 120, subtitle: '★ ALWAYS A WINNER ★', subColor: BRAND.yellow });
    const h = 0.55;
    const neon = plane(sign, h * sign.userData.aspect, h, { basic: true, additive: true });
    neon.position.set(startX + ((n - 1) * GACHA.SPACING) / 2, 2.98, D / 2 - 0.015);
    neon.rotation.y = Math.PI;
    group.add(neon);
  }

  // ------------------------------------------------------------ pachinko, front-left corner
  const px = -W / 2 + DIM.WALL_UNIT + 0.45;
  const pz = D / 2 - 0.26;
  const pachinko = buildPachinko(B, mat, mats, group, px, pz, Math.PI, animated);
  colliders.push({ minX: px - 0.35, maxX: px + 0.35, minZ: pz - 0.8, maxZ: D / 2 });

  return { group, gachas, pachinko };
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
      capsules.push({ matrix: _m.clone(), color: CAPSULE_COLORS[Math.floor(r() * CAPSULE_COLORS.length)] });
    }
  }
  return { machine, crank, theme };
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
}

// ------------------------------------------------------------------ pachinko machine

const PLAY = { W: 0.52, H: 0.6, Y: 1.26 }; // playfield size and centre height
const LCD = { x0: 0.3, x1: 0.7, y0: 0.32, y1: 0.56 }; // in playfield 0..1 coordinates

function buildPachinko(B, mat, mats, parent, x, z, rotY, animated) {
  const m = new THREE.Matrix4().makeRotationY(rotY).setPosition(x, 0, z);
  // stand, body, lower panel with ball trays
  B.boxAt(mat.trim, m, 0, 0.36, 0, 0.66, 0.72, 0.46);
  B.boxAt(mats.steel, m, 0, 0.715, 0.231, 0.66, 0.02, 0.012);
  B.boxAt(mats.frame, m, 0, 1.17, -0.02, 0.62, 0.9, 0.14);
  B.boxAt(mats.panel, m, 0, 0.83, 0.065, 0.6, 0.2, 0.03);
  B.boxAt(mats.steel, m, 0, 0.94, 0.12, 0.44, 0.03, 0.1); // upper tray
  B.boxAt(mats.steel, m, 0, 0.965, 0.168, 0.44, 0.03, 0.008);
  B.boxAt(mats.steel, m, -0.06, 0.765, 0.115, 0.3, 0.03, 0.08); // lower tray
  B.geomAt(mats.steel, zCylinder(0.032, 0.06, 20).translate(0.23, 0.8, 0.11), m); // launch handle
  B.geomAt(mats.vinyl, zCylinder(0.024, 0.02, 20).translate(0.23, 0.8, 0.148), m);
  // chrome frame around the glass
  const gx = PLAY.W / 2 + 0.015;
  const gy0 = PLAY.Y - PLAY.H / 2 - 0.015;
  const gy1 = PLAY.Y + PLAY.H / 2 + 0.015;
  B.boxAt(mats.steel, m, 0, gy1, 0.064, PLAY.W + 0.06, 0.03, 0.03);
  B.boxAt(mats.steel, m, 0, gy0, 0.064, PLAY.W + 0.06, 0.03, 0.03);
  for (const s of [-1, 1]) B.boxAt(mats.steel, m, s * gx, PLAY.Y, 0.064, 0.03, PLAY.H + 0.06, 0.03);
  // title box on top
  B.boxAt(mats.frame, m, 0, 1.7, -0.02, 0.62, 0.16, 0.12);
  // stool
  B.geomAt(mats.steel, new THREE.CylinderGeometry(0.21, 0.21, 0.02, 24).translate(0, 0.01, 0.55), m);
  B.geomAt(mats.steel, new THREE.CylinderGeometry(0.025, 0.025, 0.5, 12).translate(0, 0.26, 0.55), m);
  B.geomAt(mats.vinyl, new THREE.CylinderGeometry(0.17, 0.16, 0.07, 24).translate(0, 0.545, 0.55), m);

  const machine = new THREE.Group();
  machine.position.set(x, 0, z);
  machine.rotation.y = rotY;
  parent.add(machine);

  // playfield art + brass pins in the same positions
  const pins = pinLayout();
  const field = plane(toTexture(playfieldArt(pins)), PLAY.W, PLAY.H);
  field.position.set(0, PLAY.Y, 0.0505);
  machine.add(field);
  const pinMesh = new THREE.InstancedMesh(zCylinder(0.0022, 0.02, 5), mats.brass, pins.length);
  machine.updateMatrixWorld();
  pins.forEach(([u, v], i) => {
    _m.makeTranslation((u - 0.5) * PLAY.W, PLAY.Y + (0.5 - v) * PLAY.H, 0.06).premultiply(machine.matrixWorld);
    pinMesh.setMatrixAt(i, _m);
  });
  pinMesh.computeBoundingSphere();
  parent.add(pinMesh);

  const glass = new THREE.Mesh(new THREE.PlaneGeometry(PLAY.W, PLAY.H), mat.glass);
  glass.position.set(0, PLAY.Y, 0.074);
  glass.renderOrder = 2;
  machine.add(glass);

  // a heap of silver balls in the upper tray
  const r = rng(808);
  const balls = [];
  for (let ix = 0; ix < 22; ix++) for (let iz = 0; iz < 7; iz++) {
    if (ix > 14 && r() < (ix - 14) / 8) continue;
    balls.push([-0.2 + ix * 0.0115 + (iz % 2) * 0.0057, 0.961 + (r() < 0.25 ? 0.009 : 0), 0.082 + iz * 0.011]);
  }
  const ballMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.0055, 8, 6), mats.ball, balls.length);
  balls.forEach(([bx, by, bz], i) => ballMesh.setMatrixAt(i, _m.makeTranslation(bx, by, bz).premultiply(machine.matrixWorld)));
  ballMesh.computeBoundingSphere();
  parent.add(ballMesh);

  // chasing bulbs down both sides of the playfield
  const bulbs = toTexture(bulbStrip(), { mipmaps: false });
  bulbs.wrapT = THREE.RepeatWrapping;
  bulbs.repeat.set(1, 3);
  const bulbMat = new THREE.MeshBasicMaterial({ map: bulbs, toneMapped: false });
  for (const s of [-1, 1]) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.02, PLAY.H), bulbMat);
    strip.position.set(s * (PLAY.W / 2 + 0.04), PLAY.Y, 0.0505);
    machine.add(strip);
  }
  animated.push({ update: (dt, t) => (bulbs.offset.y = Math.floor(t * 6) / 8) });

  const title = neonTexture('BRUTAL FEVER', BRAND.yellow, { font: FONT.bungee, size: 110, padding: 40 });
  const th = 0.13;
  const sign = plane(title, Math.min(0.6, th * title.userData.aspect), th, { basic: true, additive: true });
  sign.position.set(0, 1.7, 0.042);
  machine.add(sign);

  return { machine, balls: ballMesh, pins: pinMesh, field };
}

/** Classic staggered pin field, kept off the title, the screen and the pockets. */
function pinLayout() {
  const r = rng(4242);
  const out = [];
  const aspect = PLAY.H / PLAY.W;
  for (let row = 0; row < 26; row++) {
    const v = 0.17 + row * 0.029;
    for (let col = 0; col < 24; col++) {
      const u = 0.06 + col * 0.04 + (row % 2) * 0.02;
      const du = u - 0.5;
      const dv = (v - 0.52) * aspect;
      if (du * du + dv * dv > 0.43 * 0.43) continue; // inside the outer rail
      if (u > LCD.x0 - 0.05 && u < LCD.x1 + 0.05 && v > LCD.y0 - 0.04 && v < LCD.y1 + 0.05) continue;
      if (Math.abs(u - 0.5) < 0.06 && v > 0.6 && v < 0.68) continue; // start pocket
      if (r() < 0.22) continue; // gaps make the lanes
      out.push([u, v]);
    }
  }
  return out;
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

function playfieldArt(pins) {
  const w = 512;
  const h = Math.round((w * PLAY.H) / PLAY.W);
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(w / 2, h * 0.45, 20, w / 2, h * 0.5, h * 0.7);
  g.addColorStop(0, '#ff5fa8');
  g.addColorStop(0.45, '#8a2be2');
  g.addColorStop(1, '#1a0b3d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // starburst
  ctx.save();
  ctx.translate(w / 2, h * 0.45);
  ctx.fillStyle = 'rgba(255,255,255,.07)';
  for (let i = 0; i < 24; i++) {
    ctx.rotate((Math.PI * 2) / 24);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-18, -h);
    ctx.lineTo(18, -h);
    ctx.fill();
  }
  ctx.restore();
  // outer rail
  const cx = w / 2;
  const cy = h * 0.52;
  const R = w * 0.45;
  ctx.lineWidth = 10;
  ctx.strokeStyle = '#e8c35a';
  ctx.beginPath();
  ctx.ellipse(cx, cy, R, R * 1.0, 0, Math.PI * 0.82, Math.PI * 2.18);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#fff3c4';
  ctx.stroke();
  // title
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `44px ${FONT.bungee}`;
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#2a0b4a';
  ctx.strokeText('MOOSE RUSH', w / 2, h * 0.115);
  ctx.fillStyle = '#ffe14d';
  ctx.fillText('MOOSE RUSH', w / 2, h * 0.115);
  // centre screen
  const lx = LCD.x0 * w;
  const ly = LCD.y0 * h;
  const lw = (LCD.x1 - LCD.x0) * w;
  const lh = (LCD.y1 - LCD.y0) * h;
  ctx.fillStyle = '#d7d9e0';
  ctx.beginPath();
  ctx.roundRect(lx - 12, ly - 12, lw + 24, lh + 24, 16);
  ctx.fill();
  ctx.fillStyle = '#0b1030';
  ctx.fillRect(lx, ly, lw, lh);
  ctx.font = `64px ${FONT.bungee}`;
  for (let i = 0; i < 3; i++) {
    const rx = lx + (lw * (i + 0.5)) / 3;
    ctx.fillStyle = 'rgba(255,255,255,.06)';
    ctx.fillRect(lx + (lw * i) / 3 + 4, ly + 4, lw / 3 - 8, lh - 8);
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#ffe14d';
    ctx.strokeText('7', rx, ly + lh / 2 + 4);
    ctx.fillStyle = '#ff2d4a';
    ctx.fillText('7', rx, ly + lh / 2 + 4);
  }
  // pockets: start cup under the screen, tulips either side, out hole at the bottom
  const cup = (x, y, col, label) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(x - 22, y - 10);
    ctx.quadraticCurveTo(x, y + 26, x + 22, y - 10);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.stroke();
    if (label) {
      ctx.fillStyle = '#fff';
      ctx.font = `11px ${FONT.pixel}`;
      ctx.fillText(label, x, y + 24);
    }
  };
  cup(w / 2, h * 0.645, '#ffe14d', 'START');
  cup(w * 0.22, h * 0.7, '#ff3b3b');
  cup(w * 0.78, h * 0.7, '#ff3b3b');
  ctx.fillStyle = '#0a0518';
  ctx.beginPath();
  ctx.arc(w / 2, h * 0.93, 26, Math.PI, 0);
  ctx.fill();
  // windmills
  for (const wx of [0.16, 0.84]) {
    ctx.save();
    ctx.translate(w * wx, h * 0.42);
    for (let i = 0; i < 4; i++) {
      ctx.rotate(Math.PI / 2);
      ctx.fillStyle = i % 2 ? '#29b6f6' : '#ffffff';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(18, -6);
      ctx.lineTo(18, 6);
      ctx.fill();
    }
    ctx.restore();
  }
  // pin shadows (the brass pins themselves are real geometry)
  ctx.fillStyle = 'rgba(0,0,0,.45)';
  for (const [u, v] of pins) {
    ctx.beginPath();
    ctx.arc(u * w + 1.5, v * h + 1.5, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

function bulbStrip() {
  const c = makeCanvas(16, 128);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#16081f';
  ctx.fillRect(0, 0, 16, 128);
  const cols = ['#ffe14d', '#ff2e88', '#2ee6ff', '#ffe14d'];
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = cols[i % cols.length];
    ctx.globalAlpha = i % 2 ? 0.35 : 1;
    ctx.beginPath();
    ctx.arc(8, 8 + i * 16, 5.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return c;
}

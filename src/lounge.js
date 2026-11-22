// The lounge: two couches facing a projection screen, across the front third of the wing
// off the sales floor. It's decorative for now. The screen runs a "coming attractions"
// slideshow of box art. Later a real video will play on it: plan.lounge.screen says
// where the screen is, so a YouTube player can be laid over it (docs/roadmap.md), and
// plan.lounge.sofas are where you'll sit to watch.
import * as THREE from 'three';
import { DIM, BRAND } from './config.js';
import { FONT } from './fonts.js';
import { toTexture, panelTexture } from './textures.js';
import { makeCanvas, rng, shuffle, hash } from './util.js';
import { getThumb, drawArt } from './covers.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Batcher, tiledPlane } from './fixtures.js';

export function buildLounge({ group, B, mat, plan, catalog, animated, scene }) {
  const L = plan.lounge;
  // Plain-coloured parts are all one vertex-coloured material: a single draw call.
  const solid = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  const paint = (hex) => Batcher.paint(solid, hex);
  const m = {
    fabric: paint(0x863058),
    cushion: paint(0xa13d68),
    pillow: paint(0xd9a233),
    wood: paint(0x6a4428),
    woodDark: paint(0x2e1d12),
    red: paint(0xc8202e),
    dark: paint(0x1b1b22),
    frame: paint(0x2b2b33),
    popcorn: paint(0xfff1bf),
    curtain: new THREE.MeshStandardMaterial({ map: curtainTexture(), roughness: 0.85 }),
    blinds: new THREE.MeshStandardMaterial({ map: blindsTexture(), roughness: 0.7 }),
    bucket: new THREE.MeshStandardMaterial({ map: bucketTexture(), roughness: 0.6 }),
    shade: new THREE.MeshStandardMaterial({ color: 0xffe2b0, emissive: 0xffb860, emissiveIntensity: 0.9, roughness: 0.8, side: THREE.DoubleSide }),
    glow: new THREE.MeshBasicMaterial({ color: 0xe8f0ff, toneMapped: false }),
  };
  m.blinds.userData.decal = true; // just in front of the window frame (see ps1.js)

  // ---- the screen, its frame and curtains
  const s = L.screen;
  B.box(m.dark, s.x - 0.045, s.y, s.z, 0.03, s.h + 0.12, s.w + 0.12);
  const show = new PreShow(catalog);
  animated.push(show);
  const screenMat = new THREE.MeshBasicMaterial({ map: show.texture, color: 0xe6e6e6, toneMapped: false });
  screenMat.userData.thumbnail = true; // box art: stays sharp in PS1 Mode
  const screen = new THREE.Mesh(tiledPlane(s.w, s.h, 0.5), screenMat);
  screen.name = 'lounge-screen';
  screen.position.set(s.x - 0.025, s.y, s.z);
  screen.rotation.y = Math.PI / 2; // faces +x, into the room
  group.add(screen);
  const wallX = L.x0;
  const curtainW = 0.46;
  for (const side of [-1, 1]) {
    const cz = s.z + side * (s.w / 2 + 0.06 + curtainW / 2);
    B.box(m.curtain, wallX + 0.08, 1.53, cz, 0.16, 3.06, curtainW, 2);
  }
  B.box(m.curtain, wallX + 0.1, 3.08, s.z, 0.2, 0.36, s.w + 0.12 + 2 * curtainW + 0.04, 2); // valance

  // ---- projector on a ceiling mount, and its beam
  const P = L.projector;
  B.box(m.dark, P.x, P.y, P.z, 0.36, 0.16, 0.32);
  B.box(mat.chrome, P.x, (P.y + 0.08 + DIM.CEILING) / 2, P.z, 0.04, DIM.CEILING - P.y - 0.08, 0.04);
  B.box(mat.chrome, P.x - 0.2, P.y - 0.01, P.z, 0.06, 0.1, 0.1); // lens barrel
  B.box(m.glow, P.x - 0.232, P.y - 0.01, P.z, 0.004, 0.07, 0.07);
  group.add(projectorBeam(new THREE.Vector3(P.x - 0.24, P.y - 0.01, P.z), s));

  // ---- couches, coffee table, rug
  for (const so of L.sofas) sofa(B, m, new THREE.Matrix4().makeRotationY(-Math.PI / 2).setPosition(so.x, 0, so.z), so.len, so.depth);
  coffeeTable(B, m, L.table);
  const rug = new THREE.Mesh(tiledPlane(3.9, Math.min(3.2, L.z1 - L.z0 - 0.6)), new THREE.MeshStandardMaterial({ map: rugTexture(), roughness: 1 }));
  rug.material.userData.decal = true;
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(L.x0 + 3.25, 0.005, s.z);
  group.add(rug);

  // ---- front windows, blinds drawn
  for (const x of [L.x0 + 1.9, L.x0 + 5.1]) {
    B.box(m.frame, x, 1.45, L.z1 - 0.025, 1.7, 1.6, 0.05);
    const g = tiledPlane(1.56, 1.46, 0.5);
    g.rotateY(Math.PI);
    g.translate(x, 1.45, L.z1 - 0.052);
    B.add(m.blinds, g);
  }

  // ---- popcorn machine in the corner, turned toward the room
  const pm = L.popcorn;
  const pmM = new THREE.Matrix4().makeRotationY(Math.atan2(-1, -1)).setPosition(pm.x, 0, pm.z);
  popcornMachine(B, m, mat, pmM, group);

  // ---- floor lamp: the room's one light
  const lp = L.lamp;
  B.add(m.dark, new THREE.CylinderGeometry(0.16, 0.17, 0.03, 16).translate(lp.x, 0.015, lp.z));
  B.box(mat.chrome, lp.x, 0.76, lp.z, 0.028, 1.46, 0.028);
  B.add(m.shade, new THREE.CylinderGeometry(0.16, 0.23, 0.3, 16, 1, true).translate(lp.x, 1.56, lp.z));
  const light = new THREE.PointLight(0xffc58a, 4.5, 9, 1.5);
  light.position.set(lp.x, 1.5, lp.z - 0.1);
  scene.add(light);

  return { screen, show };
}

// ------------------------------------------------------------------ furniture

/** A three-seat sofa in local space (length along x, front toward +z), placed by `mm`. */
function sofa(B, m, mm, len, depth) {
  const arm = 0.18;
  const backD = 0.22;
  const feetH = 0.07;
  const baseH = 0.3;
  const seatY = feetH + baseH;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.boxAt(m.woodDark, mm, sx * (len / 2 - 0.08), feetH / 2, sz * (depth / 2 - 0.08), 0.06, feetH, 0.06);
  B.boxAt(m.fabric, mm, 0, feetH + baseH / 2, 0, len, baseH, depth);
  B.boxAt(m.fabric, mm, 0, seatY + 0.28, -depth / 2 + backD / 2, len, 0.56, backD);
  for (const sx of [-1, 1]) B.boxAt(m.fabric, mm, sx * (len / 2 - arm / 2), feetH + 0.29, 0.01, arm, 0.58, depth + 0.02);
  const inner = len - 2 * arm;
  const cw = inner / 3;
  for (let i = 0; i < 3; i++) {
    const cx = -inner / 2 + cw * (i + 0.5);
    B.boxAt(m.cushion, mm, cx, seatY + 0.07, (backD + 0.12) / 2, cw - 0.025, 0.14, depth - backD - 0.16);
    B.boxAt(m.cushion, mm, cx, seatY + 0.35, -depth / 2 + backD + 0.07, cw - 0.03, 0.42, 0.14);
  }
  // a throw pillow in each corner, leaning back
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (const sx of [-1, 1]) {
    q.setFromEuler(e.set(-0.3, 0, sx * 0.22));
    const local = new THREE.Matrix4().compose(new THREE.Vector3(sx * (inner / 2 - 0.22), seatY + 0.33, -depth / 2 + backD + 0.2), q, new THREE.Vector3(1, 1, 1));
    B.boxAt(m.pillow, mm.clone().multiply(local), 0, 0, 0, 0.36, 0.36, 0.11);
  }
}

/** Low table in front of the couches, with a bucket of popcorn, a tape and the remote. */
function coffeeTable(B, m, T) {
  const h = 0.42;
  B.box(m.wood, T.x, h - 0.02, T.z, T.w, 0.04, T.len);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box(m.woodDark, T.x + sx * (T.w / 2 - 0.05), (h - 0.04) / 2, T.z + sz * (T.len / 2 - 0.05), 0.045, h - 0.04, 0.045);
  B.box(m.woodDark, T.x, 0.12, T.z, T.w - 0.06, 0.02, T.len - 0.06);
  // popcorn bucket, heaped
  const bz = T.z - 0.25;
  B.add(m.bucket, new THREE.CylinderGeometry(0.078, 0.056, 0.17, 14).translate(T.x, h + 0.085, bz));
  const r = rng(808);
  for (let i = 0; i < 14; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * 0.06;
    B.add(m.popcorn, mergeVertices(new THREE.IcosahedronGeometry(0.02 + r() * 0.008)).translate(T.x + Math.cos(a) * d, h + 0.175 + (0.06 - d) * 0.5 + r() * 0.01, bz + Math.sin(a) * d));
  }
  // a rental tape and the remote
  const tape = new THREE.Matrix4().makeRotationY(0.35).setPosition(T.x - 0.04, h, T.z + 0.18);
  B.boxAt(m.dark, tape, 0, 0.0125, 0, 0.105, 0.025, 0.19);
  B.box(m.dark, T.x + 0.13, h + 0.011, T.z + 0.34, 0.05, 0.022, 0.16);
}

/** A cinema-style popcorn cart, front toward local +z, placed by `mm`. */
function popcornMachine(B, m, mat, mm, group) {
  const w = 0.56;
  const d = 0.46;
  const baseH = 0.78;
  const caseH = 0.56;
  B.boxAt(m.dark, mm, 0, 0.04, 0, w - 0.04, 0.08, d - 0.04);
  B.boxAt(m.red, mm, 0, 0.08 + (baseH - 0.08) / 2, 0, w, baseH - 0.08, d);
  // glass case: corner posts, roof, glass, popcorn heaped inside
  const y0 = baseH;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.boxAt(m.red, mm, sx * (w / 2 - 0.02), y0 + caseH / 2, sz * (d / 2 - 0.02), 0.04, caseH, 0.04);
  B.boxAt(m.red, mm, 0, y0 + caseH + 0.04, 0, w + 0.04, 0.08, d + 0.04);
  B.boxAt(mat.chrome, mm, 0, y0 + caseH - 0.1, 0, 0.16, 0.1, 0.16); // the kettle
  B.boxAt(m.popcorn, mm, 0, y0 + 0.09, 0, w - 0.08, 0.18, d - 0.08);
  B.boxAt(mat.glass, mm, 0, y0 + caseH / 2, 0, w - 0.05, caseH - 0.02, d - 0.05);
  // the sign on the front
  const sign = new THREE.Mesh(tiledPlane(w - 0.06, 0.2, 0.5), new THREE.MeshBasicMaterial({ map: panelTexture(['POPCORN'], { w: 512, h: 192, bg: '#c8202e', fg: '#ffd23f', font: FONT.bungee, border: '#ffffff' }), toneMapped: false }));
  sign.material.userData.decal = true;
  sign.position.set(0, 0.5, d / 2 + 0.003);
  sign.applyMatrix4(mm);
  group.add(sign);
}

/** Additive light cone from the lens to the screen's corners, bright at the lens. */
function projectorBeam(lens, s) {
  const k = 0.98;
  const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => new THREE.Vector3(s.x - 0.02, s.y + (b * s.h * k) / 2, s.z + (a * s.w * k) / 2));
  const pos = [];
  const col = [];
  for (let i = 0; i < 4; i++) {
    for (const p of [lens, c[i], c[(i + 1) % 4]]) pos.push(p.x, p.y, p.z);
    col.push(0.05, 0.056, 0.075, 0.006, 0.007, 0.01, 0.006, 0.007, 0.01);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const beam = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  }));
  beam.name = 'projector-beam';
  beam.renderOrder = 3;
  return beam;
}

// ------------------------------------------------------------------ the pre-show

const SW = 512;
const SH = 288;

/** The screen's slideshow: one tape's art every few seconds, like a cinema's pre-show. */
class PreShow {
  constructor(catalog) {
    this.catalog = catalog;
    this.canvas = makeCanvas(SW, SH);
    this.ctx = this.canvas.getContext('2d');
    this.texture = toTexture(this.canvas, { mipmaps: false });
    this.order = shuffle(catalog.videos, rng(2024));
    this.index = 0;
    this.time = 0;
    this._paint();
  }

  get video() {
    return this.order[this.index % Math.max(1, this.order.length)];
  }

  _paint() {
    const ctx = this.ctx;
    const v = this.video;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, SW, SH);
    this.painted = v;
    this.hadThumb = false;
    if (!v) return;
    const t = getThumb(v);
    if (t) {
      const { img, crop } = t;
      const k = Math.max(SW / crop.sw, SH / crop.sh);
      ctx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, (SW - crop.sw * k) / 2, (SH - crop.sh * k) / 2, crop.sw * k, crop.sh * k);
      this.hadThumb = true;
    } else {
      drawArt(ctx, 0, 0, SW, SH, hash(v.id), this.catalog.aisleById.get(v.aisle)?.color);
    }
    // a projector's soft edges, and a caption bar
    const g = ctx.createRadialGradient(SW / 2, SH / 2, SH * 0.35, SW / 2, SH / 2, SW * 0.62);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,.5)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SW, SH);
    ctx.fillStyle = 'rgba(8,10,30,.75)';
    ctx.fillRect(0, SH - 58, SW, 58);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = BRAND.yellow;
    ctx.font = `19px ${FONT.bebas}`;
    ctx.fillText('COMING ATTRACTIONS', 16, SH - 42);
    ctx.fillStyle = '#fff';
    ctx.font = `27px ${FONT.bebas}`;
    ctx.fillText(v.title, 16, SH - 19, SW - 32);
    this.texture.needsUpdate = true;
  }

  update(dt) {
    this.time += dt;
    if (this.time > 9) {
      this.time = 0;
      this.index++;
      this._paint();
    } else if (!this.hadThumb && this.painted && getThumb(this.painted)) {
      this._paint(); // its thumbnail just arrived
    }
  }
}

// ------------------------------------------------------------------ textures

/** Red velvet folds. One texture = 50cm across (four folds). */
function curtainTexture() {
  const c = makeCanvas(128, 8);
  const ctx = c.getContext('2d');
  for (let x = 0; x < 128; x++) {
    const k = 0.5 + 0.5 * Math.sin((x / 128) * Math.PI * 4) ** 2;
    ctx.fillStyle = `rgb(${Math.round(160 * k)},${Math.round(16 * k)},${Math.round(34 * k)})`;
    ctx.fillRect(x, 0, 1, 8);
  }
  const t = toTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Venetian blinds, drawn, with a little night showing through the gaps. */
function blindsTexture() {
  const c = makeCanvas(256, 256);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#141a34';
  ctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 16) {
    const g = ctx.createLinearGradient(0, y, 0, y + 14);
    g.addColorStop(0, '#efe6d2');
    g.addColorStop(1, '#a9a08e');
    ctx.fillStyle = g;
    ctx.fillRect(0, y + 1, 256, 13);
  }
  ctx.fillStyle = '#d8cfbc'; // the cords
  for (const x of [64, 192]) ctx.fillRect(x, 0, 3, 256);
  return toTexture(c);
}

/** Red and white striped popcorn bucket. */
function bucketTexture() {
  const c = makeCanvas(128, 32);
  const ctx = c.getContext('2d');
  for (let i = 0; i < 16; i++) {
    ctx.fillStyle = i % 2 ? '#f6f2ea' : '#d11f2f';
    ctx.fillRect(i * 8, 0, 8, 32);
  }
  return toTexture(c);
}

/** A loud early-90s area rug: teal field, confetti shapes, magenta and yellow border. */
function rugTexture() {
  const S = 512;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0f4650';
  ctx.fillRect(0, 0, S, S);
  const r = rng(321);
  const colors = [BRAND.magenta, BRAND.yellow, BRAND.cyan, '#8a5cff'];
  for (let i = 0; i < 90; i++) {
    ctx.save();
    ctx.translate(40 + r() * (S - 80), 40 + r() * (S - 80));
    ctx.rotate(r() * Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle = colors[Math.floor(r() * colors.length)];
    ctx.lineWidth = 5;
    const k = Math.floor(r() * 3);
    if (k === 0) {
      ctx.beginPath();
      ctx.moveTo(0, -12);
      ctx.lineTo(11, 9);
      ctx.lineTo(-11, 9);
      ctx.fill();
    } else if (k === 1) {
      ctx.beginPath();
      ctx.moveTo(-16, 0);
      ctx.bezierCurveTo(-8, -12, 0, 12, 8, 0);
      ctx.bezierCurveTo(12, -6, 16, -4, 18, 0);
      ctx.stroke();
    } else {
      ctx.fillRect(-6, -6, 12, 12);
    }
    ctx.restore();
  }
  ctx.lineWidth = 18;
  ctx.strokeStyle = BRAND.magenta;
  ctx.strokeRect(9, 9, S - 18, S - 18);
  ctx.lineWidth = 6;
  ctx.strokeStyle = BRAND.yellow;
  ctx.strokeRect(26, 26, S - 52, S - 52);
  return toTexture(c);
}

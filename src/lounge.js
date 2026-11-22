// The lounge: two couches facing a projection screen, across the front third of the wing
// off the sales floor, and a VCR in the cabinet under the screen. Bring a tape here and
// put it in, and it plays on the screen (theater.js lays the YouTube player over it).
// With no tape in, a "VHS" logo bounces round the screen like an idle DVD player's.
import * as THREE from 'three';
import { DIM, BRAND } from './config.js';
import { FONT } from './fonts.js';
import { toTexture, panelTexture } from './textures.js';
import { makeCanvas, rng } from './util.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Batcher, tiledPlane } from './fixtures.js';

export function buildLounge({ group, B, mat, plan, animated, scene }) {
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
    vcr: paint(0x1e1e24),
    slot: paint(0x060608),
    silver: paint(0x9a9aa6),
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
  const projection = new ProjectorScreen(s);
  animated.push(projection);
  group.add(projection.group);
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

  // ---- the media cabinet under the screen, and the VCR on it
  mediaCabinet(B, m, mat, L.cabinet);
  const vcr = buildVcr(B, m, mat, L.vcr, group);
  animated.push(vcr);

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

  return { screen: projection.mesh, projection, vcr };
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

/** The low cabinet under the screen: a door either side, an open shelf of tapes between. */
function mediaCabinet(B, m, mat, c) {
  const front = c.x + c.d / 2;
  const top = 0.03;
  const plinth = 0.06;
  const bodyH = c.h - top - plinth;
  const doorW = 0.43;
  B.box(m.wood, c.x, c.h - top / 2, c.z, c.d + 0.02, top, c.w + 0.02);
  B.box(m.woodDark, c.x - 0.015, plinth / 2, c.z, c.d - 0.03, plinth, c.w - 0.03);
  for (const side of [-1, 1]) {
    const dz = c.z + side * (c.w / 2 - doorW / 2);
    B.box(m.woodDark, c.x, plinth + bodyH / 2, dz, c.d, bodyH, doorW);
    B.box(m.wood, front + 0.008, plinth + bodyH / 2, dz, 0.016, bodyH - 0.03, doorW - 0.03); // the door
    B.box(mat.chrome, front + 0.022, plinth + bodyH * 0.62, dz - side * (doorW / 2 - 0.06), 0.014, 0.07, 0.014);
  }
  // the open middle: a back, a shelf, a few tapes standing spine-out
  const inner = c.w - 2 * doorW;
  B.box(m.woodDark, c.x - c.d / 2 + 0.01, plinth + bodyH / 2, c.z, 0.02, bodyH, inner);
  B.box(m.wood, c.x, plinth + 0.01, c.z, c.d, 0.02, inner);
  B.box(m.wood, c.x, plinth + bodyH * 0.55, c.z, c.d, 0.02, inner);
  const r = rng(1987);
  for (let i = 0; i < 7; i++) {
    const h = 0.19 + r() * 0.005;
    B.box(i % 3 === 1 ? m.red : m.dark, c.x + 0.05, plinth + 0.02 + h / 2, c.z - inner / 2 + 0.04 + i * 0.033, 0.105, h, 0.026);
  }
}

/** A front-loading VCR, front toward +x, with its clock display. */
function buildVcr(B, m, mat, v, group) {
  const front = v.x + v.d / 2;
  B.box(m.vcr, v.x, v.y + v.h / 2 + 0.006, v.z, v.d, v.h - 0.012, v.w);
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) B.box(m.dark, v.x + sx * (v.d / 2 - 0.04), v.y + 0.003, v.z + sz * (v.w / 2 - 0.04), 0.03, 0.006, 0.03);
  B.box(m.silver, front + 0.002, v.y + v.h - 0.02, v.z, 0.004, 0.026, v.w - 0.01); // a brushed strip along the top
  B.box(m.slot, front + 0.003, v.y + 0.047, v.z - 0.075, 0.006, 0.032, 0.2); // the tape flap
  B.box(m.dark, front + 0.004, v.y + 0.047, v.z - 0.075, 0.004, 0.003, 0.17);
  for (let i = 0; i < 5; i++) B.box(mat.chrome, front + 0.004, v.y + 0.022, v.z + 0.06 + i * 0.026, 0.006, 0.01, 0.018);
  return new VcrDisplay(group, front + 0.0035, v.y + 0.052, v.z + 0.115);
}

const DW = 192;
const DH = 48;

/** The VCR's glowing display: a blinking 12:00 while it's empty, PLAY and a counter while it plays. */
class VcrDisplay {
  constructor(group, x, y, z) {
    this.canvas = makeCanvas(DW, DH);
    this.ctx = this.canvas.getContext('2d');
    this.texture = toTexture(this.canvas, { mipmaps: false });
    const material = new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false });
    material.userData.decal = true;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.025), material);
    mesh.position.set(x, y, z);
    mesh.rotation.y = Math.PI / 2;
    group.add(mesh);
    this.playing = false;
    this.time = 0;
    this.text = null;
    this._paint();
  }

  /** `true` once a tape is playing; the counter starts from zero. */
  setPlaying(on) {
    this.playing = on;
    this.time = 0;
    this._paint();
  }

  update(dt) {
    this.time += dt;
    this._paint();
  }

  _paint() {
    let text;
    if (this.playing) {
      const t = Math.floor(this.time);
      text = `${Math.floor(t / 3600)}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    } else {
      text = this.time % 1 < 0.5 ? '12:00' : ''; // nobody ever set the clock
    }
    if (text === this.text) return;
    this.text = text;
    const ctx = this.ctx;
    ctx.fillStyle = '#071311';
    ctx.fillRect(0, 0, DW, DH);
    ctx.fillStyle = '#5dffd9';
    ctx.shadowColor = '#5dffd9';
    ctx.shadowBlur = 8;
    ctx.font = `44px ${FONT.vt}`;
    ctx.textBaseline = 'middle';
    if (this.playing) {
      playTriangle(ctx, 14, DH / 2, 22);
      ctx.textAlign = 'right';
      ctx.fillText(text, DW - 10, DH / 2 + 2);
    } else {
      ctx.textAlign = 'center';
      ctx.fillText(text, DW / 2, DH / 2 + 2);
    }
    ctx.shadowBlur = 0;
    this.texture.needsUpdate = true;
  }
}

/**
 * Additive light cone from the lens to the screen's corners. It's brightest at the lens
 * and fades out fast (a ring of vertices a third of the way along), so the haze doesn't
 * wash out the picture.
 */
function projectorBeam(lens, s) {
  const k = 0.98;
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => new THREE.Vector3(s.x - 0.02, s.y + (b * s.h * k) / 2, s.z + (a * s.w * k) / 2));
  const ring = corners.map((c) => lens.clone().lerp(c, 0.32));
  const LENS = [0.05, 0.056, 0.075];
  const RING = [0.009, 0.01, 0.013];
  const END = [0.0012, 0.0013, 0.0018];
  const pos = [];
  const col = [];
  const tri = (...pts) => {
    for (const [p, c] of pts) {
      pos.push(p.x, p.y, p.z);
      col.push(...c);
    }
  };
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    tri([lens, LENS], [ring[i], RING], [ring[j], RING]);
    tri([ring[i], RING], [corners[i], END], [corners[j], END]);
    tri([ring[i], RING], [corners[j], END], [ring[j], RING]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  // Additive, but it leaves the canvas's alpha alone: where the screen is clear for the
  // video (ProjectorScreen 'video'), the beam in front mustn't fill it back in.
  const beam = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  }));
  beam.name = 'projector-beam';
  beam.renderOrder = 3;
  return beam;
}

// ------------------------------------------------------------------ the screen

const LOGO_COLORS = ['#ff2e88', '#2ee6ff', '#ffc61a', '#7dff5a', '#ff7a1a', '#a98bff', '#ffffff'];

/**
 * What the projector shows:
 * - 'logo' (no tape in): a made-up "VHS" logo drifting round the screen, changing colour
 *   each time it bounces off an edge;
 * - 'loading': the VCR's blue screen with PLAY in the corner, while the tape starts;
 * - 'video': clear. The canvas is see-through there, and theater.js puts the YouTube
 *   player behind it, so anything standing in front of the screen still hides the video.
 */
export class ProjectorScreen {
  constructor(s) {
    this.s = s;
    this.group = new THREE.Group();
    this.materials = {
      logo: new THREE.MeshBasicMaterial({ color: 0x0b0b12, toneMapped: false }),
      loading: new THREE.MeshBasicMaterial({ map: blueScreenTexture(), toneMapped: false }),
      // writes "nothing here" (alpha 0) into the canvas, so the page behind shows through
      video: new THREE.ShaderMaterial({
        vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'void main() { gl_FragColor = vec4(0.0); }',
        blending: THREE.NoBlending,
      }),
    };
    this.mesh = new THREE.Mesh(tiledPlane(s.w, s.h, 0.5), this.materials.logo);
    this.mesh.name = 'lounge-screen';
    this.mesh.position.set(s.x - 0.025, s.y, s.z);
    this.mesh.rotation.y = Math.PI / 2; // faces +x, into the room
    this.group.add(this.mesh);

    const tex = logoTexture();
    this.logoMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
    this.logoMat.userData.decal = true;
    this.lw = 0.62;
    this.lh = this.lw / 2;
    this.logo = new THREE.Mesh(new THREE.PlaneGeometry(this.lw, this.lh), this.logoMat);
    this.logo.rotation.y = Math.PI / 2;
    this.group.add(this.logo);
    const r = rng(1996);
    this.u = (r() - 0.5) * (s.w - this.lw); // across the screen, and up it
    this.v = (r() - 0.5) * (s.h - this.lh);
    this.du = 0.36;
    this.dv = 0.24;
    this.color = 0;
    this.bounces = 0;
    this._recolor();
    this.setMode('logo');
  }

  setMode(mode) {
    this.mode = mode;
    this.mesh.material = this.materials[mode];
    this.logo.visible = mode === 'logo';
    this._place();
  }

  update(dt) {
    if (this.mode !== 'logo') return;
    const mu = (this.s.w - this.lw) / 2;
    const mv = (this.s.h - this.lh) / 2;
    this.u += this.du * dt;
    this.v += this.dv * dt;
    let bounced = false;
    if (Math.abs(this.u) > mu) {
      this.u = Math.sign(this.u) * (2 * mu - Math.abs(this.u));
      this.du = -this.du;
      bounced = true;
    }
    if (Math.abs(this.v) > mv) {
      this.v = Math.sign(this.v) * (2 * mv - Math.abs(this.v));
      this.dv = -this.dv;
      bounced = true;
    }
    if (bounced) {
      this.bounces++;
      this._recolor();
    }
    this._place();
  }

  _recolor() {
    this.color = (this.color + 1) % LOGO_COLORS.length;
    this.logoMat.color.set(LOGO_COLORS[this.color]);
  }

  _place() {
    // (facing the screen, its right-hand side is toward -z)
    this.logo.position.set(this.s.x - 0.022, this.s.y + this.v, this.s.z - this.u);
  }
}

/** The bouncing logo: a slanted VHS wordmark over a cassette, white (tinted per bounce). */
function logoTexture() {
  const W = 512;
  const H = 256;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.save();
  ctx.translate(W / 2, 150);
  ctx.transform(1, 0, -0.24, 1, 0, 0); // italic
  ctx.font = `150px ${FONT.bungee}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const k = 440 / ctx.measureText('VHS').width;
  ctx.scale(k, 1);
  ctx.fillText('VHS', 0, 0);
  ctx.restore();
  // the cassette: a flat pill with two reels and the window between
  const cy = 206;
  ctx.beginPath();
  ctx.roundRect(W / 2 - 190, cy - 30, 380, 60, 30);
  ctx.fill();
  ctx.globalCompositeOperation = 'destination-out';
  for (const dx of [-92, 92]) {
    ctx.beginPath();
    ctx.arc(W / 2 + dx, cy, 19, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillRect(W / 2 - 48, cy - 9, 96, 18);
  ctx.globalCompositeOperation = 'source-over';
  for (const dx of [-92, 92]) {
    ctx.beginPath();
    ctx.arc(W / 2 + dx, cy, 7, 0, Math.PI * 2);
    ctx.fill();
  }
  return toTexture(c);
}

/** ▶, `h` tall, its left edge at x and centred on y (fonts don't all have the glyph). */
function playTriangle(ctx, x, y, h) {
  ctx.beginPath();
  ctx.moveTo(x, y - h / 2);
  ctx.lineTo(x + h * 0.85, y);
  ctx.lineTo(x, y + h / 2);
  ctx.closePath();
  ctx.fill();
}

/** A VCR's blue screen with PLAY in the corner. */
function blueScreenTexture() {
  const W = 512;
  const H = 288;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1f2fd8';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  ctx.font = `46px ${FONT.vt}`;
  ctx.textBaseline = 'top';
  ctx.fillText('PLAY', 30, 24);
  playTriangle(ctx, 40 + ctx.measureText('PLAY').width, 46, 30);
  ctx.textAlign = 'right';
  ctx.fillText('SP', W - 30, H - 64);
  return toTexture(c, { mipmaps: false });
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

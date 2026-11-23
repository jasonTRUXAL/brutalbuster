// Seasonal decorations, put up by the calendar (calendar.js): Halloween in October, the
// winter holidays from December to Twelfth Night, Valentine's in early February. Each is
// a few batched props plus one instanced string of twinkling lights, so a season costs
// a handful of draw calls. All of it sits round the shop front and the counter, where
// it's in nobody's way.
import * as THREE from 'three';
import { DIM, BRAND } from './config.js';
import { Batcher, signPlane } from './fixtures.js';
import { panelTexture, toTexture } from './textures.js';
import { FONT } from './fonts.js';
import { makeCanvas, rng } from './util.js';

const THEMES = {
  halloween: { lights: ['#ff7a00', '#9b4dff', '#ff7a00', '#3ddc84'], banner: ['SPOOKY SEASON', 'HORROR RENTALS · 2 FOR 1'], bannerBg: '#2a0f3d', bannerBorder: '#ff7a00' },
  winter: { lights: ['#ff3b3b', '#3ddc84', '#ffc61a', '#29b6f6', '#fff4e2'], banner: ['HAPPY HOLIDAYS', 'FROM ALL OF US AT THE STORE'], bannerBg: '#0f3d24', bannerBorder: '#ff3b3b' },
  valentine: { lights: ['#ff4fa3', '#ff1744', '#ffd1e3'], banner: ['BE MINE', 'ROM-COM NIGHT · RENT 2, CUDDLE 1'], bannerBg: '#5a0f2e', bannerBorder: '#ffd1e3' },
};

/**
 * Put up `season`'s decorations under `root`, adding any footprints to `colliders`.
 * Returns { group, update(dt, t) } (the twinkle, falling snow), or null for no season.
 */
export function buildSeason({ root, plan, season, colliders, dropBox }) {
  const theme = THEMES[season];
  if (!theme) return null;
  const { W, D, door, counter } = plan;
  const z = D / 2;
  const group = new THREE.Group();
  group.name = `season-${season}`;
  root.add(group);
  const B = new Batcher();
  const paintMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
  const paint = (c) => Batcher.paint(paintMat, c);
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const glow = (c) => Batcher.paint(glowMat, c);
  const animated = [];

  // ---- a string of lights along the top of the shop window, and along the counter
  const bulbs = [];
  const head = 2.58;
  for (let x = -W / 2 + 0.2; x < W / 2 - 0.2; x += 0.22) bulbs.push([x, head - 0.06 * Math.abs(Math.sin(x * 2.2)), z - 0.1]);
  const front = counter.x - counter.depth / 2;
  for (let zz = counter.zMin + 0.1; zz < counter.zMax - 0.1; zz += 0.2) bulbs.push([front - 0.04, 1.0 - 0.04 * Math.abs(Math.sin(zz * 3)), zz]);
  const lights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshBasicMaterial({ toneMapped: false }), bulbs.length);
  const m = new THREE.Matrix4();
  const colors = theme.lights.map((c) => new THREE.Color(c));
  const dim = colors.map((c) => c.clone().multiplyScalar(0.25));
  bulbs.forEach(([x, y, zz], i) => {
    lights.setMatrixAt(i, m.makeTranslation(x, y, zz));
    lights.setColorAt(i, colors[i % colors.length]);
  });
  group.add(lights);
  // the wire, a thin dark line through the bulbs
  for (let i = 1; i < bulbs.length; i++) {
    const [ax, ay, az] = bulbs[i - 1];
    const [bx, by, bz] = bulbs[i];
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    if (len > 0.4) continue; // (the gap between the window run and the counter run)
    const g = new THREE.CylinderGeometry(0.004, 0.004, len, 4);
    g.applyMatrix4(new THREE.Matrix4().lookAt(new THREE.Vector3(ax, ay, az), new THREE.Vector3(bx, by, bz), new THREE.Object3D().up).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
    g.translate((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    B.add(paint('#1a1a1a'), g);
  }
  // twinkle: now and then a few bulbs dim for a moment
  const r = rng(hashSeason(season));
  let next = 0;
  const off = new Set();
  animated.push({
    update(dt, t) {
      if (t < next) return;
      next = t + 0.25;
      for (const i of off) lights.setColorAt(i, colors[i % colors.length]);
      off.clear();
      for (let k = 0; k < Math.ceil(bulbs.length / 14); k++) {
        const i = Math.floor(r() * bulbs.length);
        off.add(i);
        lights.setColorAt(i, dim[i % dim.length]);
      }
      lights.instanceColor.needsUpdate = true;
    },
  });

  // ---- a banner over the way in
  const banner = panelTexture(theme.banner, { w: 1024, h: 256, bg: theme.bannerBg, border: theme.bannerBorder, font: FONT.bebas });
  group.add(signPlane(banner, 2.2, 0.55, door.x, 2.95, z - 0.12, Math.PI));

  // ---- the season's own props (the shop front's floor is taken: Lucky Hit, the drop box,
  // the security gates and the gacha row; so they go on the counter and the drop box)
  const counterTop = 1.04;
  if (season === 'halloween') {
    const pumpkin = (x, y, zz, s, facing = Math.PI) => {
      const body = new THREE.SphereGeometry(s, 14, 10);
      body.scale(1, 0.78, 1);
      body.translate(x, y + s * 0.78, zz);
      B.add(paint('#ff7a00'), body);
      B.box(paint('#3b6b1e'), x, y + s * 1.62, zz, s * 0.18, s * 0.3, s * 0.18);
      faces.push([x + Math.sin(facing) * s * 0.99, y + s * 0.8, zz + Math.cos(facing) * s * 0.99, s, facing]); // (on the side it faces)
    };
    const faces = [];
    // one in the nook between the drop box and the doors' left gate, one on the drop box
    const nookX = (dropBox.x + 0.3 + door.x - door.width / 2 - 0.19) / 2;
    pumpkin(nookX, 0, z - 0.3, 0.13);
    pumpkin(dropBox.x - 0.12, 1.1, z - 0.42, 0.11);
    pumpkin(front + 0.12, counterTop, counter.zMax - 1.4, 0.12, -Math.PI / 2);
    pumpkin(front + 0.14, counterTop, counter.zMax - 1.7, 0.09, -Math.PI / 2);
    // carved faces, glowing (one texture, one draw call)
    const faceTex = toTexture(jackCanvas());
    const faceMat = new THREE.MeshBasicMaterial({ map: faceTex, transparent: true, toneMapped: false, depthWrite: false });
    faceMat.userData.decal = true;
    for (const [x, y, zz, s, facing] of faces) {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(s * 1.2, s * 0.9), faceMat);
      f.position.set(x, y, zz);
      f.rotation.y = facing;
      group.add(f);
    }
    colliders.push({ minX: nookX - 0.15, maxX: nookX + 0.15, minZ: z - 0.45, maxZ: z });
    // cobwebs in the top corners of the shop front
    const web = new THREE.MeshBasicMaterial({ map: toTexture(webCanvas()), transparent: true, depthWrite: false, side: THREE.DoubleSide });
    web.userData.decal = true;
    for (const [x, rot] of [[-W / 2 + 0.45, Math.PI + 0.6], [W / 2 - 0.45, Math.PI - 0.6]]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), web);
      p.position.set(x, DIM.CEILING - 0.45, z - 0.35);
      p.rotation.y = rot;
      group.add(p);
    }
  } else if (season === 'winter') {
    // a tabletop tree on the counter's far end (by the wall), with lights and a star
    const tr = rng(77);
    const k = 0.55; // (a full tree's proportions, scaled down)
    const tx = (counter.x + W / 2) / 2;
    const tz = counter.zMin + 0.3;
    B.box(paint('#a5262b'), tx, counterTop + 0.09 * k, tz, 0.5 * k, 0.18 * k, 0.5 * k); // the pot (wrapped)
    for (const [y, rad, h] of [[0.3, 0.62, 0.8], [0.8, 0.5, 0.7], [1.25, 0.36, 0.6], [1.6, 0.22, 0.5]]) {
      const cone = new THREE.ConeGeometry(rad * k, h * k, 12);
      cone.translate(tx, counterTop + (y + h / 2) * k, tz);
      B.add(paint('#1f6b3a'), cone);
      for (let i = 0; i < Math.round(rad * 14); i++) {
        const a = tr() * Math.PI * 2;
        const yy = y + 0.1 + tr() * (h * 0.6);
        const rr = (rad * (1 - (yy - y) / h) + 0.01) * k;
        const ball = new THREE.SphereGeometry(0.022, 8, 6);
        ball.translate(tx + Math.cos(a) * rr, counterTop + yy * k, tz + Math.sin(a) * rr);
        B.add(glow(theme.lights[i % theme.lights.length]), ball);
      }
    }
    const star = new THREE.SphereGeometry(0.07, 4, 2); // (a diamond: an octahedron, indexed like the rest of the batch)
    star.translate(tx, counterTop + 2.16 * k, tz);
    B.add(glow('#ffe27a'), star);
    // a wreath on each door leaf
    for (const dx of [-door.width / 4, door.width / 4]) {
      const wreath = new THREE.TorusGeometry(0.17, 0.05, 8, 18);
      wreath.translate(door.x + dx, 1.55, z - 0.06);
      B.add(paint('#1f6b3a'), wreath);
      B.box(paint('#d6262b'), door.x + dx, 1.4, z - 0.09, 0.1, 0.07, 0.03);
    }
    // snow falling in the lot outside
    animated.push(snow(group, W, z));
  } else if (season === 'valentine') {
    // paper hearts hanging in the shop window on threads
    const heartMat = new THREE.MeshBasicMaterial({ map: toTexture(heartCanvas()), transparent: true, side: THREE.DoubleSide, toneMapped: false });
    heartMat.userData.decal = true;
    const hr = rng(214);
    const hearts = [];
    for (let x = -W / 2 + 0.6; x < W / 2 - 0.6; x += 0.7) {
      if (Math.abs(x - door.x) < door.width / 2 + 0.2) continue;
      const y = 1.6 + hr() * 0.7;
      const s = 0.16 + hr() * 0.12;
      const h = new THREE.Mesh(new THREE.PlaneGeometry(s, s), heartMat);
      h.position.set(x, y, z - 0.12);
      group.add(h);
      hearts.push({ h, phase: hr() * 6 });
      B.box(paint('#dddddd'), x, (y + s / 2 + head) / 2, z - 0.12, 0.004, head - y - s / 2, 0.004);
    }
    animated.push({
      update(dt, t) {
        for (const { h, phase } of hearts) h.rotation.y = Math.PI + Math.sin(t * 0.8 + phase) * 0.5;
      },
    });
    // a bunch of heart balloons tied to the counter, at its front end
    for (let k = 0; k < 3; k++) {
      const bx = front + 0.16 + k * 0.1;
      const by = 1.75 + k * 0.15;
      const bz = counter.zMax - 0.35 - k * 0.12;
      const b = new THREE.SphereGeometry(0.13, 12, 10);
      b.scale(1, 1.15, 0.8);
      b.translate(bx, by, bz);
      B.add(paint(['#ff1744', '#ff4fa3', '#ffd1e3'][k]), b);
      B.box(paint('#dddddd'), bx, (by + counterTop) / 2, bz, 0.004, by - counterTop, 0.004);
    }
  }

  B.build(group);
  return {
    group,
    update(dt, t) {
      for (const a of animated) a.update(dt, t);
    },
  };
}

function hashSeason(s) {
  return [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
}

/** Falling snow over the parking lot (a few hundred points, wrapped round as they land). */
function snow(group, W, z) {
  const N = 500;
  const pos = new Float32Array(N * 3);
  const r = rng(1225);
  for (let i = 0; i < N; i++) pos.set([(r() - 0.5) * (W + 10), r() * 7, z + 0.6 + r() * 14], i * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.05, transparent: true, opacity: 0.85, depthWrite: false }));
  pts.frustumCulled = false;
  group.add(pts);
  return {
    update(dt, t) {
      for (let i = 0; i < N; i++) {
        let y = pos[i * 3 + 1] - dt * (0.5 + (i % 7) * 0.06);
        if (y < 0) y += 7;
        pos[i * 3 + 1] = y;
        pos[i * 3] += Math.sin(t * 0.7 + i) * dt * 0.08;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

function jackCanvas() {
  const c = makeCanvas(128, 96);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffd34d';
  ctx.shadowColor = '#ffae00';
  ctx.shadowBlur = 8;
  const tri = (pts) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
  };
  tri([[26, 40], [50, 40], [38, 18]]);
  tri([[78, 40], [102, 40], [90, 18]]);
  ctx.beginPath();
  ctx.moveTo(20, 56);
  for (let i = 0; i <= 8; i++) ctx.lineTo(20 + i * 11, i % 2 ? 66 : 56);
  ctx.lineTo(108, 70);
  ctx.quadraticCurveTo(64, 96, 20, 70);
  ctx.closePath();
  ctx.fill();
  return c;
}

function webCanvas() {
  const c = makeCanvas(256, 256);
  const ctx = c.getContext('2d');
  ctx.strokeStyle = 'rgba(235,235,245,.55)';
  ctx.lineWidth = 1.5;
  for (let k = 0; k <= 6; k++) {
    const a = (k / 6) * (Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * 256, Math.sin(a) * 256);
    ctx.stroke();
  }
  for (let ring = 1; ring <= 6; ring++) {
    const rr = ring * 38;
    ctx.beginPath();
    for (let k = 0; k <= 6; k++) {
      const a = (k / 6) * (Math.PI / 2);
      const x = Math.cos(a) * rr * 0.9;
      const y = Math.sin(a) * rr * 0.9;
      if (k) ctx.quadraticCurveTo(Math.cos(a - Math.PI / 24) * rr * 0.86, Math.sin(a - Math.PI / 24) * rr * 0.86, x, y);
      else ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  return c;
}

function heartCanvas() {
  const c = makeCanvas(128, 128);
  const ctx = c.getContext('2d');
  ctx.fillStyle = BRAND.magenta;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(64, 112);
  ctx.bezierCurveTo(8, 72, 6, 30, 36, 22);
  ctx.bezierCurveTo(52, 18, 62, 30, 64, 40);
  ctx.bezierCurveTo(66, 30, 76, 18, 92, 22);
  ctx.bezierCurveTo(122, 30, 120, 72, 64, 112);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  return c;
}

// Outside the front window: the sidewalk, a parking lot (two rows of striped stalls with
// wheel stops, a drive aisle, a planted island with lot lights), a four-lane street with
// traffic, and a strip mall and a gas station across it, under the painted sky.
// Nearly everything is one unlit, vertex-coloured material with its shading baked in
// (`shaded()`), batched into a single draw call (road paint is a second, flagged as a
// decal); the glowing bits (lamps, shop windows) are another, and the light pools one more. Cars are two instanced meshes, bodies and
// lights, and the traffic is a pure function of time, so it's the same on every load.
// setPhase() follows the sky: dim at night with the lamps and headlights on, bright by day.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { asphaltTexture, nightSkyTexture, toTexture } from './textures.js';
import { Batcher, tiledPlane } from './fixtures.js';
import { makeCanvas, rng, hash } from './util.js';

// Distances out from the front wall (metres, +z), and the ground's level below the
// store's floor (the curb).
const LOT = {
  walk: 2.4, // the store's sidewalk
  stall: 5.5, // stall depth
  stallW: 2.7,
  aisle: 7, // the drive aisle between the rows
  island: 2, // planted island between the lot and the street
  streetWalk: 2,
  lanes: 4,
  laneW: 3,
  ground: -0.15,
  span: 34, // stalls run this far either side of the middle
};
const ROW1 = LOT.walk;
const AISLE = ROW1 + LOT.stall;
const ROW2 = AISLE + LOT.aisle;
const ISLAND = ROW2 + LOT.stall;
const WALK2 = ISLAND + LOT.island;
const STREET = WALK2 + LOT.streetWalk;
const STREET_END = STREET + LOT.lanes * LOT.laneW;
const ACROSS = STREET_END + LOT.streetWalk;
const DRIVEWAY = { x0: 6, x1: 13 }; // the way out of the lot, through the island

// How each part looks at each time of day: the unlit paint's brightness, the glow's,
// whether the lamps and headlights are on, and the asphalt (a lit material, like before).
const PHASES = {
  dawn: { paint: 0.55, glow: 0.7, lights: 0.55, pools: 0.4, lot: 0x9a90b0, lotGlow: 0x2a2430 },
  day: { paint: 1.0, glow: 0.38, lights: 0, pools: 0, lot: 0xc8c8d4, lotGlow: 0x6a6a72 },
  dusk: { paint: 0.42, glow: 0.9, lights: 0.85, pools: 0.7, lot: 0x9a8aa8, lotGlow: 0x221a28 },
  night: { paint: 0.24, glow: 1.0, lights: 1.0, pools: 1.0, lot: 0x8888aa, lotGlow: 0x000000 },
};

const LIGHT_DIR = new THREE.Vector3(0.35, 1, -0.55).normalize(); // (from above, and the store's side)

/**
 * A box with its shading baked into vertex colours (unlit materials don't shade):
 * faces turned toward LIGHT_DIR are brighter.
 */
function shaded(color, sx, sy, sz, x, y, z, rotY = 0) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  if (rotY) g.rotateY(rotY);
  g.translate(x, y, z);
  return bake(g, color);
}

function bake(g, color) {
  const c = new THREE.Color(color);
  const n = g.attributes.normal;
  const out = new Float32Array(n.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < n.count; i++) {
    v.fromBufferAttribute(n, i);
    const k = 0.55 + 0.45 * Math.max(0, v.dot(LIGHT_DIR));
    out.set([c.r * k, c.g * k, c.b * k], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(out, 3));
  return g;
}

/** A flat quad at height `y`, coloured: road paint and grass (facing up), lamp lenses (`down`). */
function flat(color, w, d, x, y, z, down = false) {
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(down ? Math.PI / 2 : -Math.PI / 2);
  g.translate(x, y, z);
  return bake(g, color);
}

/** An upright quad facing the store (-z): shop windows, signs. */
function facing(color, w, h, x, y, z) {
  const g = new THREE.PlaneGeometry(w, h);
  g.rotateY(Math.PI);
  g.translate(x, y, z);
  return bake(g, color);
}

/** A soft round glow (white in the middle, clear at the edge), for lights and their pools. */
function glowTexture() {
  const S = 128;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return toTexture(c);
}

// ------------------------------------------------------------- cars

const CAR = { L: 4.4, W: 1.8 };
const CAR_COLORS = [0x7a1f2b, 0x1f6f78, 0xe8e4da, 0xa8acb4, 0x1d2a5c, 0x23523a, 0xc9b48a, 0x16161a, 0xb0262a, 0x5a3d7a];

/** A boxy early-90s sedan, nose to +x, wheels on y = 0. White parts take the instance's colour. */
function carGeometry() {
  const BODY = 0xffffff;
  const parts = [
    shaded(BODY, CAR.L, 0.55, CAR.W, 0, 0.55, 0), // body
    shaded(0x0b0d12, 2.3, 0.48, CAR.W - 0.14, -0.25, 1.06, 0), // glasshouse
    shaded(BODY, 2.0, 0.07, CAR.W - 0.18, -0.3, 1.33, 0), // roof
    shaded(0x2a2a2e, 0.12, 0.2, CAR.W, CAR.L / 2, 0.38, 0), // bumpers
    shaded(0x2a2a2e, 0.12, 0.2, CAR.W, -CAR.L / 2, 0.38, 0),
  ];
  for (const x of [-1.35, 1.35]) for (const z of [-0.8, 0.8]) parts.push(shaded(0x0a0a0c, 0.62, 0.62, 0.24, x, 0.31, z));
  return mergeGeometries(parts.map((g) => g.toNonIndexed()));
}

/**
 * A car's lights, for an additive glow material: head- and tail-light dots on both
 * sides (they're seen side-on from the store), a glare off each end, and the
 * headlights' pool on the road ahead.
 */
function carLightsGeometry() {
  const parts = [];
  const quad = (color, w, h, x, y, z, flatOnGround = false) => {
    const g = new THREE.PlaneGeometry(w, h);
    if (flatOnGround) g.rotateX(-Math.PI / 2);
    g.translate(x, y, z);
    parts.push(bake(g, color));
  };
  const head = 0xfff1d0;
  const tail = 0xff2a22;
  for (const z of [-CAR.W / 2 - 0.01, CAR.W / 2 + 0.01]) {
    quad(head, 0.5, 0.32, CAR.L / 2 - 0.05, 0.66, z);
    quad(tail, 0.42, 0.28, -CAR.L / 2 + 0.05, 0.68, z);
  }
  quad(0x9a8a6a, 2.6, 1.3, CAR.L / 2 + 0.8, 0.66, 0); // glare ahead
  quad(0x7a1410, 1.6, 0.9, -CAR.L / 2 - 0.4, 0.68, 0); // and behind
  quad(0x4a4232, 7, 3.2, CAR.L / 2 + 3.6, 0.03, 0, true); // light on the road
  return mergeGeometries(parts);
}

// ------------------------------------------------------------- the view

/**
 * Builds it all in front of the store (z = D/2 is the front wall) into `root`.
 * Returns { phase, setPhase(phase), update(dt, t) }.
 */
export function buildOutside(root, plan) {
  const { W, D, door } = plan;
  const z0 = D / 2;
  const group = new THREE.Group();
  group.name = 'outside';
  root.add(group);
  const B = new Batcher();
  const paint = new THREE.MeshBasicMaterial({ vertexColors: true });
  // paint on the ground (lines, arrows, the island's grass): the same, but a decal, so PS1
  // Mode's wobble doesn't sink it into the asphalt
  const marks = new THREE.MeshBasicMaterial({ vertexColors: true });
  marks.userData.decal = true;
  const glow = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const glowMap = glowTexture();
  const pools = new THREE.MeshBasicMaterial({ map: glowMap, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  pools.userData.decal = true; // (just above the ground: see ps1.js)
  const g = LOT.ground;
  const Z = (d) => z0 + d; // a distance out from the front wall, as world z

  // ---- the ground: asphalt from the curb to the strip mall (lit by the store's lights, so
  // the lot by the windows is brighter at night)
  const asphalt = asphaltTexture();
  asphalt.wrapS = asphalt.wrapT = THREE.RepeatWrapping;
  const groundW = 170;
  const groundD = 62;
  asphalt.repeat.set(groundW / 3, groundD / 3);
  const lotMat = new THREE.MeshStandardMaterial({ map: asphalt, roughness: 1, color: 0x8888aa, emissiveMap: asphalt, emissive: 0x000000 });
  const ground = new THREE.Mesh(tiledPlane(groundW, groundD, 3), lotMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, g, Z(ROW1 + groundD / 2));
  group.add(ground);

  // ---- the store's sidewalk, its curb, and the street's two sidewalks
  const CONCRETE = 0x8d8c88;
  const walk = (x0, x1, d0, d1) => B.add(paint, shaded(CONCRETE, x1 - x0, -g + 0.004, d1 - d0, (x0 + x1) / 2, (g + 0.004) / 2, Z((d0 + d1) / 2)));
  walk(-W / 2 - 8, W / 2 + 8, 0, LOT.walk);
  for (const [d0, d1] of [[WALK2, STREET], [STREET_END, ACROSS]]) {
    // (a gap where the lot's driveway meets the street)
    walk(-90, DRIVEWAY.x0, d0, d1);
    walk(DRIVEWAY.x1, 90, d0, d1);
  }
  B.add(paint, shaded(0xb9b39a, W + 16, 0.02, 0.18, 0, 0.002, Z(LOT.walk - 0.09))); // the curb's painted edge

  // ---- stalls: white lines, a concrete wheel stop at the head of each, and parked cars
  const LINE = 0xe6e2d6;
  const parked = [];
  const r = rng(hash('parking-lot'));
  const stallXs = [];
  for (let x = -LOT.span; x <= LOT.span + 1e-6; x += LOT.stallW) stallXs.push(x);
  for (const [d0, head] of [[ROW1, ROW1], [ROW2, ROW2 + LOT.stall]]) {
    const mid = d0 + LOT.stall / 2;
    for (const x of stallXs) B.add(marks, flat(LINE, 0.12, LOT.stall, x, g + 0.006, Z(mid)));
    for (let i = 0; i < stallXs.length - 1; i++) {
      const x = stallXs[i] + LOT.stallW / 2;
      const stop = head === ROW1 ? head + 0.55 : head - 0.55;
      B.add(paint, shaded(0xa7a49c, 1.7, 0.12, 0.2, x, g + 0.06, Z(stop)));
      // about a third of the stalls are taken (none right in front of the door: the view out)
      if (Math.abs(x - door.x) > 4 && r() < 0.36) {
        const into = head === ROW1 ? -1 : 1; // nose toward the wheel stop
        parked.push({ x, z: Z(stop - into * (0.35 + CAR.L / 2)), yaw: into < 0 ? Math.PI / 2 : -Math.PI / 2, color: CAR_COLORS[Math.floor(r() * CAR_COLORS.length)] });
      }
    }
  }
  // arrows down the drive aisle, pointing the way out (the driveway)
  const exit = (DRIVEWAY.x0 + DRIVEWAY.x1) / 2;
  for (const x of [-22, -6, 24]) {
    const way = x < exit ? 1 : -1;
    B.add(marks, flat(LINE, 2.2, 0.16, x, g + 0.006, Z(AISLE + LOT.aisle / 2)));
    for (const s of [-1, 1]) {
      const h = flat(LINE, 0.9, 0.16, 0, 0, 0);
      h.rotateY(s * way * 0.6);
      h.translate(x + way * 0.85, g + 0.006, Z(AISLE + LOT.aisle / 2) + s * 0.26);
      B.add(marks, h);
    }
  }

  // ---- the island: a curb with grass and shrubs, and the lot's lights on it
  for (const [x0, x1] of [[-90, DRIVEWAY.x0], [DRIVEWAY.x1, 90]]) {
    B.add(paint, shaded(0xa09d95, x1 - x0, -g + 0.02, LOT.island, (x0 + x1) / 2, (g + 0.02) / 2, Z(ISLAND + LOT.island / 2)));
    B.add(marks, flat(0x2f4a2a, x1 - x0 - 0.3, LOT.island - 0.3, (x0 + x1) / 2, 0.025, Z(ISLAND + LOT.island / 2)));
  }
  const rs = rng(hash('shrubs'));
  for (let x = -60; x < 60; x += 3.2 + rs() * 2) {
    if (x > DRIVEWAY.x0 - 1 && x < DRIVEWAY.x1 + 1) continue;
    const s = 0.7 + rs() * 0.5;
    B.add(paint, shaded(0x1f3a22, s * 1.3, s * 0.8, s, x, s * 0.4, Z(ISLAND + LOT.island / 2 + (rs() - 0.5) * 0.6)));
  }
  const lamp = (x, d, height, armTo) => {
    // pole, arm out over the lot or road, and a shoebox head that glows underneath
    B.add(paint, shaded(0x3a3c44, 0.18, height, 0.18, x, height / 2, Z(d)));
    const len = Math.abs(armTo);
    B.add(paint, shaded(0x3a3c44, 0.1, 0.1, len, x, height - 0.1, Z(d + armTo / 2)));
    B.add(paint, shaded(0x2c2e34, 0.55, 0.22, 0.9, x, height - 0.15, Z(d + armTo)));
    B.add(glow, flat(0xffe0a8, 0.45, 0.75, x, height - 0.27, Z(d + armTo), true));
    B.add(glow, facing(0xffe0a8, 0.45, 0.06, x, height - 0.26, Z(d + armTo) - 0.46)); // its lit edge, seen from the store
    const pool = tiledPlane(height * 1.9, height * 1.9, 2);
    pool.rotateX(-Math.PI / 2);
    pool.translate(x, g + 0.02, Z(d + armTo));
    B.add(pools, bake(pool, 0x6a5232));
  };
  for (const x of [-18, 0, 18]) lamp(x, ISLAND + LOT.island / 2, 7.5, -4.5);
  for (const x of [-40, -16, 16, 40]) lamp(x, STREET_END + 1, 8, -3);

  // ---- the street: a double yellow line down the middle, dashed lanes, white edges
  const centre = STREET + (LOT.lanes * LOT.laneW) / 2;
  for (const dz of [-0.12, 0.12]) B.add(marks, flat(0xe0b020, 180, 0.1, 0, g + 0.006, Z(centre + dz)));
  for (const d of [STREET + 0.35, STREET_END - 0.35]) B.add(marks, flat(LINE, 180, 0.12, 0, g + 0.006, Z(d)));
  for (const lane of [1, 3]) {
    for (let x = -88; x < 88; x += 9) B.add(marks, flat(LINE, 3, 0.12, x, g + 0.006, Z(STREET + lane * LOT.laneW)));
  }

  // ---- across the street: a strip mall (lit shop windows and signs) and a gas station
  const back = ACROSS + 9;
  const mall = { x0: -46, x1: -2, depth: 12, h: 5 };
  const mid = (mall.x0 + mall.x1) / 2;
  B.add(paint, shaded(0x5a4a44, mall.x1 - mall.x0, mall.h, mall.depth, mid, mall.h / 2, Z(back + mall.depth / 2)));
  B.add(paint, shaded(0x3d3436, mall.x1 - mall.x0 + 0.6, 0.9, 1.2, mid, mall.h - 0.2, Z(back - 0.3))); // fascia
  B.add(paint, shaded(0x6a6460, mall.x1 - mall.x0, 0.15, 2.2, mid, 3.1, Z(back - 1.1))); // canopy over the walk
  const SIGNS = [0xff3b6b, 0x2ee6ff, 0xffc61a, 0x3ddc84, 0xff7a00, 0xb388ff];
  const WINDOWS = [0xffe2a8, 0xcfe8ff, 0xfff0d0, 0xffd6a0];
  const units = 6;
  const uw = (mall.x1 - mall.x0) / units;
  for (let i = 0; i < units; i++) {
    const x = mall.x0 + uw * (i + 0.5);
    const lit = i !== 4; // (one unit's empty)
    B.add(lit ? glow : paint, facing(lit ? WINDOWS[i % WINDOWS.length] : 0x1a1a22, uw - 1.6, 2.4, x, 1.4, Z(back) - 0.02));
    B.add(paint, shaded(0x222228, 0.9, 2.2, 0.06, x + uw / 2 - 0.7, 1.1, Z(back) - 0.03)); // door
    if (lit) B.add(glow, facing(SIGNS[i % SIGNS.length], uw * 0.62, 0.5, x, mall.h - 0.2, Z(back - 0.9) - 0.01));
  }
  // gas station: a canopy on four posts, pumps, a kiosk, and a tall price sign
  const gas = { x: 22, d: ACROSS + 6 };
  for (const dx of [-5, 5]) for (const dd of [-2.5, 2.5]) B.add(paint, shaded(0xd8d8dc, 0.35, 4.6, 0.35, gas.x + dx, 2.3, Z(gas.d + dd)));
  B.add(paint, shaded(0xeeeeee, 15, 0.8, 8, gas.x, 5, Z(gas.d)));
  B.add(glow, facing(0xff3030, 15, 0.3, gas.x, 4.95, Z(gas.d - 4) - 0.02)); // its red band
  B.add(glow, flat(0xfffbe8, 13.5, 6.5, gas.x, 4.58, Z(gas.d), true)); // its lit underside
  for (const dx of [-5, 5]) B.add(paint, shaded(0x5b6a8a, 0.8, 1.6, 0.5, gas.x + dx, 0.8, Z(gas.d)));
  B.add(paint, shaded(0x8a8478, 7, 3.4, 5, gas.x + 2, 1.7, Z(gas.d + 8)));
  B.add(glow, facing(0xfff0c8, 4, 1.6, gas.x + 2, 1.4, Z(gas.d + 5.5) - 0.02));
  B.add(paint, shaded(0x3a3c44, 0.3, 7, 0.3, gas.x + 9, 3.5, Z(ACROSS + 0.8)));
  B.add(glow, facing(0x2050ff, 2.6, 1.6, gas.x + 9, 7.4, Z(ACROSS + 0.8) - 0.18));
  B.add(glow, facing(0xffffff, 2.4, 1.4, gas.x + 9, 5.9, Z(ACROSS + 0.8) - 0.18));
  // and parked cars over there too
  for (const [x, dd] of [[-40, ACROSS + 4], [-31, ACROSS + 4], [-18, ACROSS + 4.5], [-9, ACROSS + 4], [19, gas.d]]) {
    parked.push({ x, z: Z(dd), yaw: x === 19 ? 0 : -Math.PI / 2, color: CAR_COLORS[Math.floor(r() * CAR_COLORS.length)] });
  }

  B.build(group);

  // ---- the sky, far behind everything (the skyline's painted along its bottom)
  const skyMat = new THREE.MeshBasicMaterial({ map: nightSkyTexture(), fog: false });
  const sky = new THREE.Mesh(tiledPlane(260, 80, 8), skyMat);
  sky.position.set(0, 38, Z(groundD + 4));
  sky.rotation.y = Math.PI;
  group.add(sky);

  // ---- cars: the parked ones, then the traffic (a lane each way per side of the line)
  const lanes = [0, 1, 2, 3].map((i) => ({ d: STREET + LOT.laneW * (i + 0.5), dir: i < 2 ? -1 : 1, speed: [11.5, 14, 13, 10.5][i] }));
  const PER_LANE = 3;
  const RANGE = 90; // cars loop round over x in [-RANGE, RANGE]
  const traffic = [];
  const rt = rng(hash('traffic'));
  for (const lane of lanes) {
    for (let k = 0; k < PER_LANE; k++) {
      traffic.push({ lane, x0: (k / PER_LANE) * 2 * RANGE + (rt() - 0.5) * 18, color: CAR_COLORS[Math.floor(rt() * CAR_COLORS.length)] });
    }
  }
  const bodyMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const bodies = new THREE.InstancedMesh(carGeometry(), bodyMat, parked.length + traffic.length);
  bodies.name = 'cars';
  const lightMat = new THREE.MeshBasicMaterial({ map: glowMap, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  const lights = new THREE.InstancedMesh(carLightsGeometry(), lightMat, traffic.length);
  lights.name = 'car-lights';
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const UP = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();
  const col = new THREE.Color();
  parked.forEach((c, i) => {
    bodies.setMatrixAt(i, m.compose(p.set(c.x, g, c.z), q.setFromAxisAngle(UP, c.yaw), one));
    bodies.setColorAt(i, col.setHex(c.color));
  });
  traffic.forEach((c, i) => bodies.setColorAt(parked.length + i, col.setHex(c.color)));
  const place = (t) => {
    traffic.forEach((c, i) => {
      const { lane } = c;
      const span = 2 * RANGE;
      const x = ((((c.x0 + lane.dir * lane.speed * t + RANGE) % span) + span) % span) - RANGE;
      m.compose(p.set(x, g, Z(lane.d)), q.setFromAxisAngle(UP, lane.dir > 0 ? 0 : Math.PI), one);
      bodies.setMatrixAt(parked.length + i, m);
      lights.setMatrixAt(i, m);
    });
    bodies.instanceMatrix.needsUpdate = true;
    lights.instanceMatrix.needsUpdate = true;
  };
  place(0);
  bodies.instanceColor.needsUpdate = true;
  // (they move about a big area: never cull them by their first bounds)
  bodies.frustumCulled = lights.frustumCulled = false;
  group.add(bodies, lights);

  const skies = new Map([['night', skyMat.map]]);
  const outside = {
    phase: null,
    /** 'dawn' | 'day' | 'dusk' | 'night': the sky, how lit things are, lamps and headlights. */
    setPhase(phase) {
      const P = PHASES[phase];
      if (!P || phase === outside.phase) return;
      outside.phase = phase;
      if (!skies.has(phase)) skies.set(phase, nightSkyTexture(phase));
      skyMat.map = skies.get(phase);
      lotMat.color.setHex(P.lot);
      lotMat.emissive.setHex(P.lotGlow);
      paint.color.setScalar(P.paint);
      marks.color.setScalar(P.paint);
      bodyMat.color.setScalar(P.paint * 1.1);
      glow.color.setScalar(P.glow);
      lightMat.color.setScalar(P.lights);
      lights.visible = P.lights > 0;
      pools.color.setScalar(P.pools);
      pools.visible = P.pools > 0;
    },
    update(dt, t) {
      place(t);
    },
  };
  return outside;
}

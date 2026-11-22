// Building blocks shared by the sales floor (store.js) and the rooms off it (rooms.js):
// geometry batching, PS1-safe tiled planes, walls with openings, floors, signs,
// shelving runs and posters.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DIM } from './config.js';
import { bayStart, rowTopY, wallSpans } from './layout.js';
import { headerSignTexture, toTexture } from './textures.js';
import { coverCanvas, coverData } from './covers.js';

// ------------------------------------------------------------- geometry batching

// PS1 Mode maps textures without perspective correction, which warps big polygons
// badly (real PS1 games split them up for the same reason). Textured surfaces are
// built from tiles about this size; it changes nothing in the normal look.
const TILE = 0.75;
const tiles = (size, tile = TILE) => Math.max(1, Math.ceil(size / tile - 1e-6));

/** A plane split into roughly `tile`-sized squares. */
export function tiledPlane(w, h, tile = TILE) {
  return new THREE.PlaneGeometry(w, h, tiles(w, tile), tiles(h, tile));
}

/** Rescale a BoxGeometry's UVs so textures tile at `scale` repeats per metre. */
function scaleBoxUV(g, sx, sy, sz, scale) {
  const uv = g.attributes.uv;
  const { widthSegments: ws, heightSegments: hs, depthSegments: ds } = g.parameters;
  // faces are stored in order +x, -x, +y, -y, +z, -z, each a (segments + 1)² vertex grid
  const dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  const counts = [(ds + 1) * (hs + 1), (ds + 1) * (hs + 1), (ws + 1) * (ds + 1), (ws + 1) * (ds + 1), (ws + 1) * (hs + 1), (ws + 1) * (hs + 1)];
  let i = 0;
  for (let f = 0; f < 6; f++) for (let k = 0; k < counts[f]; k++, i++) {
    uv.setXY(i, uv.getX(i) * dims[f][0] * scale, uv.getY(i) * dims[f][1] * scale);
  }
}

/** A box with per-metre UVs; textured ones are split into tiles (see TILE). */
function boxGeo(mat, sx, sy, sz, uvScale) {
  const g = mat.map ? new THREE.BoxGeometry(sx, sy, sz, tiles(sx), tiles(sy), tiles(sz)) : new THREE.BoxGeometry(sx, sy, sz);
  scaleBoxUV(g, sx, sy, sz, uvScale);
  return g;
}

/** Collects static geometry per material and merges it: one draw call per material. */
export class Batcher {
  constructor() {
    this.lists = new Map();
  }
  add(mat, geo) {
    if (mat.isPaint) {
      // one colour of a vertex-coloured material: shares that material's draw call
      const { r, g, b } = mat.color;
      const n = geo.attributes.position.count;
      const colors = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) colors.set([r, g, b], i * 3);
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      mat = mat.material;
    }
    if (!this.lists.has(mat)) this.lists.set(mat, []);
    this.lists.get(mat).push(geo);
  }
  /**
   * A colour to build with in place of a material. Everything added in any paint of
   * `material` (which must have vertexColors on) is merged into one draw call.
   */
  static paint(material, color) {
    return { isPaint: true, material, color: new THREE.Color(color) };
  }
  box(mat, x, y, z, sx, sy, sz, uvScale = 1) {
    const g = boxGeo(mat, sx, sy, sz, uvScale);
    g.translate(x, y, z);
    this.add(mat, g);
  }
  /** Box positioned in a prop's local space, then moved into the world by matrix `m`. */
  boxAt(mat, m, x, y, z, sx, sy, sz, uvScale = 1) {
    const g = boxGeo(mat, sx, sy, sz, uvScale);
    g.translate(x, y, z);
    g.applyMatrix4(m);
    this.add(mat, g);
  }
  /** Any geometry (built in a prop's local space) moved into the world by matrix `m`. */
  geomAt(mat, geo, m) {
    geo.applyMatrix4(m);
    this.add(mat, geo);
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

export const facingY = (n) => Math.atan2(n.x, n.z);

export function signPlane(tex, w, h, x, y, z, rotY, { additive = false, doubleSided = false } = {}) {
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: additive,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: !additive,
    side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    toneMapped: false,
  });
  mat.userData.decal = true; // a few mm in front of its backing board (see ps1.js)
  const m = new THREE.Mesh(tiledPlane(w, h, 0.5), mat);
  m.position.set(x, y, z);
  m.rotation.y = rotY;
  return m;
}

// ------------------------------------------------------------- walls, floors, ceilings

/**
 * Batch a wall (see wall() in layout.js) as tiled quads facing into its room. Over an
 * opening only the part above it is built. The wall texture spans the full ceiling
 * height (v = y / CEILING), so its stripe lines up on every wall and in every room.
 */
export function batchWall(B, mat, w) {
  if (!w.draw) return;
  const rot = w.axis === 'x' ? (w.side > 0 ? Math.PI / 2 : -Math.PI / 2) : w.side > 0 ? 0 : Math.PI;
  for (const sp of wallSpans(w)) {
    const y0 = sp.solid ? 0 : sp.h;
    const y1 = w.height;
    const len = sp.to - sp.from;
    if (y1 - y0 < 1e-3 || len < 1e-3) continue;
    const g = tiledPlane(len, y1 - y0);
    g.rotateY(rot);
    const mid = (sp.from + sp.to) / 2;
    if (w.axis === 'x') g.translate(w.at, (y0 + y1) / 2, mid);
    else g.translate(mid, (y0 + y1) / 2, w.at);
    const pos = g.attributes.position;
    const uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, w.axis === 'x' ? pos.getZ(i) : pos.getX(i), pos.getY(i) / DIM.CEILING);
    B.add(mat, g);
  }
}

/**
 * A horizontal rectangle at height y, facing up (floors) or down (ceilings). UVs are
 * world metres × `perMetre`, so neighbouring rooms can share one texture and its
 * pattern runs on across doorways.
 */
export function flatGeometry(x0, x1, z0, z1, y, perMetre, { down = false } = {}) {
  const g = tiledPlane(x1 - x0, z1 - z0);
  g.rotateX(down ? Math.PI / 2 : -Math.PI / 2);
  g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) * perMetre, -pos.getZ(i) * perMetre);
  return g;
}

// ------------------------------------------------------------- shelving

export function buildGondolaShell(B, mat, g) {
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

export function buildFace(root, B, mat, face) {
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
  // The lip stands 4mm proud of the shelf front and covers the board's edge, so no two
  // faces share a plane (coplanar faces flicker as the camera moves).
  const [lx, lz] = at(L / 2, 0.004);
  for (let row = 0; row < DIM.SHELF_COUNT; row++) {
    const y = rowTopY(row);
    B.aligned(mat.shelf, sx, y - 0.01, sz, L, 0.02, DIM.SHELF_DEPTH, t);
    B.aligned(mat.lip, lx, y + 0.0065, lz, L, 0.057, 0.016, t);
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
    const [fx, fz] = at(mid, signBack - 0.003);
    const tex = headerSignTexture(r.section.label, r.section.color, segLen, DIM.SIGN_H);
    root.add(signPlane(tex, segLen, DIM.SIGN_H, fx, y, fz, facingY(n)));
  }
}

// ------------------------------------------------------------- posters

/**
 * A framed poster of a tape's box art. `trackArt` repaints it once the tape's thumbnail
 * has loaded (posters are painted before thumbnails arrive).
 */
export function addPoster(root, video, catalog, trackArt, x, y, z, rotY, w, h) {
  const d = coverData(video, catalog.aisleById.get(video.aisle), catalog.store);
  const tex = toTexture(coverCanvas(d, 256));
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
  trackArt(video.id, m.material, 256);
  m.material.userData.thumbnail = true; // sharp in PS1 Mode
  m.position.set(x, y, z);
  m.rotation.y = rotY;
  m.userData.videoId = video.id;
  root.add(m);
  const frame = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.05, h + 0.05), new THREE.MeshStandardMaterial({ color: 0x0c0c12 }));
  frame.position.set(x, y, z);
  frame.rotation.y = rotY;
  frame.translateZ(-0.004);
  root.add(frame);
  return m;
}

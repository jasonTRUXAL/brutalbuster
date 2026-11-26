// All shelved tapes, drawn as instanced meshes: one for the plastic cases and one
// per atlas page for the cover sleeves. Streams' box sets (BoxSetShelves) the same way,
// with their own art pages.
import * as THREE from 'three';
import { DIM } from './config.js';
import { slotMatrix, BOX_SPAN } from './layout.js';
import { hash, makeCanvas } from './util.js';
import { toTexture } from './textures.js';
import { boxSetData, drawBoxSet } from './covers.js';

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const CASE = new THREE.Box3(new THREE.Vector3(-DIM.CASE_W / 2, -DIM.CASE_H / 2, -DIM.CASE_D / 2), new THREE.Vector3(DIM.CASE_W / 2, DIM.CASE_H / 2, DIM.CASE_D / 2));
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _ray = new THREE.Ray();
const _hit = new THREE.Vector3();
const WHITE = new THREE.Color(1, 1, 1);
const GLOW = new THREE.Color(1.6, 1.55, 1.4);

function atlasMaterial(map) {
  const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.36, metalness: 0.0 });
  mat.userData.thumbnail = true; // box art: stays sharp in PS1 Mode
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aUvRect;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n\tvMapUv = uv * aUvRect.zw + aUvRect.xy;\n#endif');
  };
  return mat;
}

export class TapeShelves {
  constructor(slots, atlas) {
    this.slots = slots;
    this.atlas = atlas;
    this.group = new THREE.Group();
    // where each tape sits; a box set's tapes are inside the box (never drawn, never aimed
    // at: the box is), but a tape picked out of one starts from there
    this.home = slots.map((s) => slotMatrix(s, new THREE.Matrix4(), s.box ? 0 : hash(s.video.id) + s.col * 31 + s.row * 7));
    this.boxed = slots.map((s) => Boolean(s.box));
    this.base = this.home.map((m, i) => (this.boxed[i] ? HIDDEN : m));
    this.inverse = this.home.map((m) => m.clone().invert());
    this.centers = this.home.map((m) => new THREE.Vector3().setFromMatrixPosition(m));
    this.hovered = -1;
    this.hoverMatrix = new THREE.Matrix4();
    this.hoverInverse = new THREE.Matrix4();

    // Cases
    const bodyGeo = new THREE.BoxGeometry(DIM.CASE_W, DIM.CASE_H, DIM.CASE_D);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x17171d, roughness: 0.5, metalness: 0.05 });
    this.bodies = new THREE.InstancedMesh(bodyGeo, bodyMat, slots.length);
    this.bodies.name = 'tape-bodies';
    slots.forEach((_, i) => this.bodies.setMatrixAt(i, this.base[i]));
    this.bodies.instanceMatrix.needsUpdate = true;
    this.bodies.computeBoundingSphere();
    this.group.add(this.bodies);

    // Sleeves, grouped by atlas page
    const coverGeo = new THREE.PlaneGeometry(DIM.CASE_W * 0.965, DIM.CASE_H * 0.975);
    coverGeo.translate(0, 0, DIM.CASE_D / 2 + 0.0012);
    const byPage = new Map();
    slots.forEach((s, i) => {
      const page = atlas.cell(s.video.id).page;
      if (!byPage.has(page)) byPage.set(page, []);
      byPage.get(page).push(i);
    });
    this.coverRef = new Array(slots.length); // slot -> { mesh, index }
    this.covers = [];
    for (const [page, indices] of byPage) {
      const geo = coverGeo.clone();
      const uv = new THREE.InstancedBufferAttribute(new Float32Array(indices.length * 4), 4);
      geo.setAttribute('aUvRect', uv);
      const mesh = new THREE.InstancedMesh(geo, atlasMaterial(atlas.texture(page)), indices.length);
      mesh.name = `tape-covers-${page}`;
      const rooms = new Set(indices.map((i) => slots[i].face.room));
      mesh.userData.room = rooms.size === 1 ? [...rooms][0] : null; // (lets RoomCulling skip it)
      indices.forEach((slotIdx, k) => {
        mesh.setMatrixAt(k, this.base[slotIdx]);
        mesh.setColorAt(k, WHITE);
        uv.setXYZW(k, ...atlas.cell(this.slots[slotIdx].video.id).uvRect);
        this.coverRef[slotIdx] = { mesh, index: k };
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.covers.push(mesh);
      this.group.add(mesh);
    }
  }

  _set(i, m) {
    this.bodies.setMatrixAt(i, m);
    this.bodies.instanceMatrix.needsUpdate = true;
    const ref = this.coverRef[i];
    ref.mesh.setMatrixAt(ref.index, m);
    ref.mesh.instanceMatrix.needsUpdate = true;
  }

  _tint(i, color) {
    const ref = this.coverRef[i];
    ref.mesh.setColorAt(ref.index, color);
    ref.mesh.instanceColor.needsUpdate = true;
  }

  /** Slide the aimed-at tape forward a touch and brighten it. */
  setHover(i) {
    if (i === this.hovered) return;
    if (this.hovered >= 0 && !this.hiddenSet?.has(this.hovered)) {
      this._set(this.hovered, this.base[this.hovered]);
      this._tint(this.hovered, WHITE);
    }
    this.hovered = i;
    if (i >= 0) {
      const n = this.slots[i].face.n;
      this.hoverMatrix.copy(this.base[i]).premultiply(_m.makeTranslation(_v.set(n.x * 0.06, 0.01, n.z * 0.06)));
      this.hoverInverse.copy(this.hoverMatrix).invert();
      this._set(i, this.hoverMatrix);
      this._tint(i, GLOW);
    }
  }

  hide(i) {
    (this.hiddenSet ??= new Set()).add(i);
    this._set(i, HIDDEN);
  }

  show(i) {
    this.hiddenSet?.delete(i);
    this._set(i, this.base[i]);
    this._tint(i, WHITE);
    if (this.hovered === i) this.hovered = -1;
  }

  worldMatrix(i) {
    return this.home[i];
  }

  /**
   * The nearest tape `ray` hits within `far` metres, as { index, distance, point }, or
   * null. Only the tapes within reach are tried, so it costs the same however many the
   * store holds (three.js's own instanced raycast tries every one: milliseconds a frame).
   */
  hit(ray, far) {
    const reach2 = (far + DIM.CASE_H) ** 2;
    let best = null;
    for (let i = 0; i < this.centers.length; i++) {
      if (this.boxed[i] || this.centers[i].distanceToSquared(ray.origin) > reach2 || this.hiddenSet?.has(i)) continue;
      // The hovered tape is slid forward: it counts where it's drawn and where it was.
      // Testing only the slid position made the very edge of a tape flicker on and off
      // (hit, slide out, miss, slide back, hit...).
      let p = castBox(ray, this.inverse[i], this.base[i], CASE);
      if (i === this.hovered) p = nearer(ray, p, castBox(ray, this.hoverInverse, this.hoverMatrix, CASE));
      if (!p) continue;
      const distance = p.distanceTo(ray.origin);
      if (distance <= far && (!best || distance < best.distance)) best = { index: i, distance, point: p };
    }
    return best;
  }
}

// ------------------------------------------------------------------ box sets

// A cardboard slipcase as wide as BOX_SPAN tapes, a little taller and deeper than one.
export const BOX = {
  W: BOX_SPAN * DIM.SLOT_PITCH - (DIM.SLOT_PITCH - DIM.CASE_W),
  H: DIM.CASE_H * 1.05,
  D: 0.075,
};
const BOX_BOUNDS = new THREE.Box3(new THREE.Vector3(-BOX.W / 2, -BOX.H / 2, -BOX.D / 2), new THREE.Vector3(BOX.W / 2, BOX.H / 2, BOX.D / 2));
// art cells: the 320×280 design grid painted at 0.8 scale, 8 × 9 to a 2048² page
const ART_W = 256;
const ART_H = 224;
const ART_PAGE = 2048;
const ART_COLS = Math.floor(ART_PAGE / ART_W);
const ART_PER_PAGE = ART_COLS * Math.floor(ART_PAGE / ART_H);

/**
 * Streams' box sets (plan.boxes): one instanced mesh for the slipcases, one per page of
 * box art. A copy of a set on the shelf shares its art. `hit()` is the aim test, like
 * TapeShelves.hit().
 */
export class BoxSetShelves {
  constructor(boxes, catalog) {
    this.boxes = boxes;
    this.catalog = catalog;
    this.group = new THREE.Group();
    this.meshes = [];
    this.hovered = -1;
    this.hoverMatrix = new THREE.Matrix4();
    this.hoverInverse = new THREE.Matrix4();
    if (!boxes.length) return;
    const lift = new THREE.Matrix4().makeTranslation(0, (BOX.H - DIM.CASE_H) / 2, -(BOX.D - DIM.CASE_D) / 2);
    this.base = boxes.map((b) => slotMatrix(b, new THREE.Matrix4()).multiply(lift));
    this.inverse = this.base.map((m) => m.clone().invert());
    this.centers = this.base.map((m) => new THREE.Vector3().setFromMatrixPosition(m));

    // one art cell per set (copies share)
    this.cells = new Map();
    this.pages = [];
    for (const b of boxes) {
      if (this.cells.has(b.boxSet.id)) continue;
      const n = this.cells.size;
      const page = Math.floor(n / ART_PER_PAGE);
      const k = n % ART_PER_PAGE;
      const x = (k % ART_COLS) * ART_W;
      const y = Math.floor(k / ART_COLS) * ART_H;
      while (this.pages.length <= page) {
        const canvas = makeCanvas(ART_PAGE, ART_PAGE);
        this.pages.push({ canvas, ctx: canvas.getContext('2d'), texture: toTexture(canvas), dirty: false });
      }
      this.cells.set(b.boxSet.id, { page, x, y, uvRect: [(x + 1) / ART_PAGE, 1 - (y + ART_H - 1) / ART_PAGE, (ART_W - 2) / ART_PAGE, (ART_H - 2) / ART_PAGE], set: b.boxSet, color: b.section.color });
    }
    for (const id of this.cells.keys()) this.paint(id);

    // slipcases: dark card, the art on the front
    const bodyGeo = new THREE.BoxGeometry(BOX.W, BOX.H, BOX.D);
    this.bodies = new THREE.InstancedMesh(bodyGeo, new THREE.MeshStandardMaterial({ color: 0x1b1430, roughness: 0.8 }), boxes.length);
    this.bodies.name = 'boxset-bodies';
    boxes.forEach((_, i) => this.bodies.setMatrixAt(i, this.base[i]));
    this.bodies.userData.room = 'streams';
    this.meshes.push(this.bodies);
    const artGeo = new THREE.PlaneGeometry(BOX.W * 0.97, BOX.H * 0.97);
    artGeo.translate(0, 0, BOX.D / 2 + 0.0012);
    this.artRef = [];
    this.pages.forEach((pg, page) => {
      const idx = boxes.map((b, i) => (this.cells.get(b.boxSet.id).page === page ? i : -1)).filter((i) => i >= 0);
      const geo = artGeo.clone();
      const uv = new THREE.InstancedBufferAttribute(new Float32Array(idx.length * 4), 4);
      geo.setAttribute('aUvRect', uv);
      const mesh = new THREE.InstancedMesh(geo, atlasMaterial(pg.texture), idx.length);
      mesh.name = `boxset-art-${page}`;
      mesh.userData.room = 'streams';
      idx.forEach((bi, k) => {
        mesh.setMatrixAt(k, this.base[bi]);
        mesh.setColorAt(k, WHITE);
        uv.setXYZW(k, ...this.cells.get(boxes[bi].boxSet.id).uvRect);
        this.artRef[bi] = { mesh, index: k };
      });
      this.meshes.push(mesh);
    });
    for (const m of this.meshes) {
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
      this.group.add(m);
    }
    // which sets each video's thumbnail shows up on
    this.setsOf = new Map();
    for (const c of this.cells.values()) for (const v of c.set.videos.slice(0, 3)) this.setsOf.set(v.id, [...(this.setsOf.get(v.id) || []), c.set.id]);
  }

  paint(id) {
    const c = this.cells.get(id);
    const pg = this.pages[c.page];
    pg.ctx.save();
    pg.ctx.translate(c.x, c.y);
    pg.ctx.beginPath();
    pg.ctx.rect(0, 0, ART_W, ART_H);
    pg.ctx.clip();
    drawBoxSet(pg.ctx, ART_W, ART_H, boxSetData(c.set, c.color, this.catalog.store));
    pg.ctx.restore();
    pg.dirty = true;
  }

  /** A video's thumbnail has loaded: repaint the box art it's part of. */
  refresh(video) {
    for (const id of this.setsOf?.get(video.id) || []) this.paint(id);
  }

  /** Upload repainted pages (throttled by the caller, like the cover atlas). */
  flush() {
    for (const pg of this.pages) {
      if (!pg.dirty) continue;
      pg.texture.needsUpdate = true;
      pg.dirty = false;
    }
  }

  _set(i, m) {
    this.bodies.setMatrixAt(i, m);
    this.bodies.instanceMatrix.needsUpdate = true;
    const ref = this.artRef[i];
    ref.mesh.setMatrixAt(ref.index, m);
    ref.mesh.instanceMatrix.needsUpdate = true;
    ref.mesh.setColorAt(ref.index, m === this.base[i] ? WHITE : GLOW);
    ref.mesh.instanceColor.needsUpdate = true;
  }

  /** Slide the aimed-at box forward a touch and brighten it. */
  setHover(i) {
    if (i === this.hovered) return;
    if (this.hovered >= 0) this._set(this.hovered, this.base[this.hovered]);
    this.hovered = i;
    if (i < 0) return;
    const n = this.boxes[i].face.n;
    this.hoverMatrix.copy(this.base[i]).premultiply(_m.makeTranslation(_v.set(n.x * 0.06, 0.01, n.z * 0.06)));
    this.hoverInverse.copy(this.hoverMatrix).invert();
    this._set(i, this.hoverMatrix);
  }

  /** The nearest box `ray` hits within `far` metres: { index, distance, point }, or null. */
  hit(ray, far) {
    if (!this.boxes.length) return null;
    const reach2 = (far + BOX.W) ** 2;
    let best = null;
    for (let i = 0; i < this.centers.length; i++) {
      if (this.centers[i].distanceToSquared(ray.origin) > reach2) continue;
      // (the hovered box counts in both places: see TapeShelves.hit)
      let p = castBox(ray, this.inverse[i], this.base[i], BOX_BOUNDS);
      if (i === this.hovered) p = nearer(ray, p, castBox(ray, this.hoverInverse, this.hoverMatrix, BOX_BOUNDS));
      if (!p) continue;
      const distance = p.distanceTo(ray.origin);
      if (distance <= far && (!best || distance < best.distance)) best = { index: i, distance, point: p };
    }
    return best;
  }
}

/** Where `ray` meets `box` placed by matrix `m` (`inv` its inverse), in world space, or null. */
function castBox(ray, inv, m, box) {
  const p = _ray.copy(ray).applyMatrix4(inv).intersectBox(box, _hit);
  return p ? p.applyMatrix4(m).clone() : null;
}

const nearer = (ray, a, b) => (!a ? b : !b ? a : a.distanceToSquared(ray.origin) <= b.distanceToSquared(ray.origin) ? a : b);

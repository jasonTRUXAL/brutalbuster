// All shelved tapes, drawn as instanced meshes: one for the plastic cases and one
// per atlas page for the cover sleeves.
import * as THREE from 'three';
import { DIM } from './config.js';
import { slotMatrix } from './layout.js';
import { hash } from './util.js';

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
    this.base = slots.map((s) => slotMatrix(s, new THREE.Matrix4(), hash(s.video.id) + s.col * 31 + s.row * 7));
    this.inverse = this.base.map((m) => m.clone().invert());
    this.centers = this.base.map((m) => new THREE.Vector3().setFromMatrixPosition(m));
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
    return this.base[i];
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
      if (this.centers[i].distanceToSquared(ray.origin) > reach2 || this.hiddenSet?.has(i)) continue;
      const hovered = i === this.hovered; // (slid forward: test where it's drawn)
      const p = _ray.copy(ray).applyMatrix4(hovered ? this.hoverInverse : this.inverse[i]).intersectBox(CASE, _hit);
      if (!p) continue;
      p.applyMatrix4(hovered ? this.hoverMatrix : this.base[i]);
      const distance = p.distanceTo(ray.origin);
      if (distance <= far && (!best || distance < best.distance)) best = { index: i, distance, point: p.clone() };
    }
    return best;
  }
}

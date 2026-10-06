// All shelved tapes, drawn as instanced meshes: one for the plastic cases and one
// per atlas page for the cover sleeves.
import * as THREE from 'three';
import { DIM } from './config.js';
import { slotMatrix } from './layout.js';
import { hash } from './util.js';

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const WHITE = new THREE.Color(1, 1, 1);
const GLOW = new THREE.Color(1.6, 1.55, 1.4);

function atlasMaterial(map) {
  const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.36, metalness: 0.0 });
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
    this.hovered = -1;

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
    coverGeo.translate(0, 0, DIM.CASE_D / 2 + 0.0007);
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
      _m.copy(this.base[i]).premultiply(new THREE.Matrix4().makeTranslation(_v.set(n.x * 0.06, 0.01, n.z * 0.06)));
      this._set(i, _m);
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

  /** Raycast helper: the case bodies are the pick target. */
  slotFromHit(hit) {
    return hit && hit.object === this.bodies ? hit.instanceId : -1;
  }
}

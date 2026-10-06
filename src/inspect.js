// Picking a tape off the shelf: the case flies from its slot into your hands,
// the store dims behind it, and you can spin it to read the back.
import * as THREE from 'three';
import { DIM } from './config.js';
import { coverData, drawCover, drawBack, drawSpine, drawPlastic } from './covers.js';
import { makeCanvas, easeInOut, clamp } from './util.js';
import { toTexture } from './textures.js';

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

function texFrom(drawFn, w, h, d) {
  const c = makeCanvas(w, h);
  drawFn(c.getContext('2d'), w, h, d);
  return toTexture(c);
}

export class Inspector {
  constructor(catalog) {
    this.catalog = catalog;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.35));
    const key = new THREE.DirectionalLight(0xfff3e0, 3.0);
    key.position.set(-0.6, 0.8, 1.2);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xff4fa3, 1.6);
    rim.position.set(1, 0.3, -0.6);
    this.scene.add(rim);
    const fill = new THREE.DirectionalLight(0x6fd8ff, 0.7);
    fill.position.set(0.8, -0.4, 0.8);
    this.scene.add(fill);

    // full-screen dimmer drawn behind the held tape
    this.dimMat = new THREE.ShaderMaterial({
      uniforms: { uAlpha: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader:
        'uniform float uAlpha; varying vec2 vUv; void main(){ float v = smoothstep(1.1, 0.2, length(vUv - vec2(0.35, 0.5))); gl_FragColor = vec4(vec3(0.02,0.01,0.05), uAlpha * mix(0.92, 0.7, v)); }',
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const dim = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.dimMat);
    dim.frustumCulled = false;
    dim.renderOrder = -1;
    this.scene.add(dim);

    this.mesh = null;
    this.slot = -1;
    this.state = 'idle'; // idle | in | held | out
    this.t = 0;
    this.spin = { yaw: 0, pitch: 0, targetYaw: 0, targetPitch: 0 };
    this.startPos = new THREE.Vector3();
    this.startQuat = new THREE.Quaternion();
    this.onClosed = null;
  }

  get active() {
    return this.state !== 'idle';
  }

  /** Begin the pick-up animation from a shelf slot's world matrix. */
  open(video, slotIndex, worldMatrix, mainCamera) {
    this.dispose();
    this.video = video;
    this.slot = slotIndex;
    const aisle = this.catalog.aisleById.get(video.aisle);
    const d = coverData(video, aisle, this.catalog.store);
    const W = 512;
    const H = Math.round((W * 280) / 160);
    const spineW = Math.round((H * DIM.CASE_D) / DIM.CASE_H);
    const front = texFrom(drawCover, W, H, d);
    const back = texFrom(drawBack, W, H, d);
    const spine = texFrom(drawSpine, spineW, H, d);
    const plastic = texFrom(drawPlastic, 64, 64, d);
    const sleeve = (map) => new THREE.MeshStandardMaterial({ map, roughness: 0.28, metalness: 0.0 });
    const mats = [
      sleeve(plastic), // +x opening edge
      sleeve(spine), // -x spine
      sleeve(plastic),
      sleeve(plastic),
      sleeve(front),
      sleeve(back),
    ];
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(DIM.CASE_W, DIM.CASE_H, DIM.CASE_D), mats);
    this.scene.add(this.mesh);

    this.camera.fov = mainCamera.fov;
    this.camera.aspect = mainCamera.aspect;
    this.camera.updateProjectionMatrix();

    // shelf pose expressed in camera space (the held scene's camera sits at the origin)
    mainCamera.updateMatrixWorld();
    _m.copy(mainCamera.matrixWorldInverse).multiply(worldMatrix);
    _m.decompose(this.startPos, this.startQuat, _s);
    this.mesh.position.copy(this.startPos);
    this.mesh.quaternion.copy(this.startQuat);

    this.spin = { yaw: 0, pitch: 0, targetYaw: 0, targetPitch: 0 };
    this.state = 'in';
    this.t = 0;
  }

  /** Put it back; resolves when the tape is back on the shelf. */
  close() {
    if (this.state === 'idle' || this.state === 'out') return;
    this.state = 'out';
    this.t = 0;
    this.closeFrom = { pos: this.mesh.position.clone(), quat: this.mesh.quaternion.clone() };
  }

  /** Skip the rest of a put-back animation (e.g. to pick up another tape right away). */
  finishClose() {
    if (this.state !== 'out') return;
    const slot = this.slot;
    this.dispose();
    this.state = 'idle';
    this.onClosed?.(slot);
  }

  flip() {
    this.spin.targetYaw = Math.round(this.spin.targetYaw / Math.PI) * Math.PI + Math.PI;
  }

  drag(dx, dy) {
    this.spin.targetYaw += dx * 0.01;
    this.spin.targetPitch = clamp(this.spin.targetPitch + dy * 0.008, -0.9, 0.9);
  }

  /** Where the tape hovers when held: left of centre on wide screens, upper on tall ones. */
  holdPose(out) {
    const dist = 0.29;
    const halfH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * dist;
    const halfW = halfH * this.camera.aspect;
    if (this.camera.aspect > 1.1) out.set(-halfW * 0.33, 0.0, -dist);
    else out.set(0, halfH * 0.42, -dist * 1.45);
    return out;
  }

  update(dt) {
    if (this.state === 'idle' || !this.mesh) return;
    this.t += dt;
    const hold = this.holdPose(_p);
    const s = this.spin;
    s.yaw += (s.targetYaw - s.yaw) * (1 - Math.exp(-dt * 9));
    s.pitch += (s.targetPitch - s.pitch) * (1 - Math.exp(-dt * 9));
    const sway = Math.sin(performance.now() / 900) * 0.04;
    _q.setFromEuler(_e.set(s.pitch + 0.03, s.yaw + sway, 0, 'YXZ'));

    if (this.state === 'in') {
      const k = easeInOut(Math.min(1, this.t / 0.5));
      this.mesh.position.lerpVectors(this.startPos, hold, k);
      this.mesh.position.y += Math.sin(k * Math.PI) * 0.04;
      this.mesh.quaternion.slerpQuaternions(this.startQuat, _q, k);
      this.dimMat.uniforms.uAlpha.value = k;
      if (this.t >= 0.5) this.state = 'held';
    } else if (this.state === 'held') {
      this.mesh.position.copy(hold);
      this.mesh.quaternion.copy(_q);
      this.dimMat.uniforms.uAlpha.value = 1;
    } else if (this.state === 'out') {
      const k = easeInOut(Math.min(1, this.t / 0.4));
      this.mesh.position.lerpVectors(this.closeFrom.pos, this.startPos, k);
      this.mesh.quaternion.slerpQuaternions(this.closeFrom.quat, this.startQuat, k);
      this.dimMat.uniforms.uAlpha.value = 1 - k;
      if (this.t >= 0.4) this.finishClose();
    }
  }

  render(renderer) {
    if (this.state === 'idle') return;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }

  resize(aspect, fov) {
    this.camera.aspect = aspect;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    if (!this.mesh) return;
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    for (const m of this.mesh.material) {
      m.map?.dispose();
      m.dispose();
    }
    this.mesh = null;
  }
}

// Picking a tape off the shelf: the case flies from its slot into your hands,
// the store dims behind it, and you can turn it over to read the back. Grab it and it
// drops to the bottom of your view, and you carry it round with you (to the lounge's VCR).
import * as THREE from 'three';
import { DIM } from './config.js';
import { coverData, drawCover, drawBack, drawSpine, drawPlastic } from './covers.js';
import { makeCanvas, easeInOut, clamp } from './util.js';
import { toTexture } from './textures.js';

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);

// Turning the held tape: radians per pixel dragged, how quickly the box catches up with
// your hand, and how fast a flick's spin dies away once you let go.
const TURN_PER_PX = 0.0105;
const FOLLOW = 22;
const GLIDE_FRICTION = 4.5;
const MAX_SPIN = 14;

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
      // Blended, but kept in three's opaque list: transparent objects draw after opaque
      // ones whatever their renderOrder, which put the dimmer over the tape.
      blending: THREE.CustomBlending,
      transparent: false,
      depthTest: false,
      depthWrite: false,
    });
    const dim = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.dimMat);
    dim.frustumCulled = false;
    dim.renderOrder = -1;
    this.scene.add(dim);
    this.dim = dim;

    this.subjects = new THREE.Group(); // the tape in your hands, and the one you're carrying
    this.scene.add(this.subjects);
    this.mesh = null;
    this.slot = -1;
    // the tape you've grabbed: { mesh, slot, video, state: 'in' | 'held' | 'out', t, from, dim }
    this.carry = null;
    this.showCarry = true;
    this.stride = { phase: 0, amount: 0 };
    this.state = 'idle'; // idle | in | held | out
    this.t = 0;
    // How the held box is turned, in the view's frame: `turn` is where your hand has put
    // it, `shown` eases after it. A flick keeps it spinning a moment (`spin`, rad/s).
    this.turn = new THREE.Quaternion();
    this.shown = new THREE.Quaternion();
    this.spin = { x: 0, y: 0 };
    this.dragging = false;
    this.pending = { x: 0, y: 0 }; // pixels dragged since the last frame
    this.startPos = new THREE.Vector3();
    this.startQuat = new THREE.Quaternion();
    this.onClosed = null;
  }

  get active() {
    return this.state !== 'idle';
  }

  /** Begin the pick-up animation from a shelf slot's world matrix. */
  open(video, slotIndex, worldMatrix, mainCamera) {
    this._build(video, slotIndex);

    this.camera.fov = mainCamera.fov;
    this.camera.aspect = mainCamera.aspect;
    this.camera.updateProjectionMatrix();

    // shelf pose expressed in camera space (the held scene's camera sits at the origin)
    mainCamera.updateMatrixWorld();
    _m.copy(mainCamera.matrixWorldInverse).multiply(worldMatrix);
    _m.decompose(this.startPos, this.startQuat, _s);
    this.mesh.position.copy(this.startPos);
    this.mesh.quaternion.copy(this.startQuat);

    this.turn.identity();
    this.shown.identity();
    this.spin.x = this.spin.y = 0;
    this.pending.x = this.pending.y = 0;
    this.dragging = false;
    this.state = 'in';
    this.t = 0;
  }

  /**
   * Swap the tape in your hands for another from the same box set, in place (it goes
   * back into the box, if you put it back, from where the first one came).
   */
  swap(video, slotIndex) {
    if (!this.mesh || this.state === 'out') return false;
    const pos = this.mesh.position.clone();
    const quat = this.mesh.quaternion.clone();
    this._build(video, slotIndex);
    this.mesh.position.copy(pos);
    this.mesh.quaternion.copy(quat);
    this.turn.identity(); // front on
    this.shown.setFromAxisAngle(UP, -0.6); // (a little turn, so you see it change)
    this.spin.x = this.spin.y = 0;
    return true;
  }

  _build(video, slotIndex) {
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
    const sleeve = (map, thumbnail = false) => {
      const m = new THREE.MeshStandardMaterial({ map, roughness: 0.28, metalness: 0.0 });
      m.userData.thumbnail = thumbnail; // front and back show the video's thumbnail: sharp in PS1 Mode
      return m;
    };
    const mats = [
      sleeve(plastic), // +x opening edge
      sleeve(spine), // -x spine
      sleeve(plastic),
      sleeve(plastic),
      sleeve(front, true),
      sleeve(back, true),
    ];
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(DIM.CASE_W, DIM.CASE_H, DIM.CASE_D), mats);
    this.subjects.add(this.mesh);
  }

  /**
   * A tape's thumbnail has arrived: if it's the one in your hands (or the one you're
   * carrying), repaint its front and back, which show it.
   */
  refreshArt(video) {
    for (const mesh of [this.video?.id === video.id && this.mesh, this.carry?.video.id === video.id && this.carry.mesh]) {
      if (!mesh) continue;
      const d = coverData(video, this.catalog.aisleById.get(video.aisle), this.catalog.store);
      const W = 512;
      const H = Math.round((W * 280) / 160);
      [[4, drawCover], [5, drawBack]].forEach(([i, draw]) => {
        const m = mesh.material[i];
        m.map.dispose();
        m.map = texFrom(draw, W, H, d);
      });
    }
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

  /**
   * Keep hold of the tape in your hands: it drops to the bottom of the view, facing you,
   * and goes where you go. Whatever you were carrying before is let go of.
   */
  grab() {
    if (!this.mesh || this.state === 'out') return false;
    disposeCase(this.carry?.mesh);
    this.carry = {
      mesh: this.mesh,
      slot: this.slot,
      video: this.video,
      state: 'in',
      t: 0,
      from: { pos: this.mesh.position.clone(), quat: this.mesh.quaternion.clone() },
      dim: this.dimMat.uniforms.uAlpha.value,
    };
    this.mesh = null;
    this.slot = -1;
    this.state = 'idle';
    return true;
  }

  /** True while you're carrying a tape. */
  get carrying() {
    return Boolean(this.carry && this.carry.state !== 'out');
  }

  /** The carried tape goes in somewhere (the VCR): it drops out of view. */
  release() {
    if (!this.carrying) return;
    const c = this.carry;
    c.from = { pos: c.mesh.position.clone(), quat: c.mesh.quaternion.clone() };
    c.state = 'out';
    c.t = 0;
  }

  /** Forget the carried tape straight away. */
  dropCarry() {
    disposeCase(this.carry?.mesh);
    this.carry = null;
  }

  /** Turn it round to the other side (a quick click or tap on it, or Space). */
  flip() {
    this.spin.x = this.spin.y = 0;
    this.turn.premultiply(_q2.setFromAxisAngle(UP, Math.PI));
  }

  dragStart() {
    this.dragging = true;
    this.spin.x = this.spin.y = 0;
  }

  /** Dragged `dx`, `dy` pixels: the box turns the way your hand goes, like a trackball. */
  drag(dx, dy) {
    this.dragging = true;
    this.pending.x += dx;
    this.pending.y += dy;
  }

  /** Let go: whatever spin your hand had carries on and dies away. */
  dragEnd() {
    this.dragging = false;
  }

  /** Turn by `ax` radians about the view's vertical and `ay` about its horizontal. */
  _rotate(ax, ay) {
    if (ax) this.turn.premultiply(_q2.setFromAxisAngle(UP, ax));
    if (ay) this.turn.premultiply(_q2.setFromAxisAngle(RIGHT, ay));
  }

  _updateTurn(dt) {
    const s = this.spin;
    if (this.dragging) {
      const ax = this.pending.x * TURN_PER_PX;
      const ay = this.pending.y * TURN_PER_PX;
      this._rotate(ax, ay);
      // how fast the hand is going (smoothed), for the glide after it lets go
      if (dt > 0) {
        const k = 1 - Math.exp(-dt * 25);
        s.x += (clamp(ax / dt, -MAX_SPIN, MAX_SPIN) - s.x) * k;
        s.y += (clamp(ay / dt, -MAX_SPIN, MAX_SPIN) - s.y) * k;
      }
    } else if (s.x || s.y) {
      this._rotate(s.x * dt, s.y * dt);
      const f = Math.exp(-dt * GLIDE_FRICTION);
      s.x *= f;
      s.y *= f;
      if (Math.abs(s.x) + Math.abs(s.y) < 0.02) s.x = s.y = 0;
    }
    this.pending.x = this.pending.y = 0;
    this.turn.normalize();
    this.shown.slerp(this.turn, 1 - Math.exp(-dt * FOLLOW));
  }

  /** Half the view's height at `dist` metres. */
  _halfH(dist) {
    return Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * dist;
  }

  /** How far away the tape has to be to fill `frac` of the view's height. */
  _distFor(frac) {
    return DIM.CASE_H / (frac * 2 * this._halfH(1));
  }

  /** `frac` of the view's height, or less if that would be more than `maxW` of its width. */
  _fit(frac, maxW) {
    const widthFrac = (frac * DIM.CASE_W) / (DIM.CASE_H * this.camera.aspect);
    return widthFrac > maxW ? (frac * maxW) / widthFrac : frac;
  }

  /** Wide screens put the panel beside the tape; narrow ones dock it at the bottom (style.css). */
  get _wide() {
    return this.camera.aspect > 1 && window.innerWidth > 760;
  }

  /**
   * Where the tape is held: big and close. Wide screens: left of centre, beside the
   * panel, about three quarters of the view's height. Tall ones: in the top half, above
   * the panel.
   */
  holdPose(out) {
    if (this._wide) {
      const dist = this._distFor(this._fit(0.74, 0.4));
      return out.set(-this._halfH(dist) * this.camera.aspect * 0.3, 0, -dist);
    }
    const dist = this._distFor(this._fit(0.4, 0.62));
    return out.set(0, this._halfH(dist) * 0.46, -dist);
  }

  /**
   * Where a carried tape rides: centred at the bottom of the view, big, with its lower
   * half out of sight, the way you'd hold it in front of you as you walk.
   */
  carryPose(out) {
    const dist = this._distFor(this._fit(0.7, 0.8));
    return out.set(0, -this._halfH(dist) * 0.98, -dist);
  }

  /** `moving` (0 to 1) is how fast you're walking: the carried tape bobs along. */
  update(dt, moving = 0) {
    if (this.carry) this._updateCarry(dt, moving);
    if (this.state === 'idle') {
      const c = this.carry;
      this.dimMat.uniforms.uAlpha.value = c?.state === 'in' ? c.dim * (1 - easeInOut(Math.min(1, c.t / CARRY_IN))) : 0;
    }
    if (this.state === 'idle' || !this.mesh) return;
    this.t += dt;
    const hold = this.holdPose(_p);
    this._updateTurn(dt);
    // (a slight lean back, and a gentle sway while you're not turning it)
    const sway = this.dragging ? 0 : Math.sin(performance.now() / 900) * 0.03;
    _q.copy(this.shown).premultiply(_q2.setFromEuler(_e.set(0.03, sway, 0, 'YXZ')));

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

  _updateCarry(dt, moving) {
    const c = this.carry;
    c.t += dt;
    c.mesh.visible = this.showCarry && this.state === 'idle'; // (out of sight while you look at another)
    const st = this.stride;
    st.amount += (moving - st.amount) * (1 - Math.exp(-dt * 6));
    st.phase += dt * 9 * st.amount;
    const pose = this.carryPose(_p);
    const reach = -pose.z; // (the bob scales with the distance, so it looks the same at any size)
    pose.x += Math.cos(st.phase / 2) * 0.0065 * reach * st.amount;
    pose.y += Math.abs(Math.sin(st.phase)) * 0.013 * reach * st.amount;
    const sway = Math.sin(performance.now() / 1100) * 0.025;
    _q.setFromEuler(_e.set(-0.14, 0.05 + sway, 0.015, 'YXZ'));
    if (c.state === 'in') {
      const k = easeInOut(Math.min(1, c.t / CARRY_IN));
      c.mesh.position.lerpVectors(c.from.pos, pose, k);
      c.mesh.quaternion.slerpQuaternions(c.from.quat, _q, k);
      if (c.t >= CARRY_IN) c.state = 'held';
    } else if (c.state === 'held') {
      c.mesh.position.copy(pose);
      c.mesh.quaternion.copy(_q);
    } else {
      const k = easeInOut(Math.min(1, c.t / CARRY_OUT));
      c.mesh.position.copy(c.from.pos);
      c.mesh.position.y -= k * 0.32;
      c.mesh.position.z -= k * 0.12;
      if (c.t >= CARRY_OUT) this.dropCarry();
    }
  }

  /** Draw over the store. With PS1 Mode on, `ps1` draws it in the PS1 style. */
  render(renderer, ps1 = null) {
    if (this.state === 'idle' && !this.carry?.mesh.visible) return;
    this.dim.visible = this.dimMat.uniforms.uAlpha.value > 0.001;
    if (ps1) {
      ps1.renderOverlay(this.scene, this.camera, { backdrop: this.dim, subject: this.subjects });
      return;
    }
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }

  resize(aspect, fov) {
    this.camera.aspect = aspect;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    disposeCase(this.mesh);
    this.mesh = null;
  }
}

const CARRY_IN = 0.45;
const CARRY_OUT = 0.35;

function disposeCase(mesh) {
  if (!mesh) return;
  mesh.removeFromParent();
  mesh.geometry.dispose();
  for (const m of mesh.material) {
    m.map?.dispose();
    m.dispose();
  }
}

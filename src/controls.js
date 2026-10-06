// First-person walking: pointer-lock mouse look + WASD on desktop, a virtual
// joystick + drag-to-look on touch screens. Collides with the shelving footprint.
import * as THREE from 'three';
import { DIM } from './config.js';
import { clamp } from './util.js';

const PITCH_LIMIT = 1.25;

export class PlayerControls {
  constructor(camera, dom, { colliders, bounds, spawn }) {
    this.camera = camera;
    this.dom = dom;
    this.colliders = colliders;
    this.bounds = bounds;
    this.pos = new THREE.Vector3(spawn.x, 0, spawn.z);
    this.vel = new THREE.Vector3();
    this.yaw = spawn.yaw;
    this.pitch = -0.04;
    this.enabled = false;
    this.locked = false;
    this.dragLook = false; // fallback when pointer lock is unavailable
    this.keys = new Set();
    this.joy = { x: 0, y: 0 };
    this.bob = 0;
    this.sensitivity = 0.0022;
    this.onLockChange = () => {};
    this.onTap = () => {};
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

    this.failures = 0;
    this.dragDist = 0;
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
      if (this.locked) this.failures = 0;
      else this.keys.clear();
      this.onLockChange(this.locked);
    });
    document.addEventListener('pointerlockerror', () => {
      if (!this._promiseApi) this._lockFailed();
    });
    this.dom.addEventListener('mousedown', () => (this.dragDist = 0));
    document.addEventListener('mousemove', (e) => {
      if (this.locked) this._look(clamp(e.movementX, -150, 150), clamp(e.movementY, -150, 150));
      else if (this.dragLook && this.enabled && e.buttons === 1) {
        this.dragDist += Math.abs(e.movementX) + Math.abs(e.movementY);
        this._look(e.movementX * 1.2, e.movementY * 1.2);
      }
    });
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    if (this.isTouch) this._setupTouch();
    this._apply();
  }

  lock() {
    if (this.isTouch || this.dragLook) return;
    if (!this.dom.requestPointerLock) {
      this.failures = 99;
      return this._lockFailed();
    }
    let p = null;
    try {
      p = this.dom.requestPointerLock({ unadjustedMovement: true });
    } catch {
      p = null;
    }
    this._promiseApi = Boolean(p && p.catch);
    if (!this._promiseApi) return;
    p.catch((err) => {
      if (err?.name !== 'NotSupportedError') return this._lockFailed();
      // raw mouse input isn't available everywhere — retry without it
      const p2 = this.dom.requestPointerLock();
      p2?.catch?.(() => this._lockFailed());
    });
  }

  /** A single failure is usually the browser's post-Esc cooldown; twice in a row means
   *  pointer lock isn't allowed here (e.g. inside an iframe), so fall back to drag-to-look. */
  _lockFailed() {
    this.failures++;
    if (this.failures >= 2) this.dragLook = true;
    this.onLockChange(false, true);
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  _look(dx, dy) {
    this.yaw -= dx * this.sensitivity;
    this.pitch = clamp(this.pitch - dy * this.sensitivity, -PITCH_LIMIT, PITCH_LIMIT);
  }

  teleport(x, z, yaw, pitch = 0) {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = pitch;
    this._apply();
  }

  update(dt) {
    let fx = 0;
    let fz = 0;
    if (this.enabled) {
      const k = this.keys;
      if (k.has('KeyW') || k.has('ArrowUp')) fz += 1;
      if (k.has('KeyS') || k.has('ArrowDown')) fz -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) fx += 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) fx -= 1;
      fx += this.joy.x;
      fz += this.joy.y;
    }
    const len = Math.hypot(fx, fz);
    if (len > 1) {
      fx /= len;
      fz /= len;
    }
    const run = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || Math.hypot(this.joy.x, this.joy.y) > 0.95;
    const speed = run ? DIM.RUN : DIM.WALK;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const tx = (fz * -sin + fx * cos) * speed;
    const tz = (fz * -cos - fx * sin) * speed;
    const a = 1 - Math.exp(-dt * 10);
    this.vel.x += (tx - this.vel.x) * a;
    this.vel.z += (tz - this.vel.z) * a;

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this._collide();

    const v = Math.hypot(this.vel.x, this.vel.z);
    this.bob += v * dt * 3.2;
    this._apply(Math.min(1, v / DIM.WALK));
  }

  _collide() {
    const r = DIM.RADIUS;
    const p = this.pos;
    for (let iter = 0; iter < 2; iter++) {
      for (const b of this.colliders) {
        const cx = clamp(p.x, b.minX, b.maxX);
        const cz = clamp(p.z, b.minZ, b.maxZ);
        const dx = p.x - cx;
        const dz = p.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          p.x = cx + (dx / d) * r;
          p.z = cz + (dz / d) * r;
        } else {
          // centre inside the box: push out along the shallowest axis
          const pen = [
            [p.x - b.minX + r, -1, 0],
            [b.maxX - p.x + r, 1, 0],
            [p.z - b.minZ + r, 0, -1],
            [b.maxZ - p.z + r, 0, 1],
          ].sort((a, b2) => a[0] - b2[0])[0];
          p.x += pen[1] * pen[0];
          p.z += pen[2] * pen[0];
        }
      }
    }
    const B = this.bounds;
    p.x = clamp(p.x, B.minX + r, B.maxX - r);
    p.z = clamp(p.z, B.minZ + r, B.maxZ - r);
  }

  _apply(moving = 0) {
    const c = this.camera;
    c.position.set(this.pos.x, DIM.EYE + Math.sin(this.bob) * 0.018 * moving, this.pos.z);
    c.rotation.set(this.pitch, this.yaw, Math.sin(this.bob * 0.5) * 0.004 * moving, 'YXZ');
  }

  // ------------------------------------------------------------- touch

  _setupTouch() {
    const stick = document.getElementById('joystick');
    const knob = stick?.querySelector('.knob');
    let joyId = null;
    let joyOrigin = null;
    const looks = new Map();
    const R = 56;

    const onStart = (e) => {
      if (!this.enabled) return;
      for (const t of e.changedTouches) {
        if (joyId === null && t.clientX < window.innerWidth * 0.42) {
          joyId = t.identifier;
          joyOrigin = { x: t.clientX, y: t.clientY };
          if (stick) {
            stick.style.left = `${t.clientX}px`;
            stick.style.top = `${t.clientY}px`;
            stick.classList.add('on');
          }
        } else {
          looks.set(t.identifier, { x: t.clientX, y: t.clientY, sx: t.clientX, sy: t.clientY, t0: performance.now() });
        }
      }
      e.preventDefault();
    };
    const onMove = (e) => {
      if (!this.enabled) return;
      for (const t of e.changedTouches) {
        if (t.identifier === joyId) {
          let dx = t.clientX - joyOrigin.x;
          let dy = t.clientY - joyOrigin.y;
          const d = Math.hypot(dx, dy);
          if (d > R) {
            dx = (dx / d) * R;
            dy = (dy / d) * R;
          }
          this.joy.x = dx / R;
          this.joy.y = -dy / R;
          if (knob) knob.style.transform = `translate(${dx}px, ${dy}px)`;
        } else if (looks.has(t.identifier)) {
          const l = looks.get(t.identifier);
          this.yaw -= (t.clientX - l.x) * 0.0055;
          this.pitch = clamp(this.pitch - (t.clientY - l.y) * 0.0055, -PITCH_LIMIT, PITCH_LIMIT);
          l.x = t.clientX;
          l.y = t.clientY;
        }
      }
      e.preventDefault();
    };
    const onEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === joyId) {
          joyId = null;
          this.joy.x = this.joy.y = 0;
          if (knob) knob.style.transform = '';
          stick?.classList.remove('on');
        } else if (looks.has(t.identifier)) {
          const l = looks.get(t.identifier);
          looks.delete(t.identifier);
          const moved = Math.hypot(t.clientX - l.sx, t.clientY - l.sy);
          if (moved < 12 && performance.now() - l.t0 < 350) this.onTap(t.clientX, t.clientY);
        }
      }
    };
    this.dom.addEventListener('touchstart', onStart, { passive: false });
    this.dom.addEventListener('touchmove', onMove, { passive: false });
    this.dom.addEventListener('touchend', onEnd);
    this.dom.addEventListener('touchcancel', onEnd);
  }
}

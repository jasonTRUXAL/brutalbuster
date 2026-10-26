// Playing a capsule-toy machine: the crank turns a full circle, a capsule drops out of
// the prize flap, floats up in front of you and splits open. What's inside is the prize
// system's job (onPrize). This file is only the machine.
import * as THREE from 'three';
import { easeInOut, easeOut } from './util.js';

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const T = { turn: 1.1, drop: 0.5, rise: 0.55, open: 0.5 };
const COLOR_NAMES = {
  '#ff3b3b': 'Red', '#ffb000': 'Orange', '#3ddc84': 'Green', '#29b6f6': 'Blue',
  '#b388ff': 'Purple', '#ff4fa3': 'Pink', '#ff7a00': 'Tangerine', '#ffe14d': 'Yellow',
};
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class GachaGame {
  /** @param refs one entry of prizes.gachas (machine, crank, theme, pile, capsuleMeshes, size) */
  constructor(refs, { onPrize, onChange }) {
    this.refs = refs;
    this.kind = 'gacha';
    this.title = refs.theme.title;
    this.subtitle = 'Capsule toys · free play';
    this.onPrize = onPrize;
    this.onChange = onChange;
    this.state = 'idle'; // idle | turning | dropping | rising | opening | done
    this.t = 0;
    this.next = 0; // index into the pile of the next capsule to come out
    this.capsule = null;
    this.result = null;
    this.turns = 0;
  }

  /** Crouched in front of the machine, eye level with the window and crank. On tall
   *  (phone) screens look a little lower so the machine sits above the control panel. */
  pose(aspect = 1.6) {
    const m = this.refs.machine;
    m.updateMatrixWorld();
    const ty = aspect < 1 ? 0.7 : 0.9;
    return { position: m.localToWorld(new THREE.Vector3(0, 1.0, 0.66)), target: m.localToWorld(new THREE.Vector3(0, ty, 0.12)) };
  }

  hitBox() {
    const m = this.refs.machine;
    m.updateMatrixWorld();
    const pts = [];
    for (const x of [-0.24, 0.24]) for (const y of [0, 1.46]) for (const z of [-0.22, 0.24]) pts.push(m.localToWorld(new THREE.Vector3(x, y, z)));
    return new THREE.Box3().setFromPoints(pts);
  }

  get busy() {
    return this.state !== 'idle' && this.state !== 'done';
  }

  get capsulesLeft() {
    return this.refs.pile.length - this.next;
  }

  /** Turn the crank (ignored while a capsule is still on its way). */
  turn() {
    if (this.busy) return false;
    this.clearCapsule();
    this.result = null;
    this.state = 'turning';
    this.t = 0;
    this.onChange?.(this);
    return true;
  }

  /** Space / click while playing. */
  primary(down) {
    if (down) this.turn();
  }

  exit() {
    this.clearCapsule();
    this.refs.crank.rotation.z = 0;
    this.state = 'idle';
    this.result = null;
  }

  update(dt, camera) {
    if (this.state === 'idle') return;
    this.t += dt;
    const { crank, size } = this.refs;
    const front = size.front;
    const flapY = size.standH + 0.05;

    if (this.state === 'turning') {
      const k = Math.min(1, this.t / T.turn);
      // a ratchety turn: eases through four quarter clicks
      crank.rotation.z = -(Math.floor(k * 4) + easeInOut((k * 4) % 1)) * (Math.PI / 2);
      if (k >= 1) {
        crank.rotation.z = 0;
        this.dispense();
        this.state = 'dropping';
        this.t = 0;
      }
    } else if (this.state === 'dropping') {
      const k = Math.min(1, this.t / T.drop);
      const c = this.capsule;
      c.position.set(0, flapY + 0.04 - easeOut(k) * 0.035 + Math.abs(Math.sin(k * Math.PI * 2.2)) * 0.012 * (1 - k), front - 0.03 + k * 0.1);
      c.rotation.x += dt * 9;
      if (k >= 1) {
        this.from = { pos: c.position.clone(), quat: c.quaternion.clone() };
        this.state = 'rising';
        this.t = 0;
      }
    } else if (this.state === 'rising' || this.state === 'opening' || this.state === 'done') {
      // hover the capsule in front of the camera (expressed in the machine's space)
      const c = this.capsule;
      camera.getWorldDirection(_v);
      const target = this.refs.machine.worldToLocal(camera.position.clone().addScaledVector(_v, 0.3).add(new THREE.Vector3(0, -0.035, 0)));
      if (this.state === 'rising') {
        const k = easeInOut(Math.min(1, this.t / T.rise));
        c.position.lerpVectors(this.from.pos, target, k);
        c.scale.setScalar(1 + k * 1.2);
        c.rotation.x += dt * 6 * (1 - k);
        if (k >= 1) {
          this.state = 'opening';
          this.t = 0;
          c.rotation.set(0.25, 0, 0);
        }
      } else {
        c.position.copy(target);
        c.rotation.y += dt * 0.8;
        const k = this.state === 'opening' ? easeOut(Math.min(1, this.t / T.open)) : 1;
        const { top, bottom, glow } = c.userData;
        top.position.y = k * 0.03;
        top.rotation.x = -k * 0.6;
        bottom.position.y = -k * 0.012;
        glow.scale.setScalar(0.2 + k * (0.9 + Math.sin(this.t * 6) * 0.08));
        if (this.state === 'opening' && this.t >= T.open) {
          this.state = 'done';
          this.result = { machine: this.title, color: c.userData.color, colorName: COLOR_NAMES[c.userData.color] || 'Mystery', turn: this.turns };
          this.onPrize?.({ kind: 'capsule', ...this.result });
          this.onChange?.(this);
        }
      }
    }
  }

  /** Take the top capsule off this machine's pile and drop it into the flap. */
  dispense() {
    const { pile, capsuleMeshes } = this.refs;
    let restocked = false;
    if (this.next >= pile.length) {
      // empty: an attendant refills it (free play, so it never runs dry)
      for (const c of pile) {
        capsuleMeshes.tops.setMatrixAt(c.index, c.matrix);
        capsuleMeshes.bottoms.setMatrixAt(c.index, c.matrix);
      }
      this.next = 0;
      restocked = true;
    }
    const cap = pile[this.next++];
    capsuleMeshes.tops.setMatrixAt(cap.index, HIDDEN);
    capsuleMeshes.bottoms.setMatrixAt(cap.index, HIDDEN);
    capsuleMeshes.tops.instanceMatrix.needsUpdate = true;
    capsuleMeshes.bottoms.instanceMatrix.needsUpdate = true;
    this.turns++;
    this.restocked = restocked;

    const r = 0.024;
    const group = new THREE.Group();
    const top = new THREE.Mesh(
      new THREE.SphereGeometry(r, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: cap.color, roughness: 0.25, side: THREE.DoubleSide }), // open halves show their inside
    );
    const bottom = new THREE.Mesh(
      new THREE.SphereGeometry(r, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xf2f4f8, roughness: 0.15, side: THREE.DoubleSide }),
    );
    const glow = new THREE.Mesh(new THREE.SphereGeometry(r * 0.55, 16, 10), new THREE.MeshBasicMaterial({ color: 0xfff1b0, toneMapped: false }));
    glow.scale.setScalar(0.2);
    group.add(top, bottom, glow);
    group.userData = { top, bottom, glow, color: cap.color };
    group.quaternion.copy(_q.setFromAxisAngle(_v.set(1, 0, 0), 0.4));
    this.refs.machine.add(group);
    this.capsule = group;
  }

  clearCapsule() {
    const c = this.capsule;
    if (!c) return;
    c.parent?.remove(c);
    c.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
    this.capsule = null;
  }
}

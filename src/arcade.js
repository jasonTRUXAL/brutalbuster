// Walking up to a machine and playing it: hit-testing the machines, easing the camera
// down into a crouch (gacha) or onto the stool (pachinko) and back up, and handing input
// to whichever game is being played.
import * as THREE from 'three';
import { GachaGame } from './gacha.js';
import { PachinkoGame } from './pachinko.js';
import { easeInOut } from './util.js';

const SIT_TIME = 0.75;
const _hit = new THREE.Vector3();
const _look = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

export class Arcade {
  constructor(prizes, { onPrize, onChange } = {}) {
    const hooks = { onPrize: (p) => onPrize?.(p), onChange: (g) => onChange?.(g) };
    this.games = [...prizes.gachas.map((g) => new GachaGame(g, hooks))];
    if (prizes.pachinko) this.games.push(new PachinkoGame(prizes.pachinko, hooks));
    this.boxes = this.games.map((g) => g.hitBox());
    this.active = null;
    this.tween = null; // { from, to, t, onDone }
    this.standing = null; // where to return the camera to
  }

  /** The machine a ray points at (nearest), within `far` metres. */
  pick(ray, far) {
    let best = null;
    this.boxes.forEach((box, i) => {
      if (!ray.intersectBox(box, _hit)) return;
      const d = _hit.distanceTo(ray.origin);
      if (d <= far && (!best || d < best.distance)) best = { game: this.games[i], distance: d };
    });
    return best;
  }

  /** Crouch / sit down at a machine. */
  enter(game, camera) {
    if (this.active || this.tween) return;
    this.active = game;
    this.standing = { pos: camera.position.clone(), quat: camera.quaternion.clone() };
    const p = game.pose(camera.aspect);
    const quat = new THREE.Quaternion().setFromRotationMatrix(_look.lookAt(p.position, p.target, UP));
    this.tween = { from: this.standing, to: { pos: p.position, quat }, t: 0 };
  }

  /** Stand back up; `onDone` runs once the camera is back where it started. */
  exit(camera, onDone) {
    if (!this.active) return;
    this.active.exit();
    this.tween = { from: { pos: camera.position.clone(), quat: camera.quaternion.clone() }, to: this.standing, t: 0, onDone, leaving: true };
  }

  /** True while the arcade owns the camera (playing, or sitting down / standing up). */
  get busy() {
    return Boolean(this.active || this.tween);
  }

  get seated() {
    return Boolean(this.active && !this.tween);
  }

  update(dt, camera) {
    for (const g of this.games) g.update(dt, camera);
    const tw = this.tween;
    if (!tw) return;
    tw.t += dt;
    const k = easeInOut(Math.min(1, tw.t / SIT_TIME));
    camera.position.lerpVectors(tw.from.pos, tw.to.pos, k);
    camera.quaternion.slerpQuaternions(tw.from.quat, tw.to.quat, k);
    if (tw.t >= SIT_TIME) {
      this.tween = null;
      if (tw.leaving) {
        this.active = null;
        tw.onDone?.();
      }
    }
  }
}

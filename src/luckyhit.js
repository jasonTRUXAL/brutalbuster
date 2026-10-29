// Playing Lucky Hit: slide the cup along the drop rail, let go, and watch one ball
// drift down through today's nails into a prize slot. Every slot wins something (the
// narrow gold slot is the jackpot, for rarer prizes later). Each landing calls onPrize,
// same as the gacha machines, so the reward system can fill in what you won.
import * as THREE from 'three';
import { LUCKY, createWorld, drop, step } from './luckyhit-physics.js';
import { clamp } from './util.js';

const AIM_SPEED = 0.28; // m/s when steering with the arrow keys
const SHOW_RESULT = 1.8; // seconds the landed ball stays before a fresh one appears
const THEME_NAMES = { tape: 'Tape Pals', snack: 'Snack Pals', game: 'Game Pals', tv: 'TV Pals', rare: 'Jackpot' };

const _ray = new THREE.Raycaster();
const _plane = new THREE.Plane();
const _hit = new THREE.Vector3();
const _n = new THREE.Vector3();

export class LuckyHitGame {
  /** @param refs prizes.luckyHit (stall, board, boardGroup, holder, ball, glow) */
  constructor(refs, { onPrize, onChange, seed = Date.now() }) {
    this.refs = refs;
    this.board = refs.board;
    this.kind = 'luckyhit';
    this.title = 'LUCKY HIT';
    this.subtitle = `Today's board #${refs.board.number} · ${refs.board.pattern}`;
    this.onPrize = onPrize;
    this.onChange = onChange;
    this.world = createWorld(refs.board, seed >>> 0);
    this.state = 'aim'; // aim | falling | landed
    this.aim = 0;
    this.aimDir = 0;
    this.t = 0;
    this.result = null;
    this.stats = { drops: 0, jackpots: 0 };
    this.message = 'Pick your spot, then drop.';
    this.setAim(0);
  }

  /** Standing at the table, eyes level with the board. On wide screens the board sits left
   *  of centre (the panel is on the right); on tall phone screens look lower so it sits
   *  above the panel. */
  pose(aspect = 1.6) {
    const s = this.refs.stall;
    s.updateMatrixWorld();
    const wide = aspect > 1.1;
    const eye = wide ? new THREE.Vector3(0.1, 1.3, 0.62) : new THREE.Vector3(0, 1.36, 1.2);
    const target = wide ? new THREE.Vector3(0.18, 1.18, -0.22) : new THREE.Vector3(0, 0.92, -0.22);
    return { position: s.localToWorld(eye), target: s.localToWorld(target) };
  }

  hitBox() {
    const s = this.refs.stall;
    s.updateMatrixWorld();
    const pts = [];
    for (const x of [-0.52, 0.52]) for (const y of [0, 1.75]) for (const z of [-0.4, 0.3]) pts.push(s.localToWorld(new THREE.Vector3(x, y, z)));
    return new THREE.Box3().setFromPoints(pts);
  }

  get busy() {
    return this.state === 'falling';
  }

  get aimRange() {
    return LUCKY.aim;
  }

  setAim(x) {
    if (this.state === 'falling') return;
    this.aim = clamp(x, -LUCKY.aim, LUCKY.aim);
    this.refs.holder.position.x = this.aim;
    if (this.state === 'aim') this.refs.ball.position.set(this.aim, LUCKY.dropY, LUCKY.ball + 0.002);
  }

  /** Arrow keys: -1 / 0 / +1. */
  steer(dir) {
    this.aimDir = dir;
  }

  /** Aim with the mouse: wherever the pointer crosses the board's face. */
  pointer(ndc, camera) {
    if (this.state === 'falling') return;
    const g = this.refs.boardGroup;
    g.updateMatrixWorld();
    _n.set(0, 0, 1).transformDirection(g.matrixWorld);
    _plane.setFromNormalAndCoplanarPoint(_n, g.getWorldPosition(_hit));
    _ray.setFromCamera(ndc, camera);
    if (!_ray.ray.intersectPlane(_plane, _hit)) return;
    this.setAim(g.worldToLocal(_hit).x);
  }

  /** Space / click / the Drop button. */
  primary(down) {
    if (down) this.letGo();
  }

  letGo() {
    if (this.state === 'falling') return false;
    if (this.state === 'landed') this.reset();
    drop(this.world, this.aim);
    this.state = 'falling';
    this.result = null;
    this.stats.drops++;
    this.message = 'Here it goes…';
    this.onChange?.(this);
    return true;
  }

  reset() {
    this.state = 'aim';
    this.refs.glow.material.opacity = 0;
    this.setAim(this.aim);
    this.message = 'Pick your spot, then drop.';
    this.onChange?.(this);
  }

  exit() {
    this.aimDir = 0; // a ball already falling still lands (and still counts)
  }

  update(dt) {
    if (this.aimDir && this.state !== 'falling') this.setAim(this.aim + this.aimDir * AIM_SPEED * dt);

    if (this.state === 'falling') {
      const b = this.world.balls[0];
      for (const e of step(this.world, dt)) {
        if (e.type === 'landed') this.land(e.slot, e.ball);
        else {
          // shouldn't happen on a checked board; hand the ball back rather than strand it
          this.state = 'aim';
          this.message = 'It bounced out! Have another go.';
          this.setAim(this.aim);
          this.onChange?.(this);
        }
      }
      if (b && this.state === 'falling') {
        this.refs.ball.position.set(b.x, b.y, LUCKY.ball + 0.002);
        this.refs.ball.rotation.z -= (b.vx / LUCKY.ball) * dt;
      }
    } else if (this.state === 'landed') {
      this.t += dt;
      this.refs.glow.material.opacity = 0.35 + Math.sin(this.t * 8) * 0.2;
      if (this.t > SHOW_RESULT) this.reset();
    }
  }

  land(slot, ball) {
    this.state = 'landed';
    this.t = 0;
    this.refs.ball.position.set(ball.x, ball.y, LUCKY.ball + 0.002);
    const glow = this.refs.glow;
    glow.position.x = (slot.x0 + slot.x1) / 2;
    glow.scale.x = slot.x1 - slot.x0;
    glow.material.color.set(slot.jackpot ? 0xffd84a : 0xfff1b0);
    if (slot.jackpot) this.stats.jackpots++;
    this.result = { slot: slot.index, theme: slot.theme, themeName: THEME_NAMES[slot.theme], jackpot: slot.jackpot };
    this.message = slot.jackpot ? '★ JACKPOT! ★' : `${THEME_NAMES[slot.theme]}!`;
    this.onPrize?.({ kind: 'lucky-hit', machine: this.title, board: this.board.number, ...this.result });
    this.onChange?.(this);
  }
}

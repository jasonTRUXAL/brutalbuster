// Playing the pachinko machine: hold to fire balls up the rail, the physics in
// pachinko-physics.js bounces them through the pins, START spins the reels on the
// centre screen, and three of a kind is FEVER. Jackpots call onPrize so the prize
// system can hand out something real later.
import * as THREE from 'three';
import { BOARD, createWorld, launch, step } from './pachinko-physics.js';
import { makeCanvas, rng } from './util.js';
import { FONT } from './fonts.js';
import { toTexture } from './textures.js';

const FIRE_RATE = 5; // balls per second while the trigger is held
const START_BALLS = 100;
const REFILL = 50; // free play: an empty tray tops itself back up
const FEVER_PAYOUT = 50;
const JACKPOT_ODDS = 1 / 7;
const REACH_ODDS = 0.3;
const SYMBOLS = [
  { text: '7', color: '#ff2d4a' },
  { text: 'BAR', color: '#ffe14d' },
  { text: 'VHS', color: '#2ee6ff' },
  { text: '★', color: '#ff4fa3' },
  { text: 'M', color: '#3ddc84' },
];
const MAX_FLIGHT = 64;
const _m = new THREE.Matrix4();
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

export class PachinkoGame {
  /** @param refs prizes.pachinko (machine, play, tray, knob, lights) */
  constructor(refs, { onPrize, onChange, seed = Date.now() }) {
    this.refs = refs;
    this.kind = 'pachinko';
    this.title = 'BRUTAL FEVER';
    this.subtitle = 'Moose Rush pachinko · free play';
    this.onPrize = onPrize;
    this.onChange = onChange;
    this.world = createWorld(seed >>> 0);
    this.rand = rng((seed * 7) >>> 0);
    this.balls = START_BALLS;
    this.power = 0.5;
    this.firing = false;
    this.fireT = 0;
    this.refillT = 0;
    this.stats = { shot: 0, won: 0, spins: 0, jackpots: 0 };
    this.message = 'Hold to shoot. Aim for START.';
    this.reels = { state: 'idle', queue: 0, t: 0, pos: [0, 1, 2], stopAt: [0, 0, 0], target: [0, 1, 2], kind: null };
    this.fever = { t: 0, owed: 0, drip: 0 };
    this.flash = 0;

    const { machine, play } = refs;
    // balls in flight, drawn on the playfield in the machine's own space
    this.flight = new THREE.InstancedMesh(
      new THREE.SphereGeometry(BOARD.ball, 10, 8),
      // only half metallic: with nothing in the room to reflect, full chrome renders black
      new THREE.MeshStandardMaterial({ color: 0xe9ecf2, roughness: 0.2, metalness: 0.5 }),
      MAX_FLIGHT,
    );
    this.flight.frustumCulled = false;
    for (let i = 0; i < MAX_FLIGHT; i++) this.flight.setMatrixAt(i, HIDDEN);
    machine.add(this.flight);

    // the centre screen: a live panel over the painted one
    const { lcd } = BOARD;
    this.lcdCanvas = makeCanvas(312, 216);
    this.lcdTex = toTexture(this.lcdCanvas, { mipmaps: false });
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(lcd.x1 - lcd.x0, lcd.y1 - lcd.y0),
      new THREE.MeshBasicMaterial({ map: this.lcdTex, toneMapped: false }),
    );
    screen.position.set((lcd.x0 + lcd.x1) / 2, play.Y + (lcd.y0 + lcd.y1) / 2, play.Z + 0.0008);
    machine.add(screen);
    this.lcdDirty = true;
    this.lcdT = 0;
    this.setPower(this.power);
    this.drawLCD();
    this.showTray();
  }

  /** Sitting on the stool, eyes level with the playfield (looking lower on tall phone
   *  screens, so the board sits above the control panel). */
  pose(aspect = 1.6) {
    const m = this.refs.machine;
    m.updateMatrixWorld();
    const eye = aspect < 1 ? new THREE.Vector3(0, 1.24, 0.75) : new THREE.Vector3(0, 1.24, 0.6);
    const ty = aspect < 1 ? 0.98 : 1.17;
    return { position: m.localToWorld(eye), target: m.localToWorld(new THREE.Vector3(0, ty, 0.05)) };
  }

  hitBox() {
    const m = this.refs.machine;
    m.updateMatrixWorld();
    const pts = [];
    for (const x of [-0.34, 0.34]) for (const y of [0, 1.8]) for (const z of [-0.25, 0.78]) pts.push(m.localToWorld(new THREE.Vector3(x, y, z)));
    return new THREE.Box3().setFromPoints(pts);
  }

  get inFlight() {
    return this.world.balls.length;
  }

  setPower(p) {
    this.power = Math.min(1, Math.max(0, p));
    this.refs.knob.rotation.z = -this.power * 2.4; // the launch knob turns like the real dial
    this.onChange?.(this);
  }

  setFiring(on) {
    this.firing = on;
    if (!on) this.fireT = 0;
  }

  primary(down) {
    this.setFiring(down);
  }

  exit() {
    this.setFiring(false); // balls already on the board keep falling
  }

  // ------------------------------------------------------------------ simulation

  update(dt) {
    let changed = false;

    if (this.firing) {
      this.fireT += dt;
      const gap = 1 / FIRE_RATE;
      while (this.fireT >= gap) {
        this.fireT -= gap;
        if (this.balls <= 0) break;
        launch(this.world, this.power);
        this.balls--;
        this.stats.shot++;
        changed = true;
      }
    }

    for (const e of step(this.world, dt)) {
      if (e.type === 'foul') {
        this.balls++; // too weak to clear the lane: it rolls back to the tray
      } else if (e.type === 'pocket') {
        this.balls += e.pocket.payout;
        this.stats.won += e.pocket.payout;
        this.message = e.pocket.spin ? `START! +${e.pocket.payout}` : `Tulip! +${e.pocket.payout}`;
        if (e.pocket.spin) this.queueSpin();
        this.flash = 0.4;
      }
      changed = true;
    }

    // free play: an empty tray tops itself up once the board is clear
    if (this.balls === 0 && !this.inFlight && this.fever.owed === 0) {
      this.refillT += dt;
      if (this.refillT > 1.2) {
        this.balls = REFILL;
        this.refillT = 0;
        this.message = 'Free play: tray refilled!';
        changed = true;
      }
    } else this.refillT = 0;

    this.updateReels(dt);
    if (this.fever.owed > 0) {
      this.fever.drip += dt * 25;
      while (this.fever.drip >= 1 && this.fever.owed > 0) {
        this.fever.drip -= 1;
        this.fever.owed--;
        this.balls++;
        this.stats.won++;
        changed = true;
      }
    }
    if (this.fever.t > 0) this.fever.t = Math.max(0, this.fever.t - dt);
    this.flash = Math.max(0, this.flash - dt);
    this.refs.lights.speed = this.fever.t > 0 ? 34 : this.reels.state === 'spinning' ? 14 : this.flash > 0 ? 20 : 6;

    this.drawFlight();
    if (changed) {
      this.lcdDirty = true; // the screen shows the ball count
      this.showTray();
      this.onChange?.(this);
    }
    this.lcdT += dt;
    if ((this.lcdDirty || this.reels.state === 'spinning' || this.fever.t > 0) && this.lcdT > 1 / 30) {
      this.lcdT = 0;
      this.lcdDirty = false;
      this.drawLCD();
    }
  }

  drawFlight() {
    const { play } = this.refs;
    const n = Math.min(MAX_FLIGHT, this.world.balls.length);
    for (let i = 0; i < MAX_FLIGHT; i++) {
      if (i < n) {
        const b = this.world.balls[i];
        this.flight.setMatrixAt(i, _m.makeTranslation(b.x, play.Y + b.y, play.Z + 0.0062));
      } else this.flight.setMatrixAt(i, HIDDEN);
    }
    this.flight.instanceMatrix.needsUpdate = true;
  }

  showTray() {
    const { tray } = this.refs;
    tray.mesh.count = Math.min(tray.capacity, Math.ceil((this.balls / START_BALLS) * tray.capacity));
  }

  // ------------------------------------------------------------------ reels

  queueSpin() {
    this.reels.queue = Math.min(4, this.reels.queue + 1); // a real machine holds up to four
    if (this.reels.state !== 'spinning') this.startSpin();
    this.lcdDirty = true;
  }

  startSpin() {
    const R = this.reels;
    if (R.queue <= 0) return;
    R.queue--;
    R.state = 'spinning';
    R.t = 0;
    this.stats.spins++;
    const n = SYMBOLS.length;
    const roll = this.rand();
    const a = Math.floor(this.rand() * n);
    if (roll < JACKPOT_ODDS) {
      R.target = [a, a, a];
      R.kind = 'jackpot';
    } else if (roll < JACKPOT_ODDS + REACH_ODDS) {
      R.target = [a, a, (a + 1 + Math.floor(this.rand() * (n - 1))) % n];
      R.kind = 'reach';
    } else {
      const b = (a + 1 + Math.floor(this.rand() * (n - 1))) % n;
      R.target = [a, b, Math.floor(this.rand() * n)];
      R.kind = 'miss';
    }
    // reaches and jackpots hang on the last reel for suspense
    const suspense = R.kind === 'miss' ? 0 : 1.4;
    R.stopAt = [0.9, 1.4, 2.0 + suspense];
    this.message = 'Spinning…';
  }

  updateReels(dt) {
    const R = this.reels;
    if (R.state === 'hold') {
      // a jackpot stays on screen for the whole FEVER before queued spins resume
      R.t += dt;
      if (R.t >= 4) {
        R.state = 'idle';
        this.lcdDirty = true;
        if (R.queue > 0) this.startSpin();
      }
      return;
    }
    if (R.state !== 'spinning') return;
    R.t += dt;
    const n = SYMBOLS.length;
    for (let i = 0; i < 3; i++) {
      if (R.t < R.stopAt[i]) R.pos[i] = (R.pos[i] + dt * (R.t > R.stopAt[i] - 1.2 && i === 2 && R.kind !== 'miss' ? 6 : 14)) % n;
      else R.pos[i] = R.target[i];
    }
    if (R.kind !== 'miss' && R.t > R.stopAt[1] && R.t < R.stopAt[2]) this.message = 'REACH!';
    if (R.t >= R.stopAt[2] + 0.35) {
      R.state = 'idle';
      if (R.kind === 'jackpot') {
        R.state = 'hold';
        R.t = 0;
        this.stats.jackpots++;
        this.fever.t = 4;
        this.fever.owed += FEVER_PAYOUT;
        this.message = `FEVER!! +${FEVER_PAYOUT}`;
        this.onPrize?.({ kind: 'jackpot', machine: this.title, symbol: SYMBOLS[R.target[0]].text });
      } else this.message = R.kind === 'reach' ? 'So close!' : 'No luck. Keep shooting!';
      this.lcdDirty = true;
      this.onChange?.(this);
      if (R.state === 'idle' && R.queue > 0) this.startSpin();
    }
  }

  drawLCD() {
    const c = this.lcdCanvas;
    const ctx = c.getContext('2d');
    const w = c.width;
    const h = c.height;
    const fever = this.fever.t > 0;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, fever ? '#4a0b2a' : '#0b1030');
    g.addColorStop(1, fever ? '#a0105a' : '#1b0b3d');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const R = this.reels;
    const cw = w / 3;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < 3; i++) {
      const x = cw * i + cw / 2;
      ctx.fillStyle = 'rgba(255,255,255,.06)';
      ctx.fillRect(cw * i + 5, 8, cw - 10, h - 46);
      ctx.save();
      ctx.beginPath();
      ctx.rect(cw * i + 5, 8, cw - 10, h - 46);
      ctx.clip();
      // a short strip of symbols scrolling past the window
      const pos = R.pos[i];
      const base = Math.floor(pos);
      const frac = pos - base;
      for (let k = -1; k <= 1; k++) {
        const s = SYMBOLS[(((base + k) % SYMBOLS.length) + SYMBOLS.length) % SYMBOLS.length];
        const y = (h - 46) / 2 + 8 + (k - frac) * 92;
        ctx.font = `${s.text.length > 1 ? 40 : 76}px ${FONT.bungee}`;
        ctx.lineWidth = 6;
        ctx.strokeStyle = '#fff6c2';
        ctx.strokeText(s.text, x, y + 4, cw - 16);
        ctx.fillStyle = s.color;
        ctx.fillText(s.text, x, y + 4, cw - 16);
      }
      ctx.restore();
    }
    // status line + pending spins
    ctx.fillStyle = fever ? (Math.floor(this.fever.t * 8) % 2 ? '#ffe14d' : '#ff2e88') : '#b9ffcc';
    ctx.font = `26px ${FONT.vt}`;
    const line = fever ? '★ FEVER ★' : R.state === 'spinning' && R.kind !== 'miss' && R.t > R.stopAt[1] ? 'REACH!' : `BALLS ${this.balls}`;
    ctx.fillText(line, w / 2, h - 20);
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i < R.queue ? '#ffe14d' : 'rgba(255,255,255,.18)';
      ctx.beginPath();
      ctx.arc(w - 18 - i * 14, h - 20, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
    this.lcdTex.needsUpdate = true;
  }
}

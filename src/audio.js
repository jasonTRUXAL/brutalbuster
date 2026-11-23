// The store's sound, all made in code with Web Audio (no audio files): the room tone
// (fluorescent hum, the air conditioning, the street by the windows), in-store music
// (a mellow chord loop played through a ceiling-speaker filter, quieter in the side
// rooms and ducked while a tape plays in the lounge), footsteps, and one-off sounds:
// the door chime, picking up a tape, the VCR, the drop box, the receipt printer,
// tokens, prizes. Starts on the first click (browsers won't play sound before one),
// goes quiet while the tab is hidden, and can be turned off (remembered).
import { rng } from './util.js';

const KEY = 'bb.sound';
const load = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
const save = (v) => {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    // (private browsing: not remembered)
  }
};

// how loud each layer is, by room (the music is on the sales floor's speakers)
const ROOM_MUSIC = { main: 1, hall: 0.55, lounge: 0.3, streams: 0.4, extras: 0.45 };
const ROOM_HUM = { main: 1, hall: 0.7, lounge: 0.45, streams: 0.8, extras: 0.9 };

const midi = (n) => 440 * 2 ** ((n - 69) / 12);

// D major: I – vi – ii – V, then IV – iii – ii – V (MIDI notes, root first)
const SECTIONS = [
  [[62, 66, 69, 73], [59, 62, 66, 69], [64, 67, 71, 74], [57, 61, 64, 67]],
  [[67, 71, 74, 78], [66, 69, 73, 76], [64, 67, 71, 74], [57, 61, 64, 67, 71]],
];
const SCALE = [62, 64, 66, 69, 71, 74, 76, 78, 81]; // D major pentatonic, for the melody
const BPM = 88;

export class StoreAudio {
  constructor() {
    this.ctx = null;
    this.enabled = load() !== '0';
    this.state = { room: 'main', tape: 0, front: 0, mode: 'splash' };
    this.stepClock = 0;
    this.rand = rng(20261123);
  }

  get started() {
    return Boolean(this.ctx);
  }

  /** Call from a click (the browser's rule). Safe to call again. */
  start() {
    if (this.ctx) {
      this.ctx.resume?.();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    let ctx;
    try {
      ctx = new AC();
    } catch {
      return;
    }
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    comp.connect(ctx.destination);
    this.master = gain(ctx, this.enabled ? 0.9 : 0, comp);
    this.noise = noiseBuffer(ctx, 2, 'white');
    this.brown = noiseBuffer(ctx, 4, 'brown');

    // ---- room tone
    this.humGain = gain(ctx, 0, this.master);
    for (const [f, g] of [[120, 0.007], [240, 0.004], [360, 0.0015]]) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      o.connect(gain(ctx, g, this.humGain));
      o.start();
    }
    this.hvacGain = gain(ctx, 0, this.master);
    loop(ctx, this.brown, lowpass(ctx, 260, this.hvacGain));
    this.streetGain = gain(ctx, 0, this.master);
    loop(ctx, this.noise, bandpass(ctx, 500, 0.4, this.streetGain));

    // ---- the music, through the ceiling speakers (thin, a little roomy)
    this.musicGain = gain(ctx, 0, this.master);
    const speaker = highpass(ctx, 170, lowpass(ctx, 3600, this.musicGain));
    const verb = ctx.createConvolver();
    verb.buffer = impulse(ctx, 1.4);
    verb.connect(gain(ctx, 0.35, speaker));
    this.music = gain(ctx, 1, speaker);
    this.music.connect(verb);
    this.sfx = gain(ctx, 1, this.master);

    this.bar = 0;
    this.nextNote = ctx.currentTime + 0.3;
    this.timer = setInterval(() => this._schedule(), 60);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) ctx.suspend?.();
      else ctx.resume?.();
    });
  }

  setEnabled(on) {
    this.enabled = on;
    save(on ? '1' : '0');
    if (!this.ctx) return;
    this.ctx.resume?.();
    this.master.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.15);
  }

  /**
   * Each frame: `room` (layout's roomAt), `tape` (0–1: how loud the lounge's tape is
   * where you are), `front` (0–1: how close the shop window is), `speed` (0–1 walking),
   * `surface` ('carpet' | 'tile').
   */
  update(dt, { room = 'main', tape = 0, front = 0, speed = 0, surface = 'carpet', mode = 'walk' } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const music = (ROOM_MUSIC[room] ?? 1) * (1 - Math.min(0.85, tape * 1.1)) * (mode === 'splash' ? 0 : 1);
    this.musicGain.gain.setTargetAtTime(0.3 * music, t, 0.6);
    this.humGain.gain.setTargetAtTime(ROOM_HUM[room] ?? 1, t, 0.6);
    this.hvacGain.gain.setTargetAtTime(0.06, t, 1);
    this.streetGain.gain.setTargetAtTime(0.025 * front, t, 0.5);
    // now and then a car goes by outside (heard near the windows)
    if (front > 0.2 && this.rand() < dt / 9) this._car(front);
    // footsteps
    if (speed > 0.15) {
      this.stepClock += dt * (1.4 + speed * 1.2);
      if (this.stepClock >= 1) {
        this.stepClock = 0;
        this._step(surface, speed);
      }
    } else this.stepClock = 0.7;
  }

  /** A one-off sound. */
  play(name) {
    if (!this.ctx || !this.enabled) return;
    const fn = SOUNDS[name];
    if (fn) fn(this, this.ctx.currentTime + 0.01);
  }

  // ---------------------------------------------------------------- music

  _schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const beat = 60 / BPM;
    while (this.nextNote < ctx.currentTime + 0.25) {
      this._playBar(this.nextNote, beat);
      this.nextNote += beat * 4;
      this.bar++;
    }
  }

  _playBar(t0, beat) {
    const section = SECTIONS[Math.floor(this.bar / 4) % 2];
    const chord = section[this.bar % 4];
    const r = this.rand;
    // pad: the chord, soft and detuned
    for (const n of chord) {
      for (const det of [-6, 5]) this._tone(t0, beat * 4, midi(n), { type: 'triangle', gain: 0.022, attack: 0.35, release: 0.5, detune: det, cutoff: 1500 });
    }
    // electric piano stabs on the off-beats
    for (const b of [1.5, 2.5, 3.5]) {
      if (r() < 0.35) continue;
      for (const n of chord.slice(1)) this._tone(t0 + b * beat, beat * 0.4, midi(n + 12), { type: 'sine', gain: 0.018, attack: 0.005, release: 0.25, fm: 2 });
    }
    // bass
    const root = midi(chord[0] - 24);
    for (const [b, len, f] of [[0, 0.9, root], [1.5, 0.4, root], [2, 0.9, root * (r() < 0.5 ? 1.5 : 1)], [3.5, 0.4, root * 2]]) {
      this._tone(t0 + b * beat, beat * len, f, { type: 'triangle', gain: 0.1, attack: 0.01, release: 0.12, cutoff: 500 });
    }
    // drums: kick, snare (2 and 4), hats on the eighths
    for (const b of [0, 2, ...(r() < 0.4 ? [2.75] : [])]) this._kick(t0 + b * beat);
    for (const b of [1, 3]) this._snare(t0 + b * beat);
    for (let k = 0; k < 8; k++) this._hat(t0 + k * beat * 0.5 + (k % 2 ? beat * 0.06 : 0), k % 2 ? 0.012 : 0.02);
    // a melody in the second half of each section, from the pentatonic scale near the chord
    if (this.bar % 8 >= 4) {
      let i = SCALE.indexOf(SCALE.reduce((a, b) => (Math.abs(b - chord[2] - 12) < Math.abs(a - chord[2] - 12) ? b : a)));
      for (let k = 0; k < 8; k++) {
        if (r() < 0.38) continue;
        i = Math.max(0, Math.min(SCALE.length - 1, i + Math.round((r() - 0.5) * 3)));
        this._tone(t0 + k * beat * 0.5, beat * (r() < 0.3 ? 0.9 : 0.42), midi(SCALE[i] + 12), { type: 'sine', gain: 0.03, attack: 0.01, release: 0.3, vibrato: 5 });
      }
    }
  }

  _tone(t, dur, freq, { type = 'sine', gain: g = 0.05, attack = 0.01, release = 0.2, detune = 0, cutoff = 0, fm = 0, vibrato = 0, out = this.music } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(g, t + attack);
    env.gain.setValueAtTime(g, t + Math.max(attack, dur - release));
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur + release);
    let node = o;
    if (cutoff) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = cutoff;
      o.connect(f);
      node = f;
    }
    node.connect(env);
    env.connect(out);
    if (fm) {
      // a soft bell-ish edge (electric piano)
      const m = ctx.createOscillator();
      m.frequency.value = freq * fm;
      const mg = ctx.createGain();
      mg.gain.setValueAtTime(freq * 1.2, t);
      mg.gain.exponentialRampToValueAtTime(1, t + dur);
      m.connect(mg).connect(o.frequency);
      m.start(t);
      m.stop(t + dur + release + 0.05);
    }
    if (vibrato) {
      const v = ctx.createOscillator();
      v.frequency.value = vibrato;
      const vg = ctx.createGain();
      vg.gain.value = freq * 0.006;
      v.connect(vg).connect(o.frequency);
      v.start(t);
      v.stop(t + dur + release + 0.05);
    }
    o.start(t);
    o.stop(t + dur + release + 0.05);
  }

  _burst(t, dur, { type = 'bandpass', freq = 2000, q = 1, gain: g = 0.1, out = this.music, decay = dur } = {}) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    s.playbackRate.value = 0.8 + this.rand() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(g, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    s.connect(f).connect(env).connect(out);
    s.start(t, this.rand() * 1.5);
    s.stop(t + dur + 0.02);
  }

  _kick(t, out = this.music, g = 0.28) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const env = gain(ctx, 0, out);
    env.gain.setValueAtTime(g, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(env);
    o.start(t);
    o.stop(t + 0.32);
  }

  _snare(t) {
    this._burst(t, 0.18, { freq: 1800, q: 0.7, gain: 0.07 });
    this._tone(t, 0.05, 190, { type: 'triangle', gain: 0.05, release: 0.06 });
  }

  _hat(t, g) {
    this._burst(t, 0.04, { type: 'highpass', freq: 7000, q: 0.5, gain: g });
  }

  _step(surface, speed) {
    const t = this.ctx.currentTime;
    const g = 0.05 + speed * 0.05;
    if (surface === 'tile') {
      this._burst(t, 0.07, { freq: 1300, q: 1.2, gain: g, out: this.sfx });
      this._burst(t, 0.02, { type: 'highpass', freq: 4000, gain: g * 0.4, out: this.sfx });
    } else this._burst(t, 0.09, { type: 'lowpass', freq: 380, q: 0.7, gain: g * 1.6, out: this.sfx });
  }

  _car(front) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.brown;
    const f = bandpass(ctx, 300, 0.8, null);
    const env = gain(ctx, 0, this.master);
    const dur = 3 + this.rand() * 2;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.09 * front, t + dur * 0.5);
    env.gain.linearRampToValueAtTime(0, t + dur);
    f.frequency.setValueAtTime(220, t);
    f.frequency.linearRampToValueAtTime(420, t + dur * 0.5);
    f.frequency.linearRampToValueAtTime(180, t + dur);
    s.connect(f).connect(env);
    s.start(t, this.rand() * 2);
    s.stop(t + dur);
  }
}

// ---------------------------------------------------------------- one-off sounds

const bell = (a, t, f, g = 0.12, len = 1.4) => {
  a._tone(t, 0.02, f, { type: 'sine', gain: g, attack: 0.003, release: len, out: a.sfx });
  a._tone(t, 0.02, f * 2.76, { type: 'sine', gain: g * 0.25, attack: 0.003, release: len * 0.4, out: a.sfx });
};

const SOUNDS = {
  /** the shop door's chime as you walk in */
  chime(a, t) {
    bell(a, t, 659.25);
    bell(a, t + 0.42, 523.25);
  },
  /** a plastic case off the shelf */
  pickup(a, t) {
    a._burst(t, 0.03, { freq: 2300, q: 2, gain: 0.22, out: a.sfx });
    a._burst(t + 0.04, 0.03, { freq: 1600, q: 2, gain: 0.1, out: a.sfx });
  },
  putback(a, t) {
    a._burst(t, 0.03, { freq: 1500, q: 2, gain: 0.16, out: a.sfx });
  },
  /** a box set's other tape */
  swap(a, t) {
    a._burst(t, 0.025, { freq: 2600, q: 3, gain: 0.12, out: a.sfx });
  },
  /** the tape goes in; the VCR's motor pulls it in and threads it */
  vcr(a, t) {
    a._burst(t, 0.05, { freq: 900, q: 1, gain: 0.25, out: a.sfx });
    a._kick(t + 0.05, a.sfx, 0.18);
    const ctx = a.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(40, t + 0.25);
    o.frequency.linearRampToValueAtTime(70, t + 1.3);
    const f = lowpass(ctx, 260, null);
    const env = gain(ctx, 0, a.sfx);
    env.gain.setValueAtTime(0, t + 0.25);
    env.gain.linearRampToValueAtTime(0.07, t + 0.45);
    env.gain.linearRampToValueAtTime(0, t + 1.4);
    o.connect(f).connect(env);
    o.start(t + 0.25);
    o.stop(t + 1.45);
    a._burst(t + 1.45, 0.03, { freq: 2000, q: 2, gain: 0.15, out: a.sfx });
  },
  /** into the returns slot: the flap, then the thunk at the bottom */
  dropbox(a, t) {
    a._burst(t, 0.05, { freq: 2400, q: 2, gain: 0.12, out: a.sfx });
    a._kick(t + 0.22, a.sfx, 0.45);
    a._burst(t + 0.22, 0.12, { type: 'lowpass', freq: 900, gain: 0.25, out: a.sfx });
    a._burst(t + 0.32, 0.04, { freq: 2600, q: 3, gain: 0.08, out: a.sfx });
  },
  /** the receipt printer, then the till */
  register(a, t) {
    for (let k = 0; k < 14; k++) a._burst(t + k * 0.055, 0.03, { freq: 3200, q: 3, gain: 0.07, out: a.sfx });
    bell(a, t + 0.85, 1318.5, 0.08, 0.8);
    bell(a, t + 0.97, 1568, 0.1, 1.1);
  },
  /** tokens! */
  token(a, t) {
    a._tone(t, 0.06, 988, { type: 'square', gain: 0.035, release: 0.03, cutoff: 3000, out: a.sfx });
    a._tone(t + 0.07, 0.18, 1319, { type: 'square', gain: 0.035, release: 0.12, cutoff: 3000, out: a.sfx });
  },
  /** a prize: a little fanfare */
  prize(a, t) {
    [784, 988, 1175, 1568].forEach((f, i) => a._tone(t + i * 0.09, 0.12, f, { type: 'square', gain: 0.03, release: 0.15, cutoff: 3500, out: a.sfx }));
  },
};

// ---------------------------------------------------------------- helpers

function gain(ctx, value, out) {
  const g = ctx.createGain();
  g.gain.value = value;
  if (out) g.connect(out);
  return g;
}

function filter(ctx, type, freq, q, out) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  if (q !== undefined) f.Q.value = q;
  if (out) f.connect(out);
  return f;
}
const lowpass = (ctx, freq, out) => filter(ctx, 'lowpass', freq, undefined, out);
const highpass = (ctx, freq, out) => filter(ctx, 'highpass', freq, undefined, out);
const bandpass = (ctx, freq, q, out) => filter(ctx, 'bandpass', freq, q, out);

function loop(ctx, buffer, out) {
  const s = ctx.createBufferSource();
  s.buffer = buffer;
  s.loop = true;
  s.connect(out);
  s.start();
  return s;
}

function noiseBuffer(ctx, seconds, kind) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  const r = rng(kind === 'brown' ? 7 : 3);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const w = r() * 2 - 1;
    if (kind === 'brown') {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else d[i] = w;
  }
  return buf;
}

/** A short room reverb's impulse: decaying noise. */
function impulse(ctx, seconds) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    const r = rng(11 + c);
    for (let i = 0; i < n; i++) d[i] = (r() * 2 - 1) * (1 - i / n) ** 3;
  }
  return buf;
}

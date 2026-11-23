// Procedural canvas textures for the building: carpet, ceiling tiles, signage, neon.
// Nothing is downloaded — every surface is painted here.
import * as THREE from 'three';
import { FONT } from './fonts.js';
import { makeCanvas, rng, shade, hexToRgb } from './util.js';
import { BRAND } from './config.js';

let maxAniso = 4;
export const setMaxAnisotropy = (n) => (maxAniso = n);

export function toTexture(canvas, { repeat = null, srgb = true, mipmaps = true } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  tex.generateMipmaps = mipmaps;
  tex.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  return tex;
}

// ----------------------------------------------------------- floors / ceiling / walls

/** Classic 90s "arcade confetti" carpet. One tile covers 2m x 2m. */
export function carpetTexture() {
  const S = 1024;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#141838';
  ctx.fillRect(0, 0, S, S);
  const r = rng(42);
  // fibre noise
  const img = ctx.getImageData(0, 0, S, S);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * 22;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n * 1.3;
  }
  ctx.putImageData(img, 0, 0);
  const colors = ['#1fd1c1', '#ff3d8b', '#ffc61a', '#8a5cff', '#3d7bff'];
  const wrapDraw = (fn, x, y) => {
    for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) {
      ctx.save();
      ctx.translate(x + dx, y + dy);
      fn();
      ctx.restore();
    }
  };
  for (let i = 0; i < 260; i++) {
    const x = r() * S;
    const y = r() * S;
    const col = colors[Math.floor(r() * colors.length)];
    const rot = r() * Math.PI * 2;
    const kind = Math.floor(r() * 4);
    const size = 10 + r() * 22;
    wrapDraw(() => {
      ctx.rotate(rot);
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = col;
      ctx.fillStyle = col;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      if (kind === 0) {
        ctx.moveTo(-size, 0);
        ctx.bezierCurveTo(-size / 2, -size, size / 2, size, size, 0);
        ctx.stroke();
      } else if (kind === 1) {
        ctx.moveTo(0, -size / 1.6);
        ctx.lineTo(size / 1.6, size / 2);
        ctx.lineTo(-size / 1.6, size / 2);
        ctx.closePath();
        ctx.stroke();
      } else if (kind === 2) {
        ctx.arc(0, 0, size / 4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.moveTo(-size / 2, -size / 2);
        ctx.lineTo(size / 2, size / 2);
        ctx.moveTo(size / 2, -size / 2);
        ctx.lineTo(-size / 2, size / 2);
        ctx.stroke();
      }
    }, x, y);
  }
  return toTexture(c);
}

/** Vinyl composite tile — entrance / checkout area. One texture = 4 tiles of 30cm. */
export function vctTexture() {
  const S = 256;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const r = rng(7);
  for (let i = 0; i < 4; i++) {
    const x = (i % 2) * 128;
    const y = Math.floor(i / 2) * 128;
    const light = i === 0 || i === 3;
    ctx.fillStyle = light ? '#e6dfcb' : '#262b56';
    ctx.fillRect(x, y, 128, 128);
    for (let k = 0; k < 140; k++) {
      ctx.fillStyle = `rgba(${light ? '60,60,80' : '255,255,255'},${r() * 0.12})`;
      ctx.fillRect(x + r() * 128, y + r() * 128, 2 + r() * 4, 1 + r() * 2);
    }
    ctx.strokeStyle = 'rgba(0,0,0,.25)';
    ctx.strokeRect(x + 0.5, y + 0.5, 127, 127);
  }
  return toTexture(c);
}

/** Acoustic drop-ceiling tile, 60cm square. */
export function ceilingTexture() {
  const S = 256;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#d9d6cc';
  ctx.fillRect(0, 0, S, S);
  const r = rng(3);
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(80,70,60,${0.05 + r() * 0.12})`;
    ctx.fillRect(r() * S, r() * S, 1 + r() * 2, 1 + r() * 2);
  }
  ctx.fillStyle = '#b9b5a8';
  ctx.fillRect(0, 0, S, 5);
  ctx.fillRect(0, 0, 5, S);
  return toTexture(c);
}

/** Perforated hardboard backing for shelves. One texture = 30cm. */
export function pegboardTexture() {
  const S = 128;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#2a3366';
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = '#121838';
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    ctx.beginPath();
    ctx.arc(16 + x * 32, 16 + y * 32, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  return toTexture(c);
}

/** Painted wall with a racing stripe. Spans the full wall height (vertical v 0..1). */
export function wallTexture() {
  const c = makeCanvas(64, 512);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#2b2350');
  g.addColorStop(0.3, '#3a2f6b');
  g.addColorStop(1, '#1b1840');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 512);
  // stripe at ~2.45–2.6m on a 3.4m wall
  const y0 = 512 * (1 - 2.62 / 3.4);
  ctx.fillStyle = BRAND.magenta;
  ctx.fillRect(0, y0, 64, 10);
  ctx.fillStyle = BRAND.yellow;
  ctx.fillRect(0, y0 + 14, 64, 6);
  ctx.fillStyle = BRAND.cyan;
  ctx.fillRect(0, y0 + 24, 64, 3);
  return toTexture(c);
}

/** A shipping box side: kraft card, packing tape and a stencilled label. One texture = 50cm. */
export function cardboardTexture() {
  const S = 256;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#b8895a';
  ctx.fillRect(0, 0, S, S);
  const r = rng(9);
  for (let i = 0; i < 1400; i++) {
    ctx.fillStyle = `rgba(${r() < 0.5 ? '90,60,30' : '230,200,160'},${0.05 + r() * 0.08})`;
    ctx.fillRect(r() * S, r() * S, 1 + r() * 3, 1);
  }
  ctx.fillStyle = 'rgba(214,190,140,.85)'; // tape
  ctx.fillRect(S / 2 - 22, 0, 44, S);
  ctx.fillStyle = 'rgba(40,24,12,.8)';
  ctx.font = `34px ${FONT.bebas}`;
  ctx.textAlign = 'center';
  ctx.fillText('VHS', S * 0.2, S * 0.3);
  ctx.fillText('NEW', S * 0.8, S * 0.3);
  ctx.font = `22px ${FONT.bebas}`;
  ctx.fillText('THIS SIDE UP', S * 0.2, S * 0.82);
  ctx.fillText('FRAGILE', S * 0.8, S * 0.82);
  return toTexture(c);
}

export function asphaltTexture() {
  const S = 256;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#16161b';
  ctx.fillRect(0, 0, S, S);
  const r = rng(11);
  for (let i = 0; i < 2500; i++) {
    const v = 20 + r() * 40;
    ctx.fillStyle = `rgb(${v},${v},${v + 4})`;
    ctx.fillRect(r() * S, r() * S, 1, 1);
  }
  return toTexture(c);
}

/** The sky behind the parking lot: 'night' (the default), 'dawn', 'day' or 'dusk'. */
export function nightSkyTexture(phase = 'night') {
  return toTexture(skyCanvas(phase));
}

const SKIES = {
  night: { stops: ['#05040f', '#1b1240', '#4a1d52', '#ff7a59'], stars: 160, city: '#0a0818', lit: 0.4 },
  dawn: { stops: ['#1d2b63', '#5b4f8f', '#e58a7d', '#ffd29a'], stars: 30, city: '#1a1830', lit: 0.18 },
  day: { stops: ['#2f7fd6', '#63a9ea', '#a9d4f5', '#e2f2fb'], stars: 0, city: '#5f6f91', lit: 0, clouds: 9 },
  dusk: { stops: ['#141238', '#4c2462', '#c2456a', '#ffa25c'], stars: 50, city: '#120d26', lit: 0.3, clouds: 4 },
};

export function skyCanvas(phase = 'night') {
  const sky = SKIES[phase] || SKIES.night;
  const c = makeCanvas(1024, 512);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  [0, 0.55, 0.8, 1].forEach((t, i) => g.addColorStop(t, sky.stops[i]));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 512);
  const r = rng(99);
  for (let i = 0; i < sky.stars; i++) {
    ctx.fillStyle = `rgba(255,255,255,${r() * 0.8})`;
    ctx.fillRect(r() * 1024, r() * 300, 1.5, 1.5);
  }
  // soft clouds
  const cr = rng(7);
  for (let i = 0; i < (sky.clouds || 0); i++) {
    const cx = cr() * 1024;
    const cy = 60 + cr() * 220;
    ctx.fillStyle = phase === 'day' ? 'rgba(255,255,255,.55)' : 'rgba(255,190,170,.25)';
    for (let k = 0; k < 6; k++) {
      ctx.beginPath();
      ctx.ellipse(cx + (cr() - 0.5) * 120, cy + (cr() - 0.5) * 18, 40 + cr() * 50, 12 + cr() * 10, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // distant skyline (the same buildings whatever the time; windows lit after dark)
  ctx.fillStyle = sky.city;
  let x = 0;
  const rr = rng(99 * 7);
  while (x < 1024) {
    const w = 30 + rr() * 70;
    const h = 40 + rr() * 120;
    ctx.fillRect(x, 512 - h, w, h);
    for (let k = 0; k < (w * h) / 500; k++) {
      if (rr() < sky.lit) {
        ctx.fillStyle = rr() < 0.7 ? 'rgba(255,214,120,.8)' : 'rgba(120,220,255,.7)';
        ctx.fillRect(x + 4 + Math.floor(rr() * (w - 8) / 7) * 7, 512 - h + 6 + Math.floor(rr() * (h - 10) / 9) * 9, 3, 4);
        ctx.fillStyle = sky.city;
      }
    }
    x += w + 4;
  }
  return c;
}

/**
 * An LED "OPEN" sign: rows of lit dots on clear acrylic (transparent, for additive
 * blending), with a chasing border. `frame` (0 or 1) moves the chase along a dot.
 * `mirror` draws it back to front: it faces the street, so inside you see it reversed.
 */
export function ledSignTexture(lines, { color = '#ff2d4a', accent = '#2ee6ff', frame = 0, mirror = false, w = 768, h = 320 } = {}) {
  // the lettering, drawn plainly and then sampled into dots
  const mask = makeCanvas(w, h);
  const m = mask.getContext('2d');
  m.fillStyle = '#fff';
  m.textAlign = 'center';
  m.textBaseline = 'middle';
  const sizes = [h * 0.46, h * 0.22];
  const ys = [h * 0.4, h * 0.78];
  lines.forEach((line, i) => {
    m.font = `${sizes[i] || sizes[1]}px ${FONT.bungee}`;
    m.fillText(line, w / 2, ys[i] || ys[1], w * 0.86);
  });
  const data = m.getImageData(0, 0, w, h).data;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  if (mirror) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  const pitch = 8;
  const dot = (x, y, col, rad = pitch * 0.46) => {
    ctx.fillStyle = col;
    ctx.shadowColor = col;
    ctx.shadowBlur = pitch * 0.9;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  };
  for (let y = pitch; y < h - pitch; y += pitch) {
    for (let x = pitch; x < w - pitch; x += pitch) {
      if (data[(Math.round(y) * w + Math.round(x)) * 4 + 3] > 100) dot(x, y, y < h * 0.6 ? color : accent);
    }
  }
  // the border: every other dot lit, stepping along each frame
  let k = 0;
  const edge = (x, y) => {
    if ((k++ + frame) % 2 === 0) dot(x, y, '#ffc61a', pitch * 0.3);
  };
  for (let x = 4; x < w - 4; x += pitch) edge(x, 4);
  for (let y = 4; y < h - 4; y += pitch) edge(w - 4, y);
  for (let x = w - 4; x > 4; x -= pitch) edge(x, h - 4);
  for (let y = h - 4; y > 4; y -= pitch) edge(4, y);
  return toTexture(c);
}

// ----------------------------------------------------------- signage

function contrastText(hex) {
  const { r, g, b } = hexToRgb(hex);
  return r * 0.299 + g * 0.587 + b * 0.114 > 150 ? '#121a3d' : '#ffffff';
}

/** Header sign that sits on top of a shelving run. widthM/heightM are in metres. */
export function headerSignTexture(label, color, widthM, heightM) {
  const pxPerM = 360;
  const w = Math.min(2048, Math.round(widthM * pxPerM));
  const h = Math.round(heightM * pxPerM);
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, shade(color, 0.12));
  g.addColorStop(1, shade(color, -0.25));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,.85)';
  ctx.lineWidth = h * 0.05;
  ctx.strokeRect(h * 0.08, h * 0.08, w - h * 0.16, h - h * 0.16);
  ctx.fillStyle = contrastText(color);
  ctx.font = `${h * 0.64}px ${FONT.bebas}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const text = label.toUpperCase();
  const copies = widthM > 3.2 ? 2 : 1;
  for (let i = 0; i < copies; i++) {
    ctx.fillText(text, (w * (i + 0.5)) / copies, h * 0.55, w / copies - h * 0.5);
  }
  return toTexture(c);
}

/** Double-sided hanging aisle marker. */
export function aisleSignTexture(number, labels) {
  const w = 768;
  const h = 300;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = BRAND.navy;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = BRAND.yellow;
  ctx.fillRect(0, 0, 150, h);
  ctx.fillStyle = BRAND.navy;
  ctx.font = `48px ${FONT.bebas}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('AISLE', 75, 70);
  ctx.font = `150px ${FONT.anton}`;
  ctx.fillText(String(number), 75, 180);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'left';
  const shown = labels.slice(0, 3);
  const size = shown.length <= 1 ? 96 : shown.length === 2 ? 80 : 64;
  ctx.font = `${size}px ${FONT.bebas}`;
  shown.forEach((l, i) => {
    const y = h / 2 + (i - (shown.length - 1) / 2) * size * 0.95;
    ctx.fillText(l.toUpperCase(), 180, y + 4, w - 210);
  });
  ctx.strokeStyle = BRAND.magenta;
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, w - 10, h - 10);
  return toTexture(c);
}

/** Glowing neon text on a transparent background. */
export function neonTexture(text, color, { font = FONT.monoton, size = 160, padding = 60, subtitle = null, subColor = null, subFont = FONT.righteous } = {}) {
  const probe = makeCanvas(8, 8).getContext('2d');
  probe.font = `${size}px ${font}`;
  const tw = probe.measureText(text).width;
  let sw = 0;
  const subSize = size * 0.42;
  if (subtitle) {
    probe.font = `${subSize}px ${subFont}`;
    sw = probe.measureText(subtitle).width;
  }
  const w = Math.ceil(Math.max(tw, sw) + padding * 2);
  const h = Math.ceil(size * 1.25 + (subtitle ? subSize * 1.4 : 0) + padding * 2);
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const drawGlow = (str, f, y, col) => {
    ctx.font = f;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [blur, alpha] of [[size * 0.5, 0.55], [size * 0.22, 0.8], [size * 0.08, 1]]) {
      ctx.shadowColor = col;
      ctx.shadowBlur = blur;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = col;
      ctx.fillText(str, w / 2, y);
    }
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.fillText(str, w / 2, y);
  };
  const titleY = padding + size * 0.62;
  drawGlow(text, `${size}px ${font}`, titleY, color);
  if (subtitle) drawGlow(subtitle, `${subSize}px ${subFont}`, titleY + size * 0.62 + subSize * 0.8, subColor || color);
  const tex = toTexture(c);
  tex.userData.aspect = w / h;
  return tex;
}

/** Text panel with optional background — for counter fronts, return box, etc. */
export function panelTexture(lines, { w = 512, h = 256, bg = BRAND.navy, fg = '#fff', font = FONT.bebas, border = BRAND.yellow } = {}) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  if (border) {
    ctx.strokeStyle = border;
    ctx.lineWidth = h * 0.05;
    ctx.strokeRect(h * 0.05, h * 0.05, w - h * 0.1, h - h * 0.1);
  }
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const size = (h * (lines.length > 1 ? 0.5 : 0.62)) / lines.length;
  lines.forEach((l, i) => {
    ctx.font = `${size}px ${font}`;
    ctx.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * size * 1.3, w * 0.88);
  });
  return toTexture(c);
}

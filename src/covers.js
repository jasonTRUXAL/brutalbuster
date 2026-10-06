// Procedural VHS box art. Every tape gets a front cover built from its YouTube
// thumbnail (auto-cropped of black bars) or, when there is no thumbnail, generated art.
// All drawing is resolution independent: layouts are designed on a 160x280 grid
// and scaled by s = width / 160.
import { FONT } from './fonts.js';
import { hash, rng, shade, rgba, hexToRgb, makeCanvas } from './util.js';

// ---------------------------------------------------------------- thumbnails

const thumbPromises = new Map();
const thumbs = new Map(); // video.id -> { img, crop } | null

export function loadThumb(video) {
  if (!video.thumb) return Promise.resolve(null);
  if (!thumbPromises.has(video.id)) {
    thumbPromises.set(
      video.id,
      new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.decoding = 'async';
        const done = (val) => {
          thumbs.set(video.id, val);
          resolve(val);
        };
        const timer = setTimeout(() => done(null), 15000);
        img.onload = () => {
          clearTimeout(timer);
          // YouTube serves a 120x90 grey placeholder for missing thumbnails.
          if (img.naturalWidth <= 120) return done(null);
          try {
            done({ img, crop: detectCrop(img) });
          } catch {
            done({ img, crop: { sx: 0, sy: 0, sw: img.naturalWidth, sh: img.naturalHeight } });
          }
        };
        img.onerror = () => {
          clearTimeout(timer);
          done(null);
        };
        img.src = video.thumb;
      }),
    );
  }
  return thumbPromises.get(video.id);
}

export const getThumb = (video) => thumbs.get(video.id) || null;

/** Find the picture inside letterbox / pillarbox bars. */
function detectCrop(img) {
  const W = 96;
  const H = 72;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  const lum = (x, y) => {
    const i = (y * W + x) * 4;
    return d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
  };
  const rowDark = (y, x0 = 0, x1 = W) => {
    let sum = 0;
    let max = 0;
    for (let x = x0; x < x1; x++) {
      const l = lum(x, y);
      sum += l;
      if (l > max) max = l;
    }
    return sum / (x1 - x0) < 20 && max < 48;
  };
  const colDark = (x, y0, y1) => {
    let sum = 0;
    let max = 0;
    for (let y = y0; y < y1; y++) {
      const l = lum(x, y);
      sum += l;
      if (l > max) max = l;
    }
    return sum / (y1 - y0) < 20 && max < 48;
  };
  let top = 0;
  while (top < H * 0.3 && rowDark(top)) top++;
  let bot = H - 1;
  while (bot > H * 0.7 && rowDark(bot)) bot--;
  let left = 0;
  while (left < W * 0.3 && colDark(left, top, bot + 1)) left++;
  let right = W - 1;
  while (right > W * 0.7 && colDark(right, top, bot + 1)) right--;
  const kx = img.naturalWidth / W;
  const ky = img.naturalHeight / H;
  const inset = 1;
  return {
    sx: (left + inset) * kx,
    sy: (top + inset) * ky,
    sw: (right - left + 1 - inset * 2) * kx,
    sh: (bot - top + 1 - inset * 2) * ky,
  };
}

// ---------------------------------------------------------------- helpers

function drawThumbCover(ctx, thumb, x, y, w, h, focusY = 0.45) {
  const { img, crop } = thumb;
  const srcAspect = crop.sw / crop.sh;
  const dstAspect = w / h;
  let sw = crop.sw;
  let sh = crop.sh;
  let sx = crop.sx;
  let sy = crop.sy;
  if (srcAspect > dstAspect) {
    sw = crop.sh * dstAspect;
    sx = crop.sx + (crop.sw - sw) / 2;
  } else {
    sh = crop.sw / dstAspect;
    sy = crop.sy + (crop.sh - sh) * focusY;
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function drawThumbContain(ctx, thumb, x, y, w, h) {
  const { img, crop } = thumb;
  const k = Math.min(w / crop.sw, h / crop.sh);
  const dw = crop.sw * k;
  const dh = crop.sh * k;
  ctx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function wrap(ctx, text, maxW) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width <= maxW || !line) line = test;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Choose the largest font size at which `text` fits in the box. */
function fit(ctx, text, font, maxW, maxH, maxLines, maxSize, minSize, lineH = 0.92) {
  const step = Math.max(1, maxSize / 40);
  for (let size = maxSize; size >= minSize; size -= step) {
    ctx.font = font(size);
    const lines = wrap(ctx, text, maxW);
    if (lines.length <= maxLines && lines.length * size * lineH <= maxH && lines.every((l) => ctx.measureText(l).width <= maxW)) {
      return { size, lines, lineH: size * lineH };
    }
  }
  ctx.font = font(minSize);
  let lines = wrap(ctx, text, maxW);
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + '…';
  }
  return { size: minSize, lines, lineH: minSize * lineH };
}

function drawLines(ctx, fitted, x, y, maxW, align = 'center', stroke = null) {
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  fitted.lines.forEach((l, i) => {
    const ly = y + i * fitted.lineH;
    if (stroke) {
      ctx.lineJoin = 'round';
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.strokeText(l, x, ly, maxW);
    }
    ctx.fillText(l, x, ly, maxW);
  });
  return y + fitted.lines.length * fitted.lineH;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function isLight(hex) {
  const { r, g, b } = hexToRgb(hex);
  return r * 0.299 + g * 0.587 + b * 0.114 > 150;
}

function vhsLogo(ctx, x, y, s, color = '#fff') {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.2 * s;
  roundRect(ctx, x, y, 26 * s, 11 * s, 2 * s);
  ctx.stroke();
  ctx.font = `italic 700 ${8.5 * s}px ${FONT.narrow}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('VHS', x + 13 * s, y + 5.8 * s);
  ctx.restore();
}

function catalogSticker(ctx, x, y, s, d) {
  ctx.save();
  ctx.fillStyle = '#f7f3e8';
  ctx.fillRect(x, y, 34 * s, 14 * s);
  const r = rng(d.seed ^ 0x9e3779b9);
  ctx.fillStyle = '#111';
  let bx = x + 2 * s;
  while (bx < x + 32 * s) {
    const bw = (0.5 + r() * 1.3) * s;
    ctx.fillRect(bx, y + 2 * s, bw, 6.5 * s);
    bx += bw + (0.4 + r() * 1.1) * s;
  }
  ctx.font = `${5 * s}px ${FONT.narrow}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(d.catNo, x + 17 * s, y + 8.8 * s);
  ctx.restore();
}

function roundSticker(ctx, x, y, s, text, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.25);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, 13 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.85)';
  ctx.lineWidth = 1 * s;
  ctx.beginPath();
  ctx.arc(0, 0, 11 * s, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `${7.5 * s}px ${FONT.bungee}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 0.5 * s, 22 * s);
  ctx.restore();
}

// ---------------------------------------------------------------- generated art

const ART_PALETTES = [
  ['#2b0b3f', '#ff2e88', '#ffb000', '#2ee6ff'],
  ['#05162b', '#18ffff', '#7c4dff', '#ff4fa3'],
  ['#1d0a05', '#ff7a00', '#ffd54f', '#ff1744'],
  ['#071d12', '#3ddc84', '#c6ff00', '#00e5c0'],
  ['#14072b', '#b388ff', '#ff4fa3', '#ffe57f'],
];

export function drawArt(ctx, x, y, w, h, seed, accent) {
  const r = rng(seed);
  const pal = ART_PALETTES[seed % ART_PALETTES.length].slice();
  if (accent) pal[1] = accent;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const style = (seed >>> 3) % 5;
  if (style === 0) {
    // Synthwave sunset
    const g = ctx.createLinearGradient(0, y, 0, y + h * 0.62);
    g.addColorStop(0, pal[0]);
    g.addColorStop(0.6, shade(pal[1], -0.35));
    g.addColorStop(1, pal[2]);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    const cx = x + w / 2;
    const cy = y + h * 0.6;
    const R = w * 0.32;
    const sg = ctx.createLinearGradient(0, cy - R, 0, cy);
    sg.addColorStop(0, '#ffe57f');
    sg.addColorStop(1, pal[1]);
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(cx, cy, R, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = shade(pal[1], -0.3);
    for (let i = 0; i < 6; i++) {
      const by = cy - R * 0.08 - i * R * 0.15;
      ctx.fillRect(cx - R, by, R * 2, R * 0.05 + i * 0.6);
    }
    ctx.fillStyle = pal[0];
    ctx.fillRect(x, cy, w, h);
    ctx.strokeStyle = pal[3];
    ctx.lineWidth = Math.max(1, w / 140);
    ctx.globalAlpha = 0.85;
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      ctx.beginPath();
      ctx.moveTo(cx + (t - 0.5) * w * 0.3, cy);
      ctx.lineTo(cx + (t - 0.5) * w * 3, y + h);
      ctx.stroke();
    }
    for (let i = 1; i < 9; i++) {
      const t = Math.pow(i / 9, 2);
      const ly = cy + t * (y + h - cy);
      ctx.beginPath();
      ctx.moveTo(x, ly);
      ctx.lineTo(x + w, ly);
      ctx.stroke();
    }
  } else if (style === 1) {
    // Space: stars + ringed planet
    ctx.fillStyle = pal[0];
    ctx.fillRect(x, y, w, h);
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.7})`;
      const sz = r() < 0.9 ? w / 200 : w / 90;
      ctx.fillRect(x + r() * w, y + r() * h, sz, sz);
    }
    const px = x + w * (0.35 + r() * 0.3);
    const py = y + h * (0.35 + r() * 0.25);
    const pr = w * (0.2 + r() * 0.12);
    const pg = ctx.createRadialGradient(px - pr * 0.4, py - pr * 0.4, pr * 0.1, px, py, pr);
    pg.addColorStop(0, shade(pal[1], 0.4));
    pg.addColorStop(1, shade(pal[1], -0.55));
    ctx.fillStyle = pg;
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = pal[2];
    ctx.lineWidth = w / 60;
    ctx.beginPath();
    ctx.ellipse(px, py, pr * 1.7, pr * 0.35, -0.3, 0, Math.PI * 2);
    ctx.stroke();
  } else if (style === 2) {
    // Memphis shapes
    ctx.fillStyle = shade(pal[3], 0.75);
    ctx.fillRect(x, y, w, h);
    for (let i = 0; i < 16; i++) {
      ctx.fillStyle = pal[1 + Math.floor(r() * 3)];
      ctx.strokeStyle = '#111';
      ctx.lineWidth = w / 90;
      const sx = x + r() * w;
      const sy = y + r() * h;
      const sz = w * (0.06 + r() * 0.14);
      const kind = Math.floor(r() * 3);
      ctx.beginPath();
      if (kind === 0) ctx.arc(sx, sy, sz / 2, 0, Math.PI * 2);
      else if (kind === 1) {
        ctx.moveTo(sx, sy - sz / 2);
        ctx.lineTo(sx + sz / 2, sy + sz / 2);
        ctx.lineTo(sx - sz / 2, sy + sz / 2);
        ctx.closePath();
      } else {
        ctx.moveTo(sx - sz, sy);
        for (let k = 0; k < 5; k++) ctx.lineTo(sx - sz + (k + 1) * (sz / 2.5), sy + (k % 2 ? -1 : 1) * sz * 0.25);
      }
      if (kind < 2) ctx.fill();
      ctx.stroke();
    }
  } else if (style === 3) {
    // Test pattern / colour bars
    const bars = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
    const bw = w / bars.length;
    bars.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect(x + i * bw, y, bw + 1, h * 0.68);
    });
    ctx.fillStyle = '#101010';
    ctx.fillRect(x, y + h * 0.68, w, h);
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(x + w * 0.1, y + h * 0.75, w * 0.25, h * 0.2);
    ctx.fillStyle = pal[1];
    ctx.fillRect(x + w * 0.5, y + h * 0.75, w * 0.4, h * 0.2);
  } else {
    // Layered mountains under a big moon
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, pal[0]);
    g.addColorStop(1, shade(pal[1], -0.2));
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(255,245,220,.9)';
    ctx.beginPath();
    ctx.arc(x + w * (0.25 + r() * 0.5), y + h * 0.28, w * 0.13, 0, Math.PI * 2);
    ctx.fill();
    for (let layer = 0; layer < 4; layer++) {
      ctx.fillStyle = shade(pal[0], -0.15 - layer * 0.18);
      ctx.beginPath();
      const base = y + h * (0.55 + layer * 0.12);
      ctx.moveTo(x, y + h);
      ctx.lineTo(x, base);
      let px = x;
      while (px < x + w) {
        px += w * (0.08 + r() * 0.15);
        ctx.lineTo(px, base - h * (0.05 + r() * 0.15));
      }
      ctx.lineTo(x + w, y + h);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawPicture(ctx, d, x, y, w, h, focusY) {
  if (d.thumb) drawThumbCover(ctx, d.thumb, x, y, w, h, focusY);
  else drawArt(ctx, x, y, w, h, d.seed, d.color);
}

// ---------------------------------------------------------------- front covers

const STICKERS = ['RARE!', 'HI-FI', 'CULT!', 'GEM!'];

/** Everything a cover needs, gathered from the video + aisle. */
export function coverData(video, aisle, store) {
  const seed = hash(video.id);
  return {
    seed,
    title: video.title.toUpperCase(),
    rawTitle: video.title,
    description: video.description,
    year: video.year,
    duration: video.duration,
    aisleName: aisle?.name || 'Rare Finds',
    color: aisle?.color || '#ffc61a',
    thumb: getThumb(video),
    store,
    catNo: `${(store?.name || 'BB').slice(0, 2).toUpperCase()}-${String(seed % 10000).padStart(4, '0')}`,
  };
}

export function drawCover(ctx, w, h, d) {
  const s = w / 160;
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  const template = d.seed % 4;
  if (template === 0) coverClassic(ctx, w, h, s, d);
  else if (template === 1) coverBleed(ctx, w, h, s, d);
  else if (template === 2) coverBlock(ctx, w, h, s, d);
  else coverChrome(ctx, w, h, s, d);

  const r = rng(d.seed ^ 0x51ed);
  if (r() < 0.3) roundSticker(ctx, w - 20 * s, 34 * s, s, STICKERS[Math.floor(r() * STICKERS.length)], r() < 0.5 ? '#ff2e88' : '#ff7a00');

  // Sleeve wear: subtle vignette + edge darkening
  const v = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,.35)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function coverClassic(ctx, w, h, s, d) {
  ctx.fillStyle = '#0c0c10';
  ctx.fillRect(0, 0, w, h);
  // aisle band
  ctx.fillStyle = d.color;
  ctx.fillRect(0, 0, w, 20 * s);
  ctx.fillStyle = isLight(d.color) ? '#111' : '#fff';
  ctx.font = `${12 * s}px ${FONT.bebas}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(d.aisleName.toUpperCase(), w / 2, 10.8 * s, w - 12 * s);
  // picture
  const px = 8 * s;
  const py = 26 * s;
  const pw = w - 16 * s;
  const ph = 148 * s;
  drawPicture(ctx, d, px, py, pw, ph, 0.4);
  ctx.strokeStyle = 'rgba(255,255,255,.85)';
  ctx.lineWidth = 1.5 * s;
  ctx.strokeRect(px, py, pw, ph);
  // title
  ctx.fillStyle = '#fff';
  const f = fit(ctx, d.title, (z) => `${z}px ${FONT.anton}`, w - 18 * s, 62 * s, 3, 30 * s, 9 * s, 1.0);
  const blockH = f.lines.length * f.lineH;
  drawLines(ctx, f, w / 2, 180 * s + (62 * s - blockH) / 2, w - 18 * s);
  ctx.fillStyle = d.color;
  ctx.fillRect(w / 2 - 22 * s, 246 * s, 44 * s, 2 * s);
  // footer
  vhsLogo(ctx, 8 * s, 258 * s, s, 'rgba(255,255,255,.8)');
  catalogSticker(ctx, w - 42 * s, 256 * s, s, d);
  if (d.year) {
    ctx.fillStyle = d.color;
    ctx.font = `${14 * s}px ${FONT.vt}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(d.year), 40 * s, 264 * s);
  }
}

function coverBleed(ctx, w, h, s, d) {
  drawPicture(ctx, d, 0, 0, w, h, 0.35);
  const g = ctx.createLinearGradient(0, h * 0.42, 0, h);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.45, 'rgba(0,0,0,.75)');
  g.addColorStop(1, 'rgba(0,0,0,.95)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const tg = ctx.createLinearGradient(0, 0, 0, 40 * s);
  tg.addColorStop(0, 'rgba(0,0,0,.7)');
  tg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = tg;
  ctx.fillRect(0, 0, w, 40 * s);
  ctx.fillStyle = d.color;
  ctx.fillRect(0, 0, 5 * s, h);
  ctx.fillStyle = 'rgba(255,255,255,.8)';
  ctx.font = `700 ${7 * s}px ${FONT.narrow}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(`${(d.store?.name || '').toUpperCase()} PRESENTS`, w / 2 + 2 * s, 8 * s, w - 20 * s);
  ctx.fillStyle = shade(d.color, 0.35);
  const f = fit(ctx, d.title, (z) => `${z}px ${FONT.bungee}`, w - 22 * s, 66 * s, 3, 24 * s, 8 * s, 1.02);
  const blockH = f.lines.length * f.lineH;
  drawLines(ctx, f, w / 2 + 2 * s, 236 * s - blockH, w - 22 * s, 'center', { color: 'rgba(0,0,0,.9)', width: 3 * s });
  ctx.fillStyle = 'rgba(255,255,255,.75)';
  ctx.font = `${12 * s}px ${FONT.vt}`;
  ctx.textAlign = 'center';
  const meta = [d.year, d.duration].filter(Boolean).join('  ·  ');
  if (meta) ctx.fillText(meta, w / 2 + 2 * s, 242 * s);
  vhsLogo(ctx, w / 2 - 11 * s, 262 * s, s, 'rgba(255,255,255,.7)');
}

function coverBlock(ctx, w, h, s, d) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, shade(d.color, 0.15));
  g.addColorStop(1, shade(d.color, -0.45));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // halftone dots
  ctx.fillStyle = 'rgba(0,0,0,.12)';
  for (let yy = 0; yy < h; yy += 6 * s) for (let xx = (yy / (6 * s)) % 2 ? 3 * s : 0; xx < w; xx += 6 * s) {
    ctx.beginPath();
    ctx.arc(xx, yy, 1.1 * s, 0, Math.PI * 2);
    ctx.fill();
  }
  const dark = isLight(d.color);
  ctx.fillStyle = dark ? '#14101c' : '#fff';
  const f = fit(ctx, d.title, (z) => `${z}px ${FONT.righteous}`, w - 18 * s, 66 * s, 3, 26 * s, 8 * s, 1.0);
  const blockH = f.lines.length * f.lineH;
  drawLines(ctx, f, w / 2, 10 * s + (66 * s - blockH) / 2, w - 18 * s);
  // tilted snapshot
  const r = rng(d.seed);
  ctx.save();
  ctx.translate(w / 2, 148 * s);
  ctx.rotate((r() - 0.5) * 0.12);
  ctx.shadowColor = 'rgba(0,0,0,.45)';
  ctx.shadowBlur = 8 * s;
  ctx.shadowOffsetY = 3 * s;
  ctx.fillStyle = '#f6f1e4';
  ctx.fillRect(-64 * s, -64 * s, 128 * s, 132 * s);
  ctx.shadowColor = 'transparent';
  drawPicture(ctx, d, -58 * s, -58 * s, 116 * s, 104 * s, 0.45);
  ctx.restore();
  ctx.fillStyle = dark ? '#14101c' : '#fff';
  ctx.font = `${16 * s}px ${FONT.bebas}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(d.aisleName.toUpperCase(), 9 * s, 238 * s, w - 18 * s);
  vhsLogo(ctx, 9 * s, 256 * s, s, dark ? '#14101c' : '#fff');
  catalogSticker(ctx, w - 42 * s, 255 * s, s, d);
}

function coverChrome(ctx, w, h, s, d) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#07051a');
  g.addColorStop(0.55, '#1b0b3a');
  g.addColorStop(1, '#3a0b3a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // laser grid floor
  ctx.strokeStyle = rgba(d.color, 0.55);
  ctx.lineWidth = 1 * s;
  for (let i = 0; i <= 10; i++) {
    ctx.beginPath();
    ctx.moveTo(w / 2 + (i - 5) * 6 * s, 196 * s);
    ctx.lineTo(w / 2 + (i - 5) * 40 * s, h);
    ctx.stroke();
  }
  for (let i = 0; i < 6; i++) {
    const yy = 196 * s + Math.pow(i / 6, 1.8) * (h - 196 * s);
    ctx.beginPath();
    ctx.moveTo(0, yy);
    ctx.lineTo(w, yy);
    ctx.stroke();
  }
  // title in chrome gradient
  const f = fit(ctx, d.title, (z) => `${z}px ${FONT.bebas}`, w - 16 * s, 70 * s, 3, 40 * s, 10 * s, 0.9);
  const blockH = f.lines.length * f.lineH;
  const ty = 12 * s + (70 * s - blockH) / 2;
  const cg = ctx.createLinearGradient(0, ty, 0, ty + blockH);
  cg.addColorStop(0, '#fff6c2');
  cg.addColorStop(0.5, '#ffc61a');
  cg.addColorStop(0.51, '#ff7a00');
  cg.addColorStop(1, '#ff2e88');
  ctx.fillStyle = cg;
  drawLines(ctx, f, w / 2, ty, w - 16 * s, 'center', { color: '#1a0630', width: 3.2 * s });
  // window
  ctx.save();
  ctx.shadowColor = d.color;
  ctx.shadowBlur = 10 * s;
  ctx.strokeStyle = d.color;
  ctx.lineWidth = 2 * s;
  roundRect(ctx, 12 * s, 88 * s, w - 24 * s, 108 * s, 6 * s);
  ctx.stroke();
  ctx.restore();
  ctx.save();
  roundRect(ctx, 12 * s, 88 * s, w - 24 * s, 108 * s, 6 * s);
  ctx.clip();
  drawPicture(ctx, d, 12 * s, 88 * s, w - 24 * s, 108 * s, 0.45);
  ctx.restore();
  ctx.fillStyle = '#fff';
  ctx.font = `${8 * s}px ${FONT.pixel}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(d.aisleName.toUpperCase(), w / 2, 214 * s, w - 20 * s);
  if (d.year) {
    ctx.fillStyle = d.color;
    ctx.font = `${15 * s}px ${FONT.vt}`;
    ctx.fillText(String(d.year), w / 2, 230 * s);
  }
  vhsLogo(ctx, w / 2 - 13 * s, 258 * s, s, 'rgba(255,255,255,.85)');
}

// ---------------------------------------------------------------- back cover + spine

export function drawBack(ctx, w, h, d) {
  const s = w / 160;
  ctx.save();
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#111018');
  g.addColorStop(1, shade(d.color, -0.78));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = d.color;
  const f = fit(ctx, d.title, (z) => `${z}px ${FONT.anton}`, w - 20 * s, 34 * s, 2, 18 * s, 8 * s, 1.02);
  let y = drawLines(ctx, f, w / 2, 10 * s, w - 20 * s);

  // screenshot
  y += 6 * s;
  const ph = 70 * s;
  ctx.fillStyle = '#000';
  ctx.fillRect(10 * s, y, w - 20 * s, ph);
  if (d.thumb) drawThumbContain(ctx, d.thumb, 10 * s, y, w - 20 * s, ph);
  else drawArt(ctx, 10 * s, y, w - 20 * s, ph, d.seed, d.color);
  ctx.strokeStyle = 'rgba(255,255,255,.6)';
  ctx.lineWidth = 1 * s;
  ctx.strokeRect(10 * s, y, w - 20 * s, ph);
  y += ph + 8 * s;

  // synopsis
  const text = d.description || 'No synopsis on file. Ask a clerk — or just rent it and find out.';
  ctx.fillStyle = 'rgba(255,255,255,.88)';
  const size = 7.4 * s;
  ctx.font = `${size}px ${FONT.narrow}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const paragraphs = text.split(/\n+/).filter(Boolean);
  const maxY = 214 * s;
  outer: for (const para of paragraphs) {
    const lines = wrap(ctx, para, w - 22 * s);
    for (let i = 0; i < lines.length; i++) {
      if (y + size * 1.25 > maxY) {
        ctx.fillText('…', 11 * s, y - size * 0.4);
        break outer;
      }
      ctx.fillText(lines[i], 11 * s, y, w - 22 * s);
      y += size * 1.22;
    }
    y += size * 0.5;
  }

  // details strip
  ctx.fillStyle = rgba(d.color, 0.18);
  ctx.fillRect(10 * s, 218 * s, w - 20 * s, 18 * s);
  ctx.fillStyle = '#fff';
  ctx.font = `${10 * s}px ${FONT.vt}`;
  ctx.textBaseline = 'middle';
  const info = [d.year && `${d.year}`, d.duration && `${d.duration}`, d.aisleName.toUpperCase()].filter(Boolean).join('  •  ');
  ctx.textAlign = 'center';
  ctx.fillText(info, w / 2, 227.5 * s, w - 24 * s);

  catalogSticker(ctx, 10 * s, 248 * s, s, d);
  vhsLogo(ctx, w - 38 * s, 249 * s, s, 'rgba(255,255,255,.75)');
  ctx.fillStyle = 'rgba(255,255,255,.5)';
  ctx.font = `${5.5 * s}px ${FONT.narrow}`;
  ctx.textAlign = 'center';
  ctx.fillText('DIGITIZED FROM ORIGINAL VIDEOCASSETTE', w / 2, 272 * s, w - 20 * s);

  // Be kind sticker
  ctx.save();
  ctx.translate(w - 34 * s, 214 * s);
  ctx.rotate(0.12);
  ctx.fillStyle = '#ffc61a';
  roundRect(ctx, -24 * s, -10 * s, 48 * s, 20 * s, 3 * s);
  ctx.fill();
  ctx.fillStyle = '#121a3d';
  ctx.font = `${6.2 * s}px ${FONT.bungee}`;
  ctx.textAlign = 'center';
  ctx.fillText('BE KIND', 0, -3.5 * s);
  ctx.fillText('REWIND', 0, 4.5 * s);
  ctx.restore();
  ctx.restore();
}

export function drawSpine(ctx, w, h, d) {
  const s = w / 24;
  ctx.fillStyle = '#0d0d12';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = d.color;
  ctx.fillRect(0, 0, w, h * 0.09);
  ctx.fillRect(0, h * 0.93, w, h * 0.07);
  ctx.save();
  ctx.translate(w / 2, h * 0.52);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = '#fff';
  const maxW = h * 0.78;
  const f = fit(ctx, d.title, (z) => `${z}px ${FONT.bebas}`, maxW, w * 0.9, 1, w * 0.78, w * 0.3, 1);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(f.lines[0], 0, s * 0.6, maxW);
  ctx.restore();
}

/** Plain-plastic texture for case top / bottom when held. */
export function drawPlastic(ctx, w, h) {
  ctx.fillStyle = '#0d0d12';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,.06)';
  ctx.fillRect(0, h * 0.4, w, h * 0.2);
}

export function coverCanvas(d, w = 512) {
  const h = Math.round((w * 280) / 160);
  const c = makeCanvas(w, h);
  drawCover(c.getContext('2d'), w, h, d);
  return c;
}


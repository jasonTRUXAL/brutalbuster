// The in-store TV above the counter: cycles through tapes in the catalog with
// VHS tracking noise, scanlines and an on-screen display.
import * as THREE from 'three';
import { makeCanvas, hash, rng } from './util.js';
import { getThumb, drawArt } from './covers.js';
import { FONT } from './fonts.js';

const W = 320;
const H = 240;

export class CrtScreen {
  constructor(catalog) {
    this.catalog = catalog;
    this.canvas = makeCanvas(W, H);
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.order = catalog.videos.slice();
    this.index = 0;
    this.clipTime = 0;
    this.frameTimer = 0;
    this.noise = rng(77);
    this.frame = makeCanvas(W, H);
    this._prepare();
  }

  _prepare() {
    const v = this.order[this.index % Math.max(1, this.order.length)];
    const c = this.frame.getContext('2d');
    c.fillStyle = '#000';
    c.fillRect(0, 0, W, H);
    if (!v) return;
    const t = getThumb(v);
    if (t) {
      const { img, crop } = t;
      const k = Math.max(W / crop.sw, H / crop.sh);
      const dw = crop.sw * k;
      const dh = crop.sh * k;
      c.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, (W - dw) / 2, (H - dh) / 2, dw, dh);
    } else {
      drawArt(c, 0, 0, W, H, hash(v.id), this.catalog.aisleById.get(v.aisle)?.color);
    }
    this.title = v.title;
  }

  update(dt) {
    this.clipTime += dt;
    this.frameTimer += dt;
    if (this.clipTime > 7) {
      this.clipTime = 0;
      this.index++;
      this._prepare();
    }
    if (this.frameTimer < 1 / 15) return;
    this.frameTimer = 0;
    const ctx = this.ctx;
    const r = this.noise;
    const switching = this.clipTime < 0.35;
    ctx.drawImage(this.frame, 0, 0);
    // tracking band
    const bandY = ((this.clipTime * 40) % (H + 60)) - 30;
    ctx.drawImage(this.frame, 0, bandY, W, 18, (r() - 0.5) * 10, bandY, W, 18);
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    ctx.fillRect(0, bandY, W, 3);
    // static
    const n = switching ? 1600 : 180;
    for (let i = 0; i < n; i++) {
      const v = Math.floor(r() * 255);
      ctx.fillStyle = `rgba(${v},${v},${v},${switching ? 0.9 : 0.25})`;
      ctx.fillRect(r() * W, r() * H, 2, 1);
    }
    // scanlines
    ctx.fillStyle = 'rgba(0,0,0,.22)';
    for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
    // OSD
    ctx.font = `22px ${FONT.vt}`;
    ctx.fillStyle = '#d7ffd9';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 3;
    ctx.fillText('PLAY ▶', 14, 28);
    const secs = Math.floor(this.clipTime + this.index * 7);
    const ts = `0:${String(Math.floor(secs / 60) % 60).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
    ctx.textAlign = 'right';
    ctx.fillText(ts, W - 14, 28);
    ctx.textAlign = 'left';
    if (this.clipTime < 3 && this.title) {
      ctx.font = `20px ${FONT.vt}`;
      ctx.fillText(this.title.toUpperCase().slice(0, 30), 14, H - 16);
    }
    ctx.shadowBlur = 0;
    this.texture.needsUpdate = true;
  }
}

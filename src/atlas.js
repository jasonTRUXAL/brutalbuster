// Packs every front cover into a few large canvas textures so thousands of tapes
// can be drawn with a handful of instanced draw calls.
import { makeCanvas } from './util.js';
import { drawCover } from './covers.js';
import { toTexture } from './textures.js';

export const CELL_W = 160;
export const CELL_H = 280;
const PAGE = 2048;
const COLS = Math.floor(PAGE / CELL_W);
const ROWS = Math.floor(PAGE / CELL_H);
const PER_PAGE = COLS * ROWS;

export class CoverAtlas {
  constructor() {
    this.pages = [];
    this.cells = new Map(); // video.id -> cell
    this.dirty = new Set();
  }

  _page(i) {
    while (this.pages.length <= i) {
      const canvas = makeCanvas(PAGE, PAGE);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, PAGE, PAGE);
      this.pages.push({ canvas, ctx, texture: toTexture(canvas) });
    }
    return this.pages[i];
  }

  cell(id) {
    let c = this.cells.get(id);
    if (!c) {
      const n = this.cells.size;
      const page = Math.floor(n / PER_PAGE);
      const k = n % PER_PAGE;
      const col = k % COLS;
      const row = Math.floor(k / COLS);
      const x = col * CELL_W;
      const y = row * CELL_H;
      // UV rect inset by 1px to avoid bleeding into neighbours. Canvas textures are flipY.
      const uvRect = [(x + 1) / PAGE, 1 - (y + CELL_H - 1) / PAGE, (CELL_W - 2) / PAGE, (CELL_H - 2) / PAGE];
      c = { page, x, y, uvRect };
      this._page(page);
      this.cells.set(id, c);
    }
    return c;
  }

  draw(id, data) {
    const c = this.cell(id);
    const { ctx } = this.pages[c.page];
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.beginPath();
    ctx.rect(0, 0, CELL_W, CELL_H);
    ctx.clip();
    drawCover(ctx, CELL_W, CELL_H, data);
    ctx.restore();
    this.dirty.add(c.page);
  }

  /** Push pending canvas changes to the GPU (call at most a few times a second). */
  flush() {
    for (const p of this.dirty) this.pages[p].texture.needsUpdate = true;
    this.dirty.clear();
  }

  texture(page) {
    return this._page(page).texture;
  }

  get pageCount() {
    return this.pages.length;
  }

  /** Copy a cover into a 2D canvas (used for the directory list). */
  blit(id, ctx, w, h) {
    const c = this.cells.get(id);
    if (!c) return;
    ctx.drawImage(this.pages[c.page].canvas, c.x, c.y, CELL_W, CELL_H, 0, 0, w, h);
  }
}

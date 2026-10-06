// DOM overlays: splash, HUD tooltip, held-tape panel, TV player, store directory.
import { escapeHtml, makeCanvas } from './util.js';

const $ = (sel, root = document) => root.querySelector(sel);

export class UI {
  constructor() {
    this.splash = $('#splash');
    this.hud = $('#hud');
    this.pause = $('#pause');
    this.inspect = $('#inspect');
    this.player = $('#player');
    this.directory = $('#directory');
    this.tooltip = $('#tooltip');
    this.crosshair = $('#crosshair');
    this.canvas = $('#scene');
    this.handlers = {};

    $('#btn-enter').addEventListener('click', () => this.handlers.enter?.());
    $('#btn-find').addEventListener('click', () => this.handlers.find?.());
    this.pause.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'find') this.handlers.find?.();
      else if (act === 'resume' || !e.target.closest('.pause-card')) this.handlers.resume?.();
    });
    this.inspect.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act) this.handlers[act]?.();
    });
    this.player.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="eject"]') || e.target === this.player) this.handlers.eject?.();
    });
    this.directory.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="close"]') || e.target === this.directory) this.handlers.closeDirectory?.();
    });

    // drag to turn the held box
    const drag = $('.inspect-drag');
    let last = null;
    drag.addEventListener('pointerdown', (e) => {
      last = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY };
      drag.setPointerCapture(e.pointerId);
    });
    drag.addEventListener('pointermove', (e) => {
      if (!last) return;
      this.handlers.drag?.(e.clientX - last.x, e.clientY - last.y);
      last.x = e.clientX;
      last.y = e.clientY;
    });
    drag.addEventListener('pointerup', (e) => {
      if (last && Math.hypot(e.clientX - last.sx, e.clientY - last.sy) < 5) this.handlers.flip?.();
      last = null;
    });
  }

  on(name, fn) {
    this.handlers[name] = fn;
  }

  brand(store) {
    document.querySelectorAll('.brand-name').forEach((el) => (el.textContent = store.name));
    document.querySelectorAll('.brand-sub').forEach((el) => (el.textContent = store.subtitle || ''));
    $('.tagline').textContent = store.tagline || '';
    $('.tv-brand').textContent = store.name;
    document.title = `${titleCase(store.name)} ${titleCase(store.subtitle || '')}`.trim();
    const credit = $('#splash-credit');
    if (store.channelUrl) {
      credit.innerHTML = `Every tape on these shelves comes from <a href="${escapeHtml(store.channelUrl)}" target="_blank" rel="noopener">${escapeHtml(store.channelName || 'our friends')}</a> on YouTube.`;
    } else {
      credit.textContent = 'Rare VHS transfers, shelved like it’s 1994.';
    }
  }

  splashStatus(text, count = '') {
    $('#splash-status').textContent = text;
    $('#splash-count').textContent = count;
  }

  splashProgress(done, total) {
    const pct = Math.round((done / total) * 100);
    $('#splash-bar').style.width = `${pct}%`;
    const pad = String(total).length;
    this.splashStatus(done < total ? 'RESTOCKING SHELVES' : 'ALL TAPES SHELVED', `${String(done).padStart(pad, '0')}/${total}`);
  }

  splashReady() {
    const b = $('#btn-enter');
    b.disabled = false;
    b.focus({ preventScroll: true });
  }

  setMode(mode) {
    const inStore = mode !== 'splash';
    this.splash.hidden = mode !== 'splash';
    this.hud.hidden = !inStore || mode === 'watch' || mode === 'inspect';
    this.pause.hidden = mode !== 'paused';
    this.inspect.hidden = mode !== 'inspect';
    this.player.hidden = mode !== 'watch';
    this.directory.hidden = mode !== 'directory';
    this.canvas.classList.toggle('blurred', mode === 'splash' || mode === 'directory');
    if (mode !== 'walk') this.hover(null);
  }

  hover(info) {
    if (!info) {
      this.tooltip.hidden = true;
      this.crosshair.classList.remove('on');
      return;
    }
    this.tooltip.hidden = false;
    this.crosshair.classList.add('on');
    $('.tt-aisle', this.tooltip).textContent = info.aisle.toUpperCase();
    $('.tt-title', this.tooltip).textContent = info.title;
    $('.tt-hint', this.tooltip).textContent = info.hint;
  }

  showInspect(video, aisle, { canWatch, note }) {
    const p = $('.inspect-panel');
    p.style.animation = 'none';
    void p.offsetWidth;
    p.style.animation = '';
    $('.ip-aisle .dot').style.background = aisle?.color || '#ffc61a';
    $('.ip-aisle .name').textContent = (aisle?.name || '').toUpperCase();
    $('.ip-title').textContent = video.title;
    $('.ip-meta').textContent = [video.year, video.duration].filter(Boolean).join('  ·  ');
    $('.ip-desc').textContent = video.description || 'No synopsis on file.';
    const watch = $('[data-act="watch"]', p);
    watch.disabled = !canWatch;
    const yt = $('.ip-yt');
    yt.hidden = !video.youtubeId;
    if (video.youtubeId) yt.href = `https://www.youtube.com/watch?v=${encodeURIComponent(video.youtubeId)}`;
    const n = $('.ip-note');
    n.hidden = !note;
    n.textContent = note || '';
  }

  openPlayer(video, store) {
    const frame = $('.tv-frame');
    frame.innerHTML = '';
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(video.youtubeId)}?autoplay=1&rel=0&modestbranding=1&playsinline=1`;
    iframe.title = video.title;
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.appendChild(iframe);
    $('.tv-title').textContent = `▶ ${video.title}`;
    $('.tv-brand').textContent = store.name;
  }

  closePlayer() {
    $('.tv-frame').innerHTML = '';
  }

  // ------------------------------------------------------------ directory

  buildDirectory(catalog, atlas, onPick) {
    this.dirState = { aisle: 'all', q: '' };
    const nav = $('.dir-aisles');
    const mk = (id, label, color) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.aisle = id;
      b.innerHTML = `${color ? `<span class="dot" style="background:${escapeHtml(color)}"></span>` : ''}${escapeHtml(label)}`;
      b.setAttribute('aria-pressed', id === 'all' ? 'true' : 'false');
      nav.appendChild(b);
    };
    mk('all', 'All tapes');
    catalog.aisles.forEach((a) => mk(a.id, a.name, a.color));
    nav.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-aisle]');
      if (!b) return;
      this.dirState.aisle = b.dataset.aisle;
      nav.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      render();
    });
    const input = $('input', this.directory);
    input.addEventListener('input', () => {
      this.dirState.q = input.value.trim().toLowerCase();
      render();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('.dir-item', this.directory)?.click();
    });
    const grid = $('.dir-grid');
    grid.addEventListener('click', (e) => {
      const item = e.target.closest('.dir-item');
      if (item) onPick(item.dataset.id);
    });
    const LIMIT = 240;
    const render = () => {
      const { aisle, q } = this.dirState;
      const list = catalog.videos.filter(
        (v) => (aisle === 'all' || v.aisle === aisle) && (!q || v.title.toLowerCase().includes(q) || v.description.toLowerCase().includes(q)),
      );
      list.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
      grid.innerHTML = '';
      const frag = document.createDocumentFragment();
      for (const v of list.slice(0, LIMIT)) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dir-item';
        btn.dataset.id = v.id;
        const c = makeCanvas(160, 280);
        atlas.blit(v.id, c.getContext('2d'), 160, 280);
        btn.appendChild(c);
        const t = document.createElement('div');
        t.className = 't';
        t.textContent = v.title;
        const a = document.createElement('div');
        a.className = 'a';
        a.textContent = [catalog.aisleById.get(v.aisle)?.name, v.year].filter(Boolean).join(' · ');
        btn.append(t, a);
        frag.appendChild(btn);
      }
      grid.appendChild(frag);
      $('.dir-count').textContent =
        list.length > LIMIT ? `Showing ${LIMIT} of ${list.length} tapes — search to narrow it down` : `${list.length} tape${list.length === 1 ? '' : 's'}`;
    };
    this.renderDirectory = render;
  }

  openDirectory() {
    this.renderDirectory?.();
    const input = $('input', this.directory);
    setTimeout(() => input.focus({ preventScroll: true }), 30);
  }

  fatal(title, detail) {
    const el = $('#fatal');
    el.innerHTML = `<div class="box"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(detail)}</p></div>`;
    el.hidden = false;
    this.splash.hidden = true;
  }
}

function titleCase(s) {
  return String(s).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

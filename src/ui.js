// DOM overlays: splash, HUD tooltip, held-tape panel, the couch's Stand up, store directory.
import { escapeHtml, makeCanvas } from './util.js';
import { shelfName } from './catalog.js';
import { mountGamePanel } from './arcade-ui.js';

const $ = (sel, root = document) => root.querySelector(sel);

export class UI {
  constructor() {
    this.splash = $('#splash');
    this.hud = $('#hud');
    this.resumeHint = $('#resume-hint');
    this.inspect = $('#inspect');
    this.seat = $('#seat');
    this.remote = $('#remote');
    this.directory = $('#directory');
    this.card = $('#card');
    this.receipt = $('#receipt');
    this.toasts = $('#toasts');
    this.play = $('#play');
    this.tooltip = $('#tooltip');
    this.crosshair = $('#crosshair');
    this.canvas = $('#scene');
    this.handlers = {};

    $('#btn-enter').addEventListener('click', () => this.handlers.enter?.());
    $('#btn-find').addEventListener('click', () => this.handlers.find?.());
    $('#btn-card').addEventListener('click', (e) => {
      e.currentTarget.blur();
      this.handlers.card?.();
    });
    this.receipt.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="close"]') || e.target === this.receipt) this.handlers.closeReceipt?.();
    });
    this.card.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="close"]') || e.target === this.card || e.target.classList.contains('card-wrap')) this.handlers.closeCard?.();
    });
    $('#btn-sound').addEventListener('click', (e) => {
      e.currentTarget.blur();
      this.handlers.sound?.();
    });
    $('#btn-ps1').addEventListener('click', (e) => {
      e.currentTarget.blur(); // so Space / Enter don't press it again later
      this.handlers.ps1?.();
    });
    this.play.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="stand"]')) this.handlers.stand?.();
    });
    this.inspect.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act) this.handlers[act]?.();
    });
    this.seat.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="stand"]')) this.handlers.standUp?.();
    });
    this.remote.addEventListener('click', (e) => {
      const b = e.target.closest('[data-remote]');
      if (!b) return;
      b.blur(); // so Space doesn't press it again
      this.handlers.remote?.(b.dataset.remote);
    });
    $('#btn-crouch').addEventListener('click', (e) => {
      e.currentTarget.blur();
      this.handlers.crouch?.();
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

  /** A shared link brought them here for a tape: say which, and that Enter goes to it. */
  splashTape(video) {
    const p = $('.splash-tape');
    p.hidden = !video;
    if (!video) return;
    $('strong', p).textContent = video.title;
    $('#btn-enter').textContent = 'Enter and find it ▶';
  }

  /** The held-tape panel's Copy link: show that it worked (or what to copy by hand). */
  shareDone(text) {
    const b = $('.ip-share');
    b.textContent = text;
    b.classList.add('done');
    clearTimeout(this.shareTimer);
    this.shareTimer = setTimeout(() => {
      b.textContent = 'Copy link';
      b.classList.remove('done');
    }, 2200);
  }

  /** Couldn't reach the clipboard: put the link in the panel's note, selected. */
  shareFallback(url) {
    const n = $('.ip-note');
    n.hidden = false;
    n.innerHTML = `Copy this link: <input class="ip-link" readonly value="${escapeHtml(url)}">`;
    const input = $('.ip-link', n);
    input.focus();
    input.select();
  }

  splashReady() {
    const b = $('#btn-enter');
    b.disabled = false;
    b.focus({ preventScroll: true });
  }

  setMode(mode) {
    const inStore = mode !== 'splash';
    this.splash.hidden = mode !== 'splash';
    this.hud.hidden = !inStore || mode === 'inspect' || mode === 'play' || mode === 'sit';
    this.play.hidden = mode !== 'play';
    // 'paused' = mouse released (Esc): the store stays visible, a click recaptures the mouse
    this.resumeHint.hidden = mode !== 'paused';
    document.body.classList.toggle('mouse-free', mode === 'paused');
    this.inspect.hidden = mode !== 'inspect';
    this.seat.hidden = mode !== 'sit';
    this.directory.hidden = mode !== 'directory';
    this.card.hidden = mode !== 'card';
    this.receipt.hidden = mode !== 'receipt';
    this.canvas.classList.toggle('blurred', mode === 'splash' || mode === 'directory' || mode === 'card' || mode === 'receipt');
    if (mode !== 'walk') this.hover(null);
  }

  /** The VCR's remote: `state` is { paused, subtitles, title }, or false to hide it. */
  showRemote(state) {
    const key = state ? `${state.paused}|${state.subtitles}|${state.title}` : '';
    if (key === this.remoteKey) return;
    this.remoteKey = key;
    this.remote.hidden = !state;
    if (!state) return;
    $('.remote-title', this.remote).textContent = state.title ? `▶ ${state.title}` : '';
    $('.remote-pause', this.remote).textContent = state.paused ? '▶ Play' : '❚❚ Pause';
    $('[data-remote="subtitles"]', this.remote).setAttribute('aria-pressed', String(state.subtitles));
  }

  /** The touchscreen's Crouch toggle. */
  setCrouch(on) {
    $('#btn-crouch').setAttribute('aria-pressed', String(on));
  }

  /** Show whether the store's sound is on (the HUD toggle). */
  setSound(on) {
    $('#btn-sound').setAttribute('aria-pressed', String(on));
  }

  /** Show whether PS1 Mode is on (the HUD toggle). */
  setPS1(on) {
    $('#btn-ps1').setAttribute('aria-pressed', String(on));
  }

  /** The control panel for the machine being played. */
  showPlay(game, { isTouch }) {
    $('.pp-kind', this.play).textContent = game.kind === 'gacha' ? 'Capsule machine' : 'Street game';
    $('.pp-title', this.play).textContent = game.title;
    $('.pp-sub', this.play).textContent = game.subtitle;
    $('[data-act="stand"] kbd', this.play).hidden = isTouch;
    this.playRefresh = mountGamePanel($('.pp-body', this.play), game, { isTouch });
    this.playRefresh();
    this.play.classList.remove('leaving');
  }

  refreshPlay() {
    this.playRefresh?.();
  }

  /** Fade the panel while standing back up. */
  leavePlay() {
    this.play.classList.add('leaving');
    this.playRefresh = null;
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

  /**
   * The held-tape panel. `set` ({ title, part, count }) when the tape came out of a box
   * set: a strip with ◀ ▶ to swap it for the box's other tapes. `swapped` skips the
   * panel's slide-in (the same box, another tape).
   */
  showInspect(video, aisle, { canGrab, note, set = null, swapped = false }) {
    const p = $('.inspect-panel');
    if (!swapped) {
      p.style.animation = 'none';
      void p.offsetWidth;
      p.style.animation = '';
    }
    const strip = $('.ip-set', p);
    strip.hidden = !set;
    if (set) {
      $('.ip-set-label', strip).innerHTML = `<b>${escapeHtml(set.title)}</b>Tape ${set.part + 1} of ${set.count} in the box`;
      $('[data-act="prevTape"]', strip).disabled = set.part === 0;
      $('[data-act="nextTape"]', strip).disabled = set.part === set.count - 1;
    }
    $('.ip-aisle .dot').style.background = aisle?.color || '#ffc61a';
    $('.ip-aisle .name').textContent = shelfName(aisle).toUpperCase();
    $('.ip-title').textContent = video.title;
    $('.ip-meta').textContent = [video.year, video.duration].filter(Boolean).join('  ·  ');
    $('.ip-desc').textContent = video.description || 'No synopsis on file.';
    $('[data-act="grab"]', p).disabled = !canGrab;
    const yt = $('.ip-yt');
    yt.hidden = !video.youtubeId;
    if (video.youtubeId) yt.href = `https://www.youtube.com/watch?v=${encodeURIComponent(video.youtubeId)}`;
    clearTimeout(this.shareTimer);
    $('.ip-share', p).textContent = 'Copy link';
    $('.ip-share', p).classList.remove('done');
    const n = $('.ip-note');
    n.hidden = !note;
    n.textContent = note || '';
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
    // the sales floor's aisles, then one button per other room (Streams)
    const areas = Object.values(catalog.areas || {}).filter((a) => a.videos.length);
    const everything = [...catalog.videos, ...areas.flatMap((a) => a.videos)];
    mk('all', 'All tapes');
    catalog.aisles.forEach((a) => mk(a.id, a.name, a.color));
    areas.forEach((a) => mk(`area:${a.id}`, a.name, a.color));
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
      const list = everything.filter(
        (v) => (aisle === 'all' || v.aisle === aisle || aisle === `area:${v.area}`) && (!q || v.title.toLowerCase().includes(q) || v.description.toLowerCase().includes(q)),
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
        // (a stream's "year" is whatever year its title mentions, not when it aired: leave it off)
        a.textContent = [shelfName(catalog.aisleById.get(v.aisle)), !v.area && v.year].filter(Boolean).join(' · ');
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

  // ------------------------------------------------------------ membership

  /** The token count on the HUD chip (with a little bump when it goes up). */
  setTokens(n) {
    const el = $('.token-count');
    const before = Number(el.textContent) || 0;
    el.textContent = String(n);
    if (n > before) {
      const chip = $('#btn-card');
      chip.classList.remove('bump');
      void chip.offsetWidth;
      chip.classList.add('bump');
    }
  }

  /** A "+15 TOKENS · Day 2 in a row" pop-up. */
  toast(event) {
    if (!event?.amount) return;
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<b>${event.amount > 0 ? '+' : '−'}${Math.abs(event.amount)} TOKEN${Math.abs(event.amount) === 1 ? '' : 'S'}</b>${escapeHtml(event.note || '')}`;
    this.toasts.appendChild(t);
    setTimeout(() => t.remove(), 4000);
  }

  /** Fill in the membership card from the member's state (see membership.js). */
  showCard(s, { rewards, now = Date.now() }) {
    const c = this.card;
    $('.mc-number', c).textContent = s.memberNo.replace(/(\d{4})(\d{4})/, '$1 $2');
    $('.mc-since-date', c).textContent = new Date(s.since).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    $('.mc-token-count', c).textContent = String(s.tokens);
    $('.cp-streak', c).textContent = String(s.streak);
    $('.cp-best', c).textContent = String(s.best);
    $('.cp-visits', c).textContent = String(s.visits);
    $('.cp-hours', c).textContent = hoursMinutes(s.watchSec);
    // the last two weeks, a stamp for each day you came in (today last)
    const stamps = $('.cp-stamps', c);
    stamps.innerHTML = '';
    const days = new Set(s.stamps);
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now - i * 86400000);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const dot = document.createElement('i');
      dot.className = days.has(key) ? 'on' : '';
      dot.title = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      stamps.appendChild(dot);
    }
    const r = rewards;
    $('.cp-earn-list', c).innerHTML = [
      `Come in each day: <b>${r.VISIT}</b> tokens, plus <b>${r.STREAK_STEP}</b> more for each day in a row (up to <b>+${r.STREAK_CAP}</b>)`,
      `Streak bonuses at ${Object.entries(r.MILESTONES).map(([d, n]) => `${d} days (<b>${n}</b>)`).join(', ')}`,
      `Watch tapes in the lounge: <b>1</b> token every ${r.WATCH_MINUTES} minutes, up to <b>${r.WATCH_DAILY_CAP}</b> a day`,
      `Watch a tape to the end: <b>${r.FINISH}</b> tokens (${r.FINISH_DAILY_CAP} times a day)`,
      `Return a tape through the drop box: <b>${r.RETURN}</b> (${r.RETURN_DAILY_CAP} a day)`,
    ].map((li) => `<li>${li}</li>`).join('');
    const list = $('.cp-history', c);
    list.innerHTML = s.history.length
      ? s.history.map((h) => `<li><span class="t">${escapeHtml(h.title)}</span><span class="m${h.finished ? ' done' : ''}">${h.finished ? '✓ ' : ''}${hoursMinutes(h.watchSec)}</span></li>`).join('')
      : '<li class="empty">Nothing yet. Grab a tape and take it to the VCR in the lounge.</li>';
  }

  /** The checkout's rental slip, printed. */
  showReceipt({ video, aisle, store, memberNo, now, due }) {
    const date = (d) => d.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit', year: '2-digit' });
    const time = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    $('.slip-body', this.receipt).innerHTML = `
      <h3>${escapeHtml(store.name)} ${escapeHtml(store.subtitle || '')}</h3>
      <div class="c">OPEN 24 HOURS</div>
      <hr>
      <div class="row"><span>${date(now)}</span><span>${time}</span></div>
      <div class="row"><span>MEMBER</span><span>#${escapeHtml(memberNo.replace(/(\d{4})(\d{4})/, '$1 $2'))}</span></div>
      <hr>
      <div class="title">${escapeHtml(video.title)}</div>
      <div>${escapeHtml(aisle || '')}${video.duration ? ` · ${escapeHtml(video.duration)}` : ''}</div>
      <div class="row"><span>RENTAL</span><span>2 NIGHTS</span></div>
      <hr>
      <div class="row big"><span>DUE BACK</span><span>${date(due)}</span></div>
      <div class="row"><span>LATE FEES</span><span>NONE</span></div>
      <div class="row big"><span>TOTAL</span><span>$0.00</span></div>
      <hr>
      <div class="c">BE KIND, PLEASE REWIND</div>
      <div class="barcode"></div>
      <div class="c">THANK YOU!</div>`;
  }

  fatal(title, detail) {
    const el = $('#fatal');
    el.innerHTML = `<div class="box"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(detail)}</p></div>`;
    el.hidden = false;
    this.splash.hidden = true;
  }
}

function hoursMinutes(sec) {
  const m = Math.floor(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

function titleCase(s) {
  return String(s).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

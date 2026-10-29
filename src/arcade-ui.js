// The control panel shown while playing a machine. Each game kind gets its own body;
// `refresh()` is called whenever the game reports a change.
import { escapeHtml } from './util.js';

const $ = (sel, root) => root.querySelector(sel);

export function mountGamePanel(el, game, { isTouch }) {
  el.innerHTML = '';
  if (game.kind === 'gacha') return gachaPanel(el, game, isTouch);
  return luckyHitPanel(el, game, isTouch);
}

function gachaPanel(el, game, isTouch) {
  el.innerHTML = `
    <button class="btn primary big pp-main" type="button">Turn the crank ${isTouch ? '' : '<kbd>Space</kbd>'}</button>
    <p class="pp-result" hidden></p>
    <p class="pp-meta"></p>`;
  const btn = $('.pp-main', el);
  btn.addEventListener('click', () => game.turn());
  const result = $('.pp-result', el);
  const meta = $('.pp-meta', el);
  return () => {
    btn.disabled = game.busy;
    if (game.result) {
      result.hidden = false;
      result.innerHTML = `<span class="pp-dot" style="background:${escapeHtml(game.result.color)}"></span>You got a <b>${escapeHtml(game.result.colorName)}</b> capsule! <span class="pp-soon">Prizes go inside soon.</span>`;
    } else result.hidden = true;
    meta.textContent = `${game.capsulesLeft} capsules left in the machine${game.restocked ? ' · just restocked!' : ''}`;
  };
}

function luckyHitPanel(el, game, isTouch) {
  const hint = isTouch ? 'Slide to pick your spot, then drop.' : 'Aim with the mouse or <kbd>←</kbd><kbd>→</kbd>, then drop.';
  el.innerHTML = `
    <p class="pp-hint">${hint}</p>
    <label class="pp-aim"><span class="pp-label">Drop spot</span>
      <input type="range" min="-100" max="100" step="1" aria-label="Drop spot" /></label>
    <button class="btn primary big pp-main" type="button">Drop ${isTouch ? '' : '<kbd>Space</kbd>'}</button>
    <p class="pp-msg"></p>
    <p class="pp-meta"></p>`;
  const btn = $('.pp-main', el);
  btn.addEventListener('click', () => game.letGo());
  const slider = $('input', el);
  slider.addEventListener('input', () => game.setAim((slider.value / 100) * game.aimRange));
  const msg = $('.pp-msg', el);
  const meta = $('.pp-meta', el);
  return () => {
    btn.disabled = game.busy;
    if (document.activeElement !== slider) slider.value = Math.round((game.aim / game.aimRange) * 100);
    slider.disabled = game.busy;
    msg.innerHTML = game.result
      ? `${escapeHtml(game.message)} <span class="pp-soon">${game.result.jackpot ? 'The rare-prize slot.' : `You won a ${escapeHtml(game.result.themeName)} prize.`} Prizes go in soon.</span>`
      : escapeHtml(game.message);
    msg.classList.toggle('hot', Boolean(game.result));
    meta.textContent = `New nails every day · drops ${game.stats.drops} · jackpots ${game.stats.jackpots}`;
  };
}

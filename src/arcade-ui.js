// The control panel shown while playing a machine. Each game kind gets its own body;
// `refresh()` is called whenever the game reports a change.
import { escapeHtml } from './util.js';

const $ = (sel, root) => root.querySelector(sel);

export function mountGamePanel(el, game, { isTouch }) {
  el.innerHTML = '';
  if (game.kind === 'gacha') return gachaPanel(el, game, isTouch);
  return pachinkoPanel(el, game, isTouch);
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

function pachinkoPanel(el, game, isTouch) {
  el.innerHTML = `
    <div class="pp-row">
      <div class="pp-balls"><span class="pp-label">Balls</span><span class="pp-count"></span></div>
      <label class="pp-power"><span class="pp-label">Launch power ${isTouch ? '' : '<kbd>←</kbd><kbd>→</kbd>'}</span>
        <input type="range" min="0" max="100" step="1" aria-label="Launch power" /></label>
    </div>
    <button class="btn primary big pp-main pp-hold" type="button">Hold to shoot ${isTouch ? '' : '<kbd>Space</kbd>'}</button>
    <p class="pp-msg"></p>
    <p class="pp-meta"></p>`;
  const hold = $('.pp-hold', el);
  const on = (e) => {
    e.preventDefault();
    hold.setPointerCapture?.(e.pointerId);
    game.setFiring(true);
  };
  const off = () => game.setFiring(false);
  hold.addEventListener('pointerdown', on);
  hold.addEventListener('pointerup', off);
  hold.addEventListener('pointercancel', off);
  hold.addEventListener('lostpointercapture', off);
  const slider = $('input', el);
  slider.addEventListener('input', () => game.setPower(slider.value / 100));
  const count = $('.pp-count', el);
  const msg = $('.pp-msg', el);
  const meta = $('.pp-meta', el);
  return () => {
    count.textContent = game.balls;
    if (document.activeElement !== slider) slider.value = Math.round(game.power * 100);
    msg.textContent = game.message;
    msg.classList.toggle('hot', /FEVER|REACH|START|Tulip/.test(game.message));
    meta.textContent = `Shot ${game.stats.shot} · won ${game.stats.won} · spins ${game.stats.spins} · jackpots ${game.stats.jackpots}`;
  };
}

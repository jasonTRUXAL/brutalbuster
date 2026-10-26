import './style.css';
import * as THREE from 'three';
import { loadFonts } from './fonts.js';
import { loadCatalog } from './catalog.js';
import { planStore } from './layout.js';
import { CoverAtlas } from './atlas.js';
import { TapeShelves } from './tapes.js';
import { buildStore } from './store.js';
import { PlayerControls } from './controls.js';
import { Inspector } from './inspect.js';
import { Arcade } from './arcade.js';
import { coverData, loadThumb } from './covers.js';
import { setMaxAnisotropy } from './textures.js';
import { DIM } from './config.js';
import { mapLimit } from './util.js';
import { UI } from './ui.js';

const ui = new UI();
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
document.body.classList.toggle('touch', isTouch);

async function main() {
  await loadFonts();

  let catalog;
  try {
    // dev only: ?catalog=other.json previews an alternate catalog from /public
    const alt = import.meta.env.DEV && new URLSearchParams(location.search).get('catalog');
    const file = alt && /^[\w.-]+\.json$/.test(alt) ? alt : 'catalog.json';
    catalog = await loadCatalog(`${import.meta.env.BASE_URL}${file}`);
  } catch (err) {
    ui.fatal('The store is closed', `Couldn't load the tape catalog: ${err.message}`);
    return;
  }
  if (!catalog.videos.length) {
    ui.fatal('The shelves are empty', 'catalog.json has no videos yet. Run `npm run sync` to stock the store.');
    return;
  }
  ui.brand(catalog.store);
  ui.splashStatus('BUILDING THE STORE');

  // ------------------------------------------------------------ renderer + scene
  const canvas = document.getElementById('scene');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch {
    ui.fatal('No 3D support', 'Your browser or device could not start WebGL, which the store needs.');
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouch ? 1.5 : 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.autoClear = false;
  setMaxAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05040c);
  // Keep a usable horizontal field of view on portrait phones.
  const fovFor = (aspect) => THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(37.5)) / aspect)), 70, 95);
  const camera = new THREE.PerspectiveCamera(fovFor(window.innerWidth / window.innerHeight), window.innerWidth / window.innerHeight, 0.08, 140); // near 0.08: more depth precision for far shelves

  const plan = planStore(catalog);
  const atlas = new CoverAtlas();
  const paintCover = (v) => atlas.draw(v.id, coverData(v, catalog.aisleById.get(v.aisle), catalog.store));
  catalog.videos.forEach(paintCover);
  atlas.flush();

  const tapes = new TapeShelves(plan.slots, atlas);
  scene.add(tapes.group);
  const store = buildStore(scene, plan, catalog);
  const controls = new PlayerControls(camera, canvas, { colliders: store.colliders, bounds: plan.bounds, spawn: plan.spawn });
  const inspector = new Inspector(catalog);
  // The prize corner's machines. Every capsule / jackpot is announced as a `bb:prize`
  // event; that's where the always-win reward system will plug in.
  const arcade = new Arcade(store.prizes, {
    onPrize: (prize) => window.dispatchEvent(new CustomEvent('bb:prize', { detail: prize })),
    onChange: () => ui.refreshPlay(),
  });
  renderer.compile(scene, camera);

  // ------------------------------------------------------------ state machine
  let mode = 'splash';
  let hovered = -1;
  let hoveredGame = null;
  let heldSlot = -1;
  const setMode = (m) => {
    mode = m;
    ui.setMode(m);
    controls.enabled = m === 'walk';
    if (m !== 'walk') {
      setHover(-1);
      setHoverGame(null);
    }
  };

  function setHover(slot) {
    if (slot === hovered) return;
    hovered = slot;
    tapes.setHover(slot);
    if (slot < 0) {
      if (!hoveredGame) ui.hover(null);
      return;
    }
    const s = plan.slots[slot];
    ui.hover({
      title: s.video.title,
      aisle: catalog.aisleById.get(s.video.aisle)?.name || s.section.label,
      hint: isTouch ? 'Tap to pick up' : 'Click to pick up',
    });
  }

  function setHoverGame(game) {
    if (game === hoveredGame) return;
    hoveredGame = game;
    if (!game) {
      if (hovered < 0) ui.hover(null);
      return;
    }
    const verb = game.kind === 'gacha' ? 'crouch down and play' : 'sit down and play';
    ui.hover({
      aisle: 'Prize corner',
      title: game.kind === 'gacha' ? `${game.title} capsule machine` : `${game.title} pachinko`,
      hint: `${isTouch ? 'Tap' : 'Click'} to ${verb}`,
    });
  }

  /** Crouch / sit down at a prize-corner machine. */
  function enterPlay(game) {
    if (!game || arcade.busy) return;
    setMode('play');
    controls.unlock();
    arcade.enter(game, camera);
    ui.showPlay(game, { isTouch });
  }

  /** Stand back up. A click (a user gesture) lets us recapture the mouse straight away. */
  function exitPlay(viaGesture) {
    if (mode !== 'play' || !arcade.seated) return;
    ui.leavePlay();
    const regrab = viaGesture && !isTouch && !controls.dragLook;
    if (regrab) controls.lock();
    arcade.exit(camera, () => setMode(isTouch || controls.dragLook || regrab ? 'walk' : 'paused'));
  }

  function pickUp(slot) {
    inspector.finishClose();
    if (slot < 0 || inspector.active) return;
    const video = plan.slots[slot].video;
    heldSlot = slot;
    setMode('inspect');
    tapes.hide(slot);
    inspector.open(video, slot, tapes.worldMatrix(slot), camera);
    controls.unlock();
    const aisle = catalog.aisleById.get(video.aisle);
    ui.showInspect(video, aisle, {
      canWatch: Boolean(video.youtubeId),
      note: video.youtubeId ? '' : 'Display copy — this sample tape isn’t linked to a video yet.',
    });
  }
  inspector.onClosed = (slot) => tapes.show(slot);

  function putBack(viaGesture) {
    if (mode !== 'inspect') return;
    inspector.close();
    heldSlot = -1;
    if (isTouch || controls.dragLook) setMode('walk');
    else if (viaGesture) {
      setMode('walk');
      controls.lock();
    } else setMode('paused');
  }

  function openDirectory() {
    if (mode === 'inspect') putBack(false);
    setMode('directory');
    controls.unlock();
    ui.openDirectory();
  }

  function closeDirectory() {
    setMode(isTouch || controls.dragLook ? 'walk' : 'paused');
  }

  /** Walk to a tape and pick it up. */
  function goToVideo(id) {
    const slots = plan.slots
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.video.id === id);
    if (!slots.length) return;
    const rank = ({ s }) => (s.section.kind === 'genre' ? 0 : s.section.kind === 'new' ? 1 : 2) * 10 + Math.abs(s.row - 3);
    slots.sort((a, b) => rank(a) - rank(b));
    const { s, i } = slots[0];
    const m = tapes.worldMatrix(i);
    const p = new THREE.Vector3().setFromMatrixPosition(m);
    const n = s.face.n;
    const back = 1.05;
    controls.teleport(p.x + n.x * back, p.z + n.z * back, Math.atan2(n.x, n.z), Math.atan2(p.y - DIM.EYE, back));
    setMode('walk');
    pickUp(i);
  }

  // ------------------------------------------------------------ input wiring
  ui.on('enter', () => {
    setMode('walk');
    controls.lock();
  });
  ui.on('resume', () => {
    if (isTouch || controls.dragLook) setMode('walk');
    else controls.lock();
  });
  ui.on('find', openDirectory);
  ui.on('closeDirectory', closeDirectory);
  ui.on('back', () => putBack(true));
  ui.on('flip', () => inspector.flip());
  ui.on('drag', (dx, dy) => inspector.drag(dx, dy));
  ui.on('watch', () => {
    const v = heldSlot >= 0 ? plan.slots[heldSlot].video : null;
    if (!v?.youtubeId) return;
    ui.openPlayer(v, catalog.store);
    setMode('watch');
  });
  ui.on('eject', () => {
    ui.closePlayer();
    setMode('inspect');
  });
  ui.on('stand', () => exitPlay(true));
  ui.buildDirectory(catalog, atlas, (id) => goToVideo(id));

  controls.onLockChange = (locked, failed) => {
    document.body.classList.toggle('drag-look', controls.dragLook);
    if (locked && (mode === 'paused' || mode === 'splash')) setMode('walk');
    else if (!locked && mode === 'walk' && !controls.dragLook) setMode('paused');
    else if (failed && controls.dragLook && mode === 'paused') setMode('walk');
  };
  controls.onTap = (x, y) => {
    if (mode !== 'walk') return;
    const t = aim(new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1));
    if (t.game) enterPlay(t.game);
    else if (t.slot >= 0) pickUp(t.slot);
  };

  /** Act on whatever the crosshair (or the drag-look cursor) is on. */
  function activateHovered() {
    if (hoveredGame) enterPlay(hoveredGame);
    else if (hovered >= 0) pickUp(hovered);
  }

  const mouse = new THREE.Vector2();
  canvas.addEventListener('mousemove', (e) => mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1));
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (mode === 'play' && arcade.seated) arcade.active.primary(true);
    else if (mode === 'walk' && controls.locked) activateHovered();
  });
  window.addEventListener('mouseup', () => {
    if (mode === 'play' && arcade.seated) arcade.active.primary(false);
  });
  window.addEventListener('blur', () => arcade.active?.primary(false));
  canvas.addEventListener('click', () => {
    if (mode === 'walk' && controls.dragLook && controls.dragDist < 6) activateHovered();
    else if (mode === 'paused') ui.handlers.resume?.();
  });

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) {
      if (e.key === 'Escape') closeDirectory();
      return;
    }
    if (e.key === 'Escape') {
      if (mode === 'watch') ui.handlers.eject();
      else if (mode === 'inspect') putBack(false);
      else if (mode === 'directory') closeDirectory();
      else if (mode === 'play') exitPlay(false);
      return;
    }
    if (mode === 'play') {
      const game = arcade.seated ? arcade.active : null;
      if (!game) return;
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault(); // don't also "click" whichever panel button has focus
        if (!e.repeat) game.primary(true);
      } else if (game.kind === 'pachinko' && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
        e.preventDefault();
        game.setPower(game.power + (e.code === 'ArrowRight' ? 0.05 : -0.05));
      }
      return;
    }
    if (mode === 'walk' && e.code === 'KeyE') activateHovered();
    else if ((mode === 'walk' || mode === 'paused') && (e.code === 'KeyF' || e.key === '/')) {
      e.preventDefault();
      openDirectory();
    } else if (mode === 'inspect') {
      if (e.code === 'Space' || e.code === 'KeyR') {
        e.preventDefault();
        inspector.flip();
      } else if (e.code === 'Enter') ui.handlers.watch();
    }
  });

  window.addEventListener('keyup', (e) => {
    if (mode === 'play' && (e.code === 'Space' || e.code === 'Enter')) {
      e.preventDefault();
      arcade.active?.primary(false);
    }
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.fov = fovFor(camera.aspect);
    camera.updateProjectionMatrix();
    inspector.resize(camera.aspect, camera.fov);
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ------------------------------------------------------------ picking
  const raycaster = new THREE.Raycaster();
  raycaster.far = DIM.REACH;
  const center = new THREE.Vector2(0, 0);
  const toCam = new THREE.Vector3();
  // A small fan of rays so aiming between two tapes (or between shelves) still finds one.
  const FAN = [[0, 0], [0, -0.03], [0, 0.03], [-0.018, 0], [0.018, 0], [0, -0.06], [0, 0.06], [0, -0.09], [0, 0.09]];
  const probe = new THREE.Vector2();
  let slotDistance = Infinity; // distance to the tape raySlot() last found
  function raySlot(ndc) {
    for (const [dx, dy] of FAN) {
      probe.set(ndc.x + dx / camera.aspect, ndc.y + dy);
      raycaster.setFromCamera(probe, camera);
      const hits = raycaster.intersectObject(tapes.bodies, false);
      for (const h of hits) {
        const s = plan.slots[h.instanceId];
        if (!s) continue;
        // ignore tapes on the far side of a shelf (their face points away from us)
        toCam.copy(camera.position).sub(h.point);
        if (toCam.x * s.face.n.x + toCam.z * s.face.n.z > 0) {
          slotDistance = h.distance;
          return h.instanceId;
        }
        break;
      }
    }
    slotDistance = Infinity;
    return -1;
  }

  /** What the player is pointing at: a tape on a shelf or a prize-corner machine (nearest wins). */
  function aim(ndc) {
    camera.updateMatrixWorld(); // aim from where the camera is now, not where it was last drawn
    const slot = raySlot(ndc);
    raycaster.setFromCamera(ndc, camera);
    const hit = arcade.pick(raycaster.ray, DIM.REACH + 0.4);
    if (hit && hit.distance < slotDistance) return { slot: -1, game: hit.game };
    return { slot, game: null };
  }

  // ------------------------------------------------------------ thumbnails
  const withThumbs = catalog.videos.filter((v) => v.thumb);
  let loaded = 0;
  if (withThumbs.length) ui.splashProgress(0, withThumbs.length);
  else ui.splashStatus('ALL TAPES SHELVED', `${catalog.videos.length} IN STOCK`);
  ui.splashReady();
  mapLimit(withThumbs, 12, async (v) => {
    const t = await loadThumb(v);
    if (t) {
      paintCover(v);
      store.refreshArt(v);
    }
    loaded++;
    ui.splashProgress(loaded, withThumbs.length);
  });

  // ------------------------------------------------------------ loop
  const timer = new THREE.Timer();
  timer.connect(document); // ignores time spent in a background tab
  let flushTimer = 0;
  let time = 0;
  const spawn = plan.spawn;
  function tick(dt) {
    time += dt;
    if (mode === 'splash') {
      // slow establishing shot down the aisles
      camera.position.set(spawn.x + Math.sin(time * 0.15) * 0.6, DIM.EYE + 0.1, spawn.z - 0.3);
      camera.rotation.set(-0.05, Math.sin(time * 0.12) * 0.35, 0, 'YXZ');
    } else if (!arcade.busy) {
      controls.update(dt);
    }
    arcade.update(dt, camera); // the machines, and the camera while crouching / seated
    if (mode === 'walk' && !isTouch) {
      const t = aim(controls.dragLook ? mouse : center);
      setHover(t.slot);
      setHoverGame(t.game);
    }
    store.update(dt, time);
    inspector.update(dt);
    flushTimer += dt;
    if (flushTimer > 0.35) {
      flushTimer = 0;
      atlas.flush();
    }
  }

  function draw() {
    renderer.clear();
    renderer.render(scene, camera);
    inspector.render(renderer);
  }

  // Dev-only `?manual`: no render loop; frames happen only via __bb.advance(). The smoke
  // tests use it so software-rendered CI machines aren't drawing frames nobody looks at.
  const manualClock = import.meta.env.DEV && new URLSearchParams(location.search).has('manual');
  if (!manualClock) {
    renderer.setAnimationLoop((timestamp) => {
      timer.update(timestamp);
      tick(Math.min(timer.getDelta(), 0.05));
      draw();
    });
  } else {
    draw();
  }

  if (import.meta.env.DEV) {
    // test hooks: inspect state and step the simulation deterministically
    window.__bb = {
      plan, catalog, controls, camera, scene, renderer, tapes, inspector, store, arcade, goToVideo, pickUp, putBack, setMode, raySlot, aim, enterPlay, exitPlay,
      get mode() { return mode; },
      get hovered() { return hovered; },
      get hoveredGame() { return hoveredGame; },
      advance(seconds, step = 1 / 60) {
        for (let t = 0; t < seconds; t += step) tick(step);
        draw();
      },
    };
  }
}

main();

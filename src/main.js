import './style.css';
import * as THREE from 'three';
import { loadFonts } from './fonts.js';
import { loadCatalog, fetchCatalog, addArea, shelfName, AREAS } from './catalog.js';
import { planStore } from './layout.js';
import { CoverAtlas } from './atlas.js';
import { TapeShelves } from './tapes.js';
import { buildStore } from './store.js';
import { RoomCulling } from './rooms.js';
import { Theater } from './theater.js';
import { PlayerControls } from './controls.js';
import { Inspector } from './inspect.js';
import { Arcade } from './arcade.js';
import { PS1Mode } from './ps1.js';
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

  // dev only: ?catalog=other.json (or ?streams=other.json for an area) previews an
  // alternate catalog from /public
  const params = new URLSearchParams(location.search);
  const fileFor = (param, fallback) => {
    const alt = import.meta.env.DEV && params.get(param);
    return `${import.meta.env.BASE_URL}${alt && /^[\w.-]+\.json$/.test(alt) ? alt : fallback}`;
  };
  // The other areas' catalogs (Streams) come in alongside. They're optional: without
  // one, that room's shelves stay "coming soon".
  const areaFiles = AREAS.map((a) => fetchCatalog(fileFor(a.id, a.file)).catch((err) => {
    console.warn(`[catalog] ${a.name}: ${err.message}`);
    return null;
  }));
  let catalog;
  try {
    catalog = await loadCatalog(fileFor('catalog', 'catalog.json'));
  } catch (err) {
    ui.fatal('The store is closed', `Couldn't load the tape catalog: ${err.message}`);
    return;
  }
  if (!catalog.videos.length) {
    ui.fatal('The shelves are empty', 'catalog.json has no videos yet. Run `npm run sync` to stock the store.');
    return;
  }
  (await Promise.all(areaFiles)).forEach((raw, i) => raw && addArea(catalog, AREAS[i], raw));
  const areaVideos = Object.values(catalog.areas).flatMap((a) => a.videos);
  ui.brand(catalog.store);
  ui.splashStatus('BUILDING THE STORE');

  // ------------------------------------------------------------ renderer + scene
  const canvas = document.getElementById('scene');
  let renderer;
  try {
    // (alpha: the lounge screen leaves the canvas see-through while a tape plays: theater.js)
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
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
  renderer.setClearColor(0x05040c, 1);
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
  areaVideos.forEach(paintCover);
  atlas.flush();

  const tapes = new TapeShelves(plan.slots, atlas);
  scene.add(tapes.group);
  const store = buildStore(scene, plan, catalog);
  const controls = new PlayerControls(camera, canvas, { colliders: store.colliders, bounds: plan.bounds, spawn: plan.spawn });
  const culling = new RoomCulling(plan, store.annex.groups, tapes.covers);
  const inspector = new Inspector(catalog);
  // the lounge's VCR, projector screen and couches
  const theater = new Theater({ plan, parts: store.annex.lounge, canvas });
  // The prize corner's machines. Every capsule / jackpot is announced as a `bb:prize`
  // event; that's where the always-win reward system will plug in.
  const arcade = new Arcade(store.prizes, {
    onPrize: (prize) => window.dispatchEvent(new CustomEvent('bb:prize', { detail: prize })),
    onChange: () => ui.refreshPlay(),
  });
  renderer.compile(scene, camera);

  // PS1 Mode: the store drawn like a 1995 console game (thumbnails stay sharp).
  // Remembered between visits; ?ps1 / ?ps1=0 overrides.
  const ps1 = new PS1Mode(renderer, scene);
  const ps1Param = new URLSearchParams(location.search).get('ps1');
  const ps1Saved = (() => {
    try {
      return localStorage.getItem('bb.ps1') === '1';
    } catch {
      return false;
    }
  })();
  function setPS1(on, remember = true) {
    ps1.setEnabled(on);
    ui.setPS1(on);
    if (!remember) return;
    try {
      localStorage.setItem('bb.ps1', on ? '1' : '0');
    } catch {
      // private browsing: just don't remember it
    }
  }
  setPS1(ps1Param !== null ? ps1Param !== '0' : ps1Saved, false);

  // ------------------------------------------------------------ state machine
  let mode = 'splash';
  let hovered = -1; // the tape the crosshair is on
  let target = null; // what it's on: { kind: 'tape' | 'game' | 'seat' | 'vcr', key, ... }
  let heldSlot = -1; // the tape in your hands (inspect)
  let carried = null; // the tape you've grabbed and are carrying round: { slot, video }
  let inVcr = null; // the tape in the lounge's VCR: { slot, video }
  const setMode = (m) => {
    mode = m;
    ui.setMode(m);
    controls.enabled = m === 'walk';
    inspector.showCarry = m !== 'play'; // (it would sit in front of the machine)
    if (m !== 'walk') setTarget(null);
  };

  const press = isTouch ? 'Tap' : 'Click';
  function describe(t) {
    if (t.kind === 'tape') {
      const s = plan.slots[t.slot];
      return { title: s.video.title, aisle: shelfName(catalog.aisleById.get(s.video.aisle)) || s.section.label, hint: `${press} to pick up` };
    }
    if (t.kind === 'game') {
      const g = t.game;
      const verb = g.kind === 'gacha' ? 'crouch down and play' : 'step up and play';
      return { aisle: 'Prize corner', title: g.kind === 'gacha' ? `${g.title} capsule machine` : `${g.title} drop board`, hint: `${press} to ${verb}` };
    }
    if (t.kind === 'seat') return { aisle: 'Lounge', title: 'Couch', hint: `${press} to sit down` };
    return { aisle: 'VCR', title: 'Insert tape', hint: `${press} to put in “${carried.video.title}”` };
  }

  /** Point the crosshair at something (or nothing): highlight it and say what it is. */
  function setTarget(t) {
    const slot = t?.kind === 'tape' ? t.slot : -1;
    if (slot !== hovered) {
      hovered = slot;
      tapes.setHover(slot);
    }
    const same = (t?.key ?? null) === (target?.key ?? null);
    target = t;
    if (!same) ui.hover(t ? describe(t) : null);
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

  /** Sit on a lounge couch. That's all it does: whatever's on the screen carries on. */
  function sitDown(seat) {
    if (!seat || theater.busy || arcade.busy) return;
    setMode('sit');
    controls.unlock();
    theater.sit(seat, camera);
  }

  function standUp(viaGesture) {
    if (mode !== 'sit' || !theater.seated) return;
    const regrab = viaGesture && !isTouch && !controls.dragLook;
    if (regrab) controls.lock();
    theater.stand(camera, () => setMode(isTouch || controls.dragLook || regrab ? 'walk' : 'paused'));
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
      canGrab: Boolean(video.youtubeId),
      note: video.youtubeId ? '' : 'Display copy — this sample tape isn’t linked to a video yet.',
    });
  }
  inspector.onClosed = (slot) => tapes.show(slot);

  /** Back to walking after the held-tape panel. A click lets us recapture the mouse. */
  function resumeWalking(viaGesture) {
    if (isTouch || controls.dragLook) setMode('walk');
    else if (viaGesture) {
      setMode('walk');
      controls.lock();
    } else setMode('paused');
  }

  function putBack(viaGesture) {
    if (mode !== 'inspect') return;
    inspector.close();
    heldSlot = -1;
    resumeWalking(viaGesture);
  }

  /** Keep the tape in your hands and walk off with it (it plays in the lounge's VCR). */
  function grab(viaGesture) {
    if (mode !== 'inspect' || heldSlot < 0 || !plan.slots[heldSlot].video.youtubeId) return;
    if (!inspector.grab()) return;
    if (carried) tapes.show(carried.slot); // the one you had goes back on its shelf
    carried = { slot: heldSlot, video: plan.slots[heldSlot].video };
    heldSlot = -1;
    resumeWalking(viaGesture);
  }

  /** Put the tape you're carrying in the VCR: it plays on the lounge screen. */
  function insertTape() {
    if (!carried) return;
    if (inVcr) tapes.show(inVcr.slot); // the tape that was in goes back on its shelf
    inVcr = carried;
    carried = null;
    inspector.release();
    theater.insert(inVcr.video);
    setTarget(null);
    holdTheMouse();
  }

  // Loading the YouTube player can take the browser's focus, and with it the mouse (a
  // "Click to look around" nobody asked for). The player can't take focus (theater.js),
  // but just in case: if the mouse is let go of while walking, just after a tape goes in
  // or its picture starts, ask for it back once. If the browser says no, it's 'paused'.
  let relockUntil = 0;
  const holdTheMouse = () => {
    if (!isTouch && !controls.dragLook) relockUntil = performance.now() + 4000;
  };
  theater.onPicture = holdTheMouse;
  // at the end of the tape, it's put back on its shelf
  theater.onEnded = () => {
    if (inVcr) tapes.show(inVcr.slot);
    inVcr = null;
  };

  function openDirectory() {
    if (mode === 'inspect') putBack(false);
    setMode('directory');
    controls.unlock();
    ui.openDirectory();
  }

  function closeDirectory() {
    setMode(isTouch || controls.dragLook ? 'walk' : 'paused');
  }

  /** Walk to a tape and pick it up (a copy that's on a shelf, not one you've taken). */
  function goToVideo(id) {
    const slots = plan.slots
      .map((s, i) => ({ s, i }))
      .filter(({ s, i }) => s.video.id === id && !tapes.hiddenSet?.has(i));
    if (!slots.length) {
      if (mode === 'directory') closeDirectory(); // (you're carrying it, or it's in the VCR)
      return;
    }
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
  ui.on('grab', () => grab(true));
  ui.on('stand', () => exitPlay(true));
  ui.on('standUp', () => standUp(true));
  ui.on('ps1', () => setPS1(!ps1.enabled));
  ui.buildDirectory(catalog, atlas, (id) => goToVideo(id));

  controls.onLockChange = (locked, failed) => {
    document.body.classList.toggle('drag-look', controls.dragLook);
    if (locked && (mode === 'paused' || mode === 'splash')) setMode('walk');
    else if (!locked && !failed && mode === 'walk' && performance.now() < relockUntil) {
      relockUntil = 0;
      controls.lock({ quiet: true });
    } else if (!locked && mode === 'walk' && !controls.dragLook) setMode('paused');
    else if (failed && controls.dragLook && mode === 'paused') setMode('walk');
  };
  controls.onTap = (x, y) => {
    if (mode !== 'walk') return;
    activate(aim(new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1)));
  };

  function activate(t) {
    if (t?.kind === 'vcr') insertTape();
    else if (t?.kind === 'game') enterPlay(t.game);
    else if (t?.kind === 'seat') sitDown(t.seat);
    else if (t?.kind === 'tape') pickUp(t.slot);
  }

  /** Act on whatever the crosshair (or the drag-look cursor) is on. */
  const activateHovered = () => activate(target);

  const mouse = new THREE.Vector2();
  canvas.addEventListener('mousemove', (e) => {
    mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    if (mode === 'play' && arcade.seated) arcade.active.pointer?.(mouse, camera); // e.g. aiming the Lucky Hit drop
  });
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
      if (mode === 'inspect') putBack(false);
      else if (mode === 'directory') closeDirectory();
      else if (mode === 'play') exitPlay(false);
      else if (mode === 'sit') standUp(false);
      return;
    }
    if (e.code === 'KeyP' && mode !== 'splash' && !e.repeat) {
      setPS1(!ps1.enabled);
      return;
    }
    if (mode === 'play') {
      const game = arcade.seated ? arcade.active : null;
      if (!game) return;
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault(); // don't also "click" whichever panel button has focus
        if (!e.repeat) game.primary(true);
      } else if (game.steer && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
        e.preventDefault();
        game.steer(e.code === 'ArrowRight' ? 1 : -1);
      }
      return;
    }
    if (mode === 'sit') {
      if (/^(Key[WASD]|Arrow(Up|Down|Left|Right))$/.test(e.code)) standUp(true); // walking off gets you up
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
      } else if (e.code === 'KeyG' || e.code === 'Enter') {
        e.preventDefault();
        grab(true);
      }
    }
  });

  window.addEventListener('keyup', (e) => {
    if (mode === 'play' && (e.code === 'Space' || e.code === 'Enter')) {
      e.preventDefault();
      arcade.active?.primary(false);
    }
    if (mode === 'play' && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) arcade.active?.steer?.(0);
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.fov = fovFor(camera.aspect);
    camera.updateProjectionMatrix();
    inspector.resize(camera.aspect, camera.fov);
    renderer.setSize(window.innerWidth, window.innerHeight);
    theater.resize(window.innerWidth, window.innerHeight);
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
      const h = tapes.hit(raycaster.ray, raycaster.far);
      if (!h) continue;
      // ignore tapes on the far side of a shelf (their face points away from us)
      const s = plan.slots[h.index];
      toCam.copy(camera.position).sub(h.point);
      if (toCam.x * s.face.n.x + toCam.z * s.face.n.z > 0) {
        slotDistance = h.distance;
        return h.index;
      }
    }
    slotDistance = Infinity;
    return -1;
  }

  /**
   * What the player is pointing at: a tape on a shelf, a prize-corner machine or a couch
   * (the nearest wins). Carrying a tape up to the VCR beats all of them.
   */
  function aim(ndc) {
    camera.updateMatrixWorld(); // aim from where the camera is now, not where it was last drawn
    if (carried && theater.nearVcr(camera.position)) return { kind: 'vcr', key: `vcr:${carried.slot}` };
    const slot = raySlot(ndc);
    let best = slot >= 0 ? { kind: 'tape', key: `tape:${slot}`, slot, distance: slotDistance } : null;
    raycaster.setFromCamera(ndc, camera);
    const far = DIM.REACH + 0.4;
    const game = arcade.pick(raycaster.ray, far);
    if (game && (!best || game.distance < best.distance)) best = { kind: 'game', key: `game:${arcade.games.indexOf(game.game)}`, game: game.game, distance: game.distance };
    const seat = theater.pickSeat(raycaster.ray, far);
    if (seat && (!best || seat.distance < best.distance)) best = { kind: 'seat', key: `seat:${seat.index}`, seat: seat.seat, distance: seat.distance };
    return best;
  }

  // ------------------------------------------------------------ thumbnails
  // The sales floor's first (the splash counts them), then the other rooms' quietly.
  const withThumbs = catalog.videos.filter((v) => v.thumb);
  let loaded = 0;
  if (withThumbs.length) ui.splashProgress(0, withThumbs.length);
  else ui.splashStatus('ALL TAPES SHELVED', `${catalog.videos.length} IN STOCK`);
  ui.splashReady();
  const thumbFor = async (v) => {
    if (!(await loadThumb(v))) return;
    paintCover(v);
    store.refreshArt(v);
  };
  mapLimit(withThumbs, 12, async (v) => {
    await thumbFor(v);
    loaded++;
    ui.splashProgress(loaded, withThumbs.length);
  }).then(() => mapLimit(areaVideos.filter((v) => v.thumb), 8, thumbFor));

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
    } else if (!arcade.busy && !theater.busy) {
      controls.update(dt);
    }
    arcade.update(dt, camera); // the machines, and the camera while crouching / seated
    theater.update(dt, camera); // the couch's camera, the tape playing
    if (mode === 'walk') {
      // (on a touchscreen there's no crosshair: only the VCR's prompt shows)
      if (!isTouch) setTarget(aim(controls.dragLook ? mouse : center));
      else setTarget(carried && theater.nearVcr(camera.position) ? aim(center) : null);
    }
    store.update(dt, time);
    inspector.update(dt, mode === 'walk' ? Math.min(1, Math.hypot(controls.vel.x, controls.vel.z) / DIM.WALK) : 0);
    flushTimer += dt;
    if (flushTimer > 0.35) {
      flushTimer = 0;
      atlas.flush();
    }
  }

  function draw() {
    culling.update(camera);
    renderer.clear();
    if (ps1.enabled) ps1.render(scene, camera);
    else renderer.render(scene, camera);
    inspector.render(renderer, ps1.enabled ? ps1 : null);
    theater.render(camera, culling.visible);
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
      plan, catalog, controls, camera, scene, renderer, tapes, inspector, store, arcade, ps1, culling, theater, setPS1, goToVideo, pickUp, putBack, grab, insertTape, sitDown, standUp, setMode, raySlot, aim, enterPlay, exitPlay,
      get mode() { return mode; },
      get hovered() { return hovered; },
      get target() { return target; },
      get carried() { return carried; },
      get inVcr() { return inVcr; },
      /** Let go of any tape you're carrying and empty the VCR (resets between tests). */
      emptyHands() {
        if (carried) tapes.show(carried.slot);
        if (inVcr) tapes.show(inVcr.slot);
        carried = inVcr = null;
        inspector.dropCarry();
        theater.eject();
      },
      advance(seconds, step = 1 / 60) {
        for (let t = 0; t < seconds; t += step) tick(step);
        draw();
      },
    };
  }
}

main();

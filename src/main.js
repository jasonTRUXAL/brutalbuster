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
  renderer.compile(scene, camera);

  // ------------------------------------------------------------ state machine
  let mode = 'splash';
  let hovered = -1;
  let heldSlot = -1;
  const setMode = (m) => {
    mode = m;
    ui.setMode(m);
    controls.enabled = m === 'walk';
    if (m !== 'walk') setHover(-1);
  };

  function setHover(slot) {
    if (slot === hovered) return;
    hovered = slot;
    tapes.setHover(slot);
    if (slot < 0) return ui.hover(null);
    const s = plan.slots[slot];
    ui.hover({
      title: s.video.title,
      aisle: catalog.aisleById.get(s.video.aisle)?.name || s.section.label,
      hint: isTouch ? 'Tap to pick up' : 'Click to pick up',
    });
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
  ui.buildDirectory(catalog, atlas, (id) => goToVideo(id));

  controls.onLockChange = (locked, failed) => {
    document.body.classList.toggle('drag-look', controls.dragLook);
    if (locked && (mode === 'paused' || mode === 'splash')) setMode('walk');
    else if (!locked && mode === 'walk' && !controls.dragLook) setMode('paused');
    else if (failed && controls.dragLook && mode === 'paused') setMode('walk');
  };
  controls.onTap = (x, y) => {
    if (mode !== 'walk') return;
    const slot = raySlot(new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1));
    if (slot >= 0) pickUp(slot);
  };

  const mouse = new THREE.Vector2();
  canvas.addEventListener('mousemove', (e) => mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1));
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || mode !== 'walk') return;
    if (controls.locked && hovered >= 0) pickUp(hovered);
  });
  canvas.addEventListener('click', () => {
    if (mode === 'walk' && controls.dragLook && hovered >= 0 && controls.dragDist < 6) pickUp(hovered);
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
      return;
    }
    if (mode === 'walk' && e.code === 'KeyE' && hovered >= 0) pickUp(hovered);
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
        if (toCam.x * s.face.n.x + toCam.z * s.face.n.z > 0) return h.instanceId;
        break;
      }
    }
    return -1;
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
    } else {
      controls.update(dt);
    }
    if (mode === 'walk' && !isTouch) setHover(raySlot(controls.dragLook ? mouse : center));
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
      plan, catalog, controls, camera, scene, renderer, tapes, inspector, store, goToVideo, pickUp, putBack, setMode, raySlot,
      get mode() { return mode; },
      get hovered() { return hovered; },
      advance(seconds, step = 1 / 60) {
        for (let t = 0; t < seconds; t += step) tick(step);
        draw();
      },
    };
  }
}

main();

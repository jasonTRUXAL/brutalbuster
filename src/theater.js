// The lounge, working: the VCR under the screen takes the tape you're carrying and plays
// it on the big screen, and you can sit on the couches.
//
// A YouTube video can't be drawn into the 3D scene (browser security rules), so the real
// player sits in the page *behind* the canvas, lined up with the screen by three.js's
// CSS3DRenderer. While it plays, ProjectorScreen ('video' mode, lounge.js) leaves the
// canvas see-through over the screen, so the player shows through there and anything in
// front of the screen (a wall, a couch, the tape you're carrying) still hides it.
//
// A tape starts like an old VCR's (ProjectorScreen's intro: black, static while it
// auto-tracks, the tape's details), and the video itself starts at the end of that. The
// player loads paused meanwhile. Starting it, the volume (fading as you walk away) and
// "the tape has ended" all go through YouTube's embed messages (the same ones its own
// iframe API sends).
import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import { DIM } from './config.js';
import { roomAt } from './layout.js';
import { easeInOut } from './util.js';

const YT = 'https://www.youtube-nocookie.com';
const PX = 1280; // the player's width in CSS pixels (720p), scaled down to the screen
const SIT_TIME = 0.75;
const START_WAIT = 3; // after the intro, how long to wait for the picture before showing the player anyway
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const _look = new THREE.Matrix4();
const _hit = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class Theater {
  /** `parts` is what buildLounge() returned (the screen and the VCR's display). */
  constructor({ plan, parts, canvas }) {
    this.plan = plan;
    this.L = plan.lounge;
    this.projection = parts.projection;
    this.display = parts.vcr;

    this.css = new CSS3DRenderer();
    this.css.domElement.id = 'theater';
    this.css.domElement.style.display = 'none';
    this.css.setSize(window.innerWidth, window.innerHeight);
    canvas.before(this.css.domElement); // underneath the canvas
    this.cssScene = new THREE.Scene();
    const s = this.L.screen;
    this.holder = document.createElement('div');
    this.holder.className = 'theater-screen';
    this.holder.style.width = `${PX}px`;
    this.holder.style.height = `${Math.round((PX * s.h) / s.w)}px`;
    const object = new CSS3DObject(this.holder);
    object.position.set(s.x - 0.025, s.y, s.z);
    object.rotation.y = Math.PI / 2;
    object.scale.setScalar(s.w / PX);
    this.cssScene.add(object);

    this.couches = this.L.sofas.map((so) => new THREE.Box3(new THREE.Vector3(so.x - so.depth / 2, 0, so.z - so.len / 2), new THREE.Vector3(so.x + so.depth / 2, 0.95, so.z + so.len / 2)));
    this.seat = null;
    this.tween = null; // { from, to, t, onDone, leaving }
    this.standing = null;

    this.video = null; // the tape that's in
    this.iframe = null;
    this.stage = null; // 'intro' | 'starting' (asked it to play) | 'playing'
    this.waited = 0;
    this.playing = false; // has the player said it's playing?
    this.shown = false;
    this.volume = -1;
    this.heard = false; // has the player answered yet?
    this.listenIn = 0;
    this.asks = 0;
    this.onEnded = null;
    this.onPicture = null; // the video's just come up on the screen
    window.addEventListener('message', (e) => this._message(e));
  }

  // ------------------------------------------------------------ the VCR

  /** True when `p` is close in front of the VCR (it faces into the room). */
  nearVcr(p) {
    const v = this.L.vcr;
    const dx = p.x - v.x;
    const dz = p.z - v.z;
    return dx * v.n.x + dz * v.n.z > 0 && Math.hypot(dx, dz) < DIM.VCR_NEAR;
  }

  /** Put a tape in: the VCR's intro on the screen while the player loads, paused, behind it. */
  insert(video) {
    this.eject();
    this.video = video;
    const f = document.createElement('iframe');
    f.src = this._src(video, false);
    f.title = video.title;
    f.allow = 'autoplay; encrypted-media';
    f.referrerPolicy = 'strict-origin-when-cross-origin';
    // Nothing in it is clicked or typed into (the canvas is on top), and it mustn't take
    // the focus: losing focus to a frame makes the browser let go of the mouse.
    f.inert = true;
    f.tabIndex = -1;
    f.addEventListener('load', () => {
      this.listenIn = 0; // start asking it for news
      this.asks = 0;
    });
    this.holder.appendChild(f);
    this.iframe = f;
    this.listenIn = Infinity; // (once it has loaded)
    this.stage = 'intro';
    this.playing = false;
    this.projection.startIntro(tapeDetails(video));
    this.display.setState('load');
    this.shown = false;
    this.css.domElement.style.visibility = 'hidden';
    this.css.domElement.style.display = '';
  }

  _src(video, autoplay) {
    const q = new URLSearchParams({ autoplay: autoplay ? 1 : 0, controls: 0, rel: 0, modestbranding: 1, playsinline: 1, iv_load_policy: 3, disablekb: 1, enablejsapi: 1, origin: location.origin });
    return `${YT}/embed/${encodeURIComponent(video.youtubeId)}?${q}`;
  }

  /** The intro's over: start the video. (If the player never answered, load it again, playing.) */
  _start() {
    this.stage = 'starting';
    this.waited = 0;
    this.projection.setMode('wait');
    if (this.heard) this._post({ event: 'command', func: 'playVideo', args: [] });
    else this.iframe.src = this._src(this.video, true);
  }

  /** Stop the tape: the screen goes back to the bouncing logo. */
  eject() {
    if (!this.video) return;
    this.holder.textContent = '';
    this.iframe = null;
    this.video = null;
    this.stage = null;
    this.volume = -1;
    this.heard = false;
    this.projection.setMode('logo');
    this.display.setState('idle');
    this.css.domElement.style.display = 'none';
  }

  _post(msg) {
    this.iframe?.contentWindow?.postMessage(JSON.stringify({ id: 1, channel: 'widget', ...msg }), YT);
  }

  _message(e) {
    if (!this.iframe || e.source !== this.iframe.contentWindow) return;
    let data;
    try {
      data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
    } catch {
      return;
    }
    if (!this.heard) this.volume = -1; // it's listening now: send the volume again
    this.heard = true;
    const state = data?.event === 'onStateChange' ? data.info : data?.event === 'infoDelivery' ? data.info?.playerState : undefined;
    if (state === 1) this.playing = true;
    if (state === 0 && this.stage === 'playing') {
      // the end of the tape
      const video = this.video;
      this.eject();
      this.onEnded?.(video);
    }
  }

  // ------------------------------------------------------------ the couches

  /** The couch seat a ray points at (the one nearest where it hits), within `far` metres. */
  pickSeat(ray, far) {
    let best = null;
    this.couches.forEach((box, sofa) => {
      if (!ray.intersectBox(box, _hit)) return;
      const distance = _hit.distanceTo(ray.origin);
      if (distance > far || (best && distance >= best.distance)) return;
      let seat = null;
      for (const s of this.L.seats) if (s.sofa === sofa && (!seat || Math.abs(s.z - _hit.z) < Math.abs(seat.z - _hit.z))) seat = s;
      best = { seat, index: this.L.seats.indexOf(seat), distance };
    });
    return best;
  }

  /** Sit down: the camera eases onto the seat, facing the screen. */
  sit(seat, camera) {
    if (this.busy) return;
    this.seat = seat;
    this.standing = { pos: camera.position.clone(), quat: camera.quaternion.clone() };
    const pos = new THREE.Vector3(seat.x, seat.y, seat.z);
    const s = this.L.screen;
    const quat = new THREE.Quaternion().setFromRotationMatrix(_look.lookAt(pos, new THREE.Vector3(s.x, s.y - 0.08, s.z), UP));
    this.tween = { from: this.standing, to: { pos, quat }, t: 0 };
  }

  /** Stand back up; `onDone` runs once the camera is back where it was. */
  stand(camera, onDone) {
    if (!this.seat) return;
    this.tween = { from: { pos: camera.position.clone(), quat: camera.quaternion.clone() }, to: this.standing, t: 0, onDone, leaving: true };
  }

  /** True while the couch owns the camera (sitting, or getting up / down). */
  get busy() {
    return Boolean(this.seat || this.tween);
  }

  get seated() {
    return Boolean(this.seat && !this.tween);
  }

  // ------------------------------------------------------------ every frame

  update(dt, camera) {
    const tw = this.tween;
    if (tw) {
      tw.t += dt;
      const k = easeInOut(Math.min(1, tw.t / SIT_TIME));
      camera.position.lerpVectors(tw.from.pos, tw.to.pos, k);
      camera.quaternion.slerpQuaternions(tw.from.quat, tw.to.quat, k);
      if (tw.t >= SIT_TIME) {
        this.tween = null;
        if (tw.leaving) {
          this.seat = null;
          tw.onDone?.();
        }
      }
    }
    if (!this.video) return;
    if (this.stage === 'intro' && this.projection.introDone) this._start();
    else if (this.stage === 'starting' && (this.playing || (this.waited += dt) >= START_WAIT)) {
      // it's playing: blip into the picture
      this.stage = 'playing';
      this.projection.setMode('blip');
      this.display.setState('play');
      this.onPicture?.();
    }

    // until the player answers, keep asking it to (it ignores us until it's ready); give
    // up after ten seconds (it didn't load: blocked, say), and it just plays at full volume
    if (!this.heard && (this.listenIn -= dt) <= 0) {
      this._post({ event: 'listening' });
      this.listenIn = ++this.asks < 20 ? 0.5 : Infinity;
    }
    // full volume in the lounge, fading with distance, and fainter through the walls
    const s = this.L.screen;
    const p = camera.position;
    const d = Math.hypot(p.x - s.x, p.z - s.z);
    const level = THREE.MathUtils.clamp(1 - (d - 3.5) / 12, 0, 1) * (roomAt(this.plan, p) === 'lounge' ? 1 : 0.5);
    const volume = Math.round(level * 20) * 5;
    if (volume !== this.volume && this.heard) {
      this._post({ event: 'command', func: 'setVolume', args: [volume] });
      this.volume = volume;
    }
  }

  /**
   * Keep the player lined up with the screen. `rooms` (from RoomCulling) says whether the
   * lounge could be in view; when it can't, or the picture isn't up yet, it's hidden.
   * (It's laid out even then: an iframe that isn't in the page doesn't load.)
   */
  render(camera, rooms) {
    if (!this.video) return;
    const shown = this.projection.mode === 'video' && rooms.has('lounge');
    if (shown !== this.shown) {
      this.shown = shown;
      this.css.domElement.style.visibility = shown ? '' : 'hidden';
    }
    this.css.render(this.cssScene, camera);
  }

  resize(w, h) {
    this.css.setSize(w, h);
  }
}

/** What the screen shows of a tape before it plays: its title, then the date it went up and its length. */
export function tapeDetails(video) {
  const lines = [];
  const d = video.publishedAt ? new Date(video.publishedAt) : null;
  if (d && !Number.isNaN(d.getTime())) lines.push(`PUBLISHED ${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, '0')} ${d.getUTCFullYear()}`);
  if (video.duration) lines.push(`LENGTH ${video.duration}`);
  return { title: video.title, lines };
}

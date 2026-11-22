// PS1 Mode: an optional look that draws the store like a mid-90s console game.
// The world is rendered into a 240-pixel-high picture (240 wide on a portrait phone)
// and blown up with hard pixel edges.
// Vertices snap to that pixel grid (the wobble), textures are mapped without
// perspective correction (the warp) and are shrunk and point-sampled, and every
// pixel is dithered down to 15-bit colour the way the PlayStation wrote its
// framebuffer. Distance fog stands in for the short draw distance.
//
// Snapping shifts each polygon by up to half a pixel, which is enough for a sign to
// sink into the board a few mm behind it. Materials flagged `userData.decal = true`
// (and the thumbnails, which are decals too) get a small depth offset while it's on.
//
// The video thumbnails are the exception. Materials flagged
// `userData.thumbnail = true` (box covers, posters, the standee, the counter TV, the
// held tape's front and back) keep their full-size textures and are drawn a second
// time at full resolution, depth-tested against the low-res picture, so the tapes
// stay recognisable while the store around them goes polygonal.
//
// Materials are patched the first time PS1 Mode turns on. Shared uniforms switch the
// effects, so turning it off again runs the same shaders with everything disabled.
import * as THREE from 'three';
import { makeCanvas } from './util.js';

export const PS1 = {
  LINES: 240, // pixels along the screen's shorter side, like the PS1's 240 lines
  TEX_TEXELS: 256 * 128, // texel budget per texture (aspect ratio kept), a typical PS1 page
  TEX_MAX: 1024, // longest side of a shrunk texture
  TEX_MIN: 48, // shortest side kept, so sign lettering stays readable
  FOG: { color: 0x0b0a1c, near: 8, far: 36 },
};

// Shared by every patched material. Values change per pass; three re-uploads them
// on each render() call.
const BLANK = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
BLANK.needsUpdate = true;
const U = {
  uPsSnap: { value: new THREE.Vector2() }, // low-res grid in pixels; 0 = no snapping
  uPsAffine: { value: 0 }, // 1 = affine (PS1) texture mapping
  uPsOut: { value: 0 }, // 1 while drawing into the low-res target: tone map, sRGB and dither in-shader
  uPsExposure: { value: 1 },
  uPsDepth: { value: BLANK }, // the low-res depth, for the sharp thumbnail pass
  uPsDepthOn: { value: 0 },
  uPsView: { value: new THREE.Vector3(1, 1, 1) }, // screen width, height, screen px per low-res px
  uPsClip: { value: new THREE.Vector2(0.1, 100) }, // camera near, far
};

// ------------------------------------------------------------ shader patches

const VERT_DECL = /* glsl */ `
uniform vec2 uPsSnap;
uniform float uPsAffine;
#if defined( USE_MAP ) && ! defined( PS1_THUMB )
varying float vPsW;
#endif`;

const VERT_SNAP = /* glsl */ `
if ( uPsSnap.x > 0.0 && gl_Position.w > 0.0 ) {
	vec2 psGrid = uPsSnap * 0.5;
	gl_Position.xy = floor( gl_Position.xy / gl_Position.w * psGrid + 0.5 ) / psGrid * gl_Position.w;
}
#if defined( USE_MAP ) && ! defined( PS1_THUMB )
// affine mapping: interpolate uv * w and w, divide per pixel (= no perspective correction)
vPsW = mix( 1.0, gl_Position.w, uPsAffine );
vMapUv *= vPsW;
#endif`;

const FRAG_DECL = /* glsl */ `
uniform float uPsOut;
uniform float uPsExposure;
#if defined( USE_MAP ) && ! defined( PS1_THUMB )
varying float vPsW;
#endif
#ifdef PS1_THUMB
uniform sampler2D uPsDepth;
uniform float uPsDepthOn;
uniform vec3 uPsView;
uniform vec2 uPsClip;
float psViewDepth( float z ) { return uPsClip.x * uPsClip.y / ( uPsClip.y - z * ( uPsClip.y - uPsClip.x ) ); }
#endif
// three.js's ACES filmic curve. Three only tone maps when drawing to the screen.
vec3 psACES( vec3 color ) {
	const mat3 inM = mat3( vec3( 0.59719, 0.07600, 0.02840 ), vec3( 0.35458, 0.90834, 0.13383 ), vec3( 0.04823, 0.01566, 0.83777 ) );
	const mat3 outM = mat3( vec3( 1.60475, -0.10208, -0.00327 ), vec3( -0.53108, 1.10813, -0.07276 ), vec3( -0.07367, -0.00605, 1.07602 ) );
	color = inM * ( color * uPsExposure / 0.6 );
	vec3 a = color * ( color + 0.0245786 ) - 0.000090537;
	vec3 b = color * ( 0.983729 * color + 0.4329510 ) + 0.238081;
	return saturate( outM * ( a / b ) );
}
// The PlayStation's 4x4 dither table, applied as it cut 24-bit colour down to 15 bits.
vec3 psDither( vec3 c ) {
	const float table[ 16 ] = float[ 16 ]( -4.0, 0.0, -3.0, 1.0, 2.0, -2.0, 3.0, -1.0, -3.0, 1.0, -4.0, 0.0, 3.0, -1.0, 2.0, -2.0 );
	ivec2 p = ivec2( mod( gl_FragCoord.xy, 4.0 ) );
	return clamp( floor( ( c * 255.0 + table[ p.y * 4 + p.x ] ) / 8.0 ), 0.0, 31.0 ) / 31.0;
}`;

// Thumbnail pass: skip any pixel the low-res picture has something in front of.
// The slack covers the depth change across one low-res pixel.
const FRAG_DEPTH_TEST = /* glsl */ `
#ifdef PS1_THUMB
float psSelf = psViewDepth( gl_FragCoord.z );
float psSlack = 0.004 + psSelf * 0.002 + fwidth( psSelf ) * uPsView.z;
if ( uPsDepthOn > 0.5 && psSelf > psViewDepth( texture2D( uPsDepth, gl_FragCoord.xy / uPsView.xy ).x ) + psSlack ) discard;
#endif`;

const FRAG_MAP = /* glsl */ `
#if defined( USE_MAP ) && ! defined( PS1_THUMB )
	diffuseColor *= texture2D( map, vMapUv / vPsW );
#else
	#include <map_fragment>
#endif`;

const FRAG_OUT = /* glsl */ `
if ( uPsOut > 0.5 ) {
	#ifdef PS1_TONE
	gl_FragColor.rgb = psACES( gl_FragColor.rgb );
	#endif
	gl_FragColor = sRGBTransferOETF( vec4( max( gl_FragColor.rgb, 0.0 ), gl_FragColor.a ) );
}`;

const FRAG_DITHER = /* glsl */ `
if ( uPsOut > 0.5 ) gl_FragColor.rgb = psDither( gl_FragColor.rgb );`;

const VERT_EDITS = [
  ['#include <common>', VERT_DECL, 'after'],
  ['#include <project_vertex>', VERT_SNAP, 'after'],
];
const FRAG_EDITS = [
  ['#include <common>', FRAG_DECL, 'after'],
  ['#include <clipping_planes_fragment>', FRAG_DEPTH_TEST, 'after'],
  ['#include <map_fragment>', FRAG_MAP, 'replace'],
  ['#include <colorspace_fragment>', FRAG_OUT, 'after'],
  ['#include <dithering_fragment>', FRAG_DITHER, 'after'],
];

/**
 * Add the PS1 effects to a built-in material's shader (as passed to onBeforeCompile).
 * Returns the anchors it couldn't find, which means three.js changed its shader chunks.
 */
export function injectPS1(shader, { thumb = false, tone = true } = {}) {
  const missing = [];
  const apply = (src, edits) =>
    edits.reduce((s, [anchor, code, how]) => {
      if (!s.includes(anchor)) {
        missing.push(anchor);
        return s;
      }
      return s.replace(anchor, how === 'replace' ? code : `${anchor}\n${code}`);
    }, src);
  const defs = thumb ? '#define PS1_THUMB\n' : '';
  shader.vertexShader = defs + apply(shader.vertexShader, VERT_EDITS);
  shader.fragmentShader = defs + (tone ? '#define PS1_TONE\n' : '') + apply(shader.fragmentShader, FRAG_EDITS);
  Object.assign(shader.uniforms, U);
  return missing;
}

const PATCHABLE = new Set(['MeshBasicMaterial', 'MeshStandardMaterial', 'MeshPhysicalMaterial', 'MeshLambertMaterial', 'MeshPhongMaterial']);
const patched = new WeakSet();
let warned = false;

function patchMaterial(mat) {
  if (patched.has(mat)) return;
  patched.add(mat);
  if (!PATCHABLE.has(mat.type)) return; // custom ShaderMaterials draw as they are
  const thumb = Boolean(mat.userData.thumbnail);
  const tone = mat.toneMapped;
  const prev = mat.onBeforeCompile;
  // Read the key before replacing onBeforeCompile: three's default key is its source text.
  const key = `${mat.customProgramCacheKey()}|ps1:${thumb ? 'thumb' : 'world'}:${tone ? 1 : 0}`;
  mat.onBeforeCompile = function (shader, renderer) {
    prev.call(this, shader, renderer);
    const missing = injectPS1(shader, { thumb, tone });
    if (missing.length && !warned) {
      warned = true;
      console.warn(`PS1 Mode: three.js shader chunks changed; missing ${missing.join(', ')}`);
    }
  };
  mat.customProgramCacheKey = () => key;
  mat.needsUpdate = true;
}

// ------------------------------------------------------------ textures

/** Size of a texture once shrunk to PS1 proportions. Never enlarges. */
export function crunchSize(w, h) {
  const k = Math.min(1, Math.max(Math.sqrt(PS1.TEX_TEXELS / (w * h)), PS1.TEX_MIN / Math.min(w, h)), PS1.TEX_MAX / Math.max(w, h));
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

// ------------------------------------------------------------ decals

const lifted = new Map(); // material -> its original polygon offset

function lift(mat) {
  if (lifted.has(mat) || !(mat.userData.decal || mat.userData.thumbnail)) return;
  lifted.set(mat, { polygonOffset: mat.polygonOffset, polygonOffsetFactor: mat.polygonOffsetFactor, polygonOffsetUnits: mat.polygonOffsetUnits });
  mat.addEventListener('dispose', unlist);
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -2; // in low-res pixels' worth of depth slope: covers the snap
  mat.polygonOffsetUnits = -2;
}

function unliftAll() {
  for (const [mat, orig] of lifted) Object.assign(mat, orig);
  lifted.clear();
}

const unlist = (e) => lifted.delete(e.target);

const crunched = new Map(); // texture -> its original settings
const forget = (e) => crunched.delete(e.target);

function crunch(tex) {
  if (!tex || crunched.has(tex)) return;
  const img = tex.image;
  if (!img?.width || !img.height) return; // not loaded yet; try again next frame
  crunched.set(tex, { image: img, minFilter: tex.minFilter, magFilter: tex.magFilter, generateMipmaps: tex.generateMipmaps, anisotropy: tex.anisotropy });
  tex.addEventListener('dispose', forget);
  const [w, h] = crunchSize(img.width, img.height);
  if (w !== img.width || h !== img.height) {
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    tex.image = c;
  }
  // Point-sampled. The PS1 had no mipmaps either, but without them distant signs
  // dissolve into noise, so keep (point-sampled) mip levels.
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapNearestFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 1;
  tex.needsUpdate = true;
}

function uncrunchAll() {
  for (const [tex, orig] of crunched) {
    Object.assign(tex, orig);
    tex.needsUpdate = true;
  }
  crunched.clear();
}

// ------------------------------------------------------------ the renderer

/** Size of the low-res picture for a screen: PS1.LINES on the shorter side, even numbers. */
export function lowResSize(screenW, screenH) {
  const even = (v) => Math.max(2, Math.round(v / 2) * 2);
  return screenW >= screenH ? [even((PS1.LINES * screenW) / screenH), PS1.LINES] : [PS1.LINES, even((PS1.LINES * screenH) / screenW)];
}

const BLIT_VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }';
const BLIT_FRAG = 'uniform sampler2D tLow; varying vec2 vUv; void main() { gl_FragColor = texture2D( tLow, vUv ); }';

const _clear = new THREE.Color();

export class PS1Mode {
  /** `scene` is the store: it gets the fog, and its textures are shrunk up front. */
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.enabled = false;
    this.target = new THREE.WebGLRenderTarget(2, 2, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
      depthTexture: new THREE.DepthTexture(2, 2),
    });
    this.blit = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: { tLow: { value: this.target.texture } },
        vertexShader: BLIT_VERT,
        fragmentShader: BLIT_FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.blit.frustumCulled = false;
    this.blitScene = new THREE.Scene();
    this.blitScene.add(this.blit);
    this.blitCamera = new THREE.Camera();
    this.fog = new THREE.Fog(PS1.FOG.color, PS1.FOG.near, PS1.FOG.far);
    this.materials = []; // everything drawn this frame (from the last sweep)
    this._buf = new THREE.Vector2();
  }

  setEnabled(on) {
    if (on === this.enabled) return;
    this.enabled = on;
    this.scene.fog = on ? this.fog : null;
    if (on) {
      this._sweep(this.scene);
      U.uPsAffine.value = 1;
    } else {
      uncrunchAll();
      unliftAll();
      U.uPsSnap.value.set(0, 0);
      U.uPsAffine.value = 0;
      U.uPsOut.value = 0;
    }
  }

  /** Draw the store: low-res world, blown up, then the thumbnails sharp on top. */
  render(scene, camera) {
    this._fit();
    this._sweep(scene);
    this._lowPass(scene, camera, false);
    this._blit(true);
    this._thumbPass(scene, camera);
  }

  /**
   * Draw an overlay scene (the held tape) over the store. `backdrop` (the dimmer) is
   * drawn first at full resolution; `subject` goes through the PS1 passes.
   */
  renderOverlay(scene, camera, { backdrop, subject }) {
    const r = this.renderer;
    this._fit();
    this._sweep(scene);
    r.clearDepth();
    subject.visible = false;
    r.render(scene, camera);
    subject.visible = true;
    backdrop.visible = false;
    this._lowPass(scene, camera, true);
    this._blit(false);
    this._thumbPass(scene, camera);
    backdrop.visible = true;
  }

  /** Match the low-res target to the screen's shape. */
  _fit() {
    const buf = this.renderer.getDrawingBufferSize(this._buf);
    const [w, h] = lowResSize(buf.x, buf.y);
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);
    U.uPsSnap.value.set(w, h);
    U.uPsView.value.set(buf.x, buf.y, buf.y / h);
    U.uPsExposure.value = this.renderer.toneMappingExposure;
  }

  /** Patch new materials, shrink new textures, and list what's drawn this frame. */
  _sweep(scene) {
    const list = this.materials;
    list.length = 0;
    scene.traverseVisible((o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        patchMaterial(m);
        lift(m);
        if (!m.userData.thumbnail) crunch(m.map);
        list.push(m);
      }
    });
  }

  _lowPass(scene, camera, transparent) {
    const r = this.renderer;
    r.setRenderTarget(this.target);
    if (transparent) {
      r.getClearColor(_clear);
      const alpha = r.getClearAlpha();
      r.setClearColor(0x000000, 0);
      r.clear();
      r.setClearColor(_clear, alpha);
    } else {
      r.clear();
    }
    U.uPsOut.value = 1;
    r.render(scene, camera);
    U.uPsOut.value = 0;
    r.setRenderTarget(null);
  }

  /**
   * Blow the low-res picture up onto the screen. The store's is copied as it is, alpha
   * and all (it's opaque except where the lounge screen is clear for the video, and that
   * has to stay see-through); an overlay's is blended over what's there.
   */
  _blit(store) {
    this.blit.material.blending = store ? THREE.NoBlending : THREE.NormalBlending;
    this.renderer.render(this.blitScene, this.blitCamera);
  }

  /** Redraw only the thumbnail materials at full resolution. */
  _thumbPass(scene, camera) {
    const r = this.renderer;
    const hidden = [];
    for (const m of this.materials) {
      if (!m.userData.thumbnail && m.visible) {
        m.visible = false;
        hidden.push(m);
      }
    }
    if (hidden.length < this.materials.length) {
      U.uPsDepth.value = this.target.depthTexture;
      U.uPsDepthOn.value = 1;
      U.uPsClip.value.set(camera.near, camera.far);
      const bg = scene.background;
      scene.background = null; // a colour background would clear the screen
      r.clearDepth();
      r.render(scene, camera);
      scene.background = bg;
      U.uPsDepth.value = BLANK; // never leave the target's own depth bound while drawing into it
      U.uPsDepthOn.value = 0;
    }
    for (const m of hidden) m.visible = true;
  }
}

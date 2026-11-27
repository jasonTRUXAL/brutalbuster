// The debug overlay (the ` key, or ?debug in the address): frame rate and frame times,
// how long the store's own code takes each frame (CPU) and, where the browser can time
// it, the GPU; draw calls and triangles; memory (the JS heap, and an estimate of what's
// on the graphics card); downloads; the device; and how long each step of loading
// took. It's in the live site too, for checking how the store runs on a real machine.

const KB = 1024;
const MB = KB * KB;
const mb = (n) => `${(n / MB).toFixed(n < 10 * MB ? 1 : 0)} MB`;
const ms = (n) => `${n.toFixed(n < 10 ? 1 : 0)} ms`;

/** Times kept for the last second, for averages and the worst. */
class Window {
  constructor() {
    this.items = [];
  }
  push(t, v) {
    this.items.push([t, v]);
    while (this.items.length && t - this.items[0][0] > 1000) this.items.shift();
  }
  get count() {
    return this.items.length;
  }
  get avg() {
    return this.items.length ? this.items.reduce((s, [, v]) => s + v, 0) / this.items.length : 0;
  }
  get max() {
    return this.items.reduce((m, [, v]) => Math.max(m, v), 0);
  }
}

export class DebugOverlay {
  /**
   * `boot` is the load's timeline ([{ name, t }], ms since the page was opened);
   * `scenes` the scenes to count textures and geometry in; `info()` returns the
   * store's own lines ({ label: value }), asked for on each refresh.
   */
  constructor({ renderer, scenes, boot, info }) {
    this.renderer = renderer;
    this.scenes = scenes;
    this.boot = boot;
    this.info = info;
    this.el = document.createElement('pre');
    this.el.id = 'debug';
    this.el.hidden = true;
    document.body.appendChild(this.el);
    this.frames = new Window();
    this.cpu = new Window();
    this.gpu = new Window();
    this.lastFrame = 0;
    this.lastText = 0;
    this.lastCount = -Infinity;
    this.memory = null;
    const gl = renderer.getContext();
    this.gl = gl;
    this.timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.queries = [];
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpuName = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    // count every draw call in a frame, not just the last render() of it
    renderer.info.autoReset = false;
  }

  get visible() {
    return !this.el.hidden;
  }

  toggle(on = this.el.hidden) {
    this.el.hidden = !on;
    if (!on) return;
    this.lastCount = -Infinity; // (count the memory now)
    this._render(performance.now());
  }

  /** Before the frame's drawing: reset the counters, start the GPU timer. */
  beginDraw() {
    this.renderer.info.reset();
    if (!this.visible || !this.timer || this.queries.length > 3) return;
    const q = this.gl.createQuery();
    this.gl.beginQuery(this.timer.TIME_ELAPSED_EXT, q);
    this.queries.push(q);
    this.timing = q;
  }

  endDraw() {
    if (!this.timing) return;
    this.gl.endQuery(this.timer.TIME_ELAPSED_EXT);
    this.timing = null;
  }

  /** A frame's done: `cpu` is the ms the store's code took for it. */
  frame(now, cpu) {
    if (this.lastFrame) this.frames.push(now, now - this.lastFrame);
    this.lastFrame = now;
    if (!this.visible) return;
    this.cpu.push(now, cpu);
    this._readQueries(now);
    if (now - this.lastText > 250) {
      this.lastText = now;
      this._render(now);
    }
  }

  _readQueries(now) {
    const gl = this.gl;
    while (this.queries.length && this.queries[0] !== this.timing) {
      const q = this.queries[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      if (!gl.getParameter(this.timer.GPU_DISJOINT_EXT)) this.gpu.push(now, gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(q);
      this.queries.shift();
    }
  }

  /** What's on the graphics card (roughly): textures and geometry in the scenes. */
  _countMemory() {
    const textures = new Set();
    const geometries = new Set();
    for (const scene of this.scenes) {
      if (scene.background?.isTexture) textures.add(scene.background);
      scene.traverse((o) => {
        if (o.geometry) geometries.add(o.geometry);
        for (const m of [].concat(o.material || [])) {
          for (const v of Object.values(m)) if (v?.isTexture) textures.add(v);
          for (const u of Object.values(m.uniforms || {})) if (u.value?.isTexture) textures.add(u.value);
        }
      });
    }
    let tex = 0;
    for (const t of textures) {
      const img = t.image;
      const w = img?.width || img?.videoWidth || 0;
      const h = img?.height || img?.videoHeight || 0;
      tex += w * h * 4 * (t.generateMipmaps && t.minFilter !== 1006 ? 4 / 3 : 1); // (1006: LinearFilter, no mipmaps)
    }
    let geo = 0;
    for (const g of geometries) {
      for (const a of Object.values(g.attributes)) geo += a.array.byteLength;
      if (g.index) geo += g.index.array.byteLength;
    }
    for (const scene of this.scenes) {
      scene.traverse((o) => {
        if (o.isInstancedMesh) geo += o.instanceMatrix.array.byteLength + (o.instanceColor?.array.byteLength || 0);
      });
    }
    return { textures: textures.size, tex, geometries: geometries.size, geo };
  }

  _network() {
    const groups = new Map();
    const add = (name, bytes) => {
      const g = groups.get(name) || { n: 0, bytes: 0 };
      g.n++;
      g.bytes += bytes;
      groups.set(name, g);
    };
    const nav = performance.getEntriesByType('navigation')[0];
    if (nav) add('the store', nav.transferSize || 0);
    for (const r of performance.getEntriesByType('resource')) {
      let host = '';
      try {
        host = new URL(r.name).host;
      } catch {
        // (data: URLs and the like)
      }
      const name = host === location.host ? 'the store' : /ytimg/.test(host) ? 'thumbnails' : /youtube|google|gstatic|doubleclick/.test(host) ? 'YouTube player' : host || 'other';
      add(name, r.transferSize || 0);
    }
    return groups;
  }

  _render(now) {
    const r = this.renderer;
    const lines = [];
    const fps = this.frames.count;
    lines.push(`FPS        ${fps}   frame ${ms(this.frames.avg)} (worst ${ms(this.frames.max)})`);
    lines.push(`CPU        ${ms(this.cpu.avg)} a frame (worst ${ms(this.cpu.max)})   the store's own code`);
    lines.push(`GPU        ${this.timer ? (this.gpu.count ? `${ms(this.gpu.avg)} a frame (worst ${ms(this.gpu.max)})` : 'measuring…') : 'not measurable in this browser'}`);
    lines.push(`Draw calls ${r.info.render.calls}   triangles ${Math.round(r.info.render.triangles / 1000)}k   programs ${r.info.programs?.length ?? '?'}`);
    if (now - this.lastCount > 5000) {
      this.lastCount = now;
      this.memory = this._countMemory();
    }
    const m = this.memory;
    lines.push(`GPU memory ~${mb(m.tex + m.geo)}   textures ${m.textures} (${mb(m.tex)})   geometry ${m.geometries} (${mb(m.geo)})`);
    const heap = performance.memory;
    lines.push(heap ? `JS heap    ${mb(heap.usedJSHeapSize)} used of ${mb(heap.totalJSHeapSize)} (limit ${mb(heap.jsHeapSizeLimit)})` : 'JS heap    (only Chrome and Edge report it)');
    const c = r.domElement;
    lines.push(`Screen     ${c.width}×${c.height} (pixel ratio ${r.getPixelRatio().toFixed(2)} of ${devicePixelRatio.toFixed(2)})   cores ${navigator.hardwareConcurrency || '?'}${navigator.deviceMemory ? `   RAM ${navigator.deviceMemory} GB+` : ''}`);
    lines.push(`Graphics   ${this.gpuName}`);
    for (const [k, v] of Object.entries(this.info())) lines.push(`${k.padEnd(10)} ${v}`);
    lines.push('', 'Downloaded (so far)');
    for (const [name, g] of this._network()) lines.push(`  ${name.padEnd(16)} ${g.bytes ? `${Math.round(g.bytes / KB).toLocaleString()} KB` : '(size hidden)'} in ${g.n} file${g.n === 1 ? '' : 's'}`);
    lines.push('', 'Loading (ms since the page opened, and each step)');
    let prev = 0;
    for (const b of this.boot) {
      lines.push(`  ${String(Math.round(b.t)).padStart(6)}  +${String(Math.round(b.t - prev)).padStart(5)}  ${b.name}`);
      prev = b.t;
    }
    lines.push('', '` hides this');
    this.el.textContent = lines.join('\n');
  }
}

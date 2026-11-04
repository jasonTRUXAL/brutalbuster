// PS1 Mode patches three.js's built-in shaders by finding #include lines. If a
// three.js upgrade renames or drops one, these tests fail instead of the effect
// silently vanishing (or a shader failing to compile in someone's browser).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { injectPS1, crunchSize, lowResSize, PS1 } from '../../src/ps1.js';

// the built-in materials the store uses (and their close cousins)
const LIBS = ['basic', 'lambert', 'phong', 'standard', 'physical'];
const shaderOf = (lib) => ({
  vertexShader: THREE.ShaderLib[lib].vertexShader,
  fragmentShader: THREE.ShaderLib[lib].fragmentShader,
  uniforms: {},
});

for (const lib of LIBS) {
  test(`every PS1 patch point exists in three's ${lib} shader`, () => {
    const shader = shaderOf(lib);
    assert.deepEqual(injectPS1(shader), []);
    assert.match(shader.vertexShader, /uPsSnap/);
    assert.match(shader.vertexShader, /vMapUv \*= vPsW/);
    assert.match(shader.fragmentShader, /psDither/);
    assert.match(shader.fragmentShader, /vMapUv \/ vPsW/);
    // the original map lookup survives for thumbnails
    assert.match(shader.fragmentShader, /#include <map_fragment>/);
  });
}

test('thumbnail and tone-mapping variants are switched by defines', () => {
  const world = shaderOf('standard');
  injectPS1(world, { thumb: false, tone: true });
  assert.ok(world.fragmentShader.startsWith('#define PS1_TONE'));
  assert.doesNotMatch(world.vertexShader, /#define PS1_THUMB/);

  const thumb = shaderOf('basic');
  injectPS1(thumb, { thumb: true, tone: false });
  assert.ok(thumb.vertexShader.startsWith('#define PS1_THUMB'));
  assert.ok(thumb.fragmentShader.startsWith('#define PS1_THUMB'));
  assert.doesNotMatch(thumb.fragmentShader, /#define PS1_TONE/);
});

test('every patched material shares the same uniform objects', () => {
  const a = shaderOf('standard');
  const b = shaderOf('basic');
  injectPS1(a);
  injectPS1(b, { thumb: true });
  for (const name of ['uPsSnap', 'uPsAffine', 'uPsOut', 'uPsDepth', 'uPsDepthOn', 'uPsView', 'uPsClip']) {
    assert.ok(a.uniforms[name], `${name} is added`);
    assert.equal(a.uniforms[name], b.uniforms[name], `${name} is shared`);
  }
});

test('a missing patch point is reported, not thrown', () => {
  const shader = { vertexShader: 'void main() {}', fragmentShader: 'void main() {}', uniforms: {} };
  const missing = injectPS1(shader);
  assert.ok(missing.includes('#include <project_vertex>'));
  assert.ok(missing.includes('#include <dithering_fragment>'));
});

test('textures shrink to PS1 sizes', async (t) => {
  await t.test('never enlarges', () => {
    assert.deepEqual(crunchSize(64, 64), [64, 64]);
    assert.deepEqual(crunchSize(128, 32), [128, 32]);
  });
  await t.test('big squares fit the texel budget', () => {
    const [w, h] = crunchSize(1024, 1024);
    assert.ok(w * h <= PS1.TEX_TEXELS * 1.02, `${w}x${h}`);
    assert.equal(w, h);
  });
  await t.test('long signs keep readable lettering and a sane width', () => {
    const [w, h] = crunchSize(2048, 108);
    assert.ok(h >= PS1.TEX_MIN, `height ${h}`);
    assert.ok(w <= PS1.TEX_MAX, `width ${w}`);
    assert.ok(Math.abs(w / h - 2048 / 108) < 0.5, 'aspect ratio kept');
  });
  await t.test('never collapses to zero', () => {
    const [w, h] = crunchSize(8192, 1);
    assert.ok(w >= 1 && h >= 1);
  });
});

test('the low-res picture is 240 pixels on the shorter side', () => {
  assert.deepEqual(lowResSize(1280, 720), [426, 240]);
  assert.deepEqual(lowResSize(640, 480), [320, 240]);
  const [w, h] = lowResSize(1081, 2402); // portrait phone
  assert.equal(w, 240);
  assert.ok(Math.abs(h / w - 2402 / 1081) < 0.02 && h % 2 === 0, `${w}x${h}`);
});

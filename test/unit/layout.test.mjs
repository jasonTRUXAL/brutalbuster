// Invariants of the floor-plan solver, across catalog sizes from tiny to huge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { planStore, slotMatrix } from '../../src/layout.js';
import { DIM } from '../../src/config.js';
import { catalogOf } from './helpers.mjs';

const SIZES = [1, 15, 71, 400, 2500];

for (const n of SIZES) {
  test(`store for ${n} tape(s)`, async (t) => {
    const catalog = catalogOf(n, n < 5 ? 1 : 6);
    const plan = planStore(catalog);
    const pos = new THREE.Vector3();
    const m = new THREE.Matrix4();

    await t.test('every tape is on a shelf somewhere', () => {
      const shelved = new Set(plan.slots.map((s) => s.video.id));
      const missing = catalog.videos.filter((v) => !shelved.has(v.id));
      assert.equal(missing.length, 0, `${missing.length} tapes have no slot`);
    });

    await t.test('every genre aisle is stocked in its own section', () => {
      const sectionKeys = new Set(plan.sections.filter((s) => s.kind === 'genre').map((s) => s.key));
      for (const a of catalog.aisles) assert.ok(sectionKeys.has(a.id), `no section for ${a.id}`);
    });

    await t.test('slots sit inside the building and never overlap', () => {
      const seen = new Set();
      for (const s of plan.slots) {
        pos.setFromMatrixPosition(slotMatrix(s, m));
        assert.ok(Math.abs(pos.x) < plan.W / 2 && Math.abs(pos.z) < plan.D / 2, `slot outside room at ${pos.x},${pos.z}`);
        assert.ok(pos.y > 0 && pos.y < DIM.UNIT_H, `slot height ${pos.y}`);
        const key = `${pos.x.toFixed(3)},${pos.y.toFixed(3)},${pos.z.toFixed(3)}`;
        assert.ok(!seen.has(key), `two tapes share ${key}`);
        seen.add(key);
      }
    });

    await t.test('bays fit inside their shelving runs', () => {
      for (const f of plan.faces) {
        assert.ok(f.bays * f.bayW <= f.length + 1e-6, `face ${f.id}: ${f.bays} bays don't fit ${f.length.toFixed(2)}m`);
        for (const b of f.bayList) assert.ok(b.index < f.bays, `face ${f.id} bay ${b.index} out of range`);
      }
    });

    await t.test('the player spawns in open floor, inside the room', () => {
      const { x, z } = plan.spawn;
      const r = DIM.RADIUS;
      for (const c of plan.colliders) {
        const inside = x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r;
        assert.ok(!inside, `spawn (${x.toFixed(2)}, ${z.toFixed(2)}) collides with a fixture`);
      }
      assert.ok(Math.abs(x) < plan.W / 2 - r && Math.abs(z) < plan.D / 2 - r);
    });

    await t.test('one hanging sign per aisle', () => {
      assert.equal(plan.aisleSigns.length, plan.K + 1);
    });
  });
}

test('filler sections never reuse a real aisle name', () => {
  const raw = catalogOf(10, 2);
  raw.aisles[0].name = 'Staff Picks';
  const labels = planStore(raw).sections.filter((s) => s.kind === 'featured').map((s) => s.label);
  assert.ok(labels.length > 0);
  assert.ok(!labels.includes('Staff Picks'));
});

test('layout is deterministic for the same catalog', () => {
  const a = planStore(catalogOf(120, 6));
  const b = planStore(catalogOf(120, 6));
  assert.deepEqual(a.slots.map((s) => s.video.id), b.slots.map((s) => s.video.id));
  assert.equal(a.W, b.W);
  assert.equal(a.D, b.D);
});

test('bigger catalogs get bigger stores', () => {
  const small = planStore(catalogOf(50, 5));
  const big = planStore(catalogOf(2000, 5));
  assert.ok(big.W * big.D > small.W * small.D);
});

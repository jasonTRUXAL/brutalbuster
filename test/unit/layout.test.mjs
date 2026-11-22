// Invariants of the floor-plan solver, across catalog sizes from tiny to huge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { planStore, slotMatrix, walkFrom } from '../../src/layout.js';
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

    await t.test('every room can be walked to from the door, and nowhere outside', () => {
      const { hall, lounge, streams, extras } = plan;
      const walk = walkFrom(plan.colliders, plan.bounds, plan.spawn);
      const mid = (r) => ({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 });
      const spots = {
        hallway: mid(hall),
        'lounge, by the hallway': { x: lounge.x1 - 1.0, z: mid(lounge).z },
        'lounge, in front of the screen': { x: lounge.x0 + 1.0, z: lounge.screen.z },
        'Streams, by the archway': { x: (lounge.arch.x0 + lounge.arch.x1) / 2, z: streams.z1 - 0.6 },
        'Streams, far corner': { x: streams.x0 + 1.5, z: streams.z0 + 1.5 },
        Extras: mid(extras),
        'Extras, far corner': { x: extras.x0 + 1.2, z: extras.z0 + 1.4 },
      };
      for (const [name, p] of Object.entries(spots)) assert.ok(walk.reaches(p), `can't walk to the ${name}`);
      const outside = {
        'between the buildings, by the street': { x: -plan.W / 2 - DIM.HALL_LEN / 2, z: plan.D / 2 - DIM.HALL_FRONT / 2 },
        'behind the store, beside Extras': { x: (-plan.W / 2 + extras.x0) / 2, z: -plan.D / 2 - 1.5 },
      };
      for (const [name, p] of Object.entries(outside)) {
        assert.ok(walk.open(p), `${name}: the test spot should be clear of walls`);
        assert.ok(!walk.reaches(p), `walked out of the building, ${name}`);
      }
    });

    await t.test('rooms sit side by side without overlapping', () => {
      const rooms = plan.rooms;
      for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
        const a = rooms[i];
        const b = rooms[j];
        const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
        const oz = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
        assert.ok(ox <= 1e-6 || oz <= 1e-6, `${a.id} overlaps ${b.id}`);
      }
    });

    await t.test('shelving in the new rooms fits inside them', () => {
      for (const room of [plan.streams, plan.extras]) {
        for (const f of room.faces) {
          assert.ok(f.bays * f.bayW <= f.length + 1e-6, `${room.id}: ${f.bays} bays don't fit ${f.length.toFixed(2)}m`);
          const back = f.kind === 'wall' ? DIM.WALL_UNIT : 0;
          for (const [x, z] of [
            [f.origin.x, f.origin.z],
            [f.origin.x + f.t.x * f.length, f.origin.z + f.t.z * f.length],
            [f.origin.x - f.n.x * back, f.origin.z - f.n.z * back],
          ]) {
            assert.ok(x >= room.x0 - 1e-6 && x <= room.x1 + 1e-6 && z >= room.z0 - 1e-6 && z <= room.z1 + 1e-6, `${room.id} shelf pokes out at ${x.toFixed(2)},${z.toFixed(2)}`);
          }
        }
      }
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

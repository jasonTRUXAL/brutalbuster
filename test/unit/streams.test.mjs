// The Streams room, stocked from its own catalog (streams.json): one section per year,
// every tape on a shelf, the room growing to fit, and the sales floor left as it was.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { planStore, slotMatrix, walkFrom } from '../../src/layout.js';
import { addArea, shelfName, AREAS } from '../../src/catalog.js';
import { DIM } from '../../src/config.js';
import { catalogOf, rawArchive } from './helpers.mjs';

const STREAMS = AREAS.find((a) => a.id === 'streams');
const withStreams = (main, streams) => {
  const catalog = catalogOf(main, 6);
  addArea(catalog, STREAMS, rawArchive(streams));
  return catalog;
};

test('an area catalog joins the lookups but not the sales floor', () => {
  const catalog = withStreams(40, 30);
  const area = catalog.areas.streams;
  assert.equal(catalog.videos.length, 40, 'the sales floor keeps its own tapes');
  assert.equal(area.videos.length, 30);
  assert.ok(area.aisles.every((a) => a.id.startsWith('streams-') && /^\d{4}$/.test(a.name)));
  const v = area.videos[0];
  assert.equal(catalog.videoById.get(v.id), v);
  assert.equal(v.area, 'streams');
  assert.equal(shelfName(catalog.aisleById.get(v.aisle)), `Streams · ${catalog.aisleById.get(v.aisle).name}`);
  assert.equal(shelfName(catalog.aisles[0]), catalog.aisles[0].name, 'sales-floor aisles keep their plain names');
});

test('without a Streams catalog the room is "coming soon"', () => {
  const plan = planStore(catalogOf(40, 6));
  assert.equal(plan.streams.stocked, false);
  assert.ok(plan.streams.faces.every((f) => f.bayList.length === f.bays && f.bayList.every((b) => b.section.kind === 'placeholder')));
  assert.ok(plan.slots.every((s) => s.face.room === 'main'));
});

test('adding Streams leaves the sales floor exactly as it was', () => {
  const before = planStore(catalogOf(245, 6));
  const after = planStore(withStreams(245, 742));
  const main = (p) => p.slots.filter((s) => s.face.room === 'main').map((s) => `${s.video.id}@${s.face.id}/${s.bay}/${s.row}/${s.col}`);
  assert.deepEqual(main(after), main(before));
  assert.equal(after.W, before.W);
  assert.equal(after.D, before.D);
});

for (const n of [1, 15, 742, 1500]) {
  test(`Streams stocked with ${n} stream(s)`, async (t) => {
    const catalog = withStreams(245, n);
    const plan = planStore(catalog);
    const { streams } = plan;
    const area = catalog.areas.streams;
    const slots = plan.slots.filter((s) => s.face.room === 'streams');

    await t.test('every stream is on a shelf', () => {
      const shelved = new Set(slots.map((s) => s.video.id));
      assert.equal(area.videos.filter((v) => !shelved.has(v.id)).length, 0);
      assert.ok(streams.stocked);
    });

    await t.test('one section per year, in the catalog\'s order, round the room', () => {
      const years = streams.sections.filter((s) => s.kind === 'genre').map((s) => s.label);
      assert.deepEqual(years, area.aisles.map((a) => a.name));
      // walking the shelves in reading order meets each year once, newest first
      const met = [];
      for (const s of slots) if (s.section.kind === 'genre' && met[met.length - 1] !== s.section.label) met.push(s.section.label);
      assert.deepEqual(met, years);
    });

    await t.test('within a year, tapes run in upload order', () => {
      for (const sec of streams.sections.filter((s) => s.kind === 'genre')) {
        const dates = slots.filter((s) => s.section === sec).map((s) => s.video.publishedAt);
        assert.deepEqual(dates, [...dates].sort(), `${sec.label} is out of order`);
      }
    });

    await t.test('the gondola ends hold the latest stream and a pick', () => {
      const ends = Object.fromEntries(streams.sections.filter((s) => s.kind === 'endcap').map((s) => [s.label, s.items[0]]));
      const latest = area.videos.reduce((a, b) => (b.publishedAt > a.publishedAt ? b : a));
      assert.equal(ends['Latest Stream'], latest);
      assert.ok(area.videos.includes(ends['Clerk Pick']));
    });

    await t.test('tapes sit inside the Streams room, never two in one place', () => {
      const pos = new THREE.Vector3();
      const m = new THREE.Matrix4();
      const seen = new Set();
      for (const s of plan.slots) {
        pos.setFromMatrixPosition(slotMatrix(s, m));
        const key = `${pos.x.toFixed(3)},${pos.y.toFixed(3)},${pos.z.toFixed(3)}`;
        assert.ok(!seen.has(key), `two tapes share ${key}`);
        seen.add(key);
        if (s.face.room !== 'streams') continue;
        assert.ok(pos.x > streams.x0 && pos.x < streams.x1 && pos.z > streams.z0 && pos.z < streams.z1, `stream tape outside the room at ${pos.x},${pos.z}`);
        assert.ok(pos.y > 0 && pos.y < DIM.UNIT_H);
      }
    });

    await t.test('the room only grows when it has to, and can still be walked round', () => {
      const fits = streams.faces.reduce((k, f) => k + (f.kind === 'endcap' ? 0 : f.bays), 0) * 35;
      if (n <= 700) assert.equal(streams.z0, -plan.D / 2, 'a small archive fits the standard room');
      else assert.ok(streams.z0 < -plan.D / 2 && fits >= n, 'a big archive gets a deeper room');
      const walk = walkFrom(plan.colliders, plan.bounds, plan.spawn);
      for (const p of [
        { x: (plan.lounge.arch.x0 + plan.lounge.arch.x1) / 2, z: streams.z1 - 0.6 },
        { x: streams.x0 + 1.5, z: streams.z0 + 1.5 },
        { x: streams.x1 - 1.5, z: streams.z0 + 1.5 },
        { x: (streams.x0 + streams.x1) / 2, z: streams.gondolas[0].zBack - 1.0 },
      ]) assert.ok(walk.reaches(p), `can't walk to ${p.x.toFixed(1)},${p.z.toFixed(1)} in Streams`);
    });
  });
}

test('an archive too big for the longest room keeps its newest tapes', () => {
  const catalog = withStreams(40, 4000);
  const plan = planStore(catalog);
  const shelved = new Set(plan.slots.filter((s) => s.face.room === 'streams').map((s) => s.video.id));
  const newest = catalog.areas.streams.videos.slice().sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  assert.ok(shelved.size < 4000);
  assert.ok(newest.slice(0, 100).every((v) => shelved.has(v.id)), 'the newest tapes are all shelved');
  assert.ok(plan.streams.z1 - plan.streams.z0 < 45, 'the room stops growing at some point');
});

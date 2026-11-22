// End-to-end smoke tests: load the real store in a headless browser and walk
// through the core flows. They drive the app through the dev-only `window.__bb`
// hooks (see CLAUDE.md), stepping the simulation with __bb.advance() so results
// don't depend on frame timing. They make no assumptions about which catalog is
// loaded, so they keep working whatever the channel uploads.
//
// The store is loaded ONCE per project (desktop / phone) and the tests run in order
// on that page, resetting between them. Loading is the expensive part — CI machines
// have no GPU, so every shader compiles in software — and one load per project
// keeps the suite fast and far from its timeouts there.
import { test as base, expect } from '@playwright/test';

base.describe.configure({ mode: 'serial' });

const test = base.extend({
  // one page per worker (i.e. per project), shared by every test in this file
  shared: [
    async ({ browser }, use, workerInfo) => {
      const u = workerInfo.project.use;
      const context = await browser.newContext({
        baseURL: u.baseURL,
        viewport: u.viewport,
        deviceScaleFactor: u.deviceScaleFactor,
        isMobile: u.isMobile,
        hasTouch: u.hasTouch,
        userAgent: u.userAgent,
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      page.on('console', (m) => {
        if (m.type() !== 'error') return;
        // we block YouTube on purpose (below); ignore the resulting load failures
        if (/youtube|ytimg/.test(m.location()?.url || '') || /youtube|ytimg/.test(m.text())) return;
        errors.push(`console: ${m.text()}`);
      });
      // keep tests offline and fast: no thumbnails, no embedded player
      await page.route(/(youtube(-nocookie)?\.com|ytimg\.com)/, (route) => route.abort());
      await page.goto('/?manual'); // no render loop; frames happen only in advance()
      await page.waitForFunction(() => window.__bb?.plan, null, { timeout: 90_000 });
      await use({ page, errors });
      await context.close();
    },
    { scope: 'worker', timeout: 120_000 },
  ],

  // what each test uses: the shared page, checked for errors and reset afterwards
  store: async ({ shared }, use, testInfo) => {
    const { page, errors } = shared;
    errors.length = 0;
    await use(page);
    if (testInfo.status !== testInfo.expectedStatus) {
      await testInfo.attach('screenshot', { body: await page.screenshot(), contentType: 'image/png' });
    }
    expect(errors, 'the page logged errors').toEqual([]);
    await page.evaluate(() => {
      const bb = window.__bb;
      if (bb.mode === 'inspect') bb.putBack(false);
      if (bb.mode === 'play') bb.exitPlay(false);
      if (bb.mode === 'sit') bb.standUp(false);
      bb.emptyHands(); // nothing carried, nothing in the VCR
      bb.controls.crouchToggle = false;
      if (bb.ps1.enabled) bb.setPS1(false, false);
      bb.advance(1); // let any put-back / stand-up animation finish
      if (bb.mode !== 'splash') bb.setMode('walk');
    });
  },
});

/** Step the simulation by `seconds` and render once. */
const advance = (page, seconds) => page.evaluate((s) => window.__bb.advance(s), seconds);

/** Index of a tape on a genre shelf at eye level (avoids featured/endcap duplicates). */
const genreSlot = (page, videoIndex = 0) =>
  page.evaluate((vi) => {
    const { plan, catalog } = window.__bb;
    const id = catalog.videos[vi % catalog.videos.length].id;
    const i = plan.slots.findIndex((s) => s.video.id === id && s.section.kind === 'genre');
    return i >= 0 ? i : plan.slots.findIndex((s) => s.video.id === id);
  }, videoIndex);

const isPhone = (testInfo) => testInfo.project.name === 'phone';

test('splash names the store and counts the stock', async ({ store: page }) => {
  await expect(page.locator('#btn-enter')).toBeEnabled();
  const { name, count, withThumbs } = await page.evaluate(() => ({
    name: window.__bb.catalog.store.name,
    count: window.__bb.catalog.videos.length,
    withThumbs: window.__bb.catalog.videos.filter((v) => v.thumb).length,
  }));
  await expect(page.locator('#splash .brand-name')).toHaveText(name);
  // counter reads "71 IN STOCK" for thumbnail-less catalogs, "x/y" while thumbnails load
  await expect(page.locator('#splash-count')).toContainText(withThumbs ? `/${withThumbs}` : `${count}`);
});

test('entering the store', async ({ store: page }, testInfo) => {
  await page.locator('#btn-enter').click();
  await expect(page.locator('#splash')).toBeHidden();
  if (isPhone(testInfo)) {
    await expect(page.locator('body')).toHaveClass(/touch/);
    expect(await page.evaluate(() => window.__bb.mode)).toBe('walk'); // touch: no pointer lock
    await expect(page.locator('.hud-help.touch-only')).toBeVisible();
  } else {
    // headless browsers may refuse pointer lock, leaving the mouse free ('paused')
    await page.waitForTimeout(150);
    expect(['walk', 'paused']).toContain(await page.evaluate(() => window.__bb.mode));
    await expect(page.locator('#pause')).toHaveCount(0); // no blocking pop-up any more
  }
});

test('the prize corner is in, and nothing blocks the way in', async ({ store: page }) => {
  const r = await page.evaluate(() => {
    const { store, plan } = window.__bb;
    const RADIUS = 0.28;
    const blocked = (x, z) => store.colliders.some((c) => x > c.minX - RADIUS && x < c.maxX + RADIUS && z > c.minZ - RADIUS && z < c.maxZ + RADIUS);
    // walk from the doormat to the spawn point and on to the first aisle
    const path = [];
    for (let z = plan.D / 2 - 0.5; z > plan.zFront + 0.5; z -= 0.1) path.push([plan.door.x, z]);
    return {
      gachas: store.prizes.gachas.length,
      luckyHit: Boolean(store.prizes.luckyHit?.stall),
      spawnClear: !blocked(plan.spawn.x, plan.spawn.z),
      pathBlockedAt: path.find(([x, z]) => blocked(x, z)) || null,
    };
  });
  expect(r.gachas).toBeGreaterThan(0);
  expect(r.luckyHit).toBe(true);
  expect(r.spawnClear).toBe(true);
  expect(r.pathBlockedAt, 'walkway from the door into the store').toBeNull();
});

test('the rooms off the sales floor: you can walk into each one, and they render', async ({ store: page }) => {
  const r = await page.evaluate(async () => {
    const { walkFrom } = await import('/src/layout.js');
    const { store, plan } = window.__bb;
    // every collider, including the ones the builders add (prize corner, standee...)
    const walk = walkFrom(store.colliders, plan.bounds, plan.spawn);
    const { lounge, streams, extras } = plan;
    return {
      lounge: walk.reaches({ x: lounge.x1 - 1.0, z: (lounge.z0 + lounge.z1) / 2 }),
      screenSide: walk.reaches({ x: lounge.x0 + 1.0, z: lounge.screen.z }),
      streams: walk.reaches({ x: (lounge.arch.x0 + lounge.arch.x1) / 2, z: streams.z1 - 0.6 }),
      extras: walk.reaches({ x: (extras.x0 + extras.x1) / 2, z: (extras.z0 + extras.z1) / 2 }),
      rooms: Object.keys(store.annex.groups),
      screen: store.annex.lounge.screen?.name,
    };
  });
  expect(r).toEqual({ lounge: true, screenSide: true, streams: true, extras: true, rooms: ['hall', 'lounge', 'streams', 'extras'], screen: 'lounge-screen' });

  // stand behind the couches facing the screen: it draws, and the VHS logo is bouncing
  const view = await page.evaluate(() => {
    const bb = window.__bb;
    const L = bb.plan.lounge;
    bb.setMode('walk');
    bb.controls.teleport(L.x1 - 0.6, L.screen.z, Math.PI / 2, -0.05);
    const screen = bb.store.annex.lounge.projection;
    const first = screen.bounces;
    bb.advance(9.5); // long enough to cross the screen
    const gl = bb.renderer.getContext();
    const px = new Uint8Array(4);
    const seen = new Set();
    for (let y = 1; y < 8; y++) for (let x = 1; x < 8; x++) {
      gl.readPixels(Math.floor((gl.drawingBufferWidth * x) / 8), Math.floor((gl.drawingBufferHeight * y) / 8), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      seen.add(`${px[0] >> 4},${px[1] >> 4},${px[2] >> 4}`);
    }
    return { colours: seen.size, glError: gl.getError(), mode: screen.mode, bounced: screen.bounces > first };
  });
  expect(view.glError).toBe(0);
  expect(view.colours, 'distinct colours sampled across the lounge').toBeGreaterThan(6);
  expect(view, 'with no tape in, the logo bounces round the screen').toMatchObject({ mode: 'logo', bounced: true });
  await page.evaluate(() => {
    const { controls, plan } = window.__bb;
    controls.teleport(plan.spawn.x, plan.spawn.z, plan.spawn.yaw, -0.04); // back to the door for the next test
  });
});

test('Streams is stocked from streams.json, a section per year', async ({ store: page }) => {
  const r = await page.evaluate(() => {
    const bb = window.__bb;
    const area = bb.catalog.areas.streams;
    const slots = bb.plan.slots.filter((s) => s.face.room === 'streams');
    const shelved = new Set(slots.map((s) => s.video.id));
    // from the front door the wing is out of sight, so it isn't drawn
    bb.controls.teleport(bb.plan.spawn.x, bb.plan.spawn.z, bb.plan.spawn.yaw, -0.04);
    bb.advance(0.1);
    const fromDoor = bb.store.annex.groups.streams.visible;
    return {
      tapes: area?.videos.length || 0,
      stocked: bb.plan.streams.stocked,
      unshelved: (area?.videos || []).filter((v) => !shelved.has(v.id)).length,
      years: bb.plan.streams.sections.filter((s) => s.kind === 'genre').map((s) => s.label),
      aisles: (area?.aisles || []).map((a) => a.name),
      fromDoor,
      directory: Boolean(document.querySelector('.dir-aisles [data-aisle="area:streams"]')),
    };
  });
  expect(r.stocked).toBe(r.tapes > 0);
  expect(r.unshelved, 'streams with no slot').toBe(0);
  expect(r.years).toEqual(r.aisles);
  expect(r.fromDoor, 'Streams drawn while out of sight').toBe(false);
  expect(r.directory).toBe(r.tapes > 0);
  test.skip(!r.tapes, 'no streams in this catalog');

  // walk to a stream and pick it up: the panel names its shelf; Streams is drawn now
  const held = await page.evaluate(() => {
    const bb = window.__bb;
    const v = bb.catalog.areas.streams.videos[0];
    bb.goToVideo(v.id);
    bb.advance(1);
    return { mode: bb.mode, title: v.title, shelf: document.querySelector('.ip-aisle .name').textContent, drawn: bb.store.annex.groups.streams.visible };
  });
  expect(held.mode).toBe('inspect');
  expect(held.shelf).toMatch(/^STREAMS · /);
  expect(held.drawn).toBe(true);
  await expect(page.locator('.ip-title')).toHaveText(held.title);
  await page.evaluate(() => {
    const bb = window.__bb;
    bb.putBack(false);
    bb.advance(1);
    bb.controls.teleport(bb.plan.spawn.x, bb.plan.spawn.z, bb.plan.spawn.yaw, -0.04); // back to the door for the next test
  });
});

test('the 3D store actually renders', async ({ store: page }) => {
  await page.evaluate(() => window.__bb.setMode('walk'));
  const colours = await page.evaluate(() => {
    window.__bb.advance(0.1);
    const gl = window.__bb.renderer.getContext();
    const { drawingBufferWidth: w, drawingBufferHeight: h } = gl;
    const px = new Uint8Array(4);
    const seen = new Set();
    for (let y = 1; y < 8; y++) for (let x = 1; x < 8; x++) {
      gl.readPixels(Math.floor((w * x) / 8), Math.floor((h * y) / 8), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      seen.add(`${px[0] >> 4},${px[1] >> 4},${px[2] >> 4}`);
    }
    return seen.size;
  });
  expect(colours, 'distinct colours sampled across the frame').toBeGreaterThan(8);
});

test('PS1 mode: a blocky world, a held tape, and back to normal', async ({ store: page }, testInfo) => {
  /** Share of neighbouring pixels that match along a strip of carpet: high once the picture is 240 lines. */
  const blockiness = () =>
    page.evaluate(() => {
      const bb = window.__bb;
      bb.advance(0.05);
      const gl = bb.renderer.getContext();
      const n = 200;
      const px = new Uint8Array(n * 4);
      gl.readPixels(Math.floor(gl.drawingBufferWidth / 2 - n / 2), Math.floor(gl.drawingBufferHeight * 0.06), n, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let same = 0;
      for (let i = 1; i < n; i++) if (px[i * 4] === px[i * 4 - 4] && px[i * 4 + 1] === px[i * 4 - 3] && px[i * 4 + 2] === px[i * 4 - 2]) same++;
      return { same: same / (n - 1), glError: gl.getError() };
    });
  const toggle = () => (isPhone(testInfo) ? page.locator('#btn-ps1').tap() : page.keyboard.press('p'));
  await page.evaluate(() => {
    const bb = window.__bb;
    bb.setMode('walk');
    bb.controls.teleport(bb.plan.spawn.x, bb.plan.spawn.z - 3, 0, -0.35); // down an aisle, looking at the carpet
  });
  const normal = await blockiness();

  await toggle();
  await expect(page.locator('#btn-ps1')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => [window.__bb.ps1.enabled, localStorage.getItem('bb.ps1')])).toEqual([true, '1']);
  const ps1 = await blockiness();
  expect(ps1.glError, 'WebGL error in PS1 mode').toBe(0);
  expect(ps1.same, `matching neighbours: normal ${normal.same.toFixed(2)}, PS1 ${ps1.same.toFixed(2)}`).toBeGreaterThan(Math.max(0.5, normal.same + 0.3));

  // the held tape goes through its own PS1 passes
  const slot = await genreSlot(page, 2);
  await page.evaluate((i) => window.__bb.pickUp(i), slot);
  await advance(page, 0.8);
  expect(await page.evaluate(() => [window.__bb.inspector.state, window.__bb.renderer.getContext().getError()])).toEqual(['held', 0]);
  await page.evaluate(() => window.__bb.putBack(false));
  await advance(page, 0.6);
  await page.evaluate(() => window.__bb.setMode('walk'));

  await toggle();
  await expect(page.locator('#btn-ps1')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => [window.__bb.ps1.enabled, localStorage.getItem('bb.ps1')])).toEqual([false, '0']);
  const back = await blockiness();
  expect(back.same).toBeLessThan(ps1.same - 0.2);
});

test('pick up a tape, flip it, put it back', async ({ store: page }, testInfo) => {
  test.skip(isPhone(testInfo), 'keyboard flow; touch is covered separately');
  const slot = await genreSlot(page, 3);
  const title = await page.evaluate((i) => {
    window.__bb.pickUp(i);
    return window.__bb.plan.slots[i].video.title;
  }, slot);
  await advance(page, 0.8);
  await expect(page.locator('#inspect')).toBeVisible();
  await expect(page.locator('.ip-title')).toHaveText(title);
  expect(await page.evaluate(() => window.__bb.inspector.state)).toBe('held');
  expect(await page.evaluate((i) => window.__bb.tapes.hiddenSet.has(i), slot)).toBe(true);

  await page.keyboard.press('Space');
  await advance(page, 1);
  const yaw = await page.evaluate(() => window.__bb.inspector.spin.yaw);
  expect(Math.abs(yaw - Math.PI)).toBeLessThan(0.05);

  await page.keyboard.press('Escape');
  await advance(page, 0.6);
  await expect(page.locator('#inspect')).toBeHidden();
  await expect(page.locator('#resume-hint')).toBeVisible(); // mouse freed, store still visible
  expect(await page.evaluate(() => window.__bb.inspector.state)).toBe('idle');
  expect(await page.evaluate(() => window.__bb.tapes.hiddenSet.size)).toBe(0);
});

test('find a tape in the directory and walk to it', async ({ store: page }, testInfo) => {
  test.skip(isPhone(testInfo), 'covered by the touch test');
  const title = await page.evaluate(() => window.__bb.catalog.videos[5 % window.__bb.catalog.videos.length].title);
  await page.keyboard.press('f');
  await expect(page.locator('#directory')).toBeVisible();
  await page.locator('#directory input').fill(title);
  await page.locator('.dir-item').first().click();
  await advance(page, 0.8);
  await expect(page.locator('#directory')).toBeHidden();
  await expect(page.locator('.ip-title')).toHaveText(title);
  // we were teleported to stand in front of it
  const dist = await page.evaluate(() => {
    const { camera, inspector } = window.__bb;
    const m = window.__bb.tapes.worldMatrix(inspector.slot).elements;
    return Math.hypot(camera.position.x - m[12], camera.position.z - m[14]);
  });
  expect(dist).toBeLessThan(1.5);
});

/**
 * The canvas's alpha at the middle of the lounge screen, after a frame (0 = see-through,
 * where the YouTube player behind shows).
 */
const screenAlpha = (page) =>
  page.evaluate(() => {
    const bb = window.__bb;
    const s = bb.plan.lounge.screen;
    bb.advance(0.05);
    const p = new bb.camera.position.constructor(s.x - 0.03, s.y, s.z).project(bb.camera);
    const gl = bb.renderer.getContext();
    const px = new Uint8Array(4);
    gl.readPixels(Math.round(((p.x + 1) / 2) * gl.drawingBufferWidth), Math.round(((p.y + 1) / 2) * gl.drawingBufferHeight), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px[3];
  });

test('Grab a tape, carry it to the lounge VCR, and it plays on the big screen', async ({ store: page }, testInfo) => {
  test.skip(isPhone(testInfo), 'same flow on phone');
  const slot = await genreSlot(page, 1);
  const linked = await page.evaluate((i) => {
    const v = window.__bb.plan.slots[i].video;
    v.youtubeId ??= 'dQw4w9WgXcQ'; // link the tape in memory only
    window.__bb.pickUp(i);
    return v.youtubeId;
  }, slot);
  await advance(page, 0.8);
  await expect(page.locator('#inspect .ip-yt')).toHaveAttribute('href', `https://www.youtube.com/watch?v=${linked}`);
  await page.locator('[data-act="grab"]').click();
  await advance(page, 0.6);
  const carrying = await page.evaluate((i) => {
    const bb = window.__bb;
    bb.setMode('walk'); // (pointer lock is refused headless)
    return { carried: bb.carried?.slot, offShelf: bb.tapes.hiddenSet.has(i), inspecting: bb.inspector.active, shown: bb.inspector.carry?.mesh.visible };
  }, slot);
  expect(carrying).toEqual({ carried: slot, offShelf: true, inspecting: false, shown: true });

  // walk into the lounge: nothing's said until you're close to the VCR
  const stand = (where) =>
    page.evaluate((w) => {
      const bb = window.__bb;
      const L = bb.plan.lounge;
      // (behind the couches looking at the screen; at the VCR looking down at it)
      const at = { couches: [L.x1 - 0.8, L.screen.z, 0], vcr: [L.cabinet.x + L.cabinet.d / 2 + 0.55, L.vcr.z, -0.3] }[w];
      bb.controls.teleport(at[0], at[1], Math.PI / 2, at[2]);
      bb.advance(0.1);
      return document.querySelector('#tooltip').hidden ? null : document.querySelector('.tt-title').textContent;
    }, where);
  expect(await stand('couches')).toBeNull();
  expect(await stand('vcr')).toBe('Insert tape');

  // The player was set up while the store loaded, and putting a tape in adds nothing to
  // the page (adding a frame mid-click can make the browser let go of the mouse).
  const player = page.locator('#theater iframe');
  await expect(player).toHaveCount(1);
  expect(await player.evaluate((f) => f.inert), "the player can't take the focus (and the mouse with it)").toBe(true);

  // put it in: the VCR's intro (black, static while it tracks, the tape's details), then
  // the picture, with the player behind the canvas
  await page.keyboard.press('KeyE');
  await advance(page, 0.05);
  await expect(player).toHaveCount(1);
  const screen = () =>
    page.evaluate(() => {
      const bb = window.__bb;
      return { mode: bb.store.annex.lounge.projection.mode, vcr: bb.store.annex.lounge.vcr.text, player: document.querySelector('#theater').style.visibility };
    });
  const playing = await page.evaluate(() => {
    const bb = window.__bb;
    return { inVcr: bb.inVcr?.video.youtubeId, carried: bb.carried, screen: bb.store.annex.lounge.projection.mode };
  });
  expect(playing).toEqual({ inVcr: linked, carried: null, screen: 'intro' });
  await advance(page, 5);
  expect(await screen(), 'five seconds in: still the intro, the player hidden').toEqual({ mode: 'intro', vcr: 'LOAD', player: 'hidden' });
  // (YouTube is blocked here, so the player never answers: the tape is loaded into it,
  // playing, and shown after a wait)
  await advance(page, 2.5);
  expect((await screen()).mode).toBe('wait');
  await expect(player).toHaveAttribute('src', new RegExp(`youtube-nocookie\\.com/embed/${linked}\\?autoplay=1`));
  await advance(page, 3.5);
  expect(await screen()).toEqual({ mode: 'video', vcr: expect.stringMatching(/^0:00:0\d$/), player: '' }); // (the counter's running)
  expect(await page.evaluate(() => document.querySelector('#tooltip').hidden), 'empty-handed at the VCR, nothing is said').toBe(true);
  await page.evaluate(() => {
    const L = window.__bb.plan.lounge;
    window.__bb.controls.teleport(L.x1 - 0.8, L.screen.z, Math.PI / 2, -0.05);
  });
  expect(await screenAlpha(page), 'the screen is see-through over the player').toBe(0);
  await page.evaluate(() => window.__bb.setPS1(true, false));
  expect(await screenAlpha(page), 'in PS1 Mode too').toBe(0);
  await page.evaluate(() => window.__bb.setPS1(false, false));

  // an unlinked tape can't be grabbed
  await page.evaluate(() => window.__bb.setMode('walk'));
  const unlinked = await page.evaluate(() => {
    const { plan } = window.__bb;
    const i = plan.slots.findIndex((s) => !s.video.youtubeId);
    if (i >= 0) window.__bb.pickUp(i);
    return i;
  });
  if (unlinked >= 0) {
    await advance(page, 0.8);
    await expect(page.locator('[data-act="grab"]')).toBeDisabled();
  }
});

test('sit on a lounge couch, and stand back up', async ({ store: page }, testInfo) => {
  test.skip(isPhone(testInfo), 'same on phone');
  const aimed = await page.evaluate(() => {
    const bb = window.__bb;
    const sofa = bb.plan.lounge.sofas[0];
    bb.setMode('walk');
    bb.controls.teleport(sofa.x, sofa.z + sofa.len / 2 + 0.9, 0, -0.5); // at the end of the couch, looking at it
    bb.advance(0.1);
    return { kind: bb.target?.kind, title: document.querySelector('.tt-title').textContent, at: bb.camera.position.toArray() };
  });
  expect(aimed).toMatchObject({ kind: 'seat', title: 'Couch' });
  await page.keyboard.press('KeyE');
  await advance(page, 1);
  const seated = await page.evaluate(() => ({ mode: window.__bb.mode, eye: window.__bb.camera.position.y }));
  expect(seated.mode).toBe('sit');
  expect(seated.eye).toBeCloseTo(1.14, 2);
  await expect(page.locator('#seat [data-act="stand"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await advance(page, 1);
  const stood = await page.evaluate(() => ({ mode: window.__bb.mode, at: window.__bb.camera.position.toArray() }));
  expect(['paused', 'walk'], 'up off the couch (paused, or walking with drag-to-look)').toContain(stood.mode);
  stood.at.forEach((v, k) => expect(v).toBeCloseTo(aimed.at[k], 3));
  await expect(page.locator('#seat')).toBeHidden();
});

test("the VCR's remote: on the couch or at the VCR, R / Space / T", async ({ store: page }, testInfo) => {
  test.skip(isPhone(testInfo), 'same on phone');
  // a tape playing, with the player standing in for YouTube (blocked here): it records
  // what it's told
  await page.evaluate(() => {
    const bb = window.__bb;
    const v = bb.plan.slots.find((s) => s.video.youtubeId).video;
    bb.theater.insert(v);
    bb.advance(11);
  });
  await page.waitForTimeout(800); // (the blocked page loads, and the player starts over saying hello)
  await page.evaluate(() => {
    const bb = window.__bb;
    Object.assign(bb.theater, { heard: true, fallback: false, sent: [] });
    bb.theater._post = (m) => m.func !== 'setVolume' && bb.theater.sent.push(m.func || m.event); // (the volume follows you)
    bb.setMode('walk');
    const L = bb.plan.lounge;
    bb.controls.teleport(L.x1 - 0.8, L.screen.z, Math.PI / 2, 0);
    bb.advance(0.1);
  });
  expect(await page.evaluate(() => window.__bb.remoteShown), 'away from the VCR, standing: no remote').toBe(false);
  await page.evaluate(() => {
    const bb = window.__bb;
    bb.sitDown(bb.plan.lounge.seats[1]);
    bb.advance(1);
  });
  await expect(page.locator('#remote')).toBeVisible();
  await page.keyboard.press('KeyR');
  await page.keyboard.press('ArrowLeft'); // (on the couch, like YouTube)
  await page.keyboard.press('Space');
  await page.keyboard.press('KeyT');
  await page.evaluate(() => window.__bb.advance(0.05));
  await expect(page.locator('.remote-pause')).toHaveText('▶ Play');
  await expect(page.locator('[data-remote="subtitles"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-remote="pause"]').click();
  await page.locator('[data-remote="subtitles"]').click();
  const sent = await page.evaluate(() => window.__bb.theater.sent);
  expect(sent).toEqual(['seekTo', 'seekTo', 'pauseVideo', 'loadModule', 'playVideo', 'unloadModule']);
  expect(await page.evaluate(() => window.__bb.mode), 'the arrow key rewound, it didn’t stand you up').toBe('sit');

  // standing at the VCR, empty-handed: the remote too
  await page.evaluate(() => {
    const bb = window.__bb;
    bb.standUp(false);
    bb.advance(1);
    bb.setMode('walk');
    const L = bb.plan.lounge;
    bb.controls.teleport(L.cabinet.x + L.cabinet.d / 2 + 0.7, L.vcr.z, Math.PI / 2, -0.3);
    bb.advance(0.1);
  });
  await expect(page.locator('#remote')).toBeVisible();
  await page.evaluate(() => delete window.__bb.theater._post); // (the real one back)
});

test('the mouse is captured with plain pointer lock, not raw input', async ({ store: page }, testInfo) => {
  test.skip(isPhone(testInfo), 'no pointer lock on a touchscreen');
  // (raw input lets the hidden cursor drift to the screen edge on Windows, where the
  // taskbar can take a click: see CLAUDE.md)
  const asked = await page.evaluate(() => {
    const { controls } = window.__bb;
    const dom = controls.dom;
    const was = { dragLook: controls.dragLook, request: dom.requestPointerLock };
    const calls = [];
    dom.requestPointerLock = (...args) => {
      calls.push(args);
      return Promise.resolve();
    };
    controls.dragLook = false;
    controls.lock();
    dom.requestPointerLock = was.request;
    controls.dragLook = was.dragLook;
    return calls;
  });
  expect(asked).toEqual([[]]);
});

test('crouching: hold C (a toggle on a touchscreen)', async ({ store: page }, testInfo) => {
  await page.evaluate(() => {
    const bb = window.__bb;
    bb.setMode('walk');
    const s = bb.plan.spawn;
    bb.controls.teleport(s.x, s.z, s.yaw, 0);
    bb.advance(0.5);
  });
  const eye = () => page.evaluate(() => window.__bb.camera.position.y);
  expect(await eye()).toBeCloseTo(1.62, 2);
  if (isPhone(testInfo)) await page.locator('#btn-crouch').tap();
  else await page.keyboard.down('KeyC');
  await advance(page, 1);
  expect(await eye()).toBeCloseTo(1.02, 2);
  if (isPhone(testInfo)) await page.locator('#btn-crouch').tap();
  else await page.keyboard.up('KeyC');
  await advance(page, 1);
  expect(await eye()).toBeCloseTo(1.62, 2);
});

test('phone: pick up a tape, panel at the bottom, put it back', async ({ store: page }, testInfo) => {
  test.skip(!isPhone(testInfo), 'phone only');
  const slot = await genreSlot(page, 2);
  await page.evaluate((i) => window.__bb.goToVideo(window.__bb.plan.slots[i].video.id), slot);
  await advance(page, 0.8);
  const panel = await page.locator('.inspect-panel').boundingBox();
  const viewport = page.viewportSize();
  expect(panel.y).toBeGreaterThan(viewport.height * 0.4);
  await expect(page.locator('[data-act="back"] kbd')).toBeHidden();
  await page.locator('[data-act="back"]').click();
  await advance(page, 0.6);
  expect(await page.evaluate(() => window.__bb.mode)).toBe('walk');
});

// ------------------------------------------------------------------ prize corner

/** Stand `back` metres in front of a machine, looking at it. */
const faceMachine = (page, kind, back = 1.3) =>
  page.evaluate(
    ([k, d]) => {
      const bb = window.__bb;
      const game = bb.arcade.games.find((g) => g.kind === k);
      const V = bb.camera.position.constructor;
      const m = game.refs.machine || game.refs.stall;
      const at = m.localToWorld(new V(0, 0, d));
      const c = m.localToWorld(new V(0, 0, 0));
      bb.setMode('walk');
      bb.controls.teleport(at.x, at.z, Math.atan2(-(c.x - at.x), -(c.z - at.z)), -0.3);
      bb.advance(0.05);
      return game.title;
    },
    [kind, back],
  );

test('gacha: crouch down, turn the crank, get a capsule, stand up', async ({ store: page }, testInfo) => {
  test.skip(isPhone(testInfo), 'touch version below');
  const title = await faceMachine(page, 'gacha');
  await expect(page.locator('#tooltip')).toContainText('crouch down and play');
  await page.evaluate(() => {
    window.__prizes = [];
    window.addEventListener('bb:prize', (e) => window.__prizes.push(e.detail));
  });
  await page.keyboard.press('e'); // act on what the crosshair is on
  await advance(page, 0.9);
  const crouched = await page.evaluate(() => ({ mode: window.__bb.mode, seated: window.__bb.arcade.seated, eye: window.__bb.camera.position.y }));
  expect(crouched.mode).toBe('play');
  expect(crouched.seated).toBe(true);
  expect(crouched.eye).toBeLessThan(1.2); // crouched, not standing (1.62)
  await expect(page.locator('#play .pp-title')).toHaveText(title);

  const before = await page.evaluate(() => window.__bb.arcade.active.capsulesLeft);
  await page.locator('#play .pp-main').click();
  await advance(page, 3.2);
  const after = await page.evaluate(() => ({ state: window.__bb.arcade.active.state, left: window.__bb.arcade.active.capsulesLeft, prizes: window.__prizes }));
  expect(after.state).toBe('done');
  expect(after.left).toBe(before - 1);
  expect(after.prizes).toHaveLength(1);
  expect(after.prizes[0].kind).toBe('capsule');
  await expect(page.locator('#play .pp-result')).toContainText('capsule');

  await page.keyboard.press('Escape');
  await advance(page, 1);
  const stood = await page.evaluate(() => ({ mode: window.__bb.mode, busy: window.__bb.arcade.busy, eye: window.__bb.camera.position.y }));
  expect(['walk', 'paused']).toContain(stood.mode);
  expect(stood.busy).toBe(false);
  expect(stood.eye).toBeGreaterThan(1.5);
});

test('Lucky Hit: step up, aim, drop, the ball drifts down and wins a prize', async ({ store: page }, testInfo) => {
  test.skip(isPhone(testInfo), 'touch play is covered by the gacha phone test (same panel)');
  await faceMachine(page, 'luckyhit', 1.7);
  await expect(page.locator('#tooltip')).toContainText('step up and play');
  await page.keyboard.press('e');
  await advance(page, 0.9);
  const info = await page.evaluate(() => {
    const g = window.__bb.arcade.active;
    return { kind: g?.kind, number: g.board.number, pattern: g.board.pattern, aim: g.aim };
  });
  expect(info.kind).toBe('luckyhit');
  await expect(page.locator('#play .pp-sub')).toContainText(`#${info.number}`);
  await expect(page.locator('#play .pp-sub')).toContainText(info.pattern);

  // steer the drop cup with the arrow keys
  await page.keyboard.down('ArrowRight');
  await advance(page, 0.5);
  await page.keyboard.up('ArrowRight');
  const aimed = await page.evaluate(() => window.__bb.arcade.active.aim);
  expect(aimed).toBeGreaterThan(info.aim + 0.08);

  // drop: one slow ball, and it lands in a slot and announces the prize
  // (tests share one page, so use a listener of our own: earlier tests left theirs attached)
  await page.evaluate(() => {
    window.__luckyPrizes = [];
    window.addEventListener('bb:prize', (e) => e.detail.kind === 'lucky-hit' && window.__luckyPrizes.push(e.detail));
  });
  await page.keyboard.press('Space');
  const landed = await page.evaluate(() => {
    const g = window.__bb.arcade.active;
    let t = 0;
    while (g.state === 'falling' && t < 12) {
      window.__bb.advance(0.25);
      t += 0.25;
    }
    return { state: g.state, t, result: g.result, prizes: window.__luckyPrizes, slots: g.board.slots.length };
  });
  expect(landed.state).toBe('landed');
  expect(landed.t).toBeGreaterThan(1.5); // it's meant to be slow
  expect(landed.result.slot).toBeGreaterThanOrEqual(0);
  expect(landed.result.slot).toBeLessThan(landed.slots);
  expect(landed.prizes).toHaveLength(1);
  expect(landed.prizes[0]).toMatchObject({ kind: 'lucky-hit', board: info.number });
  await expect(page.locator('#play .pp-msg')).toContainText('!');

  // a fresh ball is back in the cup a moment later
  await advance(page, 2.2);
  expect(await page.evaluate(() => window.__bb.arcade.active.state)).toBe('aim');

  await page.locator('#play [data-act="stand"]').click();
  await advance(page, 1);
  expect(await page.evaluate(() => window.__bb.arcade.busy)).toBe(false);
});

test('phone: tap a machine to play, tap to turn, stand up', async ({ store: page }, testInfo) => {
  test.skip(!isPhone(testInfo), 'phone only');
  await faceMachine(page, 'gacha', 1.2);
  const vp = page.viewportSize();
  await page.touchscreen.tap(vp.width / 2, vp.height / 2);
  await advance(page, 0.9);
  expect(await page.evaluate(() => window.__bb.mode)).toBe('play');
  const panel = await page.locator('#play .play-panel').boundingBox();
  expect(panel.y).toBeGreaterThan(vp.height * 0.4); // docked at the bottom on a phone
  await page.locator('#play .pp-main').tap();
  await advance(page, 3.2);
  expect(await page.evaluate(() => window.__bb.arcade.active.state)).toBe('done');
  await page.locator('#play [data-act="stand"]').tap();
  await advance(page, 1);
  expect(await page.evaluate(() => window.__bb.mode)).toBe('walk');
});

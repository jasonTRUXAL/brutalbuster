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
      if (bb.mode === 'watch') document.querySelector('[data-act="eject"]').click();
      if (bb.mode === 'inspect') bb.putBack(false);
      bb.advance(0.6); // let any put-back animation finish
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

test('Watch opens the TV for linked tapes only', async ({ store: page }, testInfo) => {
  test.skip(isPhone(testInfo), 'same UI on phone');
  const slot = await genreSlot(page, 1);
  const linked = await page.evaluate((i) => {
    const v = window.__bb.plan.slots[i].video;
    v.youtubeId ??= 'dQw4w9WgXcQ'; // link the tape in memory only
    window.__bb.pickUp(i);
    return v.youtubeId;
  }, slot);
  await advance(page, 0.8);
  await page.locator('[data-act="watch"]').click();
  await expect(page.locator('#player')).toBeVisible();
  await expect(page.locator('#player iframe')).toHaveAttribute('src', new RegExp(`youtube-nocookie\\.com/embed/${linked}`));
  await page.locator('[data-act="eject"]').click();
  await expect(page.locator('#player iframe')).toHaveCount(0);
  await expect(page.locator('#inspect')).toBeVisible();

  // an unlinked tape can't be watched
  await page.keyboard.press('Escape');
  await advance(page, 0.6);
  await page.evaluate(() => window.__bb.setMode('walk'));
  const unlinked = await page.evaluate(() => {
    const { plan } = window.__bb;
    const i = plan.slots.findIndex((s) => !s.video.youtubeId);
    if (i >= 0) window.__bb.pickUp(i);
    return i;
  });
  if (unlinked >= 0) {
    await advance(page, 0.8);
    await expect(page.locator('[data-act="watch"]')).toBeDisabled();
  }
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

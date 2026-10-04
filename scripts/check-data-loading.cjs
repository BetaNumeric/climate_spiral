const assert = require('node:assert/strict');
const { mkdirSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { chromium } = require('playwright');

const root = 'http://127.0.0.1:8000/';
const output = join(tmpdir(), 'climate-data-loading');
mkdirSync(output, { recursive: true });
const hooks = `
window.dataTest = {
  ready: () => Boolean(controls),
  state: () => ({ mesh: spiralMesh?.uuid ?? null, count: timelineStops.length, playing: isAnimating,
    dataset: currentDatasetKey, index: animationIndex, total: totalIndices,
    data: currentDataText, yearVisible: yearIndicatorMesh.visible }),
  reload: () => datasetLoader.loadBundled(),
  pause() { if (isAnimating) toggleAnimation(); },
  seekEnd: () => setPlaybackPosition(totalIndices),
  pixels() {
    renderer.render(scene, activeCamera);
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
    const context = canvas.getContext('2d'); context.drawImage(renderer.domElement, 0, 0, 320, 240);
    const pixels = context.getImageData(0, 0, 320, 240).data;
    let lit = 0;
    for (let i = 0; i < pixels.length; i += 4) if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 20) lit++;
    return lit;
  }
};
`;

async function preparePage(context, errors) {
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/index.html', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('// --- Configuration ---',
      hooks + '// --- Configuration ---') });
  });
  return page;
}

async function assertEmpty(page) {
  const state = await page.evaluate(() => dataTest.state());
  assert.equal(state.mesh, null);
  assert.equal(state.count, 0);
  assert.equal(state.data, '');
  assert.equal(state.playing, false);
  assert.equal(state.yearVisible, false);
  for (const id of ['playBtn', 'stepBackBtn', 'stepForwardBtn', 'skipStartBtn', 'skipEndBtn', 'timelineSlider']) {
    assert.equal(await page.locator('#' + id).isDisabled(), true, id);
  }
  for (const id of ['infoMonth', 'infoYear', 'timelineStart', 'timelineEnd']) {
    assert.equal(await page.locator('#' + id).textContent(), '--', id);
  }
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
  try {
    for (const [name, viewport] of Object.entries({ desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 } })) {
      const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
      const errors = [];
      const page = await preparePage(context, errors);
      let release;
      const pending = new Promise(resolve => { release = resolve; });
      await page.route('**/data/GLB.Ts+dSST.txt', async route => { await pending; await route.continue(); });
      await page.goto(root + 'index.html');
      await page.waitForFunction(() => window.dataTest?.ready());
      await assertEmpty(page);
      assert.equal(await page.locator('#fetchStatus').textContent(), 'Loading data...');
      release();
      await page.waitForFunction(() => dataTest.state().count > 1700);
      assert.equal(await page.locator('#fetchStatus').textContent(), 'Local Data');
      assert.equal((await page.evaluate(() => dataTest.state())).playing, true);
      assert.equal(await page.locator('#timelineSlider').isDisabled(), false);
      await page.evaluate(() => { dataTest.pause(); dataTest.seekEnd(); });
      assert.ok(await page.evaluate(() => dataTest.pixels()) > 500);
      await page.screenshot({ path: join(output, name + '-loaded.png') });

      await page.unroute('**/data/GLB.Ts+dSST.txt');
      await page.route('**/data/GLB.Ts+dSST.txt', route => route.abort());
      const previous = await page.evaluate(() => dataTest.state());
      await page.evaluate(() => dataTest.reload());
      assert.equal((await page.evaluate(() => dataTest.state())).mesh, previous.mesh);
      assert.equal(await page.locator('#fetchStatus').textContent(), 'Data unavailable');
      assert.equal(await page.locator('#timelineSlider').isDisabled(), false);

      await page.reload();
      await page.waitForFunction(() => document.getElementById('fetchStatus').textContent === 'Data unavailable');
      await assertEmpty(page);
      assert.equal(await page.locator('#dataOrigin').textContent(), '(Load File / Fetch)');

      await page.unroute('**/data/GLB.Ts+dSST.txt');
      await page.route('**/data/GLB.Ts+dSST.txt', route => route.fulfill({ status: 200,
        contentType: 'text/html', body: '<html>Unavailable</html>' }));
      await page.evaluate(() => dataTest.reload());
      await assertEmpty(page);

      await page.unroute('**/data/GLB.Ts+dSST.txt');
      await page.evaluate(() => dataTest.reload());
      assert.ok((await page.evaluate(() => dataTest.state())).count > 1700);
      assert.equal((await page.evaluate(() => dataTest.state())).playing, true);

      await page.evaluate(() => { dataTest.pause(); dataTest.seekEnd(); });
      let releaseOcean, oceanRequested;
      const delayedOcean = new Promise(resolve => { releaseOcean = resolve; });
      const oceanStarted = new Promise(resolve => { oceanRequested = resolve; });
      await page.route('**/data/ocean-temperature.json', async route => {
        oceanRequested();
        await delayedOcean;
        await route.fulfill({ contentType: 'application/json',
          body: readFileSync(join(__dirname, '../data/ocean-temperature.json'), 'utf8') });
      });
      await page.selectOption('#datasetSelect', 'ocean', { force: true });
      await oceanStarted;
      await page.selectOption('#datasetSelect', 'co2', { force: true });
      await page.waitForFunction(() => dataTest.state().dataset === 'co2' && dataTest.state().count > 800
        && document.getElementById('fetchStatus').textContent === 'Local Data');
      await page.evaluate(() => dataTest.pause());
      const co2 = await page.evaluate(() => dataTest.state());
      releaseOcean();
      await page.unrouteAll({ behavior: 'wait' });
      assert.equal((await page.evaluate(() => dataTest.state())).mesh, co2.mesh);

      await page.selectOption('#datasetSelect', 'temperature', { force: true });
      await page.waitForFunction(() => dataTest.state().count > 1700);
      const restored = await page.evaluate(() => dataTest.state());
      assert.equal(restored.playing, false);
      assert.equal(restored.index, restored.total);
      const imported = '2025 123 130\n';
      await page.locator('#fileUpload').setInputFiles({ name: 'temperature.txt', mimeType: 'text/plain', buffer: Buffer.from(imported) });
      await page.waitForFunction(text => dataTest.state().data === text, imported);
      assert.equal((await page.evaluate(() => dataTest.state())).count, 2);
      assert.equal(await page.locator('#fetchStatus').textContent(), 'User File');

      await page.selectOption('#datasetSelect', 'ocean', { force: true });
      await page.waitForFunction(() => dataTest.state().count > 2000);
      const validOcean = await page.evaluate(() => dataTest.state());
      await page.locator('#fileUpload').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{broken JSON') });
      await page.waitForFunction(() => document.getElementById('fetchStatus').textContent === 'Invalid Data');
      assert.equal((await page.evaluate(() => dataTest.state())).mesh, validOcean.mesh);
      assert.deepEqual(errors, []);
      await context.close();
      console.log(name + ': loading, recovery, rapid switches, playback restoration and imports passed');
    }

    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(root + 'index.html');
    await page.waitForFunction(() => document.getElementById('timelineEnd').textContent !== '--');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise(resolve =>
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    });
    const cachedText = await page.evaluate(async () => {
      const cached = await caches.match(new URL('data/GLB.Ts+dSST.txt', location.href));
      return cached?.text();
    });
    assert.ok(cachedText?.includes('2025'));
    for (const asset of ['styles.css', 'camera-controller.mjs', 'video-controller.mjs', 'spiral-geometry.mjs',
      'datasets.mjs', 'dataset-loader.mjs', 'gistemp-data.mjs']) {
      assert.equal(await page.evaluate(async asset => Boolean(await caches.match(new URL(asset, location.href))), asset), true, asset);
    }
    await context.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => document.getElementById('timelineEnd').textContent !== '--');
    assert.equal(await page.locator('#fetchStatus').textContent(), 'Local Data');
    assert.equal(await page.locator('#playBtn').isDisabled(), false);
    assert.equal(await page.locator('#playBtn').evaluate(button => getComputedStyle(button).width), '40px');
    assert.deepEqual(errors, []);
    await context.close();
    console.log('Offline reload uses the cached real dataset. Screenshots: ' + output);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

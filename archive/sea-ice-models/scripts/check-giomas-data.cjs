// Historical integration check; requires restoring the archived browser registrations.
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require('playwright');

const snapshot = JSON.parse(readFileSync(join(__dirname, '../data/giomas-sea-ice-volume.json'), 'utf8'));
const hasOras5Snapshot = existsSync(join(__dirname, '../data/oras5-sea-ice-volume.json'));
const revised = structuredClone(snapshot);
revised.records.at(-1).north = 14;
revised.records.at(-1).south = 7;
const hooks = `
window.giomasTest = {
  ready: () => Boolean(spiralMesh),
  state: () => ({ dataset: currentDatasetKey, mesh: spiralMesh.uuid,
    months: timelineStops.length, index: animationIndex, animating: isAnimating,
    metric: document.getElementById('infoTemp').textContent }),
  lastMonth() {
    if (isAnimating) toggleAnimation();
    setPlaybackPosition(totalIndices);
  },
  play() { if (!isAnimating) toggleAnimation(); },
  refresh: () => fetchRemoteData(),
};
`;

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
  try {
    for (const [name, viewport] of Object.entries({
      desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 },
    })) {
      const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
      await page.route('**/index.html', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()).replace('// --- Configuration ---',
          hooks + '// --- Configuration ---') });
      });
      let mode = 'valid';
      let requests = 0;
      await page.route('**/data/giomas-sea-ice-volume.json', route => {
        requests++;
        return route.fulfill({ status: mode === 'missing' ? 404 : 200, contentType: 'application/json',
          body: mode === 'invalid' ? '{}' : JSON.stringify(mode === 'revised' ? revised : snapshot) });
      });
      for (const state of ['missing', 'invalid', 'valid']) {
        mode = state;
        await page.goto('http://127.0.0.1:8000/index.html');
        await page.waitForFunction(() => window.giomasTest?.ready(), null, { timeout: 60_000 });
        // A failed GIOMAS request must not disable the independently published ORAS5 bundle.
        if (hasOras5Snapshot) {
          await page.waitForFunction(() => document.querySelector('#datasetSelect option[value="antarcticoras5"]'));
        }
        if (state === 'valid') {
          await page.waitForFunction(() => document.querySelector('#datasetSelect option[value="antarcticgiomas"]'));
        } else {
          await page.waitForTimeout(300);
          assert.equal(await page.locator('#datasetSelect option[value$="giomas"]').count(), 0);
        }
      }
      const initialRequests = requests;
      for (const key of ['arcticgiomas', 'antarcticgiomas']) {
        await page.selectOption('#datasetSelect', key, { force: true });
        await page.waitForFunction(({ key, months }) => giomasTest.state().dataset === key
          && giomasTest.state().months === months, { key, months: snapshot.records.length });
        await page.evaluate(() => giomasTest.lastMonth());
        assert.match((await page.evaluate(() => giomasTest.state())).metric, /10\u00b3 km\u00b3/);
      }
      assert.equal(requests, initialRequests, 'Dataset switching should reuse the validated bundle');
      await page.selectOption('#datasetSelect', 'arcticgiomas', { force: true });
      await page.waitForFunction(() => giomasTest.state().dataset === 'arcticgiomas');
      await page.evaluate(() => giomasTest.lastMonth());
      const originalMesh = (await page.evaluate(() => giomasTest.state())).mesh;
      mode = 'invalid';
      await page.evaluate(() => giomasTest.refresh());
      await page.waitForFunction(() => document.getElementById('fetchStatus').textContent === 'Refresh failed; previous data retained');
      assert.equal((await page.evaluate(() => giomasTest.state())).mesh, originalMesh);
      mode = 'revised';
      await page.evaluate(() => giomasTest.refresh());
      await page.waitForFunction(mesh => giomasTest.state().mesh !== mesh, originalMesh);
      await page.evaluate(() => giomasTest.lastMonth());
      assert.match((await page.evaluate(() => giomasTest.state())).metric, /^14\.00/);
      await page.selectOption('#datasetSelect', 'antarcticgiomas', { force: true });
      await page.waitForFunction(() => giomasTest.state().dataset === 'antarcticgiomas');
      await page.evaluate(() => giomasTest.lastMonth());
      assert.match((await page.evaluate(() => giomasTest.state())).metric, /^7\.00/);
      await page.setInputFiles('#fileUpload', { name: 'giomas.json', mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(snapshot)) });
      await page.waitForFunction(() => document.getElementById('dataOrigin').textContent.includes('User File'));
      await page.evaluate(() => giomasTest.lastMonth());
      assert.ok((await page.evaluate(() => giomasTest.state())).metric.startsWith(snapshot.records.at(-1).south.toFixed(2)));
      await page.evaluate(() => giomasTest.play());
      const index = (await page.evaluate(() => giomasTest.state())).index;
      await page.waitForFunction(index => giomasTest.state().index !== index, index);
      assert.deepEqual(errors, []);
      console.log(name + ': GIOMAS availability, snapshot reuse, refresh, import and playback passed');
      await context.close();
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

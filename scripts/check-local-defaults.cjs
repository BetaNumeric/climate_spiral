const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { chromium } = require('playwright');
const output = join(tmpdir(), 'climate-local-defaults');
mkdirSync(output, { recursive: true });
const hooks = `
window.defaultsTest = {
  ready: () => Boolean(spiralMesh && timelineStops.length),
  source: () => localSnapshot?.station?.id,
  frame() { setPlaybackPosition(totalIndices); controls.enableDamping = false; },
  pixels() {
    renderer.render(scene, activeCamera);
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
    const ctx = canvas.getContext('2d'); ctx.drawImage(renderer.domElement, 0, 0, 320, 240);
    const pixels = ctx.getImageData(0, 0, 320, 240).data;
    let lit = 0; for (let i = 0; i < pixels.length; i += 4) if (Math.max(pixels[i], pixels[i+1], pixels[i+2]) > 20) lit++;
    return lit;
  }
};
`;

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
  try {
    for (const [name, viewport] of Object.entries({ desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 } })) {
      const context = await browser.newContext({ viewport, serviceWorkers: 'block', isMobile: name === 'mobile', hasTouch: name === 'mobile' });
      const page = await context.newPage(), errors = [], weather = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => { if (request.url().includes('archive-api.open-meteo.com')) weather.push(request.url()); });
      await page.route('**/index.html', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()).replace('// --- Configuration ---', hooks + '// --- Configuration ---') });
      });
      await page.route('https://geocoding-api.open-meteo.com/**', route => route.fulfill({ json: { results: [
        { name: 'Berlin', country: 'Germany', latitude: 52.52, longitude: 13.41, timezone: 'Europe/Berlin' }
      ] } }));
      await page.goto('http://127.0.0.1:8000/index.html'); await page.waitForFunction(() => defaultsTest?.ready());
      await page.click('#settingsBtn'); await page.click('#viewSettings > summary');
      assert.equal(await page.locator('#colorMode').inputValue(), 'value');
      await page.uncheck('#smoothSpiralToggle'); await page.selectOption('#colorMode', 'year');
      await page.selectOption('#datasetSelect', 'local');
      await page.waitForFunction(() => document.getElementById('localStatus').textContent === 'Choose a location.');
      assert.equal(await page.locator('#colorMode').inputValue(), 'annual');
      assert.equal(await page.locator('#localSource').inputValue(), 'station');
      assert.equal(await page.locator('#localStationFields').isVisible(), true);
      assert.equal(await page.locator('#singleColorRow').isVisible(), false);
      assert.match(await page.locator('#settingsSourceLink').textContent(), /NOAA/);
      await page.fill('#localSearch', 'Berlin'); await page.locator('#localSearchForm button[type="submit"]').click();
      await page.getByRole('button', { name: 'Berlin, Germany', exact: true }).click();
      await page.waitForFunction(() => defaultsTest.source() && document.getElementById('localStatus').textContent === 'Saved on this device.');
      await page.evaluate(() => defaultsTest.frame());
      assert.equal(await page.locator('#colorMode').inputValue(), 'annual');
      assert.match(await page.locator('#legendCaption').textContent(), /^Yearly/);
      assert.ok(await page.evaluate(() => defaultsTest.pixels()) > 300);
      assert.equal(weather.length, 0, 'Station-first search must not download reanalysis');
      await page.locator('#localSource').scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(output, name + '-settings.png') });
      await page.click('#settingsBtn'); await page.click('#infoBtn');
      await page.screenshot({ path: join(output, name + '-annual-station.png') });
      await page.click('#settingsBtn'); await page.selectOption('#datasetSelect', 'temperature');
      assert.equal(await page.locator('#colorMode').inputValue(), 'year', 'Returning to global restores its prior color mode');
      await page.selectOption('#datasetSelect', 'local');
      await page.waitForFunction(() => defaultsTest.source() && document.getElementById('localStatus').textContent === 'Saved on this device.');
      assert.equal(await page.locator('#colorMode').inputValue(), 'annual');
      await page.selectOption('#colorMode', 'single');
      assert.equal(await page.locator('#singleColorRow').isVisible(), true);
      await page.selectOption('#datasetSelect', 'temperature');
      assert.equal(await page.locator('#colorMode').inputValue(), 'year');
      assert.equal(await page.locator('#singleColorRow').isVisible(), false);
      await page.selectOption('#datasetSelect', 'local');
      await page.waitForFunction(() => defaultsTest.source() && document.getElementById('localStatus').textContent === 'Saved on this device.');
      assert.equal(await page.locator('#colorMode').inputValue(), 'single', 'An explicit local color choice is remembered');
      assert.equal(await page.locator('#singleColorRow').isVisible(), true);
      for (const [saved, point, expected, country] of [
        ['era5', 'era5', 'era5', false], ['station', 'station', 'station', false],
        ['country', 'era5', 'era5', true], ['country', null, 'station', true],
        [null, 'era5', 'era5', false], ['invalid', 'invalid', 'station', false]
      ]) {
        await page.evaluate(async ({ saved, point }) => {
          const { createLocalTemperatureCache } = await import('./local-temperature-data.mjs');
          const cache = createLocalTemperatureCache();
          await cache.set('last-location', null); await cache.set('last-country', null);
          await cache.set('local-source', saved); await cache.set('local-point-source', point);
        }, { saved, point });
        await page.reload(); await page.waitForFunction(() => defaultsTest?.ready());
        await page.click('#settingsBtn'); await page.selectOption('#datasetSelect', 'local');
        await page.waitForFunction(() => document.getElementById('localStatus').textContent === 'Choose a location.');
        assert.equal(await page.locator('#colorMode').inputValue(), 'annual', 'A fresh page uses the local yearly default');
        assert.equal(await page.locator('#localSource').inputValue(), expected, 'Restore source preference: ' + saved + '/' + point);
        assert.equal(await page.locator('#localSource').isVisible(), !country);
      }
      assert.equal(weather.length, 0);
      assert.deepEqual(errors, []);
      await context.close();
      console.log(name + ': yearly/station defaults, real station rendering, color restoration, and saved/legacy/invalid source preferences passed');
    }
  } finally { await browser.close(); }
  console.log('Screenshots: ' + output);
})().catch(error => { console.error(error); process.exit(1); });

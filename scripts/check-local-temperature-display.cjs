const assert = require('node:assert/strict');
const { readFileSync, mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { chromium } = require('playwright');
const { installVideoSessionHook } = require('./browser-test-hooks.cjs');
const output = join(tmpdir(), 'climate-local-temperature-display');
mkdirSync(output, { recursive: true });
const hooks = `
window.temperatureTest = {
  ready: () => Boolean(spiralMesh && timelineStops.length),
  source: () => localSnapshot?.source,
  month(year, month = 0) {
    const target = year + month / 12;
    const stop = timelineStops.find(index => Math.abs(generatedGeometryData[Math.floor(index / (CONFIG.radialSegments * 6))].decimalYear - target) < 1e-6);
    if (stop === undefined) throw new Error('Test observation unavailable');
    setPlaybackPosition(stop);
    controls.enableDamping = false;
  },
  morph(mix) { layoutTransition = null; layoutMix = mix; applyLayout(); },
  state() {
    const point = generatedGeometryData[Math.floor(animationIndex / (CONFIG.radialSegments * 6))];
    renderer.render(scene, activeCamera);
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
    const context = canvas.getContext('2d'); context.drawImage(renderer.domElement, 0, 0, 320, 240);
    const pixels = context.getImageData(0, 0, 320, 240).data;
    let lit = 0; for (let i = 0; i < pixels.length; i += 4) if (Math.max(pixels[i], pixels[i+1], pixels[i+2]) > 20) lit++;
    return { mode: getLocalTemperatureMode(), index: animationIndex, month: point.decimalYear,
      months: timelineStops.length, value: point.displayValue, readout: document.getElementById('infoTemp').textContent,
      metric: document.getElementById('infoMetricLabel').textContent, description: document.getElementById('infoDescription').textContent,
      caption: document.getElementById('legendCaption').textContent, display: getActiveDisplay(),
      seasonal: point.seasonalAnomaly, annual: point.yearlyAnomaly, mix: layoutMix, playing: isAnimating,
      camera: [activeCamera.position.toArray(), controls.target.toArray(), activeCamera.zoom],
      minRadius: getSpiralRadius(getActiveDisplay().legendRange[0]), outerRadius: getSpiralRadius(getOuterRingValue(currentMaxAnomaly)),
      monthRadius: monthLabelsGroup.children[0].layoutSource.length(),
      finite: spiralMesh.geometry.attributes.position.array.every(Number.isFinite), lit,
      source: localSnapshot.source, snapshot: JSON.stringify(localSnapshot),
      colors: Array.from(spiralMesh.geometry.userData.originalColorArray),
      overflow: document.documentElement.scrollWidth > innerWidth || document.getElementById('settingsPanel').scrollWidth > document.getElementById('settingsPanel').clientWidth };
  },
  legend() {
    const canvas = document.createElement('canvas'); canvas.width = 1920; canvas.height = 1080;
    const context = canvas.getContext('2d'), text = [], fillText = context.fillText.bind(context);
    context.fillText = (...args) => { text.push(args[0]); fillText(...args); };
    videoController.drawLegend({ canvas, context, layout: { legend: { x: 40, y: 350, width: 660, height: 220 } } });
    return text;
  },
  recording: () => videoController.testRecording?.frameIndex,
};
`;
const reanalysis = { version: 1, source: 'Open-Meteo', model: 'era5_land', units: 'celsius',
  location: { name: 'Seasonal example', latitude: 52, longitude: 13, timezone: 'UTC' },
  grid: { latitude: 52, longitude: 13, elevation: 30, timezone: 'UTC' },
  through: '2020-12', fetchedAt: '2026-01-15T12:00:00Z',
  records: Array.from({ length: 70 * 12 }, (_, index) => ({
    month: (1951 + Math.floor(index / 12)) + '-' + String(index % 12 + 1).padStart(2, '0'),
    mean: 5 - 12 * Math.cos(index % 12 / 12 * Math.PI * 2) + (1951 + Math.floor(index / 12) - 1965) * 0.02,
  })).filter(row => row.month !== '1987-02') };
const fixtures = { era5: JSON.stringify(reanalysis),
  station: readFileSync('data/weather-stations/GM/GM000003319.json', 'utf8'),
  country: readFileSync('data/country-temperature/DE.json', 'utf8') };

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
  try {
    for (const [name, viewport] of Object.entries({ desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 } })) {
      const context = await browser.newContext({ viewport, isMobile: name === 'mobile', hasTouch: name === 'mobile', serviceWorkers: 'block', acceptDownloads: true });
      const page = await context.newPage(), errors = [], requests = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => { if (/archive-api|\/data\/(weather-stations|country-temperature)/.test(request.url())) requests.push(request.url()); });
      await installVideoSessionHook(page);
      await page.route('**/index.html', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()).replace('// --- Configuration ---', hooks + '// --- Configuration ---') });
      });
      await page.goto('http://127.0.0.1:8000/index.html'); await page.waitForFunction(() => temperatureTest?.ready());
      await page.click('#settingsBtn'); await page.click('#viewSettings > summary');
      await page.uncheck('#smoothSpiralToggle'); await page.selectOption('#datasetSelect', 'local');
      await page.waitForFunction(() => document.getElementById('localStatus').textContent === 'Choose a location.');
      assert.equal(await page.locator('#localSource').inputValue(), 'station');
      assert.equal(await page.locator('#colorMode').inputValue(), 'annual');
      await page.selectOption('#colorMode', 'value');
      assert.equal(await page.locator('[name="localTemperatureDisplay"]:checked').inputValue(), 'anomaly');
      for (const [source, fixture] of Object.entries(fixtures)) {
        await page.locator('#fileUpload').setInputFiles({ name: source + '.json', mimeType: 'application/json', buffer: Buffer.from(fixture) });
        await page.waitForFunction(source => temperatureTest.ready() && temperatureTest.source() === source,
          source === 'era5' ? 'Open-Meteo' : source === 'station' ? 'NOAA GHCN-Monthly v4' : 'CRU-CY');
        await page.evaluate(() => temperatureTest.month(2020));
        const original = await page.evaluate(() => temperatureTest.state());
        const count = requests.length;
        await context.setOffline(true);
        await page.locator('.local-display label').filter({ hasText: 'Temperature' }).click();
        const absolute = await page.evaluate(() => temperatureTest.state());
        assert.equal(absolute.mode, 'temperature');
        for (const key of ['index', 'month', 'months', 'mix', 'playing', 'camera', 'snapshot', 'outerRadius', 'monthRadius']) assert.deepEqual(absolute[key], original[key], key);
        assert.ok(absolute.finite && absolute.lit > 300 && absolute.minRadius >= 5 && !absolute.overflow);
        assert.match(absolute.metric, /Temperature/); assert.doesNotMatch(absolute.description, /1951-1980/);
        assert.equal(absolute.caption, 'Monthly mean temperature');
        assert.ok(Math.abs(absolute.seasonal - original.seasonal) < 1e-9);
        assert.ok(Math.abs(absolute.annual - original.annual) < 1e-9);
        await page.evaluate(() => temperatureTest.month(2020, 6));
        const summer = await page.evaluate(() => temperatureTest.state());
        assert.ok(summer.value - absolute.value > 10, 'The local seasonal cycle must be visible');
        await page.locator('.local-display').scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(output, name + '-' + source + '-settings.png') });
        await page.click('#settingsBtn'); await page.click('#infoBtn');
        await page.screenshot({ path: join(output, name + '-' + source + '-spiral.png') });
        for (const mix of [0.5, 1, 0]) {
          await page.evaluate(mix => temperatureTest.morph(mix), mix);
          const state = await page.evaluate(() => temperatureTest.state()); assert.ok(state.finite && state.lit > 300);
          if (mix === 1) await page.screenshot({ path: join(output, name + '-' + source + '-unwrapped.png') });
        }
        const text = await page.evaluate(() => temperatureTest.legend());
        assert.ok(text.some(value => value.includes('Monthly mean temperature')));
        assert.equal(text.some(value => value.includes('Baseline 1951-1980')), false);
        await page.click('#settingsBtn'); await page.uncheck('#tubeToggle');
        await page.evaluate(() => temperatureTest.morph(1));
        assert.ok((await page.evaluate(() => temperatureTest.state())).lit > 300);
        await page.evaluate(() => temperatureTest.morph(0));
        await page.check('#tubeToggle');
        await page.evaluate(() => temperatureTest.month(2020));
        await page.locator('.local-display label').filter({ hasText: 'Anomaly' }).click();
        const restored = await page.evaluate(() => temperatureTest.state());
        assert.deepEqual(restored.colors, original.colors);
        assert.equal(restored.value, original.value);
        assert.equal(requests.length, count, 'Display changes must not download data');
        await page.click('#settingsBtn');
        if (!await page.locator('#infoPanel').isVisible()) await page.click('#infoBtn');
        await page.screenshot({ path: join(output, name + '-' + source + '-anomaly.png') });
        await page.click('#settingsBtn');
        await context.setOffline(false);
      }
      await page.locator('.local-display label').filter({ hasText: 'Temperature' }).click();
      await page.click('#exportSettings > summary'); await page.click('#videoAdvanced > summary');
      await page.selectOption('#videoResolution', 'custom'); await page.fill('#videoWidth', '640'); await page.fill('#videoHeight', '360');
      await page.selectOption('#videoCamera', 'current'); await page.check('#videoLegendToggle');
      const remove = page.locator('#videoViewList [data-action="remove"]'); while (await remove.count()) await remove.first().click();
      const download = page.waitForEvent('download', { timeout: 120000 });
      await page.click('#videoExportBtn'); await page.waitForFunction(() => temperatureTest.recording() >= 2);
      assert.equal(await page.locator('[name="localTemperatureDisplay"][value="anomaly"]').isDisabled(), true);
      await (await download).saveAs(join(output, name + '-temperature.mp4'));
      const png = await page.evaluate(async () => {
        const video = document.createElement('video'); video.muted = true;
        const loaded = new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = reject; });
        video.src = document.getElementById('videoDownload').href; await loaded;
        await new Promise(resolve => { video.onseeked = () => setTimeout(resolve, 100); video.currentTime = video.duration - 0.2; });
        const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d'); ctx.drawImage(video, 0, 0);
        return canvas.toDataURL().split(',')[1];
      });
      writeFileSync(join(output, name + '-video.png'), Buffer.from(png, 'base64'));
      assert.equal(await page.locator('[name="localTemperatureDisplay"][value="anomaly"]').isDisabled(), false);
      assert.deepEqual(errors, []);
      console.log(name + ': all local sources, offline switching, seasonal cycle, preserved state, both layouts/line modes, and video export passed');
      await context.close();
    }
  } finally { await browser.close(); }
  console.log('Screenshots and videos: ' + output);
})().catch(error => { console.error(error); process.exit(1); });

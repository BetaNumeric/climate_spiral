const assert = require('node:assert/strict');
const { mkdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { chromium } = require('playwright');

const output = join(tmpdir(), 'climate-local-temperature');
mkdirSync(output, { recursive: true });
const hooks = `
window.localTest = {
  ready: () => Boolean(spiralMesh && monthLabelsGroup?.children.length === 12),
  frame(graph = false) {
    if (isAnimating) toggleAnimation();
    layoutTransition = cameraResetAnimation = null;
    layoutMix = graph ? 1 : 0;
    applyLayout();
    setPlaybackPosition(totalIndices);
    controls.enableDamping = false;
    activeCamera.zoom = 1;
    activeCamera.position.copy(controls.target).add(new THREE.Vector3(0, 120, 0.0001));
    activeCamera.updateProjectionMatrix();
    controls.update();
  },
  state() {
    renderer.render(scene, activeCamera);
    const canvas = document.createElement('canvas');
    canvas.width = 320; canvas.height = 240;
    const context = canvas.getContext('2d');
    context.drawImage(renderer.domElement, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let litPixels = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 20) litPixels++;
    }
    return { dataset: currentDatasetKey, mesh: spiralMesh?.uuid, index: animationIndex,
      finite: spiralMesh?.geometry.attributes.position.array.every(Number.isFinite), litPixels,
      monthRadius: monthLabelsGroup && Math.hypot(monthLabelsGroup.children[0].position.x, monthLabelsGroup.children[0].position.z),
      outerRadius: getSpiralRadius(getOuterRingValue(currentMaxAnomaly)),
      minRadius: currentDatasetKey === 'local' ? getSpiralRadius(-localRange.extent) : null,
      location: localSnapshot?.location.name, stationId: localSnapshot?.station?.id, months: timelineStops.length,
      labels: Array.from(document.querySelectorAll('.legend-labels span'), label => label.textContent),
      overflow: document.documentElement.scrollWidth > innerWidth ||
        document.getElementById('settingsPanel').scrollWidth > document.getElementById('settingsPanel').clientWidth,
    };
  },
  legend() {
    const canvas = document.createElement('canvas');
    canvas.width = 1920; canvas.height = 1080;
    const context = canvas.getContext('2d');
    context.fillRect(0, 0, canvas.width, canvas.height);
    const text = [];
    const fillText = context.fillText.bind(context);
    context.fillText = (...args) => { text.push(args[0]); fillText(...args); };
    drawVideoLegend({ context, canvas, layout: { legend: { x: 40, y: 350, width: 660, height: 220 } } });
    return { image: canvas.toDataURL(), text };
  },
};
`;

function weather(url) {
  const start = Date.parse(url.searchParams.get('start_date'));
  const end = Date.parse(url.searchParams.get('end_date'));
  const time = [], temperature = [];
  for (let day = start; day <= end; day += 86400000) {
    const date = new Date(day), year = date.getUTCFullYear(), month = date.getUTCMonth();
    time.push(date.toISOString().slice(0, 10));
    temperature.push(8 + month + (year - 1950) * 0.04 + Math.sin(year * 7 + month) * 4);
  }
  return { latitude: Number(url.searchParams.get('latitude')), longitude: Number(url.searchParams.get('longitude')),
    elevation: 38, timezone: 'Europe/Berlin',
    daily_units: { time: 'iso8601', temperature_2m_mean: '\u00b0C' },
    daily: { time, temperature_2m_mean: temperature } };
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
  try {
    for (const [name, viewport] of Object.entries({ desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 } })) {
      const context = await browser.newContext({ viewport, serviceWorkers: 'block', isMobile: name === 'mobile', hasTouch: name === 'mobile' });
      const page = await context.newPage();
      const errors = [], requests = [], stationRequests = [];
      let failWeather = false, delayWeather = false;
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => { if (request.url().includes('/data/weather-stations/')) stationRequests.push(request.url()); });
      await page.route('**/index.html', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()).replace('// --- Configuration ---', hooks + '// --- Configuration ---') });
      });
      await page.route('https://geocoding-api.open-meteo.com/**', route => route.fulfill({ json: { results: [
        { name: 'Berlin', admin1: 'Berlin', country: 'Germany', latitude: 52.52, longitude: 13.41, timezone: 'Europe/Berlin' },
        { name: 'Another place with a long name to check narrow screen wrapping', country: 'Germany', latitude: 50, longitude: 13, timezone: 'Europe/Berlin' },
      ] } }));
      await page.route('https://archive-api.open-meteo.com/**', async route => {
        const url = new URL(route.request().url());
        requests.push(url);
        assert.equal(url.searchParams.get('models'), 'era5_land');
        if (delayWeather) await new Promise(resolve => setTimeout(resolve, 800));
        if (failWeather) return route.fulfill({ status: 429, json: {} });
        await route.fulfill({ json: weather(url) });
      });
      const openLocal = async () => {
        await page.click('#settingsBtn');
        await page.selectOption('#datasetSelect', 'local');
      };
      const saved = () => page.waitForFunction(() => document.getElementById('localStatus').textContent === 'Saved on this device.');
      const chooseBerlin = async () => {
        await page.fill('#localSearch', 'Berlin');
        await page.locator('#localSearchForm button').click();
        await page.getByRole('button', { name: 'Berlin, Germany', exact: true }).click();
        await saved();
      };
      await page.goto('http://127.0.0.1:8000/index.html');
      await page.waitForFunction(() => window.localTest?.ready());
      await page.evaluate(() => localTest.frame());
      const global = await page.evaluate(() => localTest.state());
      await openLocal();
      assert.equal(await page.locator('#playBtn').isDisabled(), true);
      await page.waitForFunction(() => document.getElementById('localStatus').textContent === 'Choose a location.');
      await chooseBerlin();
      assert.ok(requests.length >= 15);
      await page.evaluate(() => localTest.frame());
      const local = await page.evaluate(() => localTest.state());
      assert.ok(local.finite && local.litPixels > 300 && local.minRadius >= 5);
      assert.equal(local.monthRadius, global.monthRadius);
      assert.ok(Math.abs(local.outerRadius - global.outerRadius) < 1e-6);
      assert.equal(local.location, 'Berlin, Germany');
      assert.ok(local.months > 900 && local.labels.length === 5 && !local.overflow);
      await page.screenshot({ path: join(output, name + '-settings.png') });
      await page.click('#settingsBtn');
      await page.click('#stepBackBtn');
      const previous = await page.evaluate(() => localTest.state());
      assert.ok(previous.index < local.index, 'Month stepping changes the data');
      await page.click('#stepForwardBtn');
      assert.equal((await page.evaluate(() => localTest.state())).index, local.index);
      await page.click('#infoBtn');
      assert.equal(await page.locator('#infoLocation').textContent(), 'Berlin, Germany');
      await page.screenshot({ path: join(output, name + '-spiral.png') });
      const legend = await page.evaluate(() => localTest.legend());
      assert.ok(legend.text.includes('Berlin, Germany'));
      assert.ok(legend.text.some(text => text.includes('Open-Meteo')));
      writeFileSync(join(output, name + '-video-legend.png'), Buffer.from(legend.image.split(',')[1], 'base64'));
      await page.evaluate(() => localTest.frame(true));
      await page.waitForTimeout(150);
      const graph = await page.evaluate(() => localTest.state());
      assert.ok(graph.finite && graph.litPixels > 300);
      await page.screenshot({ path: join(output, name + '-unwrapped.png') });

      const loadedRequests = requests.length;
      await page.reload();
      await page.waitForFunction(() => window.localTest?.ready());
      await openLocal();
      await saved();
      assert.equal(requests.length, loadedRequests, 'Reload uses IndexedDB without fetching weather again');
      await page.evaluate(() => localTest.frame());
      assert.equal((await page.evaluate(() => localTest.state())).months, local.months);
      await page.locator('#dataSettings summary').click();
      failWeather = true;
      await page.click('#fetchBtn');
      await page.waitForFunction(() => document.getElementById('localStatus').textContent.startsWith('API limit reached'));
      assert.equal((await page.evaluate(() => localTest.state())).months, local.months, 'Network failure preserves saved history');
      assert.ok(requests.at(-1).searchParams.get('start_date') > '2025-01-01', 'Refresh only fetches recent history');
      failWeather = false;

      // Cancel after one successful batch, then resume from that persisted checkpoint.
      delayWeather = true;
      await page.fill('#localSearch', '50, 13');
      await page.locator('#localSearchForm button').click();
      await page.getByRole('button', { name: '50.000, 13.000', exact: true }).click();
      await page.waitForFunction(() => document.getElementById('localStatus').textContent.includes('1955-1959'));
      await page.click('#localAction');
      assert.equal(await page.locator('#localStatus').textContent(), 'Download paused.');
      const beforeResume = requests.length;
      delayWeather = false;
      await page.click('#localAction');
      await saved();
      assert.equal(requests[beforeResume].searchParams.get('start_date'), '1954-11-01');
      assert.equal((await page.evaluate(() => localTest.state())).location, '50.000, 13.000');

      // A dataset change must ignore an in-flight local update.
      delayWeather = true;
      await page.click('#fetchBtn');
      await page.selectOption('#datasetSelect', 'temperature');
      await page.waitForFunction(() => localTest.ready() && localTest.state().dataset === 'temperature');
      await page.waitForTimeout(1000);
      assert.equal((await page.evaluate(() => localTest.state())).dataset, 'temperature');
      assert.equal(await page.locator('#localTemperatureControls').isVisible(), false);

      // Exercise the real checked-in NOAA files through the same location controls.
      delayWeather = false;
      await page.selectOption('#datasetSelect', 'local');
      await saved();
      await chooseBerlin();
      await page.selectOption('#localSource', 'station');
      await saved();
      assert.match(await page.locator('#settingsSourceLink').textContent(), /NOAA/);
      await page.evaluate(() => localTest.frame());
      const station = await page.evaluate(() => localTest.state());
      assert.ok(station.stationId && station.finite && station.litPixels > 300 && station.months >= 360 && !station.overflow);
      assert.equal(station.monthRadius, global.monthRadius);
      assert.match(await page.locator('#localStationDetails').textContent(), /1951-1980/);
      await page.screenshot({ path: join(output, name + '-station-settings.png') });
      const alternatives = await page.locator('#localStationSelect option').evaluateAll(options => options.map(option => option.value));
      assert.ok(alternatives.length > 1);
      await page.selectOption('#localStationSelect', alternatives[1]);
      await page.waitForFunction(id => localTest.state().stationId === id, alternatives[1]);
      await saved();
      await page.evaluate(() => localTest.frame());
      await page.click('#settingsBtn');
      await page.click('#infoBtn');
      await page.screenshot({ path: join(output, name + '-station-spiral.png') });
      const stationLegend = await page.evaluate(() => localTest.legend());
      assert.ok(stationLegend.text.some(text => text.includes('NOAA GHCN-Monthly')));
      assert.equal(stationLegend.text.some(text => text.includes('Open-Meteo')), false);
      await page.evaluate(() => localTest.frame(true));
      await page.waitForTimeout(150);
      const stationGraph = await page.evaluate(() => localTest.state());
      assert.ok(stationGraph.finite && stationGraph.litPixels > 300);
      await page.screenshot({ path: join(output, name + '-station-unwrapped.png') });

      const stationRequestCount = stationRequests.length;
      await page.reload();
      await page.waitForFunction(() => window.localTest?.ready());
      await openLocal();
      await saved();
      assert.equal(await page.locator('#localSource').inputValue(), 'station');
      assert.equal((await page.evaluate(() => localTest.state())).stationId, alternatives[1]);
      assert.equal(stationRequests.length, stationRequestCount, 'Saved station choice and data are restored without refetching');
      await page.locator('#dataSettings summary').click();
      await page.route('**/data/weather-stations/*/*.json', route => route.fulfill({ json: { invalid: true } }));
      await page.click('#fetchBtn');
      await page.waitForFunction(() => document.getElementById('localStatus').textContent.includes('being updated'));
      assert.equal((await page.evaluate(() => localTest.state())).stationId, alternatives[1], 'Mismatched releases preserve the cached station');
      await page.unroute('**/data/weather-stations/*/*.json');
      await page.click('#localAction');
      await saved();

      await page.fill('#localSearch', '0, 0');
      await page.locator('#localSearchForm button').click();
      await page.getByRole('button', { name: '0.000, 0.000', exact: true }).click();
      await page.waitForFunction(() => document.getElementById('localStatus').textContent.includes('No station within 100 km'));
      assert.equal(await page.locator('#playBtn').isDisabled(), true);
      assert.equal(await page.evaluate(() => localTest.ready()), false);
      await page.selectOption('#localStationRadius', '500');
      await page.waitForFunction(() => document.getElementById('localStatus').textContent.includes('No station within 500 km'));
      delayWeather = true;
      await page.selectOption('#localSource', 'era5');
      await page.selectOption('#localSource', 'station');
      await page.waitForFunction(() => document.getElementById('localStatus').textContent.includes('No station within'));
      await page.waitForTimeout(1000);
      assert.equal(await page.evaluate(() => localTest.ready()), false, 'A stale reanalysis response cannot replace a station selection');
      assert.deepEqual(errors, []);
      console.log(name + ': reanalysis and NOAA stations passed search, rendering, persistence, errors, and switching checks');
      await context.close();
    }
    console.log('Screenshots: ' + output);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

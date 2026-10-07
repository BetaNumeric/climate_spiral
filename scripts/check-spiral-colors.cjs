const assert = require('node:assert/strict');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { chromium } = require('playwright');
const { installVideoSessionHook } = require('./browser-test-hooks.cjs');
const output = join(tmpdir(), 'climate-spiral-colors');
mkdirSync(output, { recursive: true });
const hooks = `
window.colorTest = {
  ready: () => Boolean(spiralMesh && timelineStops.length),
  prepare() { controls.enableDamping = false; setPlaybackPosition(timelineStops[Math.floor(timelineStops.length / 2)]); },
  async state() {
    const hash = async array => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', array)), byte => byte.toString(16).padStart(2, '0')).join('');
    const geometry = spiralMesh.geometry;
    return { mesh: spiralMesh.uuid, index: animationIndex, stops: timelineStops.length, mix: layoutMix,
      value: document.getElementById('infoTemp').textContent, year: document.getElementById('infoYear').textContent,
      position: await hash(geometry.attributes.position.array), normals: await hash(geometry.attributes.normal.array),
      topology: await hash(geometry.index.array), colors: await hash(geometry.userData.originalColorArray),
      firstColor: generatedGeometryData[0].color.getHexString(), lastColor: generatedGeometryData.at(-1).color.getHexString(),
      legend: getActiveColorDisplay(), marker: document.getElementById('legendMarker').hidden,
      units: getActiveDisplay().unit, camera: activeCamera.position.toArray(), range: [startYear, endYear],
      seasonalAnomaly: generatedGeometryData[Math.min(Math.floor(animationIndex / (CONFIG.radialSegments * 6)), generatedGeometryData.length - 1)].seasonalAnomaly,
      yearlyAnomaly: generatedGeometryData[Math.min(Math.floor(animationIndex / (CONFIG.radialSegments * 6)), generatedGeometryData.length - 1)].yearlyAnomaly,
      markerPercent: Number.parseFloat(document.getElementById('legendMarker').style.left),
      caption: document.getElementById('legendCaption').textContent,
      labels: [...document.querySelectorAll('.legend-labels span')].map(element => element.textContent) };
  },
  annualYearColors() {
    const colors = new Map();
    for (const point of generatedGeometryData) {
      if (point.spiralMissing) continue;
      const year = calendarYear(point.decimalYear);
      if (!colors.has(year)) colors.set(year, new Set());
      colors.get(year).add(point.color.getHexString());
    }
    return [...colors].map(([year, values]) => [year, values.size]);
  },
  fixture() {
    updateDataVisualization([
      { year: 1951, anomalies: [0.1, 0.2], displayValues: [10, 20], fractions: [0, 2 / 12] },
      { year: 2000, anomalies: [0.2, 0.3], displayValues: [12, 24], fractions: [0, 2 / 12] }
    ]);
    this.prepare();
  },
  restore() { updateDataVisualization(); this.prepare(); },
  morph(mix) { layoutTransition = null; layoutMix = mix; applyLayout(); },
  pixelCount() {
    renderer.render(scene, activeCamera);
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
    const ctx = canvas.getContext('2d'); ctx.drawImage(renderer.domElement, 0, 0, 320, 240);
    const pixels = ctx.getImageData(0, 0, 320, 240).data;
    let count = 0; for (let i = 0; i < pixels.length; i += 4) if (Math.max(pixels[i], pixels[i+1], pixels[i+2]) > 20) count++;
    return count;
  },
  recording: () => videoController.testRecording && ({ frame: videoController.testRecording.frameIndex, layout: videoController.testRecording.layout }),
};
`;

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
  try {
    for (const [name, viewport] of Object.entries({ desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 } })) {
      const context = await browser.newContext({ viewport, isMobile: name === 'mobile', hasTouch: name === 'mobile', serviceWorkers: 'block', acceptDownloads: true });
      const page = await context.newPage(); const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await installVideoSessionHook(page);
      await page.route('**/index.html', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()).replace('// --- Configuration ---', hooks + '// --- Configuration ---') });
      });
      await page.goto('http://127.0.0.1:8000/index.html'); await page.waitForFunction(() => window.colorTest?.ready());
      await page.evaluate(() => colorTest.prepare());
      await page.click('#settingsBtn'); await page.click('#viewSettings > summary');
      assert.equal(await page.locator('#colorMode').inputValue(), 'value');
      assert.equal(await page.locator('#singleColorRow').isVisible(), false);
      const original = await page.evaluate(() => colorTest.state());
      assert.equal(await page.locator('#colorMode option[value="seasonal"]').textContent(), 'Monthly Anomaly');
      for (const mode of ['year', 'seasonal', 'annual', 'single', 'value']) {
        await page.selectOption('#colorMode', mode);
        if (mode === 'single') {
          assert.equal(await page.locator('#singleColorRow').isVisible(), true);
          await page.locator('#singleColor').evaluate(input => { input.value = '#ff8800'; input.dispatchEvent(new Event('input', { bubbles: true })); });
        }
        const state = await page.evaluate(() => colorTest.state());
        for (const key of ['mesh', 'index', 'stops', 'mix', 'value', 'year', 'position', 'normals', 'topology', 'camera', 'units']) {
          assert.deepEqual(state[key], original[key], 'Coloring must preserve ' + key);
        }
        if (mode === 'year') {
          assert.deepEqual(state.labels, original.range.map(String));
          assert.equal(state.firstColor, '7b4fd3'); assert.equal(state.lastColor, 'e34247'); assert.equal(state.marker, false);
          assert.equal(state.legend.legendStops.length, 7);
        } else if (mode === 'seasonal' || mode === 'annual') {
          assert.match(state.caption, /1991-2020 mean/);
          assert.equal(state.marker, false);
          const [min, max] = state.legend.legendRange;
          assert.equal(min, -max);
          const anomaly = mode === 'annual' ? state.yearlyAnomaly : state.seasonalAnomaly;
          const expectedPercent = (anomaly - min) / (max - min) * 100;
          assert.ok(Math.abs(state.markerPercent - expectedPercent) < 1e-4,
            `CSS marker ${state.markerPercent} must match anomaly position ${expectedPercent}`);
          assert.ok(state.labels.every(label => label.endsWith(state.units)));
          if (mode === 'annual') {
            assert.match(state.caption, /^Yearly/);
            assert.ok((await page.evaluate(() => colorTest.annualYearColors())).every(([, count]) => count === 1));
          }
        } else if (mode === 'single') {
          assert.deepEqual(state.labels, []); assert.equal(state.marker, true);
          assert.equal(state.firstColor, 'ff8800'); assert.equal(state.lastColor, 'ff8800');
        } else { assert.equal(state.colors, original.colors); assert.deepEqual(state.labels, original.labels); }
        assert.ok(await page.evaluate(() => colorTest.pixelCount()) > 300);
        assert.equal(await page.locator('#settingsPanel').evaluate(element => element.scrollWidth <= element.clientWidth), true);
        await page.locator('#colorMode').scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(output, name + '-' + mode + '-settings.png') });
      }
      await page.uncheck('#tubeToggle');
      await page.selectOption('#colorMode', 'year');
      for (const mix of [0.5, 1, 0]) {
        await page.evaluate(mix => colorTest.morph(mix), mix);
        assert.ok(await page.evaluate(() => colorTest.pixelCount()) > 300);
        const state = await page.evaluate(() => colorTest.state()); assert.equal(state.firstColor, '7b4fd3');
      }
      await page.selectOption('#colorMode', 'seasonal');
      const seasonalLine = await page.evaluate(() => colorTest.state());
      for (const segments of ['3', '12', '24', '6']) {
        await page.selectOption('#curveSegments', segments);
        await page.evaluate(() => colorTest.morph(1));
        const state = await page.evaluate(() => colorTest.state());
        assert.deepEqual(state.legend, seasonalLine.legend, 'Smoothing detail must not affect the baseline or legend');
        assert.ok(Math.abs(state.seasonalAnomaly - seasonalLine.seasonalAnomaly) < 1e-8);
        assert.ok(await page.evaluate(() => colorTest.pixelCount()) > 300);
      }
      await page.evaluate(() => colorTest.morph(0));
      await page.selectOption('#colorMode', 'annual');
      const annualLine = await page.evaluate(() => colorTest.state());
      for (const mix of [0.5, 1, 0]) {
        await page.evaluate(mix => colorTest.morph(mix), mix);
        const state = await page.evaluate(() => colorTest.state());
        assert.deepEqual(state.legend, annualLine.legend);
        assert.equal(state.yearlyAnomaly, annualLine.yearlyAnomaly);
        assert.equal(state.index, annualLine.index);
        assert.ok((await page.evaluate(() => colorTest.annualYearColors())).every(([, count]) => count === 1));
        assert.ok(await page.evaluate(() => colorTest.pixelCount()) > 300);
      }
      await page.selectOption('#colorMode', 'single');
      await page.selectOption('#datasetSelect', 'arcticvolume');
      await page.waitForFunction(() => document.getElementById('dataOrigin').textContent === '(Local Data)' && document.getElementById('infoTemp').textContent.includes('km'));
      const ice = await page.evaluate(() => colorTest.state());
      assert.equal(ice.firstColor, 'ff8800'); assert.equal(ice.lastColor, 'ff8800'); assert.deepEqual(ice.labels, []);
      await page.selectOption('#colorMode', 'seasonal');
      await page.evaluate(() => colorTest.prepare());
      const iceSeasonal = await page.evaluate(() => colorTest.state());
      assert.match(iceSeasonal.caption, /1991-2020 mean/);
      assert.ok(iceSeasonal.labels.every(label => label.endsWith(iceSeasonal.units)));
      await page.evaluate(() => colorTest.fixture());
      const fallback = await page.evaluate(() => colorTest.state());
      assert.match(fallback.caption, /1951-2000 available-record mean/);
      assert.equal(fallback.seasonalAnomaly, 1);
      assert.equal(fallback.marker, false);
      await page.selectOption('#colorMode', 'annual');
      const incomplete = await page.evaluate(() => colorTest.state());
      assert.equal(incomplete.yearlyAnomaly, null);
      assert.equal(incomplete.marker, true);
      assert.match(incomplete.caption, /Incomplete year/);
      assert.equal(incomplete.firstColor, '737980');
      await page.selectOption('#colorMode', 'seasonal');
      await page.evaluate(() => colorTest.restore());
      await page.click('#settingsBtn'); await page.click('#infoBtn');
      await page.screenshot({ path: join(output, name + '-seasonal-legend.png') });
      await page.click('#settingsBtn');
      await page.selectOption('#colorMode', 'annual');
      await page.click('#settingsBtn');
      if (!await page.locator('#infoPanel').isVisible()) await page.click('#infoBtn');
      await page.screenshot({ path: join(output, name + '-annual-legend.png') });
      await page.click('#settingsBtn');
      await page.selectOption('#colorMode', 'year');
      const iceYear = await page.evaluate(() => colorTest.state());
      assert.deepEqual(iceYear.labels, iceYear.range.map(String));
      await page.selectOption('#colorMode', 'value');
      assert.deepEqual((await page.evaluate(() => colorTest.state())).labels, ['0', '10', '20', '30', '40']);
      await page.selectOption('#colorMode', 'year');
      await page.click('#settingsBtn'); await page.click('#infoBtn');
      await page.screenshot({ path: join(output, name + '-year-legend.png') });
      await page.click('#settingsBtn');
      await page.uncheck('#smoothSpiralToggle');
      await page.click('#exportSettings > summary'); await page.click('#videoAdvanced > summary');
      await page.selectOption('#videoResolution', 'custom'); await page.fill('#videoWidth', '640'); await page.fill('#videoHeight', '360');
      await page.selectOption('#videoCamera', 'current');
      const remove = page.locator('#videoViewList [data-action="remove"]'); while (await remove.count()) await remove.first().click();
      await page.check('#videoLegendToggle');
      for (const mode of ['year', 'seasonal', 'annual', 'single']) {
        await page.selectOption('#colorMode', mode);
        const download = page.waitForEvent('download', { timeout: 120_000 });
        await page.click('#videoExportBtn'); await page.waitForFunction(() => colorTest.recording()?.frame >= 2);
        assert.equal(await page.locator('#colorMode').isDisabled(), true); assert.equal(await page.locator('#singleColor').isDisabled(), true);
        const layout = await page.evaluate(() => colorTest.recording().layout);
        await (await download).saveAs(join(output, name + '-' + mode + '.mp4'));
        const result = await page.evaluate(async ({ layout }) => {
          const video = document.createElement('video'); video.muted = true;
          const loaded = new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = reject; });
          video.src = document.getElementById('videoDownload').href; await loaded;
          await new Promise(resolve => { video.onseeked = () => setTimeout(resolve, 100); video.currentTime = video.duration - 0.2; });
          const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d'); ctx.drawImage(video, 0, 0);
          const rect = layout.legend, scale = Math.min(canvas.width, canvas.height) / 1080;
          const barHeight = Math.max(6 * scale, Math.min(18 * scale, rect.height * 0.075));
          const samples = [0.15, 0.85].map(fraction => [...ctx.getImageData(Math.floor(rect.x + rect.width * fraction),
            Math.floor(rect.y + rect.height * 0.47 + barHeight / 2), 1, 1).data].slice(0, 3));
          return { width: video.videoWidth, height: video.videoHeight, samples, image: canvas.toDataURL().split(',')[1] };
        }, { layout });
        assert.equal(result.width, 640); assert.equal(result.height, 360);
        if (mode === 'single') for (const pixel of result.samples) {
          assert.ok(pixel.every((channel, index) => Math.abs(channel - [255, 136, 0][index]) < 20), 'Single-color video legend must be orange');
        } else assert.ok(result.samples[0][2] > result.samples[1][2] + 30, mode + ' video legend must use its gradient');
        writeFileSync(join(output, name + '-' + mode + '-video.png'), Buffer.from(result.image, 'base64'));
        if (!await page.locator('#settingsPanel').isVisible()) await page.click('#settingsBtn');
        assert.equal(await page.locator('#colorMode').isDisabled(), false);
      }
      assert.deepEqual(errors, []); await context.close();
      console.log(name + ': color restoration, unchanged geometry/timeline, monthly/yearly anomalies, incomplete years, legends, line morphs, dataset switching and decoded videos passed');
    }
    console.log('Screenshots and videos: ' + output);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });

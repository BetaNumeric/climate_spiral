const assert = require('node:assert/strict');
const { readFileSync, mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { chromium } = require('playwright');
const output = join(tmpdir(), 'climate-ocean-ph');
mkdirSync(output, { recursive: true });
const snapshot = JSON.parse(readFileSync('data/ocean-ph.json', 'utf8'));

const hooks = `
window.phTest = {
  ready: () => Boolean(spiralMesh && timelineStops.length),
  frame(mix = 0, side = false) {
    if (isAnimating) toggleAnimation();
    cameraController.cancelAnimation();
    controls.enableDamping = false;
    layoutTransition = null; layoutMix = mix; applyLayout();
    setPlaybackPosition(totalIndices);
    setSpiralTargetY(spiralHeight / 2);
    activeCamera.position.copy(controls.target).add(side ? new THREE.Vector3(120, 0, 0) : new THREE.Vector3(0, 120, 0.0001));
    controls.update();
  },
  state() {
    renderer.render(scene, activeCamera);
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
    const context = canvas.getContext('2d'); context.drawImage(renderer.domElement, 0, 0, 320, 240);
    const pixels = context.getImageData(0, 0, 320, 240).data;
    let lit = 0; for (let i = 0; i < pixels.length; i += 4) if (Math.max(pixels[i], pixels[i+1], pixels[i+2]) > 20) lit++;
    return { dataset: currentDatasetKey, months: timelineStops.length, mesh: spiralMesh.uuid,
      metric: document.getElementById('infoTemp').textContent, display: getActiveDisplay(),
      legend: Array.from(document.querySelectorAll('.legend-labels span'), label => label.textContent),
      referenceLabels: getReferenceValues().map(value => formatReferenceValue(value, getActiveDisplay())),
      outerRadius: getSpiralRadius(getOuterRingValue(currentMaxAnomaly)),
      monthRadius: monthLabelsGroup.children[0].layoutSource.length(),
      finite: spiralMesh.geometry.attributes.position.array.every(Number.isFinite), lit,
      overflow: document.documentElement.scrollWidth > innerWidth || document.getElementById('settingsPanel').scrollWidth > document.getElementById('settingsPanel').clientWidth };
  },
  legend() {
    const canvas = document.createElement('canvas'); canvas.width = 1920; canvas.height = 1080;
    const context = canvas.getContext('2d'), text = [], fillText = context.fillText.bind(context);
    context.fillText = (...args) => { text.push(args[0]); fillText(...args); };
    videoController.drawLegend({ canvas, context, layout: { legend: { x: 40, y: 350, width: 660, height: 220 } } });
    return text;
  },
};
`;

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
  try {
    for (const [name, viewport] of Object.entries({ desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 } })) {
      const context = await browser.newContext({ viewport, isMobile: name === 'mobile', hasTouch: name === 'mobile', serviceWorkers: 'block', acceptDownloads: true });
      const page = await context.newPage(), errors = [], requests = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => requests.push(request.url()));
      await page.route('**/index.html', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()).replace('// --- Configuration ---', hooks + '// --- Configuration ---') });
      });
      await page.goto('http://127.0.0.1:8000/index.html');
      await page.waitForFunction(() => window.phTest?.ready());
      await page.evaluate(() => phTest.frame());
      const global = await page.evaluate(() => phTest.state());
      await page.click('#settingsBtn'); await page.click('#viewSettings > summary');
      await page.selectOption('#datasetSelect', 'oceanph');
      await page.waitForFunction(count => phTest.ready() && phTest.state().dataset === 'oceanph' && phTest.state().months === count, snapshot.records.length);
      await page.evaluate(() => phTest.frame());
      let state = await page.evaluate(() => phTest.state());
      assert.equal(state.months, snapshot.records.length);
      assert.equal(state.metric, snapshot.records.at(-1).ph.toFixed(3) + ' pH');
      assert.deepEqual(state.legend, ['7.95', '8.00', '8.05', '8.10', '8.15']);
      assert.deepEqual(state.referenceLabels, ['8.00 pH', '8.05 pH', '8.10 pH', '8.15 pH']);
      assert.ok(state.finite && state.lit > 300 && !state.overflow);
      assert.ok(Math.abs(state.outerRadius - global.outerRadius) < 1e-6);
      assert.ok(Math.abs(state.monthRadius - global.monthRadius) < 1e-6);
      await page.screenshot({ path: join(output, name + '-settings.png') });
      await page.click('#settingsBtn'); await page.click('#infoBtn');
      await page.screenshot({ path: join(output, name + '-spiral.png') });
      for (const mix of [0.25, 0.5, 1, 0]) {
        await page.evaluate(mix => phTest.frame(mix), mix);
        state = await page.evaluate(() => phTest.state());
        assert.ok(state.finite && state.lit > 300, 'pH should remain visible during unwrapping');
        if (mix === 1) {
          await page.screenshot({ path: join(output, name + '-unwrapped.png') });
          await page.evaluate(() => phTest.frame(1, true));
          await page.screenshot({ path: join(output, name + '-right.png') });
          const side = await page.evaluate(() => phTest.state());
          assert.ok(side.finite && side.lit > 50, 'pH right view should remain visible: ' + side.lit);
        }
      }
      const legend = await page.evaluate(() => phTest.legend());
      assert.ok(legend.includes(snapshot.records.at(-1).ph.toFixed(3) + ' pH'));
      assert.ok(legend.some(text => /Copernicus Marine/.test(text)));
      assert.ok(legend.some(text => /provisional/.test(text)));
      await page.click('#settingsBtn');
      await page.uncheck('#tubeToggle'); await page.evaluate(() => phTest.frame(1));
      assert.ok((await page.evaluate(() => phTest.state())).lit > 300);
      await page.check('#tubeToggle');
      for (const mode of ['year', 'seasonal', 'annual', 'single', 'value']) {
        await page.selectOption('#colorMode', mode);
        assert.ok((await page.evaluate(() => phTest.state())).lit > 300);
      }
      const before = requests.filter(url => url.endsWith('/data/ocean-ph.json')).length;
      await page.evaluate(() => document.getElementById('fetchBtn').click());
      await page.waitForFunction(() => document.getElementById('fetchStatus').textContent === 'Success!');
      assert.equal(requests.filter(url => url.endsWith('/data/ocean-ph.json')).length, before + 1);
      assert.ok(!requests.some(url => /cloudferro|stac\.marine|corsproxy/.test(url)));
      await page.evaluate(() => phTest.frame());
      await page.click('#exportSettings > summary'); await page.click('#videoAdvanced > summary');
      await page.selectOption('#videoResolution', 'custom'); await page.fill('#videoWidth', '640'); await page.fill('#videoHeight', '360');
      await page.selectOption('#videoCamera', 'current'); await page.check('#videoLegendToggle');
      const remove = page.locator('#videoViewList [data-action="remove"]');
      while (await remove.count()) await remove.first().click();
      const download = page.waitForEvent('download', { timeout: 120000 });
      await page.click('#videoExportBtn');
      await (await download).saveAs(join(output, name + '-ocean-ph.mp4'));
      const result = await page.evaluate(async () => {
        const video = document.createElement('video'); video.muted = true;
        const loaded = new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = reject; });
        video.src = document.getElementById('videoDownload').href; await loaded;
        await new Promise(resolve => { video.onseeked = () => setTimeout(resolve, 100); video.currentTime = video.duration - 0.1; });
        const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        const context = canvas.getContext('2d'); context.drawImage(video, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let lit = 0; for (let i = 0; i < pixels.length; i += 4) if (Math.max(pixels[i], pixels[i+1], pixels[i+2]) > 20) lit++;
        return { png: canvas.toDataURL().split(',')[1], lit, width: canvas.width, height: canvas.height };
      });
      assert.ok(result.lit > 1000 && result.width === 640 && result.height === 360);
      writeFileSync(join(output, name + '-video.png'), Buffer.from(result.png, 'base64'));
      assert.deepEqual(errors, []);
      console.log(name + ': real pH history, decimal guides, framing, both layouts/line modes, color modes, snapshot refresh and decoded video passed');
      await context.close();
    }
  } finally { await browser.close(); }
  console.log('Screenshots and videos: ' + output);
})().catch(error => { console.error(error); process.exitCode = 1; });

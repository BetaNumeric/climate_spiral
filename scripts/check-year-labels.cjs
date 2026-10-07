const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { chromium } = require('playwright');

const output = join(tmpdir(), 'climate-year-labels');
mkdirSync(output, { recursive: true });
const hooks = `
window.yearLabelTest = {
  ready: () => Boolean(spiralMesh && timelineStops.length),
  load(data, spacing = 0.24) {
    if (isAnimating) toggleAnimation();
    cameraController.cancelAnimation();
    layoutTransition = null;
    layoutMix = 0;
    currentDatasetKey = 'local';
    CONFIG.heightPerYear = spacing;
    createSpiral(data);
    applyLayout();
    setPlaybackPosition(totalIndices);
  },
  view(graph, polar) {
    layoutMix = graph ? 1 : 0;
    applyLayout();
    controls.enableDamping = false;
    activeCamera.position.copy(controls.target).add(new THREE.Vector3().setFromSphericalCoords(120, polar, Math.PI / 2));
    controls.update();
  },
  state(originYear) {
    return {
      labels: yearLabelsGroup.children.map(label => ({
        year: Math.round(originYear + label.position.y / CONFIG.heightPerYear),
        y: label.position.y, opacity: label.material.opacity,
      })),
      dates: timelineStops.map(stop => generatedGeometryData[stop / (CONFIG.radialSegments * 6)].decimalYear),
      gaps: generatedGeometryData.filter(point => point.missing).length,
      finite: spiralMesh.geometry.attributes.position.array.every(Number.isFinite),
    };
  },
  pixels() {
    renderer.render(scene, activeCamera);
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
    const context = canvas.getContext('2d'); context.drawImage(renderer.domElement, 0, 0, 320, 240);
    const pixels = context.getImageData(0, 0, 320, 240).data;
    let lit = 0;
    for (let i = 0; i < pixels.length; i += 4) if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 20) lit++;
    return lit;
  },
};
`;

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
  try {
    for (const [name, viewport] of Object.entries({ desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 } })) {
      const context = await browser.newContext({ viewport, serviceWorkers: 'block', isMobile: name === 'mobile', hasTouch: name === 'mobile' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/index.html', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()).replace('// --- Configuration ---', hooks + '// --- Configuration ---') });
      });
      await page.goto('http://127.0.0.1:8000/index.html');
      await page.waitForFunction(() => window.yearLabelTest?.ready());
      for (const [years, expected] of [
        [[1829, 1838, 1855, 2025], Array.from({ length: 21 }, (_, i) => 1830 + i * 10)],
        [[1900, 1920], [1900, 1910, 1920, 1930]],
        [[2015], [2020]],
        [[2000], [2000, 2010]],
      ]) {
        const data = years.map(year => ({ year, anomalies: [0, 0.2], fractions: [0, 1 / 12] }));
        const dates = data.flatMap(entry => entry.fractions.map(fraction => entry.year + fraction));
        for (const spacing of [0.24, 0.4]) {
          await page.evaluate(([data, spacing]) => yearLabelTest.load(data, spacing), [data, spacing]);
          for (const graph of [false, true]) {
            await page.evaluate(graph => yearLabelTest.view(graph, Math.PI / 2), graph);
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const state = await page.evaluate(origin => yearLabelTest.state(origin), years[0]);
            assert.deepEqual(state.labels.map(label => label.year), expected);
            state.labels.forEach(label => {
              assert.ok(Math.abs(label.y - (label.year - years[0]) * spacing) < 1e-8);
              assert.ok(label.opacity > 0.99, 'Gap labels stay visible in the side view');
            });
            assert.deepEqual(state.dates, dates, 'Axis labels must not introduce observations');
            assert.ok(state.finite);
            if (years.length > 1) assert.ok(state.gaps > 0, 'Missing observations remain gaps');
            if (years[0] === 1829 && spacing === 0.24) {
              assert.ok(await page.evaluate(() => yearLabelTest.pixels()) > 100, 'The gapped record must render visibly');
              await page.screenshot({ path: join(output, name + (graph ? '-unwrapped' : '-spiral') + '.png') });
            }
          }
          await page.evaluate(() => yearLabelTest.view(true, 0.001));
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const top = await page.evaluate(origin => yearLabelTest.state(origin), years[0]);
          assert.ok(top.labels.every(label => label.opacity < 0.01), 'Gap labels retain the existing top-view fading');
        }
      }
      assert.deepEqual(errors, []);
      await context.close();
      console.log(name + ': decade labels span gaps in both layouts without changing observations, spacing, or fading');
    }
    console.log('Screenshots: ' + output);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

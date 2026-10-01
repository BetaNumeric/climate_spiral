const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { chromium } = require('playwright');

const output = join(tmpdir(), 'climate-dataset-framing');
mkdirSync(output, { recursive: true });

const hooks = `
window.framingTest = {
  ready: () => Boolean(spiralMesh && monthLabelsGroup?.children.length === 12),
  topView() {
    cameraResetAnimation = null;
    controls.enableDamping = false;
    if (isAnimating) toggleAnimation();
    setPlaybackPosition(totalIndices);
    activeCamera.zoom = 1;
    activeCamera.position.copy(controls.target).add(new THREE.Vector3(0, 120, 0));
    activeCamera.updateProjectionMatrix();
    controls.update();
  },
  state() {
    renderer.render(scene, activeCamera);
    const pixels = new Uint8Array(4 * 64 * 64);
    const gl = renderer.getContext();
    gl.readPixels(Math.floor(renderer.domElement.width / 2) - 32,
      Math.floor(renderer.domElement.height / 2) - 32, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let litPixels = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 20) litPixels++;
    }
    return {
      mesh: spiralMesh.uuid,
      dataset: currentDatasetKey,
      outerRadius: getSpiralRadius(getOuterRingValue(currentMaxAnomaly)),
      dataRadius: getSpiralRadius(currentMaxAnomaly),
      monthRadius: Math.hypot(monthLabelsGroup.children[0].position.x, monthLabelsGroup.children[0].position.z),
      monthScreen: monthLabelsGroup.children[0].getWorldPosition(new THREE.Vector3()).project(activeCamera).toArray(),
      graphWidth: monthlyLayout.width,
      cameraTop: orthographicCamera.top,
      videoHalfHeight: getVideoOrbitFrame(getYearLabelRadius(currentMaxAnomaly),
        getFramingHeight() / 2, 16 / 9, null, CONFIG.sceneScale).visibleHalfHeight,
      height: spiralHeight,
      litPixels,
    };
  },
};
`;

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
  try {
    for (const [name, viewport] of Object.entries({
      desktop: { width: 1280, height: 800 },
      mobile: { width: 390, height: 844 },
    })) {
      const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/index.html', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()).replace('// --- Configuration ---',
          hooks + '// --- Configuration ---') });
      });
      await page.goto('http://127.0.0.1:8000/index.html');
      await page.waitForFunction(() => window.framingTest?.ready());
      const datasets = await page.locator('#datasetSelect option').evaluateAll(options => options.map(option => option.value));
      const states = [];
      for (const dataset of datasets) {
        if (dataset !== 'temperature') {
          const previousMesh = (await page.evaluate(() => framingTest.state())).mesh;
          await page.selectOption('#datasetSelect', dataset, { force: true });
          await page.waitForFunction(mesh => framingTest.ready() && framingTest.state().mesh !== mesh, previousMesh);
        }
        await page.evaluate(() => framingTest.topView());
        const state = await page.evaluate(() => framingTest.state());
        states.push(state);
        assert.equal(state.dataset, dataset);
        assert.ok(state.litPixels > 0, dataset + ' has a blank canvas');
        if (dataset === 'temperature' || dataset === datasets.at(-1)) {
          await page.screenshot({ path: join(output, name + '-' + dataset + '.png') });
        }
      }
      console.log(name + ': ' + JSON.stringify(states.map(({ dataset, outerRadius, dataRadius, monthRadius, graphWidth, cameraTop, height }) =>
        ({ dataset, outerRadius, dataRadius, monthRadius, graphWidth, cameraTop, height }))));
      for (const state of states.slice(1)) {
        assert.ok(Math.abs(state.outerRadius - states[0].outerRadius) < 1e-6, state.dataset + ': outer radius');
        assert.ok(Math.abs(state.monthRadius - states[0].monthRadius) < 1e-6, state.dataset + ': month radius');
        assert.ok(Math.abs(state.cameraTop - states[0].cameraTop) < 1e-6, state.dataset + ': camera scale');
        assert.ok(Math.abs(state.videoHalfHeight - states[0].videoHalfHeight) < 1e-6, state.dataset + ': video scale');
        assert.ok(Math.abs(state.monthScreen[0] - states[0].monthScreen[0]) < 1e-4, state.dataset + ': label screen x');
        assert.ok(Math.abs(state.monthScreen[1] - states[0].monthScreen[1]) < 1e-4, state.dataset + ': label screen y');
        assert.ok(Math.abs(state.graphWidth - states[0].graphWidth) < 1e-6, state.dataset + ': graph width');
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log('Screenshots: ' + output);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

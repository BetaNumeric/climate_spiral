const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { chromium } = require('playwright');

const output = process.env.CLIMATE_FRAMING_OUTPUT || join(tmpdir(), 'climate-dataset-framing');
mkdirSync(output, { recursive: true });
const volumeDatasets = new Set(['arcticvolume']);

const hooks = `
import { getVideoOrbitFrame } from './video-export.mjs';
window.framingTest = {
  ready: () => Boolean(spiralMesh && monthLabelsGroup?.children.length === 12),
  topView() {
    layoutTransition = null;
    layoutMix = 0;
    applyLayout();
    cameraController.cancelAnimation();
    controls.enableDamping = false;
    if (isAnimating) toggleAnimation();
    setPlaybackPosition(totalIndices);
    activeCamera.zoom = 1;
    activeCamera.position.copy(controls.target).add(new THREE.Vector3(0, 120, 0));
    activeCamera.updateProjectionMatrix();
    controls.update();
  },
  graphView() {
    layoutMix = 1;
    applyLayout();
    setSpiralTargetY(spiralHeight / 2);
    activeCamera.position.copy(controls.target).add(new THREE.Vector3(0, 120, 0.0001));
    controls.update();
  },
  graphState() {
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
    const scale = getSeaIceScale();
    const values = getReferenceValues();
    const labelEdges = tempLabelGroup.children.map((label, index) => {
      const text = Math.round(scale.fromSpiralValue(values[index])) + ' ' + scale.unit;
      const image = label.material.map.image;
      const width = image.getContext('2d').measureText(text).width * 6 / image.width * label.scale.x;
      return new THREE.Vector3(label.position.x - width / 2, label.position.y, label.position.z)
        .project(activeCamera).x;
    });
    return { litPixels, leftLabelEdge: Math.min(...labelEdges),
      finite: spiralMesh.geometry.attributes.position.array.every(Number.isFinite) };
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
      metric: document.getElementById('infoTemp').textContent,
      legend: Array.from(document.querySelectorAll('.legend-labels span'), label => label.textContent),
      referenceValues: getActiveDataset().kind === 'sea-ice'
        ? getReferenceValues().map(getSeaIceScale().fromSpiralValue) : null,
      referenceRadii: getActiveDataset().kind === 'sea-ice'
        ? getReferenceValues().map(getSpiralRadius) : null,
      colorMax: getActiveDataset().kind === 'sea-ice' ? getSeaIceScale().max : null,
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
      const archivedRequests = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => {
        if (/oras5|giomas/i.test(request.url())) archivedRequests.push(request.url());
      });
      await page.route('**/index.html', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()).replace('// --- Configuration ---',
          hooks + '// --- Configuration ---') });
      });
      await page.goto('http://127.0.0.1:8000/index.html');
      await page.waitForFunction(() => window.framingTest?.ready());
      const datasets = await page.locator('#datasetSelect option').evaluateAll(options => options.map(option => option.value));
      assert.deepEqual(datasets, ['local', 'temperature', 'ocean', 'land', 'arctic', 'antarctic',
        'arcticvolume', 'sealevel', 'co2', 'methane']);
      const states = [];
      for (const dataset of datasets.filter(key => key !== 'local')) {
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
        if (dataset === 'temperature' || dataset === datasets.at(-1) || volumeDatasets.has(dataset)) {
          await page.screenshot({ path: join(output, name + '-' + dataset + '.png') });
        }
        if (volumeDatasets.has(dataset)) {
          assert.match(state.metric, /10\u00b3 km\u00b3/);
          assert.deepEqual(state.legend, ['0', '10', '20', '30', '40']);
          assert.deepEqual(state.referenceValues, [10, 20, 30, 40]);
          assert.equal(state.colorMax, 40);
          assert.ok(state.dataRadius / state.outerRadius > 0.8 && state.dataRadius < state.outerRadius,
            'PIOMAS should fill most of its reference circles without extending past the outer ring');
          state.referenceRadii.forEach((radius, index) => {
            assert.ok(Math.abs(radius - (index + 1) * 5) < 1e-6, dataset + ': volume reference radius');
          });
          await page.click('#infoBtn');
          await page.screenshot({ path: join(output, name + '-' + dataset + '-legend.png') });
          await page.evaluate(() => framingTest.graphView());
          await page.waitForTimeout(150);
          const graph = await page.evaluate(() => framingTest.graphState());
          assert.ok(graph.finite && graph.litPixels > 300, 'Volume graph is blank or invalid');
          assert.ok(graph.leftLabelEdge >= -1, 'Volume guide labels are clipped');
          await page.screenshot({ path: join(output, name + '-' + dataset + '-unwrapped.png') });
          await page.click('#infoBtn');
          await page.evaluate(() => framingTest.topView());
        } else if (dataset === 'arctic' || dataset === 'antarctic') {
          assert.match(state.metric, /M km\u00b2/);
          assert.deepEqual(state.legend, ['0', '5', '10', '15', '20']);
          assert.deepEqual(state.referenceValues, [5, 10, 15, 20]);
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
      assert.deepEqual(archivedRequests, [], 'Archived models must not be fetched');
      await context.close();
    }
    console.log('Screenshots: ' + output);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

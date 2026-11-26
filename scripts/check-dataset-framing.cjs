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
  wrappedBounds(view) {
    this.topView();
    if (view === 'front') {
      activeCamera.position.copy(controls.target).add(new THREE.Vector3(0, 0, 120));
      controls.update();
    }
    drawScene();
    const { width, height } = renderer.domElement;
    const gl = renderer.getContext();
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let left = width, right = 0, bottom = height, top = 0;
    for (let y = 0, i = 0; y < height; y++) {
      for (let x = 0; x < width; x++, i += 4) {
        if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) <= 20) continue;
        left = Math.min(left, x);
        right = Math.max(right, x);
        bottom = Math.min(bottom, y);
        top = Math.max(top, y);
      }
    }
    return { left, right, bottom, top, width, height, cameraTop: orthographicCamera.top };
  },
  tiltFrames() {
    this.topView();
    return Array.from({ length: 17 }, (_, step) => {
      const polar = step * Math.PI / 32;
      activeCamera.position.setFromSphericalCoords(120, polar, 0).add(controls.target);
      controls.update();
      updateOrthographicFrustum();
      return orthographicCamera.top;
    });
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
      videoHalfHeight: getVideoOrbitFrame(getYearLabelRadius(),
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

async function checkTopFit(page, name) {
  const frameSizes = () => page.evaluate(() => framingTest.tiltFrames());
  const toggle = page.locator('#fitTopViewToggle');
  assert.equal(await toggle.isChecked(), true, name + ': fit should be on by default');
  const fitted = await frameSizes();
  await toggle.evaluate(input => input.click());
  const base = await frameSizes();
  assert.ok(base.every(size => size === base[0]), name + ': disabling fit should fix the zoom');
  await toggle.evaluate(input => input.click());
  assert.ok(fitted[0] < base[0] && fitted.at(-1) === base.at(-1), name + ': top fit should retain side framing');
  assert.ok(fitted.every((size, i) => i === 0 || size > fitted[i - 1]), name + ': zoom reverses during the tilt');
  assert.ok(fitted[1] - fitted[0] < fitted[8] - fitted[7]
    && fitted.at(-1) - fitted.at(-2) < fitted[8] - fitted[7], name + ': zoom should ease into both endpoints');

  for (const view of ['top', 'front']) {
    const { left, right, bottom, top, width, height, cameraTop } = await page.evaluate(view => framingTest.wrappedBounds(view), view);
    assert.ok(Math.abs(cameraTop - fitted[view === 'top' ? 0 : fitted.length - 1]) < 1e-8,
      name + ' ' + view + ': rendered framing does not follow the tilt');
    assert.ok(left >= 2 && right < width - 2 && bottom >= 2 && top < height - 2 && right > left,
      name + ' fitted ' + view + ': canvas is blank or clipped');
    await page.screenshot({ path: join(output, name + '-fit-' + view + '.png') });
  }

  const setSpacing = value => page.locator('#spacingSlider').evaluate((input, value) => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  await setSpacing('0.8');
  const taller = await frameSizes();
  assert.ok(Math.abs(taller[0] - fitted[0]) < 1e-8 && taller.at(-1) > fitted.at(-1),
    name + ': a taller spiral should only affect side framing');
  await setSpacing('0.24');

  await page.evaluate(() => framingTest.graphView());
  const fittedGraph = (await page.evaluate(() => framingTest.state())).cameraTop;
  await toggle.evaluate(input => input.click());
  assert.equal((await page.evaluate(() => framingTest.state())).cameraTop, fittedGraph, name + ': unwrapped framing changed');
  assert.deepEqual(await frameSizes(), base, name + ': turning off fit should restore the original framing');
  await toggle.evaluate(input => input.click());
}

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
      const threePrefix = '/npm/three@0.160.0/';
      await page.route('https://cdn.jsdelivr.net' + threePrefix + '**', route => {
        const modulePath = new URL(route.request().url()).pathname.slice(threePrefix.length);
        return route.fulfill({ path: join(__dirname, '..', 'node_modules', 'three', modulePath),
          contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } });
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
        'arcticvolume', 'sealevel', 'oceanph', 'co2', 'methane']);
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
        if (dataset === 'temperature') {
          for (const view of ['top', 'front']) {
            const { left, right, bottom, top, width, height } = await page.evaluate(view => framingTest.wrappedBounds(view), view);
            assert.ok(left >= 2 && right < width - 2 && bottom >= 2 && top < height - 2,
              name + ' ' + view + ': visible geometry touches the canvas edge');
            assert.ok((right - left) / Math.min(width, height) > (name === 'mobile' ? 0.84 : 0.8),
              name + ' ' + view + ': spiral and labels leave too much space');
            if (view === 'front') await page.screenshot({ path: join(output, name + '-temperature-front.png') });
          }
          await checkTopFit(page, name);
          await page.evaluate(() => framingTest.topView());
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

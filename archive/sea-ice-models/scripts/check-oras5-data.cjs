// Historical integration check; requires restoring the archived browser registrations.
const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { chromium } = require('playwright');

const output = join(tmpdir(), 'climate-oras5');
mkdirSync(output, { recursive: true });

// Synthetic seasonal test data, intercepted in the browser only, never published.
const fixture = {
  version: 1, source: 'ECMWF ORAS5', dataset: 'reanalysis-oras5', units: '1000 km3',
  method: 'monthly-mean-thickness-concentration-area-v1',
  grid: { name: 'ORCA025', shape: [1021, 1442], sha256: 'a'.repeat(64) },
  records: Array.from({ length: 68 * 12 + 8 }, (_, index) => ({
    year: 1958 + Math.floor(index / 12), month: index % 12 + 1,
    product: index < 57 * 12 ? 'consolidated' : 'operational',
    north: 29 + 6 * Math.cos(index / 12 * Math.PI * 2) - index / 160,
    south: 9 - 7 * Math.cos(index / 12 * Math.PI * 2) + index / 400,
  })),
};

const hooks = `
window.oras5Test = {
  ready: () => Boolean(spiralMesh && monthLabelsGroup?.children.length === 12),
  show(graph = false) {
    if (isAnimating) toggleAnimation();
    setPlaybackPosition(totalIndices);
    layoutTransition = null;
    layoutMix = graph ? 1 : 0;
    applyLayout();
    cameraResetAnimation = null;
    controls.enableDamping = false;
    activeCamera.position.copy(controls.target).add(new THREE.Vector3(0, 200, 0.001));
    controls.update();
  },
  refresh: () => fetchRemoteData(),
  state() {
    renderer.render(scene, activeCamera);
    const canvas = document.createElement('canvas');
    canvas.width = 320; canvas.height = 240;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(renderer.domElement, 0, 0, 320, 240);
    const pixels = ctx.getImageData(0, 0, 320, 240).data;
    let litPixels = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 20) litPixels++;
    }
    return { dataset: currentDatasetKey, mesh: spiralMesh.uuid,
      finite: spiralMesh.geometry.attributes.position.array.every(Number.isFinite), litPixels,
      camera: activeCamera.position.toArray(), stops: timelineStops.length,
      monthRadius: Math.hypot(monthLabelsGroup.children[0].position.x, monthLabelsGroup.children[0].position.z),
      metric: document.getElementById('infoTemp').textContent,
      legend: Array.from(document.querySelectorAll('.legend-labels span'), el => el.textContent) };
  }
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
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/index.html', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()).replace('// --- Configuration ---',
          hooks + '// --- Configuration ---') });
      });
      let mode = 'missing';
      let requests = 0;
      await page.route('**/data/oras5-sea-ice-volume.json', route => {
        requests++;
        return route.fulfill({ status: mode === 'missing' ? 404 : 200, contentType: 'application/json',
          body: mode === 'valid' ? JSON.stringify(fixture) : '{}' });
      });
      for (const state of ['missing', 'invalid', 'valid']) {
        mode = state;
        await page.goto('http://127.0.0.1:8000/index.html');
        await page.waitForFunction(() => window.oras5Test?.ready());
        if (state === 'valid') {
          await page.waitForFunction(() => document.querySelector('#datasetSelect option[value="antarcticoras5"]'));
        } else {
          await page.waitForTimeout(300);
          assert.equal(await page.locator('#datasetSelect option[value$="oras5"]').count(), 0);
        }
      }
      const initialRequests = requests;
      let referenceRadius;
      for (const key of ['arcticoras5', 'antarcticoras5']) {
        await page.selectOption('#datasetSelect', key, { force: true });
        await page.waitForFunction(key => oras5Test.state().dataset === key && oras5Test.state().stops >= 300, key);
        await page.evaluate(() => oras5Test.show());
        const state = await page.evaluate(() => oras5Test.state());
        assert.ok(state.finite && state.litPixels > 300, 'ORAS5 canvas is blank or invalid');
        assert.match(state.metric, /10\u00b3 km\u00b3/);
        assert.deepEqual(state.legend, ['0', '10', '20', '30', '40', '50', '60']);
        referenceRadius ??= state.monthRadius;
        assert.equal(state.monthRadius, referenceRadius);
        await page.click('#infoBtn');
        await page.screenshot({ path: join(output, `${name}-${key}.png`) });
        await page.evaluate(() => oras5Test.show(true));
        assert.ok((await page.evaluate(() => oras5Test.state())).litPixels > 300);
        await page.screenshot({ path: join(output, `${name}-${key}-unwrapped.png`) });
        await page.click('#infoBtn');
        await page.keyboard.press('3');
        await page.waitForTimeout(600);
        assert.notDeepEqual((await page.evaluate(() => oras5Test.state())).camera, state.camera);
        await page.keyboard.press('1');
        await page.waitForTimeout(600);
      }
      assert.equal(requests, initialRequests, 'Switching hemispheres should reuse the validated snapshot');
      mode = 'invalid';
      const mesh = (await page.evaluate(() => oras5Test.state())).mesh;
      await page.evaluate(() => oras5Test.refresh());
      await page.waitForTimeout(500);
      assert.equal((await page.evaluate(() => oras5Test.state())).mesh, mesh, 'Bad refresh replaced valid geometry');
      mode = 'valid';
      await page.evaluate(() => oras5Test.refresh());
      await page.waitForFunction(mesh => oras5Test.state().mesh !== mesh, mesh);
      await page.click('#settingsBtn');
      assert.ok(await page.locator('#settingsPanel').evaluate(el => el.scrollWidth <= el.clientWidth));
      await page.screenshot({ path: join(output, `${name}-settings.png`) });
      assert.deepEqual(errors, []);
      console.log(name + ': missing/invalid snapshots, both hemispheres, refresh, controls and canvas checks passed');
      await context.close();
    }
    console.log('Synthetic-fixture screenshots: ' + output);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

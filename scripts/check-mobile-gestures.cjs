const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { chromium } = require('playwright');

const output = join(tmpdir(), 'climate-mobile-gestures');
mkdirSync(output, { recursive: true });
const hooks = `
window.gestureTest = {
  ready: () => Boolean(spiralMesh && controls),
  prepare() {
    if (isAnimating) toggleAnimation();
    cameraController.cancelAnimation();
    controls.enableDamping = false;
    setPlaybackPosition(totalIndices);
  },
  preview: () => videoController.startPreview(),
  stopPreview: () => videoController.stopPreview(),
  state: () => ({ mix: layoutMix, moving: Boolean(layoutTransition),
    cameraMoving: cameraController.isAnimating, previewing: videoController.isPreviewing,
    zoom: activeCamera.zoom, polar: controls.getPolarAngle(),
    position: activeCamera.position.toArray(), quaternion: activeCamera.quaternion.toArray(),
    enabled: controls.enabled, index: animationIndex, finite: spiralMesh.geometry.attributes.position.array.every(Number.isFinite) }),
  pixels() {
    renderer.render(scene, activeCamera);
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
    const context = canvas.getContext('2d'); context.drawImage(renderer.domElement, 0, 0, 320, 240);
    const pixels = context.getImageData(0, 0, 320, 240).data;
    let lit = 0;
    for (let i = 0; i < pixels.length; i += 4) if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 20) lit++;
    return lit;
  }
};
`;

const state = page => page.evaluate(() => gestureTest.state());
const nearArray = (actual, expected, label) => {
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-8, label));
};

function touchPoints(viewport, count, scale = 1, offsetX = 0) {
  const x = viewport.width / 2 + offsetX, y = viewport.height / 2;
  return [[0, -50], [-50, 30], [50, 30]].slice(0, count).map(([dx, dy], i) => ({
    id: i + 1, x: x + dx * scale, y: y + dy * scale, radiusX: 4, radiusY: 4, force: 1
  }));
}

async function pinch(page, session, viewport, count, factor) {
  const samples = [];
  for (let fingers = 1; fingers <= count; fingers++) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touchPoints(viewport, fingers) });
  }
  for (let frame = 1; frame <= 6; frame++) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove',
      touchPoints: touchPoints(viewport, count, 1 + (factor - 1) * frame / 6) });
    await page.waitForTimeout(20);
    samples.push(await state(page));
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  return samples;
}

async function settle(page, mix) {
  await page.waitForFunction(mix => !gestureTest.state().moving && gestureTest.state().mix === mix, mix);
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
  try {
    for (const [name, viewport] of Object.entries({ mobile: { width: 390, height: 844 },
      landscape: { width: 844, height: 390 }, desktop: { width: 1280, height: 800 },
      'narrow-desktop': { width: 390, height: 844 } })) {
      const mobile = name === 'mobile' || name === 'landscape';
      const context = await browser.newContext({ viewport, hasTouch: mobile, isMobile: mobile,
        deviceScaleFactor: mobile ? 2 : 1, serviceWorkers: 'block' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/index.html', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()).replace('// --- Configuration ---',
          hooks + '// --- Configuration ---') });
      });
      await page.goto('http://127.0.0.1:8000/index.html');
      await page.waitForFunction(() => window.gestureTest?.ready());
      await page.evaluate(() => gestureTest.prepare());
      assert.equal(await page.evaluate(() => matchMedia('(hover: none) and (pointer: coarse)').matches), mobile);

      const settings = page.locator('#settingsPanel');
      if (mobile) await page.locator('#settingsBtn').tap();
      else await page.locator('#settingsBtn').click();
      assert.equal(await settings.isVisible(), true);
      if (mobile) await page.locator('.layout-modes label').first().tap();
      else await page.locator('.layout-modes label').first().click();
      assert.equal(await settings.isVisible(), true, 'Taps within Settings must not close it');
      if (mobile) await page.touchscreen.tap(10, 50);
      else await page.mouse.click(10, 50);
      assert.equal(await settings.isVisible(), !mobile, 'Only touch-first devices dismiss Settings outside');

      if (mobile) {
        await page.locator('#settingsBtn').tap();
        assert.equal(await settings.isVisible(), true, 'The opening tap must not immediately dismiss Settings');
        await page.locator('#settingsBtn').tap();
        assert.equal(await settings.isVisible(), false);
        const session = await context.newCDPSession(page);
        const before = await state(page);
        const openingSamples = await pinch(page, session, viewport, 3, 1.5);
        const opening = await state(page);
        assert.ok(openingSamples.some(sample => sample.moving && sample.mix > 0 && sample.mix < 1),
          'Unwrapping must animate: ' + JSON.stringify(opening));
        assert.equal(await page.locator('input[name="chartLayout"][value="graph"]').isChecked(), true);
        await settle(page, 1);
        const unwrapped = await state(page);
        assert.equal(unwrapped.zoom, before.zoom, 'Three fingers must not zoom the camera');
        nearArray(unwrapped.position, before.position, 'Three fingers must not move the camera');
        nearArray(unwrapped.quaternion, before.quaternion, 'Three fingers must not reset the camera');
        assert.equal(unwrapped.enabled, true);
        assert.equal(unwrapped.index, before.index);
        assert.equal(unwrapped.finite, true);
        assert.ok(await page.evaluate(() => gestureTest.pixels()) > 300);
        await page.screenshot({ path: join(output, name + '-unwrapped.png') });

        await pinch(page, session, viewport, 3, 0.5);
        await settle(page, 0);
        assert.equal(await page.locator('input[name="chartLayout"][value="spiral"]').isChecked(), true);
        await page.screenshot({ path: join(output, name + '-spiral.png') });

        await pinch(page, session, viewport, 2, 1.5);
        const zoomed = await state(page);
        assert.equal(zoomed.mix, 0);
        assert.ok(zoomed.zoom > before.zoom * 1.2, 'Two-finger camera zoom must still work');
        const start = touchPoints(viewport, 1);
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: start });
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: start.map(point =>
          ({ ...point, x: point.x + 50, y: point.y - 60 })) });
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        assert.ok((await state(page)).polar > 0.1, 'One-finger rotation must still work');
        await page.touchscreen.tap(viewport.width / 2, viewport.height / 2);
        await page.waitForTimeout(70);
        await page.touchscreen.tap(viewport.width / 2, viewport.height / 2);
        await page.waitForFunction(() => !gestureTest.state().cameraMoving && gestureTest.state().polar < 0.001);
        assert.equal((await state(page)).zoom, 1, 'Double-tap reset must still work after multi-touch');

        await page.emulateMedia({ reducedMotion: 'reduce' });
        await pinch(page, session, viewport, 3, 1.5);
        const reduced = await state(page);
        assert.equal(reduced.mix, 1);
        assert.equal(reduced.moving, false);
        await pinch(page, session, viewport, 3, 0.5);
        await settle(page, 0);

        await page.evaluate(() => {
          document.getElementById('videoTransition').value = '10';
          gestureTest.preview();
        });
        assert.equal((await state(page)).previewing, true);
        await pinch(page, session, viewport, 3, 1.5);
        assert.equal((await state(page)).mix, 0, 'Gestures must not interfere with a video preview');
        assert.equal(await page.locator('input[name="chartLayout"][value="spiral"]').isChecked(), true);
        await page.evaluate(() => gestureTest.stopPreview());
        await pinch(page, session, viewport, 3, 1.5);
        await settle(page, 1);
        await session.detach();
      } else {
        await page.locator('.layout-modes label').filter({ hasText: /^Unwrapped$/ }).click();
        await settle(page, 1);
        assert.equal(await settings.isVisible(), true);
        assert.ok(await page.evaluate(() => gestureTest.pixels()) > 300);
        await page.screenshot({ path: join(output, name + '-settings.png') });
      }
      assert.deepEqual(errors, []);
      await context.close();
      console.log(name + ': gestures, camera controls and Settings dismissal passed');
    }
    console.log('Screenshots: ' + output);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

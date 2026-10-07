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
    // Keep native touch timing reliable when Chrome renders through SwiftShader.
    document.getElementById('smoothSpiralToggle').checked = false;
    updateDataVisualization();
    renderer.setPixelRatio(0.5);
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (isAnimating) toggleAnimation();
    cameraController.cancelAnimation();
    controls.enableDamping = false;
    setPlaybackPosition(totalIndices);
  },
  preview: () => videoController.startPreview(),
  stopPreview: () => videoController.stopPreview(),
  state: () => ({ mix: layoutMix, moving: Boolean(layoutTransition),
    cameraMoving: cameraController.isAnimating, previewing: videoController.isPreviewing,
    zoom: activeCamera.zoom, polar: controls.getPolarAngle(), azimuth: controls.getAzimuthalAngle(),
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

async function doubleTwoFingerTap(page, session, viewport, reverse = false) {
  const points = touchPoints(viewport, 2);
  for (let tap = 0; tap < 2; tap++) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points.slice(0, 1) });
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [points[reverse ? 0 : 1]] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    if (tap === 0) await page.waitForTimeout(70);
  }
}

async function cameraView(page, polar, azimuth = 0) {
  await page.waitForFunction(({ polar, azimuth }) => {
    const state = gestureTest.state();
    const yaw = Math.atan2(Math.sin(state.azimuth - azimuth), Math.cos(state.azimuth - azimuth));
    return !state.cameraMoving && Math.abs(state.polar - polar) < 0.001
      && (polar === 0 || Math.abs(yaw) < 0.001);
  }, { polar, azimuth });
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
      await page.locator('#viewSettings > summary').click();
      for (const [view, polar, azimuth] of [['front', Math.PI / 2, 0], ['right', Math.PI / 2, Math.PI / 2],
        ['back', Math.PI / 2, Math.PI], ['left', Math.PI / 2, -Math.PI / 2], ['top', 0, 0]]) {
        await page.locator('#cameraViewSelect').selectOption(view);
        await cameraView(page, polar, azimuth);
        assert.equal(await page.locator('#cameraViewSelect').inputValue(), '', 'View menu offers commands, not stale camera state');
        assert.equal(await settings.isVisible(), true);
      }
      assert.equal(await settings.evaluate(element => element.scrollWidth <= element.clientWidth), true,
        'Camera view control must not cause horizontal overflow');
      await page.screenshot({ path: join(output, name + '-camera-settings.png') });
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

        for (const [index, azimuth] of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0].entries()) {
          await doubleTwoFingerTap(page, session, viewport, index % 2 === 0);
          await cameraView(page, Math.PI / 2, azimuth);
          assert.equal((await state(page)).index, before.index, 'Camera gestures must not change the data timeline');
        }
        assert.ok(await page.evaluate(() => gestureTest.pixels()) > 300);
        await page.screenshot({ path: join(output, name + '-two-finger-front.png') });
        await page.touchscreen.tap(viewport.width / 2, viewport.height / 2);
        await page.waitForTimeout(70);
        await page.touchscreen.tap(viewport.width / 2, viewport.height / 2);
        await cameraView(page, 0);

        await page.emulateMedia({ reducedMotion: 'reduce' });
        await pinch(page, session, viewport, 3, 1.5);
        const reduced = await state(page);
        assert.equal(reduced.mix, 1);
        assert.equal(reduced.moving, false);
        await pinch(page, session, viewport, 3, 0.5);
        await settle(page, 0);
        await doubleTwoFingerTap(page, session, viewport);
        await cameraView(page, Math.PI / 2, 0);
        assert.equal((await state(page)).cameraMoving, false);

        await page.evaluate(() => {
          document.getElementById('videoTransition').value = '10';
          gestureTest.preview();
        });
        assert.equal((await state(page)).previewing, true);
        await pinch(page, session, viewport, 3, 1.5);
        await doubleTwoFingerTap(page, session, viewport);
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

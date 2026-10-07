const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { chromium } = require('playwright');

const output = join(tmpdir(), 'climate-keyboard-shortcuts');
mkdirSync(output, { recursive: true });
const hooks = `
window.keyboardTest = {
  ready: () => Boolean(spiralMesh && timelineStops.length),
  prepare() {
    document.getElementById('smoothSpiralToggle').checked = false;
    updateDataVisualization();
    renderer.setPixelRatio(1);
    renderer.setSize(window.innerWidth, window.innerHeight);
    monthsPerFrame = 1;
    setPlaybackPosition(timelineStops[Math.floor(timelineStops.length / 2)]);
  },
  playAt(index) { setPlaybackPosition(index); toggleAnimation(); },
  pauseAt: index => setPlaybackPosition(index),
  stops: () => [...timelineStops],
  calendarStops: () => timelineStops.map(index => ({ index, month: Math.floor(
    generatedGeometryData[Math.floor(index / (CONFIG.radialSegments * 6))].decimalYear * 12 + 1e-5) })),
  preview() {
    document.getElementById('videoCamera').value = 'current';
    document.querySelector('.video-step-view').value = 'pause';
    document.querySelector('.video-pause-seconds').value = '30';
    videoController.startPreview();
  },
  stopPreview: () => videoController.stopPreview(),
  state: () => ({ index: animationIndex, playing: isAnimating, total: totalIndices,
    mix: layoutMix, moving: Boolean(layoutTransition), busy: videoController.isBusy,
    layout: document.querySelector('input[name="chartLayout"]:checked').value,
    settings: document.getElementById('settingsPanel').classList.contains('visible'),
    info: document.getElementById('infoPanel').classList.contains('visible'),
    focus: document.activeElement.id, polar: controls.getPolarAngle(), azimuth: controls.getAzimuthalAngle() }),
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
document.addEventListener('keydown', () => { keyboardTest.beforeKey = keyboardTest.state(); }, true);
`;
const state = page => page.evaluate(() => keyboardTest.state());
const blur = page => page.evaluate(() => document.activeElement.blur());
const settle = (page, mix) => page.waitForFunction(mix => !keyboardTest.state().moving && keyboardTest.state().mix === mix, mix);

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
  try {
    for (const [name, viewport] of Object.entries({ desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 } })) {
      const context = await browser.newContext({ viewport, hasTouch: name === 'mobile', isMobile: name === 'mobile',
        serviceWorkers: 'block' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/index.html', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()).replace('// --- Configuration ---', hooks + '// --- Configuration ---') });
      });
      await page.goto('http://127.0.0.1:8000/index.html');
      await page.waitForFunction(() => window.keyboardTest?.ready());
      await page.evaluate(() => keyboardTest.prepare());
      const stops = await page.evaluate(() => keyboardTest.stops());
      const calendarStops = await page.evaluate(() => keyboardTest.calendarStops());

      await page.keyboard.press('Enter');
      await page.waitForFunction(() => keyboardTest.state().mix > 0 && keyboardTest.state().mix < 1);
      await page.keyboard.press('Enter');
      await settle(page, 0);
      await page.keyboard.press('Enter'); await settle(page, 1);
      assert.deepEqual(await page.evaluate(() => keyboardTest.stops()), stops, 'Unwrapping must not change monthly observations');
      assert.ok(await page.evaluate(() => keyboardTest.pixels()) > 300);
      await page.screenshot({ path: join(output, name + '-unwrapped.png') });

      await page.keyboard.press('Space');
      assert.equal((await state(page)).playing, true);
      await page.keyboard.press('Space');
      assert.equal((await state(page)).playing, false);
      for (const [key, direction] of [['Comma', -1], ['Period', 1]]) {
        for (const playing of [false, true]) {
          await page.evaluate(({ playing }) => {
            const stops = keyboardTest.stops();
            const index = stops[Math.floor(stops.length / 2)] + 1;
            if (playing) keyboardTest.playAt(index); else keyboardTest.pauseAt(index);
          }, { playing });
          await blur(page);
          await page.keyboard.press(key);
          const before = await page.evaluate(() => keyboardTest.beforeKey);
          const after = await state(page);
          const expected = direction < 0 ? stops.findLast(stop => stop < before.index - 0.5)
            : stops.find(stop => stop > before.index + 0.5);
          assert.equal(after.index, expected, key + ' must land on the adjacent exact month');
          assert.equal(after.playing, false, 'Stepping must pause running playback');
          assert.equal(before.playing, playing);
        }
      }
      for (const [id, direction] of [['stepBackBtn', -1], ['stepForwardBtn', 1]]) {
        await page.evaluate(() => {
          const stops = keyboardTest.stops(); keyboardTest.playAt(stops[Math.floor(stops.length / 2)]);
        });
        // Playing mode hides these controls, but they must share the pause-and-step behavior.
        assert.equal(await page.locator('#' + id).isDisabled(), false);
        const { before, after } = await page.evaluate(id => {
          const before = keyboardTest.state(); document.getElementById(id).click();
          return { before, after: keyboardTest.state() };
        }, id);
        const expected = direction < 0 ? stops.findLast(stop => stop < before.index - 0.5)
          : stops.find(stop => stop > before.index + 0.5);
        assert.equal(after.playing, false); assert.equal(after.index, expected);
      }
      for (const [key, direction] of [['Comma', -1], ['Period', 1]]) {
        const middle = Math.floor(stops.length / 2);
        await page.evaluate(index => keyboardTest.pauseAt(index), stops[middle]);
        await blur(page);
        await page.keyboard.press('Shift+' + key);
        assert.equal((await state(page)).index, stops[middle + direction * 12], 'Shift must step exactly one calendar year');
        assert.equal(calendarStops[middle + direction * 12].month - calendarStops[middle].month, direction * 12);
        await page.evaluate(index => keyboardTest.pauseAt(index), stops[middle]);
        await page.keyboard.down(key); await page.keyboard.down(key); await page.keyboard.down(key);
        await page.keyboard.up(key);
        assert.equal((await state(page)).index, stops[middle + direction * 3], 'Native key repeat must keep stepping');
        const released = (await state(page)).index;
        await page.waitForTimeout(200);
        assert.equal((await state(page)).index, released);
      }
      for (const [id, direction] of [['stepBackBtn', -1], ['stepForwardBtn', 1]]) {
        const middle = Math.floor(stops.length / 2);
        await page.evaluate(index => keyboardTest.pauseAt(index), stops[middle]);
        await blur(page);
        await page.locator('#' + id).click({ modifiers: ['Shift'] });
        assert.equal((await state(page)).index, stops[middle + direction * 12], 'Shift-click must not add a release step');
        await page.evaluate(index => keyboardTest.pauseAt(index), stops[middle]);
        const bounds = await page.locator('#' + id).boundingBox();
        const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
        let session;
        if (name === 'mobile') {
          session = await context.newCDPSession(page);
          await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, ...point }] });
        } else {
          await page.mouse.move(point.x, point.y); await page.mouse.down();
        }
        assert.equal((await state(page)).index, stops[middle + direction], 'Pressing must immediately step once');
        await page.waitForFunction(({ start, direction }) => direction * (keyboardTest.state().index - start) > 100,
          { start: stops[middle + direction], direction });
        if (session) await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        else await page.mouse.up();
        const released = (await state(page)).index;
        await page.waitForTimeout(350);
        assert.equal((await state(page)).index, released, 'Release must stop repetition without an extra click');
        assert.equal((await state(page)).playing, false);
        if (session) await session.detach();
      }
      if (name === 'desktop') {
        const middle = Math.floor(stops.length / 2);
        await page.evaluate(index => keyboardTest.pauseAt(index), stops[middle]);
        const bounds = await page.locator('#stepForwardBtn').boundingBox();
        await page.keyboard.down('Shift');
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        await page.mouse.down();
        await page.waitForFunction(index => keyboardTest.state().index >= index, stops[middle + 24]);
        await page.mouse.up(); await page.keyboard.up('Shift');
        const released = (await state(page)).index;
        assert.equal((stops.indexOf(released) - middle) % 12, 0, 'Shift-hold must repeat only calendar-year steps');
        await page.waitForTimeout(350); assert.equal((await state(page)).index, released);

        await page.evaluate(index => keyboardTest.pauseAt(index), stops[middle]);
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down();
        await page.mouse.move(10, 10);
        const left = (await state(page)).index;
        await page.waitForTimeout(600); assert.equal((await state(page)).index, left, 'Dragging off must stop repetition');
        await page.mouse.up();
      }
      await page.evaluate(index => keyboardTest.pauseAt(index), stops.at(-2));
      const endBounds = await page.locator('#stepForwardBtn').boundingBox();
      await page.mouse.move(endBounds.x + endBounds.width / 2, endBounds.y + endBounds.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(650);
      await page.mouse.up();
      assert.equal((await state(page)).index, stops.at(-1), 'Holding at the endpoint must stop without wrapping');
      await blur(page); await page.keyboard.press('Home');
      assert.equal((await state(page)).index, 0);
      await page.keyboard.press('Comma'); assert.equal((await state(page)).index, 0);
      await page.keyboard.press('End');
      assert.equal((await state(page)).index, (await state(page)).total);
      await page.keyboard.press('Period'); assert.equal((await state(page)).playing, false);

      await page.keyboard.press('s'); assert.equal((await state(page)).settings, true);
      await page.keyboard.press('s'); assert.equal((await state(page)).settings, false);
      await page.keyboard.press('i'); assert.equal((await state(page)).info, true);
      await page.keyboard.press('s');
      assert.equal((await state(page)).info, false); assert.equal((await state(page)).settings, true);
      await page.keyboard.press('Escape');
      assert.equal((await state(page)).settings, false); assert.equal((await state(page)).focus, 'settingsBtn');
      await page.keyboard.press('s'); assert.equal((await state(page)).settings, true);
      await page.keyboard.press('s'); assert.equal((await state(page)).settings, false);
      await blur(page); await page.keyboard.press('i'); await page.keyboard.press('Escape');
      assert.equal((await state(page)).info, false); assert.equal((await state(page)).focus, 'infoBtn');

      await page.locator('#settingsBtn').focus();
      await page.keyboard.press('Enter'); assert.equal((await state(page)).settings, true);
      assert.equal((await state(page)).layout, 'graph', 'Enter on a button must activate it, not unwrap');
      await page.keyboard.press('Space'); assert.equal((await state(page)).settings, false);
      assert.equal((await state(page)).playing, false, 'Space on a focused button must retain native activation');
      await page.keyboard.press('Enter');
      await page.locator('#viewSettings > summary').click();
      await page.locator('#spacingSlider').focus();
      const spacing = await page.locator('#spacingSlider').inputValue();
      const unchanged = await state(page);
      for (const key of ['Enter', 'Space', 'Comma', 'Period', 'Home', 'End', 's', 'i']) await page.keyboard.press(key);
      const focused = await state(page);
      for (const property of ['layout', 'playing', 'index', 'settings', 'info']) assert.equal(focused[property], unchanged[property]);
      await page.keyboard.press('Escape');
      assert.equal((await state(page)).settings, false); assert.equal((await state(page)).focus, 'settingsBtn');
      await page.evaluate(value => {
        const slider = document.getElementById('spacingSlider');
        slider.value = value; slider.dispatchEvent(new Event('input', { bubbles: true }));
      }, spacing);
      await blur(page);
      await page.keyboard.press('s');
      await page.locator('#exportSettings > summary').click();
      await page.locator('#videoAdvanced > summary').click();
      await page.locator('#videoResolution').selectOption('custom');
      await page.locator('#videoWidth').fill('2048');
      const editing = await state(page);
      for (const key of ['Enter', 'Space', 'Comma', 'Period', 'Home', 'End', 's', 'i']) await page.keyboard.press(key);
      const edited = await state(page);
      for (const property of ['index', 'playing', 'layout', 'settings', 'info']) assert.equal(edited[property], editing[property]);
      assert.equal(await page.locator('#videoWidth').inputValue(), '2048');
      await page.keyboard.press('Escape');
      assert.equal((await state(page)).settings, false); assert.equal((await state(page)).focus, 'settingsBtn');
      await blur(page);
      const beforeModified = await state(page);
      for (const key of ['Control+Enter', 'Alt+Period', 'Shift+Enter', 'Meta+s']) await page.keyboard.press(key);
      assert.equal((await state(page)).layout, beforeModified.layout);
      assert.equal((await state(page)).index, beforeModified.index);
      assert.equal((await state(page)).settings, false);

      await page.keyboard.press('2');
      await page.waitForFunction(() => Math.abs(keyboardTest.state().polar - Math.PI / 2) < 0.001);
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(() => Math.abs(keyboardTest.state().azimuth - Math.PI / 2) < 0.001);
      await page.keyboard.press('1');
      await page.waitForFunction(() => keyboardTest.state().polar < 0.001);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.keyboard.press('Enter');
      assert.equal((await state(page)).mix, 0); assert.equal((await state(page)).moving, false);
      assert.ok(await page.evaluate(() => keyboardTest.pixels()) > 300);
      await page.screenshot({ path: join(output, name + '-spiral.png') });

      await page.evaluate(() => keyboardTest.preview());
      const preview = await state(page);
      assert.equal(preview.busy, true);
      for (const key of ['Enter', 'Space', 'Comma', 'Period', 'Home', 'End', 's', 'i']) await page.keyboard.press(key);
      const locked = await state(page);
      for (const property of ['index', 'layout', 'settings', 'info', 'busy']) assert.equal(locked[property], preview[property], property);
      await page.keyboard.press('Shift+Escape');
      assert.equal((await state(page)).busy, true, 'Modified Escape must not stop a preview');
      await page.keyboard.press('Escape');
      assert.equal((await state(page)).busy, false, 'Escape must retain its existing preview-stop behavior');
      assert.deepEqual(errors, []);
      await context.close();
      console.log(name + ': shortcuts, exact month stepping, focus, native controls, and preview locks passed');
    }
    console.log('Screenshots: ' + output);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

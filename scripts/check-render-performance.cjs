const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { installVideoSessionHook } = require('./browser-test-hooks.cjs');

const hooks = `
window.renderTest = {
  ready: () => Boolean(spiralMesh && timelineStops.length),
  prepare() {
    setPlaybackPosition(timelineStops[Math.floor(timelineStops.length / 2)]);
    const gl = renderer.getContext(), upload = gl.bufferSubData.bind(gl);
    const render = renderer.render.bind(renderer);
    gl.bufferSubData = (target, offset, source, start, count) => {
      if (source.buffer === this.colors().buffer) this.bytes += count === undefined
        ? source.byteLength : count * source.BYTES_PER_ELEMENT;
      return start === undefined ? upload(target, offset, source) : upload(target, offset, source, start, count);
    };
    renderer.render = (...args) => { render(...args); this.draws++; };
  },
  colors: () => spiralLine?.geometry.attributes.instanceColorStart.data.array ?? spiralMesh.geometry.attributes.color.array,
  draws: 0, bytes: 0,
  state() { return { draws: this.draws, bytes: this.bytes, full: this.colors().byteLength,
    idle: frameRequest === null, index: animationIndex, zoom: activeCamera.zoom, mix: layoutMix,
    front: Math.abs(controls.getPolarAngle() - Math.PI / 2) < 1e-4,
    recording: videoController.testRecording?.frameIndex, status: document.getElementById('videoExportStatus').textContent }; },
  fixture() {
    updateDataVisualization(parseDatasetData(currentDataText, currentDatasetKey).slice(-4));
    setPlaybackPosition(totalIndices);
  }
};
`;

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
  try {
    for (const [name, viewport] of Object.entries({ desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 } })) {
      const context = await browser.newContext({ viewport, isMobile: name === 'mobile', hasTouch: name === 'mobile',
        serviceWorkers: 'block', acceptDownloads: true });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await installVideoSessionHook(page);
      await page.route('**/index.html', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()).replace('// --- Configuration ---', hooks + '// --- Configuration ---') });
      });
      await page.goto('http://127.0.0.1:8000/index.html');
      await page.waitForFunction(() => window.renderTest?.ready());
      await page.evaluate(() => renderTest.prepare());
      const state = () => page.evaluate(() => renderTest.state());
      const idle = () => page.waitForFunction(() => renderTest.state().idle, null, { timeout: 5000 }).catch(async error => {
        throw new Error(`Viewer did not settle: ${JSON.stringify(await state())}. Page errors: ${errors.join('; ')}`, { cause: error });
      });
      await idle();
      for (const tube of [true, false]) {
        if (!tube) {
          await page.locator('#tubeToggle').evaluate(input => input.click());
          await idle();
        }
        const before = await state();
        await page.waitForTimeout(200);
        assert.deepEqual(await state(), before, 'A still scene must not redraw');
        await page.keyboard.press('.');
        await idle();
        const after = await state(), bytes = after.bytes - before.bytes;
        assert.ok(after.index > before.index && after.draws > before.draws, 'Stepping must wake the renderer');
        assert.ok(bytes > 0 && bytes < after.full / 10, `Expected partial color upload, got ${bytes}/${after.full} bytes`);
        console.log(`${name} ${tube ? 'tube' : 'wide line'}: ${bytes} of ${after.full} color bytes uploaded for a step`);
      }

      let before = await state();
      if (name === 'desktop') {
        await page.mouse.move(viewport.width / 2, viewport.height / 2);
        await page.mouse.wheel(0, -120);
        await page.waitForFunction(zoom => renderTest.state().zoom !== zoom, before.zoom);
        await idle();
        assert.ok((await state()).draws > before.draws, 'OrbitControls input must wake the renderer');
      }
      before = await state();
      await page.keyboard.press('2');
      await page.waitForFunction(() => renderTest.state().front && renderTest.state().idle);
      assert.ok((await state()).draws > before.draws, 'Animated camera changes must wake the renderer');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => renderTest.state().mix === 1 && renderTest.state().idle);
      before = await state();
      await page.locator('#helpersToggle').evaluate(input => input.click());
      await idle();
      assert.ok((await state()).draws > before.draws, 'Annotation changes must wake the renderer');
      before = await state();
      await page.locator('#colorMode').evaluate(input => {
        input.value = 'year'; input.dispatchEvent(new Event('change'));
      });
      await idle();
      assert.ok((await state()).bytes - before.bytes > before.full * 0.9, 'Palette changes must upload all visible colors');
      await page.keyboard.press('Space');
      await page.waitForFunction(index => renderTest.state().index > index, before.index);
      await page.keyboard.press('Space');
      await idle();

      await page.evaluate(() => renderTest.fixture());
      await idle();
      await page.locator('#videoPreviewBtn').evaluate(button => button.click());
      await page.waitForFunction(() => !renderTest.state().idle);
      await page.locator('#videoPreviewBtn').evaluate(button => button.click());
      await idle();
      await page.evaluate(() => {
        document.getElementById('settingsPanel').classList.add('visible');
        document.getElementById('exportSettings').open = true;
        document.getElementById('videoResolution').value = 'custom';
        document.getElementById('videoWidth').value = '640';
        document.getElementById('videoHeight').value = '360';
        document.getElementById('videoViewList').replaceChildren();
      });
      await page.click('#videoExportBtn');
      await page.waitForFunction(() => renderTest.state().recording >= 5);
      await page.click('#videoExportBtn');
      await idle();
      assert.match((await state()).status, /cancelled/i);
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`${name}: idle, motion, settings, preview and export checks passed`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

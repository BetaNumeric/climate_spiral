import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { installVideoSessionHook } from './browser-test-hooks.cjs';
import { chooseReadmeCameraPaths } from './readme-video.mjs';
import { configureReadmeVideo } from './configure-readme-video.mjs';

const output = join(tmpdir(), 'climate-readme-camera-paths');
mkdirSync(output, { recursive: true });
const hooks = `
window.pathTest = {
  ready: () => Boolean(spiralMesh && timelineStops.length),
  prepare() { setPlaybackPosition(totalIndices); },
  plan: () => videoController.getFramePlan(),
  state: () => ({ mix: layoutMix, polar: controls.getPolarAngle(), azimuth: controls.getAzimuthalAngle(),
    position: activeCamera.position.toArray(), quaternion: activeCamera.quaternion.toArray(),
    target: controls.target.toArray(), zoom: activeCamera.zoom }),
  sample(moveIndex, fraction) {
    const session = videoController.testPreview;
    if (!session) throw new Error('Preview is not active.');
    const plan = session.framePlan;
    const frame = plan.startHoldFrames + plan.stepFrames.slice(0, moveIndex).reduce((sum, frames) => sum + frames, 0)
      + Math.floor(fraction * (plan.stepFrames[moveIndex] - 1));
    session.startedAt = performance.now() - frame / 30 * 1000;
    videoController.update();
    renderer.render(scene, activeCamera);
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
    const context = canvas.getContext('2d'); context.drawImage(renderer.domElement, 0, 0, 320, 240);
    const pixels = context.getImageData(0, 0, 320, 240).data;
    let lit = 0;
    for (let i = 0; i < pixels.length; i += 4) if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 20) lit++;
    return { ...this.state(), lit, image: renderer.domElement.toDataURL().split(',')[1] };
  }
};
`;
const views = {
  'spiral-top': [0, 0, 0], 'spiral-front': [0, Math.PI / 2, 0],
  'graph-top': [1, 0, 0], 'graph-front': [1, Math.PI / 2, 0], 'graph-right': [1, Math.PI / 2, Math.PI / 2],
};
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
try {
  for (const [name, viewport] of Object.entries({ desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 } })) {
    const context = await browser.newContext({ viewport, hasTouch: name === 'mobile', isMobile: name === 'mobile', serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await installVideoSessionHook(page);
    await page.route('**/index.html', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()).replace('// --- Configuration ---', hooks + '// --- Configuration ---') });
    });
    await page.goto(process.env.README_VIDEO_BASE_URL || 'http://127.0.0.1:8000/index.html');
    await page.waitForFunction(() => window.pathTest?.ready());
    await page.evaluate(() => pathTest.prepare());
    assert.equal(await page.evaluate(() => document.activeElement.id), '', 'Initialization must not focus a camera-path input');
    await page.click('#settingsBtn');
    assert.equal(await page.locator('#exportSettings').getAttribute('open'), null);
    await page.click('#exportSettings > summary');
    await page.click('#videoAdvanced > summary');
    assert.equal(await page.locator('#videoTransition').inputValue(), '2');
    assert.deepEqual(await page.locator('.video-step-view').evaluateAll(elements => elements.map(element => element.value)),
      ['pause', 'spiral-front', 'pause']);
    assert.deepEqual((await page.evaluate(() => pathTest.plan())).stepFrames, [30, 60, 30]);
    await page.screenshot({ path: join(output, name + '-defaults.png') });
    for (const [slot, path] of Object.entries(chooseReadmeCameraPaths(() => 0))) {
      await configureReadmeVideo(page, path);
      assert.deepEqual((await page.evaluate(() => pathTest.plan())).stepFrames, [30, 60, 30, 60, 30, 60, 30]);
      assert.equal(await page.locator('#videoResolution').inputValue(), '1080p');
      assert.equal(await page.locator('#videoLegendToggle').isChecked(), true);
      assert.equal(await page.locator('#settingsPanel').evaluate(element => element.scrollWidth <= element.clientWidth), true);
      await page.screenshot({ path: join(output, name + '-' + slot + '-settings.png') });
      await page.click('#videoPreviewBtn');
      let current = path.start;
      for (const [index, step] of path.steps.entries()) {
        if (step.type === 'view') {
          const between = await page.evaluate(index => pathTest.sample(index, 0.5), index);
          assert.ok(between.lit > 300, 'Movement must keep the canvas visible');
          current = step.view;
        } else {
          const first = await page.evaluate(index => pathTest.sample(index, 0.2), index);
          const second = await page.evaluate(index => pathTest.sample(index, 0.7), index);
          for (const key of ['position', 'quaternion', 'target', 'zoom', 'mix']) assert.deepEqual(first[key], second[key], 'Pause must not move ' + key);
          const [mix, polar, azimuth] = views[current];
          assert.equal(second.mix, mix);
          assert.ok(Math.abs(second.polar - polar) < 0.001);
          if (polar) assert.ok(Math.abs(second.azimuth - azimuth) < 0.001);
          assert.ok(second.lit > 300);
          writeFileSync(join(output, name + '-' + slot + '-' + current + '.png'), Buffer.from(second.image, 'base64'));
        }
      }
      await page.click('#videoPreviewStop');
      await assert.doesNotReject(() => page.locator('#settingsPanel.visible').waitFor({ state: 'visible' }),
        'Stopping preview must restore Settings, including on mobile');
    }
    assert.deepEqual(errors, []);
    await context.close();
    console.log(name + ': default pauses, both README paths, camera holds, framing, and responsive controls passed');
  }
  console.log('Screenshots: ' + output);
} finally { await browser.close(); }

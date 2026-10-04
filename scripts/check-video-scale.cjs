const assert = require('node:assert/strict');
const { installVideoSessionHook } = require('./browser-test-hooks.cjs');
const { mkdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { chromium } = require('playwright');

const output = join(tmpdir(), 'climate-video-scale');
mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome', headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  try {
    for (const [name, viewport] of Object.entries({
      desktop: { width: 1280, height: 800 },
      mobile: { width: 390, height: 844 },
    })) {
      const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
      const page = await context.newPage();
      await installVideoSessionHook(page);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/index.html', async route => {
        const response = await route.fetch();
        const source = await response.text();
        await route.fulfill({ response, body: source.replace('// --- Configuration ---', `
          import { getVideoLayout } from './video-export.mjs';
          window.scaleTest = {
            drawLegend(width, height) {
              const canvas = document.createElement('canvas');
              canvas.width = width;
              canvas.height = height;
              const layout = getVideoLayout(width, height, true);
              videoController.drawLegend({ canvas, context: canvas.getContext('2d'), layout });
              return { canvas, layout };
            },
            rings() {
              return tempGridGroup.children.map(ring => ({
                mesh: ring.isMesh, type: ring.geometry.type,
                tube: ring.geometry.parameters.radius,
              }));
            },
            rendererState() {
              return {
                ratio: renderer.getPixelRatio(),
                buffer: renderer.getDrawingBufferSize(new THREE.Vector2()).toArray(),
              };
            },
            exportFrame() {
              return videoController.testRecording?.canvas.toDataURL('image/png').split(',')[1] ?? null;
            },
            exportFrameIndex() {
              return videoController.testRecording?.frameIndex ?? 0;
            },
            seekExportToLastDraw() {
              videoController.testRecording.frameIndex = videoController.testRecording.framePlan.startHoldFrames + videoController.testRecording.framePlan.drawSteps - 1;
              videoController.testRecording.nextFrameAt = 0;
              return videoController.testRecording.frameIndex + 1;
            },
          };
          // --- Configuration ---`) });
      });
      await page.goto('http://127.0.0.1:8000/index.html');
      await page.waitForFunction(() => window.scaleTest?.rings().length > 0);
      await page.screenshot({ path: join(output, `${name}.png`) });
      assert.deepEqual(errors, []);
      assert.ok((await page.evaluate(() => window.scaleTest.rings()))
        .every(ring => ring.mesh && ring.type === 'TubeGeometry' && ring.tube > 0));

      if (name === 'desktop') {
        const comparisons = await page.evaluate(() => {
          return [
            ['landscape', 1920, 1080],
            ['portrait', 1080, 1920],
            ['square', 1080, 1080],
          ].map(([preset, width, height]) => {
            const normal = window.scaleTest.drawLegend(width, height);
            const large = window.scaleTest.drawLegend(width * 2, height * 2);
            const reduced = document.createElement('canvas');
            reduced.width = width;
            reduced.height = height;
            reduced.getContext('2d').drawImage(large.canvas, 0, 0, width, height);
            const rect = normal.layout.legend;
            const first = normal.canvas.getContext('2d').getImageData(rect.x, rect.y, rect.width, rect.height).data;
            const second = reduced.getContext('2d').getImageData(rect.x, rect.y, rect.width, rect.height).data;
            let changed = 0;
            for (let index = 0; index < first.length; index += 4) {
              if (Math.max(...[0, 1, 2].map(channel => Math.abs(first[index + channel] - second[index + channel]))) > 30) {
                changed++;
              }
            }
            return {
              preset,
              changedFraction: changed / (first.length / 4),
              preview: preset === 'landscape' ? large.canvas.toDataURL('image/png').split(',')[1] : null,
            };
          });
        });
        writeFileSync(join(output, 'legend-4k.png'), Buffer.from(comparisons[0].preview, 'base64'));
        for (const comparison of comparisons) {
          assert.ok(comparison.changedFraction < 0.02,
            `${comparison.preset} legend diverges after scaling: ${comparison.changedFraction}`);
          console.log(`${comparison.preset} legend difference: ${(comparison.changedFraction * 100).toFixed(2)}%`);
        }

        await page.click('#settingsBtn');
        await page.click('#exportSettings > summary');
        await page.click('#videoAdvanced > summary');
        await page.selectOption('#videoResolution', 'custom');
        await page.fill('#videoWidth', '3840');
        await page.fill('#videoHeight', '2160');
        await page.click('#videoExportBtn');
        await page.waitForFunction(() => window.scaleTest.exportFrameIndex() >= 3, null, { timeout: 60_000 });
        const lastDraw = await page.evaluate(() => window.scaleTest.seekExportToLastDraw());
        await page.waitForFunction(frame => window.scaleTest.exportFrameIndex() >= frame,
          lastDraw, { timeout: 60_000 });
        const frame = await page.evaluate(() => window.scaleTest.exportFrame());
        writeFileSync(join(output, 'video-frame-4k.png'), Buffer.from(frame, 'base64'));
        await page.click('#videoExportBtn');

        const before = await page.evaluate(() => window.scaleTest.rendererState());
        await page.evaluate(() => {
          Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
          window.dispatchEvent(new Event('resize'));
        });
        const after = await page.evaluate(() => window.scaleTest.rendererState());
        assert.equal(after.ratio, 2);
        assert.deepEqual(after.buffer, before.buffer.map(value => value * 2));
      }
      await context.close();
    }
    console.log(`Screenshots: ${output}`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

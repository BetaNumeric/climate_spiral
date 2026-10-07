const assert = require('node:assert/strict');
const { mkdirSync, writeFileSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { chromium } = require('playwright');
const { installVideoSessionHook } = require('./browser-test-hooks.cjs');

const output = join(tmpdir(), 'climate-line-settings');
mkdirSync(output, { recursive: true });
const hooks = `
window.lineTest = {
  ready: () => Boolean(spiralMesh && timelineStops.length),
  prepare() { setPlaybackPosition(timelineStops[Math.floor(timelineStops.length / 2)]); },
  state: () => ({ tube: spiralMesh.visible, width: spiralLine?.material.linewidth, sides: CONFIG.radialSegments,
    playing: isAnimating, progress: animationIndex / totalIndices, mesh: spiralMesh.uuid,
    detail: CONFIG.curveSegments, sampling: pointsPerObservation,
    observations: timelineStops.length, capSides: endCapMesh.geometry.parameters.segments,
    vertices: spiralMesh.geometry.attributes.position.count, samples: generatedGeometryData.length,
    date: generatedGeometryData[Math.floor(animationIndex / (CONFIG.radialSegments * 6))].decimalYear }),
  morph(mix) { layoutTransition = null; layoutMix = mix; applyLayout(); },
  pixels() {
    const hidden = scene.children.filter(object => !object.isLight && object !== spiralMesh && object !== spiralLine);
    const visible = hidden.map(object => object.visible);
    hidden.forEach(object => object.visible = false);
    renderer.render(scene, activeCamera);
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 400;
    const ctx = canvas.getContext('2d'); ctx.drawImage(renderer.domElement, 0, 0, 640, 400);
    const pixels = ctx.getImageData(0, 0, 640, 400).data;
    let lit = 0; for (let i = 0; i < pixels.length; i += 4) if (Math.max(pixels[i], pixels[i+1], pixels[i+2]) > 20) lit++;
    hidden.forEach((object, i) => object.visible = visible[i]);
    return lit;
  },
  topology() {
    spiralLine.sync();
    const center = spiralLine.centerGeometry;
    const start = spiralLine.geometry.attributes.instanceStart;
    const end = spiralLine.geometry.attributes.instanceEnd;
    let count = 0, error = 0;
    for (let i = 0; i < center.index.count; i += 2) {
      const a = center.index.array[i], b = center.index.array[i + 1];
      const pa = new THREE.Vector3().fromBufferAttribute(center.attributes.position, a);
      const pb = new THREE.Vector3().fromBufferAttribute(center.attributes.position, b);
      if (a === b || pa.equals(pb)) continue;
      error = Math.max(error, pa.distanceTo(new THREE.Vector3().fromBufferAttribute(start, count)),
        pb.distanceTo(new THREE.Vector3().fromBufferAttribute(end, count)));
      count++;
    }
    return { count, error, visible: spiralLine.geometry.instanceCount,
      finite: start.data.array.every(Number.isFinite) };
  },
  exportState: () => videoController.testRecording && ({ frame: videoController.testRecording.frameIndex }),
};
`;

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
  try {
    for (const [name, viewport] of Object.entries({ desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 } })) {
      const context = await browser.newContext({ viewport, isMobile: name === 'mobile', hasTouch: name === 'mobile', serviceWorkers: 'block', acceptDownloads: true });
      const page = await context.newPage();
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await installVideoSessionHook(page);
      await page.route('**/index.html', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()).replace('// --- Configuration ---', hooks + '// --- Configuration ---') });
      });
      await page.goto('http://127.0.0.1:8000/index.html');
      await page.waitForFunction(() => window.lineTest?.ready());
      await page.evaluate(() => lineTest.prepare());
      await page.click('#settingsBtn'); await page.click('#viewSettings > summary');
      const original = await page.evaluate(() => lineTest.state());
      assert.equal(original.tube, true); assert.equal(original.sides, 8);
      const slider = page.locator('#thicknessSlider');
      for (const sides of ['4', '12', '24', '8']) {
        await page.selectOption('#tubeSides', sides);
        const state = await page.evaluate(() => lineTest.state());
        assert.equal(state.sides, Number(sides)); assert.equal(state.capSides, Number(sides));
        assert.equal(state.vertices, state.samples * Number(sides) + 2);
        assert.equal(state.date, original.date); assert.equal(state.observations, original.observations);
        assert.ok(Math.abs(state.progress - original.progress) < 1e-10);
      }
      for (const mode of [true, false]) {
        await page.locator('#tubeToggle').setChecked(mode);
        let previousSamples = 0;
        for (const detail of ['3', '6', '12', '24']) {
          await page.selectOption('#curveSegments', detail);
          const state = await page.evaluate(() => lineTest.state());
          assert.equal(state.detail, Number(detail)); assert.equal(state.sampling, Number(detail));
          assert.equal(state.date, original.date); assert.equal(state.observations, original.observations);
          assert.equal(state.playing, false); assert.ok(state.samples > previousSamples);
          previousSamples = state.samples;
          assert.ok(await page.evaluate(() => lineTest.pixels()) > 100);
        }
      }
      await page.selectOption('#curveSegments', '12');
      await page.uncheck('#smoothSpiralToggle');
      assert.equal(await page.locator('#curveSegments').isDisabled(), true);
      assert.equal((await page.evaluate(() => lineTest.state())).sampling, 1);
      assert.equal((await page.evaluate(() => lineTest.state())).date, original.date);
      await page.check('#smoothSpiralToggle');
      assert.equal(await page.locator('#curveSegments').isDisabled(), false);
      assert.equal((await page.evaluate(() => lineTest.state())).sampling, 12);
      await page.check('#tubeToggle');
      await slider.focus(); await page.keyboard.press('Home');
      assert.equal(await page.locator('#thicknessValue').textContent(), '5%');
      assert.equal((await page.evaluate(() => lineTest.state())).tube, true);
      await page.uncheck('#tubeToggle'); assert.equal(await page.locator('#tubeSides').isDisabled(), true);
      await slider.focus(); await page.keyboard.press('End');
      const wide = await page.evaluate(() => lineTest.state());
      assert.equal(wide.tube, false); assert.equal(wide.width, 0.36);
      assert.equal(wide.date, original.date);
      const widePixels = await page.evaluate(() => lineTest.pixels());
      await page.screenshot({ path: join(output, name + '-line-settings.png') });
      await slider.focus(); await page.keyboard.press('Home');
      assert.equal((await page.evaluate(() => lineTest.state())).mesh, wide.mesh, 'Line width must not rebuild the model');
      const thinPixels = await page.evaluate(() => lineTest.pixels());
      assert.ok(widePixels > thinPixels * 1.5, 'Width must visibly affect the rendered line');
      await slider.focus(); await page.keyboard.press('End');
      for (const mix of [0, 0.5, 1, 0]) {
        await page.evaluate(mix => lineTest.morph(mix), mix);
        const topology = await page.evaluate(() => lineTest.topology());
        assert.ok(topology.finite && topology.error < 1e-6 && topology.visible > 0);
        assert.ok(await page.evaluate(() => lineTest.pixels()) > 100);
      }
      assert.equal(await page.locator('#settingsPanel').evaluate(element => element.scrollWidth <= element.clientWidth), true);
      await page.click('#exportSettings > summary');
      const download = page.waitForEvent('download'); await page.click('#exportBtn');
      const modelPath = join(output, name + '-line.glb'); await (await download).saveAs(modelPath);
      const model = readFileSync(modelPath); const jsonLength = model.readUInt32LE(12);
      const gltf = JSON.parse(model.subarray(20, 20 + jsonLength).toString());
      assert.ok(gltf.meshes.every(mesh => mesh.primitives.every(primitive => primitive.mode === 1)));
      if (!await page.locator('#settingsPanel').isVisible()) await page.click('#settingsBtn');
      await page.click('#videoAdvanced > summary');
      await page.selectOption('#videoResolution', 'custom');
      await page.fill('#videoWidth', '640'); await page.fill('#videoHeight', '360');
      await page.click('#videoExportBtn');
      await page.waitForFunction(() => lineTest.exportState()?.frame >= 5);
      assert.equal(await page.locator('#tubeToggle').isDisabled(), true);
      assert.equal(await page.locator('#tubeSides').isDisabled(), true);
      assert.equal(await page.locator('#curveSegments').isDisabled(), true);
      await page.click('#videoExportBtn');
      assert.equal(await page.locator('#tubeToggle').isDisabled(), false);
      assert.equal(await page.locator('#curveSegments').isDisabled(), false);
      assert.equal(await page.locator('#tubeSides').isDisabled(), true);
      if (name === 'desktop') {
        const finished = page.waitForEvent('download', { timeout: 120_000 });
        await page.click('#videoExportBtn');
        await (await finished).saveAs(join(output, 'line-video.mp4'));
        const frames = await page.evaluate(async () => {
          const video = document.createElement('video'); video.muted = true;
          const loaded = new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = reject; });
          video.src = document.getElementById('videoDownload').href; await loaded;
          const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d'); const result = [];
          for (const time of [2, video.duration - 0.3]) {
            await new Promise(resolve => { video.onseeked = () => setTimeout(resolve, 100); video.currentTime = time; });
            ctx.drawImage(video, 0, 0);
            const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            let lit = 0;
            for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width * 0.55; x++) {
              const i = (y * canvas.width + x) * 4;
              if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 30) lit++;
            }
            result.push({ lit, image: canvas.toDataURL().split(',')[1] });
          }
          return result;
        });
        for (const [index, frame] of frames.entries()) {
          assert.ok(frame.lit > 200, 'Export must include the wide line, not only the legend');
          writeFileSync(join(output, 'line-video-' + index + '.png'), Buffer.from(frame.image, 'base64'));
        }
      }
      await page.check('#tubeToggle');
      assert.equal(await page.locator('#tubeSides').isDisabled(), false);
      assert.equal((await page.evaluate(() => lineTest.state())).date, original.date);
      assert.deepEqual(errors, []);
      await context.close();
      console.log(name + ': independent modes, visible width, tube sides, timeline retention, morphs, model export, and recording locks passed');
    }
    console.log('Screenshots: ' + output);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });

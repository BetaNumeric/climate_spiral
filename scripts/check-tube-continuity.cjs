const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { chromium } = require('playwright');

const output = join(tmpdir(), 'climate-tube-continuity');
mkdirSync(output, { recursive: true });

const hooks = `
  window.tubeTest = {
    ready: () => Boolean(spiralMesh && timelineStops.length),
    pause() { if (isAnimating) toggleAnimation(); setPlaybackPosition(totalIndices); },
    synthetic() {
      const points = [new THREE.Vector3(1, 0, -2), new THREE.Vector3(2, 1, -1),
        new THREE.Vector3(2, 2, 1), new THREE.Vector3(1, 3, 2)];
      const sources = [0, 1, 1, 2, 3, 3];
      const colors = points.map(() => new THREE.Color('white'));
      const reference = createDataTubeGeometry(points, colors, 0.12, 8);
      const duplicated = createDataTubeGeometry(sources.map(i => points[i]), sources.map(i => colors[i]), 0.12, 8);
      const errors = {};
      for (const name of ['position', 'normal']) {
        errors[name] = 0;
        for (let i = 0; i < sources.length * 8 + 2; i++) {
          const source = i < sources.length * 8 ? sources[Math.floor(i / 8)] * 8 + i % 8
            : points.length * 8 + i - sources.length * 8;
          for (let axis = 0; axis < 3; axis++) {
            errors[name] = Math.max(errors[name], Math.abs(duplicated.attributes[name].array[i * 3 + axis]
              - reference.attributes[name].array[source * 3 + axis]));
          }
        }
      }
      const flat = createDataTubeGeometry(sources.map(i => points[i]), sources.map(i => colors[i]), 0.12, 8,
        sources.map((i, index) => ({ decimalYear: 2000 + i / 12, stripYear: index < 2 ? 2000 : 2001 })), true);
      const gap = createDataTubeGeometry(sources.map(i => points[i]), sources.map(i => colors[i]), 0.12, 8,
        sources.map((i, index) => ({ decimalYear: 2000 + i / 12, missing: index === 2 })));
      // A yearly opening or missing month must still use separate rings, even at coincident positions.
      errors.flatSplit = flat.index.array.includes(2 * 8);
      errors.gapSplit = gap.index.array.includes(2 * 8);
      for (const geometry of [reference, duplicated, flat, gap]) geometry.dispose();
      return errors;
    },
    inspect() {
      const geometry = spiralMesh.geometry, morph = geometry.layoutMorph, radial = CONFIG.radialSegments;
      let joins = 0, positionError = 0, normalError = 0, unwelded = 0;
      const used = new Set(morph.sourceIndex);
      for (let i = 1; i < generatedGeometryData.length; i++) {
        const a = generatedGeometryData[i - 1], b = generatedGeometryData[i];
        if (a.decimalYear !== b.decimalYear || a.stripYear === b.stripYear || a.spiralMissing || b.spiralMissing) continue;
        joins++;
        for (let j = 0; j < radial; j++) {
          const vertex = i * radial + j;
          if (used.has(vertex)) unwelded++;
          for (let axis = 0; axis < 3; axis++) {
            const offset = vertex * 3 + axis;
            positionError = Math.max(positionError, Math.abs(morph.source[offset] - morph.source[offset - radial * 3]));
            normalError = Math.max(normalError, Math.abs(morph.sourceNormals[offset] - morph.sourceNormals[offset - radial * 3]));
          }
        }
      }
      return { joins, positionError, normalError, unwelded,
        finite: geometry.attributes.position.array.every(Number.isFinite) && geometry.attributes.normal.array.every(Number.isFinite),
        sourceRestored: geometry.attributes.position.array.every((v, i) => v === morph.source[i])
          && geometry.attributes.normal.array.every((v, i) => v === morph.sourceNormals[i])
          && geometry.index.array.every((v, i) => v === morph.sourceIndex[i]) };
    },
    morph(mix) { layoutTransition = null; layoutMix = mix; applyLayout(); },
    shape(smooth, thickness) {
      document.getElementById('smoothSpiralToggle').checked = smooth;
      const input = document.getElementById('thicknessSlider'); input.value = thickness;
      input.dispatchEvent(new Event('input'));
      setPlaybackPosition(totalIndices);
    },
    view(close) {
      setCameraView('top', { duration: 0 });
      controls.enableDamping = false;
      if (close) {
        const point = generatedGeometryData.find(p => p.decimalYear === 1950).point;
        const offset = activeCamera.position.clone().sub(controls.target);
        controls.target.copy(point);
        activeCamera.position.copy(point).add(offset);
        activeCamera.zoom = 10;
        activeCamera.updateProjectionMatrix();
        controls.update();
      }
    },
    pixels() {
      renderer.render(scene, activeCamera);
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
      const ctx = canvas.getContext('2d'); ctx.drawImage(renderer.domElement, 0, 0, 320, 240);
      const data = ctx.getImageData(0, 0, 320, 240).data;
      let lit = 0;
      for (let i = 0; i < data.length; i += 4) if (Math.max(data[i], data[i + 1], data[i + 2]) > 20) lit++;
      return lit;
    },
  };
`;

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
  try {
    for (const [name, viewport] of Object.entries({ desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 } })) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: name === 'mobile' ? 2 : 1, serviceWorkers: 'block' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/index.html', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()).replace('// --- Configuration ---', hooks + '// --- Configuration ---') });
      });
      await page.goto('http://127.0.0.1:8000/index.html');
      await page.waitForFunction(() => window.tubeTest?.ready());
      await page.evaluate(() => tubeTest.pause());
      const original = await page.evaluate(() => tubeTest.inspect());
      console.log(name, original);
      await page.evaluate(() => tubeTest.view(true));
      await page.screenshot({ path: join(output, name + '-close.png') });
      assert.ok(await page.evaluate(() => tubeTest.pixels()) > 300);
      const synthetic = await page.evaluate(() => tubeTest.synthetic());
      console.log('Compared with an uninterrupted tube:', synthetic);
      assert.ok(synthetic.position < 1e-6 && synthetic.normal < 1e-6, 'Duplicating a boundary must not alter the tube surface');
      assert.ok(synthetic.flatSplit && synthetic.gapSplit);
      assert.ok(original.joins > 100);
      assert.equal(original.positionError, 0);
      assert.equal(original.normalError, 0);
      assert.equal(original.unwelded, 0);
      for (const smooth of [true, false]) {
        for (const thickness of [1.5, 0, 1]) {
          await page.evaluate(({ smooth, thickness }) => tubeTest.shape(smooth, thickness), { smooth, thickness });
          for (const mix of [0.001, 0.5, 1, 0]) {
            await page.evaluate(value => tubeTest.morph(value), mix);
            const result = await page.evaluate(() => tubeTest.inspect());
            assert.ok(result.finite);
            assert.equal(result.normalError, 0);
            assert.equal(result.positionError, 0);
            assert.equal(result.unwelded, 0);
            if (mix === 0) assert.ok(result.sourceRestored);
          }
        }
      }
      await page.evaluate(() => { tubeTest.shape(true, 1); tubeTest.view(false); });
      await page.screenshot({ path: join(output, name + '-spiral.png') });
      assert.ok(await page.evaluate(() => tubeTest.pixels()) > 500);
      await page.evaluate(() => tubeTest.morph(1));
      await page.screenshot({ path: join(output, name + '-unwrapped.png') });
      assert.ok(await page.evaluate(() => tubeTest.pixels()) > 500);
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log('Screenshots: ' + output);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

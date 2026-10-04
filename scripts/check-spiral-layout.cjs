const assert = require('node:assert/strict');
const { installVideoSessionHook } = require('./browser-test-hooks.cjs');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { chromium } = require('playwright');

const output = join(tmpdir(), 'climate-monthly-graph');
mkdirSync(output, { recursive: true });

const hooks = `
  window.layoutTest = {
    ready: () => Boolean(spiralMesh && timelineStops.length),
    state: () => ({ mix: layoutMix, moving: Boolean(layoutTransition), index: animationIndex, playing: isAnimating,
      count: timelineStops.length, dataset: currentDatasetKey, mesh: spiralMesh?.uuid, bend: getLayoutBend() }),
    pause() { if (isAnimating) toggleAnimation(); },
    thickness(value) {
      const input = document.getElementById('thicknessSlider'); input.value = value;
      input.dispatchEvent(new Event('input'));
    },
    spacing(value) {
      const input = document.getElementById('spacingSlider'); input.value = value;
      input.dispatchEvent(new Event('input'));
    },
    lineState() {
      const geometry = spiralLine?.geometry;
      let broken = 0, bridges = 0, connected = 0, boundaryHeightError = 0, radiusError = 0;
      const data = generatedGeometryData;
      const vertices = spiralMesh.geometry.attributes.position;
      for (let i = 0; i < data.length; i++) {
        const point = new THREE.Vector3().fromBufferAttribute(vertices, i * CONFIG.radialSegments);
        radiusError = Math.max(radiusError, Math.abs(point.distanceTo(data[i].point) - CONFIG.tubeRadius));
        if (i && data[i].stripYear !== data[i - 1].stripYear && data[i].decimalYear === data[i - 1].decimalYear) {
          boundaryHeightError = Math.max(boundaryHeightError, Math.abs(data[i].point.y - data[i - 1].point.y));
        }
      }
      if (geometry) {
        for (let i = 0; i < data.length - 1; i++) {
          const drawn = geometry.index.array[2 * i] !== geometry.index.array[2 * i + 1];
          const expected = !data[i].missing && !data[i + 1].missing
            && data[i + 1].decimalYear - data[i].decimalYear <= 1 / 12 + 1e-6
            && (layoutMix === 0 || data[i].stripYear === data[i + 1].stripYear);
          if (drawn) connected++;
          if (drawn && !expected) bridges++;
          if (expected && !drawn) broken++;
        }
      }
      return { thin: Boolean(spiralLine), meshVisible: spiralMesh.visible, radius: CONFIG.tubeRadius,
        boundaryHeightError, radiusError, broken, bridges, connected,
        range: geometry?.drawRange.count, expectedRange: Math.floor(animationIndex / (CONFIG.radialSegments * 6)) * 2,
        sharedBuffers: geometry?.attributes.position === spiralMesh.geometry.attributes.position
          && geometry?.attributes.color === spiralMesh.geometry.attributes.color,
        finite: vertices.array.every(Number.isFinite),
        indicatorError: Math.abs(yearIndicatorMesh.position.y - ((data[Math.floor(animationIndex / (CONFIG.radialSegments * 6))].decimalYear - startYear) * CONFIG.heightPerYear + 2)),
      };
    },
    seek(fraction) { setPlaybackPosition(fraction * totalIndices); },
    camera(side) {
      controls.enableDamping = false;
      controls.update();
      controls.target.set(0, spiralHeight / 2, 0);
      activeCamera.position.set(0, controls.target.y + (side ? 0 : 120), side ? 120 : 0.0001);
      controls.update();
    },
    intermediate(mix) { layoutTransition = null; layoutMix = mix; applyLayout(); },
    profileMorph() {
      const times = [];
      for (const mix of [0.001, 0.1, 0.3, 0.5, 0.7, 0.9, 0.999]) {
        layoutMix = mix;
        const start = performance.now(); applyLayout(); times.push(performance.now() - start);
      }
      layoutMix = 1; applyLayout();
      return times;
    },
    joins() {
      let closed = 0, missing = 0, broken = 0;
      const stride = CONFIG.radialSegments * 6, capSize = CONFIG.radialSegments * 3;
      const indices = spiralMesh.geometry.index.array;
      for (let stop = 1; stop < timelineStops.length; stop++) {
        const current = timelineStops[stop] / stride, previous = timelineStops[stop - 1] / stride;
        const a = generatedGeometryData[previous], b = generatedGeometryData[current];
        if (calendarYear(a.decimalYear) === calendarYear(b.decimalYear) || b.decimalYear - a.decimalYear > 1 / 12 + 1e-6) continue;
        closed++;
        for (let i = previous; i < current - 1; i++) {
          if (generatedGeometryData[i].missing) missing++;
          const faces = indices.slice(capSize + i * stride, capSize + (i + 1) * stride);
          let connected = false;
          for (let j = 0; j < faces.length; j += 3) {
            const rings = [faces[j], faces[j + 1], faces[j + 2]].map(id => Math.floor(id / CONFIG.radialSegments));
            if (Math.min(...rings) === i && Math.max(...rings) === i + 1) connected = true;
          }
          if (!connected) broken++;
        }
      }
      return { closed, missing, broken };
    },
    toggle(id, checked) { const input = document.getElementById(id); input.checked = checked; input.dispatchEvent(new Event('change')); },
    step() {
      const december = timelineStops.find(stop => {
        const date = generatedGeometryData[stop / (CONFIG.radialSegments * 6)].decimalYear;
        return Math.round((date - calendarYear(date)) * 12) === 11;
      });
      setPlaybackPosition(december);
      const before = generatedGeometryData[animationIndex / (CONFIG.radialSegments * 6)].point.clone();
      document.getElementById('stepForwardBtn').click();
      const after = generatedGeometryData[animationIndex / (CONFIG.radialSegments * 6)].point;
      return { before: before.toArray(), after: after.toArray(), width: monthlyLayout.width, height: CONFIG.heightPerYear };
    },
    inspect() {
      const geometry = spiralMesh.geometry;
      const vertices = geometry.attributes.position;
      let error = 0, rowError = 0, axisError = 0, seamTriangles = 0, gapTriangles = 0;
      const radial = CONFIG.radialSegments;
      for (const stop of timelineStops) {
        const index = stop / (radial * 6), data = generatedGeometryData[index];
        const year = calendarYear(data.decimalYear), month = (data.decimalYear - year) * 12;
        rowError = Math.max(rowError, Math.abs(data.point.y - (data.decimalYear - startYear) * CONFIG.heightPerYear));
        axisError = Math.max(axisError, Math.abs(data.point.x - monthlyLayout.width * (month / 12 - .5)),
          Math.abs(data.point.z - (monthlyLayout.center - getSpiralRadius(data.anomaly))));
        const center = new THREE.Vector3();
        for (let j = 0; j < radial; j++) center.add(new THREE.Vector3().fromBufferAttribute(vertices, index * radial + j));
        error = Math.max(error, center.divideScalar(radial).distanceTo(data.point));
      }
      const indices = geometry.index.array;
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
      for (let i = radial * 3; i < indices.length - radial * 3; i += 3) {
        const ids = [indices[i], indices[i + 1], indices[i + 2]];
        const dates = ids.map(id => generatedGeometryData[Math.floor(id / radial)].decimalYear);
        a.fromBufferAttribute(vertices, ids[0]); b.fromBufferAttribute(vertices, ids[1]); c.fromBufferAttribute(vertices, ids[2]);
        const area = b.sub(a).cross(c.sub(a)).lengthSq();
        if (area < 1e-14) continue;
        const years = ids.map(id => generatedGeometryData[Math.floor(id / radial)].stripYear);
        if (Math.min(...years) !== Math.max(...years)) seamTriangles++;
        if (Math.max(...dates) - Math.min(...dates) > 1 / 12 + 1e-6) gapTriangles++;
      }
      const finite = vertices.array.every(Number.isFinite) && geometry.attributes.normal.array.every(Number.isFinite);
      const sourceError = vertices.array.reduce((error, value, i) => Math.max(error, Math.abs(value - geometry.layoutMorph.source[i])), 0);
      return { error, rowError, axisError, seamTriangles, gapTriangles, finite, sourceError };
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
    exportState: () => ({ frames: videoController.testRecording?.frameIndex ?? 0, active: Boolean(videoController.testRecording), mix: layoutMix,
      polar: controls.getPolarAngle(), azimuth: controls.getAzimuthalAngle() }),
    previewState: () => ({ active: Boolean(videoController.isPreviewing), mix: layoutMix, index: animationIndex,
      polar: controls.getPolarAngle(), azimuth: controls.getAzimuthalAngle() }),
    lastExportFrame() {
      videoController.testRecording.frameIndex = videoController.testRecording.framePlan.startHoldFrames + videoController.testRecording.framePlan.drawSteps - 1;
      videoController.testRecording.nextFrameAt = 0;
      return videoController.testRecording.frameIndex + 1;
    },
    exportImage: () => videoController.testRecording.canvas.toDataURL('image/png').split(',')[1],
    legendPixels() {
      const session = videoController.testRecording, rect = session.layout.legend;
      const data = session.context.getImageData(rect.x, rect.y, rect.width, rect.height).data;
      let white = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (Math.min(data[i], data[i + 1], data[i + 2]) > 200 && Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]) < 5) white++;
      }
      return white;
    },
    exportTransition(fraction, move = 0) {
      videoController.testRecording.frameIndex = videoController.testRecording.framePlan.startHoldFrames + videoController.testRecording.framePlan.drawSteps
        + videoController.testRecording.framePlan.stepFrames.slice(0, move).reduce((sum, frames) => sum + frames, 0)
        + Math.round(fraction * (videoController.testRecording.framePlan.stepFrames[move] - 1));
      videoController.testRecording.nextFrameAt = 0;
      return videoController.testRecording.frameIndex + 1;
    },
    holdExport(paused) { videoController.setPaused(paused); },
  };
`;

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
  try {
    for (const [name, viewport] of Object.entries({ desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 } })) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: name === 'mobile' ? 2 : 1, serviceWorkers: 'block' });
      const page = await context.newPage();
      await installVideoSessionHook(page);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/index.html', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()).replace('// --- Configuration ---', hooks + '// --- Configuration ---') });
      });
      await page.goto('http://127.0.0.1:8000/index.html');
      await page.waitForFunction(() => window.layoutTest?.ready());
      await page.evaluate(() => { layoutTest.pause(); layoutTest.seek(0.6); });
      const before = await page.evaluate(() => layoutTest.state());
      await page.click('#settingsBtn');
      assert.equal(await page.locator('.settings-layout input').count(), 2);
      assert.deepEqual(await page.locator('.settings-layout span').allTextContents(), ['Spiral', 'Unwrapped']);
      assert.ok(await page.evaluate(() => {
        const body = document.querySelector('.settings-body');
        return body.firstElementChild.classList.contains('settings-layout')
          && !document.querySelector('#viewSettings .layout-modes');
      }));
      const scrollMetrics = await page.evaluate(() => {
        document.querySelectorAll('#settingsPanel details').forEach(details => { details.open = true; });
        document.getElementById('videoResolution').value = 'custom';
        document.getElementById('videoResolution').dispatchEvent(new Event('change'));
        const body = document.querySelector('.settings-body');
        const style = getComputedStyle(body);
        return {
          clientWidth: body.clientWidth, scrollWidth: body.scrollWidth,
          clientHeight: body.clientHeight, scrollHeight: body.scrollHeight,
          overflowX: style.overflowX, overflowY: style.overflowY,
          scrollbarColor: style.scrollbarColor, scrollbarWidth: style.scrollbarWidth,
        };
      });
      assert.ok(scrollMetrics.scrollWidth <= scrollMetrics.clientWidth);
      assert.ok(scrollMetrics.scrollHeight > scrollMetrics.clientHeight);
      assert.equal(scrollMetrics.overflowX, 'hidden');
      assert.equal(scrollMetrics.overflowY, 'auto');
      assert.equal(scrollMetrics.scrollbarWidth, 'thin');
      assert.notEqual(scrollMetrics.scrollbarColor, 'auto');
      await page.evaluate(() => { document.querySelector('.settings-body').scrollTop = 1e6; });
      await page.screenshot({ path: join(output, name + '-settings-scrollbar.png') });
      await page.evaluate(() => {
        document.querySelectorAll('#settingsPanel details').forEach(details => { details.open = false; });
        document.getElementById('animationSettings').open = true;
        document.querySelector('.settings-body').scrollTop = 0;
      });
      await page.screenshot({ path: join(output, name + '-settings-top.png') });
      await page.click('#viewSettings > summary');
      await page.locator('.layout-modes label').filter({ hasText: 'Unwrapped' }).click();
      await page.waitForFunction(() => layoutTest.state().mix > 0 && layoutTest.state().mix < 1);
      await page.screenshot({ path: join(output, name + '-unfolding.png') });
      await page.waitForFunction(() => !layoutTest.state().moving);
      const after = await page.evaluate(() => layoutTest.state());
      assert.equal(after.mix, 1);
      assert.equal(after.index, before.index);
      assert.equal(after.playing, before.playing);
      await page.locator('#thicknessSlider').focus();
      await page.keyboard.press('Home');
      assert.equal(await page.locator('#thicknessValue').textContent(), 'Line');
      assert.equal((await page.evaluate(() => layoutTest.lineState())).thin, true);
      await page.keyboard.press('End');
      assert.equal(await page.locator('#thicknessSlider').getAttribute('aria-valuetext'), '150%');
      assert.equal((await page.evaluate(() => layoutTest.lineState())).radius, 0.18);
      await page.evaluate(() => layoutTest.thickness(1));
      await page.locator('#thicknessSlider').scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(output, name + '-settings.png') });
      await page.click('#settingsBtn');
      await page.evaluate(() => { layoutTest.seek(1); layoutTest.camera(false); });
      await page.waitForTimeout(150);
      await page.screenshot({ path: join(output, name + '-top.png') });
      assert.ok(await page.evaluate(() => layoutTest.pixels()) > 500);
      const graph = await page.evaluate(() => layoutTest.inspect());
      console.log(name, graph);
      assert.ok(graph.finite && graph.error < 1e-4 && graph.rowError < 1e-8 && graph.axisError < 1e-6);
      assert.equal(graph.seamTriangles, 0);
      assert.equal(graph.gapTriangles, 0);
      const joins = await page.evaluate(() => layoutTest.joins());
      assert.ok(joins.closed > 100);
      assert.equal(joins.missing, 0);
      assert.equal(joins.broken, 0);
      console.log(name, 'morph update ms:', await page.evaluate(() => layoutTest.profileMorph()));
      const step = await page.evaluate(() => layoutTest.step());
      assert.ok(Math.abs(step.before[0] - step.after[0] - step.width * 11 / 12) < 1e-6);
      assert.ok(Math.abs(step.after[1] - step.before[1] - step.height / 12) < 1e-6);
      for (const spacing of [0, 1, 0.25]) {
        await page.evaluate(value => layoutTest.spacing(value), spacing);
        const shape = await page.evaluate(() => layoutTest.lineState());
        assert.ok(shape.boundaryHeightError < 1e-8 && shape.indicatorError < 1e-8);
        assert.ok((await page.evaluate(() => layoutTest.inspect())).rowError < 1e-8);
      }
      for (const thickness of [1.5, 0.5, 0.05, 0, 1, 0]) {
        const previous = await page.evaluate(() => layoutTest.state());
        await page.evaluate(value => layoutTest.thickness(value), thickness);
        const current = await page.evaluate(() => layoutTest.state());
        const shape = await page.evaluate(() => layoutTest.lineState());
        assert.equal(current.index, previous.index);
        assert.equal(current.playing, previous.playing);
        assert.equal(shape.thin, thickness === 0);
        assert.equal(shape.meshVisible, thickness > 0);
        assert.ok(shape.finite && shape.radiusError < 1e-4 && shape.boundaryHeightError < 1e-8);
        if (thickness === 0) {
          assert.ok(shape.sharedBuffers && shape.connected > 1000);
          assert.equal(shape.bridges, 0); assert.equal(shape.broken, 0);
          assert.equal(shape.range, shape.expectedRange);
        }
      }
      await page.evaluate(() => { layoutTest.seek(1); layoutTest.camera(true); });
      await page.screenshot({ path: join(output, name + '-thin-side.png') });
      assert.ok(await page.evaluate(() => layoutTest.pixels()) > 300);
      await page.evaluate(() => layoutTest.camera(false));
      await page.screenshot({ path: join(output, name + '-thin-top.png') });
      assert.ok(await page.evaluate(() => layoutTest.pixels()) > 500);
      for (const mix of [0, 0.5, 1]) {
        await page.evaluate(value => layoutTest.intermediate(value), mix);
        const shape = await page.evaluate(() => layoutTest.lineState());
        assert.ok(shape.finite && shape.radiusError < 1e-4);
        assert.equal(shape.bridges, 0); assert.equal(shape.broken, 0);
        assert.ok(await page.evaluate(() => layoutTest.pixels()) > 300);
      }
      await page.evaluate(() => layoutTest.seek(1));
      await page.evaluate(() => layoutTest.camera(true));
      await page.waitForTimeout(150);
      await page.screenshot({ path: join(output, name + '-side.png') });
      assert.ok(await page.evaluate(() => layoutTest.pixels()) > 300);
      await page.click('#settingsBtn');
      await page.locator('.layout-modes label').filter({ hasText: /^Spiral$/ }).click();
      await page.waitForFunction(() => !layoutTest.state().moving);
      assert.equal((await page.evaluate(() => layoutTest.inspect())).sourceError, 0);
      await page.evaluate(() => { layoutTest.seek(0.2); document.getElementById('playBtn').click(); });
      const playingIndex = (await page.evaluate(() => layoutTest.state())).index;
      await page.locator('.layout-modes label').filter({ hasText: 'Unwrapped' }).click();
      await page.waitForFunction(() => !layoutTest.state().moving);
      const playing = await page.evaluate(() => layoutTest.state());
      assert.ok(playing.playing && playing.index > playingIndex);
      const resizingPlayback = await page.evaluate(() => {
        const before = layoutTest.state();
        layoutTest.thickness(1.5);
        const after = layoutTest.state();
        layoutTest.thickness(0);
        return { before, after };
      });
      assert.equal(resizingPlayback.after.index, resizingPlayback.before.index);
      assert.equal(resizingPlayback.after.playing, true);
      await page.evaluate(() => layoutTest.pause());

      if (name === 'desktop') {
        const datasets = await page.locator('#datasetSelect option').evaluateAll(options => options.map(option => option.value));
        for (const dataset of datasets.filter(key => key !== 'temperature' && key !== 'local')) {
          const mesh = (await page.evaluate(() => layoutTest.state())).mesh;
          await page.selectOption('#datasetSelect', dataset);
          await page.waitForFunction(previous => layoutTest.ready() && layoutTest.state().mesh !== previous, mesh);
          await page.evaluate(() => { layoutTest.pause(); layoutTest.seek(1); layoutTest.camera(false); });
          const result = await page.evaluate(() => layoutTest.inspect());
          assert.ok(result.finite && result.axisError < 1e-6 && result.rowError < 1e-8, dataset);
          assert.equal(result.seamTriangles, 0, dataset);
          assert.equal(result.gapTriangles, 0, dataset);
          const shape = await page.evaluate(() => layoutTest.lineState());
          assert.equal(shape.bridges, 0, dataset); assert.equal(shape.broken, 0, dataset);
          assert.ok(shape.boundaryHeightError < 1e-8, dataset);
          console.log(dataset, 'monthly values and gaps verified');
        }
        await page.evaluate(() => layoutTest.toggle('smoothSpiralToggle', false));
        let rough = await page.evaluate(() => layoutTest.inspect());
        assert.ok(rough.finite && rough.axisError < 1e-6);
        assert.equal(rough.seamTriangles, 0);
        assert.equal(rough.gapTriangles, 0);
        const previousMesh = (await page.evaluate(() => layoutTest.state())).mesh;
        await page.selectOption('#datasetSelect', 'arctic');
        await page.waitForFunction(previous => layoutTest.state().mesh !== previous, previousMesh);
        await page.evaluate(() => { layoutTest.pause(); layoutTest.seek(1); });
        rough = await page.evaluate(() => layoutTest.inspect());
        assert.equal(rough.gapTriangles, 0);
        await page.evaluate(() => layoutTest.toggle('smoothSpiralToggle', true));
        await page.selectOption('#datasetSelect', 'temperature');
        await page.waitForFunction(() => layoutTest.state().count > 1700);
        await page.evaluate(() => { layoutTest.pause(); layoutTest.seek(1); layoutTest.camera(false); });

        await page.evaluate(() => layoutTest.toggle('orthoToggle', false));
        await page.locator('.layout-modes label').filter({ hasText: /^Spiral$/ }).click();
        await page.waitForFunction(() => layoutTest.state().mix < 0.8);
        await page.locator('.layout-modes label').filter({ hasText: 'Unwrapped' }).click();
        await page.waitForFunction(() => !layoutTest.state().moving);
        assert.equal((await page.evaluate(() => layoutTest.state())).mix, 1);
        assert.ok(await page.evaluate(() => layoutTest.pixels()) > 300);
        await page.evaluate(() => layoutTest.toggle('orthoToggle', true));

        await page.click('#exportSettings > summary');
        const modelDownload = page.waitForEvent('download');
        await page.click('#exportBtn');
        const model = readFileSync(await (await modelDownload).path());
        assert.equal(model.toString('ascii', 0, 4), 'glTF');
        const gltf = JSON.parse(model.toString('utf8', 20, 20 + model.readUInt32LE(12)).trim());
        assert.ok(gltf.meshes.length > 0);
        assert.ok(gltf.meshes.every(mesh => mesh.primitives.every(primitive => primitive.mode === 1)), 'Thin model must contain lines');
        assert.ok(!model.includes(Buffer.from('layoutMorph')));
        await page.click('#videoAdvanced > summary');
        assert.deepEqual(await page.locator('#videoViewList .video-step-view').evaluateAll(elements => elements.map(element => element.value)), ['spiral-front']);
        await page.selectOption('#videoCamera', 'graph-top');
        await page.click('#videoViewList [data-action="remove"]');
        assert.equal(await page.locator('#videoTransitionRow').isHidden(), true);
        await page.click('#videoExportBtn');
        await page.waitForFunction(() => layoutTest.exportState().frames > 3, null, { timeout: 60_000 });
        assert.equal((await page.evaluate(() => layoutTest.exportState())).mix, 1);
        const lastFrame = await page.evaluate(() => layoutTest.lastExportFrame());
        await page.waitForFunction(frame => layoutTest.exportState().frames >= frame, lastFrame, { timeout: 60_000 });
        const image = await page.evaluate(() => layoutTest.exportImage());
        writeFileSync(join(output, 'export-graph.png'), Buffer.from(image, 'base64'));
        await page.click('#videoExportBtn');
        assert.equal((await page.evaluate(() => layoutTest.exportState())).active, false);
        await page.evaluate(() => layoutTest.thickness(1.5));
        const tubeDownload = page.waitForEvent('download');
        await page.click('#exportBtn');
        const tube = readFileSync(await (await tubeDownload).path());
        const tubeGltf = JSON.parse(tube.toString('utf8', 20, 20 + tube.readUInt32LE(12)).trim());
        assert.ok(tubeGltf.meshes.every(mesh => mesh.primitives.every(primitive => (primitive.mode ?? 4) === 4)));
        await page.evaluate(() => layoutTest.thickness(1));
        await page.selectOption('#videoCamera', 'spiral-top');
        for (let index = 0; index < 3; index++) await page.click('#videoAddView');
        await page.locator('#videoViewList .video-step-view').nth(0).selectOption('graph-top');
        await page.locator('#videoViewList .video-step-view').nth(1).selectOption('graph-front');
        await page.locator('#videoViewList .video-step-view').nth(2).selectOption('graph-right');
        await page.locator('#videoViewList [data-action="up"]').nth(2).click();
        assert.deepEqual(await page.locator('#videoViewList .video-step-view').evaluateAll(elements => elements.map(element => element.value)),
          ['graph-top', 'graph-right', 'graph-front']);
        await page.locator('#videoViewList [data-action="down"]').nth(1).click();
        assert.deepEqual(await page.locator('#videoViewList .video-step-view').evaluateAll(elements => elements.map(element => element.value)),
          ['graph-top', 'graph-front', 'graph-right']);
        await page.click('#videoAddPause');
        await page.locator('#videoViewList [data-action="up"]').nth(3).click();
        await page.locator('#videoViewList .video-pause-seconds').nth(2).fill('0.5');
        assert.deepEqual(await page.locator('#videoViewList .video-step-view').evaluateAll(elements => elements.map(element => element.value)),
          ['graph-top', 'graph-front', 'pause', 'graph-right']);
        await page.click('#videoAddView');
        assert.equal(await page.locator('#videoViewList .video-step-view').count(), 5);
        assert.equal(await page.locator('#videoAddView').isEnabled(), true);
        await page.locator('#videoViewList [data-action="remove"]').nth(4).click();
        await page.screenshot({ path: join(output, name + '-camera-path-settings.png') });
        const beforePreview = await page.evaluate(() => layoutTest.previewState());
        await page.fill('#videoTransition', '0.5');
        await page.click('#videoPreviewBtn');
        await page.waitForFunction(() => layoutTest.previewState().active);
        assert.equal(await page.locator('#settingsPanel').evaluate(panel => panel.classList.contains('visible')), false);
        assert.equal(await page.locator('#videoPreviewBar').isVisible(), true);
        await page.waitForFunction(() => layoutTest.previewState().mix > 0.3, null, { timeout: 10_000 });
        await page.screenshot({ path: join(output, name + '-camera-path-preview.png') });
        assert.ok(await page.evaluate(() => layoutTest.pixels()) > 300);
        await page.click('#videoPreviewStop');
        assert.deepEqual(await page.evaluate(() => layoutTest.previewState()), beforePreview);
        assert.equal(await page.locator('#settingsPanel').evaluate(panel => panel.classList.contains('visible')), true);
        assert.equal(await page.locator('#videoPreviewBar').isHidden(), true);
        await page.click('#videoPreviewBtn');
        await page.waitForFunction(() => layoutTest.previewState().active);
        await page.waitForFunction(() => !layoutTest.previewState().active, null, { timeout: 10_000 });
        assert.deepEqual(await page.evaluate(() => layoutTest.previewState()), beforePreview);
        assert.equal(await page.locator('#settingsPanel').evaluate(panel => panel.classList.contains('visible')), true);
        await page.fill('#videoTransition', '2.5');
        await page.click('#videoExportBtn');
        await page.waitForFunction(() => layoutTest.exportState().frames > 2);
        assert.equal((await page.evaluate(() => layoutTest.exportState())).mix, 0);
        const videoDownload = page.waitForEvent('download', { timeout: 60_000 });
        for (const fraction of [0, 0.5, 1]) {
          const frame = await page.evaluate(value => layoutTest.exportTransition(value, 0), fraction);
          await page.waitForFunction(value => layoutTest.exportState().frames >= value, frame, { timeout: 60_000 });
          await page.evaluate(() => layoutTest.holdExport(true));
          const snapshot = await page.evaluate(() => layoutTest.exportState());
          assert.ok(Math.abs(snapshot.mix - fraction) < 0.08);
          assert.ok(await page.evaluate(() => layoutTest.legendPixels()) > 1500);
          const image = await page.evaluate(() => layoutTest.exportImage());
          writeFileSync(join(output, 'export-unfold-' + fraction + '.png'), Buffer.from(image, 'base64'));
          await page.waitForTimeout(100);
          assert.deepEqual(await page.evaluate(() => layoutTest.exportState()), snapshot);
          await page.evaluate(() => layoutTest.holdExport(false));
        }
        const holdFrame = await page.evaluate(() => layoutTest.exportTransition(0.5, 2));
        await page.waitForFunction(value => layoutTest.exportState().frames >= value, holdFrame, { timeout: 60_000 });
        const held = await page.evaluate(() => layoutTest.exportState());
        assert.equal(held.mix, 1);
        assert.ok(Math.abs(held.polar - Math.PI / 2) < 0.01);
        assert.ok(Math.abs(held.azimuth) < 0.01);
        for (const [move, expectedPolar, expectedAzimuth] of [[3, Math.PI / 2, Math.PI / 2]]) {
          const frame = await page.evaluate(index => layoutTest.exportTransition(1, index), move);
          await page.waitForFunction(value => layoutTest.exportState().frames >= value, frame, { timeout: 60_000 });
          const snapshot = await page.evaluate(() => layoutTest.exportState());
          assert.equal(snapshot.mix, 1);
          assert.ok(Math.abs(snapshot.polar - expectedPolar) < 0.01);
          assert.ok(Math.abs(snapshot.azimuth - expectedAzimuth) < 0.01);
          assert.ok(await page.evaluate(() => layoutTest.pixels()) > 300);
        }
        const exportedVideo = readFileSync(await (await videoDownload).path());
        assert.ok(exportedVideo.length > 1000);
        assert.equal((await page.evaluate(() => layoutTest.state())).mix, 1);
        assert.equal((await page.evaluate(() => layoutTest.exportState())).active, false);
      }
      if (name === 'mobile') {
        await page.click('#exportSettings > summary');
        await page.click('#videoAdvanced > summary');
        await page.click('#videoAddPause');
        await page.locator('#videoViewList .video-pause-seconds').last().fill('1.5');
        await page.locator('#videoViewList .video-step-view').last().scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(output, 'mobile-camera-path-settings.png') });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        const beforeMobilePreview = await page.evaluate(() => layoutTest.previewState());
        await page.click('#videoPreviewBtn');
        await page.waitForFunction(() => layoutTest.previewState().active);
        await page.screenshot({ path: join(output, 'mobile-camera-path-preview.png') });
        await page.click('#videoPreviewStop');
        assert.deepEqual(await page.evaluate(() => layoutTest.previewState()), beforeMobilePreview);
      }
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.locator('.layout-modes label').filter({ hasText: /^Spiral$/ }).click();
      assert.equal((await page.evaluate(() => layoutTest.state())).moving, false);
      assert.equal((await page.evaluate(() => layoutTest.state())).mix, 0);
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log('Screenshots: ' + output);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

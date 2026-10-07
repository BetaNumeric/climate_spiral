const assert = require('node:assert/strict');
const { mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { chromium } = require('playwright');

const output = join(tmpdir(), 'climate-month-labels');
const cameraOnly = process.argv.includes('--camera-only');
mkdirSync(output, { recursive: true });
const hooks = `
window.monthTest = {
  ready: () => Boolean(spiralMesh && timelineStops.length),
  prepareCamera() {
    document.getElementById('smoothSpiralToggle').checked = false;
    updateDataVisualization();
    this.graph(false);
  },
  intermediate(mix) { layoutTransition = null; layoutMix = mix; applyLayout(); },
  camera: () => ({ moving: cameraController.isAnimating, polar: controls.getPolarAngle(),
    azimuth: controls.getAzimuthalAngle(), enabled: controls.enabled, zoom: activeCamera.zoom,
    distance: activeCamera.position.distanceTo(controls.target), target: controls.target.toArray() }),
  orbit(startPolar, startAzimuth, endPolar, endAzimuth) {
    cameraController.cancelAnimation();
    controls.enableDamping = false;
    const target = new THREE.Vector3(2, spiralHeight / 2 + 1, -3);
    controls.target.copy(target);
    activeCamera.zoom = 1.35;
    activeCamera.updateProjectionMatrix();
    activeCamera.position.copy(target).add(new THREE.Vector3().setFromSphericalCoords(83, startPolar, startAzimuth));
    controls.update();
    controls.dispatchEvent({ type: 'start' });
    activeCamera.position.copy(target).add(new THREE.Vector3().setFromSphericalCoords(83, endPolar, endAzimuth));
    controls.update();
    controls.dispatchEvent({ type: 'end' });
  },
  zoomOnly() {
    controls.dispatchEvent({ type: 'start' });
    activeCamera.zoom += 0.2;
    activeCamera.updateProjectionMatrix();
    controls.update();
    controls.dispatchEvent({ type: 'end' });
  },
  previewLock(enabled) { if (enabled) videoController.startPreview(); else videoController.stopPreview(); },
  graph(enabled) {
    if (isAnimating) toggleAnimation();
    setPlaybackPosition(totalIndices);
    document.querySelector('input[name="chartLayout"][value="' + (enabled ? 'graph' : 'spiral') + '"]').click();
    finishLayoutTransition();
  },
  view(polar, azimuth, perspective = false) {
    if (Boolean(activeCamera.isPerspectiveCamera) !== perspective) switchCamera(!perspective);
    controls.enableDamping = false;
    controls.update();
    activeCamera.position.copy(controls.target).add(new THREE.Vector3().setFromSphericalCoords(120, polar, azimuth));
    controls.update();
  },
  state() {
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(activeCamera.quaternion);
    const graphRight = generatedGeometryData.reduce((max, point) => Math.max(max, point.point.dot(right)), -Infinity);
    return {
      mesh: spiralMesh.uuid,
      width: monthlyLayout.width,
      guidesVisible: tempVerticalGroup.visible,
      allGuides: tempVerticalGroup.children.map(child => ({ id: child.uuid, x: child.position.x,
        z: child.position.z, opacity: child.material.opacity, side: child.guideSide })),
      guideTargets: getReferenceValues().map(value => monthlyLayout.center - getSpiralRadius(value)),
      guides: tempVerticalGroup.children.filter(child => child.guideSide === (Math.sin(controls.getAzimuthalAngle()) >= 0 ? 1 : -1)).map(child => ({
        label: child.name === 'vLabel', x: child.position.x, z: child.position.z,
        opacity: child.material.opacity,
        top: child.name === 'vLabel' ? child.position.y : child.position.y + child.scale.y / 2,
      })),
      guideTop: spiralHeight + 2,
      framingHeight: getFramingHeight(),
      labels: monthLabelsGroup.children.map(label => ({
        x: label.position.x, opacity: label.material.opacity,
        facing: Math.abs(label.quaternion.dot(activeCamera.quaternion)),
      })),
      yearGap: Math.min(...yearLabelsGroup.children.map(label => label.getWorldPosition(new THREE.Vector3()).dot(right))) - graphRight,
      observations: timelineStops.map(stop => {
        const point = generatedGeometryData[stop / (CONFIG.radialSegments * 6)];
        return [point.decimalYear, point.anomaly];
      }),
    };
  },
  pixels() {
    renderer.render(scene, activeCamera);
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
    const context = canvas.getContext('2d'); context.drawImage(renderer.domElement, 0, 0, 320, 240);
    const data = context.getImageData(0, 0, 320, 240).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) if (Math.max(data[i], data[i + 1], data[i + 2]) > 20) count++;
    return count;
  },
};
`;

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
  try {
    for (const [name, viewport] of Object.entries({ desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 } })) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: name === 'mobile' ? 2 : 1,
        hasTouch: name === 'mobile', serviceWorkers: 'block' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/index.html', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()).replace('// --- Configuration ---', hooks + '// --- Configuration ---') });
      });
      await page.goto('http://127.0.0.1:8000/index.html');
      await page.waitForFunction(() => window.monthTest?.ready());
      if (cameraOnly) {
        // Fewer tube samples keep native input timing reliable with software rendering.
        await page.evaluate(() => monthTest.prepareCamera());
      } else {
        const observations = (await page.evaluate(() => monthTest.state())).observations;
        await page.evaluate(() => monthTest.graph(true));
        for (const [view, polar, azimuth, visible] of [
          ['top', 0.001, 0, true],
          ['tilted', Math.PI / 3, 0, true],
          ['front', Math.PI / 2, 0, true],
          ['edge', Math.PI / 2, Math.PI / 2, false],
        ]) {
          await page.evaluate(([polar, azimuth]) => monthTest.view(polar, azimuth), [polar, azimuth]);
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const state = await page.evaluate(() => monthTest.state());
          assert.equal(state.labels.length, 12);
          state.guides.forEach((guide, index) => {
            assert.ok(Math.abs(guide.x - (view === 'edge' ? -state.width / 2 : 0)) < 1e-8);
            assert.ok(Math.abs(guide.z - state.guideTargets[Math.floor(index / 2)]) < 1e-8);
            assert.equal(guide.top, state.guideTop + Number(guide.label));
            assert.ok(view === 'edge' ? guide.opacity > 0.35 : guide.opacity < 0.01, view + ': value guide ' + guide.opacity);
          });
          assert.deepEqual(state.observations, observations);
          state.labels.forEach((label, index) => {
            assert.ok(Math.abs(label.x - state.width * ((index + 0.5) / 12 - 0.5)) < 1e-8);
            assert.ok(label.facing > 0.99999, view + ': facing ' + label.facing);
            assert.ok(visible ? label.opacity > 0.55 : label.opacity < 0.01, view + ': ' + label.opacity);
          });
          assert.ok(await page.evaluate(() => monthTest.pixels()) > 150);
          await page.screenshot({ path: join(output, name + '-' + view + '.png') });
        }
        let previousOpacity = 0.6;
        let previousGuideOpacity = 0;
        for (const degrees of [0, 5, 10, 20, 40, 50, 60, 70, 80, 90, 120, 180, 240, 270, 320]) {
          await page.evaluate(angle => monthTest.view(Math.PI / 2, angle * Math.PI / 180), degrees);
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const state = await page.evaluate(() => monthTest.state());
          assert.ok(state.yearGap > 2, 'Year labels crossed the graph at ' + degrees + ' degrees');
          if (degrees <= 90) {
            const opacity = state.labels[0].opacity;
            assert.ok(opacity <= previousOpacity + 1e-8);
            if (degrees === 60) assert.ok(opacity > 0.1 && opacity < 0.55);
            previousOpacity = opacity;
            const guideOpacity = state.guides[1].opacity;
            assert.ok(guideOpacity >= previousGuideOpacity - 1e-8);
            if (degrees === 10) assert.ok(guideOpacity > 0 && guideOpacity < 0.6);
            previousGuideOpacity = guideOpacity;
          }
          if (degrees === 180) assert.ok(state.guides.every(guide => guide.opacity < 0.01));
          if (degrees === 270) assert.ok(state.guides.every(guide => guide.opacity > 0.35));
          if (degrees === 60 || degrees === 120) await page.screenshot({ path: join(output, name + '-rotation-' + degrees + '.png') });
        }
        await page.evaluate(() => monthTest.view(Math.PI / 3, 0, true));
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.ok((await page.evaluate(() => monthTest.state())).labels.every(label => label.facing > 0.99999 && label.opacity > 0.55));
        for (const azimuth of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
          await page.evaluate(angle => monthTest.view(Math.PI / 2, angle, true), azimuth);
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const state = await page.evaluate(() => monthTest.state());
          assert.ok(state.guides.every(guide => Math.abs(Math.sin(azimuth)) > 0.9 ? guide.opacity > 0.35 : guide.opacity < 0.01));
        }
        for (const azimuth of [Math.PI / 3, -Math.PI / 3]) {
          await page.evaluate(angle => monthTest.view(Math.PI / 2, angle), azimuth);
          let ids;
          let previousDistance = Infinity;
          for (const mix of [0, 0.25, 0.5, 0.75, 0.95, 1, 0.5, 0]) {
            await page.evaluate(value => monthTest.intermediate(value), mix);
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const state = await page.evaluate(() => monthTest.state());
            ids ??= state.allGuides.map(guide => guide.id);
            assert.deepEqual(state.allGuides.map(guide => guide.id), ids, 'Guides must be reused through the transition');
            const [a, , b] = state.allGuides;
            const distance = Math.hypot(a.x - b.x, a.z - b.z);
            if (mix > 0 && previousDistance > 0.001) assert.ok(distance <= previousDistance + 1e-8);
            previousDistance = distance;
            if (mix === 1) {
              assert.ok(distance < 1e-8);
              assert.ok(Math.abs(a.x + Math.sign(Math.sin(azimuth)) * state.width / 2) < 1e-8);
              for (let i = 0; i < state.allGuides.length; i += 4) {
                assert.ok(Math.abs(state.allGuides[i].opacity + state.allGuides[i + 2].opacity - 0.4) < 1e-8);
              }
            }
            if (mix === 0.75) await page.screenshot({ path: join(output, name + '-merge-' + Math.sign(azimuth) + '.png') });
          }
        }
        await page.evaluate(() => monthTest.intermediate(1));
        await page.evaluate(() => document.getElementById('helpersToggle').click());
        assert.equal((await page.evaluate(() => monthTest.state())).guidesVisible, false);
        await page.evaluate(() => document.getElementById('helpersToggle').click());
        assert.equal((await page.evaluate(() => monthTest.state())).guidesVisible, true);
        if (name === 'desktop') {
          const datasets = await page.locator('#datasetSelect option').evaluateAll(options => options.map(option => option.value));
          for (const dataset of datasets.filter(key => key !== 'temperature' && key !== 'local')) {
            const previousMesh = (await page.evaluate(() => monthTest.state())).mesh;
            await page.selectOption('#datasetSelect', dataset, { force: true });
            await page.waitForFunction(mesh => monthTest.state().mesh !== mesh, previousMesh);
            await page.evaluate(() => { monthTest.graph(true); monthTest.view(Math.PI / 2, Math.PI / 2); });
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const state = await page.evaluate(() => monthTest.state());
            assert.equal(state.guides.length, state.guideTargets.length * 2);
            state.guides.forEach((guide, index) => {
              assert.ok(Math.abs(guide.z - state.guideTargets[Math.floor(index / 2)]) < 1e-8);
              assert.ok(guide.opacity > 0.35, dataset + ': value guide ' + guide.opacity);
            });
            const minPixels = Math.max(30, 150 * (state.guideTop - 2) / state.framingHeight);
            assert.ok(await page.evaluate(() => monthTest.pixels()) > minPixels,
              dataset + ': side-view graph is blank or unexpectedly small');
            await page.screenshot({ path: join(output, name + '-values-' + dataset + '.png') });
          }
        }
        await page.evaluate(() => { monthTest.graph(false); monthTest.view(Math.PI / 2, 0); });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.ok((await page.evaluate(() => monthTest.state())).labels.every(label => label.opacity === 0));
        assert.ok((await page.evaluate(() => monthTest.state())).allGuides.every(guide => guide.opacity >= 0.4));
      }

      for (const graph of [false, true]) {
        await page.evaluate(graph => monthTest.graph(graph), graph);
        for (const perspective of [false, true]) {
          await page.evaluate(perspective => monthTest.view(Math.PI / 3, -Math.PI / 3, perspective), perspective);
          for (const [key, polar, azimuth] of [['1', 0, 0], ['2', Math.PI / 2, 0], ['3', Math.PI / 2, Math.PI / 2],
            ['4', Math.PI / 2, -Math.PI / 2], ['5', Math.PI / 2, Math.PI]]) {
            await page.keyboard.press(key);
            assert.ok((await page.evaluate(() => monthTest.camera())).moving);
            await page.waitForFunction(() => !monthTest.camera().moving);
            const camera = await page.evaluate(() => monthTest.camera());
            assert.ok(camera.enabled && Math.abs(camera.polar - polar) < 1e-5
              && Math.abs(Math.atan2(Math.sin(camera.azimuth - azimuth), Math.cos(camera.azimuth - azimuth))) < 1e-5);
            if (key === '4' || key === '5') {
              assert.ok(await page.evaluate(() => monthTest.pixels()) > 100);
              await page.screenshot({ path: join(output, name + '-camera-' + key + (graph ? '-unwrapped' : '-spiral') + (perspective ? '-perspective' : '') + '.png') });
            }
          }
          for (const [view, startPolar, startAzimuth, endPolar, endAzimuth, polar, azimuth] of [
            ['top', 0.25, 0.7, 0.08, 0.7, 0, 0],
            ['front', Math.PI / 2, 0.3, Math.PI / 2, 0.08, Math.PI / 2, 0],
            ['right', Math.PI / 2, 1.3, Math.PI / 2, Math.PI / 2 - 0.08, Math.PI / 2, Math.PI / 2],
            ['left', Math.PI / 2, -1.3, Math.PI / 2, -Math.PI / 2 + 0.08, Math.PI / 2, -Math.PI / 2],
            ['back', Math.PI / 2, -Math.PI + 0.3, Math.PI / 2, -Math.PI + 0.08, Math.PI / 2, Math.PI],
          ]) {
            await page.evaluate(args => monthTest.orbit(...args), [startPolar, startAzimuth, endPolar, endAzimuth]);
            await page.waitForFunction(([polar, azimuth]) => {
              const camera = monthTest.camera();
              return !camera.moving && Math.abs(camera.polar - polar) < 1e-5
                && Math.abs(Math.atan2(Math.sin(camera.azimuth - azimuth), Math.cos(camera.azimuth - azimuth))) < 1e-5;
            }, [polar, azimuth]);
            const camera = await page.evaluate(() => monthTest.camera());
            assert.ok(Math.abs(camera.polar - polar) < 1e-5
              && Math.abs(Math.atan2(Math.sin(camera.azimuth - azimuth), Math.cos(camera.azimuth - azimuth))) < 1e-5, view);
            assert.ok(Math.abs(camera.distance - 83) < 1e-5 && Math.abs(camera.zoom - 1.35) < 1e-5, view);
            assert.ok(Math.abs(camera.target[0] - 2) < 1e-8 && Math.abs(camera.target[2] + 3) < 1e-8, view);
          }
          await page.evaluate(() => monthTest.orbit(Math.PI / 2, 0.4, Math.PI / 2, 0.2));
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          let camera = await page.evaluate(() => monthTest.camera());
          assert.equal(camera.moving, false);
          assert.ok(Math.abs(camera.azimuth - 0.2) < 1e-5);
          await page.evaluate(() => { monthTest.view(Math.PI / 2, 0.08); monthTest.zoomOnly(); });
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          camera = await page.evaluate(() => monthTest.camera());
          assert.equal(camera.moving, false);
          assert.ok(Math.abs(camera.azimuth - 0.08) < 1e-5);

          await page.keyboard.press('ArrowUp');
          await page.waitForFunction(() => !monthTest.camera().moving && monthTest.camera().polar < 1e-5);
          await page.keyboard.press('ArrowLeft');
          await page.keyboard.press('ArrowRight');
          assert.equal((await page.evaluate(() => monthTest.camera())).moving, false, 'Horizontal arrows do not rotate the top view');
          await page.keyboard.press('ArrowDown');
          await page.waitForFunction(() => !monthTest.camera().moving && Math.abs(monthTest.camera().polar - Math.PI / 2) < 1e-5);
          for (const [key, angles] of [['ArrowRight', [Math.PI / 2, Math.PI, -Math.PI / 2, 0]],
            ['ArrowLeft', [-Math.PI / 2, Math.PI, Math.PI / 2, 0]]]) {
            for (const azimuth of angles) {
              await page.keyboard.press(key);
              await page.waitForFunction(azimuth => {
                const camera = monthTest.camera();
                return !camera.moving && Math.abs(Math.atan2(Math.sin(camera.azimuth - azimuth), Math.cos(camera.azimuth - azimuth))) < 1e-5;
              }, azimuth);
            }
          }
          await page.keyboard.press('1');
          await page.waitForFunction(() => !monthTest.camera().moving && monthTest.camera().polar < 1e-5);
          for (const azimuth of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0]) {
            await page.mouse.click(viewport.width / 2, viewport.height / 2, { button: 'right', clickCount: 2 });
            await page.waitForFunction(azimuth => {
              const camera = monthTest.camera();
              return !camera.moving && Math.abs(camera.polar - Math.PI / 2) < 1e-5
                && Math.abs(Math.atan2(Math.sin(camera.azimuth - azimuth), Math.cos(camera.azimuth - azimuth))) < 1e-5;
            }, azimuth);
          }
        }
      }
      await page.mouse.dblclick(viewport.width / 2, viewport.height / 2);
      await page.waitForFunction(() => !monthTest.camera().moving);
      assert.ok((await page.evaluate(() => monthTest.camera())).polar < 1e-5);
      const beforeIgnored = await page.evaluate(() => monthTest.camera());
      await page.keyboard.press('Control+2');
      await page.evaluate(() => {
        const input = document.getElementById('videoTransition');
        for (const key of ['4', '5', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
          input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
        }
        monthTest.previewLock(true);
        for (const key of ['4', '5', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
          document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
        }
        monthTest.previewLock(false);
      });
      const afterIgnored = await page.evaluate(() => monthTest.camera());
      assert.equal(afterIgnored.moving, false);
      assert.equal(afterIgnored.enabled, beforeIgnored.enabled);
      assert.deepEqual(afterIgnored.target, beforeIgnored.target);
      for (const key of ['polar', 'azimuth', 'distance', 'zoom']) {
        assert.ok(Math.abs(afterIgnored[key] - beforeIgnored[key]) < 1e-8, key);
      }
      // Panning must not count as the first half of a double right-click.
      await page.evaluate(() => document.getElementById('freeCameraToggle').click());
      await page.mouse.move(100, 200);
      await page.mouse.down({ button: 'right' });
      await page.mouse.move(160, 200, { steps: 4 });
      await page.mouse.up({ button: 'right' });
      await page.mouse.click(160, 200, { button: 'right' });
      assert.equal((await page.evaluate(() => monthTest.camera())).moving, false);
      await page.evaluate(() => document.getElementById('freeCameraToggle').click());
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.keyboard.press('2');
      assert.equal((await page.evaluate(() => monthTest.camera())).moving, false);
      assert.ok(Math.abs((await page.evaluate(() => monthTest.camera())).polar - Math.PI / 2) < 1e-5);
      await page.evaluate(() => monthTest.orbit(Math.PI / 2, 0.3, Math.PI / 2, 0.08));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal((await page.evaluate(() => monthTest.camera())).moving, false);
      assert.ok(Math.abs((await page.evaluate(() => monthTest.camera())).azimuth) < 1e-5);
      if (name === 'mobile') {
        await page.touchscreen.tap(viewport.width / 2, viewport.height / 2);
        await page.touchscreen.tap(viewport.width / 2, viewport.height / 2);
        await page.waitForFunction(() => monthTest.camera().polar < 1e-5);
      }
      assert.deepEqual(errors, []);
      console.log(name + (cameraOnly ? ': camera views, quarter-turn cycling, arrows, snapping, and input locks passed'
        : ': labels, merging guides, magnetic camera snap, shortcuts, and visibility passed'));
      await context.close();
    }
    console.log('Screenshots: ' + output);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

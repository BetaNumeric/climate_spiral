const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const hooks = `
window.settingTest = {
  ready: () => Boolean(spiralMesh && timelineStops.length),
  prepare() {
    setPlaybackPosition(timelineStops.find(index => Math.abs(generatedGeometryData[Math.floor(index / (CONFIG.radialSegments * 6))].decimalYear - (1952 + 5 / 12)) < 1e-6));
    controls.enableDamping = false;
    layoutTransition = null; layoutMix = 1; applyLayout();
  },
  state() {
    return { date: generatedGeometryData[Math.floor(animationIndex / (CONFIG.radialSegments * 6))].decimalYear,
      mix: layoutMix, color: document.getElementById('colorMode').value, playing: isAnimating };
  },
  removeInterpolatedMonth() {
    this.change('interpolationToggle', true);
    const stop = timelineStops.find(index => Math.abs(generatedGeometryData[Math.floor(index / (CONFIG.radialSegments * 6))].decimalYear - 1951.5) < 1e-6);
    setPlaybackPosition(stop);
    toggleAnimation();
    const result = this.change('interpolationToggle', false);
    toggleAnimation();
    return result;
  },
  change(id, value, type = 'change') {
    const before = this.state(), input = document.getElementById(id);
    if (input.type === 'checkbox') input.checked = value; else input.value = value;
    input.dispatchEvent(new Event(type, { bubbles: true }));
    const after = this.state();
    let bufferError = 0;
    if (spiralLine) {
      const center = spiralLine.centerGeometry, instances = spiralLine.geometry.attributes;
      let segment = 0;
      for (let i = 0; i < center.index.count; i += 2) {
        const a = center.index.array[i], b = center.index.array[i + 1];
        const positions = center.attributes.position, colors = center.attributes.color;
        if (a === b || [0, 1, 2].every(axis => positions.array[a * 3 + axis] === positions.array[b * 3 + axis])) continue;
        for (const [vertex, end] of [[a, false], [b, true]]) {
          const position = end ? instances.instanceEnd : instances.instanceStart;
          const color = end ? instances.instanceColorEnd : instances.instanceColorStart;
          bufferError = Math.max(bufferError,
            Math.abs(position.getX(segment) - positions.getX(vertex)), Math.abs(position.getY(segment) - positions.getY(vertex)),
            Math.abs(position.getZ(segment) - positions.getZ(vertex)), Math.abs(color.getX(segment) - colors.getX(vertex)),
            Math.abs(color.getY(segment) - colors.getY(vertex)), Math.abs(color.getZ(segment) - colors.getZ(vertex)));
        }
        segment++;
      }
    }
    const hidden = scene.children.filter(object => !object.isLight && object !== spiralMesh && object !== spiralLine);
    const visible = hidden.map(object => object.visible);
    hidden.forEach(object => object.visible = false);
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
    const context = canvas.getContext('2d');
    renderer.render(scene, activeCamera);
    context.drawImage(renderer.domElement, 0, 0, 320, 240);
    const first = context.getImageData(0, 0, 320, 240).data;
    let lit = 0;
    for (let i = 0; i < first.length; i += 4) {
      if (Math.max(first[i], first[i+1], first[i+2]) > 20) lit++;
    }
    hidden.forEach((object, i) => object.visible = visible[i]);
    return { before, after, lit, bufferError };
  },
};
`;

// Sparse imported GISTEMP-style history also exercises the otherwise hidden interpolation setting.
const fixture = [1950, 1952, 1954].map((year, i) => year + ' '
  + Array.from({ length: 12 }, (_, month) => Math.round(-30 + 15 * i + 10 * Math.sin(month))).join(' ')).join('\n');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
  try {
    for (const [name, viewport] of Object.entries({ desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 } })) {
      const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/data/GLB.Ts+dSST.txt', route => route.fulfill({ body: fixture, contentType: 'text/plain' }));
      await page.route('**/index.html', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()).replace('// --- Configuration ---', hooks + '// --- Configuration ---') });
      });
      await page.goto('http://127.0.0.1:8000/index.html');
      await page.waitForFunction(() => window.settingTest?.ready());
      await page.evaluate(() => settingTest.prepare());
      const cases = [
        ['colorMode', 'year'], ['tubeToggle', false], ['thicknessSlider', '0.3', 'input'],
        ['curveSegments', '12'], ['smoothSpiralToggle', false], ['smoothSpiralToggle', true],
        ['colorMode', 'annual'], ['colorMode', 'seasonal'], ['colorMode', 'single'],
        ['singleColor', '#34ccaa', 'input'], ['helpersToggle', false], ['helpersToggle', true],
        ['freeCameraToggle', true], ['freeCameraToggle', false],
        ['orthoToggle', false], ['orthoToggle', true], ['tubeToggle', true],
        ['tubeSides', '12'], ['thicknessSlider', '0.8', 'input'], ['tubeToggle', false],
        ['interpolationToggle', true], ['interpolationToggle', false],
      ];
      for (const [id, value, type] of cases) {
        const result = await page.evaluate(({ id, value, type }) => settingTest.change(id, value, type), { id, value, type });
        assert.ok(result.bufferError < 1e-6, name + ': stale line position/color buffers for ' + id);
        assert.ok(result.lit > 30, name + ': canvas blank for ' + id);
        for (const key of ['date', 'mix', 'playing', ...(id === 'colorMode' ? [] : ['color'])]) {
          assert.equal(result.after[key], result.before[key], name + ': ' + id + ' reset ' + key);
        }
      }
      const removedMonth = await page.evaluate(() => settingTest.removeInterpolatedMonth());
      assert.equal(removedMonth.after.date, 1952, 'Removing an interpolated month chooses the nearest actual month');
      assert.equal(removedMonth.after.playing, true, 'Interpolation must not pause playback');
      assert.equal(removedMonth.after.mix, removedMonth.before.mix);
      assert.equal(removedMonth.after.color, removedMonth.before.color);
      assert.deepEqual(errors, []);
      console.log(name + ': width, tube sides/mode, smoothing/detail, palettes/picker, annotations, camera modes, and interpolation retain state from the first frame');
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

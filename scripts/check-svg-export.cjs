const assert = require('node:assert/strict');
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { chromium } = require('playwright');
const output = join(tmpdir(), 'climate-svg-export');
mkdirSync(output, { recursive: true });

const hooks = `
window.svgTest = {
  ready: () => Boolean(spiralMesh && generatedGeometryData?.length),
  pause() { setPlaybackPosition(timelineStops[Math.floor(timelineStops.length / 2)]); controls.enableDamping = false; },
  morph(mix) { layoutTransition = null; layoutMix = mix; applyLayout(); },
  lastYearMonths: () => seasonalColorModel.yearlyMonthCountAt(generatedGeometryData.at(-1).decimalYear),
  legendPercent() {
    const last = generatedGeometryData.at(-1), display = getActiveColorDisplay();
    const mode = document.getElementById('colorMode').value;
    const value = mode === 'year' ? calendarYear(last.decimalYear) : mode === 'seasonal' ? last.seasonalAnomaly
      : mode === 'annual' ? last.yearlyAnomaly : last.displayValue;
    return display.showMarker && !last.spiralMissing && Number.isFinite(value) ? getLegendPercent(value, display) : null;
  },
  state() {
    const hash = array => { let n = 2166136261; for (const value of array) n = Math.imul(n ^ Math.round(value * 10000), 16777619); return n; };
    return { dataset: currentDatasetKey, playing: isAnimating, index: animationIndex, mix: layoutMix,
      camera: activeCamera.position.toArray(), target: controls.target.toArray(),
      positions: hash(spiralMesh.geometry.attributes.position.array),
      colors: hash(spiralMesh.geometry.attributes.color.array),
      mesh: spiralMesh.uuid, mode: document.getElementById('colorMode').value };
  },
};
`;

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
  try {
    for (const [name, viewport] of Object.entries({ desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 } })) {
      if (process.env.CLIMATE_SVG_VIEWPORT && name !== process.env.CLIMATE_SVG_VIEWPORT) continue;
      const context = await browser.newContext({ viewport, isMobile: name === 'mobile', hasTouch: name === 'mobile',
        serviceWorkers: 'block', acceptDownloads: true, reducedMotion: 'reduce' });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/index.html', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()).replace('// --- Configuration ---', hooks + '// --- Configuration ---') });
      });
      await page.goto('http://127.0.0.1:8000/index.html');
      await page.waitForFunction(() => window.svgTest?.ready());
      await page.evaluate(() => svgTest.pause());
      await page.click('#settingsBtn'); await page.click('#exportSettings > summary');

      async function download(label) {
        if (!await page.locator('#settingsPanel').isVisible()) await page.click('#settingsBtn');
        if (!await page.locator('#exportSettings').evaluate(element => element.open)) await page.click('#exportSettings > summary');
        const before = await page.evaluate(() => svgTest.state());
        const expectedPercent = await page.evaluate(() => svgTest.legendPercent());
        await page.locator('#svgExportBtn').scrollIntoViewIfNeeded();
        const [result] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#svgExportBtn')]);
        assert.match(result.suggestedFilename(), /^climate-spiral-[a-z]+\.svg$/);
        const path = join(output, name + '-' + label + '.svg');
        await result.saveAs(path);
        const after = await page.evaluate(() => svgTest.state());
        for (const key of ['camera', 'target']) {
          assert.ok(after[key].every((value, index) => Math.abs(value - before[key][index]) < 1e-9),
            'SVG export must not move the ' + key);
        }
        assert.deepEqual({ ...after, camera: before.camera, target: before.target }, before, 'SVG export must not change the scene');
        assert.equal(await page.locator('#svgExportStatus').textContent(), '');
        const text = readFileSync(path, 'utf8');
        const checked = await page.evaluate(async text => {
          const xml = new DOMParser().parseFromString(text, 'image/svg+xml');
          if (xml.querySelector('parsererror')) throw new Error('Malformed SVG');
          const marker = xml.querySelector('#legend-marker');
          if (marker && (marker.getAttribute('fill') !== '#ffffff' || marker.hasAttribute('stroke')
            || marker.getAttribute('width') !== '2' || marker.getAttribute('height') !== '24')) {
            throw new Error('Legend marker must be a small white tick without an outline');
          }
          const guides = xml.querySelector('#reference-guides');
          if (guides) {
            const follows = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
            if (!follows(xml.querySelector('#spiral-data'), guides)
              || !follows(guides, xml.querySelector('#reference-labels'))) throw new Error('Reference circles must overlay the spiral below their labels');
            for (const circle of guides.children) {
              if (circle.getAttribute('stroke') !== '#808080' || circle.getAttribute('stroke-width') !== '0.6') {
                throw new Error('Reference circles must be thin and gray');
              }
            }
            for (const label of xml.querySelectorAll('#reference-labels text')) {
              if (label.getAttribute('fill') !== '#ffffff' || label.getAttribute('stroke') !== '#000000'
                || label.getAttribute('stroke-width') !== '1.5') throw new Error('Reference labels must be white with a thin black outline');
            }
          }
          const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
          try {
            const image = new Image(); image.src = url; await image.decode();
            const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
            const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
            const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            let lit = 0, titlePixels = 0, headlinePixels = 0;
            for (let i = 0; i < pixels.length; i += 4) {
              if (Math.max(pixels[i], pixels[i+1], pixels[i+2]) <= 20) continue;
              lit++;
              const y = Math.floor(i / 4 / canvas.width);
              if (y >= 20 && y <= 60) titlePixels++;
              if (y >= 1008 && y <= 1040) headlinePixels++;
            }
            return { namespace: xml.documentElement.namespaceURI, title: xml.querySelector('title').textContent,
              paths: xml.querySelectorAll('#spiral-data path').length, months: xml.querySelectorAll('#month-labels text').length,
              guides: xml.querySelectorAll('#reference-guides circle').length, images: xml.querySelectorAll('image, foreignObject, script').length,
              metadata: JSON.parse(xml.querySelector('metadata').textContent),
              markerPercent: marker ? (Number(marker.getAttribute('x')) + 1 - 180) / 8.4 : null,
              width: canvas.width, height: canvas.height, lit, titlePixels, headlinePixels, png: canvas.toDataURL().split(',')[1] };
          } finally { URL.revokeObjectURL(url); }
        }, text);
        assert.equal(checked.namespace, 'http://www.w3.org/2000/svg');
        assert.ok(checked.paths > 0 && checked.lit > 2000);
        assert.ok(checked.titlePixels > 100 && checked.headlinePixels > 100, 'SVG titles and readouts must be visible: ' + label);
        assert.equal(checked.images, 0);
        if (expectedPercent === null) assert.equal(checked.markerPercent, null, 'Unavailable or single-color legends must omit the marker');
        else assert.ok(checked.markerPercent !== null && Math.abs(checked.markerPercent - expectedPercent) < 1e-8,
          'Marker must match the final recorded month, not the paused timeline position');
        assert.equal(checked.width, 1200); assert.equal(checked.height, 1200);
        assert.ok(!/NaN|Infinity|undefined/.test(text));
        writeFileSync(join(output, name + '-' + label + '.png'), Buffer.from(checked.png, 'base64'));
        if (!await page.locator('#settingsPanel').isVisible()) await page.click('#settingsBtn');
        return { text, checked };
      }

      const original = await download('temperature-value');
      assert.equal(original.checked.months, 12); assert.equal(original.checked.guides, 3);
      assert.notEqual(original.checked.markerPercent, null);
      await page.evaluate(() => svgTest.morph(1));
      const unwrapped = await download('temperature-from-unwrapped');
      assert.equal(unwrapped.text, original.text, 'The vector spiral must not depend on the on-screen layout');
      await page.click('#viewSettings > summary');
      await page.selectOption('#colorMode', 'year');
      const year = await download('temperature-year');
      assert.notEqual(year.text, original.text);
      assert.equal(year.checked.markerPercent, 100);
      await page.selectOption('#colorMode', 'seasonal');
      assert.notEqual((await download('temperature-monthly')).checked.markerPercent, null);
      await page.selectOption('#colorMode', 'annual');
      const annual = await download('temperature-annual');
      const monthCount = await page.evaluate(() => svgTest.lastYearMonths());
      if (monthCount === 12) assert.doesNotMatch(annual.text, /Partial year|No data/);
      else assert.match(annual.text, new RegExp((monthCount > 0 ? 'Partial year' : 'No data') + '.*' + monthCount + '/12 months'));
      assert.equal(annual.checked.markerPercent !== null, monthCount > 0);
      await page.selectOption('#colorMode', 'single');
      await page.uncheck('#tubeToggle');
      await page.uncheck('#helpersToggle');
      const single = await download('temperature-single');
      assert.equal(single.checked.months, 0); assert.equal(single.checked.guides, 0);
      assert.equal(single.checked.paths, 1, 'Complete single-color history must be one continuous SVG path');
      await page.check('#helpersToggle'); await page.selectOption('#colorMode', 'value');
      for (const [dataset, source] of [['arctic', 'NSIDC'], ['oceanph', 'Copernicus'], ['arcticvolume', 'PIOMAS']]) {
        const previousMesh = (await page.evaluate(() => svgTest.state())).mesh;
        await page.selectOption('#datasetSelect', dataset);
        await page.waitForFunction(({ key, previousMesh }) => svgTest.ready() && svgTest.state().dataset === key
          && svgTest.state().mesh !== previousMesh, { key: dataset, previousMesh });
        await page.evaluate(() => svgTest.pause());
        if (dataset === 'arcticvolume') await page.selectOption('#colorMode', 'annual');
        const result = await download(dataset);
        assert.ok(result.checked.metadata.source.includes(source));
        if (dataset === 'arcticvolume') {
          assert.notEqual(result.checked.markerPercent, null, 'A sparse last year still needs its annual-color marker');
          const count = await page.evaluate(() => svgTest.lastYearMonths());
          if (count < 12) assert.match(result.text, new RegExp('Partial year.*' + count + '/12 months'));
        }
      }
      await page.selectOption('#datasetSelect', 'local');
      await page.waitForFunction(() => document.getElementById('svgExportBtn').disabled);
      await page.locator('#fileUpload').setInputFiles({ name: 'station.json', mimeType: 'application/json',
        buffer: readFileSync('data/weather-stations/GM/GM000003319.json') });
      await page.waitForFunction(() => svgTest.ready() && !document.getElementById('svgExportBtn').disabled);
      await page.evaluate(() => svgTest.pause());
      const station = await download('station-annual');
      assert.match(station.checked.metadata.source, /NOAA/);
      await page.locator('#svgExportBtn').scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(output, name + '-settings.png') });
      assert.ok(await page.locator('#settingsPanel').evaluate(element => element.scrollWidth <= element.clientWidth));
      assert.deepEqual(errors, []);
      console.log(name + ': native SVG downloads, real datasets and colors, camera/layout independence, scene retention, editable XML, and nonblank rasterization passed');
      await context.close();
    }
  } finally { await browser.close(); }
  console.log('SVGs and previews: ' + output);
})().catch(error => { console.error(error); process.exitCode = 1; });

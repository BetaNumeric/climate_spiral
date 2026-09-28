const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('C:/Users/timpa/AppData/Roaming/Python/Python314/site-packages/playwright/driver/package');
const root = 'http://127.0.0.1:8000/';
const output = path.join(process.env.TEMP, 'climate-enso-check');
fs.mkdirSync(output, { recursive: true });
const source = fs.readFileSync('data/Rnino34.ascii.txt', 'utf8');
const html = fs.readFileSync('index.html', 'utf8').replace(/(<script type="module">)([\s\S]*?)(<\/script>)/,
    (_, start, code, end) => start + code + `
    window.check = {
        get data() { return generatedGeometryData; }, get total() { return totalIndices; },
        get stops() { return timelineStops; }, get index() { return animationIndex; },
        get mesh() { return spiralMesh; }, get radial() { return CONFIG.radialSegments; },
        seek: setPlaybackPosition, apply: applyDataText, fetch: fetchRemoteData,
        pixels() {
            renderer.render(scene, activeCamera);
            const gl = renderer.getContext(), pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
            gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            let count = 0, hash = 0;
            for (let i = 0; i < pixels.length; i += 4) {
                if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 35) count++;
                hash = (hash * 31 + pixels[i] + pixels[i + 1] + pixels[i + 2]) >>> 0;
            }
            return { count, hash };
        }
    };
` + end);
const errors = [];
async function open(browser, width = 1280, height = 800, instrument = true) {
    const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: instrument ? 'block' : 'allow',
        isMobile: width < 500, hasTouch: width < 500, deviceScaleFactor: width < 500 ? 2 : 1 });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    if (instrument) await page.route(root, route => route.fulfill({ contentType: 'text/html', body: html }));
    await page.goto(root);
    await page.waitForFunction(() => document.querySelector('#fetchStatus').textContent === 'Local Data');
    await page.locator('#settingsBtn').click();
    return { page, context };
}
async function select(page, key) {
    if (!(await page.locator('#settingsPanel').evaluate(el => el.classList.contains('visible')))) await page.locator('#settingsBtn').click();
    await page.selectOption('#datasetSelect', key);
    await page.waitForFunction(() => document.querySelector('#fetchStatus').textContent === 'Local Data');
    await page.evaluate(() => check.seek(check.total));
}
(async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
    try {
        const { page, context } = await open(browser);
        assert.equal(await page.locator('#datasetSelect option').count(), 8);
        await select(page, 'enso');
        assert.equal(await page.locator('#infoTemp').textContent(), '+1.67 \u00b0C');
        assert.equal(await page.locator('#infoMonth').textContent(), 'Aug');
        assert.deepEqual(await page.locator('.legend-labels span').allTextContents(), ['-3\u00b0C', '0\u00b0C', '+3\u00b0C']);
        const audit = await page.evaluate(() => {
            const mismatches = [];
            for (const index of check.stops) {
                check.seek(index);
                const data = check.data[index / (check.radial * 6)];
                const label = (data.anomaly > 0 ? '+' : '') + data.anomaly.toFixed(2) + ' \u00b0C';
                if (document.querySelector('#infoTemp').textContent !== label
                    || Math.abs(Math.hypot(data.point.x, data.point.z) - (12 + data.anomaly * 2)) > 1e-6) mismatches.push(index);
                if (data.anomaly < 0 && data.color.b <= data.color.r) mismatches.push('cold');
                if (data.anomaly > 0 && data.color.r <= data.color.b) mismatches.push('warm');
                if (data.anomaly === 0 && data.color.getHexString() !== 'ffffff') mismatches.push('zero');
            }
            return { mismatches, count: check.stops.length,
                finite: ['position', 'normal', 'color'].every(name => [...check.mesh.geometry.attributes[name].array].every(Number.isFinite)) };
        });
        assert.deepEqual(audit, { mismatches: [], count: 921, finite: true });
        await page.evaluate(() => check.seek(0));
        assert.equal(await page.locator('#infoMonth').textContent(), 'Dec');
        assert.equal(await page.locator('#infoTemp').textContent(), '-1.03 \u00b0C');
        await page.locator('#stepForwardBtn').click();
        assert.equal(await page.locator('#infoYear').textContent(), '1950');
        assert.equal(await page.locator('#infoMonth').textContent(), 'Jan');
        await page.locator('#stepBackBtn').click();
        assert.equal(await page.locator('#infoMonth').textContent(), 'Dec');
        await page.locator('#settingsPanel .close-btn').click();
        await page.locator('#playBtn').click();
        await page.waitForTimeout(300);
        assert((await page.evaluate(() => check.index)) > 0);
        await page.evaluate(() => check.seek(check.total));
        await page.screenshot({ path: path.join(output, 'enso-desktop.png') });
        const pixels = await page.evaluate(() => check.pixels());
        assert(pixels.count > 10000);
        await page.mouse.move(750, 450);
        await page.mouse.down();
        await page.mouse.move(750, 310, { steps: 15 });
        await page.mouse.up();
        await page.waitForTimeout(600);
        assert.notEqual((await page.evaluate(() => check.pixels())).hash, pixels.hash);
        await page.screenshot({ path: path.join(output, 'enso-desktop-3d.png') });
        assert.equal(await page.evaluate(() => check.apply('SEAS YR ANOM\nDJF 1950 -1.2', 'Invalid')), false);
        const gap = source.replace(/1950\s+1\s+-1\.34/, '1950 1 -99.99');
        assert.notEqual(gap, source);
        assert.equal(await page.evaluate(text => check.apply(text, 'Gap'), gap), true);
        assert.equal(await page.evaluate(() => check.data.filter(p => p.missing).length), 5);
        await page.evaluate(() => check.seek(0));
        await page.locator('#stepForwardBtn').click();
        assert.equal(await page.locator('#infoMonth').textContent(), 'Feb');
        await page.evaluate(text => check.apply(text, 'Original'), source);
        await page.locator('#settingsBtn').click();
        await page.locator('label[for="smoothSpiralToggle"]').click();
        assert.equal(await page.evaluate(() => check.data.length), 921);
        await page.locator('label[for="smoothSpiralToggle"]').click();
        let requests = 0;
        await page.route('https://www.cpc.ncep.noaa.gov/data/indices/Rnino34.ascii.txt', route => {
            requests++;
            return route.fulfill({ contentType: 'text/plain', body: source });
        });
        await page.evaluate(() => check.fetch());
        assert.equal(requests, 1);
        assert.equal(await page.locator('#fetchStatus').textContent(), 'Success!');
        await page.evaluate(() => check.seek(check.total));
        await page.locator('#exportSettings summary').click();
        const download = page.waitForEvent('download');
        await page.locator('#exportBtn').click();
        const glb = await download;
        await glb.saveAs(path.join(output, glb.suggestedFilename()));
        assert.equal(fs.readFileSync(path.join(output, glb.suggestedFilename())).toString('ascii', 0, 4), 'glTF');
        await page.fill('#videoDuration', '5');
        await page.locator('#videoExportBtn').click();
        await page.waitForFunction(() => !document.querySelector('#videoDownload').hidden, null, { timeout: 30000 });
        assert.match(await page.locator('#videoDownload').getAttribute('download'), /enso-1949-2026/);
        assert.equal(await page.locator('#infoTemp').textContent(), '+1.67 \u00b0C');
        for (const [key, unit] of [['temperature', '\u00b0C'], ['ocean', '\u00b0C'], ['land', '\u00b0C'], ['co2', 'ppm'], ['arctic', 'M km'], ['antarctic', 'M km'], ['methane', 'ppb']]) {
            await select(page, key);
            assert((await page.locator('#infoTemp').textContent()).includes(unit));
            assert.equal(await page.locator('.legend').evaluate(el => el.classList.contains('enso')), false);
        }
        await context.close();
        console.log('Desktop: 921 observations, colors/radii, playback, gaps, fetch/import, exports, and existing datasets passed');
        for (const [width, height] of [[390, 844], [320, 568]]) {
            const { page, context } = await open(browser, width, height);
            await select(page, 'enso');
            await page.screenshot({ path: path.join(output, 'enso-settings-' + width + '.png') });
            await page.locator('#settingsPanel .close-btn').click();
            assert((await page.evaluate(() => check.pixels())).count > 10000);
            await page.locator('#infoBtn').click();
            await page.screenshot({ path: path.join(output, 'enso-mobile-' + width + '.png') });
            await page.locator('#infoDetailsToggle').click();
            await page.screenshot({ path: path.join(output, 'enso-mobile-expanded-' + width + '.png') });
            assert(await page.evaluate(() => {
                const panel = document.querySelector('#infoPanel').getBoundingClientRect();
                const value = document.querySelector('#infoTemp').getBoundingClientRect();
                const date = document.querySelector('#infoYear').getBoundingClientRect();
                return value.right <= panel.right && value.left > date.right && document.documentElement.scrollWidth === innerWidth;
            }));
            await context.close();
        }
        console.log('Mobile 390/320 rendering and layout passed');
        const offline = await open(browser, 1280, 800, false);
        await offline.page.waitForFunction(() => !!navigator.serviceWorker.controller);
        const cached = await offline.page.evaluate(async () => (await (await caches.open('climate-spiral-v10')).keys()).map(r => new URL(r.url).pathname));
        for (const asset of ['/enso-data.mjs', '/data/Rnino34.ascii.txt']) assert(cached.includes(asset));
        await offline.context.setOffline(true);
        await offline.page.reload();
        await offline.page.waitForFunction(() => document.querySelector('#fetchStatus').textContent === 'Local Data');
        await offline.page.locator('#settingsBtn').click();
        await offline.page.selectOption('#datasetSelect', 'enso');
        await offline.page.waitForFunction(() => document.querySelector('#fetchStatus').textContent === 'Local Data');
        await offline.page.locator('#skipEndBtn').click();
        assert.equal(await offline.page.locator('#infoTemp').textContent(), '+1.67 \u00b0C');
        await offline.context.close();
        assert.deepEqual(errors, []);
        console.log('Offline ENSO passed. Screenshots: ' + output);
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

// Run with: node scripts/check-video-export.cjs [path-to-playwright-package]
const { chromium } = require(process.argv[2] || 'playwright');
const assert = require('node:assert/strict');
const { installVideoSessionHook } = require('./browser-test-hooks.cjs');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const output = join(tmpdir(), 'climate-video-export');
mkdirSync(output, { recursive: true });

async function checkSeeking(page) {
  const recording = await page.evaluate(async () => {
    const blob = await (await fetch(document.querySelector('#videoDownload').href)).blob();
    return { name: document.querySelector('#videoDownload').download, data: await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.readAsDataURL(blob);
    }) };
  });
  const result = await page.evaluate(async () => {
    const media = document.createElement('video');
    media.muted = true;
    media.playsInline = true;
    media.src = document.querySelector('#videoDownload').href;
    // A visible decoder keeps frame callbacks running on all tested Chromium platforms.
    Object.assign(media.style, { position: 'fixed', top: '0', left: '0', width: '160px', zIndex: '10000' });
    document.body.append(media);
    await new Promise((resolve, reject) => { media.onloadedmetadata = resolve; media.onerror = reject; });
    const canvas = document.createElement('canvas');
    canvas.width = media.videoWidth;
    canvas.height = media.videoHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const sample = () => {
      ctx.drawImage(media, 0, 0);
      return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const frames = [];
    let callback;
    const collect = (_, info) => {
      // Retain a few full-resolution reference frames from uninterrupted playback.
      if (info.mediaTime > 0.5 && info.mediaTime < 4.7 && (!frames.length || info.mediaTime - frames.at(-1).time > 0.5)) {
        frames.push({ time: info.mediaTime, pixels: sample() });
      }
      callback = media.requestVideoFrameCallback(collect);
    };
    callback = media.requestVideoFrameCallback(collect);
    await media.play();
    await new Promise((resolve, reject) => { media.onended = resolve; media.onerror = reject; });
    media.cancelVideoFrameCallback(callback);
    const differences = [];
    // Alternate forward and backward seeks to reveal stale predictive frames.
    for (const index of [frames.length - 1, 1, frames.length - 2, 0, frames.length - 1, 2]) {
      const reference = frames[index];
      await new Promise(resolve => {
        media.onseeked = () => setTimeout(resolve, 100);
        media.currentTime = reference.time + 0.000001;
      });
      const pixels = sample();
      let sum = 0;
      let changed = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const difference = Math.max(...[0, 1, 2].map(channel => Math.abs(pixels[i + channel] - reference.pixels[i + channel])));
        sum += difference;
        if (difference > 20) changed++;
      }
      differences.push({ time: reference.time, mean: sum / (pixels.length / 4), changedFraction: changed / (pixels.length / 4) });
    }
    media.remove();
    return { frames: frames.length, differences, width: canvas.width, height: canvas.height };
  });
  const extension = recording.name.split('.').at(-1);
  const outputPath = join(output, `seek-test-${result.width}x${result.height}.${extension}`);
  const outputBuffer = Buffer.from(recording.data, 'base64');
  writeFileSync(outputPath, outputBuffer);
  const media = await import('../vendor/mediabunny/mediabunny.min.mjs');
  const format = extension === 'mp4' ? media.MP4 : media.WEBM;
  const input = new media.Input({ source: new media.BlobSource(new Blob([outputBuffer])), formats: [format] });
  try {
    const track = await input.getPrimaryVideoTrack();
    const metrics = await track.computeFrameRateMetrics({ targetPacketCount: 4000 });
    assert.equal(metrics.frameRateIsConstant, true);
    assert.equal(metrics.minFrameRate, 30);
    assert.equal(metrics.maxFrameRate, 30);
    assert.equal(metrics.averageFrameRate, 30);
    assert.equal(metrics.bestGuessFrameRate, 30);
  } finally {
    input.dispose();
  }
  assert.ok(result.frames >= 5, 'Need reference frames from continuous playback');
  console.log('Seek comparisons:', JSON.stringify(result.differences));
  for (const difference of result.differences) {
    assert.ok(difference.mean < 1 && difference.changedFraction < 0.01, 'Seeking must match uninterrupted playback: ' + JSON.stringify(difference));
  }
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: true,
      viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await installVideoSessionHook(page);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/index.html', async route => {
      const response = await route.fetch();
      const source = await response.text();
      await route.fulfill({ response, body: source.replace('// --- Configuration ---', `
        window.exportTest = {
          pause: () => setPlaybackPosition(totalIndices * 0.4),
          play: () => { if (!isAnimating) toggleAnimation(); },
          seekStart: () => setPlaybackPosition(0),
          preview: () => ({ ordinal: timelineStops.indexOf(animationIndex), playing: isAnimating }),
          snapshot: () => ({ position: activeCamera.position.toArray(), quaternion: activeCamera.quaternion.toArray(),
            zoom: activeCamera.zoom, target: controls.target.toArray(), projection: activeCamera.projectionMatrix.toArray(),
            index: animationIndex, playing: isAnimating, width: renderer.domElement.width, height: renderer.domElement.height }),
          phase: () => ({ recording: Boolean(videoController.testRecording), polar: controls.getPolarAngle(), progress: animationIndex / totalIndices }),
          exportState: () => videoController.testRecording && ({ frameIndex: videoController.testRecording.frameIndex,
            totalFrames: videoController.testRecording.totalFrames, paused: videoController.testRecording.paused, layout: videoController.testRecording.layout,
            framePlan: videoController.testRecording.framePlan }),
          framePlan: () => videoController.getFramePlan(),
          stops: () => timelineStops.length,
          setExportPaused: value => videoController.setPaused(value),
          orbit: () => ({ distance: activeCamera.position.distanceTo(controls.target),
            projection: activeCamera.projectionMatrix.toArray(), target: controls.target.toArray(), zoom: activeCamera.zoom }),
          ready: () => Boolean(spiralMesh && totalIndices)
        };
        // --- Configuration ---`) });
    });
    await page.goto('http://127.0.0.1:8000/index.html');
    await page.waitForFunction(() => window.exportTest?.ready());
    await page.evaluate(() => window.exportTest.pause());
    assert.equal(await page.locator('#speedSlider').inputValue(), '7');
    assert.equal((await page.evaluate(() => window.exportTest.framePlan())).drawSteps,
      Math.ceil(((await page.evaluate(() => window.exportTest.stops())) - 1) / 7));
    await page.locator('#speedSlider').evaluate(slider => {
      slider.value = '12';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.evaluate(() => { window.exportTest.seekStart(); window.exportTest.play(); });
    await page.waitForFunction(() => window.exportTest.preview().ordinal >= 24);
    assert.equal((await page.evaluate(() => window.exportTest.preview())).ordinal % 12, 0);
    await page.evaluate(() => window.exportTest.pause());
    await page.click('#settingsBtn');
    for (const id of ['viewSettings', 'dataSettings', 'exportSettings']) {
      assert.equal(await page.locator('#' + id).getAttribute('open'), null, id + ' should start collapsed');
    }
    assert.equal(await page.locator('#animationSettings').getAttribute('open'), '');
    await page.click('#exportSettings > summary');
    assert.equal(await page.locator('#videoAdvanced').getAttribute('open'), null);
    await page.click('#videoAdvanced > summary');
    assert.equal(await page.locator('#videoCamera').inputValue(), 'spiral-top');
    assert.equal(await page.locator('#videoTransition').inputValue(), '2');
    assert.deepEqual(await page.locator('#videoViewList .video-step-view').evaluateAll(elements => elements.map(element => element.value)),
      ['pause', 'spiral-front', 'pause']);
    await page.check('#videoLegendToggle');
    assert.equal(await page.locator('#videoTransitionRow').isVisible(), true);
    assert.deepEqual(await page.locator('#videoResolution option').evaluateAll(options => options.map(option => option.value)),
      ['1080p', 'portrait', 'square', 'window', 'custom']);
    await page.selectOption('#videoResolution', 'custom');
    await page.fill('#videoWidth', '641');
    await page.fill('#videoHeight', '360');
    await page.click('#videoExportBtn');
    assert.match(await page.locator('#videoExportStatus').textContent(), /even numbers/);
    await page.fill('#videoWidth', '640');
    await page.selectOption('#videoCamera', 'spiral-top');
    await page.fill('#videoTransition', '2');
    const expectedPlan = await page.evaluate(() => window.exportTest.framePlan());
    assert.equal(await page.locator('#videoDurationEstimate').textContent(),
      `${Math.floor(Math.round(expectedPlan.totalFrames / 30) / 60)}:${String(Math.round(expectedPlan.totalFrames / 30) % 60).padStart(2, '0')}`);
    await page.screenshot({ path: join(output, 'desktop-settings.png') });
    const before = await page.evaluate(() => window.exportTest.snapshot());
    const firstDownload = page.waitForEvent('download');
    await page.click('#videoExportBtn');
    await page.waitForFunction(() => window.exportTest.phase().recording);
    const exportState = await page.evaluate(() => window.exportTest.exportState());
    assert.deepEqual(exportState.framePlan, expectedPlan);
    const landscapeLayout = exportState.layout;
    assert.equal(landscapeLayout.placement, 'side');
    assert.ok(landscapeLayout.legend.x >= landscapeLayout.scene.x + landscapeLayout.scene.width);
    assert.ok((await page.evaluate(() => window.exportTest.phase())).polar < 0.001);
    const orbit = await page.evaluate(() => window.exportTest.orbit());
    await page.waitForFunction(() => window.exportTest.phase().polar > 0.3);
    const turned = await page.evaluate(() => window.exportTest.orbit());
    assert.ok(Math.abs(turned.distance - orbit.distance) < 1e-8);
    assert.deepEqual(turned.projection, orbit.projection);
    assert.deepEqual(turned.target, orbit.target);
    assert.equal(turned.zoom, orbit.zoom);
    assert.equal((await page.evaluate(() => window.exportTest.phase())).progress, 1);
    await page.waitForFunction(() => document.querySelector('#videoExportStatus').textContent === 'Download started.');
    assert.match((await firstDownload).suggestedFilename(), /^climate-spiral-.*\.(mp4|webm)$/);
    assert.equal(await page.locator('#videoDownload').isVisible(), false);
    const after = await page.evaluate(() => window.exportTest.snapshot());
    assert.deepEqual(after, before);

    const video = await page.evaluate(async layout => {
      const media = document.createElement('video');
      media.muted = true;
      media.src = document.querySelector('#videoDownload').href;
      await new Promise((resolve, reject) => { media.onloadedmetadata = resolve; media.onerror = reject; });
      const canvas = document.createElement('canvas');
      canvas.width = media.videoWidth;
      canvas.height = media.videoHeight;
      const ctx = canvas.getContext('2d');
      const frames = [];
      for (const time of [1.8, 4.6]) {
        await new Promise(resolve => {
          media.onseeked = () => setTimeout(resolve, 100);
          media.currentTime = time;
        });
        ctx.drawImage(media, 0, 0);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let lit = 0;
        let legendLit = 0;
        for (let y = 0; y < canvas.height; y++) {
          for (let x = 0; x < canvas.width; x++) {
            const i = (y * canvas.width + x) * 4;
            if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) <= 30) continue;
            lit++;
            if (x >= layout.legend.x && x < layout.legend.x + layout.legend.width
                && y >= layout.legend.y && y < layout.legend.y + layout.legend.height) legendLit++;
          }
        }
        frames.push({ lit, legendLit, image: canvas.toDataURL() });
      }
      return { width: media.videoWidth, height: media.videoHeight, duration: media.duration, frames };
    }, landscapeLayout);
    assert.equal(video.width, 640);
    assert.equal(video.height, 360);
    for (const [i, frame] of video.frames.entries()) {
      assert.ok(frame.lit > 500, 'Video frame must contain visible 3D content');
      assert.ok(frame.legendLit > 100, 'Landscape video frame must contain a visible side legend');
      writeFileSync(join(output, `video-frame-${i}.png`), Buffer.from(frame.image.split(',')[1], 'base64'));
    }
    assert.notEqual(video.frames[0].image, video.frames[1].image);
    console.log('Decoded video:', video.width, video.height, video.duration, 'seconds; lit pixels:', video.frames.map(frame => frame.lit));
    await checkSeeking(page);

    await page.click('#videoExportBtn');
    await page.waitForFunction(() => window.exportTest.exportState().frameIndex >= 10);
    await page.evaluate(() => window.exportTest.setExportPaused(true));
    const pausedFrame = (await page.evaluate(() => window.exportTest.exportState())).frameIndex;
    assert.equal((await page.evaluate(() => window.exportTest.exportState())).paused, true);
    assert.match(await page.locator('#videoExportStatus').textContent(), /Paused at/);
    await page.waitForTimeout(500);
    assert.equal((await page.evaluate(() => window.exportTest.exportState())).frameIndex, pausedFrame);
    await page.evaluate(() => window.exportTest.setExportPaused(false));
    await page.waitForFunction(frame => window.exportTest.exportState().frameIndex > frame, pausedFrame);
    await page.click('#videoExportBtn');
    assert.deepEqual(await page.evaluate(() => window.exportTest.snapshot()), before);
    assert.equal(await page.locator('#videoDownload').isVisible(), false);

    await page.locator('#videoPreviewBtn').evaluate(button => button.click());
    assert.equal(await page.locator('#videoPreviewBar').isVisible(), true);
    await page.locator('#videoExportBtn').evaluate(button => button.click());
    await page.waitForFunction(() => window.exportTest.exportState()?.frameIndex >= 2);
    assert.equal(await page.locator('#videoPreviewBar').isHidden(), true);
    await page.click('#videoExportBtn');
    const afterPreviewExport = await page.evaluate(() => window.exportTest.snapshot());
    assert.equal(afterPreviewExport.index, before.index, 'Export started during a preview must restore the original timeline');
    assert.equal(afterPreviewExport.playing, before.playing);

    await page.selectOption('#videoCamera', 'current');
    while (await page.locator('#videoViewList [data-action="remove"]').count()) {
      await page.locator('#videoViewList [data-action="remove"]').first().click();
    }
    await page.fill('#videoWidth', '360');
    await page.fill('#videoHeight', '640');
    await page.click('#videoExportBtn');
    await page.waitForFunction(() => window.exportTest.phase().recording);
    const portraitLayout = (await page.evaluate(() => window.exportTest.exportState())).layout;
    assert.equal(portraitLayout.placement, 'below');
    assert.ok(portraitLayout.legend.y >= portraitLayout.scene.y + portraitLayout.scene.height);
    await page.waitForFunction(() => document.querySelector('#videoExportStatus').textContent === 'Download started.');
    assert.deepEqual(await page.evaluate(() => window.exportTest.snapshot()), before);
    const portraitFrame = await page.evaluate(async layout => {
      const media = document.createElement('video');
      media.src = document.querySelector('#videoDownload').href;
      await new Promise((resolve, reject) => { media.onloadedmetadata = resolve; media.onerror = reject; });
      await new Promise(resolve => {
        media.onseeked = () => setTimeout(resolve, 100);
        media.currentTime = 4.6;
      });
      const canvas = document.createElement('canvas');
      canvas.width = media.videoWidth;
      canvas.height = media.videoHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(media, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let legendLit = 0;
      for (let y = layout.legend.y; y < layout.legend.y + layout.legend.height; y++) {
        for (let x = layout.legend.x; x < layout.legend.x + layout.legend.width; x++) {
          const i = (y * canvas.width + x) * 4;
          if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 30) legendLit++;
        }
      }
      return { width: media.videoWidth, height: media.videoHeight, legendLit, image: canvas.toDataURL() };
    }, portraitLayout);
    assert.deepEqual([portraitFrame.width, portraitFrame.height], [360, 640]);
    assert.ok(portraitFrame.legendLit > 100, 'Portrait video frame must contain a visible bottom legend');
    writeFileSync(join(output, 'portrait-video-frame.png'), Buffer.from(portraitFrame.image.split(',')[1], 'base64'));
    console.log('Portrait current-view export and cancellation restore the original state.');

    await page.locator('#viewSettings > summary').scrollIntoViewIfNeeded();
    await page.click('#viewSettings > summary');
    await page.uncheck('#orthoToggle');
    await page.selectOption('#videoCamera', 'spiral-top');
    await page.click('#videoAddView');
    await page.locator('#videoViewList .video-step-view').selectOption('spiral-front');
    await page.selectOption('#videoResolution', '1080p');
    const perspectiveBefore = await page.evaluate(() => window.exportTest.snapshot());
    await page.click('#videoExportBtn');
    const perspectiveOrbit = await page.evaluate(() => window.exportTest.orbit());
    await page.waitForFunction(() => window.exportTest.phase().polar > 0.3);
    const perspectiveTurned = await page.evaluate(() => window.exportTest.orbit());
    assert.ok(Math.abs(perspectiveTurned.distance - perspectiveOrbit.distance) < 1e-8);
    assert.deepEqual(perspectiveTurned.projection, perspectiveOrbit.projection);
    await page.screenshot({ path: join(output, 'perspective-recording.png') });
    await page.waitForFunction(() => document.querySelector('#videoExportStatus').textContent === 'Download started.');
    assert.deepEqual(await page.evaluate(() => window.exportTest.snapshot()), perspectiveBefore);
    const hdFrame = await page.evaluate(async () => {
      const media = document.createElement('video');
      media.src = document.querySelector('#videoDownload').href;
      await new Promise((resolve, reject) => { media.onloadedmetadata = resolve; media.onerror = reject; });
      await new Promise(resolve => {
        media.onseeked = () => setTimeout(resolve, 100);
        media.currentTime = 1.8;
      });
      const canvas = document.createElement('canvas');
      canvas.width = media.videoWidth;
      canvas.height = media.videoHeight;
      canvas.getContext('2d').drawImage(media, 0, 0);
      return { width: media.videoWidth, height: media.videoHeight, image: canvas.toDataURL() };
    });
    assert.deepEqual([hdFrame.width, hdFrame.height], [1920, 1080]);
    writeFileSync(join(output, 'full-hd-video-frame.png'), Buffer.from(hdFrame.image.split(',')[1], 'base64'));
    console.log('1080p perspective export restores the camera and produces full-resolution video.');
    await checkSeeking(page);

    await page.evaluate(() => window.exportTest.play());
    await page.click('#videoExportBtn');
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.waitForFunction(() => document.querySelector('#videoExportStatus').textContent.includes('window size changed'));
    assert.equal((await page.evaluate(() => window.exportTest.snapshot())).playing, true);
    await page.evaluate(() => window.exportTest.pause());
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => window.exportTest.snapshot().width === innerWidth * devicePixelRatio);
    await page.selectOption('#videoResolution', 'custom');
    await page.locator('#videoAdvanced > summary').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(output, 'mobile-settings.png') });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    for (const id of ['videoResolution', 'videoWidth', 'videoHeight', 'videoCamera']) {
      const box = await page.locator('#' + id).boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= 390, id + ' must fit mobile width');
    }
    await page.click('#videoExportBtn');
    await page.waitForFunction(() => window.exportTest.phase().polar > 0.3);
    await page.screenshot({ path: join(output, 'mobile-recording.png') });
    await page.waitForFunction(() => document.querySelector('#videoExportStatus').textContent === 'Download started.');
    const mobileFrame = await page.evaluate(async () => {
      const media = document.createElement('video');
      media.src = document.querySelector('#videoDownload').href;
      await new Promise((resolve, reject) => { media.onloadedmetadata = resolve; media.onerror = reject; });
      await new Promise(resolve => {
        media.onseeked = () => setTimeout(resolve, 100);
        media.currentTime = 4.6;
      });
      const canvas = document.createElement('canvas');
      canvas.width = media.videoWidth;
      canvas.height = media.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(media, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let lit = 0;
      for (let i = 0; i < pixels.length; i += 4) if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 30) lit++;
      return { width: canvas.width, height: canvas.height, lit, image: canvas.toDataURL() };
    });
    assert.equal(mobileFrame.width, 360);
    assert.equal(mobileFrame.height, 640);
    assert.ok(mobileFrame.lit > 500);
    writeFileSync(join(output, 'mobile-video-frame.png'), Buffer.from(mobileFrame.image.split(',')[1], 'base64'));
    await page.setViewportSize({ width: 320, height: 568 });
    await page.waitForFunction(() => window.exportTest.snapshot().width === innerWidth * devicePixelRatio);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    for (const id of ['videoResolution', 'videoWidth', 'videoHeight', 'videoCamera']) {
      const box = await page.locator('#' + id).boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= 320, id + ' must fit narrow mobile width');
    }
    assert.deepEqual(errors, []);
    console.log('Browser checks passed. Screenshots:', output);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

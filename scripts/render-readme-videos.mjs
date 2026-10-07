import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { chooseSecondaryDataset, previousSecondaryDataset, chooseReadmeCameraPaths, readmeVideoBitrate } from './readme-video.mjs';
import { configureReadmeVideo } from './configure-readme-video.mjs';

const outputDirectory = 'readme-videos';
const baseUrl = process.env.README_VIDEO_BASE_URL || 'http://127.0.0.1:8765';
const month = new Date().toISOString().slice(0, 7);
const previous = previousSecondaryDataset(readFileSync('README.md', 'utf8'));
const secondary = chooseSecondaryDataset(previous, process.env.README_VIDEO_DATASET || null);
const cameraPaths = chooseReadmeCameraPaths();
const monthsPerFrameOverride = process.env.README_VIDEO_MONTHS_PER_FRAME
  ? Number(process.env.README_VIDEO_MONTHS_PER_FRAME) : null;
if (monthsPerFrameOverride !== null
    && (!Number.isInteger(monthsPerFrameOverride) || monthsPerFrameOverride < 1 || monthsPerFrameOverride > 12)) {
  throw new Error('README_VIDEO_MONTHS_PER_FRAME must be an integer from 1 to 12.');
}
mkdirSync(outputDirectory, { recursive: true });

async function checkDecodedFrame(page) {
  return page.evaluate(async () => {
    const video = document.createElement('video');
    video.muted = true;
    video.src = document.getElementById('videoDownload').href;
    await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = reject; });
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const results = [];
    for (const time of [Math.min(2, video.duration / 2), Math.max(0, video.duration - 0.3)]) {
      await new Promise((resolve, reject) => {
        video.onseeked = () => setTimeout(resolve, 100);
        video.onerror = reject;
        video.currentTime = time;
      });
      context.drawImage(video, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let visiblePixels = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        if (Math.max(pixels[index], pixels[index + 1], pixels[index + 2]) > 30) visiblePixels++;
      }
      results.push(visiblePixels);
    }
    return { width: video.videoWidth, height: video.videoHeight, duration: video.duration, visiblePixels: results };
  });
}

async function renderDataset(browser, datasetKey, cameraPath) {
  const context = await browser.newContext({
    acceptDownloads: true,
    serviceWorkers: 'block',
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.locator(`#datasetSelect option[value="${datasetKey}"]`).waitFor({ state: 'attached' });
    await page.click('#settingsBtn');
    if (datasetKey !== 'temperature') await page.selectOption('#datasetSelect', datasetKey);
    await page.waitForFunction(key => {
      const dataset = document.getElementById('datasetSelect');
      const origin = document.getElementById('dataOrigin');
      const status = document.getElementById('fetchStatus');
      return dataset.value === key && origin.textContent.trim() === '(Local Data)'
        && status.textContent.trim() === 'Local Data';
    }, datasetKey, { timeout: 60_000 });

    if (monthsPerFrameOverride !== null) {
      await page.locator('#speedSlider').evaluate((slider, speed) => {
        slider.value = String(speed);
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      }, monthsPerFrameOverride);
    }
    await page.click('#exportSettings > summary');
    await page.click('#videoAdvanced > summary');
    await configureReadmeVideo(page, cameraPath);

    const downloadPromise = page.waitForEvent('download', { timeout: 10 * 60_000 });
    await page.click('#videoExportBtn');
    const download = await downloadPromise;
    await page.waitForFunction(() => document.getElementById('videoExportStatus').textContent === 'Download started.');
    const preview = await checkDecodedFrame(page);
    if (preview.width !== 1920 || preview.height !== 1080 || preview.duration < 2
        || preview.visiblePixels.some(count => count < 1000) || errors.length) {
      throw new Error(`Invalid ${datasetKey} render: ${JSON.stringify({ preview, errors })}`);
    }

    const extension = download.suggestedFilename().split('.').at(-1);
    if (!['mp4', 'webm'].includes(extension)) throw new Error(`Unexpected video format: ${extension}`);
    const rawPath = join(outputDirectory, `${datasetKey}-raw.${extension}`);
    const finalPath = join(outputDirectory, `${datasetKey}.mp4`);
    await download.saveAs(rawPath);
    if (process.env.README_VIDEO_SKIP_TRANSCODE === '1') {
      if (extension !== 'mp4') throw new Error('Skipping transcoding requires an MP4 browser recording.');
      copyFileSync(rawPath, finalPath);
    } else {
      const bitrate = readmeVideoBitrate(preview.duration);
      execFileSync(process.env.README_VIDEO_FFMPEG || 'ffmpeg', [
        '-y', '-i', rawPath, '-an', '-vf', 'scale=1920:1080:flags=lanczos', '-r', '30', '-fps_mode', 'cfr',
        '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
        '-b:v', String(bitrate), '-maxrate', String(bitrate), '-bufsize', String(bitrate * 2),
        '-movflags', '+faststart', finalPath,
      ], { stdio: 'inherit' });
      const probe = JSON.parse(execFileSync('ffprobe', [
        '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,avg_frame_rate',
        '-show_entries', 'format=duration', '-of', 'json', finalPath,
      ], { encoding: 'utf8' }));
      const videoStream = probe.streams?.[0];
      if (videoStream?.width !== 1920 || videoStream?.height !== 1080
          || videoStream?.avg_frame_rate !== '30/1' || !(Number(probe.format?.duration) >= 2)) {
        throw new Error(`Unexpected ${datasetKey} MP4 format: ${JSON.stringify(probe)}`);
      }
    }
    const bytes = statSync(finalPath).size;
    if (process.env.README_VIDEO_SKIP_TRANSCODE !== '1' && bytes >= 9 * 1024 * 1024) {
      throw new Error(`${datasetKey} video exceeds the 9 MiB attachment budget.`);
    }
    console.log(`${datasetKey}: ${preview.duration.toFixed(1)}s, ${(bytes / 1024 / 1024).toFixed(1)} MiB`);
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch({
  headless: true,
  ...(process.env.README_VIDEO_BROWSER_CHANNEL ? { channel: process.env.README_VIDEO_BROWSER_CHANNEL } : {}),
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
try {
  await renderDataset(browser, 'temperature', cameraPaths.top);
  await renderDataset(browser, secondary.key, cameraPaths.bottom);
  writeFileSync(join(outputDirectory, 'selection.json'), JSON.stringify({ month, secondary, cameraPaths }, null, 2) + '\n');
} finally {
  await browser.close();
}

import { DEFAULT_VIDEO_MOVE_SECONDS } from '../video-export.mjs';

export async function configureReadmeVideo(page, path) {
  await page.selectOption('#videoResolution', '1080p');
  await page.check('#videoLegendToggle');
  await page.selectOption('#videoCamera', path.start);
  await page.fill('#videoTransition', String(DEFAULT_VIDEO_MOVE_SECONDS));
  const remove = page.locator('#videoViewList [data-action="remove"]');
  while (await remove.count()) await remove.first().click();
  for (const step of path.steps) {
    await page.click(step.type === 'pause' ? '#videoAddPause' : '#videoAddView');
    const row = page.locator('#videoViewList .video-view-step').last();
    if (step.type === 'pause') await row.locator('.video-pause-seconds').fill(String(step.seconds));
    else await row.locator('.video-step-view').selectOption(step.view);
  }
}

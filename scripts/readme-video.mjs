import { randomInt } from 'node:crypto';
import { DEFAULT_VIDEO_PAUSE_SECONDS } from '../video-export.mjs';

export function chooseReadmeCameraPaths(pick = randomInt) {
  const sequences = [
    ['spiral-front', 'graph-right', 'graph-top'],
    ['graph-top', 'graph-front', 'graph-right'],
  ];
  const paths = sequences.map(views => ({ start: 'spiral-top', steps: [
    { type: 'pause', seconds: DEFAULT_VIDEO_PAUSE_SECONDS },
    ...views.flatMap(view => [{ type: 'view', view }, { type: 'pause', seconds: DEFAULT_VIDEO_PAUSE_SECONDS }]),
  ] }));
  const first = pick(paths.length);
  return { top: paths[first], bottom: paths[1 - first] };
}

export function readmeVideoBitrate(duration) {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Invalid video duration.');
  // Leave room below the attachment limit for encoder variation and container overhead.
  return Math.min(4_800_000, Math.floor(7.5 * 1024 * 1024 * 8 / duration));
}

export const SECONDARY_DATASETS = [
  { key: 'ocean', title: 'Ocean Temperature' },
  { key: 'land', title: 'Land Temperature' },
  { key: 'arctic', title: 'Arctic Sea Ice Extent' },
  { key: 'antarctic', title: 'Antarctic Sea Ice Extent' },
  { key: 'arcticvolume', title: 'Arctic Sea Ice Volume (PIOMAS)' },
  { key: 'co2', title: 'Global CO2' },
  { key: 'methane', title: 'Global Methane' },
  { key: 'sealevel', title: 'Global Sea Level' },
];

const TOP_START = '<!-- README_VIDEO_TOP_START -->';
const TOP_END = '<!-- README_VIDEO_TOP_END -->';
const BOTTOM_START = '<!-- README_VIDEO_BOTTOM_START -->';
const BOTTOM_END = '<!-- README_VIDEO_BOTTOM_END -->';
const ATTACHMENT_URL = /^https:\/\/github\.com\/user-attachments\/assets\/[a-f0-9-]+$/i;

export function previousSecondaryDataset(readme) {
  return readme.match(/<!-- README_VIDEO_DATASET: ([a-z][a-z0-9]*) -->/)?.[1] ?? null;
}

export function videoMonth(readme) {
  return readme.match(/<!-- README_VIDEO_UPDATED: (\d{4}-\d{2}) -->/)?.[1] ?? null;
}

export function chooseSecondaryDataset(previousKey, requestedKey = null, pick = randomInt) {
  if (requestedKey) {
    const requested = SECONDARY_DATASETS.find(dataset => dataset.key === requestedKey);
    if (!requested) throw new Error(`Unknown secondary dataset: ${requestedKey}`);
    return requested;
  }
  const candidates = SECONDARY_DATASETS.filter(dataset => dataset.key !== previousKey);
  return candidates[pick(candidates.length)];
}

function replaceBlock(readme, start, end, content) {
  const startAt = readme.indexOf(start);
  const endAt = readme.indexOf(end, startAt + start.length);
  if (startAt < 0 || endAt < 0 || readme.indexOf(start, startAt + start.length) >= 0
      || readme.indexOf(end, endAt + end.length) >= 0) {
    throw new Error(`README video markers are missing or duplicated: ${start}`);
  }
  return readme.slice(0, startAt + start.length) + '\n' + content + '\n' + readme.slice(endAt);
}

export function updateReadmeVideos(readme, { topUrl, bottomUrl, dataset, month }) {
  if (!ATTACHMENT_URL.test(topUrl) || !ATTACHMENT_URL.test(bottomUrl)) {
    throw new Error('Expected two GitHub video attachment URLs.');
  }
  if (!SECONDARY_DATASETS.some(candidate => candidate.key === dataset.key && candidate.title === dataset.title)) {
    throw new Error('The secondary dataset is not active.');
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Invalid update month.');

  let updated = replaceBlock(readme, TOP_START, TOP_END, topUrl);
  updated = replaceBlock(updated, BOTTOM_START, BOTTOM_END,
    `<!-- README_VIDEO_DATASET: ${dataset.key} -->\n**${dataset.title}**\n\n${bottomUrl}`);
  const monthMarker = `<!-- README_VIDEO_UPDATED: ${month} -->`;
  const previousMarker = /<!-- README_VIDEO_UPDATED: \d{4}-\d{2} -->/;
  return previousMarker.test(updated)
    ? updated.replace(previousMarker, monthMarker)
    : updated.replace(TOP_END, `${TOP_END}\n${monthMarker}`);
}

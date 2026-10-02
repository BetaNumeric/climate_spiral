// Historical README video integration, used only by the archived tests.
import { randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ORAS5_DATA_PATH, parseOras5VolumeData } from '../oras5-data.mjs';
import { GIOMAS_DATA_PATH, parseGiomasVolumeData } from '../giomas-data.mjs';

export function oras5VideoDatasets(text) {
  if (!parseOras5VolumeData(text, 'north').length || !parseOras5VolumeData(text, 'south').length) return [];
  return [
    { key: 'arcticoras5', title: 'Arctic Sea Ice Volume (ORAS5)' },
    { key: 'antarcticoras5', title: 'Antarctic Sea Ice Volume (ORAS5)' },
  ];
}

export function giomasVideoDatasets(text) {
  if (!parseGiomasVolumeData(text, 'north').length || !parseGiomasVolumeData(text, 'south').length) return [];
  return [
    { key: 'arcticgiomas', title: 'Arctic Sea Ice Volume (GIOMAS)' },
    { key: 'antarcticgiomas', title: 'Antarctic Sea Ice Volume (GIOMAS)' },
  ];
}

function publishedVideoDatasets(path, parse) {
  try { return parse(readFileSync(new URL('../' + path, import.meta.url), 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return [];
  }
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
  ...publishedVideoDatasets(ORAS5_DATA_PATH, oras5VideoDatasets),
  ...publishedVideoDatasets(GIOMAS_DATA_PATH, giomasVideoDatasets),
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

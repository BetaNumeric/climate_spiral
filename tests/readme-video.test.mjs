import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseSecondaryDataset, previousSecondaryDataset, updateReadmeVideos, videoMonth,
  SECONDARY_DATASETS, chooseReadmeCameraPaths, readmeVideoBitrate } from '../scripts/readme-video.mjs';
import { DEFAULT_VIDEO_MOVE_SECONDS, DEFAULT_VIDEO_PAUSE_SECONDS, getVideoFramePlan, getVideoFrameTiming } from '../video-export.mjs';

const original = `# Climate Spiral
<!-- README_VIDEO_TOP_START -->
https://github.com/user-attachments/assets/1111
<!-- README_VIDEO_TOP_END -->
Description.
<!-- README_VIDEO_BOTTOM_START -->
https://github.com/user-attachments/assets/2222
<!-- README_VIDEO_BOTTOM_END -->
Footer.
`;

test('README videos use both requested camera paths, randomly swapping their slots', () => {
  const paths = chooseReadmeCameraPaths(() => 0);
  assert.deepEqual(paths.top.steps.filter(step => step.type === 'view').map(step => step.view),
    ['spiral-front', 'graph-right', 'graph-top']);
  assert.deepEqual(paths.bottom.steps.filter(step => step.type === 'view').map(step => step.view),
    ['graph-top', 'graph-front', 'graph-right']);
  assert.deepEqual(chooseReadmeCameraPaths(() => 1), { top: paths.bottom, bottom: paths.top });
  for (const path of Object.values(paths)) {
    assert.equal(path.start, 'spiral-top');
    assert.deepEqual(path.steps.map(step => step.type), ['pause', 'view', 'pause', 'view', 'pause', 'view', 'pause']);
    assert.ok(path.steps.filter(step => step.type === 'pause').every(step => step.seconds === DEFAULT_VIDEO_PAUSE_SECONDS));
    const plan = getVideoFramePlan(120, 7, DEFAULT_VIDEO_MOVE_SECONDS,
      path.steps.map(step => ({ type: step.type, seconds: step.seconds ?? DEFAULT_VIDEO_MOVE_SECONDS })));
    assert.deepEqual(plan.stepFrames, [30, 60, 30, 60, 30, 60, 30]);
    assert.equal(plan.turnFrames, 300);
    let offset = plan.startHoldFrames + plan.drawSteps;
    for (const [index, frames] of plan.stepFrames.entries()) {
      assert.equal(getVideoFrameTiming(offset, plan).moveIndex, index);
      assert.equal(getVideoFrameTiming(offset + frames - 1, plan).moveIndex, index);
      offset += frames;
    }
  }
});

test('camera path selection returns fresh steps on each run', () => {
  const first = chooseReadmeCameraPaths(() => 0);
  first.top.steps[0].seconds = 30;
  assert.equal(chooseReadmeCameraPaths(() => 0).top.steps[0].seconds, 1);
});

test('longer README videos receive a bitrate within the attachment budget', () => {
  assert.equal(readmeVideoBitrate(5), 4_800_000);
  for (const duration of [15, 20, 60, 120]) {
    const bitrate = readmeVideoBitrate(duration);
    assert.ok(bitrate > 0 && bitrate <= 4_800_000);
    assert.ok(bitrate * duration / 8 <= 7.5 * 1024 * 1024);
  }
  for (const duration of [0, -1, NaN, Infinity]) assert.throws(() => readmeVideoBitrate(duration));
});

test('monthly selection excludes the previous active dataset', () => {
  for (const previous of SECONDARY_DATASETS) {
    const available = SECONDARY_DATASETS.filter(candidate => candidate.key !== previous.key);
    for (let index = 0; index < available.length; index++) {
      assert.deepEqual(chooseSecondaryDataset(previous.key, null, () => index), available[index]);
    }
  }
  assert.equal(chooseSecondaryDataset(null, 'co2').key, 'co2');
  assert.equal(chooseSecondaryDataset(null, 'arcticvolume').title, 'Arctic Sea Ice Volume (PIOMAS)');
  assert.throws(() => chooseSecondaryDataset(null, 'enso'));
});

test('previous video markers retain dataset keys containing digits', () => {
  for (const key of ['co2', 'dataset2']) {
    assert.equal(previousSecondaryDataset(`<!-- README_VIDEO_DATASET: ${key} -->`), key);
  }
});

test('README rotation excludes archived models and still accepts their previous video markers', () => {
  assert.equal(SECONDARY_DATASETS.length, 8);
  for (const key of ['arcticoras5', 'antarcticoras5', 'arcticgiomas', 'antarcticgiomas']) {
    assert.throws(() => chooseSecondaryDataset(null, key), /Unknown secondary dataset/);
    const previous = previousSecondaryDataset(`<!-- README_VIDEO_DATASET: ${key} -->`);
    assert(SECONDARY_DATASETS.some(dataset => dataset.key === chooseSecondaryDataset(previous, null, () => 0).key));
    assert.throws(() => updateReadmeVideos(original, {
      topUrl: 'https://github.com/user-attachments/assets/aaaa',
      bottomUrl: 'https://github.com/user-attachments/assets/bbbb',
      dataset: { key, title: 'Archived Sea Ice Volume' }, month: '2026-10',
    }), /not active/);
  }
});

test('README update replaces only the two video slots and tracks the month and lower dataset', () => {
  const updated = updateReadmeVideos(original, {
    topUrl: 'https://github.com/user-attachments/assets/aaaa',
    bottomUrl: 'https://github.com/user-attachments/assets/bbbb',
    dataset: chooseSecondaryDataset(null, 'ocean'),
    month: '2026-10',
  });
  assert.match(updated, /# Climate Spiral/);
  assert.match(updated, /Description\./);
  assert.match(updated, /Footer\./);
  assert.equal(videoMonth(updated), '2026-10');
  assert.equal(previousSecondaryDataset(updated), 'ocean');
  assert.equal((updated.match(/https:\/\/github\.com\/user-attachments\/assets\//g) ?? []).length, 2);
  const next = updateReadmeVideos(updated, {
    topUrl: 'https://github.com/user-attachments/assets/cccc',
    bottomUrl: 'https://github.com/user-attachments/assets/dddd',
    dataset: chooseSecondaryDataset('ocean', 'land'),
    month: '2026-11',
  });
  assert.equal((next.match(/README_VIDEO_UPDATED/g) ?? []).length, 1);
  assert.equal(previousSecondaryDataset(next), 'land');
  assert.doesNotMatch(next, /assets\/aaaa/);
});

test('volume can be published as the secondary README example', () => {
  const updated = updateReadmeVideos(original, {
    topUrl: 'https://github.com/user-attachments/assets/aaaa',
    bottomUrl: 'https://github.com/user-attachments/assets/bbbb',
    dataset: chooseSecondaryDataset(null, 'arcticvolume'),
    month: '2026-10',
  });
  assert.equal(previousSecondaryDataset(updated), 'arcticvolume');
  assert.match(updated, /\*\*Arctic Sea Ice Volume \(PIOMAS\)\*\*/);
});

test('README update rejects unexpected video URLs and broken markers', () => {
  const valid = {
    topUrl: 'https://github.com/user-attachments/assets/aaaa',
    bottomUrl: 'https://github.com/user-attachments/assets/bbbb',
    dataset: chooseSecondaryDataset(null, 'land'),
    month: '2026-10',
  };
  assert.throws(() => updateReadmeVideos(original, { ...valid, topUrl: 'https://example.com/movie.mp4' }));
  assert.throws(() => updateReadmeVideos(original.replace('README_VIDEO_BOTTOM_END', 'OTHER'), valid));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseSecondaryDataset, previousSecondaryDataset, updateReadmeVideos, videoMonth,
  SECONDARY_DATASETS } from '../scripts/readme-video.mjs';

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

test('monthly selection excludes the previous active dataset', () => {
  for (const previous of SECONDARY_DATASETS) {
    const available = SECONDARY_DATASETS.filter(candidate => candidate.key !== previous.key);
    for (let index = 0; index < available.length; index++) {
      assert.deepEqual(chooseSecondaryDataset(previous.key, null, () => index), available[index]);
    }
  }
  assert.equal(chooseSecondaryDataset(null, 'co2').key, 'co2');
  assert.throws(() => chooseSecondaryDataset(null, 'enso'));
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

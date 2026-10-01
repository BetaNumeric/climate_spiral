import test from 'node:test';
import assert from 'node:assert/strict';
import { VIDEO_EXPORT_FPS, getVideoDimensions, getVideoFramePlan, getVideoFrameTiming,
  getVideoLayout, getVideoOrbitFrame, getVideoRecorderOptions } from '../video-export.mjs';

test('video presets use fixed encoder-friendly dimensions', () => {
  for (const [preset, expected] of Object.entries({
    '1080p': [1920, 1080], portrait: [1080, 1920], square: [1080, 1080],
  })) assert.deepEqual(getVideoDimensions(preset), expected);
  assert.deepEqual(getVideoDimensions('window', 0, 0, 3840, 2160), [1920, 1080]);
  assert.deepEqual(getVideoDimensions('window', 0, 0, 391, 845), [390, 844]);
});

test('custom resolution validates dimensions and total pixel budget', () => {
  assert.deepEqual(getVideoDimensions('custom', 3840, 2160), [3840, 2160]);
  assert.deepEqual(getVideoDimensions('custom', 720, 1280), [720, 1280]);
  for (const [width, height] of [[1919, 1080], [0, 1080], [NaN, 1080], [1280, 127], [1280, Infinity], [128.5, 720], [3840, 3840]]) {
    assert.throws(() => getVideoDimensions('custom', width, height));
  }
  assert.throws(() => getVideoDimensions('unknown'));
  assert.throws(() => getVideoDimensions('720p'));
});

test('video layout reserves non-overlapping legend space for each orientation', () => {
  assert.deepEqual(getVideoLayout(1920, 1080, false), {
    scene: { x: 0, y: 0, width: 1920, height: 1080 }, legend: null, placement: 'none',
  });

  const landscape = getVideoLayout(1920, 1080, true);
  assert.equal(landscape.placement, 'side');
  assert.equal(landscape.scene.height, 1080);
  assert.ok(landscape.legend.x >= landscape.scene.x + landscape.scene.width);
  assert.equal(getVideoLayout(1200, 1080, true).placement, 'side');

  for (const [width, height] of [[1080, 1920], [1080, 1080], [360, 640]]) {
    const layout = getVideoLayout(width, height, true);
    assert.equal(layout.placement, 'below');
    assert.ok(layout.legend.y >= layout.scene.y + layout.scene.height);
    assert.ok(layout.legend.x >= 0 && layout.legend.x + layout.legend.width <= width);
    assert.ok(layout.legend.y + layout.legend.height <= height);
    assert.ok(layout.scene.width > 0 && layout.scene.height > 0);
  }
});

test('fixed orbit framing contains the scene at every angle without zooming or dollying', () => {
  for (const aspect of [16 / 9, 1, 9 / 16]) {
    for (const fov of [null, 45]) {
      const radius = 22;
      const halfHeight = 26;
      const frame = getVideoOrbitFrame(radius, halfHeight, aspect, fov);
      for (let angle = 0; angle <= Math.PI / 2; angle += 0.01) {
        assert.ok(frame.visibleHalfHeight >= radius * Math.cos(angle) + halfHeight * Math.sin(angle));
        assert.ok(frame.visibleHalfHeight * aspect >= radius);
      }
      if (fov !== null) {
        const halfFov = Math.atan(Math.tan(fov * Math.PI / 360) * Math.min(1, aspect));
        assert.ok(frame.distance * Math.sin(halfFov) >= Math.hypot(radius, halfHeight));
      }
      assert.ok(frame.far > frame.distance + Math.hypot(radius, halfHeight));
    }
  }
  const normal = getVideoOrbitFrame(22, 26, 16 / 9);
  const enlarged = getVideoOrbitFrame(22, 26, 16 / 9, null, 1.12);
  assert.ok(enlarged.visibleHalfHeight < normal.visibleHalfHeight);
  assert.equal(enlarged.distance, normal.distance);
  assert.ok(getVideoOrbitFrame(22, 26, 16 / 9, 45, 1.12).distance
    < getVideoOrbitFrame(22, 26, 16 / 9, 45).distance);
  assert.throws(() => getVideoOrbitFrame(22, 26, 16 / 9, null, 0));
});

test('recording requests frequent keyframes and a resolution-scaled bitrate', () => {
  assert.deepEqual(getVideoRecorderOptions('video/mp4;codecs=avc1', 1920, 1080), {
    mimeType: 'video/mp4;codecs=avc1', videoBitsPerSecond: 12000000, videoKeyFrameIntervalDuration: 500,
  });
  assert.equal(getVideoRecorderOptions('video/webm', 3840, 2160).videoBitsPerSecond, 48000000);
  assert.equal(getVideoRecorderOptions('video/webm', 640, 360).videoKeyFrameIntervalCount, undefined);
});

test('video duration follows monthly observations, speed, and camera turn', () => {
  assert.equal(VIDEO_EXPORT_FPS, 30);
  const normal = getVideoFramePlan(1501, 1, 3);
  const faster = getVideoFramePlan(1501, 3, 3);
  assert.equal(normal.drawSteps, 1500);
  assert.equal(faster.drawSteps, 500);
  assert.equal(normal.totalFrames - faster.totalFrames, 1000);
  assert.equal(getVideoFramePlan(1501, 1, 0).totalFrames + 90, normal.totalFrames);
  assert.throws(() => getVideoFramePlan(1, 1, 0));
  assert.throws(() => getVideoFramePlan(1501, 0, 0));
  assert.throws(() => getVideoFramePlan(1501, 1, NaN));
});

test('each drawing frame ends on a real month and the last partial step reaches the final month', () => {
  const plan = getVideoFramePlan(7, 2, 1);
  const observations = Array.from({ length: plan.totalFrames }, (_, frame) => getVideoFrameTiming(frame, plan).observationIndex);
  assert.deepEqual(observations.slice(0, plan.startHoldFrames + plan.drawSteps),
    [...Array(plan.startHoldFrames).fill(0), 2, 4, 6]);
  assert.ok(observations.slice(plan.startHoldFrames + plan.drawSteps).every(index => index === 6));
  assert.equal(getVideoFrameTiming(plan.startHoldFrames + plan.drawSteps, plan).turn, 0);
  assert.equal(getVideoFrameTiming(plan.startHoldFrames + plan.drawSteps, plan).transition, 0);
  assert.equal(getVideoFrameTiming(plan.totalFrames - plan.endHoldFrames - 1, plan).turn, 1);
  assert.equal(getVideoFrameTiming(plan.totalFrames - 1, plan).turn, 1);
  assert.equal(getVideoFrameTiming(plan.totalFrames - 1, plan).transition, 1);

  const partial = getVideoFramePlan(8, 3, 0);
  assert.equal(getVideoFrameTiming(partial.startHoldFrames + partial.drawSteps - 1, partial).observationIndex, 7);
  assert.equal(getVideoFrameTiming(partial.totalFrames - 1, partial).turn, 0);
});

test('camera path advances through moves at fixed frame boundaries', () => {
  const plan = getVideoFramePlan(13, 1, 1, 3);
  assert.equal(plan.framesPerMove, VIDEO_EXPORT_FPS);
  assert.equal(plan.turnFrames, 3 * VIDEO_EXPORT_FPS);
  const first = plan.startHoldFrames + plan.drawSteps;
  for (let move = 0; move < 3; move++) {
    const start = getVideoFrameTiming(first + move * plan.framesPerMove, plan);
    const end = getVideoFrameTiming(first + (move + 1) * plan.framesPerMove - 1, plan);
    assert.equal(start.moveIndex, move);
    assert.equal(start.turn, 0);
    assert.equal(end.moveIndex, move);
    assert.equal(end.turn, 1);
    assert.equal(start.observationIndex, 12);
  }
  const hold = getVideoFrameTiming(plan.totalFrames - 1, plan);
  assert.equal(hold.moveIndex, 2);
  assert.equal(hold.turn, 1);

  const still = getVideoFramePlan(13, 1, 0, 0);
  assert.equal(still.turnFrames, 0);
  assert.equal(getVideoFrameTiming(still.totalFrames - 1, still).turn, 0);
  assert.equal(getVideoFramePlan(13, 1, 1, 8).moveCount, 8);
  assert.throws(() => getVideoFramePlan(13, 1, 1, 21));
  assert.throws(() => getVideoFramePlan(13, 1, 1, -1));
});

test('pause steps hold the last camera view for their exact duration', () => {
  const plan = getVideoFramePlan(13, 1, 2, [
    { type: 'view', seconds: 2 }, { type: 'pause', seconds: 3 }, { type: 'view', seconds: 1 },
  ]);
  assert.deepEqual(plan.stepFrames, [60, 90, 30]);
  assert.deepEqual(plan.stepTypes, ['view', 'pause', 'view']);
  assert.equal(plan.turnFrames, 180);
  const start = plan.startHoldFrames + plan.drawSteps;
  assert.equal(getVideoFrameTiming(start + 59, plan).moveIndex, 0);
  assert.equal(getVideoFrameTiming(start + 60, plan).moveIndex, 1);
  assert.equal(getVideoFrameTiming(start + 149, plan).moveIndex, 1);
  assert.equal(getVideoFrameTiming(start + 150, plan).moveIndex, 2);
  assert.equal(getVideoFrameTiming(start + 179, plan).turn, 1);
  assert.throws(() => getVideoFramePlan(13, 1, 2, [{ type: 'pause', seconds: 31 }]));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarYear, yearlySegments, monthlyGraphSamples, layoutEase, graphLayout, unrollPolar, unrollFrame,
  monthLabelOpacity, graphYearLabelOffset, verticalGuidePosition, isConnectedDataSegment } from '../spiral-layout.mjs';

test('tubes and thin lines retain missing months and split only the graph year boundary', () => {
  const december = { decimalYear: 2000 + 11 / 12, stripYear: 2000 };
  const close = { decimalYear: 2001, stripYear: 2000 };
  const january = { decimalYear: 2001, stripYear: 2001 };
  const march = { decimalYear: 2001 + 2 / 12, stripYear: 2001 };
  for (const splitYears of [false, true]) {
    assert.equal(isConnectedDataSegment(december, close, splitYears), true);
    assert.equal(isConnectedDataSegment(close, january, splitYears), !splitYears);
    assert.equal(isConnectedDataSegment(january, march, splitYears), false);
    assert.equal(isConnectedDataSegment({ ...december, missing: true }, close, splitYears), false);
    assert.equal(isConnectedDataSegment(december, { ...close, missing: true }, splitYears), false);
  }
});

test('the original vertical guide pairs converge continuously at the far graph edge', () => {
  const layout = graphLayout(5, 20);
  for (const azimuth of [0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    for (const radius of [5, 10, 20]) {
      for (const side of [1, -1]) {
        const start = verticalGuidePosition(radius, side, azimuth, 0, layout);
        assert.ok(Math.abs(start.x - side * radius * Math.cos(azimuth)) < 1e-10);
        assert.ok(Math.abs(start.z + side * radius * Math.sin(azimuth)) < 1e-10);
        const end = verticalGuidePosition(radius, side, azimuth, 1, layout);
        assert.ok(Math.abs(end.z - (layout.center - radius)) < 1e-10);
        if (Math.abs(Math.sin(azimuth)) > 0.2) {
          assert.ok(Math.abs(end.x + Math.sign(Math.sin(azimuth)) * layout.width / 2) < 1e-10);
        }
        for (const progress of [0.1, 0.3, 0.5, 0.8, 0.99]) {
          const point = verticalGuidePosition(radius, side, azimuth, progress, layout);
          assert.ok(Math.abs(point.x - (start.x + (end.x - start.x) * progress)) < 1e-10);
          assert.ok(Math.abs(point.z - (start.z + (end.z - start.z) * progress)) < 1e-10);
        }
        const other = verticalGuidePosition(radius, -side, azimuth, 1, layout);
        assert.ok(Math.hypot(end.x - other.x, end.z - other.z) < 1e-10);
      }
    }
  }
  for (const front of [0, Math.PI]) {
    const a = verticalGuidePosition(10, 1, front - 1e-7, 1, layout);
    const b = verticalGuidePosition(10, 1, front + 1e-7, 1, layout);
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 0.001);
  }
});

test('unrolling preserves the spiral and finishes at twelve ordered months with a linear value axis', () => {
  const layout = graphLayout(5, 20);
  for (let month = 0; month <= 12; month++) {
    for (const radius of [5, 10, 20]) {
      const original = unrollPolar(radius, month / 12, 0, layout);
      assert.ok(Math.abs(original.x - radius * Math.sin(month / 12 * Math.PI * 2)) < 1e-10);
      assert.ok(Math.abs(original.z + radius * Math.cos(month / 12 * Math.PI * 2)) < 1e-10);
      const graph = unrollPolar(radius, month / 12, 1, layout);
      assert.ok(Math.abs(graph.x - layout.width * (month / 12 - 0.5)) < 1e-10);
      assert.equal(graph.z, layout.center - radius);
      const almost = unrollPolar(radius, month / 12, 1 - 1e-5, layout);
      assert.ok(Math.hypot(almost.x - graph.x, almost.z - graph.z) < 0.002);
    }
  }
  for (let frame = 0; frame <= 100; frame++) {
    assert.ok(Object.values(unrollFrame(frame / 100, layout)).every(Number.isFinite));
  }
});

test('year strips stop at December, missing months, and single-observation years', () => {
  const dates = [1996 + 10 / 12, 1996 + 11 / 12, 1997, 1997 + 2 / 12, 1998];
  assert.deepEqual(yearlySegments(dates), [
    { start: 0, end: 1 }, { start: 2, end: 2 }, { start: 3, end: 3 }, { start: 4, end: 4 },
  ]);
  assert.equal(calendarYear(1997 - 1e-9), 1997);
  assert.deepEqual(yearlySegments([]), []);
});

test('bending retains the distance between value guides without collapsing or reversing their scale', () => {
  const layout = graphLayout(5, 20);
  for (let frame = 0; frame <= 100; frame++) {
    for (let month = 0; month < 12; month++) {
      const low = unrollPolar(5, month / 12, frame / 100, layout);
      const high = unrollPolar(20, month / 12, frame / 100, layout);
      assert.ok(Math.abs(Math.hypot(high.x - low.x, high.z - low.z) - 15) < 1e-10);
    }
  }
  for (const progress of [0, 1]) {
    const frame = unrollFrame(progress, layout);
    assert.ok(Math.abs(frame.x) < 1e-10 && Math.abs(frame.z) < 1e-10);
  }
  assert.ok(Math.abs(unrollFrame(1, layout).radius - layout.radius) < 1e-10);
});

test('complete years retain December-January with one shared boundary observation, smooth or straight', () => {
  const dates = Array.from({ length: 26 }, (_, i) => 2000 + i / 12);
  for (const subdivisions of [1, 6]) {
    const { samples, observationIndices } = monthlyGraphSamples(dates, subdivisions);
    assert.equal(observationIndices.length, dates.length);
    assert.ok(samples.every(sample => !sample.missing));
    for (const january of [12, 24]) {
      const next = observationIndices[january], end = samples[next - 1], start = samples[next];
      assert.equal(end.phase, 1);
      assert.equal(start.phase, 0);
      assert.equal(end.sourceIndex, start.sourceIndex);
      assert.equal(end.year + 1, start.year);
      assert.ok(samples.slice(observationIndices[january - 1], next).every(sample => sample.year === end.year));
    }
    observationIndices.forEach((index, month) => assert.equal(samples[index].sourceIndex, month * subdivisions));
  }
});

test('unfolding does not fabricate January at gaps or beyond the last observation', () => {
  const { samples, observationIndices } = monthlyGraphSamples([2000 + 11 / 12, 2001 + 1 / 12, 2001 + 2 / 12], 6);
  assert.deepEqual(observationIndices, [0, 6, 12]);
  assert.equal(samples.filter(sample => sample.missing).length, 5);
  assert.ok(samples.every(sample => sample.missing || sample.phase !== 1));
  assert.deepEqual(monthlyGraphSamples([], 6).samples, []);
});

test('easing starts and ends gently, and centering has no bounding-box jumps', () => {
  assert.equal(layoutEase(0), 0);
  assert.equal(layoutEase(1), 1);
  assert.ok(layoutEase(0.001) < 1e-7);
  assert.ok(1 - layoutEase(0.999) < 1e-7);
  const layout = graphLayout(5, 20);
  let previous = unrollFrame(0, layout), delta = null;
  for (let i = 1; i <= 1000; i++) {
    const frame = unrollFrame(i / 1000, layout);
    const nextDelta = [frame.x - previous.x, frame.z - previous.z, frame.radius - previous.radius];
    if (delta) assert.ok(Math.max(...nextDelta.map((value, j) => Math.abs(value - delta[j]))) < 0.001);
    previous = frame;
    delta = nextDelta;
  }
});

test('month labels fade gradually through overlap instead of disappearing at first contact', () => {
  assert.equal(monthLabelOpacity(1), 1);
  assert.equal(monthLabelOpacity(1.2), 1);
  assert.equal(monthLabelOpacity(0), 0);
  assert.ok(monthLabelOpacity(0.9) > 0.95);
  assert.ok(monthLabelOpacity(0.6) > 0.4 && monthLabelOpacity(0.6) < 0.7);
  assert.ok(monthLabelOpacity(0.3) > 0 && monthLabelOpacity(0.3) < 0.1);
  let previous = 0;
  for (let step = 0; step <= 100; step++) {
    const opacity = monthLabelOpacity(step / 100);
    assert.ok(opacity >= previous && opacity - previous < 0.03);
    previous = opacity;
  }
});

test('year labels stay outside the projected graph width around a full rotation', () => {
  const layout = graphLayout(5, 20);
  for (let degree = -180; degree <= 180; degree++) {
    const azimuth = degree * Math.PI / 180;
    const offset = graphYearLabelOffset(azimuth, layout);
    for (const x of [-layout.width / 2, layout.width / 2]) {
      for (const z of [layout.center - layout.minRadius, layout.center - layout.maxRadius]) {
        const projected = x * Math.cos(azimuth) - z * Math.sin(azimuth);
        assert.ok(offset - projected >= 3.4 - 1e-10);
      }
    }
  }
});

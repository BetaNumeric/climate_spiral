import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSpiralGeometry } from '../spiral-geometry.mjs';
import { graphLayout, unrollFrame, unrollPolar, isConnectedDataSegment } from '../spiral-layout.mjs';

const geometryTools = createSpiralGeometry(THREE);
const radialSegments = 8;
const heightPerYear = 0.24;

function build(dates, { smooth = false, tubeRadius = 0.12, preserveMonthlyGaps = true } = {}) {
  const originYear = Math.floor(dates[0]);
  const metadata = dates.map((decimalYear, index) => ({
    decimalYear, anomaly: Math.sin(index * 0.6) * 0.8, displayValue: 100 + index,
  }));
  const radiusAtValue = value => 10 + value * 5;
  const pointAt = (decimalYear, value) => {
    const angle = (decimalYear - Math.floor(decimalYear)) * Math.PI * 2 - Math.PI / 2;
    const radius = radiusAtValue(value);
    return new THREE.Vector3(Math.cos(angle) * radius, (decimalYear - originYear) * heightPerYear,
      Math.sin(angle) * radius);
  };
  const points = metadata.map(point => pointAt(point.decimalYear, point.anomaly));
  const colors = metadata.map((_, index) => new THREE.Color().setRGB(index / dates.length, 0.5, 1));
  const layout = graphLayout(5, 15);
  const ghostDates = [];
  const result = geometryTools.createSpiralBuffers(points, colors, metadata, {
    smooth, tubeRadius, preserveMonthlyGaps, layout, originYear, heightPerYear, radiusAtValue, radialSegments,
    pointAt: (date, value) => { ghostDates.push(date); return pointAt(date, value); },
  });
  return { ...result, metadata, points, colors, layout, originYear, ghostDates };
}

function assertFinite(geometry) {
  for (const name of ['position', 'normal', 'color']) {
    assert.ok(geometry.attributes[name].array.every(Number.isFinite), name);
  }
}

function assertConnectedTriangles(indices, metadata, splitYears) {
  for (let i = 0; i < indices.length; i += 3) {
    const vertices = Array.from(indices.slice(i, i + 3));
    if (new Set(vertices).size < 3) continue;
    const rings = [...new Set(vertices.map(vertex => Math.floor(vertex / radialSegments)))];
    if (rings.some(ring => ring >= metadata.length) || rings.length < 2) continue;
    assert.equal(rings.length, 2);
    const [a, b] = rings.sort((a, b) => a - b);
    assert.ok(isConnectedDataSegment(metadata[a], metadata[b], splitYears), 'Triangle crosses a gap or graph year boundary');
  }
}

test('duplicate January rings match an uninterrupted tube, including normals and cap vertices', () => {
  const points = [new THREE.Vector3(1, 0, -2), new THREE.Vector3(2, 1, -1),
    new THREE.Vector3(2, 2, 1), new THREE.Vector3(1, 3, 2)];
  const sources = [0, 1, 1, 2, 3, 3];
  const colors = points.map(() => new THREE.Color('white'));
  const reference = geometryTools.createDataTubeGeometry(points, colors, 0.12, radialSegments);
  const duplicated = geometryTools.createDataTubeGeometry(sources.map(i => points[i]), sources.map(i => colors[i]), 0.12, radialSegments);
  for (const name of ['position', 'normal', 'color']) {
    for (let vertex = 0; vertex < duplicated.attributes[name].count; vertex++) {
      const source = vertex < sources.length * radialSegments
        ? sources[Math.floor(vertex / radialSegments)] * radialSegments + vertex % radialSegments
        : points.length * radialSegments + vertex - sources.length * radialSegments;
      for (let axis = 0; axis < 3; axis++) {
        assert.equal(duplicated.attributes[name].array[vertex * 3 + axis], reference.attributes[name].array[source * 3 + axis]);
      }
    }
  }
  assert.ok(!duplicated.index.array.includes(2 * radialSegments));
  assertFinite(duplicated);
});

test('coincident rings stay separate at graph year boundaries and real gaps', () => {
  const points = [new THREE.Vector3(1, 0, -2), new THREE.Vector3(2, 1, -1),
    new THREE.Vector3(2, 2, 1), new THREE.Vector3(1, 3, 2)];
  const sources = [0, 1, 1, 2, 3, 3];
  const colors = sources.map(() => new THREE.Color('white'));
  const metadata = sources.map((source, index) => ({ decimalYear: 2000 + source / 12, stripYear: index < 2 ? 2000 : 2001 }));
  const flat = geometryTools.createDataTubeGeometry(sources.map(i => points[i]), colors, 0.12, radialSegments, metadata, true);
  const gapMetadata = metadata.map((point, index) => ({ ...point, missing: index === 2 }));
  const gap = geometryTools.createDataTubeGeometry(sources.map(i => points[i]), colors, 0.12, radialSegments, gapMetadata);
  assert.ok(flat.index.array.includes(2 * radialSegments));
  assert.ok(gap.index.array.includes(2 * radialSegments));
  assertConnectedTriangles(flat.index.array, metadata, true);
  assertConnectedTriangles(gap.index.array, gapMetadata, false);
  assertFinite(flat);
  assertFinite(gap);
});

test('tube ends retain flat cap fans and stable timeline index slots', () => {
  const result = build([2000, 2000 + 1 / 12, 2000 + 2 / 12]);
  const { geometry, data, totalIndices } = result;
  assert.equal(geometry.attributes.position.count, data.length * radialSegments + 2);
  assert.equal(geometry.index.count, totalIndices + radialSegments * 6);
  const firstCenter = geometry.attributes.position.count - 2;
  const lastCenter = firstCenter + 1;
  for (let side = 0; side < radialSegments; side++) {
    assert.equal(geometry.index.array[side * 3], firstCenter);
    assert.equal(geometry.index.array[geometry.index.count - radialSegments * 3 + side * 3], lastCenter);
  }
  const first = new THREE.Vector3().fromBufferAttribute(geometry.attributes.position, firstCenter);
  const last = new THREE.Vector3().fromBufferAttribute(geometry.attributes.position, lastCenter);
  assert.ok(first.distanceTo(result.points[0]) < 1e-6);
  assert.ok(last.distanceTo(result.points.at(-1)) < 1e-6);
});

test('smooth and straight tubes preserve observations and open only the unwrapped January boundary', () => {
  const dates = Array.from({ length: 26 }, (_, i) => 2000 + i / 12);
  for (const smooth of [false, true]) {
    const { geometry, data, timelineStops, totalIndices } = build(dates, { smooth });
    assert.equal(timelineStops.length, dates.length);
    assert.equal(timelineStops[0], 0);
    assert.equal(timelineStops.at(-1), totalIndices);
    timelineStops.forEach((stop, index) => {
      const point = data[stop / (radialSegments * 6)];
      assert.equal(point.decimalYear, dates[index]);
      assert.equal(point.displayValue, 100 + index);
    });
    const morph = geometry.layoutMorph;
    let joins = 0;
    for (let i = 1; i < data.length; i++) {
      if (data[i].decimalYear !== data[i - 1].decimalYear || data[i].stripYear === data[i - 1].stripYear) continue;
      joins++;
      const offset = i * radialSegments * 3;
      const previous = offset - radialSegments * 3;
      assert.deepEqual(morph.source.slice(offset, offset + radialSegments * 3), morph.source.slice(previous, offset));
      assert.deepEqual(morph.sourceNormals.slice(offset, offset + radialSegments * 3), morph.sourceNormals.slice(previous, offset));
      assert.ok(!morph.sourceIndex.includes(i * radialSegments));
      assert.notEqual(morph.target[offset], morph.target[previous]);
    }
    assert.equal(joins, 2);
    assertConnectedTriangles(morph.targetIndex, data.map(point => ({ ...point, missing: point.graphMissing })), true);
    assertFinite(geometry);
  }
});

test('missing months are not bridged in either layout, with smooth or straight sampling', () => {
  for (const smooth of [false, true]) {
    for (const dates of [[2000, 2000 + 1 / 12, 2000 + 3 / 12, 2000 + 4 / 12], [2000, 2001, 2001 + 2 / 12]]) {
      const { geometry, data, timelineStops } = build(dates, { smooth });
      assert.equal(timelineStops.length, dates.length);
      if (smooth) assert.ok(data.some(point => point.spiralMissing));
      assertConnectedTriangles(geometry.layoutMorph.sourceIndex, data.map(point => ({ ...point, missing: point.spiralMissing })), false);
      assertConnectedTriangles(geometry.layoutMorph.targetIndex, data.map(point => ({ ...point, missing: point.graphMissing })), true);
      assertFinite(geometry);
    }
  }
});

test('persistence ghost months shape the spline endpoint without becoming observations', () => {
  const dates = [2000 + 10 / 12, 2000 + 11 / 12, 2001, 2001 + 2 / 12];
  const result = build(dates, { smooth: true });
  assert.deepEqual(result.ghostDates, [2001 + 1 / 12, 2001 + 3 / 12]);
  assert.equal(result.timelineStops.length, dates.length);
  assert.equal(result.data.at(-1).decimalYear, dates.at(-1));
  assert.ok(result.data.at(-1).point.distanceTo(result.points.at(-1)) < 1e-9);
  assert.equal(result.data.at(-1).displayValue, 100 + dates.length - 1);
});

test('zero-thickness lines share tube attributes and skip gaps and unwrapped year boundaries', () => {
  const dates = [2000 + 10 / 12, 2000 + 11 / 12, 2001, 2001 + 2 / 12];
  for (const smooth of [false, true]) {
    const { geometry, lineGeometry, data } = build(dates, { smooth, tubeRadius: 0 });
    assert.equal(lineGeometry.attributes.position, geometry.attributes.position);
    assert.equal(lineGeometry.attributes.color, geometry.attributes.color);
    for (const [name, splitYears] of [['source', false], ['target', true]]) {
      const indices = lineGeometry.layoutIndices[name];
      assert.equal(indices.length, (data.length - 1) * 2);
      for (let i = 0; i < indices.length; i += 2) {
        const [a, b] = [indices[i], indices[i + 1]].map(vertex => data[vertex / radialSegments]);
        const missingKey = splitYears ? 'graphMissing' : 'spiralMissing';
        if (indices[i] !== indices[i + 1]) {
          assert.ok(isConnectedDataSegment({ ...a, missing: a[missingKey] }, { ...b, missing: b[missingKey] }, splitYears));
        }
      }
    }
    assertFinite(geometry);
  }
});

test('morphing stays finite and restores the original position and normal buffers exactly', () => {
  const dates = Array.from({ length: 15 }, (_, index) => 2000 + index / 12);
  for (const smooth of [false, true]) {
    for (const tubeRadius of [0, 0.12, 0.18]) {
      const { geometry, layout, totalIndices } = build(dates, { smooth, tubeRadius });
      const morph = geometry.layoutMorph;
      geometry.setDrawRange(0, Math.floor(totalIndices / 2));
      const range = { ...geometry.drawRange };
      for (const bend of [0.001, 0.25, 0.5, 0.75, 1, 0.5, 0]) {
        geometryTools.morphGeometry(geometry, bend, { layout, frame: unrollFrame(bend, layout), height: 2 * heightPerYear });
        assertFinite(geometry);
        assert.deepEqual(geometry.drawRange, range);
        assert.ok(Number.isFinite(geometry.boundingSphere.radius) && geometry.boundingSphere.radius > 0);
        if (bend === 0 || bend === 1) {
          assert.deepEqual(geometry.attributes.position.array, bend === 0 ? morph.source : morph.target);
          assert.deepEqual(geometry.attributes.normal.array, bend === 0 ? morph.sourceNormals : morph.targetNormals);
        }
      }
    }
  }
});

test('reference ring morphs use Three.js tube cross-sections rather than the data tube segment count', () => {
  const layout = graphLayout(5, 15);
  const segments = 24;
  const points = Array.from({ length: segments + 1 }, (_, index) => {
    const angle = index / segments * Math.PI * 2;
    return new THREE.Vector3(Math.sin(angle) * 10, 0, -Math.cos(angle) * 10);
  });
  const source = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), segments, 0.025, 6);
  const target = new THREE.TubeGeometry(new THREE.LineCurve3(new THREE.Vector3(-layout.width / 2, 0, 0),
    new THREE.Vector3(layout.width / 2, 0, 0)), segments, 0.025, 6);
  geometryTools.prepareLayoutMorph(source, target, vertex => Math.floor(vertex / 7) / segments, { layout, radialSegments });
  assert.equal(source.layoutMorph.groups.length, segments + 1);
  assert.ok(source.layoutMorph.groups.every(group => group.end - group.start === 7 * 3));
  for (const bend of [0.25, 1, 0]) {
    geometryTools.morphGeometry(source, bend, { layout, frame: unrollFrame(bend, layout), height: 0 });
    assert.ok(source.attributes.position.array.every(Number.isFinite));
    assert.ok(source.attributes.normal.array.every(Number.isFinite));
  }
  assert.deepEqual(source.attributes.position.array, source.layoutMorph.source);
  assert.deepEqual(source.attributes.normal.array, source.layoutMorph.sourceNormals);
});

test('label points follow the same bend correction and reach exact layout endpoints', () => {
  const layout = graphLayout(5, 15);
  const phase = 0.375;
  const sourcePolar = unrollPolar(10, phase, 0, layout);
  const targetPolar = unrollPolar(10, phase, 1, layout);
  const source = new THREE.Vector3(sourcePolar.x, -2, sourcePolar.z);
  const target = new THREE.Vector3(targetPolar.x + 1, -1, targetPolar.z - 0.5);
  const result = new THREE.Vector3();
  for (const bend of [0, 0.25, 0.5, 0.75, 1]) {
    const frame = unrollFrame(bend, layout);
    assert.equal(geometryTools.morphPoint(source, target, phase, bend, result, { layout, frame }), result);
    assert.ok(result.toArray().every(Number.isFinite));
    if (bend === 0 || bend === 1) assert.deepEqual(result, bend === 0 ? source : target);
    else {
      const polar = unrollPolar(10, phase, bend, layout);
      assert.ok(Math.abs(result.x - (polar.x + bend * bend + frame.x)) < 1e-10);
      assert.ok(Math.abs(result.z - (polar.z - bend * bend * 0.5 + frame.z)) < 1e-10);
      assert.ok(Math.abs(result.y - THREE.MathUtils.lerp(source.y, target.y, bend)) < 1e-10);
    }
  }
});

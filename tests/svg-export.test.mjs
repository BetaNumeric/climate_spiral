import test from 'node:test';
import assert from 'node:assert/strict';
import { getSvgPaths } from '../svg-export.mjs';

const point = (month, x, color = '#123456', extra = {}) => ({ decimalYear: 2000 + month / 12, x, y: -month || 0, color, ...extra });

test('SVG merges uniformly colored segments without changing sampled coordinates', () => {
    const samples = [point(0, 3), point(1, 4), point(2, 5), point(3, 6)];
    const original = structuredClone(samples);
    const paths = getSvgPaths(samples);
    assert.equal(paths.length, 1);
    assert.deepEqual(paths[0].points, [[3, 0], [4, -1], [5, -2], [6, -3]]);
    assert.equal(paths[0].startColor, '#123456');
    assert.equal(paths[0].endColor, '#123456');
    assert.deepEqual(samples, original);
});

test('SVG keeps sampled color endpoints for changing colors and compact paths for uniform runs', () => {
    const paths = getSvgPaths([point(0, 1), point(1, 2), point(2, 3, '#abcdef'), point(3, 4, '#abcdef')]);
    assert.equal(paths.length, 3);
    assert.deepEqual(paths.map(path => [path.startColor, path.endColor]),
        [['#123456', '#123456'], ['#123456', '#abcdef'], ['#abcdef', '#abcdef']]);
    assert.deepEqual(paths[1].points, [[2, -1], [3, -2]]);
});

test('SVG preserves temporal gaps and never joins coincident points across a break', () => {
    const paths = getSvgPaths([point(0, 1), point(1, 2), point(3, 2, '#123456', { y: -1 }), point(4, 3)]);
    assert.equal(paths.length, 2);
    assert.deepEqual(paths[0].points, [[1, 0], [2, -1]]);
    assert.deepEqual(paths[1].points, [[2, -1], [3, -4]]);
});

test('SVG omits render-only missing samples and zero-length January copies', () => {
    const january = point(12, 4);
    const paths = getSvgPaths([point(11, 3), january, { ...january }, point(13, 5),
        point(14, 6, '#123456', { missing: true }), point(15, 7), point(16, 8)]);
    assert.equal(paths.length, 2);
    assert.ok(paths.every(path => path.points.some(([x, y]) => x !== path.points[0][0] || y !== path.points[0][1])));
});

test('single-color SVG stays one continuous path across multiple January duplicates', () => {
    const january = point(12, 4), nextJanuary = point(24, 7);
    const samples = [point(11, 3), january, { ...january }, point(13, 5),
        ...Array.from({ length: 10 }, (_, i) => point(14 + i, 6 + i / 10)), nextJanuary,
        { ...nextJanuary }, point(25, 8)];
    const paths = getSvgPaths(samples);
    assert.equal(paths.length, 1);
    assert.equal(paths[0].points.length, samples.length - 2);
    assert.equal(paths[0].stroke, '#123456');
});

test('SVG merges neighboring segments whose rendered midpoint colors are identical', () => {
    const samples = [point(0, 1, '#123456'), point(1, 2, '#abcdef'), point(2, 3, '#123456')];
    const paths = getSvgPaths(samples);
    assert.equal(paths.length, 1);
    assert.deepEqual(paths[0].points, [[1, 0], [2, -1], [3, -2]]);
});

test('duplicate points do not hide a genuine gap or a stroke-color change', () => {
    const january = point(12, 4);
    const changed = getSvgPaths([point(11, 3), january, { ...january, color: '#abcdef' }, point(13, 5, '#abcdef')]);
    assert.equal(changed.length, 2);
    assert.notEqual(changed[0].stroke, changed[1].stroke);
    const gap = getSvgPaths([point(0, 1), point(1, 2), point(3, 2, '#123456', { y: -1 }), point(4, 3)]);
    assert.equal(gap.length, 2);
});

test('SVG follows the existing legacy interpolation capability without bridging explicit missing samples', () => {
    const samples = [point(0, 1), point(1, 2), point(36, 3), point(37, 4)];
    assert.equal(getSvgPaths(samples).length, 2);
    assert.equal(getSvgPaths(samples, false).length, 1);
    samples[2].missing = true;
    assert.equal(getSvgPaths(samples, false).length, 1);
    assert.equal(getSvgPaths(samples, false)[0].points.length, 2);
});

test('SVG rejects empty, isolated, non-finite, or unsafe path inputs', () => {
    for (const samples of [[], [point(0, 1)], [point(0, 1), point(2, 2)],
        [point(0, NaN), point(1, 2)], [point(0, 1), point(1, Infinity)],
        [point(0, 1, 'url(https://example.com)'), point(1, 2)],
        [point(0, 1), point(1, 2, '#123456', { decimalYear: NaN })]]) {
        assert.throws(() => getSvgPaths(samples));
    }
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getDatasetDisplay, formatDatasetValue, formatReferenceValue, getLegendPercent } from '../dataset-display.mjs';
import { localTemperatureRange } from '../local-temperature-data.mjs';

test('temperature formatting preserves signs, precision, and Celsius units', () => {
    for (const key of ['temperature', 'ocean', 'land', 'local']) {
        const display = getDatasetDisplay(key, localTemperatureRange([]));
        assert.equal(formatDatasetValue(1.24, display), '+1.24 \u00b0C');
        assert.equal(formatDatasetValue(-0.34, display), '-0.34 \u00b0C');
        assert.equal(formatDatasetValue(0, display), '0.00 \u00b0C');
        assert.equal(formatReferenceValue(1, display), '+1\u00b0C');
    }
});

test('concentrations, ice, and sea level retain their native units and precision', () => {
    for (const [key, value, expected] of [
        ['co2', 426.65, '426.65 ppm'], ['methane', 1927.32, '1927.32 ppb'],
        ['arctic', 4.37, '4.37 M km\u00b2'], ['antarctic', 18.26, '18.26 M km\u00b2'],
        ['arcticvolume', 12.345, '12.35 10\u00b3 km\u00b3'],
        ['sealevel', 112.36, '+112.4 mm'], ['sealevel', -5.4, '-5.4 mm'],
    ]) assert.equal(formatDatasetValue(value, getDatasetDisplay(key)), expected);
});

test('reference labels reverse the model scaling to source units', () => {
    for (const [key, expected] of [
        ['temperature', ['0\u00b0C', '+1\u00b0C', '-1\u00b0C']],
        ['co2', ['330 ppm', '380 ppm', '430 ppm']],
        ['methane', ['1700 ppb', '1900 ppb', '2100 ppb']],
        ['sealevel', ['0 mm', '75 mm', '150 mm']],
        ['arctic', ['5 M km\u00b2', '10 M km\u00b2', '15 M km\u00b2', '20 M km\u00b2']],
        ['arcticvolume', ['10 10\u00b3 km\u00b3', '20 10\u00b3 km\u00b3', '30 10\u00b3 km\u00b3',
            '40 10\u00b3 km\u00b3', '50 10\u00b3 km\u00b3', '60 10\u00b3 km\u00b3']],
    ]) {
        const display = getDatasetDisplay(key);
        assert.deepEqual(display.referenceValues.map(value => formatReferenceValue(value, display)), expected);
    }
});

test('legend markers use native values and clamp values outside the display range', () => {
    for (const [key, min, mid, max] of [
        ['temperature', -1, 0.5, 2], ['co2', 280, 355, 430],
        ['methane', 1500, 1800, 2100], ['arctic', 0, 10, 20],
        ['arcticvolume', 0, 30, 60], ['sealevel', 0, 75, 150],
    ]) {
        const display = getDatasetDisplay(key);
        assert.equal(getLegendPercent(min, display), 0);
        assert.equal(getLegendPercent(mid, display), 50);
        assert.equal(getLegendPercent(max, display), 100);
        assert.equal(getLegendPercent(min - 100, display), 0);
        assert.equal(getLegendPercent(max + 100, display), 100);
    }
});

test('local legend and reference values follow the selected location range', () => {
    const narrow = getDatasetDisplay('local', { extent: 2, ticks: [-2, 0, 2] });
    const wide = getDatasetDisplay('local', { extent: 10, ticks: [-10, -5, 0, 5, 10] });
    assert.equal(getLegendPercent(2, narrow), 100);
    assert.equal(getLegendPercent(2, wide), 60);
    assert.equal(getLegendPercent(0, wide), 50);
    assert.deepEqual(wide.legendLabels, ['-10\u00b0C', '-5\u00b0C', '0\u00b0C', '+5\u00b0C', '+10\u00b0C']);
    assert.deepEqual(wide.referenceValues.map(value => formatReferenceValue(value, wide)), wide.legendLabels);
    assert.deepEqual(narrow.referenceValues, [-2, 0, 2]);
});

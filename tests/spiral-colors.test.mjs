import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSpiralGeometry } from '../spiral-geometry.mjs';
import { graphLayout } from '../spiral-layout.mjs';
import { getDatasetDisplay } from '../dataset-display.mjs';
import { DEFAULT_SINGLE_COLOR, YEAR_COLOR_STOPS, getYearColorFraction,
    ANOMALY_COLOR_STOPS, UNAVAILABLE_ANOMALY_COLOR, createSeasonalColorModel,
    getSpiralColorDisplay, sampleColorStops, recolorSpiral } from '../spiral-colors.mjs';
import { readFile } from 'node:fs/promises';
import { DATASET_CONFIG } from '../datasets.mjs';

const seasonalYears = (start, end) => Array.from({ length: end - start + 1 }, (_, index) => ({
    year: start + index,
    anomalies: Array.from({ length: 12 }, (_, month) => month * 100 + start + index - 1991),
}));

test('seasonal anomalies use observed calendar-month means from a fixed 1991-2020 reference', () => {
    const data = seasonalYears(1991, 2020), before = structuredClone(data);
    const model = createSeasonalColorModel(data);
    assert.equal(model.standardPeriod, true);
    assert.deepEqual(model.range, [1991, 2020]);
    assert.deepEqual(model.counts, Array(12).fill(30));
    assert.deepEqual(model.means, Array.from({ length: 12 }, (_, month) => month * 100 + 14.5));
    assert.equal(model.anomalyAt(1991), -14.5);
    assert.equal(model.anomalyAt(2020 + 11 / 12), 14.5);
    const extended = createSeasonalColorModel([...data, ...seasonalYears(2021, 2026)]);
    assert.deepEqual(extended.means, model.means);
    assert.equal(extended.anomalyAt(1991), model.anomalyAt(1991));
    assert.deepEqual(data, before);
});

test('seasonal reference requires 20 distinct observed years per month, otherwise labels the record fallback', () => {
    const enough = seasonalYears(2001, 2020);
    assert.equal(createSeasonalColorModel(enough).standardPeriod, true);
    const sparse = seasonalYears(2002, 2020);
    const model = createSeasonalColorModel([...sparse, ...sparse]);
    assert.equal(model.standardPeriod, false);
    assert.deepEqual(model.counts, Array(12).fill(19));
    assert.deepEqual(model.range, [2002, 2020]);
    assert.match(model.caption, /2002-2020 available-record mean/);
    enough[0].fractions = Array.from({ length: 11 }, (_, month) => (month + 1) / 12);
    enough[0].anomalies.shift();
    assert.equal(createSeasonalColorModel(enough).standardPeriod, false);
});

test('seasonal colors use source units and actual month positions, interpolating only consecutive observations', () => {
    const data = [
        { year: 1990, anomalies: [1, 2], displayValues: [100, 220], fractions: [10 / 12, 11 / 12] },
        { year: 1991, anomalies: [3, 4, 5], displayValues: [300, 410, NaN], fractions: [0, 2 / 12, 3 / 12] },
        { year: 1992, anomalies: [7, 8, 9, 10], displayValues: [500, 400, 620, 430], fractions: [0, 2 / 12, 11 / 12, 10 / 12] },
    ];
    const model = createSeasonalColorModel(data);
    assert.equal(model.means[10], 265);
    assert.equal(model.means[11], 420);
    assert.equal(model.means[0], 400);
    assert.equal(model.means[1], null);
    assert.equal(model.means[3], null);
    assert.equal(model.anomalyAt(1990 + 11 / 12), -200);
    assert.equal(model.anomalyAt(1991), -100);
    assert.ok(Math.abs(model.anomalyAt(1990 + 11.5 / 12) + 150) < 1e-7);
    assert.equal(model.anomalyAt(1991 + 0.5 / 12), null);
    assert.equal(model.anomalyAt(1991 + 1 / 12), null);
    assert.equal(model.anomalyAt(1989), null);
});

test('monthly legends are symmetric, signed and separate from the original measurement descriptor', () => {
    for (const key of ['temperature', 'arcticvolume', 'methane', 'co2', 'sealevel']) {
        const measurement = getDatasetDisplay(key), labels = [...measurement.legendLabels];
        const seasonal = createSeasonalColorModel(seasonalYears(1991, 2020));
        const display = getSpiralColorDisplay('seasonal', measurement, { seasonal });
        assert.deepEqual(display.legendRange, [-15, 15]);
        assert.deepEqual(display.legendStops, ANOMALY_COLOR_STOPS);
        assert.ok(display.legendLabels[0].startsWith('-'));
        assert.ok(display.legendLabels[2].startsWith('+'));
        assert.ok(display.legendLabels.every(label => label.endsWith(measurement.unit)));
        assert.match(display.caption, /1991-2020 mean/);
        assert.equal(display.showMarker, true);
        assert.deepEqual(measurement.legendLabels, labels);
    }
});

test('yearly anomalies average twelve distinct monthly deviations and keep a fixed reference', () => {
    const data = seasonalYears(1991, 2020);
    data[0].anomalies[0] += 12;
    const model = createSeasonalColorModel(data);
    assert.equal(model.annualCount, 30);
    for (const entry of data) {
        const expected = entry.anomalies.reduce((sum, value, month) => sum + value - model.means[month], 0) / 12;
        assert.ok(Math.abs(model.yearlyAnomalyAt(entry.year) - expected) < 1e-10);
        assert.equal(model.yearlyAnomalyAt(entry.year), model.yearlyAnomalyAt(entry.year + 11 / 12));
    }
    assert.ok(Math.abs(model.annualMagnitude - 14.466666666666667) < 1e-10);
    assert.match(model.annualCaption, /Yearly.*1991-2020 mean/);
    const extended = createSeasonalColorModel([...data, ...seasonalYears(2021, 2026)]);
    assert.equal(extended.yearlyAnomalyAt(1991), model.yearlyAnomalyAt(1991));
    const duplicate = createSeasonalColorModel([...data, ...data]);
    assert.equal(duplicate.annualCount, model.annualCount);
    assert.equal(duplicate.yearlyAnomalyAt(1991), model.yearlyAnomalyAt(1991));
});

test('yearly anomalies exclude incomplete years, nonfinite months, and gaps without substituting zero', () => {
    const data = seasonalYears(1991, 2020);
    data[0].anomalies.pop();
    data[1].anomalies[5] = NaN;
    data.push({ year: 2026, anomalies: [3], fractions: [0] });
    const model = createSeasonalColorModel(data);
    assert.equal(model.annualCount, 28);
    for (const year of [1990, 1991, 1992, 2021, 2026]) assert.equal(model.yearlyAnomalyAt(year + 0.5), null);
    assert.equal(model.yearlyAnomalyAt(2020 + 11 / 12), model.yearlyAnomalyAt(2020));
    assert.equal(model.yearlyAnomalyAt(2021 - 1e-9), null);
    assert.notEqual(model.anomalyAt(2026), null, 'An observed month still has a monthly anomaly');
});

test('yearly legends use only complete-year magnitudes and remain distinct from monthly legends', () => {
    const data = seasonalYears(1991, 2020);
    data.push({ year: 2026, anomalies: [10000] });
    const seasonal = createSeasonalColorModel(data), measurement = getDatasetDisplay('temperature');
    const monthly = getSpiralColorDisplay('seasonal', measurement, { seasonal });
    const annual = getSpiralColorDisplay('annual', measurement, { seasonal });
    assert.deepEqual(annual.legendRange, [-15, 15]);
    assert.ok(monthly.legendRange[1] > 9000);
    assert.match(annual.caption, /Yearly.*1991-2020 mean/);
    assert.deepEqual(annual.legendStops, monthly.legendStops);
    assert.equal(annual.showMarker, true);
    const incomplete = createSeasonalColorModel([{ year: 2000, anomalies: [0] }]);
    assert.equal(getSpiralColorDisplay('annual', measurement, { seasonal: incomplete }).showMarker, false);
    const complete = createSeasonalColorModel([{ year: 2000, anomalies: Array(12).fill(10) }]);
    assert.equal(complete.yearlyAnomalyAt(2000), 0);
    const constant = getSpiralColorDisplay('annual', measurement, { seasonal: complete });
    assert.equal(constant.showMarker, true);
    assert.deepEqual(constant.legendRange, [-0.01, 0.01]);
    assert.match(constant.caption, /2000-2000 available-record mean/);
});

test('anomaly scales use tight, linear ranges without clipping observations or whitening small deviations', () => {
    const measurement = getDatasetDisplay('arctic');
    for (const [magnitude, expected] of [[2.163, 2.2], [2.496, 2.5], [9.0635, 9.1], [70.6738, 71], [157.036, 160]]) {
        const display = getSpiralColorDisplay('seasonal', measurement, { seasonal: { magnitude, range: [1991, 2020] } });
        assert.ok(Math.abs(display.legendRange[1] - expected) < 1e-10);
        assert.ok(display.legendRange[1] >= magnitude);
    }
    const blue = new THREE.Color(ANOMALY_COLOR_STOPS[1][1]);
    const neutral = new THREE.Color(ANOMALY_COLOR_STOPS[2][1]);
    const red = new THREE.Color(ANOMALY_COLOR_STOPS[3][1]);
    assert.ok(blue.b - blue.r > 0.35, 'A quarter-range negative anomaly is visibly blue');
    assert.ok(red.r - red.b > 0.4, 'A quarter-range positive anomaly is visibly red');
    assert.ok(neutral.r < 0.65 && neutral.g < 0.65 && neutral.b < 0.65, 'Zero is gray rather than bright white');
    assert.notEqual(new THREE.Color(UNAVAILABLE_ANOMALY_COLOR).getHexString(), neutral.getHexString());
});

test('seasonal legends handle constant, tiny and empty datasets without dividing by zero', () => {
    const measurement = getDatasetDisplay('temperature');
    for (const data of [[], [{ year: 2000, anomalies: [0.000001] }]]) {
        const seasonal = createSeasonalColorModel(data);
        const display = getSpiralColorDisplay('seasonal', measurement, { seasonal });
        assert.deepEqual(display.legendRange, [-0.01, 0.01]);
        assert.equal(display.showMarker, data.length > 0);
        assert.equal(seasonal.anomalyAt(2000), data.length ? 0 : null);
    }
});

test('all bundled datasets have adequate seasonal reference coverage in real source units', async () => {
    for (const [key, dataset] of Object.entries(DATASET_CONFIG)) {
        if (!dataset.localPath) continue;
        const data = dataset.parse(await readFile(new URL('../' + dataset.localPath, import.meta.url), 'utf8'));
        const model = createSeasonalColorModel(data);
        assert.equal(model.standardPeriod, true, key);
        assert.ok(model.counts.every(count => count >= 20), key);
        for (const entry of data) {
            for (let index = 0; index < entry.anomalies.length; index++) {
                const month = Math.round(entry.fractions[index] * 12);
                const value = entry.displayValues?.[index] ?? entry.anomalies[index];
                assert.ok(Math.abs(model.anomalyAt(entry.year + month / 12) - (value - model.means[month])) < 1e-8, key);
            }
            if (new Set(entry.fractions).size === 12) {
                const annual = entry.anomalies.reduce((sum, value, index) => sum
                    + (entry.displayValues?.[index] ?? value) - model.means[Math.round(entry.fractions[index] * 12)], 0) / 12;
                assert.ok(Math.abs(model.yearlyAnomalyAt(entry.year) - annual) < 1e-8, key + ' complete year');
            } else {
                assert.equal(model.yearlyAnomalyAt(entry.year), null, key + ' incomplete year');
            }
        }
    }
});

test('value coloring retains each dataset legend without changing measurement descriptors', () => {
    for (const key of ['temperature', 'ocean', 'land', 'arctic', 'antarctic', 'arcticvolume', 'co2', 'methane', 'sealevel']) {
        const measurement = getDatasetDisplay(key);
        const before = structuredClone(measurement.legendStops);
        const display = getSpiralColorDisplay('value', measurement, { startYear: 1880, endYear: 2026 });
        assert.deepEqual(display.legendStops, measurement.legendStops);
        assert.deepEqual(display.legendRange, measurement.legendRange);
        assert.deepEqual(display.legendLabels, measurement.legendLabels);
        assert.equal(display.showMarker, true);
        getSpiralColorDisplay('year', measurement, { startYear: 1880, endYear: 2026 });
        getSpiralColorDisplay('single', measurement, { startYear: 1880, endYear: 2026 });
        assert.deepEqual(measurement.legendStops, before);
    }
});

test('year coloring uses the complete fixed year range and handles single-year records', () => {
    const measurement = getDatasetDisplay('temperature');
    const display = getSpiralColorDisplay('year', measurement, { startYear: 2000, endYear: 2020 });
    assert.deepEqual(display.legendLabels, ['2000', '2020']);
    assert.deepEqual(display.legendRange, [2000, 2020]);
    assert.deepEqual(display.legendStops, YEAR_COLOR_STOPS);
    assert.equal(getYearColorFraction(2000, 2000, 2020), 0);
    assert.equal(getYearColorFraction(2010 + 11 / 12, 2000, 2020), 0.5);
    assert.equal(getYearColorFraction(2020, 2000, 2020), 1);
    assert.equal(getYearColorFraction(1900, 2000, 2020), 0);
    assert.equal(getYearColorFraction(2030, 2000, 2020), 1);
    assert.equal(getYearColorFraction(2000, 2000, 2000), 0.5);
    const single = getSpiralColorDisplay('year', measurement, { startYear: 2000, endYear: 2000 });
    assert.deepEqual(single.legendLabels, ['2000']);
    const midpointColor = YEAR_COLOR_STOPS.find(([position]) => position === 0.5)[1];
    assert.deepEqual(single.legendStops, [[0, midpointColor], [1, midpointColor]]);
    assert.equal(single.showMarker, false);
});

test('year colors span violet, blue, cyan, green, yellow, orange and red without repeating endpoints', () => {
    const expected = ['7b4fd3', '3865e8', '21bdd3', '38bf75', 'f0da45', 'f28b35', 'e34247'];
    const colors = YEAR_COLOR_STOPS.map(([, value]) => new THREE.Color(value)), result = new THREE.Color();
    for (let year = 2000; year <= 2006; year++) {
        const fraction = getYearColorFraction(year, 2000, 2006);
        assert.equal(sampleColorStops(YEAR_COLOR_STOPS, colors, fraction, result).getHexString(), expected[year - 2000]);
    }
    assert.notEqual(expected[0], expected.at(-1));
    assert.equal(sampleColorStops(YEAR_COLOR_STOPS, colors, getYearColorFraction(2000, 2000, 2000), result).getHexString(), expected[3]);
});

test('multi-stop sampling interpolates each interval, clamps endpoints and leaves palette colors untouched', () => {
    for (const stops of [YEAR_COLOR_STOPS, ANOMALY_COLOR_STOPS]) {
        const colors = stops.map(([, value]) => new THREE.Color(value)), before = colors.map(color => color.clone());
        const result = new THREE.Color();
        for (let index = 1; index < stops.length; index++) {
            const fraction = (stops[index - 1][0] + stops[index][0]) / 2;
            const expected = new THREE.Color().lerpColors(colors[index - 1], colors[index], 0.5);
            assert.equal(sampleColorStops(stops, colors, fraction, result), result);
            assert.ok(Math.abs(result.r - expected.r) < 1e-12);
            assert.ok(Math.abs(result.g - expected.g) < 1e-12);
            assert.ok(Math.abs(result.b - expected.b) < 1e-12);
        }
        assert.ok(sampleColorStops(stops, colors, -1, result).equals(colors[0]));
        assert.ok(sampleColorStops(stops, colors, 2, result).equals(colors.at(-1)));
        assert.deepEqual(colors, before);
    }
});

test('single-color legends have a solid swatch, without a measurement scale or marker', () => {
    const measurement = getDatasetDisplay('temperature');
    for (const color of [DEFAULT_SINGLE_COLOR, '#ff8800']) {
        const display = getSpiralColorDisplay('single', measurement, { color });
        assert.deepEqual(display.legendStops, [[0, color], [1, color]]);
        assert.deepEqual(display.legendLabels, []);
        assert.equal(display.showMarker, false);
    }
    assert.throws(() => getSpiralColorDisplay('unknown', measurement, {}));
});

test('recoloring preserves geometry, gaps and sampled values, including shared January colors and both cap centers', () => {
    const dates = [2000 + 10 / 12, 2000 + 11 / 12, 2001, 2001 + 2 / 12];
    const metadata = dates.map((decimalYear, i) => ({ decimalYear, anomaly: i / 10, displayValue: i + 100 }));
    const radiusAtValue = value => 10 + value * 5;
    const pointAt = (date, value) => new THREE.Vector3(Math.sin(date * Math.PI * 2) * radiusAtValue(value), date - 2000,
        -Math.cos(date * Math.PI * 2) * radiusAtValue(value));
    for (const tubeRadius of [0, 0.12]) {
        const { geometry, lineGeometry, data, timelineStops } = createSpiralGeometry(THREE).createSpiralBuffers(
            metadata.map(point => pointAt(point.decimalYear, point.anomaly)),
            dates.map((_, i) => new THREE.Color().setRGB(i / dates.length, 0.5, 1)), metadata,
            { smooth: true, preserveMonthlyGaps: true, pointAt, layout: graphLayout(5, 15), originYear: 2000,
                heightPerYear: 1, radiusAtValue, tubeRadius, radialSegments: 8 });
        const originalColors = geometry.attributes.color.array.slice();
        const originalPositions = geometry.attributes.position.array.slice();
        const originalNormals = geometry.attributes.normal.array.slice();
        const originalIndices = geometry.index.array.slice();
        const originalMetadata = data.map(point => [point.decimalYear, point.anomaly, point.displayValue, point.spiralMissing, point.graphMissing]);
        geometry.userData.originalColorArray = originalColors.slice();
        geometry.userData.lastTailRange = { start: 1, end: 5 };
        geometry.setDrawRange(0, timelineStops[1]);
        const range = { ...geometry.drawRange };
        const uniform = new THREE.Color('#ff8800');
        recolorSpiral(geometry, data, 8, () => uniform);
        for (let i = 0; i < geometry.attributes.color.count; i++) {
            assert.ok(new THREE.Color().fromArray(geometry.attributes.color.array, i * 3).equals(
                new THREE.Color(Math.fround(uniform.r), Math.fround(uniform.g), Math.fround(uniform.b))));
        }
        assert.deepEqual(geometry.userData.lastTailRange, { start: 0, end: -1 });
        recolorSpiral(geometry, data, 8, point => point.valueColor);
        assert.deepEqual(geometry.attributes.color.array, originalColors);
        assert.deepEqual(geometry.userData.originalColorArray, originalColors);
        assert.deepEqual(geometry.attributes.position.array, originalPositions);
        assert.deepEqual(geometry.attributes.normal.array, originalNormals);
        assert.deepEqual(geometry.index.array, originalIndices);
        assert.deepEqual(geometry.drawRange, range);
        assert.deepEqual(data.map(point => [point.decimalYear, point.anomaly, point.displayValue, point.spiralMissing, point.graphMissing]), originalMetadata);
        lineGeometry?.dispose(); geometry.dispose();
    }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { localTemperatureRange, parseLocalTemperatureData, readLocalSnapshot } from '../local-temperature-data.mjs';
import { readStationSnapshot } from '../station-temperature-data.mjs';
import { readCountrySnapshot } from '../country-temperature-data.mjs';
import { getDatasetPresentation, parseDatasetData } from '../datasets.mjs';
import { formatDatasetValue, formatReferenceValue, getDatasetDisplay, getLegendPercent } from '../dataset-display.mjs';
import { createSeasonalColorModel } from '../spiral-colors.mjs';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
function reanalysis() {
    return { version: 1, source: 'Open-Meteo', model: 'era5_land', units: 'celsius',
        location: { name: 'Example', latitude: 52, longitude: 13, timezone: 'UTC' },
        grid: { latitude: 52, longitude: 13, elevation: 30, timezone: 'UTC' },
        through: '2025-12', fetchedAt: '2026-01-15T12:00:00Z',
        records: Array.from({ length: 75 * 12 }, (_, index) => ({
            month: `${1951 + Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}`,
            mean: 5 - 12 * Math.cos(index % 12 / 12 * Math.PI * 2) + (1951 + Math.floor(index / 12) - 1965) * 0.02,
        })).filter(row => row.month !== '1987-02') };
}

test('temperature display retains winter/summer variation, while the default anomaly removes it', () => {
    const snapshot = reanalysis(), before = structuredClone(snapshot);
    const anomalies = parseLocalTemperatureData(snapshot);
    const temperatures = parseLocalTemperatureData(snapshot, 'temperature');
    const year = temperatures.find(row => row.year === 2020);
    const anomalyYear = anomalies.find(row => row.year === 2020);
    assert.ok(year.anomalies[0] < 0 && year.anomalies[6] > 0);
    assert.ok(Math.abs(year.anomalies[6] - year.anomalies[0] - 24) < 1e-10);
    assert.ok(Math.abs(anomalyYear.anomalies[6] - anomalyYear.anomalies[0]) < 1e-10);
    assert.deepEqual(temperatures.map(row => [row.year, row.fractions]), anomalies.map(row => [row.year, row.fractions]));
    assert.deepEqual(temperatures.find(row => row.year === 1987).fractions.slice(0, 2), [0, 2 / 12]);
    assert.deepEqual(snapshot, before);
    assert.deepEqual(parseLocalTemperatureData(snapshot), anomalies);
    assert.deepEqual(parseLocalTemperatureData(snapshot, 'invalid'), []);
    snapshot.records = snapshot.records.filter(row => row.month !== '1960-01');
    assert.deepEqual(parseLocalTemperatureData(snapshot, 'temperature'), [], 'Existing baseline validation is retained');
});

test('all three local sources expose exact source temperatures without changing the cached format or gaps', async () => {
    const catalog = JSON.parse(await read('data/weather-stations/catalog.json'));
    const id = catalog.stations[0].id;
    const station = JSON.parse(await read(`data/weather-stations/${id.slice(0, 2)}/${id}.json`));
    const country = JSON.parse(await read('data/country-temperature/DE.json'));
    for (const [snapshot, reader] of [[reanalysis(), readLocalSnapshot], [station, readStationSnapshot], [country, readCountrySnapshot]]) {
        const text = JSON.stringify(snapshot), records = reader(snapshot).records;
        const data = parseDatasetData(text, 'local', 'temperature');
        const actual = data.flatMap(entry => entry.anomalies.map((value, index) => ({
            month: `${entry.year}-${String(Math.round(entry.fractions[index] * 12) + 1).padStart(2, '0')}`, mean: value,
        })));
        assert.deepEqual(actual, records);
        assert.deepEqual(data.map(row => [row.year, row.fractions]), parseDatasetData(text, 'local').map(row => [row.year, row.fractions]));
        assert.equal(JSON.stringify(snapshot), text);
    }
});

test('absolute temperature ranges include zero, fit extreme/constant records and use finite evenly spaced ticks', () => {
    for (const values of [[], [0, 0], [-0.01, 0.02], [24, 31], [-65, -12], [-100, 70]]) {
        const range = localTemperatureRange([{ anomalies: values }], 'temperature');
        assert.ok(range.min <= 0 && range.max >= 0 && range.max > range.min);
        assert.ok(range.ticks.length >= 2 && range.ticks.length <= 6);
        assert.ok(range.ticks.every(Number.isFinite));
        assert.ok(range.min <= Math.min(0, ...values) && range.max >= Math.max(0, ...values));
        assert.equal(range.ticks[0], range.min);
        assert.equal(range.ticks.at(-1), range.max);
        const step = range.ticks[1] - range.ticks[0];
        assert.ok(range.ticks.slice(1).every((value, index) => Math.abs(value - range.ticks[index] - step) < 1e-10));
    }
    assert.deepEqual(localTemperatureRange([]), { extent: 4, ticks: [-4, -2, 0, 2, 4] });
});

test('absolute temperature formatting, references and color zero agree with the linear Celsius scale', () => {
    for (const values of [[-8, 29], [24, 31], [-65, -12], [0]]) {
        const range = localTemperatureRange([{ anomalies: values }], 'temperature');
        const display = getDatasetDisplay('local', range, 'temperature');
        assert.equal(formatDatasetValue(21, display), '21.00 \u00b0C');
        assert.equal(formatDatasetValue(-3, display), '-3.00 \u00b0C');
        assert.equal(formatReferenceValue(20, display), '20\u00b0C');
        assert.deepEqual(display.referenceValues.map(value => formatReferenceValue(value, display)), display.legendLabels);
        assert.equal(getLegendPercent(range.min, display), 0);
        assert.equal(getLegendPercent(range.max, display), 100);
        const zero = getLegendPercent(0, display) / 100;
        assert.ok(display.legendStops.some(([position, color]) => Math.abs(position - zero) < 1e-10 && color === '#ffffff'));
        assert.equal(display.caption, 'Monthly mean temperature');
    }
});

test('local provenance distinguishes temperatures from anomalies for every source without changing global series', () => {
    for (const mode of ['era5', 'station', 'country']) {
        const anomaly = getDatasetPresentation('local', { mode });
        const temperature = getDatasetPresentation('local', { mode, temperatureDisplay: 'temperature' });
        assert.match(anomaly.metricLabel, /Anomaly/);
        assert.match(temperature.metricLabel, /Temperature/);
        assert.doesNotMatch(temperature.description, /1951-1980/);
        assert.equal(anomaly.sourceHref, temperature.sourceHref);
    }
    assert.equal(getDatasetPresentation('temperature', { temperatureDisplay: 'temperature' }), getDatasetPresentation('temperature'));
});

test('monthly and yearly anomaly colors are invariant when switching the represented temperature values', () => {
    const snapshot = JSON.stringify(reanalysis());
    const anomaly = createSeasonalColorModel(parseDatasetData(snapshot, 'local'));
    const absolute = createSeasonalColorModel(parseDatasetData(snapshot, 'local', 'temperature'));
    assert.deepEqual(absolute.range, anomaly.range);
    assert.deepEqual(absolute.counts, anomaly.counts);
    for (let year = 1951; year <= 2025; year++) {
        for (let month = 0; month < 12; month++) {
            const a = anomaly.anomalyAt(year + month / 12), b = absolute.anomalyAt(year + month / 12);
            if (a === null) assert.equal(b, null); else assert.ok(Math.abs(a - b) < 1e-10);
        }
        const a = anomaly.yearlyAnomalyAt(year), b = absolute.yearlyAnomalyAt(year);
        if (a === null) assert.equal(b, null); else assert.ok(Math.abs(a - b) < 1e-10);
    }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DATASET_CONFIG, getDatasetByKey, getDatasetPresentation, hasUsableData, parseDatasetData } from '../datasets.mjs';
import { parseGISSData } from '../gistemp-data.mjs';
import { parseCO2MonthlyData } from '../co2-data.mjs';
import { parseTemperatureData, getTemperatureDataUrl } from '../temperature-data.mjs';
import { parseSeaIceData } from '../sea-ice-data.mjs';
import { parseSeaIceVolumeData } from '../sea-ice-volume-data.mjs';
import { parseMethaneData } from '../methane-data.mjs';
import { parseSeaLevelData } from '../sea-level-data.mjs';
import { parseStationTemperatureData, STATION_SOURCE } from '../station-temperature-data.mjs';
import { parseCountryTemperatureData, COUNTRY_SOURCE } from '../country-temperature-data.mjs';
import { parseLocalTemperatureData } from '../local-temperature-data.mjs';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('dataset order and capabilities stay consistent with the selector', () => {
    assert.deepEqual(Object.keys(DATASET_CONFIG), ['local', 'temperature', 'ocean', 'land', 'arctic',
        'antarctic', 'arcticvolume', 'sealevel', 'co2', 'methane']);
    for (const [key, dataset] of Object.entries(DATASET_CONFIG)) {
        assert.equal(dataset.id, key);
        assert.equal(dataset.supportsInterpolation, key === 'temperature');
        assert.equal(Boolean(dataset.preserveMonthlyGaps),
            ['local', 'arctic', 'antarctic', 'arcticvolume', 'sealevel', 'methane'].includes(key));
        assert.equal(typeof dataset.parse, 'function');
        if (key !== 'local') assert.ok(dataset.localPath.startsWith('data/'));
    }
    assert.equal(getDatasetByKey('toString'), undefined);
    assert.deepEqual(parseDatasetData('anything', 'unknown'), []);
});

test('NOAA remote URLs are computed when requested, not at module import', () => {
    for (const key of ['ocean', 'land']) {
        assert.equal(typeof DATASET_CONFIG[key].remoteUrl, 'function');
        assert.equal(DATASET_CONFIG[key].remoteUrl(), getTemperatureDataUrl(key));
    }
});

const parsers = {
    temperature: parseGISSData,
    ocean: text => parseTemperatureData(text, 'ocean'),
    land: text => parseTemperatureData(text, 'land'),
    arctic: text => parseSeaIceData(text, 'north'),
    antarctic: text => parseSeaIceData(text, 'south'),
    arcticvolume: parseSeaIceVolumeData,
    sealevel: parseSeaLevelData,
    co2: parseCO2MonthlyData,
    methane: parseMethaneData
};
for (const [key, parse] of Object.entries(parsers)) {
    test(key + ': registry routes the bundled snapshot without changing scientific values', async () => {
        const text = await read(DATASET_CONFIG[key].localPath);
        const data = parseDatasetData(text, key);
        assert.ok(hasUsableData(data));
        assert.deepEqual(data, parse(text));
    });
}

test('local snapshots select the correct parser for reanalysis, stations and countries', async () => {
    for (const [directory, parse, pick] of [
        ['weather-stations', parseStationTemperatureData, catalog => {
            const id = catalog.stations[0].id;
            return id.slice(0, 2) + '/' + id;
        }],
        ['country-temperature', parseCountryTemperatureData, () => 'DE']
    ]) {
        const catalog = JSON.parse(await read('data/' + directory + '/catalog.json'));
        const text = await read('data/' + directory + '/' + pick(catalog) + '.json');
        const data = parseDatasetData(text, 'local');
        assert.ok(hasUsableData(data));
        assert.deepEqual(data, parse(JSON.parse(text)));
    }
    const snapshot = { version: 1, source: 'Open-Meteo', model: 'era5_land', units: 'celsius',
        location: { name: 'Berlin', latitude: 52.52, longitude: 13.41, timezone: 'Europe/Berlin' },
        grid: { latitude: 52.5, longitude: 13.4, elevation: 38, timezone: 'Europe/Berlin' },
        through: '1980-12', fetchedAt: '2025-01-01T00:00:00Z',
        records: Array.from({ length: 360 }, (_, i) => ({
            month: `${1951 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`, mean: i % 12
        })) };
    const data = parseDatasetData(JSON.stringify(snapshot), 'local');
    assert.ok(hasUsableData(data));
    assert.deepEqual(data, parseLocalTemperatureData(snapshot));
    assert.deepEqual(parseDatasetData('not JSON', 'local'), []);
});

test('local source presentation follows the displayed snapshot before the selected mode', () => {
    assert.equal(getDatasetPresentation('temperature'), DATASET_CONFIG.temperature);
    assert.equal(getDatasetPresentation('local').sourceLabel, 'Open-Meteo / ERA5-Land');
    assert.equal(getDatasetPresentation('local', { mode: 'station' }).sourceHref, STATION_SOURCE);
    assert.equal(getDatasetPresentation('local', { mode: 'country' }).sourceHref, COUNTRY_SOURCE);
    assert.equal(getDatasetPresentation('local', { mode: 'country', snapshot: { station: {} } }).sourceHref, STATION_SOURCE);
    assert.equal(getDatasetPresentation('local', { mode: 'station', snapshot: { country: {} } }).sourceHref, COUNTRY_SOURCE);
    assert.equal(getDatasetPresentation('local', { mode: 'station', snapshot: {} }), DATASET_CONFIG.local);
    assert.equal(getDatasetPresentation('unknown'), undefined);
});

test('usable-data checks require at least one finite monthly value and year', () => {
    for (const data of [null, {}, [], [null], [{ year: 2025, anomalies: [NaN, null] }],
        [{ year: '2025', anomalies: [1] }], [{ year: Infinity, anomalies: [1] }]]) {
        assert.equal(hasUsableData(data), false);
    }
    assert.equal(hasUsableData([{ year: 2025, anomalies: [NaN, 1] }]), true);
});

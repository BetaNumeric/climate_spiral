import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStationSnapshot, fetchStationData, nearbyStations, parseStationInventory, parseStationTemperatureData,
    parseStationYear, readStationCatalog, readStationSnapshot, stationCoverage, stationDistance, stationReleaseCutoff } from '../station-temperature-data.mjs';
import { prepareStationData, publishStationData, validateStationUpdate } from '../scripts/update-station-data.mjs';

const id = 'GM000003319';
const station = { id, name: 'BERLIN_DAHLEM', latitude: 52.46, longitude: 13.3, elevation: 51 };
const location = { name: 'Berlin', latitude: 52.52, longitude: 13.41, timezone: 'Europe/Berlin' };
const release = 'ghcnm.tavg.v4.0.1.20251003.qcf';
const now = new Date('2025-10-03T12:00:00Z');
const hash = text => createHash('sha256').update(text).digest('hex');
function yearLine(year, overrides = {}, stationId = id) {
    return stationId + year + 'TAVG' + Array.from({ length: 12 }, (_, month) =>
        overrides[month] ?? String(month * 100 + (year - 1950) * 10).padStart(5) + '  S').join('');
}
const years = () => Array.from({ length: 76 }, (_, index) => yearLine(index + 1950));
const snapshot = () => createStationSnapshot(station, years(), release);
const inventoryLine = (value = station) => value.id + ' ' + value.latitude.toFixed(4).padStart(8) + ' '
    + value.longitude.toFixed(4).padStart(9) + ' ' + value.elevation.toFixed(1).padStart(6) + ' ' + value.name.padEnd(30);
const entry = () => ({ ...station, ...stationCoverage(readStationSnapshot(snapshot()).records), hash: hash(JSON.stringify(snapshot())) });
const catalog = stations => ({ version: 1, source: 'NOAA GHCN-Monthly v4', adjustment: 'QCF', baseline: '1951-1980', release, stations });

test('NOAA inventory preserves location, elevation, and valid hyphenated identifiers', () => {
    const rows = parseStationInventory(inventoryLine() + '\r\n' + inventoryLine({ ...station, id: 'BR00B6-0360', elevation: 9999 }));
    assert.deepEqual(rows.get(id), station);
    assert.equal(rows.get('BR00B6-0360').elevation, null);
    assert.throws(() => parseStationInventory(inventoryLine({ ...station, latitude: 100 })));
    assert.throws(() => parseStationInventory(inventoryLine() + '\n' + inventoryLine()), /Duplicate/);
});

test('QCF parsing converts hundredths, retains valid alternative adjustments, and omits flagged or missing months', () => {
    const line = yearLine(2020, { 0: ' -125  S', 1: '-9999 QS', 2: '  222 AS', 3: '  123 XS', 4: '  123 QS' });
    const parsed = parseStationYear(line, now);
    assert.deepEqual(parsed.records.slice(0, 2), [{ month: '2020-01', mean: -1.25 }, { month: '2020-03', mean: 2.22 }]);
    assert.equal(parsed.records.length, 9);
    assert.throws(() => parseStationYear(line.replace('TAVG', 'TMAX'), now));
    assert.throws(() => parseStationYear(line.slice(1), now));
    assert.throws(() => parseStationYear(yearLine(2020, { 0: '  123E S' }), now), /flag/);
});

test('station anomalies use all 360 baseline months and retain gaps and original source rows', () => {
    const original = snapshot();
    original.years[40] = yearLine(1990, { 1: '-9999 XS' });
    const read = readStationSnapshot(original, now);
    assert.equal(read.records.at(-1).month, '2025-09');
    assert.equal(read.years[40], original.years[40]);
    const parsed = parseStationTemperatureData(original);
    assert.ok(parsed[0].anomalies.every(value => Math.abs(value + 1.55) < 1e-10));
    assert.equal(parsed.find(year => year.year === 1990).fractions[1], 2 / 12);
    original.years[1] = yearLine(1951, { 0: '-9999  S' });
    assert.throws(() => readStationSnapshot(original), /reference period/);
    assert.deepEqual(parseStationTemperatureData(original), []);
    assert.throws(() => readStationSnapshot({ ...snapshot(), adjustment: 'QFE' }));
    assert.throws(() => readStationSnapshot({ ...snapshot(), station: { ...station, id: 'USW00014734' } }), /mismatched/);
    assert.throws(() => readStationSnapshot({ ...snapshot(), years: [yearLine(1950), ...years()] }), /duplicated/);
});

test('an archived partial month does not become an observation merely because the clock advances', () => {
    const source = snapshot();
    assert.equal(readStationSnapshot(source, new Date('2025-12-01')).records.at(-1).month, '2025-09');
    assert.equal(stationReleaseCutoff(release, now).toISOString(), '2025-10-03T00:00:00.000Z');
    assert.throws(() => stationReleaseCutoff('ghcnm.tavg.v4.0.1.20250230.qcf', now));
});

test('station selection balances recency, completeness, and distance within an explicit radius', () => {
    const base = entry();
    const complete = { ...base, id: 'GM000003342', longitude: 13.1 };
    const patchy = { ...base, id: 'GME00111445', latitude: 52.52, longitude: 13.41, coverage: 50 };
    const historic = { ...base, id: 'GM000003343', latitude: 52.52, longitude: 13.41, last: '1980-12' };
    const remote = { ...base, id: 'USW00014734', latitude: 40.7, longitude: -74 };
    const result = nearbyStations(catalog([patchy, historic, remote, complete]), location, 100, now);
    assert.equal(result[0].id, complete.id);
    assert.equal(result.at(-1).id, historic.id);
    assert.equal(result.some(value => value.id === remote.id), false);
    assert.equal(nearbyStations(catalog([remote]), location, 500, now).length, 0);
    assert.ok(stationDistance({ latitude: 0, longitude: 179.9 }, { latitude: 0, longitude: -179.9 }) < 23);
    assert.throws(() => nearbyStations(catalog([base]), location, 1000));
});

test('catalog and station retrieval reject mismatched files, hashes, and invalid metadata', async () => {
    const text = JSON.stringify(snapshot());
    const value = entry();
    assert.equal(readStationCatalog(catalog([value])).stations.length, 1);
    assert.throws(() => readStationCatalog(catalog([{ ...value, coverage: 10 }])));
    assert.throws(() => readStationCatalog(catalog([{ ...value, id: '../escape' }])));
    const loaded = await fetchStationData(value, { fetchImpl: async url => {
        assert.equal(url, './data/weather-stations/GM/GM000003319.json');
        return { ok: true, text: async () => text };
    } });
    assert.equal(loaded.station.id, id);
    await assert.rejects(fetchStationData(value, { fetchImpl: async () => ({ ok: true, text: async () => text + ' ' }) }), /being updated/);
    await assert.rejects(fetchStationData(value, { fetchImpl: async () => ({ ok: false }) }), /unavailable/);
});

test('updater filters incomplete baselines and preserves published files on older or incomplete releases', async () => {
    const prepared = await prepareStationData(inventoryLine(), years(), release, now);
    assert.equal(prepared.catalog.stations.length, 1);
    const directory = await mkdtemp(join(tmpdir(), 'climate-station-test-'));
    try {
        await publishStationData(prepared, directory, 1);
        const before = await readFile(join(directory, 'catalog.json'), 'utf8');
        await assert.rejects(publishStationData({ ...prepared, inventoryCount: 0 }, directory, 1), /incomplete/);
        const older = { ...prepared, catalog: { ...prepared.catalog, release: 'ghcnm.tavg.v4.0.1.20250903.qcf' } };
        await assert.rejects(publishStationData(older, directory, 1), /older/);
        assert.equal(await readFile(join(directory, 'catalog.json'), 'utf8'), before);
        assert.throws(() => validateStationUpdate({ ...prepared, catalog: { ...prepared.catalog, stations: [] } }, prepared.catalog, 1));
        await assert.rejects(prepareStationData(inventoryLine(), [yearLine(1950), ...years()], release, now), /Duplicate/);
        const missing = years(); missing[1] = yearLine(1951, { 0: '-9999  S' });
        const second = { ...station, id: 'GM000003342' };
        const combined = await prepareStationData(inventoryLine() + '\n' + inventoryLine(second),
            [...missing, ...years().map(line => second.id + line.slice(11))], release, now);
        assert.deepEqual(combined.catalog.stations.map(value => value.id), [second.id]);
    } finally { await rm(directory, { recursive: true, force: true }); }
});

test('bundled catalog hashes, baselines, and coverage match every published station record', async () => {
    const catalog = readStationCatalog(await readFile(new URL('../data/weather-stations/catalog.json', import.meta.url), 'utf8'));
    assert.ok(catalog.stations.length >= 1000);
    for (const entry of catalog.stations) {
        const text = await readFile(new URL(`../data/weather-stations/${entry.id.slice(0, 2)}/${entry.id}.json`, import.meta.url), 'utf8');
        assert.equal(hash(text), entry.hash, entry.id + ': hash');
        const data = readStationSnapshot(text);
        assert.equal(data.station.id, entry.id);
        assert.equal(data.release, catalog.release);
        const expected = stationCoverage(data.records);
        for (const key of ['first', 'last', 'months', 'coverage']) assert.equal(entry[key], expected[key], entry.id + ': ' + key);
    }
});

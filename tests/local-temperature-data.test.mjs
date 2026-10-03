import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateLocalDays, createLocalTemperatureCache, fetchLocalTemperature, latestLocalMonth,
    localLocationKey, localTemperatureRange, normalizeLocation, parseLocalTemperatureData,
    readLocalSnapshot, searchLocalPlaces } from '../local-temperature-data.mjs';

const location = { name: 'Berlin, Germany', latitude: 52.52, longitude: 13.41, timezone: 'Europe/Berlin' };
const now = new Date('2025-03-10T12:00:00Z');
const grid = { latitude: 52.5, longitude: 13.4, elevation: 38, timezone: location.timezone };
const mean = (year, month) => month * 2 + (year - 1950) * 0.02;

function snapshot(through = '2025-02') {
    const end = Number(through.slice(0, 4)) * 12 + Number(through.slice(5));
    return { version: 1, source: 'Open-Meteo', model: 'era5_land', units: 'celsius', location, grid,
        through, fetchedAt: now.toISOString(), records: Array.from({ length: end - 1950 * 12 }, (_, i) => ({
            month: `${1950 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`,
            mean: mean(1950 + Math.floor(i / 12), i % 12),
        })) };
}

function daily(start, end) {
    const time = [], values = [];
    for (let day = Date.parse(start); day <= Date.parse(end); day += 86400000) {
        const date = new Date(day);
        time.push(date.toISOString().slice(0, 10));
        values.push(mean(date.getUTCFullYear(), date.getUTCMonth()));
    }
    return { ...grid, daily_units: { time: 'iso8601', temperature_2m_mean: '\u00b0C' },
        daily: { time, temperature_2m_mean: values } };
}

const response = data => ({ ok: true, status: 200, json: async () => data });

test('local coverage excludes unpublished and incomplete months around year and month boundaries', () => {
    assert.equal(latestLocalMonth(new Date('2026-10-03T12:00:00Z')), '2026-08');
    assert.equal(latestLocalMonth(new Date('2026-10-07T00:00:00Z')), '2026-09');
    assert.equal(latestLocalMonth(new Date('2026-01-02T00:00:00Z')), '2025-11');
    assert.equal(latestLocalMonth(new Date('2026-01-07T00:00:00Z')), '2025-12');
});

test('place search encodes names, preserves distinct locations, and supports coordinates', async () => {
    assert.throws(() => normalizeLocation({ ...location, latitude: 91 }));
    assert.notEqual(localLocationKey(location), localLocationKey({ ...location, latitude: 50 }));
    const [coordinates] = await searchLocalPlaces('52.52, 13.41', { fetchImpl: () => assert.fail('No geocoding needed') });
    assert.equal(coordinates.timezone, 'auto');
    const places = await searchLocalPlaces('Berlin & Mitte', { fetchImpl: async url => {
        assert.equal(url.searchParams.get('name'), 'Berlin & Mitte');
        return response({ results: [{ ...location, name: 'Berlin', admin1: 'Berlin', country: 'Germany' }] });
    } });
    assert.equal(places[0].name, 'Berlin, Germany');
});

test('daily aggregation handles leap years and skips missing months without estimating them', () => {
    const source = daily('2024-02-01', '2024-03-31');
    assert.equal(source.daily.time.length, 60);
    const result = aggregateLocalDays(source, '2024-02-01', '2024-03-31', location.timezone);
    assert.deepEqual(result.map(row => row.month), ['2024-02', '2024-03']);
    assert(Math.abs(result[0].mean - mean(2024, 1)) < 1e-10);
    source.daily.temperature_2m_mean[0] = null;
    assert.deepEqual(aggregateLocalDays(source, '2024-02-01', '2024-03-31', location.timezone).map(row => row.month), ['2024-03']);
    source.daily.time[0] = '2024-02-02';
    assert.throws(() => aggregateLocalDays(source, '2024-02-01', '2024-03-31', location.timezone));
    const baseline = daily('1951-01-01', '1951-01-31');
    baseline.daily.temperature_2m_mean[4] = null;
    assert.throws(() => aggregateLocalDays(baseline, '1951-01-01', '1951-01-31', location.timezone), /reference period/);
});

test('local anomalies subtract each calendar month baseline, preserve gaps, and reject incomplete references', () => {
    const data = snapshot();
    data.records = data.records.filter(row => row.month !== '1987-12');
    const parsed = parseLocalTemperatureData(data);
    assert.equal(parsed[0].year, 1950);
    for (const value of parsed[0].anomalies) assert(Math.abs(value + 0.31) < 1e-10);
    assert.equal(parsed.find(row => row.year === 1987).fractions.at(-1), 10 / 12);
    assert.equal(parsed.at(-1).fractions.length, 2);
    data.records = data.records.filter(row => row.month !== '1970-01');
    assert.deepEqual(parseLocalTemperatureData(data), []);
    for (const mutate of [s => { s.model = 'best_match'; }, s => { s.units = 'fahrenheit'; },
        s => { s.records[1].month = s.records[0].month; }, s => { s.records[0].mean = null; },
        s => { s.grid = null; }, s => { s.location.longitude = 999; }]) {
        const invalid = structuredClone(snapshot()); mutate(invalid);
        assert.throws(() => readLocalSnapshot(invalid));
    }
});

test('local scale is symmetric, keeps zero centered, and contains extreme monthly anomalies', () => {
    const range = localTemperatureRange([{ anomalies: [-12.1, 6.2] }]);
    assert(range.extent > 12.1);
    assert.equal(range.ticks[2], 0);
    assert.equal(range.ticks[0], -range.ticks.at(-1));
    assert(range.ticks.every(Number.isInteger));
});

test('history pins ERA5-Land, saves resumable batches, and fetches only new or revised months', async () => {
    const requests = [], checkpoints = [];
    const fetchImpl = async url => {
        assert.equal(url.searchParams.get('models'), 'era5_land');
        assert.equal(url.searchParams.get('daily'), 'temperature_2m_mean');
        requests.push([url.searchParams.get('start_date'), url.searchParams.get('end_date')]);
        return response(daily(...requests.at(-1)));
    };
    const complete = await fetchLocalTemperature(location, { now, fetchImpl, onCheckpoint: data => checkpoints.push(data) });
    assert.equal(requests[0][0], '1950-01-01');
    assert.equal(requests.at(-1)[1], '2025-02-28');
    assert.equal(complete.records.length, 902);
    assert.equal(checkpoints.length, requests.length);
    await fetchLocalTemperature(location, { now, cached: complete, fetchImpl: () => assert.fail('Fresh cache must not fetch') });
    requests.length = 0;
    const updated = await fetchLocalTemperature(location, { now: new Date('2025-04-10'), cached: complete, fetchImpl });
    assert.deepEqual(requests, [['2025-01-01', '2025-03-31']]);
    assert.equal(updated.records.length, 903);
    requests.length = 0;
    await fetchLocalTemperature(location, { now, cached: checkpoints[0], fetchImpl });
    assert.equal(requests[0][0], '1954-11-01');
});

test('cancelled, rate-limited, or changed-grid downloads preserve prior history', async () => {
    const original = snapshot();
    const saved = structuredClone(original);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(fetchLocalTemperature(location, { now, cached: original, force: true, signal: controller.signal }), { name: 'AbortError' });
    await assert.rejects(fetchLocalTemperature(location, { now, cached: original, force: true,
        fetchImpl: async () => ({ ok: false, status: 429 }) }), /API limit/);
    await assert.rejects(fetchLocalTemperature(location, { now, cached: original, force: true, fetchImpl: async url =>
        response({ ...daily(url.searchParams.get('start_date'), url.searchParams.get('end_date')), elevation: 500 }) }), /grid changed/);
    assert.deepEqual(original, saved);
});

test('cache falls back to session memory when browser storage is unavailable', async () => {
    const cache = createLocalTemperatureCache(null);
    assert.equal(await cache.get('missing'), null);
    await cache.set('place', snapshot());
    assert.equal((await cache.get('place')).location.name, location.name);
    assert.equal(cache.persistent, false);
});

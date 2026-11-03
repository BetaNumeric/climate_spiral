import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { OCEAN_PH_PRODUCT, OCEAN_PH_SOURCE_URL, OCEAN_PH_METHOD, OCEAN_PH_AXIS_MIN,
    OCEAN_PH_TICKS, oceanPhToSpiralValue, spiralValueToOceanPh, parseOceanPhData } from '../ocean-ph-data.mjs';
import { formatDatasetValue, formatReferenceValue, getDatasetDisplay, getLegendPercent } from '../dataset-display.mjs';

function bundle() {
    return { version: 1, source: 'Copernicus Marine / LSCE', product: OCEAN_PH_PRODUCT,
        sourceUrl: OCEAN_PH_SOURCE_URL, method: OCEAN_PH_METHOD, units: 'pH', scale: 'total',
        sources: Object.fromEntries(['my', 'nrt'].map(product => [product, {
            dataset: `cmems_obs-mob_glo_bgc-car_${product}_irr-i`, version: '202603', gridSha256: 'a'.repeat(64),
        }])), through: '1986-02', records: [
            { month: '1985-01', ph: 8.123456, validAreaKm2: 350e6, product: 'my', etag: 'first' },
            { month: '1985-02', ph: 8.12, validAreaKm2: 350e6, product: 'my', etag: 'second' },
            { month: '1986-02', ph: 8.09, validAreaKm2: 349e6, product: 'nrt', etag: 'third' },
        ] };
}
const parse = value => parseOceanPhData(JSON.stringify(value));

test('pH preserves source values, calendar positions, gaps, and invertible display offset', () => {
    const data = parse(bundle());
    assert.deepEqual(data.map(entry => entry.year), [1985, 1986]);
    assert.deepEqual(data[0].displayValues, [8.123456, 8.12]);
    assert.deepEqual(data[1].fractions, [1 / 12]);
    assert.deepEqual(data[0].anomalies, data[0].displayValues.map(oceanPhToSpiralValue));
    assert.equal(oceanPhToSpiralValue(OCEAN_PH_AXIS_MIN), 0);
    for (const value of [7.99, 8, 8.123456, 8.15]) {
        assert.ok(Math.abs(spiralValueToOceanPh(oceanPhToSpiralValue(value)) - value) < 1e-12);
    }
});

test('pH rejects wrong provenance, scale, malformed values, dates, coverage, and future months', () => {
    for (const mutate of [
        b => { b.version = 2; }, b => { b.source = 'Other'; }, b => { b.product = 'Other'; },
        b => { b.sourceUrl = 'https://example.com/'; }, b => { b.method = 'unweighted'; },
        b => { b.units = 'C'; }, b => { b.scale = 'free'; }, b => { b.records = []; },
        b => { b.records[0] = null; }, b => { b.records[0].month = '1985-02'; },
        b => { b.through = '1985-01'; }, b => { b.sources = {}; },
        b => { b.sources.my.version = 'unknown'; }, b => { b.sources.my.dataset = 'regional'; },
        b => { b.sources.my.gridSha256 = 'b'.repeat(64); },
        b => { b.records[1].month = '1985-01'; }, b => { b.records[1].month = '1985-13'; },
        b => { b.records[0].ph = null; }, b => { b.records[0].ph = '8.1'; },
        b => { b.records[0].ph = 7.9; }, b => { b.records[0].ph = 9; },
        b => { b.records[0].validAreaKm2 = 10e6; }, b => { b.records[0].validAreaKm2 = null; },
        b => { b.records[0].product = 'model'; }, b => { b.records[0].product = 'nrt'; },
        b => { b.records[0].etag = ''; },
    ]) {
        const value = bundle(); mutate(value);
        assert.deepEqual(parse(value), [], mutate.toString());
    }
    assert.deepEqual(parseOceanPhData('{'), []);
    assert.deepEqual(parseOceanPhData('null'), []);
    assert.deepEqual(parseOceanPhData(JSON.stringify(bundle()), new Date('1986-02-15T00:00:00Z')), []);
});

test('pH legend and guides keep fractional precision and lower pH moves inward', () => {
    const display = getDatasetDisplay('oceanph');
    assert.equal(formatDatasetValue(8.123456, display), '8.123 pH');
    assert.deepEqual(display.referenceValues.map(value => formatReferenceValue(value, display)),
        ['8.00 pH', '8.05 pH', '8.10 pH', '8.15 pH']);
    assert.deepEqual(display.legendLabels, ['7.95', '8.00', '8.05', '8.10', '8.15']);
    assert.ok(oceanPhToSpiralValue(8.05) < oceanPhToSpiralValue(8.1));
    assert.equal(getLegendPercent(7.95, display), 0);
    assert.equal(getLegendPercent(OCEAN_PH_TICKS.at(-1), display), 100);
});

test('bundled pH is a complete real monthly history with recent provenance', async () => {
    const text = await readFile(new URL('../data/ocean-ph.json', import.meta.url), 'utf8');
    const snapshot = JSON.parse(text), parsed = parseOceanPhData(text);
    assert.ok(parsed.length >= 40);
    assert.equal(parsed.flatMap(entry => entry.anomalies).length, snapshot.records.length);
    let previous = 1985 * 12 - 1;
    for (const record of snapshot.records) {
        const [year, month] = record.month.split('-').map(Number);
        assert.equal(year * 12 + month - 1, ++previous);
    }
    assert.ok(snapshot.records.some(record => record.product === 'my'));
    assert.ok(snapshot.records.some(record => record.product === 'nrt'));
    assert.ok(snapshot.records[0].ph > snapshot.records.at(-1).ph);
});

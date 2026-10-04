import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { combineCountryPlaces, fetchCountryCatalog, fetchCountryData, findExactCountry, parseCountryTable, parseCountryTemperatureData,
    readCountryCatalog, readCountrySnapshot, searchCountries } from '../country-temperature-data.mjs';
import { discoverCountryFiles, prepareCountryData, publishCountryData, updateCountryData, validateCountryUpdate } from '../scripts/update-country-data.mjs';

const country = { code: 'DE', name: 'Germany', region: 'Germany' };
const base = 'https://crudata.uea.ac.uk/cru/data/hrg/cru_ts_4.10/crucy.2606161920.v4.10/countries/tmp/';
const hash = text => createHash('sha256').update(text).digest('hex');
function table(region = 'Germany', missing = '') {
    const header = ['Climatic Research Unit Country File created on Tue 16 Jun 19:20:14 BST 2026, from CRU TS run #2604091129',
        `Country = ${region} : parameter = Mean Temperature : Units = degrees Celsius`,
        'Period = 1901.2000 : missing value = -999.0 : format = (i5,17f8.1)',
        ' YEAR JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC MAM JJA SON DJF ANN'];
    for (let year = 1901; year <= 2000; year++) {
        header.push([year, ...Array.from({ length: 12 }, (_, month) => missing === `${year}-${month + 1}`
            ? '-999.0' : (month + (year - 1901) / 10).toFixed(1)), ...Array(5).fill('999.0')].join(' '));
    }
    return header.join('\n') + '\n';
}
function snapshot(text = table()) {
    return { version: 1, source: 'CRU-CY', release: '4.10', run: '2606161920', units: 'celsius', baseline: '1951-1980',
        country, through: '2000-12', text };
}
function entry(text = table()) {
    return { ...country, release: '4.10', run: '2606161920', last: 2000, text };
}

test('country tables use only monthly means and rebase each calendar month to 1951-1980', () => {
    const loaded = readCountrySnapshot(snapshot());
    assert.equal(loaded.records.length, 1200);
    assert.equal(loaded.location.name, 'Germany (country average)');
    const parsed = parseCountryTemperatureData(snapshot());
    assert.equal(parsed[0].year, 1901);
    assert.ok(parsed[0].anomalies.every(value => Math.abs(value + 6.45) < 1e-10));
    assert.ok(parsed.at(-1).anomalies.every(value => Math.abs(value - 3.45) < 1e-10));
    assert.equal(parsed.at(-1).fractions.at(-1), 11 / 12);
});

test('missing country months preserve calendar positions and incomplete baselines are rejected', () => {
    const parsed = parseCountryTemperatureData(snapshot(table('Germany', '1997-2')));
    assert.deepEqual(parsed.find(row => row.year === 1997).fractions.slice(0, 3), [0, 2 / 12, 3 / 12]);
    assert.deepEqual(parseCountryTemperatureData(snapshot(table('Germany', '1960-1'))), []);
    assert.throws(() => readCountrySnapshot(snapshot(table('Germany', '1960-1'))), /baseline/);
});

test('country validation rejects wrong regions, units, variables, rows, and coverage', () => {
    for (const mutate of [s => { s.country = { ...country, code: '../escape' }; }, s => { s.release = '3.26'; },
        s => { s.run = 'bad'; }, s => { s.baseline = '1991-2020'; }, s => { s.through = '2025-12'; },
        s => { s.text = s.text.replace('degrees Celsius', 'degrees Fahrenheit'); },
        s => { s.text = s.text.replace('Mean Temperature', 'Precipitation'); },
        s => { s.text = s.text.replace('Country = Germany', 'Country = France'); },
        s => { s.text = s.text.replace('1902 ', '1901 '); },
        s => { s.text = s.text.split('\n').slice(0, -2).join('\n'); }]) {
        const invalid = structuredClone(snapshot()); mutate(invalid);
        assert.throws(() => readCountrySnapshot(invalid));
    }
    assert.throws(() => parseCountryTable(table(), 'France'), /Unexpected/);
});

test('country discovery uses explicit aliases and never substitutes sub-islands for countries', () => {
    const html = ['Germany', 'USA', 'Bosnia-Herzegovinia', 'Grand_Cayman', 'St_Helena', 'all', 'Hawaii']
        .map(region => `<a href="crucy.v4.10.1901.2025.${region}.tmp.per">${region}</a>`).join('');
    const files = discoverCountryFiles(html, base);
    assert.deepEqual(files.map(file => file.code).sort(), ['BA', 'DE', 'US']);
    assert.equal(files[0].run, '2606161920');
    assert.throws(() => discoverCountryFiles(html + html, base), /Duplicate/);
    assert.throws(() => discoverCountryFiles(html, 'https://example.com/'), /URL/);
    assert.throws(() => discoverCountryFiles(html.replace('v4.10', 'v4.09'), base), /disagree/);
});

test('country search supports names and ISO codes with familiar aliases', () => {
    const catalog = { countries: [country, { code: 'US', name: 'United States', region: 'USA' },
        { code: 'GB', name: 'United Kingdom', region: 'United_Kingdom' }, { code: 'CI', name: 'Cote d\u2019Ivoire', region: 'Ivory_Coast' }] };
    assert.equal(searchCountries(catalog, ' DE ')[0].code, 'DE');
    assert.equal(findExactCountry(catalog, ' DE ').code, 'DE');
    assert.equal(findExactCountry(catalog, 'USA').code, 'US');
    assert.equal(findExactCountry(catalog, 'UK').code, 'GB');
    assert.equal(findExactCountry(catalog, 'United States').code, 'US');
    assert.equal(findExactCountry(catalog, 'ger'), null);
    assert.equal(searchCountries(catalog, 'germ')[0].code, 'DE');
    assert.equal(searchCountries(catalog, 'USA')[0].code, 'US');
    assert.equal(searchCountries(catalog, 'UK')[0].code, 'GB');
    assert.equal(searchCountries(catalog, 'ivory coast')[0].code, 'CI');
    assert.deepEqual(searchCountries(catalog, 'Berlin'), []);
    assert.deepEqual(searchCountries(catalog, 'x'), []);
});

test('unified search replaces geocoded countries with their averages while retaining actual places', () => {
    const catalog = { countries: [country] };
    const city = { name: 'Berlin, Germany', latitude: 52.52, longitude: 13.41, timezone: 'Europe/Berlin', countryCode: 'DE' };
    const geocodedCountry = { ...city, name: 'Germany', isCountry: true };
    assert.deepEqual(combineCountryPlaces(catalog, 'Deutschland', [geocodedCountry, city]), [country, city]);
    assert.deepEqual(combineCountryPlaces(catalog, 'ger', [geocodedCountry, city]), [country, city], 'Deduplicate country matches');
    const missing = { ...geocodedCountry, countryCode: 'FM', name: 'Micronesia' };
    assert.deepEqual(combineCountryPlaces(catalog, 'Micronesia', [missing]), [], 'No point fallback for an unsupported country');
    assert.deepEqual(combineCountryPlaces(null, 'Berlin', [geocodedCountry, city]), [city], 'Catalog failures do not block city search');
});

test('country retrieval verifies catalog metadata and exact file hashes', async () => {
    const prepared = prepareCountryData([entry()]);
    const text = prepared.files.get('DE.json'), record = prepared.catalog.countries[0];
    const loaded = await fetchCountryData(record, { fetchImpl: async (url, options) => {
        assert.equal(url, './data/country-temperature/DE.json');
        assert.equal(options.cache, 'no-store');
        return { ok: true, text: async () => text };
    } });
    assert.equal(loaded.country.code, 'DE');
    await assert.rejects(fetchCountryData(record, { fetchImpl: async () => ({ ok: true, text: async () => text + ' ' }) }), /being updated/);
    await assert.rejects(fetchCountryData(record, { fetchImpl: async () => ({ ok: false }) }), /unavailable/);
    const catalog = await fetchCountryCatalog({ fetchImpl: async () => ({ ok: true, json: async () => prepared.catalog }) });
    assert.equal(catalog.countries.length, 1);
    assert.throws(() => readCountryCatalog({ ...catalog, countries: [record, record] }));
});

test('country updater rejects older, incomplete, and mixed releases before publication', async () => {
    const prepared = prepareCountryData([entry()]);
    const directory = await mkdtemp(join(tmpdir(), 'climate-country-test-'));
    try {
        await publishCountryData(prepared, directory, 1);
        const before = await readFile(join(directory, 'catalog.json'), 'utf8');
        assert.throws(() => validateCountryUpdate(prepared, null), /incomplete/);
        const older = { ...prepared, catalog: { ...prepared.catalog, release: '4.09' } };
        await assert.rejects(publishCountryData(older, directory, 1), /older/);
        const previousRun = { ...prepared, catalog: { ...prepared.catalog, run: '2503061057' } };
        await assert.rejects(publishCountryData(previousRun, directory, 1), /older/);
        assert.throws(() => prepareCountryData([entry(), { ...entry(), release: '4.09' }]), /Mixed/);
        assert.throws(() => prepareCountryData([{ ...entry(), last: 2001 }]), /disagree/);
        assert.equal(await readFile(join(directory, 'catalog.json'), 'utf8'), before);
        assert.equal(hash(await readFile(join(directory, 'DE.json'), 'utf8')), prepared.catalog.countries[0].hash);
    } finally { await rm(directory, { recursive: true, force: true }); }
});

test('all bundled countries have valid monthly baselines, matching hashes, and a single release', async () => {
    const catalog = readCountryCatalog(await readFile(new URL('../data/country-temperature/catalog.json', import.meta.url), 'utf8'));
    assert.ok(catalog.countries.length >= 180);
    for (const country of catalog.countries) {
        const text = await readFile(new URL(`../data/country-temperature/${country.code}.json`, import.meta.url), 'utf8');
        assert.equal(hash(text), country.hash, country.code + ': hash');
        const data = readCountrySnapshot(text);
        assert.equal(data.country.code, country.code);
        assert.equal(data.country.region, country.region);
        assert.equal(data.release, catalog.release);
        assert.equal(data.run, catalog.run);
        assert.equal(data.records[0].month, country.first);
        assert.equal(data.through, country.last);
        assert.equal(data.records.length, country.months);
    }
});

test('an unchanged scheduled release reuses every local table and writes no changed snapshot', async () => {
    const catalogText = await readFile(new URL('../data/country-temperature/catalog.json', import.meta.url), 'utf8');
    const catalog = readCountryCatalog(catalogText);
    const files = new Map();
    for (const country of catalog.countries) files.set(country.code + '.json', await readFile(
        new URL(`../data/country-temperature/${country.code}.json`, import.meta.url), 'utf8'));
    const directory = await mkdtemp(join(tmpdir(), 'climate-country-reuse-'));
    try {
        await publishCountryData({ catalog, files }, directory);
        const path = `cru_ts_${catalog.release}/crucy.${catalog.run}.v${catalog.release}/`;
        const requests = [];
        await updateCountryData({ output: directory, fetchImpl: async url => {
            requests.push(url);
            if (url.endsWith('/hrg/')) return { ok: true, text: async () => `<a href="${path}">Current release</a>` };
            assert.ok(url.endsWith('/countries/tmp/'), 'Unchanged tables must not be downloaded');
            return { ok: true, text: async () => catalog.countries.map(country =>
                `<a href="crucy.v${catalog.release}.1901.${country.last.slice(0, 4)}.${country.region}.tmp.per">Country</a>`).join('') };
        } });
        assert.equal(requests.length, 2);
        assert.equal(await readFile(join(directory, 'catalog.json'), 'utf8'), catalogText);
        for (const [file, text] of files) assert.equal(await readFile(join(directory, file), 'utf8'), text);
    } finally { await rm(directory, { recursive: true, force: true }); }
});

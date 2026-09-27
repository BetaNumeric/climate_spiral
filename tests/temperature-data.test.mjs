import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, writeFile, mkdir, mkdtemp, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getTemperatureDataUrl, parseTemperatureData } from '../temperature-data.mjs';

test('rejects unknown temperature surfaces', () => {
    for (const surface of [undefined, '', 'other', 'toString']) {
        assert.throws(() => getTemperatureDataUrl(surface));
        assert.deepEqual(parseTemperatureData('{}', surface), []);
    }
});

for (const surface of ['ocean', 'land']) {
    const parseData = text => parseTemperatureData(text, surface);
    const datasetTest = (name, callback) => test(surface + ': ' + name, callback);

    const description = {
        title: surface === 'ocean' ? 'Global Ocean Average Temperature Departures' : 'Global Land Average Temperature Departures',
        units: 'Degrees Celsius',
        base_period: '1901-2000'
    };

    function makeSource(firstYear = 1951, lastYear = 1980) {
        const data = {};
        for (let year = firstYear; year <= lastYear; year++) {
            for (let month = 1; month <= 12; month++) {
                data[String(year) + String(month).padStart(2, '0')] = { departure: month / 10 };
            }
        }
        return { description: { ...description }, data };
    }

    datasetTest('download URL requests individual months and rolls over with the year', () => {
        assert.equal(getTemperatureDataUrl(surface, 2027), 'https://www.ncei.noaa.gov/access/monitoring/'
            + 'climate-at-a-glance/global/time-series/globe/' + surface + '/1/0/1850-2027.json');
        assert.equal(getTemperatureDataUrl(surface), getTemperatureDataUrl(surface, new Date().getUTCFullYear()));
    });

    datasetTest('rebases each calendar month to 1951-1980 without centigrade scaling', () => {
        const source = makeSource();
        source.data['202608'] = { departure: '1.3' };
        source.data['202601'] = { departure: 0.6 };
        const data = parseData(JSON.stringify(source));
        for (const entry of data.slice(0, 30)) {
            for (const value of entry.anomalies) assert(Math.abs(value) < 1e-12);
        }
        assert.equal(data.at(-1).year, 2026);
        assert.deepEqual(data.at(-1).fractions, [0, 7 / 12]);
        for (const value of data.at(-1).anomalies) assert(Math.abs(value - 0.5) < 1e-12);
    });

    datasetTest('ignores invalid dates and missing values without shifting subsequent months', () => {
        const source = makeSource();
        Object.assign(source.data, {
            '202601': { departure: null }, '202602': { departure: '' },
            '202603': { departure: ' ' }, '202604': { departure: -9999 },
            '202605': { departure: -99.99 }, '202606': { departure: 'NaN' },
            '202607': { departure: false }, '202608': { departure: '1.3' },
            '202609': { departure: '1.2oops' }, '202610': { departure: 'Infinity' },
            '202600': { departure: 1 }, '202613': { departure: 1 },
            '20261': { departure: 1 }, 'Annual': { departure: 1 }
        });
        const last = parseData(JSON.stringify(source)).at(-1);
        assert.equal(last.year, 2026);
        assert.deepEqual(last.fractions, [7 / 12]);
        assert(Math.abs(last.anomalies[0] - 0.5) < 1e-12);
    });

    datasetTest('rejects a partial or invalid reference period', () => {
        const source = makeSource();
        delete source.data['196502'];
        assert.deepEqual(parseData(JSON.stringify(source)), []);
        source.data['196502'] = { departure: null };
        assert.deepEqual(parseData(JSON.stringify(source)), []);
    });

    datasetTest('rejects malformed payloads and incorrect source metadata', () => {
        for (const text of ['', '<html>Error</html>', 'null', '{}', '[]']) {
            assert.deepEqual(parseData(text), []);
        }
        for (const [key, value] of [['title', 'Global Land'], ['units', 'Degrees Fahrenheit'], ['base_period', '1991-2020']]) {
            const source = makeSource();
            source.description[key] = value;
            assert.deepEqual(parseData(JSON.stringify(source)), []);
        }
        const wrongSurface = makeSource();
        wrongSurface.description.title = surface === 'ocean'
            ? 'Global Land Average Temperature Departures' : 'Global Ocean Average Temperature Departures';
        assert.deepEqual(parseData(JSON.stringify(wrongSurface)), []);
    });

    datasetTest('bundled observations preserve NOAA values apart from the documented monthly offset', async () => {
        const text = await readFile(new URL('../data/' + surface + '-temperature.json', import.meta.url), 'utf8');
        const source = JSON.parse(text);
        const data = parseData(text);
        assert.equal(data[0].year, 1850);
        assert.equal(data.reduce((count, entry) => count + entry.anomalies.length, 0), Object.keys(source.data).length);
        for (let month = 0; month < 12; month++) {
            const reference = data.filter(entry => entry.year >= 1951 && entry.year <= 1980);
            assert(Math.abs(reference.reduce((sum, entry) => sum + entry.anomalies[month], 0) / 30) < 1e-12);
            const offset = reference.reduce((sum, entry) => sum + Number(source.data[
                String(entry.year) + String(month + 1).padStart(2, '0')].departure), 0) / 30;
            for (const entry of data) {
                const index = entry.fractions.indexOf(month / 12);
                if (index < 0) continue;
                const original = Number(source.data[String(entry.year) + String(month + 1).padStart(2, '0')].departure);
                assert(Math.abs(entry.anomalies[index] - (original - offset)) < 1e-12);
            }
        }
    });

    datasetTest('updater accepts valid data and leaves the local file intact on bad or older responses', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'climate-' + surface + '-test-'));
        try {
            await mkdir(path.join(directory, 'scripts'));
            await mkdir(path.join(directory, 'data'));
            for (const file of ['temperature-data.mjs', 'scripts/update-temperature-data.mjs', 'scripts/update-' + surface + '-data.mjs']) {
                await copyFile(new URL('../' + file, import.meta.url), path.join(directory, file));
            }
            const payloadPath = path.join(directory, 'response.json');
            const destination = path.join(directory, 'data', surface + '-temperature.json');
            const mockFetch = 'globalThis.fetch = async () => new Response(await '
                + '(await import("node:fs/promises")).readFile(process.env.TEMPERATURE_TEST_PAYLOAD, "utf8"), '
                + '{status: Number(process.env.TEMPERATURE_TEST_STATUS)});';
            const run = (status = 200) => spawnSync(process.execPath, [
                '--import', 'data:text/javascript,' + encodeURIComponent(mockFetch),
                path.join(directory, 'scripts', 'update-' + surface + '-data.mjs')
            ], { env: { ...process.env, TEMPERATURE_TEST_PAYLOAD: payloadPath, TEMPERATURE_TEST_STATUS: String(status) }, encoding: 'utf8' });

            const initial = JSON.stringify(makeSource(1850, 1980));
            await writeFile(payloadPath, initial);
            assert.equal(run().status, 0);
            assert.equal(await readFile(destination, 'utf8'), initial);
            const updated = JSON.stringify(makeSource(1850, 1981));
            await writeFile(payloadPath, updated);
            assert.equal(run().status, 0);
            assert.equal(await readFile(destination, 'utf8'), updated);
            const withGap = makeSource(1850, 1981);
            delete withGap.data['190001'];
            for (const invalid of [initial, JSON.stringify(withGap), '<html>Error</html>']) {
                await writeFile(payloadPath, invalid);
                assert.notEqual(run().status, 0);
                assert.equal(await readFile(destination, 'utf8'), updated);
            }
            await writeFile(payloadPath, updated);
            assert.notEqual(run(503).status, 0);
            assert.equal(await readFile(destination, 'utf8'), updated);
        } finally {
            assert(path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep));
            await rm(directory, { recursive: true, force: true });
        }
    });
}

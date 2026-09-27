import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, writeFile, mkdir, mkdtemp, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fetchSeaIceData, parseSeaIceData, getSeaIceSourceUrls, getMonthlySegments,
    seaIceExtentToSpiralValue, spiralValueToSeaIceExtent } from '../sea-ice-data.mjs';

function source(hemisphere = 'north', lastYear = 1989) {
    const monthlyFiles = Array.from({ length: 12 }, (_, month) => {
        const lines = ['year, mo,source_dataset, region, extent, area'];
        for (let year = 1978; year <= lastYear; year++) {
            if (year === 1978 && month < 10) continue;
            const missing = year === 1987 && month === 11 || year === 1988 && month === 0;
            lines.push([year, month + 1, '"NSIDC, fixture"', hemisphere === 'north' ? 'N' : 'S',
                missing ? -9999 : (10 + month / 10).toFixed(2), 1].join(','));
        }
        return lines.join('\n') + '\n';
    });
    return { source: 'NOAA/NSIDC Sea Ice Index', version: '4.0', hemisphere, units: 'million km2', monthlyFiles };
}

test('source URLs select all twelve monthly files for the correct hemisphere', () => {
    assert.equal(getSeaIceSourceUrls('north').length, 12);
    assert.match(getSeaIceSourceUrls('north')[0], /north\/monthly\/data\/N_01_extent_v4\.0\.csv$/);
    assert.match(getSeaIceSourceUrls('south')[11], /south\/monthly\/data\/S_12_extent_v4\.0\.csv$/);
    assert.throws(() => getSeaIceSourceUrls('other'));
});

test('uses extent, not area, and retains the actual months in partial years', () => {
    const data = parseSeaIceData(JSON.stringify(source()), 'north');
    assert.equal(data[0].year, 1978);
    assert.deepEqual(data[0].fractions, [10 / 12, 11 / 12]);
    assert.deepEqual(data[0].displayValues, [11, 11.1]);
    assert.deepEqual(data[0].anomalies, [seaIceExtentToSpiralValue(11), seaIceExtentToSpiralValue(11.1)]);
    assert.equal(data.find(entry => entry.year === 1987).displayValues.length, 11);
    assert.equal(data.find(entry => entry.year === 1988).fractions[0], 1 / 12);
});

test('absolute extent has a common linear radius scale, with zero at the center', () => {
    assert.equal(seaIceExtentToSpiralValue(0), 0);
    assert.equal(seaIceExtentToSpiralValue(20), 3);
    for (const extent of [0, 2.1, 5, 10, 15, 20]) {
        assert(Math.abs(spiralValueToSeaIceExtent(seaIceExtentToSpiralValue(extent)) - extent) < 1e-12);
    }
});

test('CSV quoting, BOM, spaces and CRLF are accepted', () => {
    const payload = source();
    payload.monthlyFiles = payload.monthlyFiles.map(text => '\ufeff' + text.replaceAll('\n', '\r\n'));
    assert(parseSeaIceData(JSON.stringify(payload), 'north').length > 0);
});

test('rejects wrong hemisphere, metadata, incomplete files, duplicates and malformed values', () => {
    assert.deepEqual(parseSeaIceData(JSON.stringify(source('south')), 'north'), []);
    for (const invalid of ['null', '{}', '<html>error</html>']) assert.deepEqual(parseSeaIceData(invalid, 'north'), []);
    for (const mutate of [
        p => { p.units = 'km2'; }, p => { p.version = '3.0'; }, p => { p.source = 'Unknown'; },
        p => { p.monthlyFiles.pop(); }, p => { p.monthlyFiles[0] = '<html>Error</html>'; },
        p => { p.monthlyFiles[0] += p.monthlyFiles[0].split('\n')[1] + '\n'; },
        p => { p.monthlyFiles[0] = p.monthlyFiles[0].replace('10.00', ''); },
        p => { p.monthlyFiles[0] = p.monthlyFiles[0].replace('10.00', '-1'); },
        p => { p.monthlyFiles[0] = p.monthlyFiles[0].replace('10.00', '100'); },
        p => { p.monthlyFiles[0] = p.monthlyFiles[0].replace('10.00', '10oops'); },
        p => { p.monthlyFiles[0] = p.monthlyFiles[0].split('\n').filter((_, i) => i !== 2).join('\n'); }
    ]) {
        const payload = source();
        mutate(payload);
        assert.deepEqual(parseSeaIceData(JSON.stringify(payload), 'north'), []);
    }
});

test('curve sections stop at missing months, including a singleton', () => {
    assert.deepEqual(getMonthlySegments([]), []);
    assert.deepEqual(getMonthlySegments([2000]), [{ start: 0, end: 0 }]);
    assert.deepEqual(getMonthlySegments([1987 + 10 / 12, 1988 + 1 / 12, 1988 + 2 / 12]),
        [{ start: 0, end: 0 }, { start: 1, end: 2 }]);
    assert.deepEqual(getMonthlySegments([1999 + 11 / 12, 2000, 2000 + 1 / 12]), [{ start: 0, end: 2 }]);
});

test('download bundles all original CSV text, and rejects partial responses', async () => {
    const payload = source();
    let index = 0;
    const text = await fetchSeaIceData('north', async () => payload.monthlyFiles[index++]);
    assert.equal(index, 12);
    assert.deepEqual(JSON.parse(text), payload);
    await assert.rejects(fetchSeaIceData('north', async () => '<html>Error</html>'));
});

test('both bundled datasets contain real extents and preserve the historical gap', async () => {
    for (const hemisphere of ['north', 'south']) {
        const text = await readFile(new URL('../data/sea-ice-' + hemisphere + '.json', import.meta.url), 'utf8');
        const data = parseSeaIceData(text, hemisphere);
        assert.equal(data[0].year, 1978);
        assert(data.at(-1).year >= 2025);
        const dates = data.flatMap(entry => entry.fractions.map(fraction => entry.year + fraction));
        assert.equal(getMonthlySegments(dates).length, 2);
        assert(!data.find(entry => entry.year === 1987).fractions.includes(11 / 12));
        assert(!data.find(entry => entry.year === 1988).fractions.includes(0));
        assert.equal(data[0].fractions[0], 10 / 12);
        for (const entry of data) for (const extent of entry.displayValues) assert(extent >= 0 && extent < 20);
    }
});

test('updater preserves both snapshots if either hemisphere is invalid or older', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'climate-sea-ice-test-'));
    try {
        for (const dir of ['scripts', 'data', 'vendor/d3-dsv']) await mkdir(path.join(directory, dir), { recursive: true });
        for (const file of ['sea-ice-data.mjs', 'scripts/update-sea-ice-data.mjs', 'vendor/d3-dsv/dsv.mjs']) {
            await copyFile(new URL('../' + file, import.meta.url), path.join(directory, file));
        }
        const fixture = path.join(directory, 'response.json');
        const mock = 'globalThis.fetch = async url => { const data = JSON.parse(await '
            + '(await import("node:fs/promises")).readFile(process.env.SEA_ICE_TEST_FIXTURE, "utf8"));'
            + 'const hem = url.includes("/north/") ? "north" : "south";'
            + 'const month = Number(url.match(/_(\\d{2})_extent/)[1]);'
            + 'return new Response(data[hem].monthlyFiles[month - 1]); };';
        const run = () => spawnSync(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(mock),
            path.join(directory, 'scripts/update-sea-ice-data.mjs')], {
            env: { ...process.env, SEA_ICE_TEST_FIXTURE: fixture }, encoding: 'utf8'
        });
        await writeFile(fixture, JSON.stringify({ north: source('north'), south: source('south') }));
        let result = run();
        assert.equal(result.status, 0, result.stderr);
        const northPath = path.join(directory, 'data', 'sea-ice-north.json');
        const southPath = path.join(directory, 'data', 'sea-ice-south.json');
        const north = await readFile(northPath, 'utf8');
        const south = await readFile(southPath, 'utf8');
        for (const badSouth of [source('south', 1988), { monthlyFiles: Array(12).fill('<html>Error</html>') }]) {
            await writeFile(fixture, JSON.stringify({ north: source('north', 1990), south: badSouth }));
            assert.notEqual(run().status, 0);
            assert.equal(await readFile(northPath, 'utf8'), north);
            assert.equal(await readFile(southPath, 'utf8'), south);
        }
        await writeFile(fixture, JSON.stringify({ north: source('north', 1990), south: source('south', 1990) }));
        result = run();
        assert.equal(result.status, 0, result.stderr);
        assert.equal(parseSeaIceData(await readFile(northPath, 'utf8'), 'north').at(-1).year, 1990);
    } finally {
        assert(path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep));
        await rm(directory, { recursive: true, force: true });
    }
});

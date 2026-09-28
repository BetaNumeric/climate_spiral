import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, writeFile, mkdir, mkdtemp, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SEA_LEVEL_SOURCE_URL, fetchSeaLevelData, parseSeaLevelData,
    seaLevelMmToSpiralValue, spiralValueToSeaLevelMm } from '../sea-level-data.mjs';

const sourceUrl = 'https://sealevel.colorado.edu/files/2026_rel2/gmsl_2026rel2_seasons_retained.txt';
const homepage = '<a href="' + sourceUrl.replace('_retained', '_rmvd') + '">Download</a>';
function source(count = 15, omit = [], offset = 0) {
    const rows = ['# Date      2026_rel2 w/ GIA removed (mm)'];
    for (let i = 0; i < count; i++) {
        for (const day of [5, 15, 25]) {
            if (omit.includes(i + ':' + day)) continue;
            const year = 1993 + Math.floor(i / 12);
            const start = Date.UTC(year, 0, 1), end = Date.UTC(year + 1, 0, 1);
            const date = year + (Date.UTC(year, i % 12, day) - start) / (end - start);
            rows.push(date + ' ' + (i + day + offset));
        }
    }
    return JSON.stringify({ source: 'CU sea level', sourceUrl, raw: rows.join('\n') + '\n' });
}
const change = (text, fn) => { const bundle = JSON.parse(text); fn(bundle); return JSON.stringify(bundle); };

test('monthly sample means use actual UTC calendar months and the 1993 monthly-mean baseline', () => {
    const data = parseSeaLevelData(source(39));
    assert.equal(data[0].year, 1993);
    assert.deepEqual(data[0].displayValues, Array.from({ length: 12 }, (_, i) => i - 5.5));
    assert.equal(data[3].fractions.at(-1), 1 / 12); // Leap-year February 1996.
    assert.equal(data[3].displayValues.at(-1), 37 - 5.5);
    assert.deepEqual(parseSeaLevelData(source(39, [], 100)), data);
    for (const mm of [-20, 0, 75, 150]) assert.equal(spiralValueToSeaLevelMm(seaLevelMmToSpiralValue(mm)), mm);
});

test('retains single-sample months and omits the trailing source month', () => {
    const data = parseSeaLevelData(source(16, ['13:15', '13:25']));
    assert.deepEqual(data.at(-1).fractions, [0, 1 / 12, 2 / 12]);
    assert.deepEqual(data.at(-1).displayValues, [6.5, -2.5, 8.5]);
    assert.deepEqual(parseSeaLevelData(source(16, ['2:15', '2:25'])), []); // Incomplete baseline.
});

test('months with no observations remain gaps without shifting subsequent dates', () => {
    const data = parseSeaLevelData(source(16, ['13:5', '13:15', '13:25']));
    assert.deepEqual(data.at(-1).fractions, [0, 2 / 12]);
    assert.deepEqual(data.at(-1).displayValues, [6.5, 8.5]);
});

test('rejects wrong provenance, units, release, malformed rows, duplicates and reordered dates', () => {
    const good = source();
    for (const bad of ['', 'null', '<html>error</html>', '{}',
        change(good, b => b.source = 'NOAA'), change(good, b => b.sourceUrl = b.sourceUrl.replace('retained', 'rmvd')),
        change(good, b => b.sourceUrl = b.sourceUrl.replace('colorado.edu', 'example.com')),
        change(good, b => b.raw = b.raw.replace('(mm)', '(cm)')),
        change(good, b => b.raw = b.raw.replace('2026_rel2', '2025_rel2')),
        change(good, b => b.raw += b.raw.split('\n')[1]),
        change(good, b => b.raw = b.raw.replace(' 5\n', ' NaN\n')),
        change(good, b => b.raw = b.raw.replace(' 5\n', ' 1001\n')),
        change(good, b => b.raw = b.raw.replace(' 5\n', ' 5 0\n')),
        change(good, b => b.raw = b.raw.split('\n').reverse().join('\n'))]) {
        assert.deepEqual(parseSeaLevelData(bad), []);
    }
    assert.deepEqual(parseSeaLevelData(change(good, b => b.raw = '\ufeff' + b.raw.replaceAll('\n', '\r\n'))), parseSeaLevelData(good));
});

test('discovers the latest paired seasonal release and fails closed on changed pages or invalid data', async () => {
    const calls = [];
    const bundle = await fetchSeaLevelData(async url => {
        calls.push(url);
        return url === SEA_LEVEL_SOURCE_URL ? homepage.replaceAll('2026', '2025') + homepage : JSON.parse(source()).raw;
    });
    assert.deepEqual(calls, [SEA_LEVEL_SOURCE_URL, sourceUrl]);
    assert.deepEqual(JSON.parse(bundle), JSON.parse(source()));
    await assert.rejects(fetchSeaLevelData(async () => '<html>Maintenance</html>'), /link not found/);
    await assert.rejects(fetchSeaLevelData(async url => url === SEA_LEVEL_SOURCE_URL ? homepage : 'error'), /Invalid/);
});

test('bundled source has a zero-mean 1993 reference and a contemporary, finite series', async () => {
    const text = await readFile(new URL('../data/global-sea-level.json', import.meta.url), 'utf8');
    const data = parseSeaLevelData(text);
    assert.equal(data[0].year, 1993);
    assert.equal(data[0].displayValues.length, 12);
    assert(Math.abs(data[0].displayValues.reduce((a, b) => a + b)) < 1e-8);
    assert(data.at(-1).year >= 2026);
    assert(data.flatMap(e => e.displayValues).every(Number.isFinite));
    const year1997 = data.find(e => e.year === 1997);
    assert.deepEqual(year1997.fractions, Array.from({ length: 12 }, (_, i) => i / 12));
    // February has one actual estimate (-3.1 mm), not an interpolated Jan/Mar value.
    const raw = JSON.parse(text).raw.trim().split(/\r?\n/).slice(1).map(line => line.trim().split(/\s+/).map(Number));
    const january = raw.filter(([date]) => date >= 1993 && date < 1993 + 31 / 365);
    const baseline = january.reduce((sum, row) => sum + row[1], 0) / january.length - data[0].displayValues[0];
    assert(Math.abs(year1997.displayValues[1] - (-3.1 - baseline)) < 1e-10);
});

test('updater preserves local data after invalid, older, incomplete and failed downloads', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'climate-sea-level-test-'));
    try {
        await mkdir(path.join(directory, 'scripts'));
        await mkdir(path.join(directory, 'data'));
        for (const file of ['sea-level-data.mjs', 'scripts/update-sea-level-data.mjs']) {
            await copyFile(new URL('../' + file, import.meta.url), path.join(directory, file));
        }
        const payload = path.join(directory, 'response.json');
        const destination = path.join(directory, 'data/global-sea-level.json');
        const mock = `globalThis.fetch = async url => new Response(url === ${JSON.stringify(SEA_LEVEL_SOURCE_URL)}
            ? ${JSON.stringify(homepage)} : JSON.parse(await (await import('node:fs/promises')).readFile(process.env.SEA_LEVEL_PAYLOAD, 'utf8')).raw,
            {status: Number(process.env.SEA_LEVEL_STATUS)});`;
        const run = (status = 200) => spawnSync(process.execPath,
            ['--import', 'data:text/javascript,' + encodeURIComponent(mock), path.join(directory, 'scripts/update-sea-level-data.mjs')],
            { env: { ...process.env, SEA_LEVEL_PAYLOAD: payload, SEA_LEVEL_STATUS: String(status) }, encoding: 'utf8' });
        await writeFile(payload, source());
        assert.equal(run().status, 0);
        await writeFile(payload, source(16, [], 0.1));
        assert.equal(run().status, 0);
        const saved = await readFile(destination, 'utf8');
        for (const bad of [source(), source(16, ['13:15', '13:25']), source(16, ['15:25']),
            source(16, ['13:5']), change(source(16), b => b.raw = 'Error')]) {
            await writeFile(payload, bad);
            assert.notEqual(run().status, 0);
            assert.equal(await readFile(destination, 'utf8'), saved);
        }
        await writeFile(payload, source(17));
        assert.notEqual(run(503).status, 0);
        assert.equal(await readFile(destination, 'utf8'), saved);
    } finally {
        assert(path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep));
        await rm(directory, { recursive: true, force: true });
    }
});

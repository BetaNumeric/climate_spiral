import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, writeFile, mkdir, mkdtemp, copyFile, rm, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SEA_ICE_VOLUME_DATA_URL, SEA_ICE_MAX_VOLUME, SEA_ICE_VOLUME_TICKS,
    parseSeaIceVolumeData, seaIceVolumeToSpiralValue, spiralValueToSeaIceVolume } from '../sea-ice-volume-data.mjs';

const firstMonth = 1979 * 12;
function source(lastMonth = firstMonth + 13) {
    const rows = [];
    for (let year = 1979; year <= Math.floor(lastMonth / 12); year++) {
        const volumes = Array.from({ length: 12 }, (_, month) => {
            const ordinal = year * 12 + month;
            return ordinal <= lastMonth ? (30 - (ordinal - firstMonth) / 10).toFixed(3) : '-1.000';
        });
        rows.push([year, ...volumes].join(' '));
    }
    return rows.join('\n') + '\n';
}

test('volume uses the PIOMAS monthly source and a reversible scale in thousands of cubic kilometers', () => {
    assert.equal(SEA_ICE_VOLUME_DATA_URL,
        'https://psc.apl.uw.edu/wordpress/wp-content/uploads/schweiger/ice_volume/PIOMAS.2sst.monthly.Current.v2.1.txt');
    assert.equal(SEA_ICE_MAX_VOLUME, 60);
    assert.equal(seaIceVolumeToSpiralValue(0), 0);
    assert.deepEqual(SEA_ICE_VOLUME_TICKS.map(seaIceVolumeToSpiralValue), [0.5, 1, 1.5, 2, 2.5, 3]);
    for (const volume of [0, 4.021, 17.706, 32.951, 40, 50.789613, 60]) {
        assert(Math.abs(spiralValueToSeaIceVolume(seaIceVolumeToSpiralValue(volume)) - volume) < 1e-10);
    }
});

test('reads monthly volumes without rebasing or extrapolating the incomplete final year', () => {
    const [first, last] = parseSeaIceVolumeData(source());
    assert.equal(first.year, 1979);
    assert.deepEqual(first.fractions, Array.from({ length: 12 }, (_, month) => month / 12));
    assert.deepEqual(first.displayValues, Array.from({ length: 12 }, (_, month) => 30 - month / 10));
    assert.deepEqual(first.anomalies, first.displayValues.map(seaIceVolumeToSpiralValue));
    assert.equal(last.year, 1980);
    assert.deepEqual(last.displayValues, [28.8, 28.7]);
    assert.deepEqual(last.fractions, [0, 1 / 12]);
});

test('supports BOM, comments, tabs, blank lines, CRLF, and chronological sorting', () => {
    const rows = source().trim().split('\n').reverse();
    const text = '\ufeff# PIOMAS monthly volume\n\n' + rows.join('\n') + '\n';
    assert.deepEqual(parseSeaIceVolumeData(text.replaceAll(' ', '\t').replaceAll('\n', '\r\n')),
        parseSeaIceVolumeData(source()));
});

test('missing months keep their calendar positions; zero volume is a valid value', () => {
    const data = parseSeaIceVolumeData(source().replace('29.900', '-1.000').replace('29.800', '0.000'));
    assert.equal(data[0].displayValues.length, 11);
    assert.deepEqual(data[0].fractions.slice(0, 3), [0, 2 / 12, 3 / 12]);
    assert.deepEqual(data[0].displayValues.slice(0, 3), [30, 0, 29.7]);
    const missingYear = '1980 ' + Array(12).fill('-1.000').join(' ') + '\n';
    assert.deepEqual(parseSeaIceVolumeData(source(firstMonth + 11) + missingYear),
        parseSeaIceVolumeData(source(firstMonth + 11)));
});

test('rejects malformed tables, dates, duplicate years, columns, and invalid volumes', () => {
    const good = source();
    for (const invalid of ['', '# no data', '<html>Error</html>',
        good.replace('1979', '1978'), good.replace('1979', '1979.5'), good.replace('1979', 'NaN'),
        good.replace('30.000', 'NaN'), good.replace('30.000', 'Infinity'), good.replace('30.000', '1e999'),
        good.replace('30.000', '0x20'), good.replace('30.000', '30oops'), good.replace('30.000', '-2.000'),
        good.replace('30.000', '101.000'), good.replace('30.000 ', ''), good.replace('30.000', '30.000 31.000'),
        good + good.split('\n')[0] + '\n']) assert.deepEqual(parseSeaIceVolumeData(invalid), []);
});

test('bundled record preserves PIOMAS monthly values and every available month since January 1979', async () => {
    const text = await readFile(new URL('../data/piomas-monthly.txt', import.meta.url), 'utf8');
    const data = parseSeaIceVolumeData(text);
    const expected = text.trim().split(/\r?\n/).flatMap(line => {
        const [year, ...values] = line.trim().split(/\s+/).map(Number);
        return values.flatMap((volume, month) => volume === -1 ? [] : [{ volume, ordinal: year * 12 + month }]);
    });
    assert.equal(data[0].year, 1979);
    assert.equal(data[0].displayValues[0], 27.704);
    assert.deepEqual(data.flatMap(entry => entry.displayValues), expected.map(record => record.volume));
    const months = data.flatMap(entry => entry.fractions.map(fraction => Math.round((entry.year + fraction) * 12)));
    assert.deepEqual(months, expected.map(record => record.ordinal));
    assert(months.every((month, index) => month === firstMonth + index));
    assert(months.at(-1) >= 2026 * 12 + 1);
});

test('volume updater keeps valid snapshots on unchanged, older, incomplete, invalid, or failed responses', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'climate-volume-test-'));
    try {
        await mkdir(path.join(directory, 'scripts'));
        await mkdir(path.join(directory, 'data'));
        for (const file of ['sea-ice-volume-data.mjs', 'scripts/update-sea-ice-volume-data.mjs']) {
            await copyFile(new URL('../' + file, import.meta.url), path.join(directory, file));
        }
        const payload = path.join(directory, 'response.txt');
        const destination = path.join(directory, 'data/piomas-monthly.txt');
        const mock = 'globalThis.fetch = async () => new Response(await '
            + '(await import("node:fs/promises")).readFile(process.env.VOLUME_TEST_PAYLOAD, "utf8"), '
            + '{status: Number(process.env.VOLUME_TEST_STATUS)});';
        const run = (status = 200) => spawnSync(process.execPath,
            ['--import', 'data:text/javascript,' + encodeURIComponent(mock), path.join(directory, 'scripts/update-sea-ice-volume-data.mjs')],
            { env: { ...process.env, VOLUME_TEST_PAYLOAD: payload, VOLUME_TEST_STATUS: String(status) }, encoding: 'utf8' });
        const original = source();
        await writeFile(payload, original);
        assert.equal(run().status, 0);
        assert.equal(await readFile(destination, 'utf8'), original);
        await utimes(destination, new Date('2020-01-01'), new Date('2020-01-01'));
        const unchangedTime = (await stat(destination)).mtimeMs;
        assert.equal(run().status, 0);
        assert.equal((await stat(destination)).mtimeMs, unchangedTime);

        const updated = source(firstMonth + 14).replace('30.000', '30.003');
        await writeFile(payload, updated);
        assert.equal(run().status, 0);
        assert.equal(await readFile(destination, 'utf8'), updated);
        for (const invalid of [original, '<html>Error</html>', updated.replace('29.900', '-1.000'),
            updated.replace('30.003', '-1.000'), updated.split('\n').slice(1).join('\n')]) {
            await writeFile(payload, invalid);
            assert.notEqual(run().status, 0);
            assert.equal(await readFile(destination, 'utf8'), updated);
        }
        await writeFile(payload, updated);
        assert.notEqual(run(503).status, 0);
        assert.equal(await readFile(destination, 'utf8'), updated);
    } finally {
        assert(path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep));
        await rm(directory, { recursive: true, force: true });
    }
});

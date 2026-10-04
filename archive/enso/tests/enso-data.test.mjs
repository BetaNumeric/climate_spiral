import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, writeFile, mkdir, mkdtemp, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ENSO_DATA_URL, ENSO_TICKS, ensoAnomalyToRadius, parseENSOData } from '../enso-data.mjs';

const fixture = 'YR MTH ANOM\n1949 12 -1.03\n1950 1 0.00\n1950 2 1.25\n';

test('ENSO uses the monthly relative index, not the seasonal RONI endpoint', () => {
    assert.equal(ENSO_DATA_URL, 'https://www.cpc.ncep.noaa.gov/data/indices/Rnino34.ascii.txt');
    assert.deepEqual(ENSO_TICKS, [-3, 0, 3]);
    assert.equal(ensoAnomalyToRadius(0), 12);
    assert(ensoAnomalyToRadius(-5) > 0);
    assert(ensoAnomalyToRadius(-3) < ensoAnomalyToRadius(0));
    assert(ensoAnomalyToRadius(3) > ensoAnomalyToRadius(0));
});

test('preserves negative, zero, positive anomalies and the December start without rebasing', () => {
    assert.deepEqual(parseENSOData(fixture), [
        { year: 1949, anomalies: [-1.03], fractions: [11 / 12] },
        { year: 1950, anomalies: [0, 1.25], fractions: [0, 1 / 12] }
    ]);
});

test('accepts whitespace and sorted or unsorted monthly rows', () => {
    const text = '\ufeff YR\tMTH  ANOM\r\n1950 2 1.25\r\n\r\n1949 12 -1.03\r\n1950 1 0.00\r\n';
    assert.deepEqual(parseENSOData(text), parseENSOData(fixture));
});

test('missing months are excluded without shifting later months or replacing them with zero', () => {
    for (const missing of [-99.99, -999, -999.9, -9999, 99.99]) {
        assert.deepEqual(parseENSOData(fixture.replace('0.00', String(missing)))[1],
            { year: 1950, anomalies: [1.25], fractions: [1 / 12] });
    }
});

test('rejects seasonal tables, invalid dates, duplicate months, and malformed values', () => {
    for (const text of ['', '<html>Error</html>', 'SEAS YR ANOM\nDJF 1950 -1.2',
        fixture.replace('MTH', 'SEAS'), fixture.replace('1950 1 ', '1950 13 '),
        fixture.replace('1950 1 ', '1950.5 1 '), fixture.replace('1949 12 ', '1949 11 '),
        fixture.replace('1.25', '1.25oops'), fixture.replace('1.25', 'NaN'), fixture.replace('1.25', 'Infinity'),
        fixture.replace('1.25', '6'), fixture.replace('1.25', '-6'), fixture.replace('1.25', ''),
        fixture + '1950 1 0.02\n', 'YR MTH ANOM\n1949 12 -1.03\n']) {
        assert.deepEqual(parseENSOData(text), []);
    }
});

test('bundled ENSO observations preserve every NOAA monthly anomaly and date', async () => {
    const text = await readFile(new URL('../data/Rnino34.ascii.txt', import.meta.url), 'utf8');
    const rows = text.trim().split(/\r?\n/).slice(1).map(line => line.trim().split(/\s+/).map(Number));
    const data = parseENSOData(text);
    assert.deepEqual(data.flatMap(entry => entry.anomalies), rows.map(row => row[2]));
    assert.deepEqual(data.flatMap(entry => entry.fractions.map(fraction => Math.round((entry.year + fraction) * 12))),
        rows.map(([year, month]) => year * 12 + month - 1));
    assert.equal(data[0].year, 1949);
    assert(data.at(-1).year >= 2025);
    for (const entry of data) for (const value of entry.anomalies) assert(ensoAnomalyToRadius(value) > 0);
});

test('ENSO updater accepts revisions and preserves the local snapshot on failed or incomplete downloads', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'climate-enso-test-'));
    try {
        await mkdir(path.join(directory, 'scripts'));
        await mkdir(path.join(directory, 'data'));
        for (const file of ['enso-data.mjs', 'scripts/update-enso-data.mjs']) {
            await copyFile(new URL('../' + file, import.meta.url), path.join(directory, file));
        }
        const payload = path.join(directory, 'response.txt');
        const destination = path.join(directory, 'data/Rnino34.ascii.txt');
        const mock = 'globalThis.fetch = async () => new Response(await '
            + '(await import("node:fs/promises")).readFile(process.env.ENSO_TEST_PAYLOAD, "utf8"), '
            + '{status: Number(process.env.ENSO_TEST_STATUS)});';
        const run = (status = 200) => spawnSync(process.execPath,
            ['--import', 'data:text/javascript,' + encodeURIComponent(mock), path.join(directory, 'scripts/update-enso-data.mjs')],
            { env: { ...process.env, ENSO_TEST_PAYLOAD: payload, ENSO_TEST_STATUS: String(status) }, encoding: 'utf8' });
        await writeFile(payload, fixture);
        assert.equal(run().status, 0);
        assert.equal(await readFile(destination, 'utf8'), fixture);
        const updated = fixture.replace('-1.03', '-1.01') + '1950 3 -0.70\n';
        await writeFile(payload, updated);
        assert.equal(run().status, 0);
        assert.equal(await readFile(destination, 'utf8'), updated);
        for (const invalid of [fixture, '<html>Error</html>', updated.replace('0.00', '-99.99'),
            updated.replace('1949 12 -1.01\n', '')]) {
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

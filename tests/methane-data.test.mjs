import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, writeFile, mkdir, mkdtemp, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { METHANE_DATA_URL, METHANE_AXIS_MIN, METHANE_TICKS, parseMethaneData,
    methanePpbToSpiralValue, spiralValueToMethanePpb } from '../methane-data.mjs';

const header = '# CH4 expressed as a mole fraction in dry air, nanomol/mol, abbreviated as ppb\n'
    + '# Uncertainties in the global monthly means\n'
    + '# year month decimal average average_unc trend trend_unc\n';
const firstMonth = 1983 * 12 + 6;
function source(lastMonth = firstMonth + 2) {
    const rows = [];
    for (let ordinal = firstMonth; ordinal <= lastMonth; ordinal++) {
        const year = Math.floor(ordinal / 12), month = ordinal % 12 + 1;
        rows.push([year, month, (year + (month - 0.5) / 12).toFixed(3),
            (1625 + (ordinal - firstMonth) / 10).toFixed(2), -9.9, 1635, -9.9].join('   '));
    }
    return header + rows.join('\n') + '\n';
}

test('methane source and display scale use global CH4 in ppb', () => {
    assert.equal(METHANE_DATA_URL, 'https://gml.noaa.gov/webdata/ccgg/trends/ch4/ch4_mm_gl.txt');
    assert.equal(methanePpbToSpiralValue(METHANE_AXIS_MIN), 0);
    assert.deepEqual(METHANE_TICKS.map(methanePpbToSpiralValue), [1, 2, 3]);
    for (const value of [1500, 1625.98, 1939.44, 2100]) {
        assert(Math.abs(spiralValueToMethanePpb(methanePpbToSpiralValue(value)) - value) < 1e-10);
    }
});

test('uses the monthly average, not the uncertainty or seasonally adjusted trend', () => {
    const [entry] = parseMethaneData(source());
    assert.equal(entry.year, 1983);
    assert.deepEqual(entry.fractions, [6 / 12, 7 / 12, 8 / 12]);
    assert.deepEqual(entry.displayValues, [1625, 1625.1, 1625.2]);
    assert.deepEqual(entry.anomalies, entry.displayValues.map(methanePpbToSpiralValue));
});

test('supports comments, BOM, blank lines, CRLF, tabs, and chronological sorting', () => {
    const rows = source().trim().split('\n').slice(3).reverse();
    const text = '\ufeff' + header + '\n# Extra comment\n' + rows.join('\n');
    assert.deepEqual(parseMethaneData(text.replaceAll('   ', '\t').replaceAll('\n', '\r\n')), parseMethaneData(source()));
});

test('missing monthly means are not substituted and do not shift subsequent months', () => {
    for (const missing of ['-999.99', '-999.9', '-9999', '0']) {
        const [entry] = parseMethaneData(source().replace('1625.10', missing));
        assert.deepEqual(entry.fractions, [6 / 12, 8 / 12]);
        assert.deepEqual(entry.displayValues, [1625, 1625.2]);
    }
});

test('rejects incorrect provenance, columns, dates, duplicates, and malformed numbers', () => {
    const good = source();
    for (const invalid of [
        '', '<html>error</html>', good.replace('CH4 expressed', 'CO2 expressed'), good.replace('ppb', 'ppm'),
        good.replace('global monthly means', 'Mauna Loa monthly means'), good.replace('average_unc', 'deseasonalized'),
        good.replace('1983   7', '1983   13'), good.replace('1983   7', '1983.5   7'),
        good.replace('1983.542', '1984.542'), good.replace('1625.00', '1625oops'),
        good.replace('1625.00', 'NaN'), good.replace('1625.00', 'Infinity'), good.replace('1625.00', '10001'),
        good.replace('1625.00', ''), good + good.split('\n')[3] + '\n'
    ]) assert.deepEqual(parseMethaneData(invalid), []);
});

test('bundled monthly values match NOAA records without rebasing or ppb conversion', async () => {
    const text = await readFile(new URL('../data/ch4_mm_gl.txt', import.meta.url), 'utf8');
    const data = parseMethaneData(text);
    const expected = text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'))
        .map(line => line.split(/\s+/).map(Number));
    assert.equal(data[0].year, 1983);
    assert.equal(data[0].fractions[0], 6 / 12);
    assert.deepEqual(data.flatMap(entry => entry.displayValues), expected.map(row => row[3]));
    assert.deepEqual(data.flatMap(entry => entry.fractions.map(fraction => Math.round((entry.year + fraction) * 12))),
        expected.map(row => row[0] * 12 + row[1] - 1));
    assert(data.at(-1).year >= 2025);
});

test('methane updater preserves the local snapshot on invalid, incomplete, older, or failed responses', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'climate-methane-test-'));
    try {
        await mkdir(path.join(directory, 'scripts'));
        await mkdir(path.join(directory, 'data'));
        for (const file of ['methane-data.mjs', 'scripts/update-methane-data.mjs']) {
            await copyFile(new URL('../' + file, import.meta.url), path.join(directory, file));
        }
        const payload = path.join(directory, 'response.txt');
        const destination = path.join(directory, 'data/ch4_mm_gl.txt');
        const mock = 'globalThis.fetch = async () => new Response(await '
            + '(await import("node:fs/promises")).readFile(process.env.METHANE_TEST_PAYLOAD, "utf8"), '
            + '{status: Number(process.env.METHANE_TEST_STATUS)});';
        const run = (status = 200) => spawnSync(process.execPath,
            ['--import', 'data:text/javascript,' + encodeURIComponent(mock), path.join(directory, 'scripts/update-methane-data.mjs')],
            { env: { ...process.env, METHANE_TEST_PAYLOAD: payload, METHANE_TEST_STATUS: String(status) }, encoding: 'utf8' });
        const original = source();
        await writeFile(payload, original);
        assert.equal(run().status, 0);
        assert.equal(await readFile(destination, 'utf8'), original);
        const updated = source(firstMonth + 3).replace('1625.00', '1625.03');
        await writeFile(payload, updated);
        assert.equal(run().status, 0);
        assert.equal(await readFile(destination, 'utf8'), updated);
        for (const invalid of [original, '<html>Error</html>', updated.replace('1625.10', '-999.99'),
            updated.split('\n').filter((_, i) => i !== 3).join('\n')]) {
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

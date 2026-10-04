import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseGISSData } from '../gistemp-data.mjs';

test('GISTEMP native hundredths become Celsius and retain calendar months', () => {
    assert.deepEqual(parseGISSData('Header\n1880 -19 -25 -9\n'), [
        { year: 1880, anomalies: [-19 * 0.01, -25 * 0.01, -9 * 0.01], fractions: [0, 1 / 12, 2 / 12] }
    ]);
});

test('legacy decimal Celsius imports retain their scale, sparse years and input order', () => {
    assert.deepEqual(parseGISSData('2025 1.2 -0.5\n2020 -0.2\n'), [
        { year: 2025, anomalies: [1.2, -0.5], fractions: [0, 1 / 12] },
        { year: 2020, anomalies: [-0.2], fractions: [0] }
    ]);
});

test('partial years stop at the first missing or invalid month', () => {
    for (const missing of ['***', 'invalid']) {
        assert.deepEqual(parseGISSData('2025 123 130 ' + missing + ' 140'), [
            { year: 2025, anomalies: [1.23, 1.3], fractions: [0, 1 / 12] }
        ]);
    }
    assert.deepEqual(parseGISSData('Header\n2025 ***\n'), []);
});

test('annual and seasonal fields are ignored and Windows whitespace is accepted', () => {
    const months = Array.from({ length: 12 }, (_, index) => -19 + index);
    const [record] = parseGISSData(' Year Jan Feb\r\n 1880\t' + months.join('  ') + ' 999 999\r\n');
    assert.deepEqual(record.anomalies, months.map(value => value * 0.01));
    assert.deepEqual(record.fractions, months.map((_, index) => index / 12));
});

test('all bundled GISTEMP monthly observations keep the original values and dates', async () => {
    const text = await readFile(new URL('../data/GLB.Ts+dSST.txt', import.meta.url), 'utf8');
    const expected = text.split(/\r?\n/).filter(line => /^\s*\d{4}\s/.test(line)).map(line => {
        const [year, ...fields] = line.trim().split(/\s+/);
        const months = fields.slice(0, 12);
        const firstMissing = months.findIndex(value => !Number.isFinite(Number(value)));
        const values = months.slice(0, firstMissing < 0 ? 12 : firstMissing).map(Number);
        return { year: Number(year), anomalies: values.map(value => value * 0.01),
            fractions: values.map((_, index) => index / 12) };
    });
    assert.ok(expected.length > 140);
    assert.deepEqual(parseGISSData(text), expected);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { parseCO2MonthlyData, co2PpmToSpiralValue, spiralValueToCo2Ppm } from '../co2-data.mjs';

test('CO2 preserves native concentrations and calendar months across years', () => {
    const data = parseCO2MonthlyData('# NOAA monthly data\n2025 1 2025.04 426.65 425.00\n'
        + '2024 12 2024.95 425.42 424.00\n');
    assert.deepEqual(data.map(entry => entry.year), [2024, 2025]);
    assert.deepEqual(data[0].fractions, [11 / 12]);
    assert.deepEqual(data[1].fractions, [0]);
    assert.deepEqual(data[1].displayValues, [426.65]);
    assert.equal(data[1].anomalies[0], (426.65 - 280) / 50);
});

test('CO2 retains the existing missing-average fallback and excludes unavailable values', () => {
    const data = parseCO2MonthlyData('2024 1 2024.04 -99.99 421.00\n2024 2 2024.12 -99.99 -99.99\n'
        + '2024 3 2024.20 423.00 422.00\n');
    assert.deepEqual(data[0].displayValues, [421, 423]);
    assert.deepEqual(data[0].fractions, [0, 2 / 12]);
    assert.deepEqual(parseCO2MonthlyData('# Header\ninvalid\n'), []);
});

test('CO2 display conversion is reversible without changing ppm', () => {
    for (const ppm of [280, 315.71, 330, 380, 426.65, 430, 450]) {
        assert.ok(Math.abs(spiralValueToCo2Ppm(co2PpmToSpiralValue(ppm)) - ppm) < 1e-10);
    }
});

test('bundled CO2 records preserve every usable source value and monthly date', async () => {
    const text = await readFile(new URL('../data/co2_mm_mlo.txt', import.meta.url), 'utf8');
    const rows = text.split(/\r?\n/).filter(line => /^\s*\d{4}\s/.test(line))
        .map(line => line.trim().split(/\s+/).map(Number))
        .map(([year, month, , average, deseasonalized]) => ({ year, month, ppm: average > 0 ? average : deseasonalized }))
        .filter(row => row.ppm > 0);
    const data = parseCO2MonthlyData(text);
    assert.ok(rows.length > 800);
    assert.deepEqual(data.flatMap(entry => entry.displayValues), rows.map(row => row.ppm));
    assert.deepEqual(data.flatMap(entry => entry.fractions.map(fraction => Math.round((entry.year + fraction) * 12))),
        rows.map(row => row.year * 12 + row.month - 1));
});

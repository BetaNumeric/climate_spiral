import test from 'node:test';
import assert from 'node:assert/strict';
import { ORAS5_METHOD, parseOras5VolumeData } from '../oras5-data.mjs';
import { spiralValueToSeaIceVolume } from '../sea-ice-volume-data.mjs';
import { oras5VideoDatasets } from '../scripts/readme-video.mjs';

function snapshot() {
    return {
        version: 1, source: 'ECMWF ORAS5', dataset: 'reanalysis-oras5',
        method: ORAS5_METHOD, units: '1000 km3',
        grid: { name: 'ORCA025', shape: [1021, 1442], sha256: 'a'.repeat(64) },
        records: Array.from({ length: 14 }, (_, index) => ({
            year: 2014 + Math.floor(index / 12), month: index % 12 + 1,
            product: index < 12 ? 'consolidated' : 'operational', north: 30 - index, south: index
        }))
    };
}

test('README rotation includes ORAS5 only when its published snapshot is valid', () => {
    assert.deepEqual(oras5VideoDatasets(''), []);
    assert.deepEqual(oras5VideoDatasets('{}'), []);
    assert.deepEqual(oras5VideoDatasets(JSON.stringify(snapshot())).map(row => row.key),
        ['arcticoras5', 'antarcticoras5']);
});

test('ORAS5 keeps hemispheres, calendar positions and actual volumes separate', () => {
    const text = JSON.stringify(snapshot());
    const north = parseOras5VolumeData(text, 'north');
    const south = parseOras5VolumeData(text, 'south');
    assert.deepEqual(north.map(row => row.year), [2014, 2015]);
    assert.equal(north[0].fractions.at(-1), 11 / 12);
    assert.deepEqual(north[1].fractions, [0, 1 / 12]);
    assert.equal(north[1].displayValues[1], 17);
    assert.equal(south[0].displayValues[0], 0);
    assert.equal(spiralValueToSeaIceVolume(north[1].anomalies[1]), 17);
});

test('ORAS5 rejects unexpected units, grids, methods and products', () => {
    for (const mutate of [
        data => { data.units = 'km3'; },
        data => { data.method = 'sum-thickness'; },
        data => { data.grid.shape = [720, 1440]; },
        data => { data.grid.sha256 = ''; },
        data => { data.source = 'PIOMAS'; },
        data => { data.records[12].product = 'consolidated'; },
        data => { data.records[0].north = -1; },
        data => { data.records[0].south = '2'; },
        data => { data.records[0] = null; }
    ]) {
        const data = snapshot();
        mutate(data);
        assert.deepEqual(parseOras5VolumeData(JSON.stringify(data), 'north'), []);
    }
});

test('ORAS5 rejects corrupt, empty, incomplete, reordered and duplicate series', () => {
    for (const text of ['', '<html>404</html>', 'null', '{}', '[]']) {
        assert.deepEqual(parseOras5VolumeData(text, 'north'), []);
    }
    for (const mutate of [
        data => { data.records = []; },
        data => { data.records.splice(5, 1); },
        data => { data.records.shift(); },
        data => { data.records.reverse(); },
        data => { data.records.push(data.records.at(-1)); }
    ]) {
        const data = snapshot();
        mutate(data);
        assert.deepEqual(parseOras5VolumeData(JSON.stringify(data), 'south'), []);
    }
    assert.deepEqual(parseOras5VolumeData(JSON.stringify(snapshot()), 'east'), []);
});

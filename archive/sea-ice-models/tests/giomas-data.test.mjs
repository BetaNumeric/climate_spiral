import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GIOMAS_DATA_PATH, GIOMAS_METHOD, GIOMAS_SOURCE_URL, parseGiomasVolumeData } from '../giomas-data.mjs';
import { SEA_ICE_MAX_VOLUME, spiralValueToSeaIceVolume } from '../../../sea-ice-volume-data.mjs';
import { giomasVideoDatasets, chooseSecondaryDataset, previousSecondaryDataset, updateReadmeVideos } from '../scripts/readme-video.mjs';

function snapshot() {
    return {
        version: 1, source: 'PSC GIOMAS', sourceUrl: GIOMAS_SOURCE_URL,
        method: GIOMAS_METHOD, units: '1000 km3',
        grid: { shape: [276, 360], sha256: 'a'.repeat(64) },
        releases: [1979, 1980].map(year => ({ year,
            url: `https://pscfiles.apl.washington.edu/zhang/Global_seaice/heff.H${year}.nc.gz`,
            sha256: 'b'.repeat(64) })),
        records: Array.from({ length: 24 }, (_, index) => ({
            year: 1979 + Math.floor(index / 12), month: index % 12 + 1,
            north: 35 - index, south: index
        }))
    };
}

test('GIOMAS retains calendar positions and separate hemispheric volumes', () => {
    const text = JSON.stringify(snapshot());
    const north = parseGiomasVolumeData(text, 'north');
    const south = parseGiomasVolumeData(text, 'south');
    assert.deepEqual(north.map(row => row.year), [1979, 1980]);
    assert.equal(north[0].fractions.at(-1), 11 / 12);
    assert.equal(north[1].displayValues[0], 23);
    assert.equal(south[0].displayValues[0], 0);
    assert.ok(Math.abs(spiralValueToSeaIceVolume(north[1].anomalies[0]) - 23) < 1e-12);
});

test('GIOMAS rejects corrupt metadata, incorrect provenance, invalid values and incomplete histories', () => {
    for (const text of ['', 'null', '{}', '[]', '<html>404</html>']) {
        assert.deepEqual(parseGiomasVolumeData(text, 'north'), []);
    }
    for (const mutate of [
        data => { data.source = 'PIOMAS'; },
        data => { data.sourceUrl = 'https://example.com'; },
        data => { data.method = 'thickness-times-concentration'; },
        data => { data.units = 'km3'; },
        data => { data.grid.shape.reverse(); },
        data => { data.grid.sha256 = ''; },
        data => { data.records[0].south = '2'; },
        data => { data.records[0].north = -1; },
        data => { data.records[0].north = 101; },
        data => { data.records[0] = null; },
        data => { data.records.reverse(); },
        data => { data.records.pop(); },
        data => { data.records[12] = data.records[11]; },
        data => { data.records = []; },
        data => { data.releases.pop(); },
        data => { data.releases[0].url = data.releases[1].url; },
        data => { data.releases[0].sha256 = 'invalid'; },
        data => { data.releases[0] = null; }
    ]) {
        const data = snapshot();
        mutate(data);
        for (const hemisphere of ['north', 'south']) {
            assert.deepEqual(parseGiomasVolumeData(JSON.stringify(data), hemisphere), []);
        }
    }
    assert.deepEqual(parseGiomasVolumeData(JSON.stringify(snapshot()), 'global'), []);
});

test('published GIOMAS history preserves native source values on the shared display scale', async context => {
    let text;
    try { text = await readFile(new URL('../' + GIOMAS_DATA_PATH, import.meta.url), 'utf8'); }
    catch (error) {
        if (error.code !== 'ENOENT') throw error;
        context.skip('GIOMAS snapshot has not been published yet');
        return;
    }
    const data = JSON.parse(text);
    for (const hemisphere of ['north', 'south']) {
        const entries = parseGiomasVolumeData(text, hemisphere);
        assert.ok(entries.length > 0);
        assert.deepEqual(entries.flatMap(row => row.displayValues), data.records.map(row => row[hemisphere]));
        assert.deepEqual(entries.flatMap(row => row.fractions.map(fraction => Math.round(row.year * 12 + fraction * 12))),
            data.records.map(row => row.year * 12 + row.month - 1));
        entries.flatMap(row => row.anomalies).forEach((value, index) => {
            assert.ok(Math.abs(spiralValueToSeaIceVolume(value) - data.records[index][hemisphere]) < 1e-10);
        });
        assert.ok(Math.max(...data.records.map(row => row[hemisphere])) <= SEA_ICE_MAX_VOLUME);
    }
});

test('README rotation accepts only validated GIOMAS bundles', () => {
    assert.deepEqual(giomasVideoDatasets('{}'), []);
    assert.deepEqual(giomasVideoDatasets(JSON.stringify(snapshot())).map(row => row.key),
        ['arcticgiomas', 'antarcticgiomas']);
});

test('published GIOMAS datasets can occupy the secondary README video slot', async context => {
    try { await readFile(new URL('../' + GIOMAS_DATA_PATH, import.meta.url)); }
    catch (error) {
        if (error.code !== 'ENOENT') throw error;
        context.skip('GIOMAS snapshot has not been published yet');
        return;
    }
    const original = '<!-- README_VIDEO_TOP_START --><!-- README_VIDEO_TOP_END -->\n'
        + '<!-- README_VIDEO_BOTTOM_START --><!-- README_VIDEO_BOTTOM_END -->';
    for (const key of ['arcticgiomas', 'antarcticgiomas']) {
        const updated = updateReadmeVideos(original, {
            topUrl: 'https://github.com/user-attachments/assets/aaaa',
            bottomUrl: 'https://github.com/user-attachments/assets/bbbb',
            dataset: chooseSecondaryDataset(null, key), month: '2026-10'
        });
        assert.equal(previousSecondaryDataset(updated), key);
    }
});

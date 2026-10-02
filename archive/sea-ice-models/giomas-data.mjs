import { seaIceVolumeToSpiralValue } from '../../sea-ice-volume-data.mjs';

export const GIOMAS_DATA_PATH = 'data/giomas-sea-ice-volume.json';
export const GIOMAS_SOURCE_URL = 'https://psc.apl.uw.edu/data/global-sea-ice-giomas-data-sets/';
export const GIOMAS_METHOD = 'monthly-mean-effective-thickness-area-v1';
const ARCHIVE_URL = 'https://pscfiles.apl.washington.edu/zhang/Global_seaice/';

export function parseGiomasVolumeData(text, hemisphere) {
    if (hemisphere !== 'north' && hemisphere !== 'south') return [];
    let data;
    try { data = JSON.parse(text); } catch { return []; }
    if (data?.version !== 1 || data.source !== 'PSC GIOMAS' || data.sourceUrl !== GIOMAS_SOURCE_URL
        || data.method !== GIOMAS_METHOD || data.units !== '1000 km3'
        || data.grid?.shape?.length !== 2 || data.grid.shape[0] !== 276 || data.grid.shape[1] !== 360
        || !/^[a-f0-9]{64}$/.test(data.grid.sha256)
        || !Array.isArray(data.records) || !data.records.length || data.records.length % 12
        || !Array.isArray(data.releases) || data.releases.length !== data.records.length / 12) return [];
    const entries = [];
    for (const [index, row] of data.records.entries()) {
        if (!row || row.year !== 1979 + Math.floor(index / 12) || row.month !== index % 12 + 1
            || ['north', 'south'].some(key => !Number.isFinite(row[key]) || row[key] < 0 || row[key] > 100)) return [];
        if (row.month === 1) {
            const release = data.releases[index / 12];
            if (release?.year !== row.year || release.url !== ARCHIVE_URL + `heff.H${row.year}.nc.gz`
                || !/^[a-f0-9]{64}$/.test(release.sha256)) return [];
            entries.push({ year: row.year, anomalies: [], displayValues: [], fractions: [] });
        }
        const entry = entries.at(-1);
        entry.anomalies.push(seaIceVolumeToSpiralValue(row[hemisphere]));
        entry.displayValues.push(row[hemisphere]);
        entry.fractions.push((row.month - 1) / 12);
    }
    return entries;
}

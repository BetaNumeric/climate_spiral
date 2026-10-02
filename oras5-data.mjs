import { seaIceVolumeToSpiralValue } from './sea-ice-volume-data.mjs';

export const ORAS5_DATA_PATH = 'data/oras5-sea-ice-volume.json';
export const ORAS5_SOURCE_URL = 'https://cds.climate.copernicus.eu/datasets/reanalysis-oras5';
export const ORAS5_METHOD = 'monthly-mean-thickness-concentration-area-v1';

export function parseOras5VolumeData(text, hemisphere) {
    if (hemisphere !== 'north' && hemisphere !== 'south') return [];
    let data;
    try { data = JSON.parse(text); } catch { return []; }
    if (data?.version !== 1 || data.source !== 'ECMWF ORAS5'
        || data.dataset !== 'reanalysis-oras5' || data.method !== ORAS5_METHOD
        || data.units !== '1000 km3' || data.grid?.name !== 'ORCA025'
        || data.grid.shape?.length !== 2 || data.grid.shape[0] !== 1021 || data.grid.shape[1] !== 1442
        || !/^[a-f0-9]{64}$/.test(data.grid.sha256)
        || !Array.isArray(data.records) || !data.records.length) return [];
    const entries = [];
    let previous = null;
    for (const row of data.records) {
        if (!row || !Number.isInteger(row.year) || row.year < 1958
            || !Number.isInteger(row.month) || row.month < 1 || row.month > 12
            || row.product !== (row.year <= 2014 ? 'consolidated' : 'operational')
            || ['north', 'south'].some(key => !Number.isFinite(row[key]) || row[key] < 0 || row[key] > 100)) return [];
        const ordinal = row.year * 12 + row.month - 1;
        if (previous === null ? row.month !== 1 : ordinal !== previous + 1) return [];
        previous = ordinal;
        if (entries.at(-1)?.year !== row.year) {
            entries.push({ year: row.year, anomalies: [], displayValues: [], fractions: [] });
        }
        const entry = entries.at(-1);
        entry.anomalies.push(seaIceVolumeToSpiralValue(row[hemisphere]));
        entry.displayValues.push(row[hemisphere]);
        entry.fractions.push((row.month - 1) / 12);
    }
    return entries;
}

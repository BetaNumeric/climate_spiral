import dsvFormat from './vendor/d3-dsv/dsv.mjs';

const csv = dsvFormat(',');
export const SEA_ICE_MAX_EXTENT = 20;
export const SEA_ICE_TICKS = [5, 10, 15, 20];
const SOURCE = 'NOAA/NSIDC Sea Ice Index';

export const seaIceExtentToSpiralValue = extent => extent * 3 / SEA_ICE_MAX_EXTENT;
export const spiralValueToSeaIceExtent = value => value * SEA_ICE_MAX_EXTENT / 3;

export function getMonthlySegments(dates) {
    const segments = [];
    let start = 0;
    for (let index = 1; index <= dates.length; index++) {
        if (index === dates.length || Math.round(dates[index] * 12) - Math.round(dates[index - 1] * 12) > 1) {
            segments.push({ start, end: index - 1 });
            start = index;
        }
    }
    return segments;
}

export function getSeaIceSourceUrls(hemisphere) {
    if (!['north', 'south'].includes(hemisphere)) throw new Error('Invalid sea-ice hemisphere.');
    const prefix = hemisphere === 'north' ? 'N' : 'S';
    return Array.from({ length: 12 }, (_, month) =>
        'https://noaadata.apps.nsidc.org/NOAA/G02135/' + hemisphere + '/monthly/data/'
        + prefix + '_' + String(month + 1).padStart(2, '0') + '_extent_v4.0.csv');
}

export function parseSeaIceData(text, hemisphere) {
    let payload;
    try {
        payload = JSON.parse(text);
    } catch {
        return [];
    }
    if (!['north', 'south'].includes(hemisphere) || payload?.hemisphere !== hemisphere
        || payload.source !== SOURCE || payload.version !== '4.0' || payload.units !== 'million km2'
        || !Array.isArray(payload.monthlyFiles) || payload.monthlyFiles.length !== 12) return [];

    const records = [];
    for (let monthIndex = 0; monthIndex < 12; monthIndex++) {
        const text = payload.monthlyFiles[monthIndex];
        if (typeof text !== 'string') return [];
        const rows = csv.parseRows(text.trim());
        const header = rows.shift()?.map(value => value.trim());
        const fields = ['year', 'mo', 'region', 'extent', 'source_dataset'];
        if (!header || fields.some(field => !header.includes(field)) || !rows.length) return [];
        for (const row of rows) {
            if (row.every(value => !value.trim())) continue;
            const values = Object.fromEntries(fields.map(field => [field, row[header.indexOf(field)]?.trim()]));
            if (fields.some(field => !values[field])) return [];
            const year = Number(values.year);
            const month = Number(values.mo);
            const extent = Number(values.extent);
            if (!Number.isInteger(year) || year < 1978 || !Number.isInteger(month) || month !== monthIndex + 1
                || values.region !== (hemisphere === 'north' ? 'N' : 'S')
                || !Number.isFinite(extent) || (extent !== -9999 && (extent < 0 || extent > 30))) return [];
            records.push({ year, month, extent, ordinal: year * 12 + month - 1 });
        }
    }
    records.sort((a, b) => a.ordinal - b.ordinal);
    // Every month must be present in the source, including explicitly flagged missing observations.
    if (records[0]?.ordinal !== 1978 * 12 + 10
        || records.some((record, index) => index > 0 && record.ordinal !== records[index - 1].ordinal + 1)) return [];
    const byYear = new Map();
    for (const { year, month, extent } of records) {
        if (extent === -9999) continue;
        if (!byYear.has(year)) byYear.set(year, { year, anomalies: [], displayValues: [], fractions: [] });
        const entry = byYear.get(year);
        entry.anomalies.push(seaIceExtentToSpiralValue(extent));
        entry.displayValues.push(extent);
        entry.fractions.push((month - 1) / 12);
    }
    return Array.from(byYear.values());
}

export async function fetchSeaIceData(hemisphere, fetchText) {
    const monthlyFiles = [];
    for (const url of getSeaIceSourceUrls(hemisphere)) monthlyFiles.push(await fetchText(url));
    const text = JSON.stringify({ source: SOURCE, version: '4.0', hemisphere, units: 'million km2', monthlyFiles }, null, 2) + '\n';
    if (!parseSeaIceData(text, hemisphere).length) throw new Error('Invalid or incomplete NSIDC monthly data.');
    return text;
}

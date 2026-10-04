export const ENSO_DATA_URL = 'https://www.cpc.ncep.noaa.gov/data/indices/Rnino34.ascii.txt';
export const ENSO_TICKS = [-3, 0, 3];
// A positive radius across the validated range, with zero anomaly on the middle ring.
export const ensoAnomalyToRadius = anomaly => 12 + anomaly * 2;

export function parseENSOData(text) {
    const lines = text.trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (lines.shift()?.replace(/\s+/g, ' ') !== 'YR MTH ANOM') return [];
    const records = [];
    const seen = new Set();
    for (const line of lines) {
        const fields = line.split(/\s+/);
        if (fields.length !== 3) return [];
        const [year, month, anomaly] = fields.map(Number);
        const ordinal = year * 12 + month - 1;
        if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12
            || ordinal < 1949 * 12 + 11 || !Number.isFinite(anomaly) || seen.has(ordinal)) return [];
        seen.add(ordinal);
        if ([-99.99, -999, -999.9, -9999, 99.99].includes(anomaly)) continue;
        if (Math.abs(anomaly) > 5) return [];
        records.push({ year, month, anomaly, ordinal });
    }
    if (records.length < 2) return [];
    records.sort((a, b) => a.ordinal - b.ordinal);
    const byYear = new Map();
    for (const { year, month, anomaly } of records) {
        if (!byYear.has(year)) byYear.set(year, { year, anomalies: [], fractions: [] });
        const entry = byYear.get(year);
        entry.anomalies.push(anomaly);
        entry.fractions.push((month - 1) / 12);
    }
    return Array.from(byYear.values());
}

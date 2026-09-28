export const METHANE_DATA_URL = 'https://gml.noaa.gov/webdata/ccgg/trends/ch4/ch4_mm_gl.txt';
export const METHANE_AXIS_MIN = 1500;
export const METHANE_RING_STEP = 200;
export const METHANE_TICKS = [1700, 1900, 2100];

// Display offset only, not a preindustrial baseline or a temperature anomaly.
export const methanePpbToSpiralValue = ppb => (ppb - METHANE_AXIS_MIN) / METHANE_RING_STEP;
export const spiralValueToMethanePpb = value => METHANE_AXIS_MIN + value * METHANE_RING_STEP;

export function parseMethaneData(text) {
    const lines = text.trim().split(/\r?\n/).map(line => line.trim());
    if (!lines.some(line => /^#\s*CH4 expressed as a mole fraction in dry air,.*\bppb\b/i.test(line))
        || !lines.some(line => /^#.*\bglobal monthly means\b/i.test(line))
        || !lines.some(line => line.replace(/\s+/g, ' ') === '# year month decimal average average_unc trend trend_unc')) return [];

    const records = [];
    const seen = new Set();
    for (const line of lines) {
        if (!line || line.startsWith('#')) continue;
        const fields = line.split(/\s+/);
        if (fields.length !== 7) return [];
        const [year, month, decimal, average] = fields.map(Number);
        const ordinal = year * 12 + month - 1;
        if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12
            || ordinal < 1983 * 12 + 6 || !Number.isFinite(decimal)
            || Math.abs(decimal - (year + (month - 0.5) / 12)) > 0.002
            || !Number.isFinite(average) || average > 10000 || seen.has(ordinal)) return [];
        seen.add(ordinal);
        // Never substitute the uncertainty or the deseasonalized trend for a missing monthly mean.
        if (average <= 0) continue;
        records.push({ year, month, average, ordinal });
    }

    records.sort((a, b) => a.ordinal - b.ordinal);
    const byYear = new Map();
    for (const { year, month, average } of records) {
        if (!byYear.has(year)) byYear.set(year, { year, anomalies: [], displayValues: [], fractions: [] });
        const entry = byYear.get(year);
        entry.anomalies.push(methanePpbToSpiralValue(average));
        entry.displayValues.push(average);
        entry.fractions.push((month - 1) / 12);
    }
    return Array.from(byYear.values());
}

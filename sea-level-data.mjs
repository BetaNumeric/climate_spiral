export const SEA_LEVEL_SOURCE_URL = 'https://sealevel.colorado.edu/';
export const SEA_LEVEL_TICKS = [0, 75, 150];
export const seaLevelMmToSpiralValue = mm => (mm + 50) / 50;
export const spiralValueToSeaLevelMm = value => value * 50 - 50;

const sourcePattern = /^https:\/\/sealevel\.colorado\.edu\/files\/(\d{4})_rel(\d+)\/gmsl_\1rel\2_seasons_retained\.txt$/;

export async function fetchSeaLevelData(fetchText) {
    const page = await fetchText(SEA_LEVEL_SOURCE_URL);
    // Match only the publisher's versioned download URLs, not arbitrary page links.
    const releases = [...page.matchAll(/https:\/\/sealevel\.colorado\.edu\/files\/(\d{4})_rel(\d+)\/gmsl_\1rel\2_seasons_(?:rmvd|retained)\.txt/g)]
        .sort((a, b) => Number(b[1]) - Number(a[1]) || Number(b[2]) - Number(a[2]));
    if (!releases.length) throw new Error('Sea-level release link not found.');
    const sourceUrl = releases[0][0].replace('_rmvd.txt', '_retained.txt');
    const raw = await fetchText(sourceUrl);
    const text = JSON.stringify({ source: 'CU sea level', sourceUrl, raw }, null, 2) + '\n';
    if (!parseSeaLevelData(text).length) throw new Error('Invalid seasonal sea-level data.');
    return text;
}

export function parseSeaLevelData(text) {
    let bundle;
    try { bundle = JSON.parse(text); } catch { return []; }
    if (!bundle || bundle.source !== 'CU sea level' || typeof bundle.raw !== 'string') return [];
    const release = sourcePattern.exec(bundle.sourceUrl);
    if (!release) return [];
    const lines = bundle.raw.trim().split(/\r?\n/).map(line => line.trim());
    if (lines.shift()?.replace(/\s+/g, ' ') !== '# Date ' + release[1] + '_rel' + release[2] + ' w/ GIA removed (mm)') return [];

    const months = new Map();
    let previousDate = -Infinity;
    for (const line of lines) {
        if (!line) continue;
        const fields = line.split(/\s+/);
        if (fields.length !== 2) return [];
        const [decimalYear, mm] = fields.map(Number);
        if (!Number.isFinite(decimalYear) || decimalYear < 1992 || decimalYear >= 2200
            || decimalYear <= previousDate || !Number.isFinite(mm) || Math.abs(mm) > 1000) return [];
        previousDate = decimalYear;
        const year = Math.floor(decimalYear);
        const start = Date.UTC(year, 0, 1), end = Date.UTC(year + 1, 0, 1);
        const date = new Date(start + (decimalYear - year) * (end - start));
        const ordinal = year * 12 + date.getUTCMonth();
        if (!months.has(ordinal)) months.set(ordinal, []);
        months.get(ordinal).push(mm);
    }
    // Drop the trailing source month, which may still be incomplete. No extrapolation.
    const lastMonth = [...months.keys()].at(-1);
    // A single source estimate is still an observation, not a missing month.
    const means = new Map([...months].filter(([month]) => month >= 1993 * 12 && month < lastMonth)
        .map(([month, values]) => [month, values.reduce((a, b) => a + b, 0) / values.length]));
    // Keep the stricter coverage requirement for the shared reference level.
    if (Array.from({ length: 12 }, (_, month) => months.get(1993 * 12 + month)?.length ?? 0)
        .some(count => count < 2)) return [];
    const reference = Array.from({ length: 12 }, (_, month) => means.get(1993 * 12 + month));
    if (!reference.every(Number.isFinite)) return [];
    const baseline = reference.reduce((a, b) => a + b, 0) / 12;
    const years = new Map();
    for (const [ordinal, mean] of means) {
        const year = Math.floor(ordinal / 12), value = mean - baseline;
        if (value <= -50) return []; // Keep the fixed display-offset radius positive.
        if (!years.has(year)) years.set(year, { year, anomalies: [], displayValues: [], fractions: [] });
        const entry = years.get(year);
        entry.anomalies.push(seaLevelMmToSpiralValue(value));
        entry.displayValues.push(value);
        entry.fractions.push((ordinal % 12) / 12);
    }
    return [...years.values()];
}

export const OCEAN_PH_PRODUCT = 'MULTIOBS_GLO_BGC_CARBON_SURFACE_MYNRT_015_008';
export const OCEAN_PH_SOURCE_URL = `https://data.marine.copernicus.eu/product/${OCEAN_PH_PRODUCT}/description`;
export const OCEAN_PH_METHOD = 'cell-area-weighted-arithmetic-mean-ph-v1';
export const OCEAN_PH_AXIS_MIN = 7.95;
export const OCEAN_PH_TICKS = [8, 8.05, 8.1, 8.15];
export const oceanPhToSpiralValue = ph => (ph - OCEAN_PH_AXIS_MIN) / 0.05;
export const spiralValueToOceanPh = value => value * 0.05 + OCEAN_PH_AXIS_MIN;

export function parseOceanPhData(text, now = new Date()) {
    let snapshot;
    try { snapshot = JSON.parse(text); } catch { return []; }
    if (!snapshot || snapshot.version !== 1 || snapshot.source !== 'Copernicus Marine / LSCE'
        || snapshot.product !== OCEAN_PH_PRODUCT || snapshot.sourceUrl !== OCEAN_PH_SOURCE_URL
        || snapshot.method !== OCEAN_PH_METHOD || snapshot.units !== 'pH' || snapshot.scale !== 'total'
        || !Array.isArray(snapshot.records) || !snapshot.records.length
        || snapshot.records[0]?.month !== '1985-01'
        || snapshot.through !== snapshot.records.at(-1)?.month) return [];
    for (const product of ['my', 'nrt']) {
        const source = snapshot.sources?.[product];
        if (!source || source.dataset !== `cmems_obs-mob_glo_bgc-car_${product}_irr-i`
            || !/^\d{6}$/.test(source.version) || !/^[a-f0-9]{64}$/.test(source.gridSha256)) return [];
    }
    if (snapshot.sources.my.gridSha256 !== snapshot.sources.nrt.gridSha256) return [];

    const currentMonth = now.getUTCFullYear() * 12 + now.getUTCMonth();
    const years = new Map();
    let previous = -Infinity, provisional = false;
    for (const record of snapshot.records) {
        const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(record?.month);
        if (!match) return [];
        const year = Number(match[1]), month = Number(match[2]) - 1, ordinal = year * 12 + month;
        if (year < 1985 || ordinal >= currentMonth || ordinal <= previous
            || !Number.isFinite(record.ph) || record.ph <= OCEAN_PH_AXIS_MIN || record.ph >= 8.5
            || !Number.isFinite(record.validAreaKm2) || record.validAreaKm2 <= 250e6 || record.validAreaKm2 >= 410e6
            || !['my', 'nrt'].includes(record.product) || (provisional && record.product === 'my')
            || typeof record.etag !== 'string' || !record.etag) return [];
        previous = ordinal;
        provisional ||= record.product === 'nrt';
        if (!years.has(year)) years.set(year, { year, anomalies: [], displayValues: [], fractions: [] });
        const entry = years.get(year);
        entry.anomalies.push(oceanPhToSpiralValue(record.ph));
        entry.displayValues.push(record.ph);
        entry.fractions.push(month / 12);
    }
    return [...years.values()];
}

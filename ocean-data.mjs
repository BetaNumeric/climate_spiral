// NOAA Climate at a Glance, global ocean, individual monthly anomalies.
export function getOceanDataUrl(year = new Date().getUTCFullYear()) {
    return 'https://www.ncei.noaa.gov/access/monitoring/climate-at-a-glance/global/time-series/'
        + 'globe/ocean/1/0/1850-' + year + '.json';
}

export function parseOceanTemperatureData(text) {
    let source;
    try {
        source = JSON.parse(text);
    } catch {
        return [];
    }
    if (source?.description?.title !== 'Global Ocean Average Temperature Departures'
        || source.description.units !== 'Degrees Celsius'
        || source.description.base_period !== '1901-2000'
        || !source.data || typeof source.data !== 'object' || Array.isArray(source.data)) {
        return [];
    }

    const months = [];
    const baselineSums = Array(12).fill(0);
    const baselineCounts = Array(12).fill(0);
    for (const [date, record] of Object.entries(source.data).sort(([a], [b]) => a.localeCompare(b))) {
        if (!/^\d{6}$/.test(date)) continue;
        const year = Number(date.slice(0, 4));
        const month = Number(date.slice(4)) - 1;
        const value = record?.departure;
        if (year < 1850 || month < 0 || month > 11
            || !['number', 'string'].includes(typeof value) || String(value).trim() === '') continue;
        const anomaly = Number(value);
        // Exclude missing-value sentinels and implausible global temperature anomalies.
        if (!Number.isFinite(anomaly) || Math.abs(anomaly) > 10) continue;
        months.push({ year, month, anomaly });
        if (year >= 1951 && year <= 1980) {
            baselineSums[month] += anomaly;
            baselineCounts[month]++;
        }
    }

    // Rebase each calendar month separately; require all 30 reference years.
    if (baselineCounts.some(count => count !== 30)) return [];
    const baseline = baselineSums.map(sum => sum / 30);
    const byYear = new Map();
    for (const { year, month, anomaly } of months) {
        if (!byYear.has(year)) byYear.set(year, { year, anomalies: [], fractions: [] });
        const entry = byYear.get(year);
        entry.anomalies.push(anomaly - baseline[month]);
        entry.fractions.push(month / 12);
    }
    return Array.from(byYear.values());
}

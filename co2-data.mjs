export const CO2_BASELINE_PPM = 280;
export const CO2_RING_STEP_PPM = 50;
export const CO2_REFERENCE_RINGS_PPM = [330, 380, 430];

export function co2PpmToSpiralValue(ppm) {
    return (ppm - CO2_BASELINE_PPM) / CO2_RING_STEP_PPM;
}

export function spiralValueToCo2Ppm(spiralValue) {
    return CO2_BASELINE_PPM + (spiralValue * CO2_RING_STEP_PPM);
}

export function parseCO2MonthlyData(text) {
    const lines = text.split('\n');
    const byYear = new Map();

    lines.forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;

        const parts = trimmed.split(/\s+/);
        if (parts.length < 4) return;

        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10);
        const decimalYear = parseFloat(parts[2]);
        const monthlyAverage = parseFloat(parts[3]);
        const deseasonalized = parseFloat(parts[4]);
        const ppm = (Number.isFinite(monthlyAverage) && monthlyAverage > 0)
            ? monthlyAverage
            : deseasonalized;

        if (!Number.isFinite(year) || !Number.isFinite(ppm) || ppm <= 0) return;

        const fraction = (Number.isFinite(month) && month >= 1 && month <= 12)
            ? (month - 1) / 12
            : Math.max(0, Math.min(0.9999, decimalYear - year));

        if (!byYear.has(year)) {
            byYear.set(year, { year, anomalies: [], displayValues: [], fractions: [] });
        }

        const entry = byYear.get(year);
        entry.anomalies.push(co2PpmToSpiralValue(ppm));
        entry.displayValues.push(ppm);
        entry.fractions.push(fraction);
    });

    return Array.from(byYear.values()).sort((a, b) => a.year - b.year);
}

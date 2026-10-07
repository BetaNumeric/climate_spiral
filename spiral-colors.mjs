export const YEAR_COLOR_STOPS = [[0, '#7b4fd3'], [1 / 6, '#3865e8'], [2 / 6, '#21bdd3'],
    [0.5, '#38bf75'], [4 / 6, '#f0da45'], [5 / 6, '#f28b35'], [1, '#e34247']];
export const DEFAULT_SINGLE_COLOR = '#d7e3ea';
export const ANOMALY_COLOR_STOPS = [[0, '#2455d6'], [0.375, '#75abea'], [0.5, '#c7ccd2'],
    [0.625, '#ed917b'], [1, '#c9253a']];
export const UNAVAILABLE_ANOMALY_COLOR = '#737980';

export function createSeasonalColorModel(data) {
    const observations = new Map();
    for (const entry of data) {
        entry.anomalies.forEach((value, index) => {
            const fraction = entry.fractions?.[index] ?? index / 12;
            const month = fraction * 12;
            const displayValue = entry.displayValues?.[index] ?? value;
            if (!Number.isFinite(displayValue) || !Number.isFinite(month)
                || month < 0 || month >= 12 || Math.abs(month - Math.round(month)) > 1e-6) return;
            observations.set(entry.year * 12 + Math.round(month), displayValue);
        });
    }
    const monthlyMeans = entries => {
        const sums = Array(12).fill(0), counts = Array(12).fill(0);
        for (const [month, value] of entries) {
            sums[month % 12] += value;
            counts[month % 12]++;
        }
        return { means: sums.map((sum, month) => counts[month] ? sum / counts[month] : null), counts };
    };
    const reference = monthlyMeans([...observations].filter(([month]) => month >= 1991 * 12 && month < 2021 * 12));
    // App coverage policy, not a claim that these derived means are certified climate normals.
    const standardPeriod = reference.counts.every(count => count >= 20);
    const { means, counts } = standardPeriod ? reference : monthlyMeans(observations);
    const anomalies = new Map([...observations].map(([month, value]) => [month, value - means[month % 12]]));
    const annualTotals = new Map();
    for (const [month, anomaly] of anomalies) {
        const year = Math.floor(month / 12);
        const total = annualTotals.get(year) ?? { sum: 0, count: 0 };
        total.sum += anomaly;
        total.count++;
        annualTotals.set(year, total);
    }
    const annualAnomalies = new Map([...annualTotals].filter(([, total]) => total.count === 12)
        .map(([year, total]) => [year, total.sum / 12]));
    let magnitude = 0;
    for (const anomaly of anomalies.values()) magnitude = Math.max(magnitude, Math.abs(anomaly));
    let annualMagnitude = 0;
    for (const anomaly of annualAnomalies.values()) annualMagnitude = Math.max(annualMagnitude, Math.abs(anomaly));
    const years = [...observations.keys()].map(month => Math.floor(month / 12));
    const range = standardPeriod ? [1991, 2020] : years.length ? [Math.min(...years), Math.max(...years)] : null;
    return {
        means, counts, magnitude, annualMagnitude, annualCount: annualAnomalies.size, range, standardPeriod,
        caption: range ? 'Monthly \u0394 vs ' + range.join('-') + (standardPeriod ? ' mean' : ' available-record mean')
            : 'Monthly \u0394 unavailable',
        annualCaption: range ? 'Yearly \u0394 vs ' + range.join('-') + (standardPeriod ? ' mean' : ' available-record mean')
            : 'Yearly \u0394 unavailable',
        yearlyAnomalyAt(decimalYear) {
            return annualAnomalies.get(Math.floor(decimalYear + 1e-7)) ?? null;
        },
        anomalyAt(decimalYear) {
            const month = decimalYear * 12, rounded = Math.round(month);
            if (Math.abs(month - rounded) < 1e-6) return anomalies.get(rounded) ?? null;
            const lower = Math.floor(month), a = anomalies.get(lower), b = anomalies.get(lower + 1);
            if (a === undefined || b === undefined) return null;
            return a + (b - a) * (month - lower);
        },
    };
}

export function getYearColorFraction(year, startYear, endYear) {
    if (endYear <= startYear) return 0.5;
    return Math.max(0, Math.min(1, (Math.floor(year + 1e-7) - startYear) / (endYear - startYear)));
}

export function sampleColorStops(stops, colors, fraction, result) {
    const position = Math.max(0, Math.min(1, fraction));
    const next = stops.findIndex(([stop]) => stop >= position);
    if (next === 0 || position === stops[next][0]) return result.copy(colors[next]);
    const from = stops[next - 1][0], to = stops[next][0];
    return result.lerpColors(colors[next - 1], colors[next], (position - from) / (to - from));
}

export function getSpiralColorDisplay(mode, measurement, { startYear, endYear, color = DEFAULT_SINGLE_COLOR, seasonal }) {
    if (mode === 'value') return { ...measurement, showMarker: true };
    if (mode === 'seasonal' || mode === 'annual') {
        const yearly = mode === 'annual';
        const magnitude = Math.max((yearly ? seasonal?.annualMagnitude : seasonal?.magnitude) ?? 0, 10 ** -measurement.precision);
        // Round upward to two significant figures, avoiding large unused portions of the scale.
        const step = Math.max(10 ** -measurement.precision, 10 ** (Math.floor(Math.log10(magnitude)) - 1));
        const extent = Math.ceil(magnitude / step - 1e-9) * step;
        const label = value => (value > 0 ? '+' : '') + value.toFixed(measurement.precision) + ' ' + measurement.unit;
        return {
            legendRange: [-extent, extent], legendLabels: [-extent, 0, extent].map(label),
            legendStops: ANOMALY_COLOR_STOPS, showMarker: yearly ? Boolean(seasonal?.annualCount) : Boolean(seasonal?.range),
            caption: (yearly ? seasonal?.annualCaption : seasonal?.caption) ?? (yearly ? 'Yearly' : 'Monthly') + ' \u0394 unavailable',
        };
    }
    if (mode === 'year') {
        const singleYear = endYear <= startYear;
        const midpointColor = YEAR_COLOR_STOPS.find(([position]) => position === 0.5)[1];
        return {
            legendRange: [startYear, endYear],
            legendLabels: singleYear ? [String(startYear)] : [String(startYear), String(endYear)],
            legendStops: singleYear ? [[0, midpointColor], [1, midpointColor]] : YEAR_COLOR_STOPS,
            showMarker: !singleYear,
        };
    }
    if (mode === 'single') return { legendLabels: [], legendStops: [[0, color], [1, color]], showMarker: false };
    throw new Error('Unknown spiral coloring mode: ' + mode);
}

export function recolorSpiral(geometry, data, radialSegments, colorAt) {
    if (!data.length) return;
    const colors = geometry.attributes.color;
    for (const point of data) point.valueColor ??= point.color.clone();
    for (const point of data) point.color.copy(colorAt(point));
    for (let vertex = 0; vertex < colors.count; vertex++) {
        const point = vertex < data.length * radialSegments ? Math.floor(vertex / radialSegments)
            : vertex === data.length * radialSegments ? 0 : data.length - 1;
        const color = data[point].color;
        colors.setXYZ(vertex, color.r, color.g, color.b);
    }
    geometry.userData.originalColorArray.set(colors.array);
    geometry.userData.lastTailRange = { start: 0, end: -1 };
    colors.needsUpdate = true;
}

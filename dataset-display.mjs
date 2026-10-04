import { CO2_BASELINE_PPM, CO2_REFERENCE_RINGS_PPM, co2PpmToSpiralValue, spiralValueToCo2Ppm } from './co2-data.mjs';
import { METHANE_AXIS_MIN, METHANE_TICKS, methanePpbToSpiralValue, spiralValueToMethanePpb } from './methane-data.mjs';
import { SEA_LEVEL_TICKS, seaLevelMmToSpiralValue, spiralValueToSeaLevelMm } from './sea-level-data.mjs';
import { SEA_ICE_MAX_EXTENT, SEA_ICE_TICKS, seaIceExtentToSpiralValue, spiralValueToSeaIceExtent } from './sea-ice-data.mjs';
import { SEA_ICE_MAX_VOLUME, SEA_ICE_VOLUME_TICKS, seaIceVolumeToSpiralValue, spiralValueToSeaIceVolume } from './sea-ice-volume-data.mjs';

export const SEA_ICE_EXTENT_SCALE = {
    max: SEA_ICE_MAX_EXTENT, ticks: SEA_ICE_TICKS,
    toSpiralValue: seaIceExtentToSpiralValue, fromSpiralValue: spiralValueToSeaIceExtent,
    unit: 'M km\u00b2',
};
export const SEA_ICE_VOLUME_SCALE = {
    max: SEA_ICE_MAX_VOLUME, ticks: SEA_ICE_VOLUME_TICKS,
    toSpiralValue: seaIceVolumeToSpiralValue, fromSpiralValue: spiralValueToSeaIceVolume,
    unit: '10\u00b3 km\u00b3',
};

const temperature = {
    unit: '\u00b0C', precision: 2, signed: true,
    legendLabels: ['-1.0', '0\u00b0C', '+1.0', '+2.0'],
    legendRange: [-1, 2],
    legendStops: [[0, '#0000ff'], [1 / 3, '#ffffff'], [2 / 3, '#ff0000'], [1, '#800080']],
    referenceValues: [0, 1, -1], referenceFontSize: 80,
    fromSpiralValue: value => value,
};
const seaIce = {
    unit: SEA_ICE_EXTENT_SCALE.unit, precision: 2, signed: false,
    legendLabels: [0, ...SEA_ICE_TICKS].map(String),
    legendRange: [0, SEA_ICE_MAX_EXTENT],
    legendStops: [[0, '#176b87'], [1, '#effbff']],
    referenceValues: SEA_ICE_TICKS.map(seaIceExtentToSpiralValue), referenceFontSize: 56,
    fromSpiralValue: spiralValueToSeaIceExtent,
};
const displays = {
    temperature, ocean: temperature, land: temperature,
    arctic: seaIce, antarctic: seaIce,
    arcticvolume: {
        ...seaIce, unit: SEA_ICE_VOLUME_SCALE.unit,
        legendLabels: [0, ...SEA_ICE_VOLUME_TICKS].map(String),
        legendRange: [0, SEA_ICE_MAX_VOLUME],
        referenceValues: SEA_ICE_VOLUME_TICKS.map(seaIceVolumeToSpiralValue),
        fromSpiralValue: spiralValueToSeaIceVolume,
    },
    co2: {
        ...temperature, unit: 'ppm', signed: false,
        legendLabels: [CO2_BASELINE_PPM, ...CO2_REFERENCE_RINGS_PPM].map(value => value + ' ppm'),
        legendRange: [CO2_BASELINE_PPM, CO2_REFERENCE_RINGS_PPM.at(-1)],
        referenceValues: CO2_REFERENCE_RINGS_PPM.map(co2PpmToSpiralValue),
        fromSpiralValue: spiralValueToCo2Ppm,
    },
    methane: {
        ...temperature, unit: 'ppb', signed: false,
        legendLabels: [METHANE_AXIS_MIN, ...METHANE_TICKS].map(value => value + ' ppb'),
        legendRange: [METHANE_AXIS_MIN, METHANE_TICKS.at(-1)],
        legendStops: [[0, '#2a9d8f'], [1, '#ffd166']],
        referenceValues: METHANE_TICKS.map(methanePpbToSpiralValue), referenceFontSize: 56,
        fromSpiralValue: spiralValueToMethanePpb,
    },
    sealevel: {
        ...temperature, unit: 'mm', precision: 1,
        legendLabels: SEA_LEVEL_TICKS.map(value => value + ' mm'),
        legendRange: [0, SEA_LEVEL_TICKS.at(-1)],
        legendStops: [[0, '#39b9db'], [1, '#ff7866']],
        referenceValues: SEA_LEVEL_TICKS.map(seaLevelMmToSpiralValue), referenceFontSize: 56,
        fromSpiralValue: spiralValueToSeaLevelMm,
    },
};

export function getDatasetDisplay(datasetKey, localRange) {
    if (datasetKey === 'local') {
        return {
            ...temperature,
            legendLabels: localRange.ticks.map(value => (value > 0 ? '+' : '') + value + '\u00b0C'),
            legendRange: [-localRange.extent, localRange.extent],
            legendStops: [[0, '#0000ff'], [0.5, '#ffffff'], [1, '#ff0000']],
            referenceValues: localRange.ticks,
        };
    }
    if (!Object.hasOwn(displays, datasetKey)) throw new Error('Unknown dataset: ' + datasetKey);
    return displays[datasetKey];
}

export function formatDatasetValue(value, display) {
    return (display.signed && value > 0 ? '+' : '') + value.toFixed(display.precision) + ' ' + display.unit;
}

export function formatReferenceValue(spiralValue, display) {
    const value = display.fromSpiralValue(spiralValue);
    return display.unit === '\u00b0C'
        ? (value > 0 ? '+' : '') + value + display.unit
        : Math.round(value) + ' ' + display.unit;
}

export function getLegendPercent(value, display) {
    const [min, max] = display.legendRange;
    return Math.max(0, Math.min(100, (value - min) / (max - min) * 100));
}

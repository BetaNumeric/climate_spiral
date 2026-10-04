import { getTemperatureDataUrl, parseTemperatureData } from './temperature-data.mjs';
import { parseGISSData } from './gistemp-data.mjs';
import { parseCO2MonthlyData } from './co2-data.mjs';
import { SEA_ICE_VOLUME_SCALE } from './dataset-display.mjs';
import { LOCAL_TEMPERATURE_SOURCE, parseLocalTemperatureData } from './local-temperature-data.mjs';
import { STATION_SOURCE, parseStationTemperatureData } from './station-temperature-data.mjs';
import { COUNTRY_SOURCE, parseCountryTemperatureData } from './country-temperature-data.mjs';
import { SEA_LEVEL_SOURCE_URL, fetchSeaLevelData, parseSeaLevelData } from './sea-level-data.mjs';
import { METHANE_DATA_URL, parseMethaneData } from './methane-data.mjs';
import { fetchSeaIceData, parseSeaIceData } from './sea-ice-data.mjs';
import { SEA_ICE_VOLUME_DATA_URL, parseSeaIceVolumeData } from './sea-ice-volume-data.mjs';

export const DATASET_CONFIG = {
    local: {
        id: 'local', title: 'Local Temperature', metricLabel: 'Local Anomaly',
        sourceLabel: 'Open-Meteo / ERA5-Land', sourceHref: LOCAL_TEMPERATURE_SOURCE,
        supportsInterpolation: false, preserveMonthlyGaps: true, fileExtension: '.json',
        parse: text => {
            try {
                const snapshot = JSON.parse(text);
                return snapshot.source === 'CRU-CY' ? parseCountryTemperatureData(snapshot)
                    : snapshot.adjustment === 'QCF' ? parseStationTemperatureData(snapshot) : parseLocalTemperatureData(snapshot);
            } catch { return []; }
        },
        description: 'Monthly temperature anomalies relative to the local 1951-1980 average for each calendar month. ERA5-Land reanalysis estimates at approximately 11 km resolution, provided by Open-Meteo. Location search: GeoNames. Data: CC BY 4.0.'
    },
    temperature: {
        id: "temperature",
        title: "Global Temperature",
        metricLabel: "Anomaly",
        localPath: "data/GLB.Ts+dSST.txt",
        remoteUrl: "https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.txt",
        sourceLabel: "NASA GISS",
        sourceHref: "https://data.giss.nasa.gov/gistemp/",
        supportsInterpolation: true,
        parse: parseGISSData,
        description: "Global average surface temperature anomalies combining land air temperatures and ocean surface temperatures, relative to 1951-1980. Source: NASA GISTEMP. Each coil represents a year."
    },
    ocean: {
        id: "ocean",
        title: "Ocean Temperature",
        metricLabel: "Ocean Anomaly",
        localPath: "data/ocean-temperature.json",
        remoteUrl: () => getTemperatureDataUrl('ocean'),
        sourceLabel: "NOAA NCEI",
        sourceHref: "https://www.ncei.noaa.gov/access/monitoring/climate-at-a-glance/global/time-series",
        supportsInterpolation: false,
        fileExtension: ".json",
        parse: text => parseTemperatureData(text, 'ocean'),
        description: "Global ocean surface temperature anomalies from 1850, rebased to 1951-1980. Source: NOAA Climate at a Glance (1901-2000 baseline). Each coil represents a year."
    },
    land: {
        id: "land",
        title: "Land Temperature",
        metricLabel: "Land Anomaly",
        localPath: "data/land-temperature.json",
        remoteUrl: () => getTemperatureDataUrl('land'),
        sourceLabel: "NOAA NCEI",
        sourceHref: "https://www.ncei.noaa.gov/access/monitoring/climate-at-a-glance/global/time-series",
        supportsInterpolation: false,
        fileExtension: ".json",
        parse: text => parseTemperatureData(text, 'land'),
        description: "Global land-only surface air temperature anomalies from 1850, rebased to 1951-1980. Source: NOAA Climate at a Glance (1901-2000 baseline). Each coil represents a year."
    },
    arctic: {
        id: "arctic",
        title: "Arctic Sea Ice Extent",
        metricLabel: "Extent (million km\u00b2)",
        localPath: "data/sea-ice-north.json",
        fetchRemote: fetchText => fetchSeaIceData('north', fetchText),
        sourceLabel: "NOAA/NSIDC",
        sourceHref: "https://nsidc.org/data/g02135/versions/4",
        supportsInterpolation: false,
        preserveMonthlyGaps: true,
        kind: "sea-ice",
        fileExtension: ".json",
        parse: text => parseSeaIceData(text, 'north'),
        description: "Arctic monthly sea ice extent since November 1978, in million km\u00b2. NOAA/NSIDC Sea Ice Index v4. Extent counts ocean covered by at least 15% sea ice. Gaps mark missing observations."
    },
    antarctic: {
        id: "antarctic",
        title: "Antarctic Sea Ice Extent",
        metricLabel: "Extent (million km\u00b2)",
        localPath: "data/sea-ice-south.json",
        fetchRemote: fetchText => fetchSeaIceData('south', fetchText),
        sourceLabel: "NOAA/NSIDC",
        sourceHref: "https://nsidc.org/data/g02135/versions/4",
        supportsInterpolation: false,
        preserveMonthlyGaps: true,
        kind: "sea-ice",
        fileExtension: ".json",
        parse: text => parseSeaIceData(text, 'south'),
        description: "Antarctic monthly sea ice extent since November 1978, in million km\u00b2. NOAA/NSIDC Sea Ice Index v4. Extent counts ocean covered by at least 15% sea ice. Gaps mark missing observations."
    },
    arcticvolume: {
        id: "arcticvolume",
        title: "Arctic Sea Ice Volume (PIOMAS)",
        metricLabel: "Volume (10\u00b3 km\u00b3)",
        localPath: "data/piomas-monthly.txt",
        remoteUrl: SEA_ICE_VOLUME_DATA_URL,
        sourceLabel: "PIOMAS / Polar Science Center",
        sourceHref: "https://psc.apl.uw.edu/research/projects/arctic-sea-ice-volume-anomaly/",
        supportsInterpolation: false,
        preserveMonthlyGaps: true,
        kind: "sea-ice",
        seaIceScale: SEA_ICE_VOLUME_SCALE,
        parse: parseSeaIceVolumeData,
        description: "Arctic monthly sea ice volume since January 1979, in thousands of km\u00b3. PIOMAS combines a sea ice/ocean model with observations; volume is not directly measured. The provider reported an update interruption in March 2026. Missing months are not estimated."
    },
    sealevel: {
        id: "sealevel",
        title: "Global Sea Level",
        metricLabel: "Change since 1993",
        localPath: "data/global-sea-level.json",
        fetchRemote: fetchSeaLevelData,
        sourceLabel: "CU Sea Level Research Group",
        sourceHref: SEA_LEVEL_SOURCE_URL,
        supportsInterpolation: false,
        preserveMonthlyGaps: true,
        fileExtension: ".json",
        parse: parseSeaLevelData,
        description: "Global mean sea-level change relative to the 1993 average, in mm. Monthly averages of CU satellite estimates, with seasonal signals retained and the source's GIA correction. The final source month is omitted as potentially incomplete. Recent values may be revised."
    },
    co2: {
        id: "co2",
        title: "Global CO2",
        metricLabel: "CO2",
        localPath: "data/co2_mm_mlo.txt",
        remoteUrl: "https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_mlo.txt",
        sourceLabel: "NOAA GML",
        sourceHref: "https://gml.noaa.gov/ccgg/trends/mlo.html",
        supportsInterpolation: false,
        parse: parseCO2MonthlyData,
        description: "Visualizing monthly atmospheric CO2 at Mauna Loa. Each coil represents one year."
    },
    methane: {
        id: "methane",
        title: "Global Methane",
        metricLabel: "CH4",
        localPath: "data/ch4_mm_gl.txt",
        remoteUrl: METHANE_DATA_URL,
        sourceLabel: "NOAA GML",
        sourceHref: "https://gml.noaa.gov/ccgg/trends_ch4/",
        supportsInterpolation: false,
        preserveMonthlyGaps: true,
        parse: parseMethaneData,
        description: "Global monthly mean atmospheric methane (CH4) from marine surface sites since July 1983, in ppb. Recent values are preliminary. Radius starts at 1500 ppb for display, not a climate baseline. Source: NOAA GML."
    }
};

export function getDatasetByKey(datasetKey) {
    return Object.hasOwn(DATASET_CONFIG, datasetKey) ? DATASET_CONFIG[datasetKey] : undefined;
}

export function getDatasetPresentation(datasetKey, { mode = 'era5', snapshot = null } = {}) {
    let dataset = getDatasetByKey(datasetKey);
    if (datasetKey === 'local' && (snapshot?.station || (!snapshot && mode === 'station'))) {
        dataset = { ...dataset, metricLabel: 'Station Anomaly', sourceLabel: 'NOAA GHCN-Monthly v4', sourceHref: STATION_SOURCE,
            description: 'Monthly weather station observations, adjusted by NOAA for discontinuities such as station moves and instrument changes. Anomalies are relative to this station\'s 1951-1980 average for each calendar month. Missing months remain gaps. Location search: Open-Meteo / GeoNames.' };
    } else if (datasetKey === 'local' && (snapshot?.country || (!snapshot && mode === 'country'))) {
        dataset = { ...dataset, metricLabel: 'Country Anomaly', sourceLabel: 'CRU-CY / University of East Anglia', sourceHref: COUNTRY_SOURCE,
            description: 'Area-weighted monthly country temperatures from CRU-CY, relative to the country\'s 1951-1980 average for each calendar month. Provider-defined land regions; some islands and overseas territories are separate. Updated annually. Where observations are sparse, CRU can substitute climatological values; a complete series does not imply complete observational coverage.' };
    }
    return dataset;
}

export function parseDatasetData(text, datasetKey) {
    return getDatasetByKey(datasetKey)?.parse(text) ?? [];
}

export function hasUsableData(data) {
    return Array.isArray(data) && data.some((entry) => {
        return entry
            && Number.isFinite(entry.year)
            && Array.isArray(entry.anomalies)
            && entry.anomalies.some(Number.isFinite);
    });
}

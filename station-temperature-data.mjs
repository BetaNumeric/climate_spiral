import { monthlyTemperatureAnomalies, normalizeLocation } from './local-temperature-data.mjs';

export const STATION_SOURCE = 'https://www.ncei.noaa.gov/products/land-based-station/global-historical-climatology-network-monthly';
export const STATION_ARCHIVE = 'https://www.ncei.noaa.gov/pub/data/ghcn/v4/ghcnm.tavg.latest.qcf.tar.gz';
export const STATION_CATALOG_URL = './data/weather-stations/catalog.json';
const SOURCE = 'NOAA GHCN-Monthly v4';
const ID = /^[A-Z]{2}[A-Z0-9-]{9}$/;
const RELEASE = /^ghcnm\.tavg\.v4\.\d+\.\d+\.\d{8}\.qcf$/;
const ordinal = key => /^\d{4}-(0[1-9]|1[0-2])$/.test(key) ? Number(key.slice(0, 4)) * 12 + Number(key.slice(5)) - 1 : NaN;
const monthKey = month => `${Math.floor(month / 12)}-${String(month % 12 + 1).padStart(2, '0')}`;
const requestSignal = signal => signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000);

export function stationReleaseCutoff(release, now = new Date()) {
    if (!RELEASE.test(release)) throw new Error('Invalid NOAA release.');
    const value = release.match(/\.(\d{8})\.qcf$/)[1];
    const date = new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10).replaceAll('-', '') !== value) throw new Error('Invalid NOAA release date.');
    return new Date(Math.min(now.getTime(), date.getTime()));
}

function validateStation(station) {
    if (!station || !ID.test(station.id) || typeof station.name !== 'string' || !station.name.trim() || station.name.length > 100
        || !Number.isFinite(station.latitude) || Math.abs(station.latitude) > 90
        || !Number.isFinite(station.longitude) || Math.abs(station.longitude) > 180
        || (station.elevation !== null && (!Number.isFinite(station.elevation) || station.elevation < -500 || station.elevation > 9000))) {
        throw new Error('Invalid station metadata: ' + JSON.stringify(station));
    }
    return station;
}

export function parseStationInventory(text) {
    const stations = new Map();
    for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        if (line.length < 39) throw new Error('Incomplete NOAA station inventory.');
        const elevation = Number(line.slice(31, 37));
        const station = validateStation({ id: line.slice(0, 11), name: line.slice(38, 68).trim(),
            latitude: Number(line.slice(12, 20)), longitude: Number(line.slice(21, 30)),
            elevation: elevation === -999 || elevation === 9999 ? null : elevation });
        if (stations.has(station.id)) throw new Error('Duplicate station in NOAA inventory.');
        stations.set(station.id, station);
    }
    return stations;
}

export function parseStationYear(line, now = new Date()) {
    if (line.length !== 115 || !ID.test(line.slice(0, 11)) || !/^\d{4}$/.test(line.slice(11, 15))
        || line.slice(15, 19) !== 'TAVG') throw new Error('Invalid NOAA monthly temperature row.');
    const year = Number(line.slice(11, 15));
    if (year < 1700 || year > now.getUTCFullYear()) throw new Error('Invalid NOAA observation year.');
    const records = [];
    for (let month = 0; month < 12; month++) {
        const offset = 19 + month * 8;
        const raw = line.slice(offset, offset + 5), measurement = line[offset + 5], quality = line[offset + 6];
        if (!/^ *-?\d+$/.test(raw) || !/^[ a-i]$/.test(measurement) || !/^[ A-Z]$/.test(quality)) {
            throw new Error('Unknown NOAA value or quality flag: ' + line.slice(0, 19) + ', month ' + (month + 1) + ': ' + JSON.stringify(line.slice(offset, offset + 8)));
        }
        const value = Number(raw);
        if (value === -9999 || (quality !== ' ' && quality !== 'A')) continue;
        if (value < -10000 || value > 7000) throw new Error('Invalid NOAA monthly temperature.');
        // Exclude the current, possibly partial month. A denotes a valid alternative adjustment.
        if (year * 12 + month >= now.getUTCFullYear() * 12 + now.getUTCMonth()) continue;
        records.push({ month: monthKey(year * 12 + month), mean: value / 100 });
    }
    return { id: line.slice(0, 11), year, records };
}

export function stationCoverage(records) {
    if (!records.length) return null;
    const first = records[0].month, last = records.at(-1).month;
    const months = records.length;
    return { first, last, months, coverage: Math.round(1000 * months / (ordinal(last) - ordinal(first) + 1)) / 10 };
}

export function readStationSnapshot(text, now = new Date()) {
    const data = typeof text === 'string' ? JSON.parse(text) : text;
    if (data?.version !== 1 || data.source !== SOURCE || data.adjustment !== 'QCF' || !RELEASE.test(data.release)
        || !Array.isArray(data.years) || !data.years.length || data.years.length > 400) throw new Error('Invalid NOAA station file.');
    const station = validateStation(data.station);
    const cutoff = stationReleaseCutoff(data.release, now);
    let previous = 1699;
    const records = [];
    for (const line of data.years) {
        const row = parseStationYear(line, cutoff);
        if (row.id !== station.id || row.year <= previous) throw new Error('Station records are duplicated, unordered, or mismatched.');
        previous = row.year;
        records.push(...row.records);
    }
    if (!monthlyTemperatureAnomalies(records).length) throw new Error('This station does not have a complete 1951-1980 reference period.');
    return { ...data, records, location: { name: station.name, latitude: station.latitude, longitude: station.longitude, timezone: 'UTC' } };
}

export function parseStationTemperatureData(text) {
    try { return monthlyTemperatureAnomalies(readStationSnapshot(text).records); }
    catch { return []; }
}

export function createStationSnapshot(station, years, release) {
    const snapshot = { version: 1, source: SOURCE, adjustment: 'QCF', release, station, years };
    readStationSnapshot(snapshot);
    return snapshot;
}

export function readStationCatalog(text) {
    const data = typeof text === 'string' ? JSON.parse(text) : text;
    if (data?.version !== 1 || data.source !== SOURCE || data.adjustment !== 'QCF' || !RELEASE.test(data.release)
        || data.baseline !== '1951-1980' || !Array.isArray(data.stations) || !data.stations.length
        || data.stations.length > 100000) throw new Error('Invalid NOAA station catalog.');
    const ids = new Set();
    const cutoff = stationReleaseCutoff(data.release);
    for (const station of data.stations) {
        validateStation(station);
        const first = ordinal(station.first), last = ordinal(station.last);
        if (ids.has(station.id) || !Number.isInteger(first) || !Number.isInteger(last)
            || first < 1700 * 12 || first > 1951 * 12 || last < 1980 * 12 + 11
            || last >= cutoff.getUTCFullYear() * 12 + cutoff.getUTCMonth()
            || !Number.isInteger(station.months) || station.months < 360 || station.months > last - first + 1
            || !Number.isFinite(station.coverage) || Math.abs(station.coverage - station.months / (last - first + 1) * 100) > 0.051
            || !/^[a-f0-9]{64}$/.test(station.hash)) throw new Error('Invalid station coverage in catalog.');
        ids.add(station.id);
    }
    return data;
}

export function stationDistance(a, b) {
    const rad = Math.PI / 180;
    const h = Math.sin((b.latitude - a.latitude) * rad / 2) ** 2
        + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin((b.longitude - a.longitude) * rad / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

export function nearbyStations(catalog, location, radius = 100, now = new Date()) {
    normalizeLocation(location);
    if (!Number.isFinite(radius) || radius <= 0 || radius > 500) throw new Error('Invalid station search radius.');
    const recentMonth = now.getUTCFullYear() * 12 + now.getUTCMonth() - 12;
    return catalog.stations.map(station => {
        const distance = stationDistance(location, station);
        const recent = ordinal(station.last) >= recentMonth;
        const score = (recent ? 100 : 0) + station.coverage * 0.2
            + Math.min(station.months / 1200, 1) * 10 - distance / radius * 10;
        return { ...station, distance, recent, score };
    }).filter(station => station.distance <= radius)
        .sort((a, b) => b.score - a.score || a.distance - b.distance || a.id.localeCompare(b.id)).slice(0, 8);
}

export function stationDataURL(station) {
    validateStation(station);
    return `./data/weather-stations/${station.id.slice(0, 2)}/${station.id}.json`;
}

export async function fetchStationCatalog({ signal, fetchImpl = fetch } = {}) {
    const response = await fetchImpl(STATION_CATALOG_URL, { cache: 'no-store', signal: requestSignal(signal) });
    if (!response.ok) throw new Error('The station catalog is unavailable. Please try again later.');
    return readStationCatalog(await response.json());
}

export async function fetchStationData(station, { signal, fetchImpl = fetch } = {}) {
    const response = await fetchImpl(stationDataURL(station), { cache: 'no-store', signal: requestSignal(signal) });
    if (!response.ok) throw new Error('The station record is unavailable. Please try again later.');
    const text = await response.text();
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
    if (hash !== station.hash) throw new Error('Station data is being updated. Please retry shortly.');
    const snapshot = readStationSnapshot(text);
    if (snapshot.station.id !== station.id) throw new Error('The source returned a different station.');
    return snapshot;
}

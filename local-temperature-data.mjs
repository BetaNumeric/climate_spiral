export const LOCAL_TEMPERATURE_SOURCE = 'https://open-meteo.com/en/docs/historical-weather-api';
const MODEL = 'era5_land';
const DAY = 86400000;
const FIRST_MONTH = 1950 * 12;
const COUNTRY_FEATURES = new Set(['PCL', 'PCLD', 'PCLF', 'PCLI', 'PCLS', 'TERR']);
const monthKey = ordinal => `${Math.floor(ordinal / 12)}-${String(ordinal % 12 + 1).padStart(2, '0')}`;
const monthNumber = key => /^\d{4}-(0[1-9]|1[0-2])$/.test(key) ? Number(key.slice(0, 4)) * 12 + Number(key.slice(5)) - 1 : NaN;
const dateString = time => new Date(time).toISOString().slice(0, 10);
const monthStart = ordinal => Date.UTC(Math.floor(ordinal / 12), ordinal % 12, 1);

export function latestLocalMonth(now = new Date()) {
    // Allow six days for publication, then use only a completed calendar month.
    const published = new Date(now.getTime() - 6 * DAY);
    return monthKey(published.getUTCFullYear() * 12 + published.getUTCMonth() - 1);
}

export function normalizeLocation(value) {
    if (!value || !Number.isFinite(value.latitude) || Math.abs(value.latitude) > 90
        || !Number.isFinite(value.longitude) || Math.abs(value.longitude) > 180
        || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 200
        || typeof value.timezone !== 'string') throw new Error('Invalid location.');
    if (value.timezone !== 'auto') new Intl.DateTimeFormat('en', { timeZone: value.timezone });
    const location = { name: value.name.trim(), latitude: value.latitude, longitude: value.longitude, timezone: value.timezone };
    if (value.countryCode !== undefined) {
        if (!/^[A-Z]{2}$/.test(value.countryCode)) throw new Error('Invalid country code.');
        location.countryCode = value.countryCode;
    }
    if (value.isCountry === true) location.isCountry = true;
    return location;
}

export function localLocationKey(location) {
    const value = normalizeLocation(location);
    return `${MODEL}:v1:${value.latitude.toFixed(4)}:${value.longitude.toFixed(4)}:${value.timezone}`;
}

export async function getDeviceLocation({ signal, geolocation = globalThis.navigator?.geolocation } = {}) {
    signal?.throwIfAborted();
    if (!geolocation) throw new Error('Device location unavailable. Use HTTPS or search for a place.');
    const position = await new Promise((resolve, reject) => {
        const finish = (error, position) => {
            signal?.removeEventListener('abort', abort);
            if (error) reject(error); else resolve(position);
        };
        // The native one-shot request cannot be cancelled; ignore its result after aborting.
        const abort = () => finish(signal.reason);
        signal?.addEventListener('abort', abort, { once: true });
        try {
            geolocation.getCurrentPosition(position => finish(null, position), error => finish(new Error(
                error.code === 1 ? 'Location access denied. Allow it in your browser settings or search for a place.'
                    : error.code === 3 ? 'Location request timed out. Try again or search for a place.'
                        : 'Unable to get your location. Try again or search for a place.'
            )), { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 });
        } catch {
            finish(new Error('Device location unavailable. Search for a place instead.'));
        }
    });
    const { latitude, longitude } = position.coords;
    return normalizeLocation({ name: `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`,
        latitude, longitude, timezone: 'auto' });
}

async function requestJSON(url, signal, fetchImpl) {
    const response = await fetchImpl(url, { signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000), cache: 'no-store' });
    if (response.status === 429) throw new Error('API limit reached. Try again later; downloaded years are saved.');
    if (!response.ok) throw new Error('Weather service unavailable. Please try again.');
    const data = await response.json();
    if (data.error) throw new Error('The weather service could not provide this location.');
    return data;
}

export async function searchLocalPlaces(query, { signal, fetchImpl = fetch } = {}) {
    const text = query.trim();
    const coordinates = text.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (coordinates) return [normalizeLocation({ name: `${Number(coordinates[1]).toFixed(3)}, ${Number(coordinates[2]).toFixed(3)}`,
        latitude: Number(coordinates[1]), longitude: Number(coordinates[2]), timezone: 'auto' })];
    if (text.length < 2 || text.length > 100) throw new Error('Enter a place name or latitude, longitude.');
    const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.search = new URLSearchParams({ name: text, count: '5', language: 'en', format: 'json' });
    const data = await requestJSON(url, signal, fetchImpl);
    return (data.results ?? []).map(place => normalizeLocation({ ...place,
        countryCode: place.country_code, isCountry: COUNTRY_FEATURES.has(place.feature_code),
        name: [...new Set([place.name, place.admin1, place.country].filter(Boolean))].join(', ') }));
}

export function readLocalSnapshot(text) {
    const data = typeof text === 'string' ? JSON.parse(text) : text;
    if (data?.version !== 1 || data.source !== 'Open-Meteo' || data.model !== MODEL || data.units !== 'celsius'
        || !Array.isArray(data.records) || !data.records.length || data.records.length > 2400
        || !Number.isFinite(Date.parse(data.fetchedAt))) throw new Error('Invalid local temperature file.');
    const location = normalizeLocation(data.location);
    const through = monthNumber(data.through);
    if (!Number.isInteger(through) || through < FIRST_MONTH || through > monthNumber(latestLocalMonth())) {
        throw new Error('Invalid monthly coverage.');
    }
    const grid = data.grid;
    if (!grid || !Number.isFinite(grid.latitude) || Math.abs(grid.latitude) > 90
        || !Number.isFinite(grid.longitude) || Math.abs(grid.longitude) > 180
        || !Number.isFinite(grid.elevation) || typeof grid.timezone !== 'string') throw new Error('Missing source grid metadata.');
    new Intl.DateTimeFormat('en', { timeZone: grid.timezone });
    let previous = FIRST_MONTH - 1;
    for (const row of data.records) {
        const ordinal = monthNumber(row.month);
        if (!Number.isInteger(ordinal) || ordinal <= previous || ordinal > through
            || !Number.isFinite(row.mean) || row.mean < -100 || row.mean > 70) throw new Error('Invalid monthly temperatures.');
        previous = ordinal;
    }
    return { ...data, location };
}

export function parseLocalTemperatureData(text) {
    try {
        const data = readLocalSnapshot(text);
        return monthlyTemperatureAnomalies(data.records);
    } catch { return []; }
}

export function monthlyTemperatureAnomalies(records) {
    const sums = Array(12).fill(0), counts = Array(12).fill(0);
    for (const row of records) {
        const ordinal = monthNumber(row.month), year = Math.floor(ordinal / 12);
        if (year >= 1951 && year <= 1980) { sums[ordinal % 12] += row.mean; counts[ordinal % 12]++; }
    }
    if (counts.some(count => count !== 30)) return [];
    const years = new Map();
    for (const row of records) {
        const ordinal = monthNumber(row.month), year = Math.floor(ordinal / 12), month = ordinal % 12;
        if (!years.has(year)) years.set(year, { year, anomalies: [], fractions: [] });
        years.get(year).anomalies.push(row.mean - sums[month] / 30);
        years.get(year).fractions.push(month / 12);
    }
    return [...years.values()];
}

export function localTemperatureRange(data) {
    let magnitude = 2;
    for (const row of data) for (const value of row.anomalies) magnitude = Math.max(magnitude, Math.abs(value));
    // Leave room around the coldest month and keep five evenly spaced, whole-degree ticks.
    const extent = Math.ceil((magnitude + 0.25) / 2) * 2;
    return { extent, ticks: [-extent, -extent / 2, 0, extent / 2, extent] };
}

export function aggregateLocalDays(data, start, end, timezone) {
    const first = Date.parse(start), last = Date.parse(end);
    const times = data.daily?.time, values = data.daily?.temperature_2m_mean;
    if (data.daily_units?.temperature_2m_mean !== '\u00b0C' || data.daily_units?.time !== 'iso8601'
        || !Array.isArray(times) || !Array.isArray(values) || times.length !== values.length
        || times.length !== (last - first) / DAY + 1
        || (timezone !== 'auto' && data.timezone !== timezone)) throw new Error('Unexpected daily weather response.');
    const months = new Map();
    times.forEach((time, index) => {
        if (time !== dateString(first + index * DAY)) throw new Error('Daily dates are incomplete or out of order.');
        const key = time.slice(0, 7), value = values[index];
        if (!months.has(key)) months.set(key, { sum: 0, count: 0 });
        if (value === null) return;
        if (!Number.isFinite(value) || value < -100 || value > 70) throw new Error('Invalid daily temperature.');
        const month = months.get(key);
        month.sum += value;
        month.count++;
    });
    return [...months].flatMap(([month, value]) => {
        const ordinal = monthNumber(month), expected = (monthStart(ordinal + 1) - monthStart(ordinal)) / DAY;
        if (value.count !== expected) {
            if (ordinal >= 1951 * 12 && ordinal < 1981 * 12) throw new Error('The 1951-1980 reference period is incomplete.');
            return [];
        }
        return [{ month, mean: value.sum / value.count }];
    });
}

export async function fetchLocalTemperature(location, { cached = null, force = false, signal,
    now = new Date(), fetchImpl = fetch, onProgress = () => {}, onCheckpoint = async () => {} } = {}) {
    location = normalizeLocation(location);
    if (cached) {
        cached = readLocalSnapshot(cached);
        if (localLocationKey(cached.location) !== localLocationKey(location)) throw new Error('Cached location does not match.');
    }
    const target = monthNumber(latestLocalMonth(now));
    if (!force && cached && monthNumber(cached.through) >= target && parseLocalTemperatureData(cached).length
        && (cached.records.at(-1).month === monthKey(target) || now - Date.parse(cached.fetchedAt) < DAY)) return cached;
    let snapshot = cached;
    const first = cached ? Math.max(FIRST_MONTH, monthNumber(cached.through) - 1) : FIRST_MONTH;
    for (let from = first; from <= target;) {
        signal?.throwIfAborted();
        const to = Math.min(target, from + 5 * 12 - 1);
        const start = dateString(monthStart(from)), end = dateString(monthStart(to + 1) - DAY);
        onProgress({ start, end, fraction: (from - first) / (target - first + 1) });
        const url = new URL('https://archive-api.open-meteo.com/v1/archive');
        url.search = new URLSearchParams({ latitude: String(location.latitude), longitude: String(location.longitude),
            start_date: start, end_date: end, daily: 'temperature_2m_mean', models: MODEL,
            timezone: snapshot?.grid.timezone ?? location.timezone, temperature_unit: 'celsius' });
        const result = await requestJSON(url, signal, fetchImpl);
        const records = aggregateLocalDays(result, start, end, snapshot?.grid.timezone ?? location.timezone);
        const grid = { latitude: result.latitude, longitude: result.longitude, elevation: result.elevation, timezone: result.timezone };
        const longitudeDistance = Math.abs((grid.longitude - location.longitude + 540) % 360 - 180);
        if (Math.abs(grid.latitude - location.latitude) > 1 || longitudeDistance > 1) throw new Error('The source returned a different location.');
        if (snapshot && ['latitude', 'longitude', 'elevation', 'timezone'].some(key => snapshot.grid[key] !== grid[key])) {
            throw new Error('The source grid changed. Previous history has been retained.');
        }
        const merged = new Map((snapshot?.records ?? []).map(row => [row.month, row]));
        for (const row of records) merged.set(row.month, row);
        snapshot = readLocalSnapshot({ version: 1, source: 'Open-Meteo', model: MODEL, units: 'celsius', location, grid,
            records: [...merged.values()].sort((a, b) => a.month.localeCompare(b.month)),
            through: monthKey(to), fetchedAt: now.toISOString() });
        signal?.throwIfAborted();
        await onCheckpoint(snapshot);
        from = to + 1;
    }
    if (!parseLocalTemperatureData(snapshot).length) throw new Error('The 1951-1980 reference period is incomplete.');
    onProgress({ fraction: 1 });
    return snapshot;
}

export function createLocalTemperatureCache(indexedDB = globalThis.indexedDB) {
    const memory = new Map();
    let database, persistent = Boolean(indexedDB);
    const open = () => database ??= new Promise((resolve, reject) => {
        const request = indexedDB.open('climate-spiral-local', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('locations');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Storage is busy.'));
    });
    async function access(key, value, write) {
        if (write) memory.set(key, value);
        if (persistent) try {
            const db = await open();
            return await new Promise((resolve, reject) => {
                const transaction = db.transaction('locations', write ? 'readwrite' : 'readonly');
                const store = transaction.objectStore('locations');
                const request = write ? store.put(value, key) : store.get(key);
                transaction.oncomplete = () => resolve(write ? value : request.result ?? null);
                transaction.onerror = transaction.onabort = () => reject(transaction.error);
            });
        } catch { persistent = false; }
        return memory.get(key) ?? null;
    }
    return { get: key => access(key, null, false), set: (key, value) => access(key, value, true),
        get persistent() { return persistent; } };
}

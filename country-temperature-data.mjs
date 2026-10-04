import { monthlyTemperatureAnomalies } from './local-temperature-data.mjs';

export const COUNTRY_SOURCE = 'https://crudata.uea.ac.uk/cru/data/hrg/';
export const COUNTRY_CATALOG_URL = './data/country-temperature/catalog.json';
const CODE = /^[A-Z]{2}$/;
const RELEASE = /^4\.\d{2}$/;
const SOURCE = 'CRU-CY';
const monthKey = (year, month) => `${year}-${String(month + 1).padStart(2, '0')}`;
const requestSignal = signal => signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000);

function validateCountry(country) {
    if (!country || !CODE.test(country.code) || typeof country.name !== 'string' || !country.name.trim()
        || country.name.length > 100 || typeof country.region !== 'string' || !/^[A-Za-z0-9_+-]{1,100}$/.test(country.region)) {
        throw new Error('Invalid country metadata.');
    }
    return country;
}

export function parseCountryTable(text, expectedRegion, now = new Date()) {
    if (typeof text !== 'string' || text.length > 100000) throw new Error('Invalid CRU country table.');
    const lines = text.trimEnd().split(/\r?\n/);
    const metadata = lines[1]?.match(/^Country =\s*(.*?)\s*:\s*parameter =\s*Mean Temperature\s*:\s*Units = degrees Celsius\s*$/);
    const period = lines[2]?.match(/^Period = (\d{4})\.(\d{4}) : missing value = (-?\d+\.\d+) : format = \(i5,17f8\.1\)\s*$/);
    if (!lines[0]?.startsWith('Climatic Research Unit Country File created on ') || !metadata || !period
        || metadata[1] !== expectedRegion
        || lines[3]?.trim().split(/\s+/).join(' ') !== 'YEAR JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC MAM JJA SON DJF ANN') {
        throw new Error('Unexpected CRU country, variable, units, or table format.');
    }
    const first = Number(period[1]), last = Number(period[2]), missing = Number(period[3]);
    if (first !== 1901 || last < 1980 || last >= now.getUTCFullYear() || missing !== -999
        || lines.length !== last - first + 5) throw new Error('Incomplete or invalid CRU country period.');
    const records = [];
    for (let index = 4; index < lines.length; index++) {
        const fields = lines[index].trim().split(/\s+/);
        const year = first + index - 4;
        if (fields.length !== 18 || fields[0] !== String(year)
            || fields.slice(1).some(value => !/^-?\d+\.\d$/.test(value))) throw new Error('Invalid or unordered CRU year row.');
        for (let month = 0; month < 12; month++) {
            const mean = Number(fields[month + 1]);
            if (mean === missing) continue;
            if (mean < -100 || mean > 70) throw new Error('Invalid CRU monthly temperature.');
            records.push({ month: monthKey(year, month), mean });
        }
    }
    return { records, through: monthKey(last, 11) };
}

export function readCountrySnapshot(text) {
    const data = typeof text === 'string' ? JSON.parse(text) : text;
    if (data?.version !== 1 || data.source !== SOURCE || !RELEASE.test(data.release) || !/^\d{10}$/.test(data.run) || data.units !== 'celsius'
        || data.baseline !== '1951-1980') throw new Error('Invalid country temperature file.');
    const country = validateCountry(data.country);
    const parsed = parseCountryTable(data.text, country.region);
    if (data.through !== parsed.through || !monthlyTemperatureAnomalies(parsed.records).length) {
        throw new Error('The country record does not have a complete 1951-1980 baseline.');
    }
    return { ...data, ...parsed, location: { name: `${country.name} (country average)` } };
}

export function parseCountryTemperatureData(text) {
    try { return monthlyTemperatureAnomalies(readCountrySnapshot(text).records); }
    catch { return []; }
}

export function readCountryCatalog(text) {
    const data = typeof text === 'string' ? JSON.parse(text) : text;
    if (data?.version !== 1 || data.source !== SOURCE || !RELEASE.test(data.release) || !/^\d{10}$/.test(data.run) || data.baseline !== '1951-1980'
        || !Array.isArray(data.countries) || !data.countries.length || data.countries.length > 300) throw new Error('Invalid country catalog.');
    const codes = new Set();
    for (const country of data.countries) {
        validateCountry(country);
        if (codes.has(country.code) || country.first !== '1901-01' || !/^\d{4}-12$/.test(country.last)
            || Number(country.last.slice(0, 4)) < 1980 || Number(country.last.slice(0, 4)) >= new Date().getUTCFullYear()
            || !Number.isInteger(country.months) || country.months < 360
            || country.months > (Number(country.last.slice(0, 4)) - 1900) * 12
            || !/^[a-f0-9]{64}$/.test(country.hash)) throw new Error('Invalid country coverage in catalog.');
        codes.add(country.code);
    }
    return data;
}

const searchKey = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const COUNTRY_ALIASES = { usa: 'US', uk: 'GB', britain: 'GB', czechrepublic: 'CZ', turkey: 'TR', ivorycoast: 'CI' };
export function findExactCountry(catalog, query) {
    const key = searchKey(query.trim());
    if (key.length < 2) return null;
    return catalog.countries.find(country => searchKey(country.name) === key || searchKey(country.region) === key
        || country.code.toLowerCase() === key || country.code === COUNTRY_ALIASES[key]) ?? null;
}

export function searchCountries(catalog, query) {
    const key = searchKey(query.trim());
    if (key.length < 2) return [];
    const exact = findExactCountry(catalog, query);
    return catalog.countries.filter(country => searchKey(country.name).includes(key)
        || searchKey(country.region).includes(key) || country.code.toLowerCase() === key || country.code === COUNTRY_ALIASES[key])
        .sort((a, b) => Number(b === exact) - Number(a === exact)
            || a.name.localeCompare(b.name)).slice(0, 8);
}

export function combineCountryPlaces(catalog, query, places) {
    const countries = catalog ? searchCountries(catalog, query) : [];
    const seen = new Set(countries.map(country => country.code));
    for (const place of places) {
        if (!place.isCountry) continue;
        const country = catalog?.countries.find(country => country.code === place.countryCode);
        if (country && !seen.has(country.code)) { countries.push(country); seen.add(country.code); }
    }
    return [...countries, ...places.filter(place => !place.isCountry)].slice(0, 8);
}

export async function fetchCountryCatalog({ signal, fetchImpl = fetch } = {}) {
    const response = await fetchImpl(COUNTRY_CATALOG_URL, { cache: 'no-store', signal: requestSignal(signal) });
    if (!response.ok) throw new Error('The country catalog is unavailable. Please try again later.');
    return readCountryCatalog(await response.json());
}

export async function fetchCountryData(country, { signal, fetchImpl = fetch } = {}) {
    validateCountry(country);
    const response = await fetchImpl(`./data/country-temperature/${country.code}.json`, { cache: 'no-store', signal: requestSignal(signal) });
    if (!response.ok) throw new Error('The country record is unavailable. Please try again later.');
    const text = await response.text();
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
    if (hash !== country.hash) throw new Error('Country data is being updated. Please retry shortly.');
    const snapshot = readCountrySnapshot(text);
    if (snapshot.country.code !== country.code || snapshot.country.region !== country.region
        || snapshot.through !== country.last || snapshot.records.length !== country.months) throw new Error('The source returned a different country record.');
    return snapshot;
}

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COUNTRY_SOURCE, parseCountryTable, readCountryCatalog, readCountrySnapshot } from '../country-temperature-data.mjs';
import { monthlyTemperatureAnomalies } from '../local-temperature-data.mjs';

const DEFAULT_OUTPUT = fileURLToPath(new URL('../data/country-temperature/', import.meta.url));
const CODES = 'AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW XK'.split(' ');
// Only map equivalent provider regions. Sub-islands are not a whole-country average.
const REGIONS = { BA: 'Bosnia-Herzegovinia', CD: 'DR_Congo', CF: 'Central_African_Rep', CI: 'Ivory_Coast',
    CK: 'Cook_Isl', CV: 'Cape_Verde_Isl', CW: 'Curacao_Isl', CX: 'Christmas_Isl', CC: 'Cocos_Isl',
    CZ: 'Czech_Republic', FK: 'Falkland_Isl', FO: 'Faeroes', HK: 'Hong_Kong', IO: 'Chagos_Archipelago',
    KN: 'St_Kitts_and_Nevis', LC: 'St_Lucia', MH: 'Marshall_Isl', MK: 'Macedonia', MO: 'Macau',
    MP: 'Northern_Marianas', NF: 'Norfolk_Isl', PR: 'Puerto_Rica', PW: 'Palau_Isl', SB: 'Solomon_Isl',
    ST: 'Sao_Tome_+_Principe', SZ: 'Swaziland', TK: 'Tokelau_Isl', TL: 'East_Timor', TR: 'Turkey',
    US: 'USA', VC: 'St_Vincent', VU: 'Vanatu', XK: 'Kosovo' };
const SKIP = new Set(['FM', 'KY', 'PF', 'SH', 'SJ', 'GS', 'VI', 'VG', 'HM', 'WF']);
const names = new Intl.DisplayNames(['en'], { type: 'region' });
const normalize = name => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function discoverCountryFiles(html, base) {
    const folder = new URL(base).pathname.match(/\/crucy\.(\d{10})\.v(4\.\d{2})\//);
    if (!folder) throw new Error('Unexpected CRU release URL.');
    const run = folder[1];
    const found = new Map();
    for (const match of html.matchAll(/href="(crucy\.v(4\.\d{2})\.(1901)\.(\d{4})\.([A-Za-z0-9_+-]+)\.tmp\.per)"/g)) {
        const [, file, release, , last, region] = match;
        if (release !== folder[2]) throw new Error('CRU filename and release folder disagree.');
        if (found.has(region)) throw new Error('Duplicate CRU country link.');
        found.set(region, { url: new URL(file, base).href, release, run, last: Number(last), region });
    }
    const files = [];
    for (const code of CODES) {
        if (SKIP.has(code)) continue;
        const name = names.of(code);
        const region = REGIONS[code] ?? [...found.keys()].find(value => normalize(value) === normalize(name));
        if (region && found.has(region)) files.push({ ...found.get(region), code, name });
    }
    if (new Set(files.map(file => file.region)).size !== files.length) throw new Error('Ambiguous CRU country mapping.');
    return files;
}

export function prepareCountryData(entries) {
    const catalog = { version: 1, source: 'CRU-CY', release: entries[0]?.release, run: entries[0]?.run, baseline: '1951-1980', countries: [] };
    const files = new Map();
    for (const entry of entries) {
        if (entry.release !== catalog.release || entry.run !== catalog.run) throw new Error('Mixed CRU releases.');
        let parsed;
        try { parsed = parseCountryTable(entry.text, entry.region); }
        catch (error) { throw new Error(`${entry.code} (${entry.region}): ${error.message}`); }
        if (parsed.through !== `${entry.last}-12`) throw new Error('CRU table and filename periods disagree.');
        if (!monthlyTemperatureAnomalies(parsed.records).length) continue;
        const country = { code: entry.code, name: entry.name, region: entry.region };
        const snapshot = { version: 1, source: 'CRU-CY', release: entry.release, run: entry.run, units: 'celsius', baseline: '1951-1980',
            country, through: parsed.through, text: entry.text };
        readCountrySnapshot(snapshot);
        const text = JSON.stringify(snapshot, null, 2) + '\n';
        catalog.countries.push({ ...country, first: parsed.records[0].month, last: parsed.through,
            months: parsed.records.length, hash: createHash('sha256').update(text).digest('hex') });
        files.set(country.code + '.json', text);
    }
    catalog.countries.sort((a, b) => a.name.localeCompare(b.name));
    readCountryCatalog(catalog);
    return { catalog, files };
}

export function validateCountryUpdate(next, previous, minimumCountries = 180) {
    readCountryCatalog(next.catalog);
    if (next.catalog.countries.length < minimumCountries || next.files.size !== next.catalog.countries.length) {
        throw new Error('The CRU release is incomplete; country files were not changed.');
    }
    if (!previous) return;
    readCountryCatalog(previous);
    if (Number(next.catalog.release) < Number(previous.release)
        || (next.catalog.release === previous.release && next.catalog.run < previous.run) || previous.countries.some(old => {
        const country = next.catalog.countries.find(value => value.code === old.code);
        return !country || country.last < old.last || country.months < old.months || country.region !== old.region;
    })) throw new Error('The CRU release is older or has lost coverage or changed region definitions; country files were not changed.');
}

async function writeChanged(path, text) {
    const old = await readFile(path, 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (old === text) return;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path + '.next', text);
    await rename(path + '.next', path);
}

export async function publishCountryData(prepared, output = DEFAULT_OUTPUT, minimumCountries = 180) {
    const previous = await readFile(join(output, 'catalog.json'), 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    validateCountryUpdate(prepared, previous ? readCountryCatalog(previous) : null, minimumCountries);
    for (const [file, text] of prepared.files) {
        if (!/^[A-Z]{2}\.json$/.test(file)) throw new Error('Invalid country output filename.');
        await writeChanged(join(output, file), text);
    }
    await writeChanged(join(output, 'catalog.json'), JSON.stringify(prepared.catalog, null, 2) + '\n');
}

export async function updateCountryData({ output = DEFAULT_OUTPUT, fetchImpl = fetch } = {}) {
    const getText = async url => {
        const response = await fetchImpl(url, { signal: AbortSignal.timeout(60000) });
        if (!response.ok) throw new Error('CRU download failed: HTTP ' + response.status);
        return response.text();
    };
    const overview = await getText(COUNTRY_SOURCE);
    const links = [...overview.matchAll(/href="([^"]*cru_ts_4\.\d{2}\/crucy\.[^"/]+\.v4\.\d{2}\/)"/g)]
        .map(match => new URL(match[1], COUNTRY_SOURCE).href);
    if (!links.length) throw new Error('The latest CRU-CY release could not be found.');
    const base = links.sort((a, b) => Number(b.match(/\.v(4\.\d{2})\/$/)[1]) - Number(a.match(/\.v(4\.\d{2})\/$/)[1])
        || Number(b.match(/crucy\.(\d{10})/)[1]) - Number(a.match(/crucy\.(\d{10})/)[1]))[0] + 'countries/tmp/';
    const entries = discoverCountryFiles(await getText(base), base);
    if (entries.length < 180) throw new Error('CRU country links are incomplete.');
    console.log(`Checking ${entries.length} CRU-CY country tables...`);
    let downloads = 0;
    // Keep requests sequential and reuse exact releases on subsequent scheduled checks.
    for (const entry of entries) {
        const old = await readFile(join(output, entry.code + '.json'), 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
        let saved = null;
        try { if (old) saved = readCountrySnapshot(old); } catch { /* Re-download invalid local input before publication checks. */ }
        if (saved?.release === entry.release && saved.run === entry.run && saved.country.region === entry.region && saved.through === `${entry.last}-12`) {
            entry.text = saved.text;
        } else {
            entry.text = await getText(entry.url);
            downloads++;
        }
    }
    const prepared = prepareCountryData(entries);
    await publishCountryData(prepared, output);
    console.log(`${prepared.catalog.countries.length} countries/territories, CRU-CY ${prepared.catalog.release}, through ${prepared.catalog.countries[0].last}; ${downloads} tables downloaded.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    if (process.argv.length !== 2) throw new Error('Usage: node scripts/update-country-data.mjs');
    updateCountryData().catch(error => { console.error(error.message); process.exitCode = 1; });
}

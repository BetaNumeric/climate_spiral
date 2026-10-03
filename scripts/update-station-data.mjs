import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { monthlyTemperatureAnomalies } from '../local-temperature-data.mjs';
import { STATION_ARCHIVE, createStationSnapshot, parseStationInventory, parseStationYear,
    readStationCatalog, stationCoverage, stationReleaseCutoff } from '../station-temperature-data.mjs';

const run = promisify(execFile);
const DEFAULT_OUTPUT = fileURLToPath(new URL('../data/weather-stations/', import.meta.url));

export async function prepareStationData(inventory, lines, release, now = new Date()) {
    now = stationReleaseCutoff(release, now);
    const stations = parseStationInventory(inventory);
    const groups = new Map();
    for await (const line of lines) {
        if (!line) continue;
        const row = parseStationYear(line, now);
        if (!stations.has(row.id)) throw new Error('A NOAA record has no station metadata.');
        if (!groups.has(row.id)) groups.set(row.id, []);
        groups.get(row.id).push(line);
    }
    const catalog = { version: 1, source: 'NOAA GHCN-Monthly v4', adjustment: 'QCF', baseline: '1951-1980', release, stations: [] };
    const files = new Map();
    for (const [id, years] of groups) {
        years.sort((a, b) => Number(a.slice(11, 15)) - Number(b.slice(11, 15)));
        if (years.some((line, index) => index && line.slice(11, 15) === years[index - 1].slice(11, 15))) {
            throw new Error('Duplicate NOAA station year.');
        }
        const records = years.flatMap(line => parseStationYear(line, now).records);
        if (!monthlyTemperatureAnomalies(records).length) continue;
        const station = stations.get(id);
        const snapshot = createStationSnapshot(station, years, release);
        const text = JSON.stringify(snapshot, null, 2) + '\n';
        const hash = createHash('sha256').update(text).digest('hex');
        files.set(join(id.slice(0, 2), id + '.json'), text);
        catalog.stations.push({ ...station, ...stationCoverage(records), hash });
    }
    catalog.stations.sort((a, b) => a.id.localeCompare(b.id));
    readStationCatalog(catalog);
    return { catalog, files, inventoryCount: stations.size, recordCount: groups.size };
}

export function validateStationUpdate(next, previous, minimumStations = 20000) {
    if (next.inventoryCount < minimumStations || next.recordCount < minimumStations
        || next.catalog.stations.length < Math.min(1000, minimumStations)) throw new Error('The NOAA archive is incomplete; station files were not changed.');
    if (!previous) return;
    const releaseDate = value => value.match(/\.(\d{8})\.qcf$/)[1];
    if (releaseDate(next.catalog.release) < releaseDate(previous.release)
        || next.catalog.stations.length < previous.stations.length * 0.9
        || next.catalog.stations.reduce((sum, station) => sum + station.months, 0)
            < previous.stations.reduce((sum, station) => sum + station.months, 0) * 0.9
        || next.catalog.stations.reduce((last, station) => station.last > last ? station.last : last, '')
            < previous.stations.reduce((last, station) => station.last > last ? station.last : last, '')) {
        throw new Error('The NOAA release is older or has lost substantial coverage; station files were not changed.');
    }
}

async function writeChanged(path, text) {
    const old = await readFile(path, 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (old === text) return;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path + '.next', text);
    await rename(path + '.next', path);
}

export async function publishStationData(prepared, output = DEFAULT_OUTPUT, minimumStations = 20000) {
    output = resolve(output);
    const previousText = await readFile(join(output, 'catalog.json'), 'utf8').catch(error => {
        if (error.code !== 'ENOENT') throw error;
        return null;
    });
    validateStationUpdate(prepared, previousText ? readStationCatalog(previousText) : null, minimumStations);
    for (const [path, text] of prepared.files) await writeChanged(join(output, path), text);
    // Publish the catalog last. Its hashes prevent clients from mixing different releases.
    await writeChanged(join(output, 'catalog.json'), JSON.stringify(prepared.catalog, null, 2) + '\n');
}

export async function updateStationData({ archive, output = DEFAULT_OUTPUT } = {}) {
    const temporary = await mkdtemp(join(tmpdir(), 'climate-ghcn-'));
    try {
        if (!archive) {
            archive = join(temporary, 'source.tar.gz');
            console.log('Downloading NOAA GHCN-Monthly v4 adjusted temperature...');
            const response = await fetch(STATION_ARCHIVE, { signal: AbortSignal.timeout(180000) });
            if (!response.ok) throw new Error('NOAA download failed: HTTP ' + response.status);
            await pipeline(Readable.fromWeb(response.body), createWriteStream(archive));
        }
        archive = resolve(archive);
        const { stdout: listing } = await run('tar', ['-tzf', archive], { maxBuffer: 1024 * 1024 });
        const members = listing.trim().split(/\r?\n/);
        const find = extension => {
            const matches = members.filter(name => new RegExp('(^|/)ghcnm\\.tavg\\.v4\\.\\d+\\.\\d+\\.\\d{8}\\.qcf\\.' + extension + '$').test(name));
            if (matches.length !== 1) throw new Error('Unexpected NOAA archive contents.');
            return matches[0];
        };
        const inventoryMember = find('inv'), dataMember = find('dat');
        const release = dataMember.split('/').at(-1).slice(0, -4);
        if (!inventoryMember.endsWith(release + '.inv')) throw new Error('NOAA inventory and observations have different versions.');
        const { stdout: inventory } = await run('tar', ['-xOzf', archive, '--', inventoryMember], { maxBuffer: 20 * 1024 * 1024 });
        console.log('Validating station observations and 1951-1980 baselines...');
        const child = spawn('tar', ['-xOzf', archive, '--', dataMember], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        child.stderr.on('data', chunk => { stderr += chunk; });
        const closed = new Promise(resolve => {
            child.on('error', error => resolve({ error }));
            child.on('close', code => resolve({ code }));
        });
        let prepared;
        try { prepared = await prepareStationData(inventory, createInterface({ input: child.stdout, crlfDelay: Infinity }), release); }
        catch (error) { child.kill(); await closed; throw error; }
        const result = await closed;
        if (result.error || result.code !== 0) throw result.error ?? new Error('NOAA archive could not be read: ' + stderr);
        await publishStationData(prepared, output);
        const bytes = [...prepared.files.values()].reduce((sum, value) => sum + Buffer.byteLength(value), 0);
        console.log(`${prepared.catalog.stations.length} eligible stations from ${prepared.inventoryCount}; ${(bytes / 1048576).toFixed(1)} MB. Release: ${release}`);
    } finally {
        // Only remove the exact temporary directory created by this invocation.
        if (dirname(temporary) === resolve(tmpdir()) && temporary.startsWith(join(resolve(tmpdir()), 'climate-ghcn-'))) {
            await rm(temporary, { recursive: true, force: true });
        }
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== '--archive')) throw new Error('Usage: node scripts/update-station-data.mjs [--archive path]');
    updateStationData({ archive: args[1] }).catch(error => { console.error(error.message); process.exitCode = 1; });
}

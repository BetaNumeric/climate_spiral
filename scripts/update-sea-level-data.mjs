import { readFile, writeFile } from 'node:fs/promises';
import { fetchSeaLevelData, parseSeaLevelData } from '../sea-level-data.mjs';

const destination = new URL('../data/global-sea-level.json', import.meta.url);
const text = await fetchSeaLevelData(async url => {
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error('Sea-level download failed: HTTP ' + response.status);
    return response.text();
});
const dates = data => data.flatMap(entry => entry.fractions.map(fraction => Math.round((entry.year + fraction) * 12)));
const months = dates(parseSeaLevelData(text));
if (months[0] !== 1993 * 12 || months.some((month, i) => i > 0 && month > months[i - 1] + 2)) {
    throw new Error('Sea-level download has excessive gaps; local file was not changed.');
}
const previousText = await readFile(destination, 'utf8').catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return '';
});
const previousMonths = dates(parseSeaLevelData(previousText));
const downloadedMonths = new Set(months);
if (months.length < previousMonths.length || previousMonths.some(month => !downloadedMonths.has(month))) {
    throw new Error('Older sea-level series; local file was not changed.');
}
if (previousMonths.length) {
    const lastDate = value => Number(JSON.parse(value).raw.trim().split(/\r?\n/).at(-1).trim().split(/\s+/)[0]);
    const sampleCount = value => JSON.parse(value).raw.trim().split(/\r?\n/).filter(line => line.trim() && !line.startsWith('#')).length;
    if (lastDate(text) < lastDate(previousText) || sampleCount(text) < sampleCount(previousText)) {
        throw new Error('Truncated sea-level source; local file was not changed.');
    }
}
if (text !== previousText) await writeFile(destination, text);
const last = months.at(-1);
console.log('Global sea level: ' + months.length + ' months through ' + Math.floor(last / 12)
    + '-' + String(last % 12 + 1).padStart(2, '0') + '.');

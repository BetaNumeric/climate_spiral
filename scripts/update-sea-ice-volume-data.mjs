import { readFile, writeFile } from 'node:fs/promises';
import { SEA_ICE_VOLUME_DATA_URL, parseSeaIceVolumeData } from '../sea-ice-volume-data.mjs';

const destination = new URL('../data/piomas-monthly.txt', import.meta.url);
const response = await fetch(SEA_ICE_VOLUME_DATA_URL, { signal: AbortSignal.timeout(60000) });
if (!response.ok) throw new Error('PIOMAS download failed: HTTP ' + response.status);
const text = await response.text();
const data = parseSeaIceVolumeData(text);
if (!data.length) throw new Error('Invalid PIOMAS monthly volume data; local file was not changed.');

const dates = entries => entries.flatMap(entry => entry.fractions.map(fraction => Math.round((entry.year + fraction) * 12)));
const months = dates(data);
if (months[0] !== 1979 * 12 || months.some((month, i) => i > 0 && month !== months[i - 1] + 1)) {
    throw new Error('PIOMAS download has missing months; local file was not changed.');
}
const previousText = await readFile(destination, 'utf8').catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return '';
});
if (months.length < dates(parseSeaIceVolumeData(previousText)).length) {
    throw new Error('PIOMAS returned an older volume series; local file was not changed.');
}

if (text !== previousText) await writeFile(destination, text);
const lastMonth = months.at(-1);
console.log('Arctic sea ice volume: ' + months.length + ' months through ' + Math.floor(lastMonth / 12)
    + '-' + String(lastMonth % 12 + 1).padStart(2, '0') + '.');

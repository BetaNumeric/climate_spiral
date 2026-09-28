import { readFile, writeFile } from 'node:fs/promises';
import { METHANE_DATA_URL, parseMethaneData } from '../methane-data.mjs';

const destination = new URL('../data/ch4_mm_gl.txt', import.meta.url);
const response = await fetch(METHANE_DATA_URL, { signal: AbortSignal.timeout(60000) });
if (!response.ok) throw new Error('NOAA methane download failed: HTTP ' + response.status);
const text = await response.text();
const data = parseMethaneData(text);
if (!data.length) throw new Error('Invalid NOAA global methane data; local file was not changed.');

const dates = entries => entries.flatMap(entry => entry.fractions.map(fraction => Math.round((entry.year + fraction) * 12)));
const months = dates(data);
if (months[0] !== 1983 * 12 + 6 || months.some((month, i) => i > 0 && month !== months[i - 1] + 1)) {
    throw new Error('NOAA methane download has missing months; local file was not changed.');
}
const previousText = await readFile(destination, 'utf8').catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return '';
});
if (months.length < dates(parseMethaneData(previousText)).length) {
    throw new Error('NOAA returned an older methane series; local file was not changed.');
}

if (text !== previousText) await writeFile(destination, text);
const lastMonth = months.at(-1);
console.log('Global methane: ' + months.length + ' months through ' + Math.floor(lastMonth / 12)
    + '-' + String(lastMonth % 12 + 1).padStart(2, '0') + '.');

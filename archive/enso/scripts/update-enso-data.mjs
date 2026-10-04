import { readFile, writeFile } from 'node:fs/promises';
import { ENSO_DATA_URL, parseENSOData } from '../enso-data.mjs';

const destination = new URL('../data/Rnino34.ascii.txt', import.meta.url);
const response = await fetch(ENSO_DATA_URL, { signal: AbortSignal.timeout(60000) });
if (!response.ok) throw new Error('NOAA ENSO download failed: HTTP ' + response.status);
const text = await response.text();
const data = parseENSOData(text);
if (!data.length) throw new Error('Invalid monthly relative Nino 3.4 data; local file was not changed.');
const dates = entries => entries.flatMap(entry => entry.fractions.map(fraction => Math.round((entry.year + fraction) * 12)));
const months = dates(data);
if (months[0] !== 1949 * 12 + 11 || months.some((month, i) => i > 0 && month !== months[i - 1] + 1)) {
    throw new Error('NOAA ENSO download has missing months; local file was not changed.');
}
const previousText = await readFile(destination, 'utf8').catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return '';
});
if (months.length < dates(parseENSOData(previousText)).length) {
    throw new Error('NOAA returned an older ENSO series; local file was not changed.');
}
if (text !== previousText) await writeFile(destination, text);
const last = months.at(-1);
console.log('Monthly relative Nino 3.4: ' + months.length + ' months through ' + Math.floor(last / 12)
    + '-' + String(last % 12 + 1).padStart(2, '0') + '.');

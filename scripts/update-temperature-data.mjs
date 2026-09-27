import { readFile, writeFile } from 'node:fs/promises';
import { getTemperatureDataUrl, parseTemperatureData } from '../temperature-data.mjs';

export async function updateTemperatureData(surface) {
    const url = getTemperatureDataUrl(surface);
    const destination = new URL('../data/' + surface + '-temperature.json', import.meta.url);
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error('NOAA ' + surface + ' download failed: HTTP ' + response.status);
    const text = await response.text();
    const data = parseTemperatureData(text, surface);
    if (!data.length) throw new Error('NOAA ' + surface + ' data or baseline is invalid; local file was not changed.');

    const last = data.at(-1);
    const lastMonth = Math.round(last.fractions.at(-1) * 12);
    const monthCount = data.reduce((count, entry) => count + entry.anomalies.length, 0);
    const expectedCount = (last.year - 1850) * 12 + lastMonth + 1;
    if (data[0].year !== 1850 || monthCount !== expectedCount) {
        throw new Error('NOAA ' + surface + ' download has missing months; local file was not changed.');
    }

    const previousText = await readFile(destination, 'utf8').catch(error => {
        if (error.code !== 'ENOENT') throw error;
        return '';
    });
    const previousCount = parseTemperatureData(previousText, surface)
        .reduce((count, entry) => count + entry.anomalies.length, 0);
    if (monthCount < previousCount) throw new Error('NOAA returned an older series; local file was not changed.');

    if (text !== previousText) await writeFile(destination, text);
    console.log(surface + ' temperature: ' + monthCount + ' months through ' + last.year
        + '-' + String(lastMonth + 1).padStart(2, '0') + '.');
}

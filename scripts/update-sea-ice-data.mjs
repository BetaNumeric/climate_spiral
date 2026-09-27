import { readFile, writeFile } from 'node:fs/promises';
import { fetchSeaIceData, parseSeaIceData } from '../sea-ice-data.mjs';

const updates = [];
for (const hemisphere of ['north', 'south']) {
    const destination = new URL('../data/sea-ice-' + hemisphere + '.json', import.meta.url);
    const text = await fetchSeaIceData(hemisphere, async url => {
        const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error('NSIDC download failed: HTTP ' + response.status);
        return response.text();
    });
    const data = parseSeaIceData(text, hemisphere);
    const previousText = await readFile(destination, 'utf8').catch(error => {
        if (error.code !== 'ENOENT') throw error;
        return '';
    });
    const previous = parseSeaIceData(previousText, hemisphere);
    const dates = entries => entries.flatMap(entry => entry.fractions.map(fraction => Math.round((entry.year + fraction) * 12)));
    const available = new Set(dates(data));
    if (dates(previous).some(date => !available.has(date))) {
        throw new Error('NSIDC returned an older or incomplete ' + hemisphere + ' series; local files were not changed.');
    }
    updates.push({ destination, text, previousText });
    const last = data.at(-1);
    console.log(hemisphere + ' sea ice: ' + available.size + ' observations through ' + last.year
        + '-' + String(Math.round(last.fractions.at(-1) * 12) + 1).padStart(2, '0') + '.');
}

// Validate both hemispheres before replacing either local snapshot.
for (const { destination, text, previousText } of updates) {
    if (text !== previousText) await writeFile(destination, text);
}
